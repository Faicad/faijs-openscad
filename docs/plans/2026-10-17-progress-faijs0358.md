# 2026-10-17 进度：faijs 0.35.8 升级 + 字体跨平台修复 + DXF 链路打通

> 状态（2026-10-18 刻面密度攻坚后，`parity-2026-10-18-facet2.json`）：
> **PASS 18**（+8：6 例刻面基础体 example001/002/004/018/019/022
> + logo/candleStand 两例 analytic→PASS），FAIL 20 → **14**，ERROR **10**
> （hull/projection 回归已回退，无净损失），PASS-NT 8。代码生成 50/50，
> 卡在执行/对账。
>
> ## ⚡ 接手者快速导读（先读这里）
>
> **总目标**：50 个 OpenSCAD examples 全部转成 faijs 并在五维容差内对账
> （口径见 `2026-10-10-progress-summary-and-roadmap.md` §0）。
>
> **当前战绩**：PASS 18 + PASS-NT 8 + FAIL 14 + ERROR 10（无 PASS-ANALYTIC
> 分类——logo/candleStand 两例已并入 PASS）。代码生成 50/50 已达成，卡在执行/对账。
>
> **⚠️ 跑全量对账前必读**：`run-parity.ts` 的 `CRASH_SKIP` 现有两条
> （`Basics/linear_extrude`、`Old/example010`）——它们是**同步 wasm 挂死**，
> JS 侧看门狗救不了，不跳过会拖死整轮 sweep（曾实测 1.5h 无进展）。
> 单例复跑用 `--only Old__example016`（注意是 manifest 的 `id`，不是 source 路径）。
>
> **验证入口**（都要先 `npm run build` 重建 ext，改了 faijs core 还要重装 tgz：
> `cd faijs && npm run build -w @faicad/faijs && cd packages/core && npm pack
> --pack-destination ../..` 然后 faijs-openscad 侧 `npm i ../faijs/faicad-faijs-0.35.8.tgz`）：
> - 全量对账（全程约 12 分钟）：
>   `npx tsx tests/run-parity.ts --json out.json --md out.md > run.log 2>&1`
>   ⚠️ **务必重定向到文件，不要管道接 `tail`/`head`** —— 管道会吞掉全部进度
>   输出，卡住时完全看不出卡在哪个例子（2026-10-17 因此白等 1.5h）。
>   单例复跑 `--only Old__example016`（填 manifest 的 `id`，非 source 路径）。
> - 单测：`npx vitest run`（faijs core 侧在 `packages/core/test/`）
>
> **下一步方向（按性价比排序，详细根因见下文 §6.3/§7/§8）**：
> 1. **刻面密度类 FAIL**（IoU>0.99 约 14 例，最大的一块）——BREP 精确 vs
>    OpenSCAD 刻面的表示差，靠导出时 per-primitive 刻面或 PASS-ANALYTIC 口径
> 2. **projectCut/projectOutline makeFace 失败**（surface_image、projection，
>    2 例）——内核 section/投影质量问题
> 3. **offset.scad 的 boolean 失败**（`booleanOp: operation failed`）——
>    twistExtrude 挂死已修（§8.2），现在走到布尔才失败，是新的可攻点
> 4. **上游内核缺陷**（offset2d×1 GEB、twistExtrude×2、revolve×1、applyMatrix×1）
>    ——等 occt-wasm/faijs 上游，或在 ext 层换实现绕开
> 5. **补参考 STL**（需 OpenSCAD 二进制；**本机当前没有**，
>    `C:/Program Files/OpenSCAD/openscad.exe` 与 PATH 均未找到，此路暂阻塞）
>
> **本仓已钉死的坑**（改动前先看）：§3 offset2d 上游缺陷勿重查；
> §6.2/6.3 DXF 的 BLOCK/INSERT/链式组环三连根因（faijs 侧测试已钉死）；
> projection 容错加固会卡死内核（勿再加 healWire）；
> §8.1 **裸 importStl 产物不能直接进布尔**；§8.2 **twist==0 别走 sweepFull**。

