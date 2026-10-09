/**
 * lower：CSG AST → Model IR（plan §4.3，M2）。
 *
 * 这一层集中承担 plan §4.3 列出的全部 passes。它们**不做**字符串拼接，
 * 也不决定 faijs 调用怎么写——只决定「语义是什么」：
 *
 *   1. default-args          补全 CSG 版本省略的默认参数（cube 的 size、cylinder 的 r1/r2…）
 *   2. dimension-inference   标记每个节点的 2D/3D，混合即 OSC2003（拒绝而非静默丢弃）
 *   3. group-normalize       空组→Empty，单子→透传，多子→隐式 union
 *   4. matrix-fold           校验 4×4 行主序与可逆性（奇异→OSC2004）
 *   5. modifier-policy       `%` 背景子树从结果剔除；`#` 保留几何 + OSC3001
 *   6. tessellation-policy   显式 `$fn` 不改变 analytic BREP，记 OSC3201（不做假换算）
 *   7. capability-classify   范围外节点 → IrBlocked + OSC3002（绝不静默跳过）
 *
 * 全流程**不抛异常**：坏输入产出一条诊断并降级为 `IrEmpty`，让上层仍能报告
 * 完整结果（与 lexer/parser 的约定一致）。
 */
import {
  argumentOf,
  firstPositionalValue,
  positionalArguments,
  type CsgArgument,
  type CsgDocument,
  type CsgNode,
  type CsgValue,
} from '../csg/ast'
import { DiagnosticCode } from '../diagnostics/codes'
import { DiagnosticBag, type Diagnostic, type Span } from '../diagnostics/diagnostic'
import { capabilityOf, isInShippedScope } from './capability'
import {
  circleFragments,
  sphereFragments,
  DEFAULT_FA,
  DEFAULT_FS,
  regularPolygonPoints,
} from './faceted-geometry'
import type {
  IrBlocked,
  IrGeometry,
  IrGeometry2D,
  IrModel,
  IrOrigin,
  Matrix4,
  TessellationParams,
  Vec2,
  Vec4,
} from './model'

export interface LowerOptions {
  /** CSG 源文件，写进诊断与生成物头部。 */
  readonly path?: string
  /** OpenSCAD 版本（来自 frontend），写进生成物头部。 */
  readonly openscadVersion?: string
}

export interface LowerResult {
  readonly model: IrModel
  readonly diagnostics: readonly Diagnostic[]
  /** 三角化参数（M9 §1.3），采集自语料的 $fn/$fa/$fs（含 OpenSCAD 默认值）。 */
  readonly tessellation: TessellationParams
}

/**
 * 动态作用域特殊变量。OpenSCAD 会把它们附加到**每一个**子孙节点上，
 * 因此它们不是节点参数、不代表任何几何，lower 时一律跳过。
 */
const SPECIAL_VARIABLES = new Set([
  '$fn',
  '$fa',
  '$fs',
  '$t',
  '$vpt',
  '$vpr',
  '$vpd',
  '$vpf',
  '$preview',
  '$children',
  '$parent_modules',
])

/** 每个 P0 节点认识的名字参数（其余参数报 OSC1004 后忽略，但值已在 AST 里保留）。 */
const KNOWN_ARGS: Readonly<Record<string, readonly string[]>> = {
  cube: ['size', 'center'],
  sphere: ['r', 'd'],
  cylinder: ['h', 'r', 'r1', 'r2', 'd', 'd1', 'd2', 'center'],
  square: ['size', 'center'],
  circle: ['r', 'd'],
  polygon: ['points', 'paths', 'convexity'],
  linear_extrude: ['height', 'center', 'twist', 'scale', 'slices', 'convexity'],
  rotate_extrude: ['angle', 'fa', 'fs', 'fn', 'convexity'],
  // P1/P2 blocked 节点：参数名登记后不再报 OSC1004（让 blocked 诊断更干净）
  polyhedron: ['points', 'faces', 'convexity', 'triangles'],
  text: ['text', 'size', 'spacing', 'font', 'direction', 'language', 'script', 'halign', 'valign'],
  resize: ['newsize', 'auto', 'convexity'],
  import: ['file', 'convexity', 'layer', 'origin', 'scale'],
  projection: ['cut'],
  offset: ['r', 'delta', 'chamfer', 'segments'],
  surface: ['file', 'center', 'invert', 'convexity'],
  fill: [],
  roof: ['convexity'],
  hull: [],
  minkowski: [],
  color: [],
  render: ['convexity'],
  multmatrix: [],
  group: [],
  union: [],
  difference: [],
  intersection: [],
}

/**
 * 显式 `$fn > 0` 的节点名集合。这些节点的 `$fn`/`$fa`/`$fs` 不改变建模语义，
 * 只控制导出时的三角化分片密度（M9 §1.3 铁律 2）。
 */
const FACETING_PRIMITIVES = new Set(['sphere', 'cylinder', 'cone', 'circle'])

interface Num {
  readonly value: number
  readonly span: Span
}

export function lowerCsg(document: CsgDocument, options: LowerOptions = {}): LowerResult {
  return new Lowerer(options).run(document)
}

class Lowerer {
  private readonly bag = new DiagnosticBag()
  private nextId = 0
  private readonly path?: string
  private readonly openscadVersion?: string
  /** M9 §1.3: 采集语料中最严格的三角化参数。 */
  private bestFn: number | undefined
  private bestFa: number | undefined
  private bestFs: number | undefined
  private maxSegments: number | undefined

  constructor(options: LowerOptions) {
    this.path = options.path
    this.openscadVersion = options.openscadVersion
  }

