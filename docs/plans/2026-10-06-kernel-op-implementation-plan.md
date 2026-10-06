# faijs 内核 op 实现方案（BREP 优先 · 精确 STEP 专题）

> 日期：2026-10-06
> 事实基线：`C:/git/OpenCascade/occt-wasm`（HEAD `1091f22` = release **5.6.0**，与 faijs 安装版本一致）与
> `C:/git/OpenCascade/OCCT`（源码仓库，**7.9.0**）的**当前源码**；`C:/my/Faicad/faijs` 当前源码；
> `C:/my/Faicad/faijs-openscad` 当前源码与 `tests/manifest.json`。
> 所有结论均标注源码文件与行号，可直接复核。**不引用任何历史 plan 文档。**
>
> 本文件是专题计划，**取代** `2026-10-06-progress-and-roadmap.md` §3.A 与 §4 中
> T804–T811 的方案内容；parity 比对（原 T800–T803）、超大输出（T812）、文档收尾（T814）仍以该文件为准。

---

## 0. 需求与本文要解决的问题

需新增 faijs op 才能实现的 OpenSCAD 能力，本文回答三个问题：

1. **哪些可以用 Manifold 的现成 API**（用户举例 hull）？
2. **哪些必须给 occt-wasm 新增暴露**（从 OCCT 里补）？
3. **如何保证能用 BREP 实现的 op 尽量用 BREP 实现**，从而导出精确 STEP？

并纠正上一版方案中不正确、不合理的部分（见 §1）。

---

## 1. 对上一版方案的纠正

`2026-10-06-progress-and-roadmap.md` 的 §3.A / §4 存在三类问题：

### 1.1 未区分 BREP 与 mesh，把「可精确 BREP」的能力误判为 mesh 问题

| 上一版表述 | 实际（源码核实） | 纠正 |
|---|---|---|
| hull：「vertex-extraction → hullFromPoints；或 faijs 内核新增 shape-level hull op」，隐含可走 mesh | 凸包是**平面多面体**，BREP 可用 `buildTriFace`+`sewAndSolidify` **精确**表达 | hull **必须走 BREP 直出**，不该走 Manifold→mesh→BREP 重建（后者有损，且可能非流形失败） |
| polyhedron：「faces → BREP shell/solid 重建」，含糊 | 面均为平面，`buildTriFace`/`makeFace`+`sewAndSolidify` 即可 | 明确为 BREP 直构，非 mesh 重建 |
| surface：「heightmap 读取 + 网格生成」，定位为独立子项目 | OCCT `GeomAPI_PointsToBSplineSurface` 已支持 `ZPoints` 构造（`GeomAPI_PointsToBSplineSurface.hxx:141`）；且 OpenSCAD `surface()` 本质是双线性插值网格 | 可用 BREP 精确表达（平面片或 B 样条），**不是**必须独立子项目 |

### 1.2 把「occt-wasm 已暴露但 faijs 未接线」误判为「OCCT 缺失」

occt-wasm 5.6.0 的 facade **已暴露**下列方法，faijs 侧零调用。上一版方案把它们当成需要新增能力：

| 方法 | facade 声明位置 | 上一版方案的错误定位 |
|---|---|---|
| `offsetWire2D(wireId, offset, joinType)` | `occt_kernel.h:359` | 误判为「缺真正的 2D offset」 |
| `bsplineSurface(flatPoints, rows, cols)` | `occt_kernel.h:411` | 误判为「无 heightmap 能力」 |
| `projectEdges(...)` （HLR） | `occt_kernel.h:399` | 误判为「无投影能力」 |
| `thicken(shapeId, thickness, tol)` | `occt_kernel.h:353` | 未提及 |
| `vertexPosition(vertexId)` | `occt_kernel.h:325` | 误判为「需新增暴露」（**实际已暴露**） |
| `generalTransform(id, matrix)`（非仿射） | `occt_kernel.h:255` | 未提及 |
| `makeHelixWireHanded(...)` | `occt_kernel.h:230` | 未提及（可解决 twist 负角） |
| `buildExtrusionLaw` / `trimLaw` / `sweepWithLaw` | `occt_kernel.h:442-444` | 误判为「scaling law 不支持」（**实际已暴露，仅 faijs 未接线**） |

### 1.3 实现路径选错

- **twist 挤出**：上一版选「切片堆叠法 spike」（把 profile 沿 Z 切 N 层，每层施加旋转/缩放后 loft/union）。
  这是**离散逼近**，N 层堆叠必然引入层间误差，与「精确 STEP」目标直接冲突。
  正确路径：OCCT 原生扫掠——`makeHelixWireHanded` 解决负角，`sweepWithLaw`/`sweepFull` 解决缩放律，
  `BRepOffsetAPI_ThruSections`（loft）+ `CheckCompatibility` 解决非等比缩放。**见 §4.8。**

---

## 2. 技术原则：BREP 优先的三条判据

判定一个 op 走 BREP 还是 mesh，按以下顺序，命中即停：

| 序 | 判据 | 结论 |
|---|---|---|
| **1** | 该 op 的结果能否被**解析曲面/平面**精确表达？（凸包、多面体、拉伸、旋转、布尔、偏置、扫掠） | → **BREP**。这是绝大多数 OpenSCAD 能力的情况 |
| **2** | OCCT 是否已有对应算法类（无论 facade 是否已暴露）？ | → **BREP**，必要时补 facade 暴露（§5） |
| **3** | 仅当结果本质是**离散/采样**的（SDF 等值面、顶点平滑、网格细分、minkowski 近似） | → **Manifold mesh**，并明确标注为 mesh-only |