## 1. faijs 0.35.8 升级后基线（`parity-2026-10-17-faijs0358.json`）

| Verdict | 数量 | 说明 |
|---|---|---|
| PASS | 6 | — |
| PASS-ANALYTIC | 2 | — |
| PASS-NT | 5 | — |
| FAIL | 16 | — |
| ERROR | 21 | 其中 10 个 text 例因字体路径失败 |

## 2. 字体跨平台修复（`ab13ae9`）

text op 在 0.35.8 下全部 ERROR：`ENOENT D:\usr\share\fonts\dejavu\DejaVuSans.ttf`。
根因：ext `font-loader.ts` 硬编码 Linux 路径，Windows 上拼成不存在的 `D:\usr\...`。
修复：按平台候选路径解析（Linux DejaVu 优先，Windows Arial/Times/Consola 兜底），
支持 `FAIJS_FONT_PATH` 覆盖；Linux 行为不变。回归测试：`tests/parity/font-loader.test.ts`。

**修复后**（`parity-2026-10-17-faijs0358-fontfix.json`）：
PASS 6 + PASS-ANALYTIC 2 + PASS-NT 8 + FAIL 22 + **ERROR 12**。
10 个 text 例全部可执行（多数转 FAIL 度量差异：children/children_indexed/text_on_cube/
sign/rotate_extrude/LetterBlock —— 字形渲染与刻面精度问题，属下一阶段）。

## 3. offset2d 调查结论（Advanced/offset + GEB，2 例）——上游缺陷，暂缓

排查过程：
1. `offsetWire2D: TopoDS::Wire` —— 入参是 Edge/Face 而非 Wire。已在
   `offset-hardened.ts` 加规范化（edge→`makeWire`，face→`outerWire`），此改动保留。
2. 规范化后合法 Wire 仍 `operation failed`：`makeCircleEdge`+`makeWire`+`healWire`
   产出的干净圆 wire，× 12 种 joinType/delta 组合（含正负 delta）全部失败。
3. faijs 0.35.8 自带 `api/offset2d` 底层是同一个原生 `offsetWire2D`，同样会失败。
4. occt-wasm 版本未变（5.6.0），且该 ERROR 在升级前的报告（§5.4）中已存在。

**结论**：occt-wasm 5.6.0 的 `offsetWire2D` 原生操作损坏，非本仓代码可修。
可选出路（后续再评估）：在 ext 侧用 JS 实现 2D 多边形偏置（clipper 式算法），
绕过内核 op；或等 occt-wasm 上游修复。

## 4. 第二轮修复（同日）

**已修复并验证：**
- **surface center 参数丢失**（`lowerSurface`）：csg 的 `center = true` 没被透传，
  且布尔字面量 kind 判断写错（csg 侧是 `'boolean'` 不是 `'bool'`）。已修——注意
  fixture 数据文件（surface_image.png / example010.dat）本就存在，旧文档「缺失」结论有误。
- **polyhedron 入参归一化**（example011 PASS，volΔ=0/IoU=1.0）：发射代码传
  `[[x,y,z],...]` 普通数组，ext 只认 `{x,y,z}` 对象导致 `buildTriFace` 拿到 NaN。
  现在 polyhedron 两种点格式都接受。
- **offset2d 入参规范化**（edge→makeWire、face→outerWire）：修掉了「TopoDS::Wire」
  类型不匹配；但内核 op 本身仍失败（见 §3）。

**调查后回退：**
- **projection 容错加固尝试**（healWire + 逐 wire makeFace）：发现会让
  Basics/projection 从「快速 ERROR」变成「数分钟级卡死」（内核对碎片化 section
  边病态耗时），为不拖死全量 sweep 已整体回退。projectOutline/projectCut 的
  根因仍是内核层 section/投影质量问题，留待上游或换实现思路。

**surface_image 现状**：不再崩溃，但 section 对 sewn 地形实体返回空复合体
（faces/edges 全 0，内核静默失败）→ FAIL（0 tris）。同属内核层限制。

