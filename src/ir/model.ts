/**
 * Model IR（plan §4.3，M2）。
 *
 * IR 是 CSG AST 与 faijs 代码之间的**唯一**中间层。它与 AST 的区别是刻意的：
 *
 *  - AST 忠实于 CSG 文本（位置参数、`;` vs `{}`、未知参数一律保留）；
 *    IR 只保留**几何语义**——默认参数已补全、`group` 已归一、
 *    修饰符策略已裁决、每个节点的 2D/3D 维度已推断。
 *  - IR 不含字符串模板。emitter 消费 IR 生成源码，因此「怎么排版」和
 *    「语义是什么」不会互相污染。
 *
 * 维度：`dimension` 只在**几何节点**上有意义（`2d` 面 / `3d` 实体）。
 * 布尔与变换的组合维度由子节点决定并在 lower 时校验，因此 emitter 不需要
 * 再猜；`IrEmpty` 与 `IrBlocked` 没有维度。
 *
 * 每个节点都带 `IrOrigin`（CSG 源区间）——这是诊断回指源位置的唯一依据，
 * 也是 emitter 输出稳定注释的依据。
 */
import type { Span } from '../diagnostics/diagnostic'

/**
 * 2D 面 / 3D 实体 / 未知。
 *
 * IR 不表达 `mixed`：混合在 lower 阶段就是错误（OSC2003）。但 `unknown` 是必需
 * 的第三态——当一个组合节点的子节点**全部**是 `IrBlocked`（或空）时，它的维度
 * 客观未知：既不能宣称是 2D，也不能宣称是 3D。把它折成 `empty` 会让范围外节点
 * 在树上消失（2026-10-06 实测踩到：7 个含范围外节点的 example 因此被误报为
 * 「转换成功」），折成 `2d`/`3d` 则是编造事实。
 */
export type IrDimension = '2d' | '3d' | 'unknown'

export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]
export type Vec4 = readonly [number, number, number, number]
/** 行主序 4×4（与 OpenSCAD `multmatrix`、faijs `applyMatrix` 逐字一致）。 */
export type Matrix4 = readonly [Vec4, Vec4, Vec4, Vec4]

export interface IrOrigin {
  /** CSG 节点序号（lower 时按前序分配，稳定且可复现）。 */
  readonly nodeId: number
  /** CSG 源区间。 */
  readonly span: Span
  /** CSG 源文件（若已知）。 */
  readonly path?: string
  /** 原始 CSG 节点名，用于诊断消息与注释（如 `cube`、`linear_extrude`）。 */
  readonly csgNode: string
}

interface IrCommon {
  readonly id: number
  readonly origin: IrOrigin
}

interface IrSolid extends IrCommon {
  readonly dimension: '3d'
}

interface IrPlanar extends IrCommon {
  readonly dimension: '2d'
}

// ── 3D 图元 ────────────────────────────────────────────────────────────────

/** `cube(size, center)` → `cad.box(w, d, h, { centered })`。 */
export interface IrBox extends IrSolid {
  readonly kind: 'box'
  readonly width: number
  readonly depth: number
  readonly height: number
  readonly centered: boolean
}

/** `sphere(r)` → `cad.sphere(r, { segments })`。球心恒在原点（OpenSCAD 亦如此）。 */
export interface IrSphere extends IrSolid {
  readonly kind: 'sphere'
  readonly radius: number
  /** 三角化分片数（M9 §1.3）：按 $fn/$fa/$fs + 半径算，传给 cad.sphere 控制密度。 */
  readonly segments?: number
}

/** `cylinder(h, r1, r2, center)` 且 `r1 === r2` → `cad.cylinder(r, h, { centered, segments })`。 */
export interface IrCylinder extends IrSolid {
  readonly kind: 'cylinder'
  readonly radius: number
  readonly height: number
  readonly centered: boolean
  readonly segments?: number
}

/** `cylinder(h, r1, r2, center)` 且 `r1 !== r2` → `cad.cone(r1, r2, h, { centered, segments })`。 */
export interface IrCone extends IrSolid {
  readonly kind: 'cone'
  readonly radiusBottom: number
  readonly radiusTop: number
  readonly height: number
  readonly centered: boolean
  readonly segments?: number
}

/** `cylinder(h, r1, r2, center)` 且 `r1 === r2` → `cad.cylinder(r, h, { centered })`。 */
export interface IrCylinder extends IrSolid {
  readonly kind: 'cylinder'
  readonly radius: number
  readonly height: number
  readonly centered: boolean
}

