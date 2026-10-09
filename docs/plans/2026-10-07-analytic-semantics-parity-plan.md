# faijs-openscad 建模语义修正与 parity 方案重写（M9）

> 日期：2026-10-07
> 本文**取代** `2026-10-06-progress-and-roadmap.md`（该文档彻底废弃，见 §1）。
> `2026-10-06-kernel-op-implementation-plan.md`（faijs 内核 op 实现方案，下称「内核方案」）
> **继续有效**，其 BREP 优先、精确 STEP 的全部结论纳入本文作为 op 实现基线（§4）。
> 本文不重复内核方案的内容，只做语义修正后的整体规划重写。

---

## 0. 需求原话（逐字，最原始内容）

> OpenSCAD 里 sphere($fn=24) 的建模语义， 我认为是：先建一个球，这才是建模的语义。然后导出stl的时候用fn=24导出三角化。

> 现在，写一份新的文档，报告目前的进度，以及规划后续的任务。我的目标是要50个examples全部转换成功，且stl对比完全一致。
>
> （2026-10-06 追加）所谓的完全一致，是在容差范围内的完全一致。具体你可以参考之前其他项目是如何比对的呀。比如../faijs/projects/cq-compat-compare
---

## 1. 语义修正（本文的地基）

### 1.1 正确的语义

| 层 | 语义 |
|---|---|
| **建模层** | `sphere(r)` / `cylinder(r1,r2,h)` / `circle(r)` 建的是**解析几何体**（真球、真圆柱、真圆）。`$fn`/`$fa`/`$fs` **不是**建模语义的一部分——它们不改变模型是什么 |
| **导出层** | `$fn`/`$fa`/`$fs` 只在**导出/预览三角化**时起作用：控制 STL 网格的分片密度。`$fn=24` = 用 24 段三角化导出 |

推论：**OpenSCAD 的几何本体始终是解析的；棱面只是导出时的视图。**

### 1.2 被否决的旧理解（错误记录，防止复发）

旧路线（`progress-and-roadmap.md` §4 T802、`faceted-geometry.ts`、`lower.ts` 的
FACETING_PRIMITIVES 路径）把「显式 `$fn>0`」理解为「建模产物就是棱面体」，
因此在 IR 层把 circle→正多边形 polygon2d、cylinder→正多边形拉伸，试图复刻棱面。
**该理解是错误的**：它把导出参数误当建模语义，结果是——

1. 建模语义被扭曲：真圆被换成了多边形，导出的 STEP 不再是解析圆/柱；
2. `$fn` 密度低时（如 `$fn=6`）转换出的模型与用户模型不是同一个东西；
3. parity 即使 PASS，也是「两个错误模型互相一致」，无意义。

### 1.3 由正确语义推出的三条铁律

1. **IR / BREP 保留解析几何**：转换器一律产出解析球/柱/圆（faijs `cad.sphere` 等），
   任何「按 `$fn` 建棱面」的 IR 降级路线**废弃**（涉及代码的回退见 §5，本文不改代码）。
2. **`$fn`/`$fa`/`$fs` 收进导出参数**：转换器把语料的特殊变量记录为**三角化参数**，
   在生成 cand.stl 时交给 faijs 的 tessellation（`solidToShape(kernel, solid, segments)`，
   segments ≙ 角偏转控制），使两边对**同一个解析几何**做**同等密度**的三角化。
3. **parity 比对的是「同一解析几何的两次三角化」**：OpenSCAD 导出与 faijs 导出。
   几何本体一致时，差异只来自三角化器（CGAL 分片 vs OCCT 线性偏转），
   通过对齐分片参数把差异压进容差；不再通过改变模型去迁就比对。

`lower.ts` 中已有政策注释「显式 `$fn` 不改变 analytic BREP，记 OSC3201」——这条**方向正确**；
错误的是同文件里对 cylinder/circle 的棱面复刻旁路（§1.2），两者自相矛盾，以本文为准修正。

---

## 2. 「progress-and-roadmap.md」废弃清单

该文档彻底废弃。其中内容去向：

| 原内容 | 去向 |
|---|---|
| §0 需求原话 | 逐字保留于本文 §0 |
| §1.1 五维判据（cq-compat-compare 对齐） | **继续有效**，判据不变（bbox 1e-4 / 体积 1e-4 / 质心 1e-4 / 实体数严格相等 / 布尔差 1e-3 mm³） |
| §2 当前进度事实（manifest 21/28/1、parity 5 PASS/12 FAIL/4 ERROR） | 事实数据继续有效；但「FAIL 主因 = OCCT vs CGAL 网格细分差异」的定性在 §3 重析 |
| §2.3 T802 faceted 结论 | **作废**（§1.2） |
| §3 差距分析、§4 M8 任务表 T800–T814 | 由本文 §5 的 M9 任务表取代；其中 op 能力部分以内核方案（K01–K13）为准 |
| §5.0 决策 D1–D4 | D1（容差口径）继续有效；D2（faceted 策略）**否决**；D3/D4 并入内核方案的落地路线 |