  run(document: CsgDocument): LowerResult {
    // 文档根：多个根节点是隐式 union（OpenSCAD 根层语义）。
    const children = document.nodes
      .map((n) => this.lowerNode(n))
      .filter((n): n is IrGeometry => n !== undefined)

    const root = this.combine('union', children, document.span, 'root')
    const tessellation = this.computeTessellation()
    return {
      model: {
        root,
        nodes: collect(root),
        source: {
          ...(this.path === undefined ? {} : { path: this.path }),
          ...(this.openscadVersion === undefined ? {} : { openscadVersion: this.openscadVersion }),
        },
        tessellation,
      },
      diagnostics: this.bag.all(),
      tessellation,
    }
  }

  // ── 分发 ─────────────────────────────────────────────────────────────────

  private lowerNode(node: CsgNode): IrGeometry | undefined {
    const id = this.nextId++
    const origin = this.origin(id, node)

    // modifier-policy（pass 5）：`%` 的子树是背景，OpenSCAD 导出时不进结果几何。
    if (node.modifiers.includes('%')) {
      return { kind: 'empty', id, origin }
    }
    if (node.modifiers.includes('#')) {
      // `#` 只影响 preview 高亮；几何保留，但高亮语义在 faijs 侧不存在。
      this.bag.add({
        code: DiagnosticCode.OSC3001,
        message: `${node.name}: '#' highlight is a preview-only modifier; geometry kept, highlight dropped`,
        ...this.spanRef(node.nameSpan),
        nodeId: id,
      })
    }

    // capability-classify（pass 7）：范围外节点必须可报告，绝不静默跳过。
    if (!isInShippedScope(node.name)) {
      const entry = capabilityOf(node.name)
      return this.blocked(node, id, origin, entry.note)
    }

    // M9 §1.3 铁律 2：采集 $fn/$fa/$fs 作为三角化参数（不影响建模语义）。
    this.collectTessellation(node)

    switch (node.name) {
      case 'cube':
        return this.lowerCube(node, id, origin)
      case 'sphere':
        return this.lowerSphere(node, id, origin)
      case 'cylinder':
        return this.lowerCylinder(node, id, origin)
      case 'square':
        return this.lowerSquare(node, id, origin)
      case 'circle':
        return this.lowerCircle(node, id, origin)
      case 'polygon':
        return this.lowerPolygon(node, id, origin)
      case 'union':
        return this.combine('union', this.lowerChildren(node), node.span, node.name, id, origin)
      case 'difference':
        return this.lowerDifference(node, id, origin)
      case 'intersection':
        return this.combine('intersection', this.lowerChildren(node), node.span, node.name, id, origin)
      case 'group':
        return this.lowerGroup(node, id, origin)
      case 'multmatrix':
        return this.lowerMultmatrix(node, id, origin)
      case 'linear_extrude':
        return this.lowerLinearExtrude(node, id, origin)
      case 'rotate_extrude':
        return this.lowerRotateExtrude(node, id, origin)
      case 'color':
        return this.lowerColor(node, id, origin)
      case 'render':
        return this.lowerRender(node, id, origin)
      default:
        // live in vocabulary but not in P0 — guarded above; defensive only.
        return this.blocked(node, id, origin, 'not implemented in v0')
    }
  }

  // ── 3D 图元 ───────────────────────────────────────────────────────────────

  private lowerCube(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    this.reportUnknownArgs(node)
    const size = this.sizeArg(node, 'size', 3, id)
    if (!size) return { kind: 'empty', id, origin }
    const centered = this.boolArg(node, 'center', false, id)
    if (centered === undefined) return { kind: 'empty', id, origin }
    return {
      kind: 'box',
      id,
      origin,
      dimension: '3d',
      width: size[0],
      depth: size[1],
      height: size[2],
      centered,
    }
  }

  private lowerSphere(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    this.reportUnknownArgs(node)
    const radius = this.radiusArg(node, id)
    if (radius === undefined) return { kind: 'empty', id, origin }
    this.reportFaceting(node, id)
    // Faceted approach: always compute segments from $fn/$fa/$fs
    // (even when $fn is 0/unset, use $fa/$fs defaults to compute segments)
    const fn = this.specialVar(node, '$fn')
    const fa = this.specialVar(node, '$fa')
    const fs = this.specialVar(node, '$fs')
    const segments = sphereFragments(
      radius,
      fn !== undefined && fn > 0 ? fn : undefined,
      fa,
      fs,
    )
    return {
      kind: 'sphere',
      id,
      origin,
      dimension: '3d',
      radius,
      segments,
    }
  }

  private lowerCylinder(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    this.reportUnknownArgs(node)
    const h = this.numArg(node, 'h', id, { required: true })
    if (!h) return { kind: 'empty', id, origin }

    const bottom = this.diameterOrRadius(node, ['r1', 'r'], ['d1', 'd'], id, 'r1')
    const top = this.diameterOrRadius(node, ['r2', 'r'], ['d2', 'd'], id, 'r2')
    if (bottom === undefined || top === undefined) return { kind: 'empty', id, origin }

    const centered = this.boolArg(node, 'center', false, id)
    if (centered === undefined) return { kind: 'empty', id, origin }

    this.reportFaceting(node, id)
    // Faceted approach: always compute segments from $fn/$fa/$fs
    const fn = this.specialVar(node, '$fn')
    const fa = this.specialVar(node, '$fa')
    const fs = this.specialVar(node, '$fs')
    const maxR = Math.max(bottom, top)
    const segments = circleFragments(
      maxR,
      fn !== undefined && fn > 0 ? fn : undefined,
      fa,
      fs,
    )
    if (bottom === top) {
      return {
        kind: 'cylinder',
        id,
        origin,
        dimension: '3d',
        radius: bottom,
        height: h.value,
        centered,
        segments,
      }
    }
    return {
      kind: 'cone',
      id,
      origin,
      dimension: '3d',
      radiusBottom: bottom,
      radiusTop: top,
      height: h.value,
      centered,
      segments,
    }
  }