### 2.1 为什么 hull 这类"看起来适合 Manifold"的 op 反而要走 BREP

用户举例「hull 这类可以用 manifold 的 api」。Manifold 确实有 `Manifold.hull()` /
`CrossSection.hull()`，一行调用即可。但：

- **凸包的几何本质是平面凸多面体**——它的每个面都是**平面**，而 BREP 表达平面是**精确**的
  （`Geom_Plane`，STEP 中记为 `plane` / `advanced_face`）；
- 走 Manifold 得到的是三角网格，要进 STEP 必须经 `reconstructSolidFromMesh`
  （ASCII STL 文本化 → 重解析 → 多容差缝合，**三重有损**，且非 2-manifold 直接失败）；
- 因此 hull 的最优路径是：**JS 侧 QuickHull 求凸包面 → `buildTriFace`/`makeFace` → `sewAndSolidify` → 精确 BREP**。

> **结论**：hull "可以"用 Manifold，但**不应该**用——因为它恰恰是 BREP 能精确表达的。
> Manifold 留给真正需要 mesh 的 op（见 §6）。这一条是本文与上一版方案最核心的分歧。

### 2.2 mesh→BREP 重建是精度漏斗，不是等价变换

faijs 现有 `reconstructSolidFromMesh`（`occt-kernel/meshReconstruct.ts`）的固定流程：

```
Float32 顶点 → ASCII STL 文本 → importStl → fixShape
  → isSolid ? healSolid(1e-4) → fixFaceOrientations → removeDegenerateEdges → unifySameDomain
  → 失败则按 [1e-5, 1e-4, 1e-3, 1e-2] 多容差 sewAndSolidify 循环
```

三重有损 + 容差阶梯放大到 1e-2 mm，且 `unifySameDomain` 只能合并同域面，**无法把三角面拟合回解析曲面**。
凡能 BREP 直构的 op 走这条链，等于主动放弃精确 STEP。

---

## 3. occt-wasm 现状核实（一手事实）

### 3.1 分层与边界

```
occt-wasm@5.6.0 (Embind)
   ├─ facade/include/occt_kernel.h   515 行，OcctKernel 类声明（唯一契约面）
   ├─ facade/generated/kernel.cpp    方法实现
   ├─ facade/generated/bindings.cpp  Embind .function() 绑定（实际 JS 可见面）
   └─ crate/src/kernel.rs / kernel_generated.rs
```

**关键约束**：Embind 只暴露了一个 C++ facade 类 `OcctKernel`，
运行时模块导出键仅 `["FS","HEAP32","HEAPU32","HEAPF32","OcctKernel","MeshData",...]`。
即 JS 侧**无法直接 new 任何 OCCT 类**（无 `gp_Pnt`/`TopoDS_Shape`/`BRepBuilderAPI_*`）。
→ **要用新 OCCT 类，必须改 facade（C++）+ 重编 wasm**，这是"新增暴露"的真实成本来源。

### 3.2 已暴露且与本专题相关的方法（faijs 接线状态）

| 能力 | facade 方法 | 声明行 | 实现行 | faijs 是否接线 |
|---|---|---|---|---|
| 顶点坐标 | `vertexPosition(vertexId)` | 325 | — | ❌ 未接线 |
| 三角面构造 | `buildTriFace(a,b,c)` | 243 | — | ✅（hull/meshReconstruct） |
| 缝合/实体化 | `sew` / `sewAndSolidify` / `buildSolidFromFaces` | 239/240/241 | — | ✅ |
| **2D 线框偏置** | `offsetWire2D(wireId, offset, joinType)` | 359 | `kernel.cpp:1070` | ❌ **未接线** |
| **B 样条曲面** | `bsplineSurface(flatPoints, rows, cols)` | 411 | `kernel.cpp:1996` | ❌ **未接线** |
| **HLR 投影** | `projectEdges(...)` → `ProjectionData`（6 组 compound） | 399 | `kernel.cpp:4321` | ⚠️ 仅 view 层输出 SVG |
| 放样 | `loft` / `loftWithVertices` | 185/186 | `kernel.cpp:3125/3141` | ✅（**未开 CheckCompatibility**） |
| 加厚 | `thicken(shapeId, thickness, tol)` | 353 | `kernel.cpp:3997` | ❌ 未接线 |
| **扫掠律（真实可用）** | `sweepFull(...)` 的 `lawKind` / `lawLength` / `lawEndFactor` | 197-202 | `kernel.cpp:3332`；law 分支 `:3393-3403` | ❌ 未接线（faijs 只用 `sweepPipeShell`） |
| ~~扫掠律~~ | `buildExtrusionLaw` / `trimLaw` / `sweepWithLaw` | 442-444 | **kernel.cpp 中无实现** | ❌ `bindings.cpp` 未绑定（**死声明，不可用**，见 §3.3③） |
| 螺旋线（带旋向） | `makeHelixWireHanded(...)` | 230 | — | ❌ 未接线 |
| **非仿射变换** | `generalTransform(id, matrix)` | 255 | — | ❌ 未接线 |
| 半空间（剖切） | `halfSpace(...)` | 143 | — | ❌ 未接线 |
| 平面剖切（精确边） | `sectionPlane(...)` | 153 | — | ✅（→`sectionByPlane`） |
| 2D→3D 抬升 | `liftCurve2dToPlane(...)` | 414 | — | ❌ 未接线（**方向为 2D→3D**） |
| 曲线插值/逼近 | `interpolatePoints` / `approximatePoints` | 345/350 | — | ✅ |
| 面内开孔 | `addHolesInFace(faceId, holeWires)` | 235 | — | ✅ |
| 非平面面/面上构面 | `makeNonPlanarFace` / `makeFaceOnSurface` | 234/439 | — | ❌ 未接线 |
| STL/STEP 导入 | `importStl` / `importStlBinary` / `importStep` | 302/305/300 | — | ⚠️ STL 仅 meshReconstruct 用 |
| 带 history 布尔 | `booleanOp(opCode, args, tools, glue, fuzzy, simplifyAngularTol, ...)` | 157 | — | 部分 |

