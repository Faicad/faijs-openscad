# candleStand union 丢几何 — 根因分析报告

**日期**：2026-10-09
**状态**：根因已定位，faijs 侧修复另行排期
**影响**：`tests/fixtures/openscad-examples/example023.scad`（candleStand）parity 测试 FAIL（IoU=0.036）

## 症状

candleStand 模型中 `part102 = cad.union(part0_cone, part4_ring, part79, part101)` 的结果体积 = 1277，
**恰好等于 part101 单独的体积**——cone 和 ring 被完全丢弃。

最终输出与期望 STL 的 IoU = 0.036（几乎完全不匹配）。

## 根因

### faijs `cad.union` 的 fuse 路径不带容差

faijs `packages/core/src/api/boolean.ts` 的 `booleanBrep` 函数（line 46-195），
对 `'union'` 操作走 `kernel.fuse(a, b)` 或 `kernel.fuseWithHistory(a, b)`——这两个 OCCT kernel 方法
**不接受 `fuzzyValue` 参数**，等同于 `BRepAlgoAPI_Fuse` 无容差模式。

### OCCT 对退化几何静默产出错误结果

candleStand 的 cone 由 7 个 box 在中心重叠构成，形成退化几何（共面、共边、精确重叠）。
OCCT `BRepAlgoAPI_Fuse` 在无容差模式下对这类输入会**静默产出合法但错误**的结果：
- `shape.isValid()` 返回 `true`
- 但几何内容丢失（cone 和 ring 被丢弃，只剩 part101）

### `kernel.booleanOp` 带 fuzzyValue 时正确

OCCT kernel 的 `booleanOp(op, args, tools, { fuzzyValue })` 方法走 `BRepAlgoAPI_Fuse` 的 fuzzy 参数路径，
能正确处理退化几何。探针验证：

| 调用 | 结果体积 | 正确？ |
|------|---------|--------|
| `cad.union(part0, part101)` | 1277 (= part101) | ❌ 丢 cone |
| `cad.union(part0, part79)` | 3484 | ✅ |
| `cad.union(part0, part101 平移后不重叠)` | 1643 | ✅ |
| `cad.boolean([part0],[part101],'fuse',{fuzzyValue:0.01})` | 1607 | ✅ |
| `cad.boolean([part0],[part101],'fuse')` (无 fuzzy) | 1277 | ❌ 丢 cone |
| `cad.boolean([part0],[part101],'fuse',{fuzzyValue:1e-4})` | 1607 | ✅ |
| `cad.boolean([part0],[part101],'fuse',{fuzzyValue:1e-6})` | 1607 | ✅ |

fuzzyValue 在 1e-6 ~ 1e-2 范围内均可修复。

### NON_SOLID 过滤不是原因

faijs `boolean.ts:80-94` 有一个 NON_SOLID 过滤，会跳过非 solid shapeType 的输入。
探针确认所有输入 shapeType 为 solid/compound，boolIdx 包含全部输入——过滤不是本问题的原因。

## 修复方案（faijs 侧）

在 `C:\my\Faicad\faijs\packages\core\src\api\boolean.ts` 的 `booleanBrep` 函数中，
将 `'union'` 操作的 fuse 路径从 `kernel.fuse(a, b)` 改为 `kernel.booleanOp('fuse', [a], [b], { fuzzyValue })`，
带一个默认小容差（如 `fuzzyValue = 1e-6`，或暴露为 `cad.union(..., { fuzzyValue })` 选项）。

这样所有 union 调用都走 OCCT 的 fuzzy 参数路径，能正确处理退化几何，
同时不影响正常几何（fuzzyValue 足零时行为等价于无容差）。

### 风险

- fuzzyValue 过大可能导致正常几何被错误合并。1e-6 是安全保守的默认值。
- 需要在 faijs 侧运行回归测试确认无副作用。

## 临时规避（emitter 侧，未采用）

本项目的 emitter 可以把 3D union 改发 `cad.boolean([a, b, ...], [], 'fuse', { fuzzyValue: 1e-6 })`，
但这只是治标——所有 faijs 用户的 `cad.union` 都会碰到这个 bug。按用户铁律，应在 faijs 侧修复。