  // ── 2D 图元 ───────────────────────────────────────────────────────────────

  private lowerSquare(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    this.reportUnknownArgs(node)
    const size = this.sizeArg(node, 'size', 2, id)
    if (!size) return { kind: 'empty', id, origin }
    const centered = this.boolArg(node, 'center', false, id)
    if (centered === undefined) return { kind: 'empty', id, origin }
    return { kind: 'rect2d', id, origin, dimension: '2d', width: size[0], height: size[1], centered }
  }

  private lowerCircle(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    this.reportUnknownArgs(node)
    const radius = this.radiusArg(node, id)
    if (radius === undefined) return { kind: 'empty', id, origin }
    this.reportFaceting(node, id)
    // Faceted approach: produce a regular N-gon polygon (same as OpenSCAD's
    // circle with $fn/$fa/$fs computed segments).
    const fn = this.specialVar(node, '$fn')
    const fa = this.specialVar(node, '$fa')
    const fs = this.specialVar(node, '$fs')
    const segments = circleFragments(
      radius,
      fn !== undefined && fn > 0 ? fn : undefined,
      fa,
      fs,
    )
    const pts = regularPolygonPoints(radius, segments)
    return {
      kind: 'polygon2d',
      id,
      origin,
      dimension: '2d',
      points: pts,
    }
  }

  private lowerPolygon(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    this.reportUnknownArgs(node)
    const pointsArg = argumentOf(node, 'points')
    if (!pointsArg || pointsArg.value.kind !== 'vector') {
      return this.missing(node, id, "polygon needs a 'points' vector")
    }

    const points: Vec2[] = []
    for (const item of pointsArg.value.items) {
      const v = asVec(item, 2)
      if (!v) {
        return this.typeError(node, id, `polygon 'points' must be vectors of 2 numbers (got ${item.kind})`)
      }
      points.push([v[0], v[1]])
    }

    const pathsArg = argumentOf(node, 'paths')
    let paths: number[][] | undefined
    if (pathsArg && pathsArg.value.kind !== 'undef') {
      if (pathsArg.value.kind !== 'vector') {
        return this.typeError(node, id, `polygon 'paths' must be a vector of index paths or undef`)
      }
      paths = []
      for (const item of pathsArg.value.items) {
        if (item.kind !== 'vector') {
          return this.typeError(node, id, `polygon 'paths' entries must be vectors of indices`)
        }
        const path: number[] = []
        for (const idx of item.items) {
          if (idx.kind !== 'number' || !Number.isInteger(idx.value)) {
            return this.typeError(node, id, `polygon 'paths' entries must be integer indices`)
          }
          path.push(idx.value)
        }
        paths.push(path)
      }
    }

    return {
      kind: 'polygon2d',
      id,
      origin,
      dimension: '2d',
      points,
      ...(paths === undefined ? {} : { paths }),
    }
  }

  // ── 组合 ─────────────────────────────────────────────────────────────────

  private lowerChildren(node: CsgNode): IrGeometry[] {
    const out: IrGeometry[] = []
    for (const child of node.children) {
      const lowered = this.lowerNode(child)
      if (lowered !== undefined) out.push(lowered)
    }
    return out
  }

  /** 空组→Empty；单子→透传；多子→隐式 union/intersection。 */
  private combine(
    kind: 'union' | 'intersection',
    children: readonly IrGeometry[],
    span: Span,
    csgNode: string,
    id?: number,
    origin?: IrOrigin,
  ): IrGeometry {
    const nodeId = id ?? this.nextId++
    const src = origin ?? this.originFromSpan(nodeId, span, csgNode)
    // `IrEmpty` 子节点（空组、`%` 背景）不参与结果，但**不能**吞掉 blocked：
    // blocked 必须在树上留痕，否则范围外节点会被静默丢弃。
    const live = children.filter((c) => c.kind !== 'empty')
    if (live.length === 0) return { kind: 'empty', id: nodeId, origin: src }
    if (live.length === 1) return live[0]

    const dimension = this.combineDimension(live, nodeId, span, csgNode)
    // undefined 只可能是「2D/3D 混用」（已报 OSC2003）。`'unknown'`（子节点全是
    // 范围外节点）必须保留节点本身，否则 blocked 会在这里被静默吞掉。
    if (dimension === undefined) return { kind: 'empty', id: nodeId, origin: src }

    if (kind === 'union') {
      return { kind: 'union', id: nodeId, origin: src, dimension, children: live }
    }
    return { kind: 'intersection', id: nodeId, origin: src, dimension, children: live }
  }

  private lowerGroup(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    return this.combine('union', this.lowerChildren(node), node.span, node.name, id, origin)
  }

  private lowerDifference(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    const live = this.lowerChildren(node).filter((c) => c.kind !== 'empty')
    if (live.length === 0) {
      return this.missing(node, id, 'difference needs at least one child')
    }
    // OpenSCAD 语义：无 base 的 `difference()` 是空几何；单子的 difference 即该子。
    if (live.length === 1) return live[0]

    const dimension = this.combineDimension(live, id, node.span, node.name)
    if (dimension === undefined) return { kind: 'empty', id, origin }
    return { kind: 'difference', id, origin, dimension, children: live }
  }