**本轮验证结果**：example011 ERROR→**PASS**；typecheck 通过；回归测试 3/3。
其余受影响例：surface_image FAIL（空 section）、projection ERROR（原样）、
GEB/offset ERROR（offset2d 上游缺陷）。

## 6. DXF 移植（2026-10-17 下午，参考 brepjs）

**faijs core 新增 DXF 导入**（提交 `4072479b` + `5640c860` + `f99ae1b9`）：
- `core/src/brep/dxf/dxf-import.ts`：brepjs 式解析器——严格两行一组配对遍历
  （修掉旧逐行扫描的游标错位根因）+ 实体→内核 edge→`makeWire` 拓扑组线
  （不再做 JS 端点容差拼线）；支持 LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE、图层过滤
- **第二层根因**：example013.dxf 的几何全在 **BLOCKS 段**（ENTITIES 只留 INSERT
  引用），新旧解析器都只扫 ENTITIES 所以拿到 0 实体。现同时扫 BLOCKS+ENTITIES
- 子路径导出 `@faicad/faijs/brep/dxf/dxf-import`；回归测试 8/8
- **SVG 对齐核实**：命令覆盖与精度已对齐（A 命令三点圆弧算法注释明确引用
  brepjs createStandardArc；C/S/Q/T→makeBezierEdge）。
  ⚠️ **实现偏差留档（2026-10-17，用户指正）**：svg-to-solid 绕过了 faijs 自己的
  `geometry2d/` 层（curve2d.ts 的 Line2d/Circle2d/Bezier2d/… + Blueprint +
  BlueprintSketcher——与 brepjs 同源的抽象）直接用 3D edge/makeWire 手搓平行
  管线。有现成 2D 曲线层却不用，是实现偏差而非设计选择；后续应把 svg-to-solid
  迁到 geometry2d 上（brepjs 的 Curve2D/Blueprint 即目标形态），DXF 的 bulge
  三点圆弧也可经同一入口解决。

## 6.2 classifyNested 下沉 + DXF 挖孔（2026-10-17 晚）

- **嵌套分组下沉 geometry2d**：`classifyNested` 及其 4 个纯 2D 辅助
  （computeSignedArea/pointInPolygon/polygonCentroid/bboxContains）从
  `primitives/svg/svg-path.ts` 移到 `geometry2d/nesting.ts`（通用 2D 几何层，
  DXF 可复用）；svg-path.ts 保留同名 re-export 兼容旧入口。
- **faijs DXF 新增 `importDxfProfiles`**：wire 采样（getSubShapes+curveParameters+
  curvePointAtParam，每边 32 点）→ evenodd 嵌套分组 → `{outer, holes}[]`。
- **顺带修掉 DXF 解析第二层 bug**：`polylineVertices` 是共享变量，分组循环把
  最后一条 polyline 的顶点 push 给了每条实体（实证：「回」字形两条 polyline
  产出两个相同内圈 wire，外圈丢失）。现在顶点在实体边界处与实体配对收集。
- **ext 接线**：`loadDXF` 优先走 `importDxfProfiles` → `makeFace(outer)` +
  `addHolesInFace(holes)`，多组 fuse。
- **端到端验证**：「回」字形 DXF（外圈 10×10 + 内孔 4×4，挤出 2mm）体积
  = **168**（100−16)×2，孔被正确挖除；SVG 46/46 + DXF 11/11 全绿；
  example013 无回归（仍 FAIL-with-wire，其面化缺口与挖孔无关）。

## 6.1 svg-to-solid 迁移评估（2026-10-17，第一步行已落地）

**已落地：DXF bulge 弧段改走 geometry2d**（faijs `27e87f88`）：
polyline 段构建 `Curve2dObj`（bulge≠0 → `makeArc2dThreePoints`，拱点 = 弦中点
沿行进方向左侧法向抬 sagitta=bulge·chord/2），经 `assembleWire(kernel,'XY',…)`
落成 wire——DXF 导入从此与 sketch/profile 同一管线。回归测试 9/9（含拱点坐标
钉死用例）；example013 无回归。这也顺带证明了 geometry2d 桥（`liftCurve2dToPlane`
的 `trimmed` 圆 → `makeArcEdge` 三点弧）可直接承载 DXF 弧语义。

