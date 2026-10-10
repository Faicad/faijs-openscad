# faijs-openscad 进度总结与后续开发计划

> 日期：2026-10-10
> 基于 `2026-10-07-analytic-semantics-parity-plan.md`（M9 方案）的最新 parity 报告
> Converter 版本：0.29.5 ｜ faijs 版本：0.31.1
> Parity 报告时间戳：2026-10-10T05:36:13.257Z

---

## 0. 用户目标

> 我的目标是要 50 个 examples 全部转换成功，且 stl 对比完全一致。
> 所谓的完全一致，是在容差范围内的完全一致。

容差口径（五维判据）：体积 abs 0.01 / rel 0.1%，表面积 abs 0.1 / rel 0.1%，Bbox IoU > 0.999，质心距离 0.01mm。

---

## 1. 总体进度概览

| 维度 | 目标 | 当前状态 | 达成率 |
|---|---|---|---|
| **faijs 代码生成** | 50/50 转换成功 | 50/50 ported（0 blocked, 0 skipped） | ✅ 100% |
| **STL 生成** | 50/50 能生成 STL | 25/50 成功（25 个 ERROR） | ⚠️ 50% |
| **STL 一致性** | 50/50 在容差内一致 | 6 PASS + 4 PASS-NT = 10/50 达标 | ❌ 20% |

### Parity 报告明细

| Verdict | 数量 | 含义 |
|---|---|---|
| PASS | 6 | 五维指标全部在容差内 |
| PASS-NT | 4 | 执行成功但无参考 STL 可比对 |
| FAIL | 15 | STL 生成成功但度量差异超容差 |
| ERROR | 25 | faijs 执行失败，无法生成 STL |

### 关键结论

1. **代码生成已 100% 达成**：50 个 OpenSCAD 示例全部成功转写为 `.fai.js` 代码。
2. **STL 生成有两类障碍**：faijs op 能力缺口（25 ERROR）+ 三角化密度不匹配（15 FAIL）。
3. **STL 一致性**：6 例完全通过，4 例无法判定，40 例尚未达标。

---

## 2. PASS 例子详表（6 例）

| 例子 | 体积 Δ | 表面积 Δ | Bbox IoU | 质心距离 | 三角化 | STEP |
|---|---|---|---|---|---|---|
| Advanced/assert.scad | 0.0160 | 0.0078 | 1.000000 | 0.000008 | default | exact |
| Basics/CSG-modules.scad | 2.0120 | 0.3219 | 0.999886 | 0.007674 | seg=72 | exact |
| Old/example003.scad | 0.0000 | 0.0000 | 1.000000 | 0.000000 | default | exact |
| Old/example014.scad | 0.0054 | 0.0015 | 0.999998 | 0.000000 | default | exact |
| Old/example023.scad | 0.0304 | 0.0238 | 1.000000 | 0.000018 | default | exact |
| Old/example024.scad | 0.4598 | 0.0397 | 0.999999 | 0.000007 | default | exact |

## 3. PASS-NT 例子详表（4 例，无参考 STL）

| 例子 | 原因 |
|---|---|
| Advanced/module_recursion.scad | OpenSCAD 产出为空（纯 2D square 递归） |
| Basics/roof.scad | OpenSCAD `roof()` 产出空几何 |
| Functions/echo.scad | 纯 echo 脚本，无几何输出 |
| Functions/list_comprehensions.scad | 2D polygon，OpenSCAD 未导出 3D STL |

> PASS-NT 表示 faijs 侧执行成功，代码生成正确，但因 OpenSCAD 侧无 3D STL 输出无法对账。

---

## 4. FAIL 例子详表（15 例）

### 4A. 三角化密度不匹配（14 例）— 主因

