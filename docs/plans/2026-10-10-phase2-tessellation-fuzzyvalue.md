# Phase 2 实施方案：三角化密度对齐 + union fuzzyValue 修复

> 日期：2026-10-10
> 状态：**P2-A ✅, P2-B ✅, P2-C 调查完成（根因重新归类到 P2-D）, P2-D 待推进**
> 前置：Phase 1 已完成（text + load op），ERROR 25→13

---

## 2. 修复方案与进度

### 2.1 P2-A：union fuzzyValue 修复 ✅ 已完成

**修复**：emitter 中 3D union 改用 `__union` helper（`cad.boolean` + `fuzzyValue=1e-6`）。
**结果**：candleStand IoU 0.036→0.9998。已提交 `9bcbf2b`。

### 2.2 P2-B：rotate_extrude 修复 ✅ 已完成

**根因**：faijs `cad.revolve` 以 Z 轴旋转 XY 平面 2D 轮廓产出扁平几何（vol=0）。
**修复**：改用 Y 轴 `[0,1,0]` revolve + 后旋转 `applyMatrix` 将 Y→Z。
**结果**：rotate_extrude IoU 0.0→0.913。example007 回归 FAIL→ERROR（DXF 轮廓类型不兼容 Y 轴 revolve）。
已提交 `9d27413`。

### 2.3 P2-C：extrude 高度对齐 — 调查完成，根因重新归类

**原假设**：IoU=1.0 但 volΔ 大 → extrude height 参数映射有误。

**调查结果**：假设不成立。逐例检查：

| 例子 | volΔ (rel) | 根因 | 归类 |
|------|-----------|------|------|
| LetterBlock | 913 (7%) | text 渲染差异（字形轮廓不同） | text op |
| example004 | 102 (4.5%) | cube - sphere，球面三角化密度差异 | P2-D |
| example008 | 6000 (12.2%) | DXF import 轮廓面积差异 | DXF op |
| example022 | 216 (0.5%) | cylinder/sphere 刻面密度差异 | P2-D |
| example002 | 0.97 (0.0%) | 近似 PASS，三角化微差 | P2-D |

**验证**：
- `MM` 常量 = 1（faijs 运行时确认），`cad.extrude(profile, { length: 50 * MM })` 产出正确高度 0→50
- bbox 完全一致，说明形状和尺寸正确，体积差异来自曲面刻面密度

**结论**：P2-C 的 5 个例子中，3 个归入 P2-D（三角化密度），1 个归入 text op（LetterBlock），1 个归入 DXF op（example008）。extrude height 映射无问题，P2-C 无需代码修复。

### 2.4 P2-D：三角化密度微调 ⏳ 待推进

**根因**：faijs BREP 保存精确解析曲面，三角化在导出时发生；OpenSCAD 全程是刻面多面体，`$fa/$fs/$fn` 在创建时即决定面数。两种引擎的三角化模型存在系统性偏差。

**影响例子**（IoU>0.99 但度量超容差）：
- logo: IoU=0.9996, volΔ=20 (0.1%)
- CSG: volΔ=37, IoU=0.991
- functions: volΔ=72, IoU=0.999
- example001: volΔ=248, IoU=0.995
- example004: volΔ=102, IoU=1.0
- example005: volΔ=15726, IoU=0.994
- example017: volΔ=1351, IoU=1.0
- example018: volΔ=9244, IoU=1.0
- example019: volΔ=744, IoU=0.996
- example022: volΔ=216, IoU=1.0
- candleStand: IoU=0.9998, volΔ=40
- rotate_extrude: IoU=0.913, volΔ=911

**修复方向**：调整 parity runner 的 tessellation 参数（angularDeflection / linearDeflection），使 OCCT 三角化密度更接近 OpenSCAD 的 `$fa/$fs/$fn` 语义。

---

## 3. 实施顺序与状态

| 步骤 | 状态 | 提交 | 说明 |
|------|------|------|------|
| P2-A union fuzzyValue | ✅ 完成 | `9bcbf2b` | candleStand IoU 0.036→0.9998 |
| P2-B rotate_extrude | ✅ 完成 | `9d27413` | rotate_extrude IoU 0.0→0.913 |
| P2-C extrude 高度对齐 | ✅ 调查完成 | 无需代码修复 | 根因重新归类到 P2-D / text op / DXF op |
| P2-D 三角化密度微调 | ⏳ 待推进 | — | 12 个例子 |

---

## 4. 当前 Parity 状态

| Verdict | 数量 | 说明 |
|---------|------|------|
| PASS | 6 | 五维指标全在容差内 |
| PASS-NT | 8 | 执行成功但无参考 STL |
| FAIL | 22 | STL 生成成功但度量超容差 |
| ERROR | 14 | faijs 执行失败 |
| Total | 50 | |