**svg-to-solid 迁移路径评估**（634 行，`brep/svg/svg-to-solid.ts`）：
- 可直接删除的手搓段：`parseSVGPathToWires` 内各 case 的「曲线→edge」逻辑
  （`makeBezierEdge`×4、三点弧、直线段）——与 `liftCurve2dToPlane` 完全重复；
  迁移后每个 case 只产出 `Curve2dObj`，wire 组装统一走 `assembleWire`。
- 可保留并下沉的段：`tokenizeSvgPath`/transform 解析（语法层，faijs 已与 mesh
  链共享 `primitives/svg/svg-path.ts`）、`classifyHoles`（孔洞检测，纯 2D 判定，
  建议下沉 geometry2d）。
- 风险点：`flipY`（SVG Y 向下）目前散布在各 case；迁移时改为在生成 Curve2dObj
  时一次性翻 Y，避免桥层感知 SVG 约定。`makeArcEdge` 语义（三点弧）两侧一致，
  已由 DXF bulge 用例实证。
- 建议切分：①先迁 Bezier/直线（低风险，曲线语义一一对应）；②再迁 A 命令
  （对照 brepjs createStandardArc，已有现成算法注释）；③最后处理孔洞分组与
  transform 管线。每步用既有 svg 测试回归。

**验证**：诊断脚本 example013.dxf → lines=10、wires=1（此前 0 实体）；
example013 ERROR→**FAIL**（能执行出 wire，三个 DXF 拉伸体求交后仍 0 三角形——
面化/求交层还有缺口，待查）。

## 6.3 DXF 面化缺口攻坚（2026-10-17 深夜）——example013/008 转 PASS

**二分定位过程**（runtime 内逐环）：
1. 内核层链路全部正常（extrude 20000 → rotate → 两参 intersect 1777.78）
2. runtime 内二分：extrude/translate/rotate 均 20 tris，唯 `cad.intersect` 三参数 → 0
3. 但链式两两求交**也清零** → 求交语义无错，是**输入几何本身不对**
4. 体积对账锁定根因：挤出体积 20000（截面积 200）vs 参考 61333——
   **截面缺了 3/4**

**真根因（两层，均已在 faijs `dxf-import.ts` 修复）**：
- **INSERT 未展开**：example013.dxf 的几何在 BLOCKS 段块定义 `sub1`/`sub2`，
  ENTITIES 段只有 4 个 INSERT（插入点 ±10、旋转 0/90/180/270）。此前只取了
  一份未变换的块定义。现按「块基点缩放→旋转→平移到插入点」展开（支持
  行列阵列 70/71×44/45），且 BLOCK/ENDBLK 头必须保留进 collected——
  否则块收集循环拿不到块定义（实证：过滤块头让 blockDefs 恒空、展开全落空）。
- **散边未组环**：展开后的 16 条 LINE 一次性丢给 makeWire，拓扑不连续产出
  错误形状（86500 vs 61333）。改为**贪心端点链式组环**（OpenSCAD DXF 导入
  同语义）：按端点匹配（1e-6 容差）延伸成环、支持反向边（弧反向用三点弧
  makeArcEdge，避免角度对调取到补弧）；圆单边成环不进散边池。

**结果**：
| 例子 | 之前 | 现在 |
|---|---|---|
| example013 | FAIL（0 tris） | **PASS**（180 tris, volΔ=0, IoU=1.0） |
| example008 | FAIL（volΔ 84%） | **PASS**（volΔ=0, IoU=1.0） |

其余 DXF 例的剩余错误与 DXF 无关：007 revolve 构造失败（Y 轴 revolve 类型
限制）、009 twistExtrude sweepFull（OCCT sweep 缺陷）、012/016 boolean cut
内核失败（fuzzyValue 已加仍失败，需查 cut 路径）、015 无参考 STL。