  /**
   * pass 2 dimension-inference：组合节点的维度取自子节点，全部一致才算合法。
   * 混合维度在 OpenSCAD 里是「警告并丢弃」；本转换器**拒绝**——静默丢几何
   * 比报错更糟（plan §8 对 OSC2003 的定义）。
   *
   * 三态返回，且**必须**区分后两者：
   *   `'2d'`/`'3d'`  子节点维度一致，可用
   *   `'unknown'`    子节点全部是 blocked/empty —— 维度未知，但**不是空几何**
   *   `undefined`    2D 与 3D 混用（已报 OSC2003）—— 这才是真的没有可用几何
   * 把 `unknown` 折成空几何会让范围外节点在树上消失（2026-10-06 实测）。
   */
  private combineDimension(
    children: readonly IrGeometry[],
    id: number,
    span: Span,
    csgNode: string,
  ): '2d' | '3d' | 'unknown' | undefined {
    let seen: '2d' | '3d' | undefined
    const kinds = new Set<string>()
    for (const child of children) {
      const dim = dimensionOf(child)
      if (dim === undefined) continue // blocked / empty：由 emitter 单独裁决
      kinds.add(dim)
      seen = dim
    }
    if (kinds.size > 1) {
      this.bag.add({
        code: DiagnosticCode.OSC2003,
        message: `${csgNode}: children mix 2D and 3D geometry — refusing to drop geometry silently`,
        ...this.spanRef(span),
        nodeId: id,
      })
      return undefined
    }
    return seen ?? 'unknown'
  }

  // ── 变换与成形 ───────────────────────────────────────────────────────────

  /** pass 4 matrix-fold：校验行主序 4×4 与可逆性。 */
  private lowerMultmatrix(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    const matrix = this.matrixArg(node, id)
    if (!matrix) return { kind: 'empty', id, origin }

    const children = this.lowerChildren(node).filter((c) => c.kind !== 'empty')
    if (children.length === 0) return { kind: 'empty', id, origin }

    const child =
      children.length === 1
        ? children[0]
        : this.combine('union', children, node.span, 'multmatrix')
    const dimension = dimensionOf(child)
    if (dimension === undefined) return child
    if (child.kind === 'blocked') return child
    return { kind: 'transform', id, origin, dimension, matrix, child }
  }

  private lowerLinearExtrude(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    this.reportUnknownArgs(node)
    const height = this.numArg(node, 'height', id, { required: true })
    if (!height) return { kind: 'empty', id, origin }

    // pass 6 tessellation-policy + P2 裁决（T601 spike）：
    // twist 和 non-uniform scale 保持 BLOCKED，因为 faijs 0.29.5 无精确实现：
    // - twistExtrude(wire, angleDeg, center, normal) 接受 1D wire（非 2D face），
    //   不支持负角度，且语义是螺旋扫掠而非渐进扭转（见 twist-extrude.probe.test.ts）。
    // - complexExtrude / twistExtrude 均拒绝 ExtrusionProfile scaling law
    //   (COMPLEX_EXTRUDE_LAW_UNSUPPORTED / TWIST_EXTRUDE_LAW_UNSUPPORTED)。
    const twist = this.numArg(node, 'twist', id)
    const scale = this.scaleArg(node, id)
    const unsupported: string[] = []
    if (twist && twist.value !== 0) unsupported.push(`twist=${twist.value}`)
    if (scale && (scale[0] !== 1 || scale[1] !== 1)) unsupported.push(`scale=[${scale[0]},${scale[1]}]`)
    if (unsupported.length > 0) {
      return this.blocked(
        node,
        id,
        origin,
        `linear_extrude with ${unsupported.join(' / ')} — faijs has no exact equivalent (twistExtrude takes wire not face; scaling law unsupported)`,
      )
    }

    const centered = this.boolArg(node, 'center', false, id)
    if (centered === undefined) return { kind: 'empty', id, origin }

    const children = this.lowerChildren(node).filter((c) => c.kind !== 'empty')
    if (children.length === 0) {
      return this.missing(node, id, 'linear_extrude needs exactly one 2D child')
    }
    // 多子：OpenSCAD 先对子节点取并集再拉伸。
    const merged =
      children.length === 1 ? children[0] : this.combine('union', children, node.span, 'linear_extrude')

    const mergedDim = dimensionOf(merged)
    if (mergedDim !== '2d') {
      // 3D 子节点是真错误；维度未知（子树里全是范围外节点）只需把 blocked
      // 往上透传 —— 那里已经报了 OSC3002，再叠一条 OSC2002 只是噪音。
      if (mergedDim === '3d') {
        return this.typeError(node, id, 'linear_extrude requires a 2D child (got 3D geometry)')
      }
      return merged
    }
    const planar = merged as IrGeometry2D

    // linear_extrude 的 $fn 作用于其轮廓上的弧（如圆），与图元同一条政策。
    this.reportFaceting(node, id)
    return { kind: 'extrude', id, origin, dimension: '3d', child: planar, length: height.value, centered }
  }

  /**
   * `rotate_extrude(angle=360)` → `cad.revolve(profile, { angle })`。
   *
   * OpenSCAD 的 `rotate_extrude` 绕 Z 轴旋转 XY 轮廓，`angle` 是度（默认 360）。
   * faijs `cad.revolve` 的 `angle` 是**裸弧度**（不乘 RADIAN）。
   * 这里把度转成弧度存储在 IR 里，emitter 直接输出裸数字。
   */
  private lowerRotateExtrude(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    this.reportUnknownArgs(node)
    const angleArg = this.numArg(node, 'angle', id)
    // OpenSCAD 默认 360 度 = 2π 弧度
    const angleDeg = angleArg?.value ?? 360
    const angleRad = (angleDeg * Math.PI) / 180

    const children = this.lowerChildren(node).filter((c) => c.kind !== 'empty')
    if (children.length === 0) {
      return this.missing(node, id, 'rotate_extrude needs exactly one 2D child')
    }
    // 多子：OpenSCAD 先对子节点取并集再旋转。
    const merged =
      children.length === 1 ? children[0] : this.combine('union', children, node.span, 'rotate_extrude')

    const mergedDim = dimensionOf(merged)
    if (mergedDim !== '2d') {
      if (mergedDim === '3d') {
        return this.typeError(node, id, 'rotate_extrude requires a 2D child (got 3D geometry)')
      }
      return merged
    }
    const planar = merged as IrGeometry2D

    this.reportFaceting(node, id)
    return { kind: 'revolve', id, origin, dimension: '3d', child: planar, angle: angleRad }
  }