| 例子 | 体积 Δ (rel) | 表面积 Δ (rel) | Bbox IoU | 三角化 |
|---|---|---|---|---|
| Basics/CSG.scad | 37.44 (0.48%) | 23.32 (0.67%) | 0.991 | seg=30 |
| Basics/hull.scad | 95.06 (1.11%) | 30.49 (0.96%) | 0.984 | seg=30 |
| Basics/logo.scad | 20.25 (0.11%) | 9.21 (0.11%) | 1.000 | seg=100 |
| Functions/functions.scad | 72.03 (14.4%) | 119.03 (7.9%) | 0.999 | seg=5 |
| Old/example001.scad | 248.00 (1.34%) | 84.41 (0.88%) | 0.995 | seg=30 |
| Old/example002.scad | 0.97 (0.03%) | 13.42 (0.23%) | 1.000 | seg=30 |
| Old/example004.scad | 102.46 (4.49%) | 122.24 (3.51%) | 1.000 | seg=30 |
| Old/example005.scad | 15726.62 (0.70%) | 1210.96 (0.45%) | 0.994 | seg=30 |
| Old/example006.scad | 305021.60 (32.8%) | 14178.23 (23.2%) | 0.640 | seg=30 |
| Old/example017.scad | 1350.97 (0.81%) | 1214.77 (1.73%) | 1.000 | seg=30 |
| Old/example018.scad | 9244.04 (0.36%) | 478.10 (0.17%) | 1.000 | seg=30 |
| Old/example019.scad | 744.27 (0.82%) | 1999.70 (5.88%) | 0.996 | seg=19 |
| Old/example021.scad | 684.17 (15.4%) | 2734.70 (14.7%) | 0.951 | seg=12 |
| Old/example022.scad | 216.42 (0.48%) | 22.05 (0.24%) | 1.000 | seg=16 |

**根因**：faijs BREP 保存精确解析曲面（真球/真圆柱），三角化在导出时发生；
OpenSCAD 全程是刻面多面体，`$fa/$fs/$fn` 在创建时即决定面数。
两种引擎的三角化模型存在系统性偏差：
- OCCT `angularDeflection` 控制球面所有方向的分片数，OpenSCAD `$fa` 只控制周向
- OCCT `linearDeflection` 是弦误差（chord error），OpenSCAD `$fs` 是弦长（chord length）
- 全局 deflection 无法 per-primitive 自适应不同半径

**典型案例**：`functions.scad` 含 41 个 `sphere(r=1)`，OpenSCAD 默认 5 段（vol≈2.40），
faijs BREP 真球三角化后 vol≈4.16，单球差 43%，总体积差 14.4%。

### 4B. faijs union 丢弃几何（1 例）

| 例子 | 体积 Δ (rel) | Bbox IoU |
|---|---|---|
| Parametric/candleStand.scad | 3931.04 (75.5%) | 0.036 |

**根因**：faijs `cad.union` fuse 路径不带容差（无 `fuzzyValue`）。
退化几何（共面/共边/精确重叠）导致 OCCT `BRepAlgoAPI_Fuse` 静默丢弃部分输入。
**修复方案已定位**：改用 `kernel.booleanOp('fuse', [a], [b], { fuzzyValue: 1e-6 })`，待 faijs 侧实施。

---

## 5. ERROR 例子详表（25 例）

### 5.1 按根因分类汇总

| 根因 | 数量 | 修复方 |
|---|---|---|
| text op 未实现 | 10 | faijs 侧（字体渲染 / opentype.js） |
| import/load 未实现 | 8 | faijs 侧（文件 I/O + STL/DXF 解析器） |
| surface 数据文件缺失 | 2 | fixture 侧（补充 .png / .dat） |
| twistExtrude/sweep 崩溃 | 2 | faijs 侧（OCCT sweep 修复） |
| applyMatrix 失败 | 1 | faijs 侧（kernel transform 修复） |
| offset2d 失败 | 1 | faijs 侧（近零 delta 处理） |
| polyhedron 构造失败 | 1 | faijs 侧（BRep wire 构造修复） |

### 5.2 text op 未实现（10 例）— 最大单一阻塞项

影响 20% 的例子。faijs 的 `openscad.text()` 需要 opentype.js 将字形轮廓转为 2D profiles。

