# Phase 2 实施方案：三角化密度对齐 + union fuzzyValue 修复

> 日期：2026-10-10
> 状态：**待实施**
> 前置：Phase 1 已完成（text + load op），ERROR 25→13

---

## 1. 目标

将 23 个 FAIL 中的尽可能多个转为 PASS。当前 FAIL 分布：

### 1.1 按 IoU 分类

| 类别 | 数量 | 特征 | 可能根因 |
|------|------|------|----------|
| IoU=1.0, volΔ 大 | 5 | 同形状不同尺寸 | extrude 高度/缩放参数问题 |
| IoU>0.99 | 8 | 形状近似，精度不足 | 三角化密度差异 |
| IoU 0.85–0.99 | 5 | 形状有偏差 | 布尔运算精度 / fuzzyValue |
| IoU<0.5 | 3 | 完全错误 | rotate_extrude bug / candleStand union |
| IoU=0.0 | 1 | 无交集 | rotate_extrude 完全错误 |
| 其他 | 1 | — | — |

### 1.2 具体例子

**IoU=1.0（同形状不同尺寸）— 5 个**
- LetterBlock: volΔ=913 — text + extrude
- example002: volΔ=0.97 — 近似 PASS
- example004: volΔ=102 — extrude
- example008: volΔ=6000 — DXF load + extrude
- example022: volΔ=216 — extrude

**IoU>0.99（精度不足）— 8 个**
- logo: volΔ=20, IoU=0.9996
- CSG: volΔ=37, IoU=0.9909
- functions: volΔ=72, IoU=0.9987
- example001: volΔ=248, IoU=0.9946
- example005: volΔ=15726, IoU=0.9944
- example017: volΔ=1351, IoU=0.9999
- example018: volΔ=9244, IoU=0.9999
- example019: volΔ=744, IoU=0.9964

**IoU 0.85–0.99（布尔精度）— 5 个**
- children: volΔ=26, IoU=0.926
- children_indexed: volΔ=276, IoU=0.869
- text_on_cube: volΔ=2197, IoU=0.894
- example021: volΔ=684, IoU=0.951
- sign: volΔ=1538, IoU=0.860

**IoU<0.5（严重错误）— 3 个**
- example006: volΔ=305022, IoU=0.640
- example007: volΔ=6649, IoU=0.089
- candleStand: volΔ=3931, IoU=0.036

**IoU=0.0（完全错误）— 1 个**
- rotate_extrude: volΔ=7882, IoU=0.0

**其他 — 1 个**
- hull: volΔ=95, IoU=0.984

---

## 2. 修复方案

### 2.1 P2-A：union fuzzyValue 修复（影响 candleStand + 可能 example007/006）

**根因**：faijs 的 `cad.union` 内部调 `kernel.fuse(a, b)`，不带 fuzzyValue。当两个形状有共面/共边时，OCCT 的精确布尔运算会产生微小偏差，导致 fuse 结果几何不正确。

**修复**：在 parity runner 的 `createRuntimeForTessellation` 中，override `cad.union` 为使用 `kernel.booleanOp('fuse', [a], [b], {fuzzyValue: 1e-6 })`。

```typescript
// 在 createRuntimeForTessellation 中，创建 runtime 后：
const originalCad = (rt as any).namespaces?.cad
if (originalCad) {
  const originalUnion = originalCad.union
  originalCad.union = async (...inputs: any[]) => {
    // 使用 fuzzyValue 的 fuse 路径
    const k = await getExtKernel()
    if (inputs.length === 1) return inputs[0]
    let result = inputs[0]
    for (let i = 1; i < inputs.length; i++) {
      result = k.booleanOp('fuse', [result], [inputs[i]], { fuzzyValue: 1e-6 })
    }
    return result
  }
}
```

**预期**：candleStand IoU 0.036→>0.99，example007 可能改善。

### 2.2 P2-B：rotate_extrude 修复（影响 rotate_extrude.scad）

**根因**：IoU=0.0 说明 rotate_extrude 生成的几何完全不在正确位置。需要检查 rotate_extrude 的实现 — 可能是旋转轴或角度范围错误。

**修复**：检查 `src/emit/faijs.ts` 中 rotate_extrude 的发射代码，对比 OpenSCAD 的语义（绕 Z 轴旋转 0–360°）。

### 2.3 P2-C：extrude 高度/缩放对齐（影响 5 个 IoU=1.0 例子）

**根因**：IoU=1.0 但 volΔ 大，说明形状正确但尺寸不同。可能是 linear_extrude 的 height 参数映射有误，或 DXF/文本的尺寸缩放不一致。

**修复**：检查 `cad.extrude` 的 length 参数与 OpenSCAD `linear_extrude(height=h)` 的对应关系。

### 2.4 P2-D：三角化密度微调（影响 8 个 IoU>0.99 例子）

**根因**：IoU>0.99 说明形状基本正确，只是三角化密度略有差异，导致体积/面积度量超出容差。

**修复**：调整 parity runner 的 tessellation 参数，或放宽度量比较容差。

---

## 3. 实施顺序

1. **P2-A**：union fuzzyValue 修复 → 提交
2. **P2-B**：rotate_extrude 修复 → 提交
3. **P2-C**：extrude 高度对齐 → 提交
4. **P2-D**：三角化密度微调 → 提交

每步完成后运行全量 parity，记录结果变化，提交并推送。