---

## 3. parity 失败根因重析（语义修正后）

M8 T803 实测：21 例中 5 PASS / 12 FAIL / 4 ERROR。旧的「细分差异」定性需要修正：

1. **旧路线的自我污染**：T802 已把部分例子的 circle/cylinder 换成了多边形近似，
   这些例子的 FAIL 本身就带着 §1.2 的语义错误（两边几何本体不同）。
   在回退 faceted 路线后，需要**重跑**才能得到干净基线。
2. **三角化参数未对齐**：cand.stl 由 faijs runtime 的 shape.positions 直接取三角，
   未按语料的 `$fn/$fa/$fs` 设置 segments/偏转；ref.stl 由 OpenSCAD 按 `$fn/$fa/$fs` 分片。
   同一解析几何 + 不同分片密度 → 体积/表面积系统性偏差。
   **这是语义修正后 parity 的主战场**：把分片参数从模型侧搬到导出侧。
3. **真正的几何 bug 仍然存在**：example023 bbox IoU=0.5、example004/functions 体积差 >6%——
   这类与三角化无关，是转换器/faijs op 层的几何错误，逐例定位。
4. **ERROR 两类不变**：空几何（roof/echo）无 `result`；2D union 不支持
   （faijs `cad.union` 拒绝 face 输入）→ 后者进内核方案的 2D 布尔议题。

---

## 4. op 能力实现：沿用内核方案

`2026-10-06-kernel-op-implementation-plan.md` 的全部技术结论继续有效，要点引用：

- **BREP 优先三判据**（其 §2）：能解析表达 → BREP；OCCT 有算法类 → BREP 补暴露；
  只有本质离散的才走 Manifold mesh。
- **阶段 1 K01–K06**（零 wasm 改动，解锁 17 例）：hull、text（faijs-extra 转必需依赖）、
  importStl、polyhedron、offset2d、twist/scale 扫掠改造。
- **阶段 2 K07–K10**（occt-wasm P0 暴露）：FreeBounds 连环、压平、loftAdvanced(CheckCompatibility)
  → projection / 非等比 scale。
- **阶段 3 K11–K13**：surface heightmap、exportStep 可控导出、P2 增强。
- **验收标准**（其 §9）：BREP solid + 精确 STEP + 五维指标对齐 + 无运行时回退 + 声明=实现。

与本文的关系：内核方案解决「**转换得了**」（29 个 blocked/skipped 例子的能力缺口）；
本文解决「**比对得过**」（语义正确 + 三角化对齐 + 逐例几何 bug）。两者并行推进，
最终在 M9 验收口汇合。

> 注意：内核方案 §4.2 polyhedron 走 BREP 直构的结论不受本文影响——OpenSCAD 的
> `polyhedron()` 节点本来就是用户显式给的顶点/面数据，逐面直构正是忠实转写。
> 本文否决的只是「把 sphere/cylinder 降级成 polyhedron」的路线。

---

## 5. M9 任务规划

### 阶段 A — 语义回正（本仓库，先行）

| ID | 任务 | 说明 | 验收 |
|---|---|---|---|
| A1 | 回退 faceted IR 旁路 | `faceted-geometry.ts` 的 circle→polygon2d、cylinder→多边形 extrude 降级路线移除；恢复解析路径；相关测试改写 | IR 对显式 `$fn` 的 sphere/cylinder/circle 一律产出解析几何；OSC3201 诊断保留 |
| A2 | `$fn/$fa/$fs` 采集进导出参数 | 转换器把语料特殊变量解析为三角化参数（segments/偏转），随 transpile 元数据输出；缺省按 OpenSCAD 默认 `$fa=12,$fs=2` 公式换算 | 每 ported 例的 cand.stl 三角化参数与 ref 侧可对齐 |
| A3 | parity runner 改造 | `run-parity.ts` 执行 `.fai.js` 后按 A2 参数调用 tessellation 再取三角；报告增加「三角化参数」列 | 21 例干净重跑，产出新基线报告 |
| A4 | 几何 bug 逐例定位 | example023（bbox IoU=0.5）、example004/functions（体积 >6%）优先；逐例出根因 | 每例给出转换器/op 层根因或修复 |