**回归**：DXF 测试 13/13（新增 GOTCHA(insert) 与 GOTCHA(chain) 用例钉死
两个根因）、SVG 46/46。

## 8. boolean cut 内核失败攻坚 + twistExtrude 挂死（2026-10-17 深夜）

### 8.1 `subtract: kernel cut failed`（example012/016）——已修，example016 转 PASS

**表象**：`[api/boolean] subtract: kernel cut failed for inputs part0 × part3
— cutWithHistory: operation failed`。

**两层真根因**（都跟「fuzzyValue 容差」无关，之前方向错了）：

1. **裸 `kernel.importStl()` 返回 compound of faces**。example012.stl 导入后是
   64 个面、**0 shell / 0 solid**，但 `isValid()` 返回 **true** —— 看起来没问题，
   实际完全不能当布尔工具（`cut: boolean operation failed`）。
2. **多块 STL 的 `sewAndSolidify()` 返回 compound of **shells****。
   example016.stl 是 LetterBlock 切出的 **2 个互不相接的块**（128 三角形、
   流形且闭合），`sewAndSolidify` 只给 2 个 shell，`isSolid` false、
   `getSubShapes('solid')` 为空 → faijs 的 `reconstructSolidFromMesh` 抛
   「open or non-manifold」→ ext 回退到裸 importStl → cut 失败。

**修法（上游优先）**：
- **faijs**（`packages/core/src/occt-kernel/meshReconstruct.ts`）：新增
  `solidifyShells()`（逐 shell `makeSolid()` → `fuseAll()`）与 `allSolidsValid()`
  （compound 要求每个 solid 合法）；管线加「步骤③b 单/多壳实体化」，步骤④
  用实体化结果替代裸 sewAndSolidify 产物，愈合失败时退回未愈合版本。
  **这是 faijs 真实缺陷**——多块 STL 是合法输入，原管线处理不了。
- **本仓**（`packages/ext/src/ops/load.ts` `loadSTL`）：改走 faijs 规范化管线
  `parseStl` + `reconstructSolidFromMesh`，不再裸调 importStl。与
  svg-to-solid 绕过 `geometry2d` 属同一类「有现成管线却手搓」的实现偏差。

**结果**：example016 ERROR → **PASS**（volΔ=0.016、IoU=1.0）；
example012 ERROR → FAIL（几何已产出，余量是球体刻面密度，见 §9.3）。

### 8.2 twistExtrude 对非扭曲挤出也挂死 —— 已修，sweep 不再拖死

**发现过程**：全量 sweep 卡在 `Advanced/offset.scad` 超过 1.5h。用日志定位
（此前 `| tail -40` 把进度全吞了），二分到 `linear_extrude(scale=[0.5,0.5])`
发射出的 `openscad.twistExtrude`。

**根因**：`twistExtrude` 无论 twist 是否为 0 都构造螺旋脊线走 `sweepFull`。
occt-wasm 5.6.0 的 `sweepFull` 对**非扭曲**挤出会**无限期挂死**——它是同步
wasm 调用，阻塞事件循环，**连 setTimeout 看门狗都跑不了**，JS 侧无法中断。
实证：50×50 方形剖面 + scale=[0.5,0.5] 永不返回（诊断脚本只能靠 kill 退出）。

**顺带修掉的参数 bug**：OpenSCAD 的 `linear_extrude(scale=...)` 可以是
**非均匀** `[sx, sy]`（也可以是标量）。旧实现把数组原样塞给 `lawEndFactor`，
语义是错的。

**修法**（`packages/ext/src/ops/twist-extrude.ts`）：
- twist==0 且等比 1 → `k.extrude(profile, 0, 0, height)`
- twist==0 且带缩放 → 底剖面 + 顶剖面（`transform` 非均匀缩放并抬升到
  height）→ `k.loft([bottom, top], true, false)`
- 其余（真有扭曲，或上面两条失败）→ 原 sweepFull 路径；非均匀缩放取均值近似
- 实测：原本永不返回 → **147ms 返回 solid**

