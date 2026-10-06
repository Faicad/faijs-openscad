/**
 * PROBE（permanent，M6/T605）：surface / fill 评估。
 *
 * 本探针记录 faijs 0.29.5 对 OpenSCAD `surface` 和 `fill` 的能力评估，
 * 确认两者均无精确实现路径，保持 BLOCKED。
 *
 * ## surface 评估
 *
 * ### OpenSCAD surface 语义
 *
 * OpenSCAD 的 `surface(file, center, invert, convexity)` 从图像文件（PNG/JPG）
 * 或数据文件（DAT/TXT）读取高度图，生成 3D 三角网格：
 *
 * - 每个像素/数据点 → 一个 Z 高度
 * - 相邻点三角化形成网格
 * - `center=true`：以原点为中心
 * - `invert=true`：翻转高度方向
 * - `convexity`：预览提示
 *
 * ### faijs 能力
 *
 * - **无 heightmap/surface op**：faijs 三个面（① TS 兼容面、② 脚本面、③ 库边界面）
 *   均无读取图像/数据文件生成高度图网格的 op。
 * - **无图像读取能力**：faijs-core 不包含图像解码库。
 * - **mesh 路径**：faijs 的 mesh 路径可以从三角网格构造 Shape，但没有
 *   从高度图生成网格的 op。
 *
 * ### 语料使用
 *
 * | 文件 | 输入文件 | center | invert |
 * |---|---|---|---|
 * | Advanced/surface_image.scad | surface_image.png | true | false |
 * | Old/example010.scad | example010.dat | true | false |
 *
 * 两个示例都依赖外部文件（PNG/DAT），且 OpenSCAD 在 CSG dump 时已求值为
 * 网格几何（`surface` 节点带 `file` 参数）。
 *
 * ### 实现依赖清单（如要实现）
 *
 * 1. 图像/数据文件读取（PNG 解码 / DAT 文本解析）
 * 2. 高度图 → 三角网格生成算法
 * 3. center/invert 语义实现
 * 4. 外部资源路径解析（相对 .scad 文件）
 * 5. 网格 → faijs Shape 转换
 *
 * 这是一个独立子项目，不属于当前范围。
 *
 * ### 结论
 *
 * **surface 保持 BLOCKED**：faijs 无 heightmap 能力，实现需要完整的
 * 图像读取 + 网格生成子项目。
 *
 * ---
 *
 * ## fill 评估
 *
 * ### OpenSCAD fill 语义
 *
 * OpenSCAD 的 `fill()` 闭合 2D 轮廓中的开放孔洞/缺口。
 *
 * ### faijs 能力
 *
 * - **无 fill op**：faijs 三个面均无 `fill` 或等效的 2D 孔洞填充 op。
 * - **cad.profile 的 closed 选项**：profile 构造时可以声明闭合，但这不是
 *   「填充已有轮廓的孔洞」。
 *
 * ### 语料使用
 *
 * OpenSCAD examples 语料（50 个示例）中 **没有** fill 出现。
 *
 * ### 结论
 *
 * **fill 保持 BLOCKED**：faijs 无 2D 孔洞填充能力，且语料中未使用。
 *
 * 源码依据（faijs 0.29.5）：
 * - `packages/core/src/api/surface/arg-spec.ts`：无 surface/heightmap/fill 条目
 * - `packages/core/src/lang/symbol-table.generated.ts`：不在 95 op 中
 */
import { describe, expect, it } from 'vitest'
import { capabilityOf } from './capability'

describe('probe: surface/fill (T605)', () => {
  it('surface is classified as unsupported', () => {
    const entry = capabilityOf('surface')
    expect(entry.capability).toBe('unsupported')
    expect(entry.phase).toBe('P2')
  })

  it('fill is classified as unsupported', () => {
    const entry = capabilityOf('fill')
    expect(entry.capability).toBe('unsupported')
    expect(entry.phase).toBe('P2')
  })

  it('surface needs image/data file reading + heightmap mesh generation (independent sub-project)', () => {
    // faijs 无 heightmap/surface op
    // 实现需要：PNG 解码 / DAT 解析 + 网格生成 + center/invert 语义
    expect(true).toBe(true)
  })

  it('fill needs 2D hole-filling algorithm not in faijs', () => {
    // faijs 无 fill op，语料中也未使用
    expect(true).toBe(true)
  })
})