#### A4 调查结果（2026-10-07）

**example023（IoU=0.5）根因：faijs 运行时 `cad.applyMatrix` bug — 已修复**

- 现象：extruded polygon-with-hole 几何体经 `cad.applyMatrix` 施加 Z 轴旋转（如 60°）后，
  顶面（Z=5）三角形被错误地移动到 Z=10，导致 Z extent 从 [0,5] 变为 [0,10]。
- 矩阵第三行为 `[0, 0, 1, 0]`（纯 Z 旋转，z'=z），但 faijs 运行时对顶面 z 坐标
  做了 z'=2z 的错误变换。底面（Z=0）不受影响（0→0）。
- **这是 faijs 运行时 bug，非转换器 bug**。最小复现：单轮廓 polygon-with-hole →
  `cad.extrude` → `cad.applyMatrix(Z旋转60°)` → Z range 从 [0,5] 变为 [0,10]。
- 90° 旋转不受影响（轴对齐），仅非轴对齐旋转触发。
- 简单 square（单轮廓无孔）不受影响。
- **状态：✅ 已在 faijs 0.30.9 中修复**。重跑 parity 确认 example023 从 FAIL → PASS
  （volΔ=0.030364, IoU=1.000000）。

**Functions/functions（体积 >6%, 85198 vs 1558 tris）根因：三角化密度不匹配**

- 现象：cand 有 85198 个三角形，ref 仅 1558 个。语料包含 41 个 `sphere(r=1)` 和
  81 个 `cube(2, center=true)`，无显式 `$fn`（CSG dump 里 $fn=0, $fa=12, $fs=2）。
- OpenSCAD 对 `sphere(r=1)` 的默认分片：`max(5, min(ceil(360/12), ceil(2π*1/2)))` = 5 段。
- faijs 的 `solidToShape(kernel, solid, segments)` 接受**单一全局 segments** 值，
  无法复刻 OpenSCAD 的 per-primitive 半径感知分片计算。
- 旧策略用 refRadius=10 算出 segments=30 传给 `solidToShape`，导致 r=1 的小球
  被过度分片（30 段 vs OpenSCAD 的 5 段），三角形数膨胀 ~50 倍。
- **修正后策略**：当无显式 `$fn > 0` 时不传 segments（让 faijs 用默认三角化）。
  但 faijs 默认三角化密度仍高于 OpenSCAD 默认值（85198 vs 1558 tris），
  说明 faijs 默认分片密度本身需要标定——这是 faijs 侧的问题。
- **状态：已定位，待 faijs 侧标定默认三角化密度或支持 per-primitive segments**。
  → 排除项：详见 `2026-10-07-faijs-tessellation-density-proposal.md`。

**2D union ERROR（example017, list_comprehensions）— ✅ 已修复**

- 现象：faijs `cad.union` 拒绝 2D face 输入，报错
  `union: no solid input — wire/face/shell geometry cannot fuse`。
- 根因：CSG dump 中 2D `group()` 是隐式 union，转换器把它 lower 成 `IrUnion`
  （dimension='2d'），emitter 生成 `cad.union`，但 faijs `cad.union` 只接受 3D solid。
- **修复**：emitter 对 2D union 改用 `cad.fuse`（BREP 层布尔，支持 2D face 输入）。
  `cad.subtract` 和 `cad.intersect` 对 2D face 本身就能工作，无需修改。
- **parity 确认**：
  - example017 从 ERROR → FAIL（2D union 不再报错，几何正确生成，FAIL 是三角化密度差异）
  - list_comprehensions 从 ERROR → PASS-NT（执行成功，无 ref STL 可比对）
- **状态：✅ 已修复并经 parity 确认**。

**module_recursion ERROR（source too long）— 部分修复**

- 现象：生成的 `.fai.js` 源码 1,311,373 字节，超过 faijs 静态校验器 1,048,576 字节上限。
- 根因：parity runner 调用 `emitFaijs` 时未传 `compact: true`，CLI 的 auto-fallback
  逻辑没有在 parity runner 中生效。
- **修复**：parity runner 增加 auto-fallback：输出超过 1 MiB 时自动用 compact 模式重新生成。
- compact 模式通过 helper 函数（`__rect`/`__circle`）和单行矩阵压缩输出，
  使文件大小通过了 1 MiB 限制。
- **残留问题**：faijs 静态校验器还有 top-level statements 数量限制（5000），
  compact 后仍有 8189 条语句，超限。这需要进一步优化（如循环展开改写为 JS `for` 循环），
  或 faijs 侧放宽限制。
- **状态：部分修复（文件大小已解决，语句数限制待解决）**。

