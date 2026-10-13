# faijs-openscad 进度报告与后续任务规划（M6 之后�?
> **[2026-10-07 废弃声明]** 本文档已**彻底废弃**，由
> `docs/plans/2026-10-07-analytic-semantics-parity-plan.md` 取代�?> 废弃原因：本文档 §4 T802 �?faceted 基本体路线建立在错误�?OpenSCAD 语义理解�?> （把 `$fn` 当建模语义，实际它只�?STL 导出三角化参数）�?> 原文内容按历史记录保留，不再维护�?
> 日期�?026-10-06
> 前置文档：`docs/plans/2026-10-05-faijs-openscad-development-plan.md`（总计划，本文件不重复其背景）
> 事实基线：本仓库当前源码、`tests/manifest.json`、M0–M6 各里程碑门禁实测结果�?026-10-06）�?
---

## 0. 需求原文（逐字�?
> 现在，写一份新的文档，报告目前的进度，以及规划后续的任务。我的目标是�?0个examples全部转换成功，且stl对比完全一致�?>
> �?026-10-06 追加）所谓的完全一致，是在容差范围内的完全一致。具体你可以参考之前其他项目是如何比对的呀。比�?./faijs/projects/cq-compat-compare, 然后更新方案

以下所有规划均以该目标为验收终点�?
---

## 1. 目标重述与验收口�?
用户目标�?*50 �?OpenSCAD 官方 examples 全部转换成功，且 STL 对比完全一致�?*

拆解为两个硬指标�?
| 指标 | 当前定义（计划文档口径） | 需要收敛到的口�?|
|---|---|---|
| 转换成功 | manifest �?`status = ported`（能解析 + 发射 + faijs check 通过�?| 50/50 全部 `ported`�? blocked�? skipped |
| STL 完全一�?| M4 parity 框架：指标比�?+ 双向 Hausdorff 采样距离 | **容差范围内的完全一�?*，比对方法对�?`@faicad/cq-compat-compare`（见 §1.1），每例达到严格 PASS，不得用 PASS-ANALYTIC 替代 |

### 1.1 「完全一致」的精确定义（对�?cq-compat-compare�?
> 参考：`../faijs/packages/cq-compat-compare/src/step-compare.ts`（`@faicad/cq-compat-compare`）�?> 该项目比对两�?STEP 文件�?BREP 几何，五维指标全部通过才判 `equivalent`�?
| 维度 | 指标 | 默认容差 |
|---|---|---|
| 1. 包围�?| bbox 六面坐标最大差 | 1e-4 mm |
| 2. 体积 | 相对�?| 1e-4�?.01%�?|
| 3. 质心 | 坐标最大差 | 1e-4 mm |
| 4. 拓扑 | face/edge/vertex/solid 数量 | 严格相等（可按形状放宽到 solid 数） |
| 5. 布尔�?| A−B �?B−A 体积 | 1e-3 mm³ |

本项目沿用这一口径�?*比对物就是两�?STL，直接比�?*�?
1. `ref.stl` = OpenSCAD �?`.scad` 渲染导出�?STL�?2. `cand.stl` = faijs 执行生成�?`.fai.js` 直接导出�?STL�?
不经�?mesh→BREP 重建等中间变换，两份 STL 直接进入指标比对�?*cq-compat-compare 只是
「几何一致性该怎么判」的参�?*——借鉴它的指标与容差（见下表），应用到 STL 网格上：

| 维度 | 指标 | 默认容差 |
|---|---|---|
| 1. 包围�?| bbox 六面坐标最大差 | 1e-4 mm |
| 2. 体积 | 相对�?| 1e-4�?.01%�?|
| 3. 质心 | 坐标最大差 | 1e-4 mm |
| 4. 拓扑 | solid/连通分量数�?| 严格相等 |
| 5. 布尔�?| A−B �?B−A 体积 | 1e-3 mm³ |