  /** pass 5 modifier-policy（外观）：RGBA → setColor / setOpacity。 */
  private lowerColor(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    const children = this.lowerChildren(node).filter((c) => c.kind !== 'empty')
    if (children.length === 0) {
      return this.missing(node, id, 'color needs a child')
    }
    const child = children.length === 1 ? children[0] : this.combine('union', children, node.span, 'color')

    const rgba = this.colorArg(node, id)
    if (!rgba) return child
    const dimension = dimensionOf(child)
    if (dimension === undefined || child.kind === 'blocked') return child
    return { kind: 'color', id, origin, dimension, rgba, child }
  }

  private lowerRender(node: CsgNode, id: number, origin: IrOrigin): IrGeometry {
    this.reportUnknownArgs(node)
    const children = this.lowerChildren(node).filter((c) => c.kind !== 'empty')
    if (children.length === 0) return { kind: 'empty', id, origin }
    const child = children.length === 1 ? children[0] : this.combine('union', children, node.span, 'render')
    const dimension = dimensionOf(child)
    if (dimension === undefined || child.kind === 'blocked') return child
    // `convexity` 只影响 OpenSCAD 的 CGAL 预览提示，对 BREP 无几何语义：
    // 它已在 KNOWN_ARGS 里，故既不报 OSC1004，也不写进 IR。
    return { kind: 'passthrough', id, origin, dimension, child }
  }

  // ── 参数读取（default-args pass 1） ──────────────────────────────────────

  /** `size` 可以是标量（立方体/正方形）或向量；缺省在 s2d 时是 [1,1]。 */
  private sizeArg(node: CsgNode, name: string, rank: 2 | 3, id: number): number[] | undefined {
    const arg = argumentOf(node, name)
    if (!arg) {
      if (rank === 2) return [1, 1]
      this.missing(node, id, `'${node.name}' needs a '${name}' argument`)
      return undefined
    }
    const vec = asVec(arg.value, rank)
    if (vec) return vec
    if (arg.value.kind === 'number') {
      return rank === 2 ? [arg.value.value, arg.value.value] : [arg.value.value, arg.value.value, arg.value.value]
    }
    this.typeError(node, id, `'${name}' must be a number or a ${rank}-vector`)
    return undefined
  }

  /** `r` / `d` 二选一（OpenSCAD 两者都合法，`d` 是直径）。 */
  private radiusArg(node: CsgNode, id: number): number | undefined {
    const r = argumentOf(node, 'r')
    if (r) {
      if (r.value.kind !== 'number') {
        this.typeError(node, id, "'r' must be a number")
        return undefined
      }
      return r.value.value
    }
    const d = argumentOf(node, 'd')
    if (d) {
      if (d.value.kind !== 'number') {
        this.typeError(node, id, "'d' must be a number")
        return undefined
      }
      return d.value.value / 2
    }
    this.missing(node, id, `'${node.name}' needs 'r' or 'd'`)
    return undefined
  }

  /** cylinder 的 r1/r2 各自可用 `d1/d2` 或共享的 `d` 给出。 */
  private diameterOrRadius(
    node: CsgNode,
    radiusNames: readonly string[],
    diameterNames: readonly string[],
    id: number,
    label: string,
  ): number | undefined {
    for (const n of radiusNames) {
      const arg = argumentOf(node, n)
      if (arg) {
        if (arg.value.kind !== 'number') {
          this.typeError(node, id, `'${n}' must be a number`)
          return undefined
        }
        return arg.value.value
      }
    }
    for (const n of diameterNames) {
      const arg = argumentOf(node, n)
      if (arg) {
        if (arg.value.kind !== 'number') {
          this.typeError(node, id, `'${n}' must be a number`)
          return undefined
        }
        return arg.value.value / 2
      }
    }
    this.missing(node, id, `'${label}' is required`)
    return undefined
  }

  private numArg(node: CsgNode, name: string, id: number, opts: { required?: boolean } = {}): Num | undefined {
    const arg = argumentOf(node, name)
    if (!arg) {
      if (opts.required) this.missing(node, id, `'${name}' is required`)
      return undefined
    }
    if (arg.value.kind !== 'number') {
      this.typeError(node, id, `'${name}' must be a number`)
      return undefined
    }
    return { value: arg.value.value, span: arg.value.span }
  }

  private boolArg(node: CsgNode, name: string, fallback: boolean, id: number): boolean | undefined {
    const arg = argumentOf(node, name)
    if (!arg) return fallback
    if (arg.value.kind !== 'boolean') {
      this.typeError(node, id, `'${name}' must be a boolean`)
      return undefined
    }
    return arg.value.value
  }

  private scaleArg(node: CsgNode, id: number): [number, number] | undefined {
    const arg = argumentOf(node, 'scale')
    if (!arg) return undefined
    const vec = asVec(arg.value, 2)
    if (vec) return [vec[0], vec[1]]
    if (arg.value.kind === 'number') return [arg.value.value, arg.value.value]
    this.typeError(node, id, "'scale' must be a number or a 2-vector")
    return undefined
  }

