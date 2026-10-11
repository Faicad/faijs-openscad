# Phase 2 实施方案：三角化密度对齐 + union fuzzyValue 修复

> 日期：2026-10-10
> 状态：**P2-A 已完成，P2-B 已完成（有 1 例回归），P2-C/D 待推进**
> 前置：Phase 1 已完成（text + load op），ERROR 25→13

---

## 1. 目标

将 23 个 FAIL 中的尽可能多个转为 PASS。

---

## 2. 修复方案与进度

### 2.1 P2-A：union fuzzyValue 修复 ✅ 已完成

**根因**：faijs 的 `cad.union` 内部调 `kernel.fuse(a, b)`，不带 fuzzyValue。当两个形状有共面/共边时，OCCT 的精确布尔运算会静默丢弃部分输入。

**修复**：在 emitter (`src/emit/faijs.ts`) 中，将所有 3D `cad.union(a, b, ...)` 调用替换为 `__union` helper 函数，内部使用 `cad.boolean([a], [b, ...], 'fuse', { fuzzyValue: 1e-6 })`。

**结果**：
- candleStand: IoU 0.036 → 0.9998, volΔ 3931 → 40（仍 FAIL，需 P2-D 密度微调）
- 6 个 PASS 例子无回归
- 已提交：commit `9bcbf2b`，已推送到 gitcode

---

### 2.2 P2-B：rotate_extrude 修复 ✅ 已完成（有 1 例回归）

**根因**：
- OpenSCAD `rotate_extrude` 语义：先将 2D (x,y) 映射到 3D (x,0,y)（即 XY→XZ 平面），再绕 Z 轴旋转
- faijs `cad.revolve` 以 axis [0,0,1] 旋转 XY 平面内的 2D 轮廓时，结果**完全扁平**（Z 范围 [0,0]，体积=0，IoU=0.0）

**尝试过程**：

| 尝试 | 方案 | 结果 |
|------|------|------|
| 1 | applyMatrix 旋转轮廓从 XY→XZ，再 revolve around Z | ❌ `revolve: construction failed`（applyMatrix 把 2D face 转成 3D shape，revolve 不接受） |
| 2 | revolve around Y 轴，再 applyMatrix 旋转结果 Y→Z | ✅ 成功！ |

**最终修复**（尝试 2）：
- 在 emitter `revolve` 分支中，将 revolve axis 从 [0,0,1] 改为 [0,1,0]（Y 轴）
- revolve 后用 `cad.applyMatrix(result, [[1,0,0,0],[0,0,-1,0],[0,1,0,0],[0,0,0,1]])` 旋转 90° 绕 X 轴，将高度从 Y 映射到 Z
- 更新了 `src/emit/faijs.test.ts` 中 2 个 rotate_extrude 测试用例

**验证结果**：

| 例子 | 修复前 | 修复后 | 变化 |
|------|--------|--------|------|
| Basics/rotate_extrude.scad | FAIL, IoU=0.0, vol=0 | FAIL, IoU=0.913, vol=6970 | 大幅改善 |
| Old/example007.scad | FAIL, IoU=0.089 | ERROR (revolve construction failed) | 回归 |

- rotate_extrude 候选 bbox: X[-15,57.5] Y[-15,57.5] Z[-2,20] — 接近参考 bbox X[-15,57.5] Y[-14.9,57.4] Z[-0.14,20]
- 剩余 IoU 差距 (0.913 vs 0.999) 可能来自 text(" J") 部分渲染差异和三角化密度差异
- example007 回归原因：DXF import 产生的轮廓类型与 `cad.profile` 不同，Y 轴 revolve 不接受该类型。该例原本 IoU=0.089 已严重错误，回归影响可接受

**Parity 状态**：PASS 6, PASS-NT 8, FAIL 22, ERROR 14（vs 修复前 PASS 6, PASS-NT 8, FAIL 23, ERROR 13）

**直接 API 测试验证**：
- Z 轴 revolve: 产出扁平几何（Z[0,0]），体积=0
- Y 轴 revolve: 产出正确 3D 几何（X/Z 为圆形截面，Y 为高度）
- X 轴 revolve: 产出 3D 几何但轴向不匹配 OpenSCAD 语义

---

### 2.3 P2-C：extrude 高度/缩放对齐（影响 5 个 IoU=1.0 例子）⏳ 待推进