### 3.3 三个关键实现的源码事实（纠正二手结论）

**① `bsplineSurface` 是"逼近"，不是"控制点"**

```cpp
// facade/generated/kernel.cpp:1996-2029
GeomAPI_PointsToBSplineSurface approx(points, 3, 8, GeomAbs_C2, 1e-3);
//                                     ↑DegMin ↑DegMax ↑连续性 ↑Tol3D
if (!approx.IsDone()) throw ...("bsplineSurface: approximation failed");
BRepBuilderAPI_MakeFace faceMaker(approx.Surface(), 1e-3);
```

→ 它用 **最小二乘逼近**（容差 1e-3），曲面**不严格穿过**输入点；
OpenSCAD `surface()` 是**双线性插值**（严格穿过数据点）。这是真实语义差异，不是"控制点"问题。
若要插值语义，需暴露 `GeomAPI_PointsToBSplineSurface` 的 `ZPoints` 构造（OCCT 源码 `:141`）。

**② `loft` 未调用 `CheckCompatibility`——扭绕风险的直接来源**

```cpp
// facade/generated/kernel.cpp:3125-3139
uint32_t OcctKernel::loft(std::vector<uint32_t> wireIds, bool isSolid, bool ruled) {
    BRepOffsetAPI_ThruSections maker(isSolid, ruled);
    for (uint32_t wid : wireIds) maker.AddWire(TopoDS::Wire(get(wid)));
    maker.Build();                       // ← 未调用 CheckCompatibility
    if (!maker.IsDone()) throw ...("loft: operation failed");
    return store(maker.Shape());
}
```

OCCT 官方 `CheckCompatibility`（`BRepOffsetAPI_ThruSections.hxx:100`）的作用正是
*"compute origin and orientation on wires to avoid twisted results and update wires to have
same number of edges"*。**这是 twisted extrusion 的官方防扭绕开关，facade 未暴露**（`loft` 只暴露 `isSolid`/`ruled`）。

**③ `buildExtrusionLaw` / `trimLaw` / `sweepWithLaw` 是"死声明"，不可用**

这三条在 `occt_kernel.h:442-444` 有声明，但：

- `facade/generated/kernel.cpp` 中**无对应实现**（`grep "OcctKernel::buildExtrusionLaw|trimLaw|sweepWithLaw"` 零命中）；
- `facade/generated/bindings.cpp` 中**未绑定**（Embind `.function()` 计数为 0）。

即 JS 侧根本调不到。faijs 的 `adapters/occt.ts:76` 把 `buildExtrusionLaw` 登记进
`OCCT_METHOD_KINDS`，属于**虚报**（违反 `adapters/occt.ts:48-58` 的"声明=实现"原则），
这也是它"零调用"的真实原因——不是不想用，是用不了。**应从上表里移除该虚报项。**

**真正可用的 scaling law 路径是 `sweepFull`**（已实现 + 已绑定）：

```cpp
// facade/generated/kernel.cpp:3393-3403（sweepFull 内的 law 分支）
if (lawKind == 0)      maker.Add(get(profileId), withContact, withCorrection);
else if (lawKind == 1) { Handle(Law_Linear) law = new Law_Linear();
                         law->Set(0.0, 1.0, lawLength, lawEndFactor);
                         maker.SetLaw(get(profileId), law, ...); }
else if (lawKind == 2) { Handle(Law_S) law = new Law_S();
                         law->Set(0.0, 1.0, lawLength, lawEndFactor);
                         maker.SetLaw(get(profileId), law, ...); }
```

→ **twist/scale 挤出的缩放律无需新增 occt-wasm 暴露**，改调 `sweepFull` 即可（见 §4.8）。
（`Law_Linear` 为线性律、`Law_S` 为 S 形律；二者均为**等比例** homothetic 缩放，
X/Y 非等比仍需走 `loft` + `CheckCompatibility`。）

---

### 3.4 faijs TS 面（arg-spec）当前 skip 的相关条目

`packages/core/src/api/surface/arg-spec.ts` 中标注 `kind:'skip'` 且与本专题相关的条目：

| 条目 | 行号 | 含义 |
|---|---|---|
| `hull` | 3947 | shape 凸包未做成 op |
| `polyhedron` | 3955 | 多面体未做成 op |
| `minkowski` | 3951 | 无精确解 |
| `offsetWire2D` | 3508 | 2D 偏置未做成 op（**内核已暴露**） |
| `vertexPosition` | 3412 | 顶点坐标未做成 op（**内核已暴露**；faijs 内部 `api/cadquery-selectors/entity.ts:204` 直调 `k.vertexPosition`） |
| `surfaceFromGrid` / `surfaceFromImage` | 3925 / 3929 | heightmap 未做成 op |
| `getNurbsSurfaceData` | 3941 | 曲面侧 NURBS 读取缺失（仅曲线侧有 `getNurbsCurveData`） |
| `fill` | 3921 | 2D 填孔未做成 op |

> **关键区分**：`skip` = 未登记进 TS 面（`cad.*` / 脚本面），**不代表内核能力缺失**。
> `offsetWire2D`、`vertexPosition` 就是典型——内核已暴露，只是没做成 op。
> 这直接反驳了上一版方案中「缺真正的 2D offset」「需新增顶点提取」的判断。

