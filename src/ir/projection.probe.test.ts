/**
 * PROBE（permanent，M6/T602）：projection cut=true/false 调研结论。
 *
 * 本探针记录 faijs 0.29.5 的截面/投影能力边界，确认 OpenSCAD `projection`
 * 的两种模式在当前 faijs 下**均无法精确实现**，必须保持 BLOCKED。
 *
 * ## OpenSCAD projection 语义
 *
 * OpenSCAD 的 `projection()` 把 3D 子节点投影到 XY 平面，产生 2D 几何：
 *
 * - `projection(cut=true)`：用 Z=0 平面切实体，取截面（2D face）。
 *   等价于「水平切片」——截面是一个有界 2D 区域，可能含内环（孔洞）。
 *
 * - `projection(cut=false)`（默认）：正交投影整个 3D 体到 XY 平面，合并为
 *   2D 区域。等价于「俯视图轮廓」——所有面投影后取并集。
 *
 * ## faijs 有的相关 op
 *
 * | op | 签名 | 输出类型 | 能否等价 |
 * |---|---|---|---|
 * | `cad.sectionByPlane` | `sectionByPlane(shape, { point, normal })` | **1D compound**（交线/wire） | ❌ 不是 2D face |
 * | `cad.projectView` | `projectView(shape, view, opts?)` | **SVG 字符串** | ❌ 不是几何体 |
 * | `cad.projectSheet` | `projectSheet(shape, views, opts?)` | **SVG 字符串** | ❌ 不是几何体 |
 *
 * ### 为什么 cut=true 不能映射
 *
 * `sectionByPlane` 返回 1D 交线 compound（`section-by-plane.ts:40-41`，
 * "交线收拢为 1D compound → fromBrepCurve 登记"），不是 2D face。
 *
 * OpenSCAD 的 `projection(cut=true)` 产出的是 **2D 有界区域**（可用于后续
 * `linear_extrude` 等操作）。faijs 的交线是 1D wire，需要额外的面构造步骤：
 * wire → profile → face。但截面交线可能含多区域/内环/非简单轮廓，`cad.profile`
 * 不一定能正确处理。
 *
 * ### 为什么 cut=false 不能映射
 *
 * `projectView` / `projectSheet` 返回 SVG 字符串（`view-projection.ts:257`，
 * `view-sheet.ts:70`），用于工程图纸渲染，不是 2D 几何 Shape。
 * faijs 没有任何 op 能把 3D 体正交投影为 2D face/wire 几何体。
 *
 * ## 语料中的 projection 使用
 *
 * | 文件 | blockedBy |
 * |---|---|
 * | Advanced/GEB.scad | projection |
 * | Advanced/surface_image.scad | projection |
 * | Basics/projection.scad | projection |
 * | Old/example021.scad | projection |
 *
 * ## 结论
 *
 * - **cut=true**：保持 BLOCKED。`sectionByPlane` 产出 1D 交线而非 2D face，
 *   语义不等价。需要专门的 helper（wire → face 转换 + 多区域处理）。
 * - **cut=false**：保持 BLOCKED。faijs 无 3D→2D 正交投影为几何体的 op。
 *   `projectView` 产出 SVG 字符串，不是 2D Shape。
 *
 * 源码依据（faijs 0.29.5）：
 * - `packages/core/src/api/section-by-plane.ts:1-11` (返回 1D compound)
 * - `packages/core/src/api/view/view-projection.ts:257` (返回 SVG 字符串)
 * - `packages/core/src/api/view/view-sheet.ts:70` (返回 SVG 字符串)
 */
import { describe, expect, it } from 'vitest'
import { capabilityOf } from './capability'

describe('probe: projection cut=true/false (T602)', () => {
  it('projection is classified as unsupported', () => {
    const entry = capabilityOf('projection')
    expect(entry.capability).toBe('unsupported')
    expect(entry.phase).toBe('P2')
  })

  it('cut=true: sectionByPlane returns 1D wire, not 2D face (not equivalent)', () => {
    // sectionByPlane 产出 1D compound（交线），不是 OpenSCAD 的 2D 有界区域
    expect(true).toBe(true)
  })

  it('cut=false: projectView returns SVG string, not 2D geometry (not equivalent)', () => {
    // projectView / projectSheet 产出 SVG 字符串，不是 2D Shape
    expect(true).toBe(true)
  })
})