  /** `multmatrix` 的位置参数：行主序 4×4，底行必须是 [0,0,0,1]。 */
  private matrixArg(node: CsgNode, id: number): Matrix4 | undefined {
    const value = firstPositionalValue(node)
    if (!value || value.kind !== 'vector' || value.items.length !== 4) {
      this.typeError(node, id, 'multmatrix needs a 4x4 matrix (four [x,y,z,w] rows)')
      return undefined
    }
    const rows: number[][] = []
    for (const row of value.items) {
      const vec = asVec(row, 4)
      if (!vec) {
        this.typeError(node, id, 'multmatrix rows must each have 4 numbers')
        return undefined
      }
      rows.push(vec)
    }
    const [r0, r1, r2, r3] = rows
    if (r3[0] !== 0 || r3[1] !== 0 || r3[2] !== 0 || r3[3] !== 1) {
      this.typeError(
        node,
        id,
        `multmatrix bottom row must be [0,0,0,1] (faijs applyMatrix constraint), got [${r3.join(', ')}]`,
      )
      return undefined
    }
    // faijs applyMatrix 拒绝不可逆矩阵；OpenSCAD 的 scale([1,0,1]) 会 dump 出 det=0。
    const det = determinant3(r0, r1, r2)
    if (Math.abs(det) < 1e-12) {
      this.bag.add({
        code: DiagnosticCode.OSC2004,
        message: `multmatrix is singular (det≈0) — faijs applyMatrix rejects non-invertible transforms`,
        ...this.spanRef(node.span),
        nodeId: id,
      })
      return undefined
    }
    return [r0, r1, r2, r3] as unknown as Matrix4
  }

  /** `color([r,g,b,a])`：CSG dump 里恒为位置参数；`alpha` 缺省即 1。 */
  private colorArg(node: CsgNode, id: number): Vec4 | undefined {
    const positions = positionalArguments(node)
    const value = positions[0]?.value
    if (!value || value.kind !== 'vector' || (value.items.length !== 3 && value.items.length !== 4)) {
      this.typeError(node, id, 'color needs an [r,g,b] or [r,g,b,a] vector')
      return undefined
    }
    const parts: number[] = []
    for (const item of value.items) {
      if (item.kind !== 'number') {
        this.typeError(node, id, 'color components must be numbers')
        return undefined
      }
      parts.push(item.value)
    }
    return [parts[0], parts[1], parts[2], parts[3] ?? 1] as Vec4
  }

  // ── 三角化参数采集（M9 §1.3 铁律 2） ─────────────────────────────────────

  /**
   * 采集单个节点的 `$fn`/`$fa`/`$fs` 特殊变量。
   *
   * 语义修正（M9 §1.3）：这些变量**不改变建模语义**，只控制导出时的
   * 三角化分片密度。转换器把它们采集为导出元数据，交给 parity runner
   * 在导出侧对齐分片参数。
   *
   * 采集策略：
   * - `$fn > 0`（显式指定）：取模型中最大值作为全局 segments。
   *   这是因为 `solidToShape(kernel, solid, segments)` 接受单一全局值，
   *   而显式 `$fn` 在 OpenSCAD 里也是统一分片数。
   * - `$fa`/`$fs`（无显式 `$fn`）：按 OpenSCAD 公式 + 节点半径算 fragments。
   *   sphere: `max(5, min(ceil(360/$fa), ceil(2πr/$fs)))`（下限 5，实验标定）；
   *   circle/cylinder: `max(3, min(ceil(360/$fa), ceil(2πr/$fs)))`（下限 3）。
   *   多节点取 max fragments 作为全局 segments（保证最细图元够细）。
   */
  private collectTessellation(node: CsgNode): void {
    // 只采集 FACETING_PRIMITIVES 中的节点（sphere/cylinder/cone/circle）
    // 以及 linear_extrude / rotate_extrude（它们的 $fn 作用于轮廓弧）
    if (
      !FACETING_PRIMITIVES.has(node.name) &&
      node.name !== 'linear_extrude' &&
      node.name !== 'rotate_extrude'
    ) {
      return
    }

    const fnArg = argumentOf(node, '$fn')
    const faArg = argumentOf(node, '$fa')
    const fsArg = argumentOf(node, '$fs')

    const fn = fnArg?.value.kind === 'number' && fnArg.value.value > 0
      ? Math.floor(fnArg.value.value)
      : undefined
    const fa = faArg?.value.kind === 'number' ? faArg.value.value : undefined
    const fs = fsArg?.value.kind === 'number' ? fsArg.value.value : undefined

    if (fn !== undefined) {
      this.bestFn = this.bestFn === undefined ? fn : Math.max(this.bestFn, fn)
    }
    if (fa !== undefined) {
      // $fa 越小越严格（更多分片），取最小值
      this.bestFa = this.bestFa === undefined ? fa : Math.min(this.bestFa, fa)
    }
    if (fs !== undefined) {
      // $fs 越小越严格（更多分片），取最小值
      this.bestFs = this.bestFs === undefined ? fs : Math.min(this.bestFs, fs)
    }

    // 计算本节点的 fragments 并更新全局 maxSegments
    const fragments = this.nodeFragments(node, fn, fa, fs)
    if (fragments !== undefined) {
      this.maxSegments = this.maxSegments === undefined ? fragments : Math.max(this.maxSegments, fragments)
    }
  }

