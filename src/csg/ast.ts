/**
 * CSG AST（plan §4.2，M1）。
 *
 * 设计约束来自对验证语料的**实测**（2026-10-06），不是
 * 对 OpenSCAD 语言的推测：
 *
 *  - 参数有**两种**写法，实测都真实存在（2026-10-06 复核）：
 *      · 命名 `name = value`   17376 个 —— square/cylinder/sphere/cube/text/…
 *      · 位置 `value`           7221 个（占 29%），**只出现在两个节点上**：
 *          `multmatrix` 4790（4×4 矩阵）、`color` 2431（RGBA 向量）
 *    ⚠️ 早先一版统计脚本只匹配 `name = value`，把没有 `=` 的参数静默跳过，
 *    因而得出「参数全部是命名参数」的**错误**结论。位置参数不是边角情况，
 *    AST 必须能表达它，否则 `multmatrix` / `color` 这两个高频节点直接解析不了。
 *  - 参数值只有 6 种形态，且**没有第 7 种**：
 *      number 8214 / boolean 3892 / vector 3849 / string 1322 / undef 87 / infinity 12
 *    —— 没有函数调用、没有算术、没有 `for` 推导式。CSG 是**已求值**的产物，
 *    所以这一层不需要表达式求值器。
 *  - 节点以 `;`（无子节点）或 `{ ... }`（有子节点）结尾，两者都要保留：
 *    `intersection();` 与 `intersection() {}` 几何等价，但保真应当保留差异。
 *  - 修饰符按出现顺序保留（OpenSCAD 允许 `%#` 叠加）。
 *
 * 每个节点与每个值都带 `span`（1-based 行列 + 0-based offset），这是后续
 * 「诊断指回源位置」和「emitter 输出稳定注释」的唯一依据。
 */
import type { Span } from '../diagnostics/diagnostic'

/** 语法层允许的修饰符。注意 `!` 通常在 dump 前已被 OpenSCAD 消解。 */
export type CsgModifierToken = '%' | '#' | '!'

export type CsgNodeTerminator =
  /** `name(args);` —— 无子节点 */
  | 'semicolon'
  /** `name(args) { ... }` —— 有子节点（`{}` 为空也算） */
  | 'braces'

export interface CsgNumberValue {
  readonly kind: 'number'
  readonly value: number
  /** 原始字面量（如 `1e+06`、`-0`），保留以免浮点重格式化丢失信息。 */
  readonly raw: string
  readonly span: Span
}

export interface CsgStringValue {
  readonly kind: 'string'
  /** 已解转义的内容。 */
  readonly value: string
  /** 含引号的原始片段。 */
  readonly raw: string
  readonly span: Span
}

export interface CsgBooleanValue {
  readonly kind: 'boolean'
  readonly value: boolean
  readonly span: Span
}

export interface CsgUndefValue {
  readonly kind: 'undef'
  readonly span: Span
}

/**
 * `inf` / `-inf`。实测语料中真实存在（`circle(r = inf)`、
 * `cube(size = [inf, inf, inf])`、`-inf`），不是理论情况。
 */
export interface CsgInfinityValue {
  readonly kind: 'infinity'
  readonly sign: 1 | -1
  readonly span: Span
}

export interface CsgVectorValue {
  readonly kind: 'vector'
  readonly items: readonly CsgValue[]
  readonly span: Span
}

export type CsgValue =
  | CsgNumberValue
  | CsgStringValue
  | CsgBooleanValue
  | CsgUndefValue
  | CsgInfinityValue
  | CsgVectorValue

/** 值形态的判别标签，便于做穷举检查。 */
export type CsgValueKind = CsgValue['kind']

export interface CsgArgument {
  /** 命名参数的名字。**位置参数为 undefined**。 */
  readonly name?: string
  readonly value: CsgValue
  /** 在参数列表中的序号（0-based）。位置参数的语义由序号决定。 */
  readonly index: number
  readonly span: Span
  /** 命名参数的 `name =` 区间；位置参数为 undefined。 */
  readonly nameSpan?: Span
}

export interface CsgNode {
  readonly kind: 'node'
  readonly name: string
  readonly modifiers: readonly CsgModifierToken[]
  readonly args: readonly CsgArgument[]
  readonly children: readonly CsgNode[]
  readonly terminator: CsgNodeTerminator
  /** 整个节点，从修饰符到 `;` / `}`。 */
  readonly span: Span
  readonly nameSpan: Span
  /** `(` … `)` 区间；缺少参数列表时为 undefined（并已产生 OSC1002）。 */
  readonly argListSpan?: Span
  /** `{` … `}` 区间；`;` 结尾时为 undefined。 */
  readonly bodySpan?: Span
}

export interface CsgDocument {
  readonly nodes: readonly CsgNode[]
  readonly span: Span
}

/** 合并两个区间（取 start 的起点与 end 的终点）。 */
export function joinSpans(start: Span, end: Span): Span {
  return { start: start.start, end: end.end }
}

/**
 * 按参数名取参数。位置参数没有名字，永远不会被匹配到。
 * 同名重复时取最后一个（与 OpenSCAD 一致）。
 */
export function argumentOf(node: CsgNode, name: string): CsgArgument | undefined {
  for (let i = node.args.length - 1; i >= 0; i--) {
    const a = node.args[i]
    if (a.name === name) return a
  }
  return undefined
}

/** 按序号取参数（同时覆盖命名参数与位置参数）。 */
export function argumentAt(node: CsgNode, index: number): CsgArgument | undefined {
  return node.args[index]
}

/**
 * 所有位置参数。
 * 实测（2026-10-06）：只有 `multmatrix`（4×4 矩阵）与 `color`（RGBA 向量）
 * 使用位置参数，且它们**只用**位置参数。
 */
export function positionalArguments(node: CsgNode): readonly CsgArgument[] {
  return node.args.filter((a) => a.name === undefined)
}

/** 第一个位置参数的值，便于 `multmatrix` / `color` 这类节点直取。 */
export function firstPositionalValue(node: CsgNode): CsgValue | undefined {
  return positionalArguments(node)[0]?.value
}

/** 深度优先遍历所有节点（前序）。 */
export function walkCsg(node: CsgNode, visit: (n: CsgNode) => void): void {
  visit(node)
  for (const child of node.children) walkCsg(child, visit)
}

/** 整棵文档的节点总数（含根层所有节点）。 */
export function countCsgNodes(document: CsgDocument): number {
  let n = 0
  for (const node of document.nodes) walkCsg(node, () => n++)
  return n
}

/** 按名字统计节点出现次数，用于与语料直方图探针对账。 */
export function countCsgNodesByName(document: CsgDocument): Map<string, number> {
  const out = new Map<string, number>()
  for (const node of document.nodes) {
    walkCsg(node, (n) => out.set(n.name, (out.get(n.name) ?? 0) + 1))
  }
  return out
}

/** 把值渲染回接近原始的文本（用于诊断消息，不用于 emitter）。 */
export function describeCsgValue(value: CsgValue): string {
  switch (value.kind) {
    case 'number':
      return value.raw
    case 'string':
      return value.raw
    case 'boolean':
      return value.value ? 'true' : 'false'
    case 'undef':
      return 'undef'
    case 'infinity':
      return value.sign === -1 ? '-inf' : 'inf'
    case 'vector':
      return `[${value.items.map(describeCsgValue).join(', ')}]`
  }
}