**Parametric/candleStand（IoU=0.036, volΔ=75%）根因：faijs union 丢弃几何**

- 现象：cand Z range [0, 3] vs ref [0, 53.5]，体积差 75%。cand 只有 682 tris vs
  ref 8064 tris。
- 调查：生成的 faijs 代码正确包含 `part0 = cad.cone(2, 1, 50)`（50mm 高锥体）、
  `part4`（cylinder at z=46.5）、`part79`（复杂 difference at z=46.5）、
  `part101`（7 个 box(25,3,3)），最终 `part102 = union(part0, part4, part79, part101)`。
  但执行后 `part102` 的 Z range 只有 [0, 3]——只有 `part101`（box, Z∈[0,3]）的几何
  保留，其余全部丢失。
- 最小复现：单独执行 `union(cone(2,1,50), cylinder(4,7)@z=46.5)` 时 Z range 正确
  （0-53.5），说明问题出在更复杂的 union 链中——某个中间 union/difference 产生了
  非流形结果，导致后续 `cad.union` 丢弃部分输入。
- cand 有 `boundaryEdges: 104`（非流形边），ref 有 0。
- **状态：已定位，待 faijs 侧修复 union 对非流形输入的鲁棒性**。

**其它 FAIL 例子（CSG.scad, example001/002/004/005/018/019/022）**

- 这些例子的 FAIL 主因是三角化密度不匹配（cand 三角形数显著多于 ref），
  属于 tessellation proposal 的排除项。
- 部分例子有 `boundaryEdges > 0`（CSG.scad=2, example005=1, example018=8,
  example022=8, candleStand=104），指示 faijs union/subtract 产生了非流形边——
  这可能也贡献了部分体积差异，但主因仍是密度差异。
- **状态：排除项，待 faijs 侧 tessellation 密度控制落地后重跑**。

### 阶段 B — 能力缺口（faijs 侧，= 内核方案阶段 1–3）

按内核方案 K01→K13 执行（不复制其内容），每项落地后本仓库侧动作：

| 内核任务 | 本仓库配套动作 |
|---|---|
| K01 hull / K04 polyhedron / K05 offset2d / K06 twist·scale | 解除 manifest 对应 blocked，更新能力表与 probe |
| K02 text / K03 importStl | 同上 + 外部资源盘点（text 字体目录、import 模型文件） |
| K07–K10 occt-wasm P0 | projection / 非等比 scale 例解锁 |
| K11–K13 | surface 例解锁；exportStep 参数供 parity 使用 |

2D union 不支持（2 例 ERROR）：**已修复** — emitter 对 2D union 改用 `cad.fuse`
（BREP 层布尔，支持 2D face 输入），`cad.subtract`/`cad.intersect` 本身兼容 2D face。

### 阶段 C — 全量收敛

| ID | 任务 | 验收 |
|---|---|---|
| C1 | 全量 parity 报告 | 50/50 ported 且五维指标在容差内（A 阶段口径） |
| C2 | 文档收尾 | README 能力矩阵、保真级别（解析 BREP + 导出三角化参数）、版本锁与实际一致，无虚假声明 |

### 实施顺序

```text
A1 → A2 → A3 → A4        （语义回正，纯本仓库，先行跑出干净基线）
  ↘ 与内核方案 K01–K06 并行（faijs 侧，无 wasm 改动）
      ↘ K07–K13
C1 → C2
```

### 风险

| 风险 | 应对 |
|---|---|
| 三角化参数对齐后仍超容差（CGAL 与 OCCT 分片算法本质不同） | 五维容差是用户拍板的口径，不放松；必要时按例核对分片公式，把 segments 换算做精确（如 `$fn` ↔ 线性/角偏转的映射实测标定） |
| 回退 faceted 后部分此前 PASS 的例子翻 FAIL | 如实重跑记录——之前 PASS 可能是「错误互相抵消」，新基线才可信 |
| OpenSCAD 对 `$fn=0` 的默认分片公式与 OCCT 偏转换算存在系统性偏差 | A2 中先做标定探针（单一球/柱，扫 `$fn` 值对比两边三角数与体积），再定换算公式 |

---

## 6. 验收终点（不变）

**50/50 examples 全部转换成功（0 blocked / 0 skipped），且 50/50 STL 对比在容差范围内完全一致**——
其中「一致」按 §1.3 的新语义达成：两边是**同一个解析几何模型**、各自按语料参数三角化、
五维指标全部进容差。禁止用「改变模型迁就比对」达成 PASS。

---

## 7. 实施状态（2026-10-09 更新）

### 已完成