| 例子 | text 内容 |
|---|---|
| Advanced/GEB.scad | `text("B")` |
| Advanced/children.scad | `text("SCAD")` |
| Advanced/children_indexed.scad | `text("Nothing...")` |
| Basics/LetterBlock.scad | `text("Y")` |
| Basics/logo_and_text.scad | `text("Open")` |
| Basics/rotate_extrude.scad | `text("  J")` |
| Basics/text_on_cube.scad | `text("C")` |
| Functions/polygon_areas.scad | `text("Areas:")` |
| Functions/recursion.scad | `text("6! = 720")` |
| Parametric/sign.scad | `text("Welcome to...")` |

### 5.3 import/load 未实现（8 例）

faijs 的 `openscad.load()` 需要文件 I/O 和 STL/DXF 解析器。

| 例子 | 导入文件类型 |
|---|---|
| Basics/projection.scad | .stl |
| Old/example007.scad | .dxf |
| Old/example008.scad | .dxf |
| Old/example009.scad | .dxf |
| Old/example012.scad | .stl |
| Old/example013.scad | .dxf |
| Old/example015.scad | .dxf |
| Old/example016.scad | .stl |

### 5.4 其它 ERROR（6 例）

| 例子 | 错误 | 根因 |
|---|---|---|
| Advanced/surface_image.scad | ENOENT: surface_image.png | surface 数据文件缺失 |
| Old/example010.scad | ENOENT: example010.dat | surface 数据文件缺失 |
| Advanced/animation.scad | applyMatrix: kernel transform failed | faijs 运行时矩阵变换 bug |
| Advanced/offset.scad | offset2d failed (near-zero delta) | faijs offset2d 缺陷 |
| Old/example011.scad | polyhedron: wire construction failed | faijs BRep wire 构造缺陷 |
| Old/example020.scad | twistExtrude: sweepFull bad shape type | faijs OCCT sweep 缺陷 |

---

## 6. 已完成的工作

| 任务 | 状态 | 说明 |
|---|---|---|
| faijs 版本升级 | ✅ | 0.30.9 → 0.31.1 |
| A1 语义回正 | ✅ | sphere/cylinder/circle 一律产出解析几何；无 faceted 降级路线 |
| A2 tessellation 采集 | ✅ | 增加 angularDeflection / linearDeflection；OpenSCAD 默认兜底 |
| A3 parity runner 改造 | ✅ | 改用 createRuntime({ tessellation })；per-example runtime 创建 |
| per-primitive segments 策略 | ✅ | 仅 $fn > 0 时生效；$fn=0 时由全局 deflection 控制 |
| A4 example023 applyMatrix bug | ✅ | faijs 0.30.9 已修复，parity PASS |
| A4 2D union ERROR | ✅ | emitter 对 2D union 改用 cad.fuse |
| angularDeflection 从 $fn 换算 | ✅ | 2π/fn 替代 $fa 转弧度；logo.scad volΔ 从 196→20 |
| candleStand union 根因定位 | ✅ | 根因报告已写，修复方案明确（fuzzyValue） |
| functions.scad 根因定位 | ✅ | 三角化密度不匹配，faijs 默认分片过细 |
| module_recursion compact 模式 | ✅ | 文件大小已解决（1 MiB），语句数限制待解决 |

---

## 7. 后续开发计划

### 7.1 优先级排序

按「解锁例子数 / 实现难度」比排序，优先攻克投入产出比最高的项：

| 优先级 | 任务 | 解锁例子数 | 修复方 | 预估难度 |
|---|---|---|---|---|
| **P0** | text op 实现（opentype.js 字体渲染） | 10 | faijs 侧 | 高 |
| **P0** | import/load 实现（文件 I/O + STL/DXF 解析） | 8 | faijs 侧 | 中高 |
| **P1** | 三角化密度 per-primitive 自适应 | 14 | faijs 侧 | 中高 |
| **P1** | union fuzzyValue 修复 | 1 | faijs 侧 | 低 |
| **P2** | surface 数据文件补充 | 2 | fixture 侧 | 低 |
| **P2** | twistExtrude/sweep 修复 | 2 | faijs 侧 | 中 |
| **P2** | applyMatrix 修复（animation） | 1 | faijs 侧 | 中 |
| **P2** | offset2d 近零 delta 修复 | 1 | faijs 侧 | 中 |
| **P2** | polyhedron wire 构造修复 | 1 | faijs 侧 | 中 |
| **P3** | module_recursion 语句数限制 | 0（已 PASS-NT） | faijs 侧 | 低 |

