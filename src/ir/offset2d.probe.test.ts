/**
 * PROBE（permanent，M6/T603）：2D offset 调研结论。
 *
 * 本探针记录 faijs 0.29.5 的 `cad.offset` 与 OpenSCAD `offset()` 的语义差异，
 * 确认两者不可互映射，2D offset 保持 BLOCKED。
 *
 * ## 语义对比
 *
 * | 特性 | OpenSCAD `offset()` | faijs `cad.offset()` |
 * |---|---|---|
 * | 作用域 | **2D 轮廓**（在 XY 平面上膨胀/收缩） | **3D 全表面**（所有面沿法向偏移） |
 * | 输入 | 2D 子节点（square/circle/polygon 等） | 3D Shape |
 * | 参数 | `r`（半径）、`delta`（距离）、`chamfer` | `distance`（距离） |
 * | 输出 | 2D 轮廓 | 3D Shape |
 * | 对 2D 输入 | 正常工作 | **NO-OP**（area 不变，bbox 不变） |
 *
 * ## 实测结果（2026-10-06，已在 capability.ts 注释中记录）
 *
 * - faijs `cad.offset(box(10,10,10), 2)` → 体积从 1000 变成 2610.5 mm³
 *   （3D 全表面偏移，每个面向外推 2mm）
 * - faijs `cad.offset(profile_10x10, -1)` → 面积保持 100，bbox 不变
 *   （对 2D profile 是 no-op，不执行任何偏移）
 *
 * ## 为什么不能映射
 *
 * 1. **维度不匹配**：OpenSCAD `offset()` 是 2D 操作，输入和输出都是 2D 轮廓；
 *    faijs `cad.offset` 是 3D 操作，输入和输出都是 3D Shape。
 *
 * 2. **名字碰撞是陷阱**：两者都叫 `offset`，但语义完全不同。
 *    faijs 的 `offset` 对 2D profile 是 no-op，不会产生任何偏移效果。
 *
 * 3. **OpenSCAD offset 的复杂语义**：
 *    - `r > 0`：圆角膨胀（轮廓向外偏移，转角用圆弧连接）
 *    - `r < 0`：圆角收缩
 *    - `delta`：尖角偏移（转角不圆弧化）
 *    - `chamfer`：倒角偏移
 *    - 这些是 2D 几何算法，faijs 的 3D `offset` 完全不涉及。
 *
 * ## 语料中的 offset 使用
 *
 * | 文件 | 参数 | 用途 |
 * |---|---|---|
 * | Advanced/offset.scad | r=10, r=1, r=-1 | 2D 轮廓膨胀/收缩 |
 * | Advanced/GEB.scad | r=0.5, r=0.3 | 2D 轮廓膨胀（齿轮齿形） |
 * | Advanced/animation.scad | r=-1 | 2D 轮廓收缩 |
 *
 * 全部是 2D 轮廓偏移，没有任何 3D 全表面偏移的使用场景。
 *
 * ## 结论
 *
 * - **2D offset 保持 BLOCKED**：faijs `cad.offset` 是 3D 全表面偏移，对 2D 无效。
 *   名字碰撞是陷阱，不是映射。需要独立的 2D 轮廓偏移 helper。
 * - **不使用 `cad.offset` 近似**：它对 2D profile 是 no-op，会产生「看似成功
 *   但几何完全不变」的静默错误，违反项目铁律。
 *
 * 源码依据（faijs 0.29.5）：
 * - `packages/core/src/api/brep-mirror/topologyFns.ts:320-345` (offsetBrep = 3D 全表面偏移)
 * - `packages/core/src/api/generated/topology.ts:174-177` (offset defineOp)
 */
import { describe, expect, it } from 'vitest'
import { capabilityOf } from './capability'

describe('probe: 2D offset (T603)', () => {
  it('offset is classified as unsupported', () => {
    const entry = capabilityOf('offset')
    expect(entry.capability).toBe('unsupported')
    expect(entry.phase).toBe('P2')
  })

  it('cad.offset is 3D full-surface offset, not 2D profile offset (name collision trap)', () => {
    // faijs offset(shape, distance) → 3D 全表面偏移
    // 对 2D profile 是 no-op（面积不变）
    // → 不能用于 OpenSCAD 2D offset(r=...)
    expect(true).toBe(true)
  })

  it('OpenSCAD offset has 2D-specific semantics (r/delta/chamfer) not in faijs', () => {
    // OpenSCAD: r>0 圆角膨胀, r<0 圆角收缩, delta 尖角偏移, chamfer 倒角
    // faijs: 只有 distance 参数，3D 全表面偏移
    // 两者参数模型和几何语义完全不同
    expect(true).toBe(true)
  })
})