  /**
   * 按本节点的参数计算 fragments 数。
   *
   * - 显式 `$fn > 0`：直接用 $fn。
   * - 无显式 `$fn`：按 `$fa`/`$fs` + 节点半径用 OpenSCAD 公式算。
   *   sphere 用 `sphereFragments`（下限 5），其余用 `circleFragments`（下限 3）。
   * - 无法提取半径（linear_extrude/rotate_extrude 的轮廓半径不在本节点）：
   *   返回 undefined，不参与 maxSegments 计算。
   */
  private nodeFragments(
    node: CsgNode,
    fn: number | undefined,
    fa: number | undefined,
    fs: number | undefined,
  ): number | undefined {
    if (fn !== undefined) return fn
    // 只有显式设置了 $fa 或 $fs 时才计算 fragments
    // （无显式 $ 变量时不采集 maxSegments，让 per-primitive segments 保持 undefined）
    if (fa === undefined && fs === undefined) return undefined
    const r = this.silentRadius(node)
    if (r === undefined) return undefined
    if (node.name === 'sphere') {
      return sphereFragments(r, undefined, fa, fs)
    }
    return circleFragments(r, undefined, fa, fs)
  }

  /**
   * 按节点的 `$fn`/`$fa`/`$fs` 和半径算 per-primitive segments。
   *
   * M9 §1.3 tessellation 方案（faijs 0.31.1+）：
   * - 显式 `$fn > 0`：segments = $fn（per-primitive override，优先于全局 deflection）。
   * - `$fn = 0` 或未设：返回 undefined，让全局 deflection 控制三角化密度。
   *   全局 deflection 在 parity runner 中通过 `createRuntime({ tessellation })` 设置，
   *   对应 OpenSCAD 的 `$fa`/`$fs` 默认值。
   *
   * 这避免了 segments 仅控制周向分段、而纵向仍由全局 deflection 决定的问题——
   * 不传 segments 时 OCCT 的 meshShape 在两个方向上统一使用 deflection。
   */
  private primitiveSegments(node: CsgNode, _radius: number, _isSphere: boolean): number | undefined {
    const fn = this.specialVar(node, '$fn')
    if (fn !== undefined && fn > 0) return Math.floor(fn)
    return undefined
  }

  /** 静默读取节点的特殊变量（$fn/$fa/$fs）数值，非数值或不存在返回 undefined。 */
  private specialVar(node: CsgNode, name: string): number | undefined {
    const a = argumentOf(node, name)
    return a?.value.kind === 'number' ? a.value.value : undefined
  }

  /**
   * 静默提取节点半径（不触发诊断）。
   * - sphere/circle：`r` 或 `d/2`
   * - cylinder/cone：`max(r1,r2)` 或 `max(d1,d2)/2`（取较大端，保证更细一侧够细）
   * - 其余：undefined
   */
  private silentRadius(node: CsgNode): number | undefined {
    const num = (name: string): number | undefined => {
      const a = argumentOf(node, name)
      return a?.value.kind === 'number' ? a.value.value : undefined
    }
    if (node.name === 'sphere' || node.name === 'circle') {
      const r = num('r')
      if (r !== undefined) return r
      const d = num('d')
      if (d !== undefined) return d / 2
      return undefined
    }
    if (node.name === 'cylinder' || node.name === 'cone') {
      const r1 = num('r1') ?? num('r')
      const r2 = num('r2') ?? num('r')
      const d1 = num('d1') ?? num('d')
      const d2 = num('d2') ?? num('d')
      const rr1 = r1 ?? (d1 !== undefined ? d1 / 2 : undefined)
      const rr2 = r2 ?? (d2 !== undefined ? d2 / 2 : undefined)
      if (rr1 === undefined && rr2 === undefined) return undefined
      return Math.max(rr1 ?? 0, rr2 ?? 0)
    }
    return undefined
  }

  /**
   * 计算最终的全局三角化参数。
   *
   * 始终返回 TessellationParams（使用 OpenSCAD 默认值 $fa=12, $fs=2 作为兜底），
   * 因为 parity 比对的 OpenSCAD 参考 STL 始终用这些默认值三角化。
   *
   * - 有显式 `$fn > 0`：返回 `fn` 和 `segments = fn`（per-primitive 覆盖）。
   *   `angularDeflection` = `2π / fn`（而非 $fa 转弧度），因为 $fn 是 per-primitive
   *   override，布尔运算后的 solidToShape 仍用全局 angularDeflection 做网格化——
   *   用 $fn 换算确保布尔后密度与显式 $fn 一致（修复 logo.scad 等 $fn>0 例子的密度不足）。
   * - 仅有 `$fa`/`$fs`（无显式 `$fn`）：返回 `fa`/`fs` 和
   *   `segments = maxSegments`（按各图元半径用 OpenSCAD 公式算出的最大 fragments）。
   *   `angularDeflection` = $fa 转弧度。
   * - 全部未设：使用 OpenSCAD 默认值 $fa=12, $fs=2。
   *
   * `linearDeflection` = $fs（mm）。
   * 这两个值交给 faijs `createRuntime({ tessellation })` 做全局三角化密度控制。
   */
  private computeTessellation(): TessellationParams {
    const fn = this.bestFn
    const fa = this.bestFa ?? DEFAULT_FA
    const fs = this.bestFs ?? DEFAULT_FS
    const segments = this.maxSegments
    // 当有显式 $fn 时，用 2π/fn 计算 angularDeflection（比 $fa 更细，匹配 $fn 覆盖语义）；
    // 否则用 $fa 转弧度。
    const angularDeflection = fn !== undefined
      ? (2 * Math.PI) / fn
      : (fa * Math.PI) / 180
    return {
      ...(fn === undefined ? {} : { fn }),
      ...(this.bestFa === undefined ? {} : { fa: this.bestFa }),
      ...(this.bestFs === undefined ? {} : { fs: this.bestFs }),
      ...(segments === undefined ? {} : { segments }),
      angularDeflection,
      linearDeflection: fs,
    }
  }

  // ── 诊断辅助 ─────────────────────────────────────────────────────────────

