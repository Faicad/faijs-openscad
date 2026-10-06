# faijs-openscad 进度报告与后续任务规划（M6 之后）

> 日期：2026-10-06
> 前置文档：`docs/plans/2026-10-05-faijs-openscad-development-plan.md`（总计划，本文件不重复其背景）
> 事实基线：本仓库当前源码、`tests/manifest.json`、M0–M6 各里程碑门禁实测结果（2026-10-06）。

---

## 0. 需求原文（逐字）

> 现在，写一份新的文档，报告目前的进度，以及规划后续的任务。我的目标是要50个examples全部转换成功，且stl对比完全一致。
>
> （2026-10-06 追加）所谓的完全一致，是在容差范围内的完全一致。具体你可以参考之前其他项目是如何比对的呀。比如../faijs/projects/cq-compat-compare, 然后更新方案

以下所有规划均以该目标为验收终点。

---

## 1. 目标重述与验收口径

用户目标：**50 个 OpenSCAD 官方 examples 全部转换成功，且 STL 对比完全一致。**

拆解为两个硬指标：

| 指标 | 当前定义（计划文档口径） | 需要收敛到的口径 |
|---|---|---|
| 转换成功 | manifest 中 `status = ported`（能解析 + 发射 + faijs check 通过） | 50/50 全部 `ported`，0 blocked、0 skipped |
| STL 完全一致 | M4 parity 框架：指标比较 + 双向 Hausdorff 采样距离 | **容差范围内的完全一致**，比对方法对齐 `@faicad/cq-compat-compare`（见 §1.1），每例达到严格 PASS，不得用 PASS-ANALYTIC 替代 |

### 1.1 「完全一致」的精确定义（对齐 cq-compat-compare）

> 参考：`../faijs/packages/cq-compat-compare/src/step-compare.ts`（`@faicad/cq-compat-compare`）。
> 该项目比对两个 STEP 文件的 BREP 几何，五维指标全部通过才判 `equivalent`：

| 维度 | 指标 | 默认容差 |
|---|---|---|
| 1. 包围盒 | bbox 六面坐标最大差 | 1e-4 mm |
| 2. 体积 | 相对差 | 1e-4（0.01%） |
| 3. 质心 | 坐标最大差 | 1e-4 mm |
| 4. 拓扑 | face/edge/vertex/solid 数量 | 严格相等（可按形状放宽到 solid 数） |
| 5. 布尔差 | A−B 与 B−A 体积 | 1e-3 mm³ |

本项目沿用这一口径。**比对物就是两份 STL，直接比对**：

1. `ref.stl` = OpenSCAD 对 `.scad` 渲染导出的 STL；
2. `cand.stl` = faijs 执行生成的 `.fai.js` 直接导出的 STL。

不经过 mesh→BREP 重建等中间变换，两份 STL 直接进入指标比对。**cq-compat-compare 只是
「几何一致性该怎么判」的参考**——借鉴它的指标与容差（见下表），应用到 STL 网格上：

| 维度 | 指标 | 默认容差 |
|---|---|---|
| 1. 包围盒 | bbox 六面坐标最大差 | 1e-4 mm |
| 2. 体积 | 相对差 | 1e-4（0.01%） |
| 3. 质心 | 坐标最大差 | 1e-4 mm |
| 4. 拓扑 | solid/连通分量数量 | 严格相等 |
| 5. 布尔差 | A−B 与 B−A 体积 | 1e-3 mm³ |

第 1–4 维在网格上可直接计算（体积/质心按三角面片求和）；第 5 维布尔差需先把 STL 网格
经 OCCT mesh→BREP 重建后做 `cut`——这是判据实现细节，不改变「两份 STL 直接比对」的口径。