�?1�? 维在网格上可直接计算（体�?质心按三角面片求和）；第 5 维布尔差需先把 STL 网格
�?OCCT mesh→BREP 重建后做 `cut`——这是判据实现细节，不改变「两�?STL 直接比对」的口径�?
**结论：`「完全一致�? 双向布尔差体�?�?容差 + bbox/体积/质心在容差内 + 实体数一致�?*
cq-compat-compare 的布尔差判据就是几何等价的严格形式；M4 既有�?Hausdorff 采样距离
保留为诊断参考，不作为通过判据�?
---

## 2. 当前进度�?026-10-06 实测�?
### 2.1 里程碑完成度

| 里程�?| 状�?| 说明 |
|---|---|---|
| M0 骨架与探�?| �?完成 | 包骨架、五阶段 CI、baseline、doctor、manifest、能力探针、AGPL-3.0-only |
| M1 CSG lexer/parser | �?完成 | 50/50 examples 零诊断解析，12435 节点直方图对账一�?|
| M2 IR + P0 emitter | �?完成 | P0-only corpus 100% emit + 100% 静态校�?|
| M3 CLI 与流水线 | �?完成 | transpile/dump/check/run/corpus/run-cand 全部可用�?1/21 P0 例子 ported |
| M4 parity 框架 | �?框架完成 | stl-metrics / compare-mesh / report 已落地；**尚未�?50 例实�?parity** |
| M5 P1 扩展 | �?部分 | rotate_extrude 已实现（T501）；polyhedron/hull/resize/text/import 保持 BLOCKED（T502–T506�?|
| M6 P2 调研与发布准�?| �?完成 | T601–T605 全部调研�?BLOCKED（各�?probe 测试）；npm pack 审计通过；全�?corpus 报告产出 |
| M7 �?TS .scad 前端 | 未启�?| 触发条件未满足，暂不需�?|

**G6 门禁实测**�?38 passed / 49 skipped；lint、typecheck、build 通过�?
### 2.2 语料三态（manifest.json 实测�?
| 状�?| 数量 |
|---|---|
| ported | 21 |
| blocked | 28 |
| skipped | 1（Advanced/module_recursion，生成代�?~1.3 MB 超出 faijs 静态校验器 1 MiB 上限，`oversized-output`�?|

**blocked 原因分布**（一例可被多个原因阻塞，故计数总和 > 28）：

| 阻塞原因 | 例数 | 对应 faijs 能力缺口 |
|---|---|---|
| text | 9 | 无字体文本渲�?op（需 @faicad/faijs/extra 或等价能力） |
| import | 7 | 无外�?STL/STEP/模型导入 op |
| projection | 4 | sectionByPlane 只返�?1D 交线；projectView 返回 SVG 字符串，均非 2D face |
| linear_extrude | 4 | twist / non-uniform scale 拉伸：twistExtrude 只接�?1D wire、不支持负角度与 scaling law |
| hull | 3 | convexHull 只接受点集，不接�?Shape，缺 vertex-extraction �?|
| offset | 2 | cad.offset �?3D 全表面偏移，�?2D 轮廓�?no-op；缺真正�?2D offset |
| surface | 1 | �?heightmap 读取 + 网格生成能力 |
| polyhedron | 1 | 三个 API 面均�?polyhedron op |
| oversized-output | 1 | 静态校验器 1 MiB 源码上限（module_recursion�?|

**结论：当前转换完成度 21/50�?2%）。剩�?29 个（28 blocked + 1 skipped）全部卡�?faijs 侧能力缺口或规模上限，转换器本身（parser/IR/emitter）不再是瓶颈�?*

### 2.3 STL parity 进度

- M4 已交付指标读取器、比较器、分类器和报告生成器�?4 个单测全绿）�?- M8 T800 已对�?cq-compat-compare 五维指标（five-dim.ts）；
- M8 T801 已生�?42/50 ref.stl�? �?2D/空几何无法导�?STL）；
- M8 T802 已实�?faceted circle→polygon2d �?cylinder→extrude(polygon2d)�?- **M8 T803 已对 21 �?ported 例子实跑 parity**�?026-10-06）：

| 裁决 | 数量 | 说明 |
|---|---|---|
| PASS | 5 | assert, CSG-modules, example003, example014, example024 |
| FAIL | 12 | 指标差异超出严格容差（主因：OCCT vs CGAL 网格细分差异�?|
| ERROR | 4 | 2× 空几�?(roof/echo) + 2× 2D union 不支�?(list_comprehensions/example017) |
| **合计** | **21** | |

**FAIL 根因分析**�?1. **网格细分差异**：faijs (OCCT) �?OpenSCAD (CGAL) 产生更多三角面，导致表面积差异超�?0.1% 容差。体积差异通常 < 1%，但超出 0.01% 严格容差�?2. **example023 严重 bbox 不匹�?* (IoU=0.5)：几何问题，不仅仅是细分差异�?3. **example004/functions 体积差异 > 6%**：潜在的几何精度问题�?
**ERROR 根因分析**�?1. **空几�?(roof/echo)**：这些例子不产生 3D 几何（roof 是空的、echo 只输出文本），`result` 变量不存在�?2. **2D union 不支�?*�?*faijs `cad.union` 拒绝 2D face 输入**（报�?`wire/face/shell geometry cannot fuse`）。这是一�?faijs 平台限制—�?D 布尔运算需要不同的 API 或预处理�?
### 2.4 其他已确认事实（来自 probe 测试，永久保留）

- faijs 布尔运算（union/subtract/intersect）装�?OCCT BREP 引擎后精确可用；
- `volume()` �?TS 兼容面精确；
- `revolve.angle` 是裸弧度（生成代码不得乘 `RADIAN`）；
- `cad.applyMatrix` 矩阵平移项按 mm 裸数值输出；
- `twistExtrude` / `sectionByPlane` / `projectView` / `cad.offset` / `convexHull` 的语义边界见 M5/M6 �?probe 测试文件�?
---

## 3. 差距分析：从 21/50 �?50/50

29 个未转换例子按「解锁所需的工作类型」重新分组（�?§2.2 的原因分布不同视角，按解锁动作聚合）�?
### A. 需 faijs 平台新增能力（硬缺口，占大头�?
| 缺口 | 阻塞例数 | 解锁路径候�?|
|---|---|---|
| 2D 文本渲染（text�?| 9 | faijs 内核新增 text-to-profile op；或 faijs-extra 提供字体解析 �?轮廓。需要把 TTF/OTF glyph 轮廓转成 2D profile，再走既�?extrude 管线 |
| 外部模型导入（import�?| 7 | faijs 内核�?faijs-extra 新增 STL/STEP/BREP 读取 op；STL 导入�?mesh→BREP 重建，STEP 导入是精�?BREP |
| 2D offset | 2 | faijs 新增 2D 轮廓偏移 op（profile 层面�?offset，区别于现有 3D cad.offset）；语义需对齐 OpenSCAD �?r/delta/chamfer |
| Shape 凸包（hull�?| 3 | vertex-extraction：从 BREP shape 提取全部顶点 �?hullFromPoints；或 faijs 内核新增 shape-level hull op |
| polyhedron | 1 | faijs 内核新增 polyhedron op（faces �?BREP shell/solid 重建，含反向�?非流形诊断） |
| surface | 1 | 独立子项目：图像/数据文件读取 + heightmap 网格生成 |

### B. 需转换�?runtime 侧解决（faijs 能力已存在或不必需�?
| 问题 | 阻塞例数 | 解锁路径 |
|---|---|---|
| linear_extrude twist / non-uniform scale | 4 | faijs `twistExtrude` 语义不等价（§2.4）。候选：�?�?OpenSCAD 语义�?runtime 库（`defineOp`）实现「渐进扭转拉伸」——切片堆叠法：把 profile �?Z �?N 层切片，每层施加旋转/缩放矩阵�?loft/union；② 推动 faijs 内核扩展 twistExtrude 支持 face 输入�?scaling law。需�?spike 验证切片堆叠法的精度 |
| projection | 4 | `sectionByPlane`�?D 交线）与 `projectView`（SVG）都不够。候选：�?runtime 库用「在 z=0 处切平面剖切 solid �?取截�?face」实�?cut=true（faijs 若有 plane-section/slice 能力）；�?cut=false 需真正的轮廓投影算法，复杂度高，可能保�?blocked 或降级实�?|
| oversized-output（module_recursion�?| 1 | 两条路：�?推动/fork faijs 静态校验器提升或取�?1 MiB 上限；② 转换器对超大树做程序压缩（子表达式去重、循环展开改写�?JS 循环）。② 更可控，建议先做 |

### C. parity 侧欠账（与转换正交，但直接决定「STL 完全一致」）

1. 生成 ref.stl：用 OpenSCAD 二进制对 50 �?`.scad` 渲染 STL（一次性，�?fixtures）；
2. 执行 cand：对 ported 例子�?`.fai.js` �?faijs run 导出 cand.stl�?3. �?M4 比较器出报告，逐例分类 PASS / PASS-ANALYTIC / FAIL�?4. **预期会有系统�?FAIL**：faijs 解析 BREP �?柱与 OpenSCAD `$fn` 棱面体体积不同（例如 `$fn=0` 默认球，OpenSCAD 棱面体积比解析球小）。这正是「完全一致」目标下必须解决�?**faceted 问题**——见 §4 T802�?
---

## 4. 后续任务规划（M8：全量转�?+ 严格 parity�?
> 新里程碑 M8 的唯一出口�?*manifest 50/50 ported�? blocked / 0 skipped）且 50/50 STL parity 严格通过�?*
> 现有 M1–M6 �?probe 测试全部保留为长期回归�?
### 5.0 前置决策（开工前必须确认�?
| # | 决策 | 状�?选项 | 建议 |
|---|---|---|---|
| D1 | 「STL 完全一致」的精确定义 | �?已确认（2026-10-06 用户拍板）：**容差范围内的完全一�?*；比对物�?faijs 直接导出�?STL �?OpenSCAD 导出�?STL 两份文件，直接比对，判据参�?`cq-compat-compare`（�?.1�?| 复用其五维指标与默认容差 |
| D2 | faceted 策略 | 待定：显式低 `$fn` 的例子是否按棱面体重�?| 必须。布尔差判据下，解析 BREP 球与 OpenSCAD 棱面球的差异远超 0.01% 体积容差，不 faceted 就不可能 PASS。`$fn=0` 的默认棱面数例子需�?OpenSCAD �?`$fa/$fs` 分片公式复刻棱面�?|
| D3 | faijs 能力缺口的实现位�?| 待定：a) faijs 内核�?op；b) runtime 库（defineOp）；c) 混合 | 通用几何能力（polyhedron/hull-shape/offset2d/text/import）进 faijs 内核或独立库；OpenSCAD 专属语义（twist 拉伸、projection）进 runtime �?|
| D4 | faijs 版本策略 | 待定：等 faijs 升级 vs 本仓库先�?runtime 兜底 | 不阻塞：runtime 库先行，faijs 内核落地后切换映�?|

### M8 任务拆解

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| T800 | parity 比对器判据对�?cq-compat-compare：对两份 STL 直接计算五维指标——bbox/体积/质心/实体数按三角面片直接算，双向布尔差经 OCCT mesh→BREP 重建�?`cut`；容差集中配置（linear 1e-4 / volume 1e-4 / boolean 1e-3�?| �?| 单测：对已知几何（立方体/�?平移/缩放）给出正确裁决；ref.stl �?cand.stl 双输入路径可�?|
| T801 | ref.stl 基线生成：OpenSCAD 渲染 50 �?STL �?fixtures + hash �?baseline | �?| 50 �?ref.stl 可复现，baseline pin |
| T802 | faceted 基本体重建：�?`$fn/$fa/$fs`（含 `$fn=0` 时按 `$fa/$fs` 公式推棱面数）用 profile/polyhedron(-runtime) 复刻 OpenSCAD 棱面 sphere/cylinder/cone | D2 确认 | $fn=3/4/6/12/0 探针�?OpenSCAD 参照布尔�?< 1e-3 mm³ |
| T803 | P0 21 例全�?parity 实跑 | T800–T802 | 21/21 五维指标严格 PASS（或逐例 FAIL 根因报告�?|
| T804 | runtime 库：twist/scale 拉伸（切片堆叠法 spike �?实现�?| D3 | 4 �?linear_extrude 例子转换�?parity 通过 |
| T805 | runtime/内核：shape hull（顶点提�?�?hullFromPoints，或内核 op�?| D3 | 3 �?hull 例子通过 |
| T806 | 2D offset op（faijs 内核�?runtime�?| D3 | 2 �?offset 例子通过；与 OpenSCAD r/delta/chamfer 语义对齐测试 |
| T807 | projection cut=true 实现（截面取 face）；cut=false 单独裁决 | D3 | 4 �?projection 例子通过或明确降级结�?|
| T808 | text 能力（faijs-extra 或内核：字体 �?glyph 轮廓 �?profile�?| D3 | 9 �?text 例子通过；字体目录可配置、缺字明确诊�?|
| T809 | import 能力（STL/STEP 读取 op + 相对路径解析�?| D3 | 7 �?import 例子通过（需先把例子引用的外部模型资源入库或标注来源�?|
| T810 | polyhedron op（faces �?watertight solid，含反向�?非流形诊断） | D3 | 1 例通过；M4 T405 spike 转正 |
| T811 | surface 子项目（heightmap 读取 + 网格生成�?| D3 | 1 例通过 |
| T812 | 超大输出压缩（module_recursion：循环改�?子表达式去重）或 faijs 校验器上限调�?| D3 | module_recursion �?skipped �?ported |
| T813 | 全量 parity 报告�?0/50 五维指标严格 PASS | T803–T812 | 报告可复现，无未知状�?|
| T814 | 文档收尾：README 能力矩阵、保真级别、版本锁更新 | T813 | 与实际一致，无虚假声�?|

### 建议实施顺序（按解锁例数/工作量比排序�?
```text
T800–T803（先把比对器对齐 cq-compat-compare 并把已有 21 例的 parity 跑实——目标另一半的欠账，纯本仓库工作，无外部依赖）
  �?T804 twist/scale�? 例）�?T805 hull�? 例）�?T806 offset2d�? 例）�?T807 projection�? 例）
  �?T812 超大输出�? 例）�?T810 polyhedron�? 例）�?T811 surface�? 例）
  �?T808 text�? 例，工作量大、依赖字体方案，放后但收益最大）
  �?T809 import�? 例，需处理外部资源�?  �?T813/T814 收尾