/** `cylinder(h, r1, r2, center)` 且 `r1 !== r2` → `cad.cone(r1, r2, h, { centered })`。 */
export interface IrCone extends IrSolid {
  readonly kind: 'cone'
  readonly radiusBottom: number
  readonly radiusTop: number
  readonly height: number
  readonly centered: boolean
}

// ── 2D 图元（全部落到 `cad.profile`） ──────────────────────────────────────

/** `square(size, center)` → 4 段 line 的矩形轮廓。 */
export interface IrRect2D extends IrPlanar {
  readonly kind: 'rect2d'
  readonly width: number
  readonly height: number
  readonly centered: boolean
}

/** `circle(r)` → 两段 arc 的真圆轮廓（analytic；显式 `$fn` 见 OSC3201）。 */
export interface IrCircle2D extends IrPlanar {
  readonly kind: 'circle2d'
  readonly radius: number
}

/**
 * `polygon(points, paths)`。
 * `paths === undefined` 表示 OpenSCAD 的单环形态（CSG dump 里是 `undef`），
 * 此时整份 `points` 就是一个环。
 */
export interface IrPolygon2D extends IrPlanar {
  readonly kind: 'polygon2d'
  readonly points: readonly Vec2[]
  readonly paths?: readonly (readonly number[])[]
}

// ── 组合 ───────────────────────────────────────────────────────────────────

export interface IrUnion extends IrCommon {
  readonly kind: 'union'
  readonly dimension: IrDimension
  readonly children: readonly IrGeometry[]
}

/**
 * `difference`：第一个子节点是主体，其余是工具。
 * 无子节点在 lower 阶段就是错误（OSC2001），故这里恒有 ≥1 个子节点。
 */
export interface IrDifference extends IrCommon {
  readonly kind: 'difference'
  readonly dimension: IrDimension
  readonly children: readonly IrGeometry[]
}

export interface IrIntersection extends IrCommon {
  readonly kind: 'intersection'
  readonly dimension: IrDimension
  readonly children: readonly IrGeometry[]
}

// ── 变换与成形 ─────────────────────────────────────────────────────────────

/** `multmatrix(m)` → `cad.applyMatrix(shape, m)`。 */
export interface IrTransform extends IrCommon {
  readonly kind: 'transform'
  readonly dimension: IrDimension
  readonly matrix: Matrix4
  readonly child: IrGeometry
}

/**
 * 简单 `linear_extrude`（无 twist、无非等比 scale）。
 * `centered` 为真时 emitter 用一次 `applyMatrix` 把 z 平移到 `[-h/2, h/2]`——
 * **不用 `cad.translate`**：该 op 不在 faijs 平台面上（见手册 §4.9 的废弃说明）。
 */
export interface IrExtrude extends IrSolid {
  readonly kind: 'extrude'
  /** 被拉伸的 2D 轮廓。 */
  readonly child: IrGeometry2D
  readonly length: number
  readonly centered: boolean
}

/**
 * `rotate_extrude(angle)` → `cad.revolve(profile, { axis, at, angle })`。
 *
 * OpenSCAD 的 `rotate_extrude` 绕 Z 轴旋转 XY 轮廓，`angle` 参数是**度**。
 * faijs `cad.revolve` 的 `angle` 是**裸弧度**（不乘 RADIAN；详见 emitter 注释）。
 * 这里 IR 在 lower 时把度转成弧度存储，emitter 直接输出裸数字。
 */
export interface IrRevolve extends IrSolid {
  readonly kind: 'revolve'
  /** 被旋转的 2D 轮廓。 */
  readonly child: IrGeometry2D
  /** 旋转角度，弧度。完整旋转 = 2π。 */
  readonly angle: number
}

/** `color([r,g,b,a])` → `setColor([r,g,b])` +（a<1 时）`setOpacity(a)`。 */
export interface IrColor extends IrCommon {
  readonly kind: 'color'
  readonly dimension: IrDimension
  readonly rgba: Vec4
  readonly child: IrGeometry
}

/**
 * `render()` 的几何透传。`convexity` 只影响 OpenSCAD 的 CGAL 提示，
 * 对 faijs BREP 无对应语义，故仅作为 info 记录（不进 IR 的几何字段）。
 */
export interface IrPassthrough extends IrCommon {
  readonly kind: 'passthrough'
  readonly dimension: IrDimension
  readonly child: IrGeometry
}