**结论：`「完全一致」= 双向布尔差体积 ≤ 容差 + bbox/体积/质心在容差内 + 实体数一致。**
cq-compat-compare 的布尔差判据就是几何等价的严格形式；M4 既有的 Hausdorff 采样距离
保留为诊断参考，不作为通过判据。

---

## 2. 当前进度（2026-10-06 实测）

### 2.1 里程碑完成度

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M0 骨架与探针 | ✅ 完成 | 包骨架、五阶段 CI、baseline、doctor、manifest、能力探针、AGPL-3.0-only |
| M1 CSG lexer/parser | ✅ 完成 | 50/50 examples 零诊断解析，12435 节点直方图对账一致 |
| M2 IR + P0 emitter | ✅ 完成 | P0-only corpus 100% emit + 100% 静态校验 |
| M3 CLI 与流水线 | ✅ 完成 | transpile/dump/check/run/corpus/run-cand 全部可用，21/21 P0 例子 ported |
| M4 parity 框架 | ✅ 框架完成 | stl-metrics / compare-mesh / report 已落地；**尚未对 50 例实跑 parity** |
| M5 P1 扩展 | ◐ 部分 | rotate_extrude 已实现（T501）；polyhedron/hull/resize/text/import 保持 BLOCKED（T502–T506） |
| M6 P2 调研与发布准备 | ✅ 完成 | T601–T605 全部调研并 BLOCKED（各带 probe 测试）；npm pack 审计通过；全量 corpus 报告产出 |
| M7 纯 TS .scad 前端 | 未启动 | 触发条件未满足，暂不需要 |

**G6 门禁实测**：338 passed / 49 skipped；lint、typecheck、build 通过。

### 2.2 语料三态（manifest.json 实测）

| 状态 | 数量 |
|---|---|
| ported | 21 |
| blocked | 28 |
| skipped | 1（Advanced/module_recursion，生成代码 ~1.3 MB 超出 faijs 静态校验器 1 MiB 上限，`oversized-output`） |

**blocked 原因分布**（一例可被多个原因阻塞，故计数总和 > 28）：

| 阻塞原因 | 例数 | 对应 faijs 能力缺口 |
|---|---|---|
| text | 9 | 无字体文本渲染 op（需 @faicad/faijs-extra 或等价能力） |
| import | 7 | 无外部 STL/STEP/模型导入 op |
| projection | 4 | sectionByPlane 只返回 1D 交线；projectView 返回 SVG 字符串，均非 2D face |
| linear_extrude | 4 | twist / non-uniform scale 拉伸：twistExtrude 只接受 1D wire、不支持负角度与 scaling law |
| hull | 3 | convexHull 只接受点集，不接受 Shape，缺 vertex-extraction 层 |
| offset | 2 | cad.offset 是 3D 全表面偏移，对 2D 轮廓是 no-op；缺真正的 2D offset |
| surface | 1 | 无 heightmap 读取 + 网格生成能力 |
| polyhedron | 1 | 三个 API 面均无 polyhedron op |
| oversized-output | 1 | 静态校验器 1 MiB 源码上限（module_recursion） |

**结论：当前转换完成度 21/50（42%）。剩余 29 个（28 blocked + 1 skipped）全部卡在 faijs 侧能力缺口或规模上限，转换器本身（parser/IR/emitter）不再是瓶颈。**

### 2.3 STL parity 进度

- M4 已交付指标读取器、比较器、分类器和报告生成器（34 个单测全绿）；
- M8 T800 已对齐 cq-compat-compare 五维指标（five-dim.ts）；
- M8 T801 已生成 42/50 ref.stl（8 个 2D/空几何无法导出 STL）；
- M8 T802 已实现 faceted circle→polygon2d 和 cylinder→extrude(polygon2d)；
- **M8 T803 已对 21 个 ported 例子实跑 parity**（2026-10-06）：

| 裁决 | 数量 | 说明 |
|---|---|---|
| PASS | 5 | assert, CSG-modules, example003, example014, example024 |
| FAIL | 12 | 指标差异超出严格容差（主因：OCCT vs CGAL 网格细分差异） |
| ERROR | 4 | 2× 空几何 (roof/echo) + 2× 2D union 不支持 (list_comprehensions/example017) |
| **合计** | **21** | |

**FAIL 根因分析**：
1. **网格细分差异**：faijs (OCCT) 比 OpenSCAD (CGAL) 产生更多三角面，导致表面积差异超出 0.1% 容差。体积差异通常 < 1%，但超出 0.01% 严格容差。
2. **example023 严重 bbox 不匹配** (IoU=0.5)：几何问题，不仅仅是细分差异。
3. **example004/functions 体积差异 > 6%**：潜在的几何精度问题。

**ERROR 根因分析**：
1. **空几何 (roof/echo)**：这些例子不产生 3D 几何（roof 是空的、echo 只输出文本），`result` 变量不存在。
2. **2D union 不支持**：**faijs `cad.union` 拒绝 2D face 输入**（报错 `wire/face/shell geometry cannot fuse`）。这是一个 faijs 平台限制——2D 布尔运算需要不同的 API 或预处理。

### 2.4 其他已确认事实（来自 probe 测试，永久保留）

- faijs 布尔运算（union/subtract/intersect）装配 OCCT BREP 引擎后精确可用；
- `volume()` 在 TS 兼容面精确；
- `revolve.angle` 是裸弧度（生成代码不得乘 `RADIAN`）；
- `cad.applyMatrix` 矩阵平移项按 mm 裸数值输出；
- `twistExtrude` / `sectionByPlane` / `projectView` / `cad.offset` / `convexHull` 的语义边界见 M5/M6 各 probe 测试文件。

---

## 3. 差距分析：从 21/50 到 50/50

29 个未转换例子按「解锁所需的工作类型」重新分组（与 §2.2 的原因分布不同视角，按解锁动作聚合）：

### A. 需 faijs 平台新增能力（硬缺口，占大头）

| 缺口 | 阻塞例数 | 解锁路径候选 |
|---|---|---|
| 2D 文本渲染（text） | 9 | faijs 内核新增 text-to-profile op；或 faijs-extra 提供字体解析 → 轮廓。需要把 TTF/OTF glyph 轮廓转成 2D profile，再走既有 extrude 管线 |
| 外部模型导入（import） | 7 | faijs 内核或 faijs-extra 新增 STL/STEP/BREP 读取 op；STL 导入是 mesh→BREP 重建，STEP 导入是精确 BREP |
| 2D offset | 2 | faijs 新增 2D 轮廓偏移 op（profile 层面的 offset，区别于现有 3D cad.offset）；语义需对齐 OpenSCAD 的 r/delta/chamfer |
| Shape 凸包（hull） | 3 | vertex-extraction：从 BREP shape 提取全部顶点 → hullFromPoints；或 faijs 内核新增 shape-level hull op |
| polyhedron | 1 | faijs 内核新增 polyhedron op（faces → BREP shell/solid 重建，含反向面/非流形诊断） |
| surface | 1 | 独立子项目：图像/数据文件读取 + heightmap 网格生成 |

### B. 需转换器/runtime 侧解决（faijs 能力已存在或不必需）

| 问题 | 阻塞例数 | 解锁路径 |
|---|---|---|
| linear_extrude twist / non-uniform scale | 4 | faijs `twistExtrude` 语义不等价（§2.4）。候选：① 按 OpenSCAD 语义在 runtime 库（`defineOp`）实现「渐进扭转拉伸」——切片堆叠法：把 profile 沿 Z 按 N 层切片，每层施加旋转/缩放矩阵后 loft/union；② 推动 faijs 内核扩展 twistExtrude 支持 face 输入与 scaling law。需先 spike 验证切片堆叠法的精度 |
| projection | 4 | `sectionByPlane`（1D 交线）与 `projectView`（SVG）都不够。候选：① runtime 库用「在 z=0 处切平面剖切 solid → 取截面 face」实现 cut=true（faijs 若有 plane-section/slice 能力）；② cut=false 需真正的轮廓投影算法，复杂度高，可能保持 blocked 或降级实现 |
| oversized-output（module_recursion） | 1 | 两条路：① 推动/fork faijs 静态校验器提升或取消 1 MiB 上限；② 转换器对超大树做程序压缩（子表达式去重、循环展开改写为 JS 循环）。② 更可控，建议先做 |

### C. parity 侧欠账（与转换正交，但直接决定「STL 完全一致」）

1. 生成 ref.stl：用 OpenSCAD 二进制对 50 个 `.scad` 渲染 STL（一次性，入 fixtures）；
2. 执行 cand：对 ported 例子的 `.fai.js` 用 faijs run 导出 cand.stl；
3. 跑 M4 比较器出报告，逐例分类 PASS / PASS-ANALYTIC / FAIL；
4. **预期会有系统性 FAIL**：faijs 解析 BREP 球/柱与 OpenSCAD `$fn` 棱面体体积不同（例如 `$fn=0` 默认球，OpenSCAD 棱面体积比解析球小）。这正是「完全一致」目标下必须解决的 **faceted 问题**——见 §4 T802。

---

## 4. 后续任务规划（M8：全量转换 + 严格 parity）

> 新里程碑 M8 的唯一出口：**manifest 50/50 ported（0 blocked / 0 skipped）且 50/50 STL parity 严格通过。**
> 现有 M1–M6 的 probe 测试全部保留为长期回归。

### 5.0 前置决策（开工前必须确认）

| # | 决策 | 状态/选项 | 建议 |
|---|---|---|---|
| D1 | 「STL 完全一致」的精确定义 | ✅ 已确认（2026-10-06 用户拍板）：**容差范围内的完全一致**；比对物是 faijs 直接导出的 STL 与 OpenSCAD 导出的 STL 两份文件，直接比对，判据参考 `cq-compat-compare`（§1.1） | 复用其五维指标与默认容差 |
| D2 | faceted 策略 | 待定：显式低 `$fn` 的例子是否按棱面体重建 | 必须。布尔差判据下，解析 BREP 球与 OpenSCAD 棱面球的差异远超 0.01% 体积容差，不 faceted 就不可能 PASS。`$fn=0` 的默认棱面数例子需按 OpenSCAD 的 `$fa/$fs` 分片公式复刻棱面数 |
| D3 | faijs 能力缺口的实现位置 | 待定：a) faijs 内核加 op；b) runtime 库（defineOp）；c) 混合 | 通用几何能力（polyhedron/hull-shape/offset2d/text/import）进 faijs 内核或独立库；OpenSCAD 专属语义（twist 拉伸、projection）进 runtime 库 |
| D4 | faijs 版本策略 | 待定：等 faijs 升级 vs 本仓库先做 runtime 兜底 | 不阻塞：runtime 库先行，faijs 内核落地后切换映射 |

### M8 任务拆解

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| T800 | parity 比对器判据对齐 cq-compat-compare：对两份 STL 直接计算五维指标——bbox/体积/质心/实体数按三角面片直接算，双向布尔差经 OCCT mesh→BREP 重建后 `cut`；容差集中配置（linear 1e-4 / volume 1e-4 / boolean 1e-3） | — | 单测：对已知几何（立方体/球/平移/缩放）给出正确裁决；ref.stl 与 cand.stl 双输入路径可用 |
| T801 | ref.stl 基线生成：OpenSCAD 渲染 50 例 STL 入 fixtures + hash 入 baseline | — | 50 个 ref.stl 可复现，baseline pin |
| T802 | faceted 基本体重建：按 `$fn/$fa/$fs`（含 `$fn=0` 时按 `$fa/$fs` 公式推棱面数）用 profile/polyhedron(-runtime) 复刻 OpenSCAD 棱面 sphere/cylinder/cone | D2 确认 | $fn=3/4/6/12/0 探针与 OpenSCAD 参照布尔差 < 1e-3 mm³ |
| T803 | P0 21 例全量 parity 实跑 | T800–T802 | 21/21 五维指标严格 PASS（或逐例 FAIL 根因报告） |
| T804 | runtime 库：twist/scale 拉伸（切片堆叠法 spike → 实现） | D3 | 4 个 linear_extrude 例子转换且 parity 通过 |
| T805 | runtime/内核：shape hull（顶点提取 → hullFromPoints，或内核 op） | D3 | 3 个 hull 例子通过 |
| T806 | 2D offset op（faijs 内核或 runtime） | D3 | 2 个 offset 例子通过；与 OpenSCAD r/delta/chamfer 语义对齐测试 |
| T807 | projection cut=true 实现（截面取 face）；cut=false 单独裁决 | D3 | 4 个 projection 例子通过或明确降级结论 |
| T808 | text 能力（faijs-extra 或内核：字体 → glyph 轮廓 → profile） | D3 | 9 个 text 例子通过；字体目录可配置、缺字明确诊断 |
| T809 | import 能力（STL/STEP 读取 op + 相对路径解析） | D3 | 7 个 import 例子通过（需先把例子引用的外部模型资源入库或标注来源） |
| T810 | polyhedron op（faces → watertight solid，含反向面/非流形诊断） | D3 | 1 例通过；M4 T405 spike 转正 |
| T811 | surface 子项目（heightmap 读取 + 网格生成） | D3 | 1 例通过 |
| T812 | 超大输出压缩（module_recursion：循环改写/子表达式去重）或 faijs 校验器上限调整 | D3 | module_recursion 从 skipped 转 ported |
| T813 | 全量 parity 报告：50/50 五维指标严格 PASS | T803–T812 | 报告可复现，无未知状态 |
| T814 | 文档收尾：README 能力矩阵、保真级别、版本锁更新 | T813 | 与实际一致，无虚假声明 |

### 建议实施顺序（按解锁例数/工作量比排序）

```text
T800–T803（先把比对器对齐 cq-compat-compare 并把已有 21 例的 parity 跑实——目标另一半的欠账，纯本仓库工作，无外部依赖）
  → T804 twist/scale（4 例）→ T805 hull（3 例）→ T806 offset2d（2 例）→ T807 projection（4 例）
  → T812 超大输出（1 例）→ T810 polyhedron（1 例）→ T811 surface（1 例）
  → T808 text（9 例，工作量大、依赖字体方案，放后但收益最大）
  → T809 import（7 例，需处理外部资源）
  → T813/T814 收尾