```

注：text(9) �?import(7) 合计 16 例，是数字上最大的两块，但都依�?faijs 侧新能力的方案定型；
先做不需要外部依赖的 B 类任务可以把完成度快速推�?~34/50，再集中攻坚 A 类�?
### 工作量与风险粗估

| 任务�?| 预估相对工作�?| 主要风险 |
|---|---|---|
| T800 比对器判据对�?| 小（判据与容差直接取�?cq-compat-compare�?| 布尔差所需�?mesh→BREP 重建对退化网格（2D 投影、非流形）的鲁棒�?|
| T801–T803 | 小（本仓库已有框架） | 预期暴露系统�?$fn 差异 �?T802 是硬前提 |
| T804 twist | �?| 切片堆叠法精�?性能；loft 能力是否存在�?faijs 需探针 |
| T805 hull | 小–中 | BREP 顶点提取 API 是否暴露 |
| T806 offset2d | �?| OpenSCAD offset 语义细节（chamfer、自相交处理�?|
| T807 projection | 中–大 | cut=false 的轮廓投影无现成内核能力，可能无法精确实�?|
| T808 text | �?| 字体解析、glyph 轮廓质量；建议推�?faijs-extra 承担 |
| T809 import | �?| 外部资源（例子引用的 .stl/.dat 等）不在 CC0 examples 目录内，需逐例盘点来源 |
| T810 polyhedron | 中–大 | mesh→BREP 重建的鲁棒�?|
| T811 surface | �?| 独立子项目，图像依赖 |
| T812 超大输出 | 小–中 | 循环改写可能改变诊断定位，需权衡 |

### 里程碑外的前置协调项

上述 A 类缺口（text/import/polyhedron/hull-shape/offset2d）的最终解法取决于 **faijs 项目侧的演进**�?按本仓库既定纪律，这些属于「faijs 项目本身�?bug/功能缺陷，必须优先解决」——建议在 faijs 仓库�?每项缺口开 issue 并附本仓库的 probe 测试结论作为规格输入，避免在 runtime 库里做出与未来内核冲突的近似实现�?