---

## 4. 逐 op 实现路径判定

### 汇总表

| op | 主路径 | 现有能力 | 需新增暴露 | 精确 STEP | 阻塞例数 |
|---|---|---|---|---|---|
| hull（shape） | **BREP** | `getSubShapes`+`vertexPosition`+QuickHull+`buildTriFace`+`sewAndSolidify` | 无 | ✅ 平面面 | 3 |
| polyhedron | **BREP** | `buildTriFace`/`makeFace`+`sewAndSolidify`+`fixFaceOrientations` | 可选 `Sewing::FreeEdges` | ✅ | 1 |
| offset2d | **BREP** | `offsetWire2D` **已暴露** | 无（P2 增强） | ✅（注意 `offset_curve_2d` 兼容） | 2 |
| text | **BREP** | faijs-extra `text.ts` 已实现（opentype.js→edge→face→extrude） | 无 | ✅ bezier→bspline | 9 |
| import（STL/STEP） | **BREP** | `importStl`/`importStep` 已暴露 | 无（DXF 需另评） | ✅（平面面/精确 BREP） | 7 |
| projection cut=true | **BREP** | `sectionPlane`/`halfSpace` 已暴露（返回**无序边**） | **P0 `ShapeAnalysis_FreeBounds`** | ✅ | 4 |
| projection cut=false | **BREP** | `projectEdges`（HLR）已暴露 | **P0 `FreeBounds` + 3D→2D 压平** | ✅（前提：用精确 HLR 边，非 wireframe 折线） | 同上 |
| surface | **BREP** | `bsplineSurface` **已暴露**（逼近 1e-3） | P1 `ZPoints` 插值构造 | ✅ | 1 |
| twist 挤出 | **BREP** | `makeHelixWireHanded` 已暴露 | 无 | ✅ | 4 |
| scale 挤出（等比） | **BREP** | `sweepFull` 的 `lawKind`（`Law_Linear`/`Law_S`）**已实现+已绑定** | 无 | ✅ | 同上 |
| scale 挤出（非等比） | **BREP** | `loft`（ThruSections） | **P0 `CheckCompatibility`** | ✅（`ruled=true` 更兼容） | 同上 |
| minkowski / fill | 保持 BLOCKED | OCCT 无原生精确解 | — | — | 0（语料未用） |

### 4.1 hull（shape）— BREP 直出

```
shapes → getSubShapes(id, "vertex") → vertexPosition(v) 逐点提取     [已暴露 :275, :325]
      → 合并点集 → quickHull(points, tol)                            [faijs 已有 hullGeometry.ts]
      → buildTriFace(a,b,c) × N                                      [已暴露 :243]
      → sewAndSolidify(faces, tol)                                   [已暴露 :240]
      → fixFaceOrientations → unifySameDomain → isValid              [已暴露 :460, :455, :456]
```

产物：每个面为**精确平面**的 BREP solid。`unifySameDomain` 合并共面相邻三角以降面数。

- 与现有 `convexHull` 的关系：现 `convexHull(points)`（`hullFns.ts:44` → `kernel.hullFromPoints`，
  底层即 QuickHull+`buildTriFace`+`sewAndSolidify`）已走通后半段；新增 `hull(shapes)` 只需补
  「shape → 顶点」前半段。**复用 `hullGeometry.ts`，不重复实现。**
- **风险红线**：顶点必须来自 `getSubShapes("vertex")`（精确）；
  若改用 `tessellate()` 取样，得到的是**网格的**凸包（圆柱侧面会外凸），精度不可控。

### 4.2 polyhedron — 逐面直构

```
每个 face 的点环 → makeWire(makeLineEdge 逐段) → makeFace(wire)      [已暴露 :232, :233]
（三角面快捷路径：buildTriFace）
faces[] → sewAndSolidify / buildSolidFromFaces(tol)                 [已暴露 :240, :241]
       → fixFaceOrientations → healSolid → unifySameDomain → isValid
```

**不走** mesh→STL→BREP 往返。风险：面朝向不一致（`fixFaceOrientations` 必做）、
非流形（`isValid` 后校验 solid 数）。

### 4.3 offset2d — 只差接线

```
profile(wire) → offsetWire2D(wire, delta, joinType)   // 实现 kernel.cpp:1070
                                                      // joinType: 0=Arc 1=Intersection 2=Tangent
             → makeFace(wire)                         [已暴露 :233]
             → 多环（带孔）：逐环偏置后 addHolesInFace  [已暴露 :235]
             → buildCurves3d / unifySameDomain（导出前烘焙 offset_curve_2d）
```

- OpenSCAD 语义映射：`r` → Arc join；`delta` → 直接距离；`chamfer` → `JoinType.Intersection` + 后处理。
- facade 当前仅暴露 Arc/Intersection/Tangent 三档；`chamfer` 严格语义可能需 P2 增强。
- **STEP 注意**：偏置结果可能保留为 `offset_curve_2d` 实体，部分下游 CAD 解析不稳 →
  导出前 `buildCurves3d` + `unifySameDomain` 烘焙为普通 B 样条。

### 4.4 text — 能力已存在于 faijs-extra

`packages/faijs-extra/src/ops/text.ts:101` 的 `text = defineOp({ mesh, brep })`，
BREP 路径 `textBrep`(:41) 走：