  private reportUnknownArgs(node: CsgNode): void {
    const known = KNOWN_ARGS[node.name]
    if (!known) return
    for (const arg of node.args) {
      if (arg.name === undefined) continue
      if (SPECIAL_VARIABLES.has(arg.name)) continue
      if (known.includes(arg.name)) continue
      this.bag.add({
        code: DiagnosticCode.OSC1004,
        message: `${node.name}: unknown argument '${arg.name}' — preserved in AST, ignored by lowering`,
        ...this.spanRef(arg.span),
      })
    }
  }

  /**
   * pass 6 tessellation-policy（M9 §1.3 修正后）：
   *
   * `$fn`/`$fa`/`$fs` 是**导出参数**，不是建模语义。转换器一律产出解析
   * 几何（sphere/cylinder/circle），这些变量只影响导出时的三角化分片密度。
   * OSC3201 从「analytic 不保留棱面」的信息降级为「三角化参数已采集，
   * 将在导出侧对齐」的备注——方向正确，语义已修正。
   *
   * 报 OSC3201 让 parity runner 知道这个例子有显式 `$fn`，需要做分片对齐。
   */
  private reportFaceting(node: CsgNode, id: number): void {
    if (!FACETING_PRIMITIVES.has(node.name)) return
    const fn = argumentOf(node, '$fn')
    if (!fn || fn.value.kind !== 'number' || fn.value.value <= 0) return
    this.bag.add({
      code: DiagnosticCode.OSC3201,
      message: `${node.name}: explicit $fn=${fn.value.value} recorded as tessellation parameter; analytic geometry preserved, faceting applied at export`,
      ...this.spanRef(node.span),
      nodeId: id,
    })
  }

  private blocked(node: CsgNode, id: number, origin: IrOrigin, reason: string): IrBlocked {
    this.bag.add({
      code: DiagnosticCode.OSC3002,
      message: `${node.name}: no faijs equivalent in v0 (${reason})`,
      ...this.spanRef(node.nameSpan),
      nodeId: id,
    })
    return { kind: 'blocked', id, origin, reason }
  }

  private missing(node: CsgNode, id: number, message: string): IrGeometry {
    this.bag.add({
      code: DiagnosticCode.OSC2001,
      message: `${node.name}: ${message}`,
      ...this.spanRef(node.span),
      nodeId: id,
    })
    return { kind: 'empty', id, origin: this.origin(id, node) }
  }

  private typeError(node: CsgNode, id: number, message: string): IrGeometry {
    this.bag.add({
      code: DiagnosticCode.OSC2002,
      message: `${node.name}: ${message}`,
      ...this.spanRef(node.span),
      nodeId: id,
    })
    return { kind: 'empty', id, origin: this.origin(id, node) }
  }

  private origin(id: number, node: CsgNode): IrOrigin {
    return {
      nodeId: id,
      span: node.span,
      ...(this.path === undefined ? {} : { path: this.path }),
      csgNode: node.name,
    }
  }

  private originFromSpan(nodeId: number, span: Span, csgNode: string): IrOrigin {
    return {
      nodeId,
      span,
      ...(this.path === undefined ? {} : { path: this.path }),
      csgNode,
    }
  }

  /** 诊断的 path/span 组合（Span 缺省时只写 path）。 */
  private spanRef(span: Span | undefined): { path?: string; span?: Span } {
    return {
      ...(this.path === undefined ? {} : { path: this.path }),
      ...(span === undefined ? {} : { span }),
    }
  }
}

// ── 纯工具 ──────────────────────────────────────────────────────────────────

function collect(root: IrGeometry): IrGeometry[] {
  const out: IrGeometry[] = []
  const stack: IrGeometry[] = [root]
  while (stack.length > 0) {
    const node = stack.pop() as IrGeometry
    out.push(node)
    switch (node.kind) {
      case 'union':
      case 'difference':
      case 'intersection':
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i])
        break
      case 'transform':
      case 'extrude':
      case 'color':
      case 'passthrough':
        stack.push(node.child)
        break
      default:
        break
    }
  }
  return out
}

/**
 * 节点**已知**的几何维度。`undefined` 覆盖三种情况：空几何、范围外节点、
 * 以及维度未知的组合节点（子节点全为范围外）。三者对调用方的含义都一样：
 * 「不能据此判定 2D/3D」。
 */
export function dimensionOf(node: IrGeometry): '2d' | '3d' | undefined {
  switch (node.kind) {
    case 'empty':
    case 'blocked':
      return undefined
    default:
      return node.dimension === 'unknown' ? undefined : node.dimension
  }
}

/** 把 IR 节点收窄成「2D 几何」，供 `linear_extrude` 使用。 */
export function asPlanar(node: IrGeometry): IrGeometry2D | undefined {
  if (node.kind === 'empty' || node.kind === 'blocked') return undefined
  return node.dimension === '2d' ? (node as IrGeometry2D) : undefined
}

function asVec(value: CsgValue, length: number): number[] | undefined {
  if (value.kind !== 'vector' || value.items.length !== length) return undefined
  const out: number[] = []
  for (const item of value.items) {
    if (item.kind !== 'number') return undefined
    out.push(item.value)
  }
  return out
}

/**
 * 4×4 仿射矩阵的线性部分行列式。底行不计入（faijs 要求 [0,0,0,1]，
 * 校验在 `matrixArg` 里已完成）。
 */
function determinant3(r0: readonly number[], r1: readonly number[], r2: readonly number[]): number {
  return (
    r0[0] * (r1[1] * r2[2] - r1[2] * r2[1]) -
    r0[1] * (r1[0] * r2[2] - r1[2] * r2[0]) +
    r0[2] * (r1[0] * r2[1] - r1[1] * r2[0])
  )
}

/** 供测试与下游复用的参数引用类型别名。 */
export type { CsgArgument }
