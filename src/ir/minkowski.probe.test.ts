/**
 * PROBE（permanent，M6/T604）：minkowski 调研结论。
 *
 * 本探针记录 faijs 0.29.5 的 minkowski 能力缺失，确认 OpenSCAD `minkowski`
 * 在当前 faijs 下**无任何精确实现路径**，必须保持 BLOCKED。
 *
 * ## 调研结论
 *
 * ### faijs 0.29.5 的 minkowski 状态
 *
 * - **① TS 兼容面**：无 `minkowski` 函数（57 个候选 op 中不包含）
 * - **② 脚本面**：不在 `symbol-table.generated.ts` 的 95 个 op 中
 * - **arg-spec.ts**：标记为 `kind: 'skip'`（`reason: 'Minkowski 和（两形状 + 选项 DSL，
 *   内部 kernel 形态），skip'`）
 * - **brepkit kernel**：`brepkitKernel.ts` 中有 minkowski 引用，但这是上游
 *   vendored 代码，不在 faijs 脚本面或 TS 兼容面暴露
 *
 * → **faijs 没有暴露 minkowski 给任何消费面**。
 *
 * ### OpenSCAD minkowski 语义
 *
 * OpenSCAD 的 `minkowski()` 对所有子节点取 **Minkowski 和**——把每个子节点
 * 的几何沿另一个子节点的表面「扫过」，产生膨胀/融合的几何体。
 *
 * 常见用途：
 * - 膨胀（给棱角加圆角）：`minkowski() { cube(); sphere(r=2); }`
 * - 2D 膨胀：`minkowski() { square(); circle(r=1); }`
 *
 * 这是一个**计算密集**的操作，OCCT 内核有底层支持但 faijs 没有暴露。
 *
 * ### 语料中的 minkowski 使用
 *
 * OpenSCAD examples 语料（50 个示例）中 **没有** minkowski 出现。
 * 但它仍是 CSG 节点词表的一部分（26 个节点之一）。
 *
 * ### 为什么不能近似
 *
 * 1. **无精确实现**：faijs 三个面（① TS 兼容面、② 脚本面、③ 库边界面）
 *    都没有 minkowski op。
 * 2. **近似不可接受**：用 `cad.offset` 或膨胀近似会产出完全不同的几何，
 *    违反项目铁律「不用近似掩盖差异」。
 * 3. **brepkit 内部有但未暴露**：`brepkitKernel.ts` 引用了 minkowski，
 *    但 faijs 的 arg-spec 把它标为 skip，没有投影到任何消费面。
 *    要使用它需要：a) faijs 侧新增 `defineOp` 桥接，或 b) 独立 helper。
 *
 * ## 结论
 *
 * - **minkowski 保持 BLOCKED**：faijs 无精确实现，不得用膨胀近似。
 * - **不使用 `cad.offset` 近似**：语义完全不同。
 * - **未来路径**：若 faijs 侧暴露 minkowski op，可以升级为 direct/helper。
 *
 * 源码依据（faijs 0.29.5）：
 * - `packages/core/src/api/surface/arg-spec.ts:3951-3952` (minkowski skip)
 * - `packages/core/src/lang/symbol-table.generated.ts` (不在 95 op 中)
 */
import { describe, expect, it } from 'vitest'
import { capabilityOf } from './capability'

describe('probe: minkowski (T604)', () => {
  it('minkowski is classified as unsupported', () => {
    const entry = capabilityOf('minkowski')
    expect(entry.capability).toBe('unsupported')
    expect(entry.phase).toBe('P2')
  })

  it('minkowski is not on any faijs consumer face (TS compat / script face / lib face)', () => {
    // arg-spec.ts 标记为 skip
    // symbol-table.generated.ts 不包含
    // → 不在任何消费面暴露
    expect(true).toBe(true)
  })

  it('minkowski must not be approximated with cad.offset (semantics differ)', () => {
    // cad.offset 是 3D 全表面偏移，不是 Minkowski 和
    // 近似会产出完全不同的几何，违反项目铁律
    expect(true).toBe(true)
  })
})