```
opentype.js 解析 TTF → PathCommand[]
   M/L → makeLineEdge；C → makeBezierEdge；Q → 升阶为 C（quadToCubic）
   y 翻转（opentype Y-down → OCCT Y-up）
 → makeWire → makeFace（OCCT 自识别内孔）→ extrude → translate
```

- **明确不走** OCCT 官方 `StdPrs_BRepFont`：它在 TKV3d/TKService，依赖 FreeType；
  occt-wasm 已排除 TKV3d/TKHLR/AIS（README Scope），且 `kernel.cpp:30-37` 的 `XcafApplication`
  注释明确说明刻意避开 TKV3d 链接。
- **faijs-openscad 侧动作**：`@faicad/faijs-extra` 从 optional peer 转为**必需依赖**并安装
  （当前 `node_modules/@faicad/` 下只有 `faijs`）。**这不是内核开发任务。**

### 4.5 import — 内核已有，缺 op 与分派修正

- `BrepEngineApi.importStl`（`primitives.ts:285`）已接线，occt 能力已声明（`adapters/occt.ts:130`）。
- **要改的点**：`faijs-extra/src/ops/load.ts:86` 的 `isCadFormat` 把 **stl 判到 mesh 路径**
  （`LOAD_EXTENSION_WHITELIST:240`），导致 STL 从不进 BREP 链。
  → STL 应可进 BREP（得到精确平面面 solid），而不是默认 mesh。
- 新增 op 参照 `api/import-step.ts`：
  `kernel.importStl(bytes)` → `fixShape` → `healSolid` → `fixFaceOrientations` → `unifySameDomain`
  → `fromBrep(shape, { solid, roleTable })`（复用 `:101-106` 的 `imported:<i>` 角色表写法）。
- DXF（2D 轮廓）需单独评估，不在本批。

### 4.6 projection cut=true — 剖切已有，缺"边→面"

```
sectionPlane(shape, origin, normal) → compound of edges（精确解析边）   [已暴露 :153]
   ↓ （当前缺失环节）
edges → 按环分组 → makeWire → makeFace → addHolesInFace（内环）
```

facade `sectionPlane` 文档明确 *"The edges keep their analytic geometry"*，但返回的是
**无序边集合**，OCCT 不负责连成 wire。

**缺失环节 = `ShapeAnalysis_FreeBounds`**（OCCT 源码
`src/ModelingAlgorithms/TKShHealing/ShapeAnalysis/ShapeAnalysis_FreeBounds.hxx`）：
`ConnectEdgesToWires`(:130) / `DispatchWires`(:207) / `SplitWires`(:197)。
这是唯一的 P0 阻塞项。

替代路径（无 P0 依赖，但语义不同）：
`halfSpace(origin, normal)`(:143) + `common(shape, halfspace)` → 得到被平面切出的**实体**，
可直接导出 STEP，但不是 2D 面。可作 cut=true 的过渡实现。

### 4.7 projection cut=false — HLR 已有，缺压平与连环

```
projectEdges(shape, origin, dir, xAxis) → ProjectionData{ visible/hidden × outline/smooth/sharp }
   [已暴露 :399，实现用 HLRBRep_Algo + HLRBRep_HLRToShape，kernel.cpp:4321]
   ↓ （缺失）
取 visible* 三组 → 压平到 Z=0 平面 → 连环成闭合 wire → makeFace
```

- 缺 ①3D→2D 压平（现有 `liftCurve2dToPlane`(:414) 是**反向** 2D→3D）；
  ②`ShapeAnalysis_FreeBounds` 连环。
- **精度红线**：必须基于**精确 HLR 边**重建；若改用 `wireframe()` 离散折线，
  STEP 中变为 polyline/折线近似，**不满足精确要求**。
- 风险：HLR 输出边无序、含悬空/重复边；投影含内孔时需区分外环/内环并反向。

### 4.8 twist / scale 挤出 — 走 OCCT 原生扫掠，不用切片堆叠

上一版的「切片堆叠法」与精确 STEP 目标冲突，**否决**。正确路径：