### 7.2 阶段规划

#### 阶段 1 — faijs op 能力补齐（P0，解锁 18 例）

这是最关键的阶段，解决 25 个 ERROR 中的 18 个。

**1a. text op 实现（10 例）**

需要 faijs 侧实现 `openscad.text()`：
- 集成 opentype.js 解析字体文件（OpenSCAD 默认用 Liberation Sans）
- 将字形轮廓转为 2D profiles（polygon / wire）
- 支持 `font` / `size` / `halign` / `valign` / `spacing` 参数
- 后续 linear_extrude / rotate_extrude 组合使用

**1b. import/load 实现（8 例）**

需要 faijs 侧实现 `openscad.load()`：
- 文件 I/O 读取 .stl / .dxf 文件
- STL 解析器：三角网格 → BRep compound
- DXF 解析器：2D 路径 → wire / face
- 从 fixture 目录或相对路径解析文件

#### 阶段 2 — 三角化密度对齐（P1，解锁 15 例）

这是 parity 一致性的核心战场，解决 15 个 FAIL 中的 14 个（密度类）。

**2a. per-primitive deflection 自适应**

当前全局 deflection 无法 per-primitive 自适应不同半径。需要 faijs 侧支持：
- 方案 A：OCCT 侧支持 `$fn` 语义的双方向 segments（per-primitive override 在布尔后仍生效）
- 方案 B：导出时 per-primitive 按半径计算 deflection（`segments = max(5, min(ceil(360/$fa), ceil(2πr/$fs)))`）
- 方案 C：faijs 侧支持 OpenSCAD 风格的刻面多面体模式（在创建时即按 $fn/$fa/$fs 刻面）

**推荐方案 B**：在 `solidToShape` 导出时，按每个图元的半径和全局 `$fa/$fs` 计算 per-primitive deflection，
最忠实复刻 OpenSCAD 的 `segments = max(5, min(ceil(360/$fa), ceil(2πr/$fs)))` 公式。

**2b. union fuzzyValue 修复（1 例）**

将 `cad.union` 的 fuse 路径从 `kernel.fuse(a, b)` 改为
`kernel.booleanOp('fuse', [a], [b], { fuzzyValue: 1e-6 })`。
fuzzyValue 在 1e-6 ~ 1e-2 范围内均可修复 candleStand，1e-6 是安全保守的默认值。

#### 阶段 3 — 其余 ERROR 修复（P2，解锁 7 例）

**3a. surface 数据文件补充（2 例）**
- 从 OpenSCAD 官方仓库获取 `surface_image.png` 和 `example010.dat`
- 放入 fixture 目录

**3b. twistExtrude/sweep 修复（2 例）**
- example020: `sweepFull: BRepFill_Section: bad shape type of section`
- 需要排查 OCCT sweep 对特定截面类型的处理

**3c. applyMatrix 修复（1 例）**
- animation.scad: `kernel transform failed`
- 需要排查 faijs 运行时矩阵变换对特定变换序列的处理

**3d. offset2d 修复（1 例）**
- offset.scad: `offset2d failed even with near-zero delta`
- 需要处理 delta 接近零时的退化情况

**3e. polyhedron 构造修复（1 例）**
- example011: `buildTriFace: wire construction failed`
- 需要排查 BRep wire 构造对用户自定义 polyhedron 顶点/面的处理

#### 阶段 4 — 全量收敛与验收