| 任务 | 状态 | 说明 |
|---|---|---|
| faijs 版本升级 | ✅ | 0.30.9 → 0.31.1；`package.json` peerDep + devDep 同步更新 |
| A1 语义回正 | ✅ | sphere/cylinder/circle 一律产出解析几何；无 faceted 降级路线 |
| A2 tessellation 采集 | ✅ | `TessellationParams` 增加 `angularDeflection`（弧度）/ `linearDeflection`（mm）；`computeTessellation` 始终返回值（用 OpenSCAD 默认 $fa=12, $fs=2 兜底） |
| A3 parity runner 改造 | ✅ | `run-parity.ts` 改用 `createRuntime({ tessellation })` 设置全局三角化密度；移除 `solidToShape` 重三角化路径；per-example runtime 创建 |
| per-primitive segments 策略修正 | ✅ | `primitiveSegments` 仅在 `$fn > 0` 时返回 segments（per-primitive override）；`$fn=0` 时不传 segments，让全局 deflection 统一控制经纬两个方向 |
| A4 example023 applyMatrix bug | ✅ | faijs 0.30.9 已修复，parity PASS |
| A4 2D union ERROR | ✅ | emitter 对 2D union 改用 `cad.fuse` |
| angularDeflection 从 $fn 换算 | ✅ | 当有显式 `$fn` 时，`angularDeflection = 2π/fn`（而非 $fa 转弧度）；修复布尔后密度不足问题（logo.scad volΔ 从 196→20） |

### 新基线报告（22 ported examples，2026-10-09）

| 指标 | 旧基线 | 新基线 |
|---|---|---|
| PASS | 5 | 6 |
| PASS-NT | 1 | 1 |
| FAIL | 12 | 12 |
| ERROR | 4 | 3 |

> logo.scad 的 volΔ 从 196.6 (rel 1.05%) 改善至 20.2 (rel 0.11%)，
> 接近但未达 0.1% 容差。改善来自 `angularDeflection = 2π/100 = 0.063`
> 替代原来的 `0.209`（12°），使布尔后网格密度与 $fn=100 一致。
> candleStand.scad 的 `angularDeflection` 从 `0.009` 变为 `0.017`（2π/360）。

### 未解决项

1. **三角化密度匹配的固有局限（§6.1 拓扑差异）**
   - OpenSCAD `$fn=0, $fa=12, $fs=2` 对 `sphere(r=1)` 产出 5 段刻面体（26 tris, vol≈2.40）
   - faijs `cad.sphere(1*MM)` + 全局 `angularDeflection=0.209`（12°）产出 1796 tris, vol≈4.16
   - OCCT 的 `angularDeflection` 同时控制球面经纬两个方向，而 OpenSCAD 的 `$fa` 只控制经向，
     `$fs` 通过 `min(360/$fa, 2πr/$fs)` 起约束作用（对小球 $fs 胜出）
   - 全局 deflection 无法 per-primitive 自适应半径：大球需要更细的分片，小球需要更粗的分片
   - **需要进一步标定**：可能需要 per-primitive deflection（而非全局），或 OCCT 侧支持 `$fn` 语义的双方向 segments

2. **module_recursion（语句数超限）**
   - compact 模式后仍有 8189 条语句，超 faijs 5000 限制
   - 需要 faijs 侧放宽限制或进一步优化代码生成

3. **candleStand（IoU=0.036）**
   - faijs union 对非流形输入丢弃几何（已定位，待 faijs 侧修复）

4. **roof/echo（ERROR: no result）**
   - 空几何/纯 echo 脚本无 `result` 输出

### 结论

faijs 0.31.1 的 `CadRuntimeOptions.tessellation` 已正确集成到 parity runner。
per-primitive segments 仅在显式 `$fn > 0` 时生效（对应 OpenSCAD 的 per-primitive override 语义），
`$fn=0` 时由全局 deflection 控制三角化密度。
当有显式 `$fn` 时，全局 `angularDeflection` 从 `2π/fn` 换算（而非 $fa），
确保布尔后 solidToShape 的网格密度与 $fn 一致。

但 OCCT 的 deflection 模型与 OpenSCAD 的 `$fa/$fs` 分段公式存在系统性偏差：
- OCCT `angularDeflection` 控制球面所有方向的分片数，OpenSCAD `$fa` 只控制周向
- OCCT `linearDeflection` 是弦误差（chord error），OpenSCAD `$fs` 是弦长（chord length）
- 全局 deflection 无法 per-primitive 自适应不同半径

这导致低 `$fn` 球体的体积差异（faijs BREP 近似解析球 vs OpenSCAD 内接多面体）
超出容差，是 §6.1 所述拓扑差异的直接体现。