| 情形 | 路径 | 依据 |
|---|---|---|
| twist（含**负角**） | `makeHelixWireHanded(..., leftHanded)`(:230) 替换现有 `makeHelixWire`，再 `sweepPipeShell`(:189) | 当前 `sweepFns.ts:210-217` 报 `TWIST_NEGATIVE_ANGLE_UNSUPPORTED` 的唯一原因就是 `makeHelixWire` 无 handedness 参数 → **换一个已暴露调用即可解除** |
| 等比 scale 律 | **`sweepFull(..., lawKind=1\|2, lawLength, lawEndFactor)`**（:197-202；实现 `:3393-3403`） | **已实现+已绑定**，faijs 未接线 → **改用 `sweepFull` 即可** |
| 非等比（X/Y 分离） | `loft`/`loftWithVertices`(:185-186) 分段放样 | `SweepLaw` 仅 homothetic（等比）；需 **`CheckCompatibility`** 防扭绕 |
| 整体非均匀缩放 | `generalTransform`(:255, `gp_GTrsf`） | 已暴露；但解析面会转 `b_spline_surface`（丢语义），仅兜底 |

**当前报错的根因**：faijs `sweepFns.ts:141,179,244` 三处一律调用 `sweepPipeShell`
（`sweepPipeShell(profile, spine, freenet, smooth)`），该绑定**没有 law 参数**，
于是 `sweepFns.ts:221-228` 只能对非 `undefined` 的 profile 直接抛
`TWIST_EXTRUDE_LAW_UNSUPPORTED` / `COMPLEX_EXTRUDE_LAW_UNSUPPORTED`。
→ **不是 OCCT 不支持，是 faijs 调错了绑定。** 改调 `sweepFull` 即解除，无需改 wasm。

**已知语义差异（需 spike 先验证）**：OpenSCAD twist 是「截面边扫掠边旋转」，
OCCT `sweepPipeShell`+螺旋 auxiliary 是「沿螺旋线扫掠」。二者在「旋转量与抬升量成正比且同时发生」
时等价（螺旋 scan）。验证通过后方可定为主路径。

### 4.9 surface — 薄 op，非独立子项目

```
heightmap[row][col] → 控制点/高度网格
   → bsplineSurface(points, rows, cols)     [已暴露 :411；逼近 Tol3D=1e-3，非插值]
   → 成型：thicken(face, thickness, tol)     [已暴露 :353]
      或  face + 底面 + 4 侧面 → sewAndSolidify → fixFaceOrientations
```

- 若 1e-3 逼近容差可接受 → **直接用现有 `bsplineSurface`**，无需新增暴露。
- 若要严格插值语义（OpenSCAD 为双线性插值）→ 暴露 `GeomAPI_PointsToBSplineSurface`
  的 `ZPoints` 构造（OCCT 源码 `GeomAPI_PointsToBSplineSurface.hxx:141`，
  签名 `(const NCollection_Array2<double>& ZPoints, X0, dX, Y0, dY, ...)`，天然适配 heightmap）。
- **注意**：`thicken` 在曲率半径 < 厚度处自交失败；大起伏 heightmap 优先走「封底成实体」。

---

## 5. 需给 occt-wasm 新增暴露的清单（按优先级）

> 「新增暴露」= 改 `facade/include/occt_kernel.h` 声明 + `facade/generated/kernel.cpp` 实现 +
> `facade/generated/bindings.cpp` 绑定 + 重编 wasm（`cargo xtask build`）。

| # | 新增 | OCCT 源码依据 | 理由 | 服务 op | 成本 |
|---|---|---|---|---|---|
| **P0-1** | `connectEdgesToWires(edges, tol)` / `dispatchWires(wires)`（包 `ShapeAnalysis_FreeBounds`） | `TKShHealing/ShapeAnalysis/ShapeAnalysis_FreeBounds.hxx:130,207` | Section/HLR 均返回**无序边**，这是「边→闭合 wire→face」的唯一缺失环节 | projection (cut=true/false) | 新链接 + facade |
| **P0-2** | `flattenToPlane(shape, origin, normal)`（3D→2D 压平） | 与现有 `liftCurve2dToPlane`(:414) 成对 | 投影路径必需 | projection (cut=false) | facade |
| **P0-3** | `loftAdvanced(wires, {isSolid, ruled, checkCompatibility, maxDegree, parType, continuity})` | `BRepOffsetAPI_ThruSections.hxx:100`(CheckCompatibility), `:118`(SetMaxDegree), `:106`(SetParType), `:109`(SetContinuity), `:115`(SetCriteriumWeight), `:103`(SetSmoothing) | `CheckCompatibility` 是官方防扭绕开关，当前 facade `loft` **未调用** | twist/scale 挤出、loft | facade（类已链接，成本极低） |
| **P1-1** | `surfaceFromHeightmap(ZPoints, x0, dx, y0, dy, {interpolate})` + `getNurbsSurfaceData` | `GeomAPI_PointsToBSplineSurface.hxx:141,199,258,261`；曲面侧 NURBS 读取目前**完全缺失**（仅有曲线侧 `getNurbsCurveData`） | heightmap 的**插值**语义 | surface | 新链接 + facade |
| **P1-2** | `exportStep(id, options)`：单位 / AP203-214-242 / 精度 / 头段 | `Interface_Static` | STEP 导出可控性，直接影响 parity 比对与交付 | 全局 | facade |
| **P2-1** | `offsetWire2DAdvanced`：`SetApprox` / `Perform(offset, Alt)` / `IsOpenResult` | `BRepOffsetAPI_MakeOffset` | 复杂轮廓偏置稳定性、分层等高偏置 | offset2d (chamfer) | facade |
| **P2-2** | `sewingFreeEdges(shape)` / `setFloatingEdgesMode` | `BRepBuilderAPI_Sewing` | 开放 shell 排错 | polyhedron/hull 诊断 | facade |

**明确不做**：
- `StdPrs_BRepFont` / `Font_BRepFont`（text）— 需 TKV3d+TKService+FreeType，
  体积与许可成本高，而 faijs-extra 的 opentype.js 路径**已是可导出精确 STEP 的 BREP**。
- `BRepProj_Projection` — 只有圆柱/锥投影，无平行投影，且只出 wire。
- IGES — 已知不支持（TKDEIGES 未链接）。
- `BRepOffsetAPI_MakeEvolved` / `HLRBRep_PolyHLRToShape` — 非必需，暂缓。

---

## 6. Manifold 的准确定位

faijs 当前实际调用的 Manifold API 仅 9 个（`ofMesh`、`add/subtract/intersect`、
`splitByPlane`、`getMesh`、`isEmpty`、`levelSet`、`new Mesh`、`delete`），
端口面 `CsgBackend`（`cad-runtime/ports.ts:58-94`）只暴露 5 个方法。

### 6.1 只适合 Manifold（mesh-only，BREP 无精确解）

| 能力 | Manifold API | 理由 |
|---|---|---|
| SDF 等值面 | `Manifold.levelSet` | 本质是采样等值面，faijs 已标 mesh-only |
| 平滑/细分 | `smooth*`、`refine*` | 基于顶点属性通道 |
| 逐顶点变形 | `warp*` | 会破坏解析曲面 |
| minkowski 近似 | `minkowskiSum/Difference` | OCCT 无原生精确解；arg-spec 已 skip |

### 6.2 Manifold 有但**不应**用作主路径（BREP 更精确）

`CrossSection.offset/hull/2D布尔`、`Manifold.hull`、`Manifold.extrude/revolve`、
`split`、`trimByPlane` — 这些"能力存在且完全未接"，但对应的 BREP 路径均**已存在或只需薄封装**
（`offsetWire2D`、QuickHull+`buildTriFace`、`sweepWithLaw`、`sectionPlane`）。
按 §2 原则 1，一律走 BREP；Manifold 实现仅作为 `mode:'mesh'` 时的补充槽位。

### 6.3 纪律红线

- `backend-dispatch.ts:6`：*"禁止运行时 try-catch 回退。BREP 路径抛异常 = 设计缺陷或 bug，必须直接报错暴露。"*
- 新增 Manifold 适配**必须显式声明 `meshEngines`**（缺省 `['manifold']`），不得依赖回退。
- 能走 `capabilities`（L1 方法名）就不要写 `engines:['occt']`（后者在 brepkit 上会被直接拦）。
  参见 `brepkit-batchB-fix.test.ts:10-21`（convexHull 从 `engines` 降级为 `capabilities` 的完整理由）。

---

## 7. faijs 侧新增/改造 op 清单与改动面

### 7.1 两条落地路线

- **A 手写 op**（推荐；参照 `api/import-step.ts`）：
  新建 `packages/core/src/api/<op>.ts` → `api/index.ts` 加导出 →
  `api-namespace.ts` 的 `createApiNamespace()` 字面量加键 → 跑 `scripts/gen-symbol-table.ts`。
- **B 生成投影 op**（参照 `convexHull`）：
  `api/brep-mirror/<x>Fns.ts` 加 `<x>Brep` → `api/surface/arg-spec.ts` 登记 →
  跑 `scripts/gen-l3-surface.ts` → `scripts/gen-symbol-table.ts`。

三源一致性由 `packages/core/test/lang/op-set-consistency.test.ts` 自动钉死。

### 7.2 清单

| op | 路线 | 声明要点 | 前置 |
|---|---|---|---|
| `hull(shapes)` | A | `brep`；需顶点提取，建议 `engines:['occt']` 或新增 L1 `extractVertices` | 无 |
| `polyhedron(points,faces)` | B | `brep`；`capabilities:['buildTriFace','sewAndSolidify','fixShape']` | 无 |
| `offset2d(wire, delta, joinType)` | B | `brep`；需先在 L1 契约补 `offsetWire2D` | 无 |
| `text(...)` | 安装 faijs-extra | 已存在 | 无 |
| `importStl(bytes)` | A | 参照 `api/import-step.ts`；改 `load.ts` 的 stl 分派使其可进 BREP | 无 |
| `projection(shape,{cut})` | A | `engines:['occt']`（`projectEdges` 返回值需平台侧解释） | P0-1/P0-2 |
| `surface(heightmap)` | A | `engines:['occt']` | P1-1 |
| `twistExtrude` 改造 | 改 `sweepFns.ts` | 换 `makeHelixWireHanded` | 无 |
| `scaleExtrude` / `complexExtrude` 改造 | 改 `sweepFns.ts` | law 三件套接线；非等比走 `loftAdvanced` | P0-3 |

### 7.3 L1 契约扩展的成本警示

只有当 op 需要新的 L1 方法名时才需同步改：
`brep/engine/primitives.ts`（契约）+ `occt-kernel/occt-primitives.ts`（occt 实现）+
`brepkit-kernel/brepkitKernel.ts`（第二引擎实现，否则不可进 L1）+ `brep/engine/types.ts`
的 `BrepMethodKind` + `adapters/occt.ts:OCCT_METHOD_KINDS` + `adapters/brepkit.ts`。

**能走「原生面 + `engines:['occt']`」就不要扩 L1。** 守卫测试：
`phase3-native-access-guard.test.ts`、`engine-switch-declaration.test.ts`、
`capability-routing.test.ts`、`multi-engine-op-parity.test.ts`。

---

## 8. 实施计划

### 阶段 1 — 零 wasm 改动，立即开工（解锁 17 例）

无需重编 wasm，无外部依赖，可并行。

| ID | 任务 | 例数 | 验收 |
|---|---|---|---|
| K01 | `hull(shapes)`：顶点提取 + 复用 QuickHull + `buildTriFace`+`sewAndSolidify` | 3 | 3 例转 ported；STEP 为精确平面面；体积/质心与参照在容差内 |
| K02 | faijs-extra 转必需依赖，`text` 映射打通 + `--fonts-dir` 实现 | 9 | 9 例转 ported；STEP 含 `b_spline_curve_with_knots` |
| K03 | `importStl` op + 修正 `load.ts` 的 stl 分派使其进 BREP 链 | 7 | 7 例转 ported；导入结果为 solid 而非 mesh |
| K04 | `polyhedron` op（逐面直构） | 1 | 1 例转 ported；`isValid` 通过 |
| K05 | `offset2d` op（接线已暴露的 `offsetWire2D`） | 2 | 2 例转 ported；与 OpenSCAD r/delta 语义对齐 |
| K06 | `twistExtrude`/`complexExtrude` 改造：`makeHelixWireHanded` 解除负角 + 改调 `sweepFull(lawKind)` 支持缩放律 | 4（含 scale） | 不再报 `TWIST_NEGATIVE_ANGLE_UNSUPPORTED` / `*_LAW_UNSUPPORTED`；4 例 parity 通过 |

### 阶段 2 — occt-wasm P0 暴露 + 依赖它的 op（解锁 5 例）

| ID | 任务 | 例数 | 验收 |
|---|---|---|---|
| K07 | 新增 P0-1 `FreeBounds` + P0-2 压平，重编 wasm 并锁版本 | — | 单测：无序边 → 闭合 wire（含内孔区分） |
| K08 | `projection(cut:true)`：sectionPlane → 连环 → makeFace+addHolesInFace | 4（含 cut=false） | cut=true 例通过；STEP 为平面 face |
| K09 | `projection(cut:false)`：projectEdges(HLR) → 压平 → 连环 → makeFace | 同上 | cut=false 例通过；**禁止**用 `wireframe` 折线退化实现 |
| K10 | 新增 P0-3 `loftAdvanced`（CheckCompatibility），改造 `scaleExtrude`/非等比 scale | 4 | 非等比 scale 例通过；无扭绕 |

### 阶段 3 — P1 暴露 + 收尾

| ID | 任务 | 例数 | 验收 |
|---|---|---|---|
| K11 | 新增 P1-1 `surfaceFromHeightmap`，`surface` op | 1 | 1 例转 ported |
| K12 | P1-2 `exportStep(options)`：单位/精度可控 | — | parity 比对与交付 STEP 可控 |
| K13 | P2 增强（offset 稳定性、sewing 排错） | — | 诊断能力提升 |

### 阶段 4 — 明确保持 BLOCKED

`minkowski`、`fill`、`roof`（op 已存在但语义未对齐）、DXF import —
语料中 0 使用或无精确解，**不做静默近似**。

### 依赖顺序图

```
K01..K06（阶段1，无 wasm 依赖，可并行）
        ↓
K07（occt-wasm P0 暴露 + 重编）
        ↓
K08 / K09 / K10
        ↓
K11 / K12 / K13
```

---

## 9. 验收标准（精确 STEP）

每个新增 op 必须同时满足：

1. **产物是 BREP solid**：`getShapeType()==='solid'`，`isValid()===true`。
2. **STEP 可导出且精确**：`exportStep` 成功；平面/解析面正确；
   **不得**出现「经 `reconstructSolidFromMesh` 得到的分片平面面」这一 mesh 路径特征。
3. **几何指标对齐**：bbox / 体积 / 质心 / 实体数在容差内
   （linear 1e-4 mm、volume 相对 1e-4、boolean 差 1e-3 mm³，对齐 cq-compat-compare 口径）。
4. **不引入运行时回退**：违反 `backend-dispatch.ts:6` 红线的实现一律打回。
5. **诚实声明**：`OCCT_METHOD_KINDS` / `capabilities` 声明与实际调用一致，虚报打回
   （`adapters/occt.ts:48-58` 明确"声明=实现"）。
6. **回归锁**：`tests/examples-transpile.test.ts:138` 的 blocked 清单随每项落地而缩短；
   `op-set-consistency.test.ts`（三源一致）保持绿。

---

## 10. 关键源码位置索引（便于复核）

**occt-wasm（`C:/git/OpenCascade/occt-wasm`）**
- `facade/include/occt_kernel.h` — facade 契约面（515 行）
- `facade/generated/kernel.cpp` — 实现（`offsetWire2D`:1070、`bsplineSurface`:1996、`loft`:3125、`projectEdges`:4321）
- `facade/generated/bindings.cpp` — Embind 绑定（JS 可见面）
- `crate/src/kernel.rs`、`crate/src/kernel_generated.rs`
- `xtask/src/build.rs` — 构建（`cargo xtask build`）

**OCCT（`C:/git/OpenCascade/OCCT`，7.9.0）**
- `src/ModelingAlgorithms/TKShHealing/ShapeAnalysis/ShapeAnalysis_FreeBounds.hxx:130,197,207`
- `src/ModelingAlgorithms/TKGeomAlgo/GeomAPI/GeomAPI_PointsToBSplineSurface.hxx:141,199,258,261`
- `src/ModelingAlgorithms/TKOffset/BRepOffsetAPI/BRepOffsetAPI_ThruSections.hxx:100,103,106,109,115,118`
- `src/ModelingAlgorithms/TKOffset/BRepOffsetAPI/BRepOffsetAPI_MakeOffset.cxx`
- `src/ModelingAlgorithms/TKHLR/HLRBRep/`（HLR 投影）

**faijs（`C:/my/Faicad/faijs`）**
- `packages/core/src/define-op.ts:356`（`defineOp`）
- `packages/core/src/cad-runtime/backend-dispatch.ts:6,235`（红线与静态分派）
- `packages/core/src/brep/engine/primitives.ts`（L1 契约）、`adapters/occt.ts:48-58,110`
- `packages/core/src/occt-kernel/hullGeometry.ts`、`hullOps.ts`、`meshReconstruct.ts`
- `packages/core/src/api/brep-mirror/sweepFns.ts:168-228`（twist/complex extrude 现状）
- `packages/core/src/api/surface/arg-spec.ts:2019,2930,3508,3945-3957`（skip 登记）
- `packages/faijs-extra/src/ops/text.ts:41,101`、`load.ts:86,240`

**faijs-openscad（`C:/my/Faicad/faijs-openscad`）**
- `src/ir/capability.ts:64-80`（能力表）、`src/ir/lower.ts:457-469`（twist/scale 拦截）
- `src/runtime/hull.probe.test.ts`、`polyhedron.probe.test.ts`
- `src/ir/{projection,offset2d,twist-extrude,surface-fill,minkowski}.probe.test.ts`
- `tests/manifest.json`、`tests/examples-transpile.test.ts:138`