| 任务 | 验收标准 |
|---|---|
| 全量 parity 重跑 | 50/50 ported，五维指标全部在容差内 |
| PASS-NT 确认 | 4 例无参考 STL 的例子确认 faijs 侧执行正确 |
| 文档收尾 | README 能力矩阵、保真级别、版本锁与实际一致 |

### 7.3 预期时间线

| 阶段 | 任务 | 预期解锁 | 累计达标 |
|---|---|---|---|
| 当前 | — | — | 10/50（6 PASS + 4 PASS-NT） |
| 阶段 1a | text op | +10 ERROR→PASS/FAIL | 20/50 |
| 阶段 1b | import/load | +8 ERROR→PASS/FAIL | 28/50 |
| 阶段 2a | 三角化密度对齐 | +14 FAIL→PASS | 42/50 |
| 阶段 2b | union fuzzyValue | +1 FAIL→PASS | 43/50 |
| 阶段 3 | 其余 ERROR 修复 | +7 ERROR→PASS/FAIL | 50/50 |
| 阶段 4 | 全量收敛 | 密度微调 | 50/50 PASS |

> 注：阶段 1 解锁的例子可能因三角化密度问题而 FAIL（非 ERROR），
> 需要阶段 2 的密度对齐才能最终 PASS。阶段 2 是一致性达标的决定性步骤。

---

## 8. 风险与不确定性

| 风险 | 影响 | 应对 |
|---|---|---|
| OCCT deflection 与 OpenSCAD $fa/$fs 本质不同，对齐后仍超容差 | 14 例 FAIL 无法 PASS | 五维容差是用户拍板的口径，不放松；必要时按例标定分片公式，做 $fn ↔ 线性/角偏转的映射实测 |
| BREP 精确 vs OpenSCAD 刻面的拓扑差异 | 逐三角形对账不可能 | parity 度量对账（volume/area/bbox/centroid）能通过，但三角形数量和布局不会逐面一致 |
| text op 实现复杂度高（字体渲染管线） | 阶段 1a 延期 | 可先支持基本 ASCII + Liberation Sans，后续再扩展 |
| faijs 侧修复排期不可控 | 整体进度受 faijs 侧制约 | 本仓库侧可先做能做的（fixture 补充、emitter 调整），faijs 侧修复并行推进 |
| module_recursion 语句数超限（8189 > 5000） | 1 例 PASS-NT 可能退化为 ERROR | faijs 侧放宽限制或优化代码生成（循环展开改写为 JS for 循环） |

---

## 9. 与既有方案文档的关系

| 文档 | 状态 | 本文关系 |
|---|---|---|
| `2026-10-07-analytic-semantics-parity-plan.md`（M9 方案） | 继续有效 | 本文是其进度总结，阶段 A 已完成，阶段 B/C 待推进 |
| `2026-10-07-faijs-tessellation-density-proposal.md` | 继续有效 | 阶段 2a 的技术方案基础 |
| `2026-10-09-candlestand-union-fuse-fuzzy-rootcause.md` | 继续有效 | 阶段 2b 的根因和修复方案 |
| `2026-10-06-kernel-op-implementation-plan.md`（内核方案） | 继续有效 | 阶段 1/3 的 op 能力实现基线（K01–K13） |
| `2026-10-06-progress-and-roadmap.md` | 已废弃 | 被 M9 方案取代 |
| `2026-10-09-structured-lower-*.md` | 继续有效 | 转换器结构化降级路线，与本进度并行 |

---

## 10. 验收终点

**50/50 examples 全部转换成功（0 blocked / 0 skipped），且 50/50 STL 对比在容差范围内完全一致。**

其中「一致」按 M9 方案的语义达成：两边是**同一个解析几何模型**、各自按语料参数三角化、
五维指标全部进容差。禁止用「改变模型迁就比对」达成 PASS。

当前距离验收终点的差距：
- **代码生成**：已达标（50/50）
- **STL 生成**：差 25 例（faijs op 能力缺口）
- **STL 一致性**：差 40 例（15 FAIL + 25 ERROR，其中 ERROR 修复后可能转为 FAIL 再转 PASS）