```

注：text(9) 和 import(7) 合计 16 例，是数字上最大的两块，但都依赖 faijs 侧新能力的方案定型；
先做不需要外部依赖的 B 类任务可以把完成度快速推到 ~34/50，再集中攻坚 A 类。

### 工作量与风险粗估

| 任务组 | 预估相对工作量 | 主要风险 |
|---|---|---|
| T800 比对器判据对齐 | 小（判据与容差直接取自 cq-compat-compare） | 布尔差所需的 mesh→BREP 重建对退化网格（2D 投影、非流形）的鲁棒性 |
| T801–T803 | 小（本仓库已有框架） | 预期暴露系统性 $fn 差异 → T802 是硬前提 |
| T804 twist | 中 | 切片堆叠法精度/性能；loft 能力是否存在于 faijs 需探针 |
| T805 hull | 小–中 | BREP 顶点提取 API 是否暴露 |
| T806 offset2d | 中 | OpenSCAD offset 语义细节（chamfer、自相交处理） |
| T807 projection | 中–大 | cut=false 的轮廓投影无现成内核能力，可能无法精确实现 |
| T808 text | 大 | 字体解析、glyph 轮廓质量；建议推动 faijs-extra 承担 |
| T809 import | 中 | 外部资源（例子引用的 .stl/.dat 等）不在 CC0 examples 目录内，需逐例盘点来源 |
| T810 polyhedron | 中–大 | mesh→BREP 重建的鲁棒性 |
| T811 surface | 大 | 独立子项目，图像依赖 |
| T812 超大输出 | 小–中 | 循环改写可能改变诊断定位，需权衡 |

### 里程碑外的前置协调项

上述 A 类缺口（text/import/polyhedron/hull-shape/offset2d）的最终解法取决于 **faijs 项目侧的演进**。
按本仓库既定纪律，这些属于「faijs 项目本身的 bug/功能缺陷，必须优先解决」——建议在 faijs 仓库为
每项缺口开 issue 并附本仓库的 probe 测试结论作为规格输入，避免在 runtime 库里做出与未来内核冲突的近似实现。