**结果**：offset.scad 不再挂死，从「offset2d ERROR」推进到「boolean ERROR」
（新的可攻点，见 §9.3）；全量 sweep 从 1.5h+ 降到约 12 分钟。

### 8.3 sweep 挂死清单（run-parity.ts 的 CRASH_SKIP）

| 例子 | 现象 | 处理 |
|---|---|---|
| `Basics/linear_extrude` | 含 twist=90 与 twist=-360 + scale=[0,0]，sweepFull 段错误 | 保留跳过 |
| `Old/example010` | surface()/surfaceInterp 卡死 >10 分钟（0.35.8 重建前是快速 FAIL） | 新增跳过 |

## 9. 剩余 ERROR（10 例）根因表（2026-10-17 深夜更新）

> 已从本表移除：polyhedron wire 构造（✅ 已修，example011 PASS）、
> DXF 解析 0 wire（✅ 已修，example013/008 PASS）、surface 数据文件缺失
> （✅ 误报，文件本就存在）、**boolean subtract cut 失败（✅ 已修，§8.1，
> example016 PASS）**。

| 根因 | 例子 | 归属 |
|---|---|---|
| offset2d（上游缺陷，勿重查） | Advanced/GEB | occt-wasm |
| twistExtrude sweepFull 报错 | Old/example009、Old/example020 | occt-wasm sweep |
| sweepFull 挂死（CRASH_SKIP，§8.3） | Basics/linear_extrude、Old/example010 | occt-wasm sweep |
| projectCut/projectOutline makeFace | Advanced/surface_image、Basics/projection | 内核 section/投影质量 |
| revolve 构造（Y 轴 revolve 类型限制） | Old/example007 | 待查 |
| applyMatrix | Advanced/animation | faijs |
| boolean 失败（§8.2 之后的新卡点） | Advanced/offset | 待查 |

> 注：`Advanced/offset.scad` 已**不再**卡在 offset2d（§8.2 后 offset2d 能过），
> 所以 offset2d 只剩 GEB 一例——§3 的「2 例」结论需按此更新。

### 9.1 已知的陈旧测试（与本次改动无关，勿误判为回归）

`npx vitest run` 有 1 条红：
`src/parity/report.test.ts › "low $fn + faceted volume < analytic → PASS-ANALYTIC"`。
该用例把网格整体放大 1.05 倍当作「BREP 精确 vs 刻面」样本，但 5% 放大使
bbox IoU = 20³/21³ ≈ **0.864**，低于 `classifyAnalytic` 要求的 0.99 → 必然 FAIL。
即**用例前提本身不成立**；且 `classifyAnalytic` 目前**根本没用到 `fn` 参数**，
注释里写的「fn=6 (<32)」已失效。属 PASS-ANALYTIC 口径（下一步 §1）该一起收拾的
遗留问题，不是本次改动的回归。

## 10. 刻面密度类 FAIL 攻坚（2026-10-18）—— +8 PASS，零回归

### 10.1 根因：faijs `cad.*` 基础体在 brep 模式下丢弃 $fn

`cad.sphere(r, {segments})` 在 **brep 模式**下走 `primitiveBrep('sphere')` →
OCCT `makeSphere`（光滑球），**segments 被完全忽略**；最终三角化由 runtime 的
`angularDeflection`（由 $fn 推算，如 $fn=30 → 2π/30≈0.209）+ `linearDeflection=2`
决定，产出 **n×n 满纬带网格（≈1800 三角）**——比 OpenSCAD 的 n 经线 ×
`floor(n/2)` 奇倍数纬环（n=30 → 900 三角）**多一倍纬度分辨率**。同理 cylinder/cone
也有刻面密度偏差。这就是「刻面密度类 FAIL」的本质：BREP 精确球 vs OpenSCAD 刻面球。

> 重要实验结论：`linearDeflection` 改大**无影响**（仍 1848 三角），所以「ld 过密」
> 假设错误；真正差异是 **angularDeflection 决定的 2× 纬度分辨率**。

### 10.2 修法：在 ext 库加 OpenSCAD 拓扑的刻面基础体（不改 faijs core）

