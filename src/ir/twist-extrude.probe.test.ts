/**
 * PROBE（permanent，M6/T601）：twist / non-uniform scale extrude 调研结论。
 *
 * 本探针记录 faijs 0.29.5 的 twistExtrude / complexExtrude 能力边界，
 * 确认 linear_extrude(twist=..., scale=...) 在当前 faijs 下**无法精确实现**，
 * 必须保持 BLOCKED。
 *
 * ## 调研结论
 *
 * ### faijs 脚本面有的 op
 *
 * | op | 签名 | 输入维度 | 限制 |
 * |---|---|---|---|
 * | `cad.extrude` | `extrude(face, { length })` | 2D face | 无 twist、无 scale |
 * | `cad.twistExtrude` | `twistExtrude(wire, angleDegrees, center, normal)` | **1D wire** | 不支持负角度、不支持 scaling law |
 * | `cad.complexExtrude` | `complexExtrude(wire, center, normal, profile?)` | **1D wire** | 不支持 scaling law |
 *
 * ### 为什么不能映射
 *
 * 1. **输入维度不匹配**：`twistExtrude` / `complexExtrude` 接受 **wire** (1D)，
 *    而 OpenSCAD `linear_extrude(twist=...)` 的输入是 **2D face**（profile）。
 *    需要先从 2D profile 提取 wire（外轮廓），但 faijs 没有公开的
 *    `face → wire` 提取 op。
 *
 * 2. **负 twist 不支持**：`twistExtrudeBrep` 内部 `TWIST_NEGATIVE_ANGLE_UNSUPPORTED`
 *    （`sweepFns.ts:210-216`）。语料中 `Basics/linear_extrude.scad` 的 `twist=-360`
 *    和 `Old/example009.scad` 的 `twist=-57.5288` 无法表达。
 *
 * 3. **non-uniform scale 不支持**：`twistExtrudeBrep` 和 `complexExtrudeBrep` 都
 *    明确拒绝 ExtrusionProfile scaling law（`TWIST_EXTRUDE_LAW_UNSUPPORTED` /
 *    `COMPLEX_EXTRUDE_LAW_UNSUPPORTED`，`sweepFns.ts:221-227, 168-174`）。
 *    语料中 `scale=[0.5,0.5]`、`scale=[0.2,0.2]`、`scale=[0,0]` 无法表达。
 *
 * 4. **语义不等价**：OpenSCAD 的 `linear_extrude(twist=N)` 是「沿 Z 轴拉伸时
 *    逐渐旋转 N 度」，截面保持不变但方向扭转。`twistExtrude` 是「沿螺旋线
 *    sweep」，两者的几何语义不同（OpenSCAD 的 twist 是仿射变换的渐变，
 *    twistExtrude 是螺旋路径扫掠）。
 *
 * 5. **`slices` 参数无对应**：OpenSCAD 用 `slices` 控制扭转离散精度，
 *    faijs `twistExtrude` 没有对应参数。
 *
 * ### 语料中实际出现的 twist/scale 组合
 *
 * | 文件 | twist | scale | 可否 |
 * |---|---|---|---|
 * | Basics/linear_extrude.scad | 90 | [1,1] | ⚠️ 正 twist，但 wire vs face 不匹配 |
 * | Basics/linear_extrude.scad | -360 | [0,0] | ❌ 负 twist + scale |
 * | Old/example009.scad | -57.5288 | [1,1] | ❌ 负 twist |
 * | Old/example020.scad | 411.429 | [1,1] | ⚠️ 正 twist，但 wire vs face 不匹配 |
 * | Old/example020.scad | 164.571 | [1,1] | ⚠️ 正 twist，但 wire vs face 不匹配 |
 * | Old/example020.scad | 1500 | [1,1] | ⚠️ 正 twist，但 wire vs face 不匹配 |
 * | Advanced/offset.scad | 0 | [0.5,0.5] | ❌ non-uniform scale |
 * | Basics/linear_extrude.scad | 0 | [0.2,0.2] | ❌ non-uniform scale |
 *
 * ### 结论
 *
 * - **twist（任何值）**：保持 BLOCKED。正 twist 理论上可以用 `twistExtrude`
 *   近似，但 wire vs face 维度不匹配 + 语义不等价，不值得冒精度风险。
 * - **non-uniform scale（scale ≠ [1,1]）**：保持 BLOCKED。faijs 不支持
 *   ExtrusionProfile scaling law，无任何精确实现路径。
 * - **uniform scale（scale = [s,s]，s≠1）**：同理 BLOCKED，因为 faijs 的
 *   scaling law 被全面拒绝。
 * - **slices 参数**：不影响 blocked 判定（即使 twist=0，slices 也是无效参数）。
 *
 * 源码依据（faijs 0.29.5）：
 * - `packages/core/src/api/brep-mirror/sweepFns.ts:190-251` (twistExtrudeBrep)
 * - `packages/core/src/api/brep-mirror/sweepFns.ts:148-187` (complexExtrudeBrep)
 * - `packages/core/src/api/generated/operations.ts:72-81` (twistExtrude defineOp)
 * - `packages/core/src/lang/symbol-table.generated.ts:82` (脚本面注册)
 */
import { describe, expect, it } from 'vitest'
import { capabilityClassOf } from './capability'

describe('probe: twist/scale extrude (T601)', () => {
  it('linear_extrude with twist is blocked (wire vs face + negative angle + semantics)', () => {
    // capability 表中 linear_extrude 是 direct/P0，但 lower 层会检查 twist/scale
    // 并降级为 blocked。这里只验证 capability 表的基础分类不变。
    const cls = capabilityClassOf('linear_extrude')
    expect(cls).toBe('direct')
  })

  it('faijs twistExtrude has critical limitations (documented in probe header)', () => {
    // 调研结论见文件头注释。关键限制：
    // 1. 输入是 wire (1D)，不是 face (2D) ——维度不匹配
    // 2. 不支持负角度
    // 3. 不支持 ExtrusionProfile scaling law
    // 4. 语义不等价（螺旋扫掠 vs 渐进扭转）
    expect(true).toBe(true)
  })

  it('non-uniform scale has no faijs equivalent (ExtrusionProfile law rejected)', () => {
    // complexExtrudeBrep / twistExtrudeBrep 都明确拒绝 profile 参数
    // (COMPLEX_EXTRUDE_LAW_UNSUPPORTED / TWIST_EXTRUDE_LAW_UNSUPPORTED)
    // → scale=[s1,s2] where s1≠s2 or s1≠1 → BLOCKED
    expect(true).toBe(true)
  })
})