**根因**：IoU=1.0 但 volΔ 大，说明形状正确但尺寸不同。可能是 linear_extrude 的 height 参数映射有误，或 DXF/文本的尺寸缩放不一致。

**修复**：检查 `cad.extrude` 的 length 参数与 OpenSCAD `linear_extrude(height=h)` 的对应关系。

**影响例子**：LetterBlock (volΔ=913), example002 (volΔ=0.97), example004 (volΔ=102), example008 (volΔ=6000), example022 (volΔ=216)

---

### 2.4 P2-D：三角化密度微调（影响 8 个 IoU>0.99 例子）⏳ 待推进

**根因**：IoU>0.99 说明形状基本正确，只是三角化密度略有差异，导致体积/面积度量超出容差。

**修复**：调整 parity runner 的 tessellation 参数，或 per-primitive deflection 策略。

**影响例子**：logo, CSG, functions, example001, example005, example017, example018, example019
另外 candleStand (IoU=0.9998, volΔ=40) 和 rotate_extrude (IoU=0.913) 也可能受益于此。

---

## 3. 实施顺序与状态

| 步骤 | 状态 | 提交 | 说明 |
|------|------|------|------|
| P2-A union fuzzyValue | ✅ 完成 | `9bcbf2b` | candleStand IoU 0.036→0.9998 |
| P2-B rotate_extrude | ✅ 完成 | 待提交 | rotate_extrude IoU 0.0→0.913；example007 回归 FAIL→ERROR |
| P2-C extrude 高度对齐 | ⏳ 待推进 | — | 5 个 IoU=1.0 例子 |
| P2-D 三角化密度微调 | ⏳ 待推进 | — | 8+2 个 IoU>0.99 例子 |

---

## 4. P2-B 尝试记录

### 尝试 1：applyMatrix 旋转轮廓（2026-10-11）❌

**方案**：在 emitter `revolve` 分支中，先 `cad.applyMatrix` 将 2D 轮廓从 XY 平面旋转到 XZ 平面，再 `cad.revolve` 绕 Z 轴旋转。

**修改**：
- `src/emit/faijs.ts`：revolve 分支插入 applyMatrix 调用
- `src/emit/faijs.test.ts`：更新 2 个 rotate_extrude 测试用例

**结果**：
- emitter 测试：40/40 通过 ✅
- parity 运行：`CONSTRUCTION_FAILED: revolve: construction failed` ❌
- 原因：`cad.applyMatrix` 旋转 2D face 后产出 3D shape，`cad.revolve` 只接受 planar face

### 尝试 2：Y 轴 revolve + 后旋转（2026-10-11）✅

**方案**：不旋转轮廓，而是将 revolve axis 改为 [0,1,0]（Y 轴），revolve 后用 applyMatrix 旋转结果 90° 绕 X 轴将 Y→Z。

**修改**：
- `src/emit/faijs.ts`：revolve 分支改用 Y 轴 + 后旋转
- `src/emit/faijs.test.ts`：更新 2 个测试用例

**结果**：
- emitter 测试：40/40 通过 ✅
- lower/probe 测试：68/68 通过 ✅
- parity 运行：rotate_extrude IoU 0.0→0.913 ✅
- 回归：example007 FAIL→ERROR（DXF 导入轮廓类型不兼容 Y 轴 revolve）

**API 验证**：
- 直接测试 `cad.revolve` 三个轴：
  - Z 轴 [0,0,1]：产出扁平几何（Z[0,0]），体积=0
  - Y 轴 [0,1,0]：产出正确 3D 几何（X/Z 圆形截面，Y 高度）
  - X 轴 [1,0,0]：产出 3D 几何但轴向不匹配

---

## 5. 后续注意事项

1. **example007 回归**：DXF import + rotate_extrude 组合在 Y 轴 revolve 下崩溃。需调查 DXF 导入产出的 shape 类型，可能需要在 revolve 前做类型转换。优先级低（原本 IoU=0.089）。

2. **rotate_extrude 剩余差距**：IoU=0.913 vs 0.999，可能来自：
   - text(" J") 部分渲染差异
   - 三角化密度差异（$fn=80 设置）
   - 后旋转 applyMatrix 引入的小误差
   这些可在 P2-D 三角化密度微调中一并处理。

3. **P2-C 是下一个优先项**：5 个 IoU=1.0 例子（形状正确但尺寸不同），根因更明确（extrude height 参数映射），不涉及 faijs API 行为不确定性。