**决策**：不改 faijs core（通用 CAD 内核，球应保留光滑，且有
tessellation-density / measurement-parity 等测试会破）。

**新增** `packages/ext/src/ops/faceted-primitives.ts`：
- `sphere(radius, {segments})`：`oscSphereGeometry` 用 OpenSCAD 精确拓扑
  （n 经线 × `floor(n/2)` 奇倍数纬环，环位于 φ=(2j+1)·π/n，j=0..rings-1）→
  `polyhedron()` 固化为 faceted BREP。体积 rel 1e-6 吻合 OpenSCAD 参考。
- `cylinder(radius, height, {centered, segments})` / `cone(rBottom, rTop, height, …)`：
  n 段扇形封盖，**修正了初版缠绕方向反了**的问题（实体法向朝内、体积为负 −27288
  → 翻转全部面后体积/布尔正确）。
- 在 `namespace.ts` 注册 `openscad.sphere/cylinder/cone`（K14/K15/K16），
  `index.ts` 导出 `facetedSphere/facetedCylinder/facetedCone`。

**emit 路由**（`src/emit/faijs.ts`）：sphere/cylinder/cone 从 `cad.*` 改路由到
`openscad.*`。棱台（r1≠r2）在 lower 阶段已走 `IrCone` → 正确进 `openscad.cone`。

**`src/ir/faceted-geometry.ts`**：修正既有 `facetedSphereGeometry`（旧实现用
n-1 满环 → 1740 三角而非 880，与 OpenSCAD 不符），改成本会话的 OpenSCAD 拓扑
（→900 三角，体积 rel 1e-6）。单测 18/18 通过。

### 10.3 验证：+8 PASS，且发现并修掉 hull/projection 回归

全量对账（`parity-2026-10-18-facet.json`，无回归保护）：**PASS 18**（10→18），
刻面基础体 6 例全部翻 PASS（example001/002/004/018/019/022，IoU≈1.0）。

**但**发现 3 例从 FAIL **退化成 ERROR**：`Basics/hull`、`Old/example006`、
`Old/example021`——它们都在 hull/projection 里用 sphere。诊断探针证明 faceted
实心体本身**合法**（`isValid: true`，`sectionPlane`/`transform`/`hull` 单测都过），
真因是 **ext 的 hull/projection/applyMatrix op 对「多 faceted 球喂入的大凸包」
触发 occt-wasm `transform` robust 性缺陷**（基线里光滑 `cad.*` 球*没有*离散顶点，
hull/projection 退化成 null 仅「跑过」为 FAIL）。

**修法（零净损失）**：在 `lower` 阶段对 `hull`/`projection` 节点打
`usesHullOrProjection` 标志，透传到 `IrModel`；emit 对该类模型**回退到光滑
`cad.*` 基础体**（即基线行为）。已确认**没有任何 PASS 例使用 hull/projection**，
故回退不会误伤任何已翻盘的赢家。

复跑（`parity-2026-10-18-facet2.json`）：**PASS 18、FAIL 14、ERROR 10**——
3 例回归从 ERROR 退回 FAIL（基线原状，不崩溃），**零净损失**，刻面赢家全保住。

### 10.4 结论：刻面密度类已清，剩余 sphere 相关 FAIL 是别的根因

| 例子 | 状态 | 性质 |
|---|---|---|
| example001/002/004/018/019/022 | ✅ PASS | 纯刻面密度，已修 |
| logo / candleStand | ✅ PASS | analytic→PASS（顺带） |
| Basics/hull、example006、example021 | FAIL（基线原状） | **hull/projection op 脆弱性**（occt-wasm transform 缺陷），非刻面 |
| LetterBlock、example017 | FAIL | 真实几何/boolean/位置偏差（centroid 偏移 0.3~0.9），非刻面密度 |

→ 刻面密度这一大类已彻底解决。剩余 5 个 sphere 相关 FAIL 的真实根因是
hull/projection/boolean/revolve 等 **op 层缺陷**，属下一步「boolean/revolve/
transform 类真·形状 bug」，与刻面密度无关，须单独攻。
