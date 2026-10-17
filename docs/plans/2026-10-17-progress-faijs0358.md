# 2026-10-17 进度：faijs 0.35.8 升级 + 字体跨平台修复 + offset2d 调查

> 状态：ERROR 21 → 12（text 类全解锁），offset2d 确认为上游缺陷暂缓

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

**faijs-openscad ext 接线**：`loadDXF` 优先走 faijs `importDxf`（createRequire
动态加载，旧 faijs 无该模块时降级到 ext 旧解析器），公共尾段抽为 `facesFromWires`。

**验证**：诊断脚本 example013.dxf → lines=10、wires=1（此前 0 实体）；
example013 ERROR→**FAIL**（能执行出 wire，三个 DXF 拉伸体求交后仍 0 三角形——
面化/求交层还有缺口，待查）。

## 7. 剩余 ERROR（12 例）根因表

| 根因 | 数量 | 归属 |
|---|---|---|
| offset2d（上游缺陷） | 2 | occt-wasm |
| twistExtrude sweepFull | 2 | occt-wasm sweep |
| boolean subtract cut 失败 | 2 | 内核容差 |
| polyhedron wire 构造 | 1 | ext 可修 |
| DXF 解析 0 wire | 1 | ext 可修 |
| projectOutline makeFace | 1 | 待查 |
| revolve 构造（example007） | 1 | 待查 |
| applyMatrix | 1 | faijs |
| surface 数据文件缺失 | 2 | fixture，本仓可修 |