/** 空子树：空 `group`、空 `multmatrix`、被 `%` 删除的子树。 */
export interface IrEmpty extends IrCommon {
  readonly kind: 'empty'
}

/**
 * v0 范围外的节点。**不是「忽略」，而是明确的可报告状态**（plan §5.4）：
 * emitter 见到它必须拒绝产出可执行代码，绝不生成「看起来能跑」的近似几何。
 */
export interface IrBlocked extends IrCommon {
  readonly kind: 'blocked'
  /** 能力表给出的理由。 */
  readonly reason: string
}

export type IrGeometry =
  | IrBox
  | IrSphere
  | IrCylinder
  | IrCone
  | IrRect2D
  | IrCircle2D
  | IrPolygon2D
  | IrUnion
  | IrDifference
  | IrIntersection
  | IrTransform
  | IrExtrude
  | IrRevolve
  | IrColor
  | IrPassthrough
  | IrEmpty
  | IrBlocked

/** 保维度为 2D 的几何子集（`linear_extrude` 的输入约束）。 */
export type IrGeometry2D = IrRect2D | IrCircle2D | IrPolygon2D | IrUnion | IrDifference | IrIntersection

/**
 * 三角化参数（M9 §1.3 铁律 2）。
 *
 * `$fn`/`$fa`/`$fs` 是 OpenSCAD 的导出参数，不改变建模语义。转换器把它们
 * 采集为三角化元数据，交给 parity runner 在导出侧对齐分片密度。
 *
 * - `fn > 0`：精确分段数（优先级最高）
 * - `fn` 未设：由 `fa`/`fs` 按公式换算出 `segments`
 * - 全部未设：使用 OpenSCAD 默认值（$fa=12, $fs=2）
 */
export interface TessellationParams {
  /** 显式 $fn > 0 时的精确分段数。 */
  readonly fn?: number
  /** $fa 角度（度），缺省 12。 */
  readonly fa?: number
  /** $fs 大小（mm），缺省 2。 */
  readonly fs?: number
  /** 从 fn 或 fa/fs 换算出的分段数（供 parity runner 使用）。 */
  readonly segments?: number
}

/** 模型根：可能是单节点，也可能是多个根节点的隐式 union。 */
export interface IrModel {
  readonly root: IrGeometry
  /** 按前序排列的全部节点，便于遍历与统计（不含自身为根之外的重复）。 */
  readonly nodes: readonly IrGeometry[]
  /** 源信息（转写到生成物头部）。 */
  readonly source: {
    readonly path?: string
    readonly openscadVersion?: string
  }
  /**
   * 三角化参数（M9 §1.3）。采集自模型中所有显式 `$fn`/`$fa`/`$fs` 的
   * 最严格值（取最大 segments），供 parity runner 在导出侧对齐分片密度。
   * `undefined` 表示语料未设置任何 `$` 变量（使用 OpenSCAD 默认值）。
   */
  readonly tessellation?: TessellationParams
}

/** 深度优先前序遍历。 */
export function walkIr(node: IrGeometry, visit: (n: IrGeometry) => void): void {
  visit(node)
  for (const child of irChildren(node)) walkIr(child, visit)
}

/** 一个 IR 节点的几何子节点（`blocked` / `empty` 无子节点）。 */
export function irChildren(node: IrGeometry): readonly IrGeometry[] {
  switch (node.kind) {
    case 'union':
    case 'difference':
    case 'intersection':
      return node.children
    case 'transform':
    case 'extrude':
    case 'revolve':
    case 'color':
    case 'passthrough':
      return [node.child]
    case 'box':
    case 'sphere':
    case 'cylinder':
    case 'cone':
    case 'rect2d':
    case 'circle2d':
    case 'polygon2d':
    case 'empty':
    case 'blocked':
      return []
  }
}

/** 模型中是否存在范围外节点（emitter 据此决定是否拒绝产出）。 */
export function hasBlocked(model: IrModel): boolean {
  let found = false
  walkIr(model.root, (n) => {
    if (n.kind === 'blocked') found = true
  })
  return found
}

/** 模型里出现过的范围外 CSG 节点名（稳定排序）。 */
export function blockedNodes(model: IrModel): string[] {
  const out = new Set<string>()
  walkIr(model.root, (n) => {
    if (n.kind === 'blocked') out.add(n.origin.csgNode)
  })
  return [...out].sort()
}
