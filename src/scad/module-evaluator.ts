/**
 * OpenSCAD 模块求值器 + CSG 树转储器。
 *
 * 依据 OpenSCAD 公开的语义独立实现，不复制其 GPL 源码。
 *
 * 核心流程：
 *   1. 遍历 AST 语句（赋值、模块定义、函数定义、模块实例化、if、for）
 *   2. 内置模块（translate, rotate, scale, mirror, color, cube, sphere, ...）
 *      被求值为 CSG 节点树
 *   3. CSG 节点树被转储为与 OpenSCAD `--export-format csg` 输出完全一致的文本
 *
 * 输出格式要点（通过实测 OpenSCAD 2021.01 的 CSG 输出得出）：
 *   - 缩进使用 tab（每层一个 tab）
 *   - 数字格式：整数直接输出，浮点数使用 %.6g 格式（6 位有效数字，去掉尾部零）
 *   - 特殊变量 $fn/$fa/$fs 被注入到所有图元节点
 *   - translate/rotate/scale/mirror 被转换为 multmatrix
 *   - 多语句体被包裹在 group() 中
 *   - color 名称被转换为 RGBA 向量
 *   - 文件末尾有两个空行
 */
import type { Stmt, ModuleInstantiationStmt, Argument, IfStmt } from './ast'
import { evalExpr } from './evaluator'
import {
  type Scope,
  type Value,
  type UserModuleEntry,
  UNDEF,
  isNumber,
  isString,
  isTrue,
  isVector,
  num,
  toNumber,
  toStr,
} from './value'

// ─── CSG Node Tree (internal) ───

export interface CsgTreeNode {
  /** Node name, e.g. "cube", "sphere", "multmatrix", "union", etc. */
  name: string
  /** Modifier prefix characters (! * # %). */
  modifiers: string
  /** Named arguments in output order: [name, value][]. */
  args: [string, CsgVal][]
  /** Positional arguments (only multmatrix and color use these). */
  positional: CsgVal[]
  /** Child nodes. */
  children: CsgTreeNode[]
}

export type CsgVal =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'undef' }
  | { kind: 'infinity'; sign: 1 | -1 }
  | { kind: 'vector'; items: CsgVal[] }

// ─── Number formatting (matching OpenSCAD's %.6g) ───

export function formatCsgNumber(n: number): string {
  if (Number.isNaN(n)) return 'nan'
  if (n === Infinity) return 'inf'
  if (n === -Infinity) return '-inf'
  if (n === 0) {
    return Object.is(n, -0) ? '-0' : '0'
  }
  if (Number.isInteger(n)) return String(n)
  // OpenSCAD uses %.6g equivalent formatting
  let s = n.toPrecision(6)
  // Handle exponential notation - OpenSCAD doesn't use it in CSG output for normal values
  if (s.includes('e') || s.includes('E')) {
    s = n.toFixed(20).replace(/\.?0+$/, '')
    if (s === '' || s === '-') return '0'
    return s
  }
  // Remove trailing zeros after decimal point
  if (s.includes('.')) {
    s = s.replace(/0+$/, '')
    if (s.endsWith('.')) s = s.slice(0, -1)
  }
  // Handle negative zero
  if (s === '-0') s = '0'
  return s
}

// ─── Value to CsgVal conversion ───

function valueToCsgVal(v: Value): CsgVal {
  switch (v.type) {
    case 'number':
      if (Number.isNaN(v.value)) return { kind: 'number', value: 0 }
      if (v.value === Infinity) return { kind: 'infinity', sign: 1 }
      if (v.value === -Infinity) return { kind: 'infinity', sign: -1 }
      return { kind: 'number', value: v.value }
    case 'string':
      return { kind: 'string', value: v.value }
    case 'boolean':
      return { kind: 'boolean', value: v.value }
    case 'undef':
      return { kind: 'undef' }
    case 'vector':
      return { kind: 'vector', items: v.items.map(valueToCsgVal) }
    default:
      return { kind: 'undef' }
  }
}

// ─── CSG Dumper ───

export function dumpCsgTree(nodes: CsgTreeNode[]): string {
  const lines: string[] = []
  for (const node of nodes) {
    dumpNode(node, 0, lines)
  }
  // OpenSCAD CSG output uses CRLF line endings and ends with two empty lines
  lines.push('')
  lines.push('')
  return lines.join('\r\n')
}

function dumpNode(node: CsgTreeNode, indent: number, lines: string[]): void {
  const tabs = '\t'.repeat(indent)
  const modPrefix = node.modifiers
  const hasChildren = node.children.length > 0

  // Build argument string
  const argParts: string[] = []
  for (const [name, val] of node.args) {
    argParts.push(`${name} = ${dumpCsgVal(val)}`)
  }
  for (const val of node.positional) {
    argParts.push(dumpCsgVal(val))
  }
  const argStr = argParts.join(', ')

  if (hasChildren) {
    lines.push(`${tabs}${modPrefix}${node.name}(${argStr}) {`)
    for (const child of node.children) {
      dumpNode(child, indent + 1, lines)
    }
    lines.push(`${tabs}}`)
  } else {
    lines.push(`${tabs}${modPrefix}${node.name}(${argStr});`)
  }
}

function dumpCsgVal(val: CsgVal): string {
  switch (val.kind) {
    case 'number':
      return formatCsgNumber(val.value)
    case 'string':
      return `"${escapeString(val.value)}"`
    case 'boolean':
      return val.value ? 'true' : 'false'
    case 'undef':
      return 'undef'
    case 'infinity':
      return val.sign === -1 ? '-inf' : 'inf'
    case 'vector':
      return `[${val.items.map(dumpCsgVal).join(', ')}]`
  }
}

function escapeString(s: string): string {
  let result = ''
  for (const ch of s) {
    switch (ch) {
      case '\\': result += '\\\\'; break
      case '"': result += '\\"'; break
      case '\n': result += '\\n'; break
      case '\r': result += '\\r'; break
      case '\t': result += '\\t'; break
      default: result += ch
    }
  }
  return result
}

// ─── Special Variables ───

interface SpecialVars {
  fn: number
  fa: number
  fs: number
  t: number
  vpr: [number, number, number] | undefined
  vpt: [number, number, number] | undefined
  vpd: number | undefined
  vpz: number | undefined
  preview: boolean
}

function getSpecialVars(scope: Scope): SpecialVars {
  const get = (name: string): Value | undefined => scope.get(name)
  const fn = get('$fn')
  const fa = get('$fa')
  const fs = get('$fs')
  const t = get('$t')
  const vpr = get('$vpr')
  const vpt = get('$vpt')
  const vpd = get('$vpd')
  const vpz = get('$vpz')
  const preview = get('$preview')

  return {
    fn: fn !== undefined ? toNumber(fn) : 0,
    fa: fa !== undefined ? toNumber(fa) : 12,
    fs: fs !== undefined ? toNumber(fs) : 2,
    t: t !== undefined ? toNumber(t) : 0,
    vpr: vpr !== undefined && isVector(vpr) ? vpr.items.map(toNumber) as [number, number, number] : undefined,
    vpt: vpt !== undefined && isVector(vpt) ? vpt.items.map(toNumber) as [number, number, number] : undefined,
    vpd: vpd !== undefined ? toNumber(vpd) : undefined,
    vpz: vpz !== undefined ? toNumber(vpz) : undefined,
    preview: preview !== undefined ? isTrue(preview) : true,
  }
}

/** Inject $fn/$fa/$fs into a primitive node's args. */
function injectSpecialVars(args: [string, CsgVal][], sv: SpecialVars, callArgs?: readonly Argument[], scope?: Scope): void {
  // Check if $fn/$fa/$fs are explicitly passed as call arguments
  let fnVal: number | undefined
  let faVal: number | undefined
  let fsVal: number | undefined
  if (callArgs !== undefined && scope !== undefined) {
    for (const a of callArgs) {
      if (a.name === '$fn') fnVal = toNumber(evalExpr(a.value, scope))
      else if (a.name === '$fa') faVal = toNumber(evalExpr(a.value, scope))
      else if (a.name === '$fs') fsVal = toNumber(evalExpr(a.value, scope))
    }
  }
  // Only inject if not already present
  const hasFn = args.some(([n]) => n === '$fn')
  const hasFa = args.some(([n]) => n === '$fa')
  const hasFs = args.some(([n]) => n === '$fs')
  if (!hasFn) args.push(['$fn', { kind: 'number', value: fnVal ?? sv.fn }])
  if (!hasFa) args.push(['$fa', { kind: 'number', value: faVal ?? sv.fa }])
  if (!hasFs) args.push(['$fs', { kind: 'number', value: fsVal ?? sv.fs }])
}

// ─── Color name to RGBA ───

// X11 color names as used by OpenSCAD (values in 0-1 range, converted from 0-255)
const COLOR_NAMES: Record<string, [number, number, number]> = {
  aliceblue: [0.941176, 0.972549, 1],
  antiquewhite: [0.980392, 0.921569, 0.843137],
  aqua: [0, 1, 1],
  aquamarine: [0.498039, 1, 0.831373],
  azure: [0.941176, 1, 1],
  beige: [0.960784, 0.960784, 0.862745],
  bisque: [1, 0.894118, 0.768627],
  black: [0, 0, 0],
  blanchedalmond: [1, 0.921569, 0.803922],
  blue: [0, 0, 1],
  blueviolet: [0.541176, 0.168627, 0.886275],
  brown: [0.647059, 0.164706, 0.164706],
  burlywood: [0.870588, 0.721569, 0.529412],
  cadetblue: [0.372549, 0.619608, 0.627451],
  chartreuse: [0.498039, 1, 0],
  chocolate: [0.823529, 0.411765, 0.117647],
  coral: [1, 0.498039, 0.313726],
  cornflowerblue: [0.392157, 0.584314, 0.929412],
  cornsilk: [1, 0.972549, 0.862745],
  crimson: [0.862745, 0.078431, 0.235294],
  cyan: [0, 1, 1],
  darkblue: [0, 0, 0.545098],
  darkcyan: [0, 0.545098, 0.545098],
  darkgoldenrod: [0.721569, 0.52549, 0.043137],
  darkgray: [0.662745, 0.662745, 0.662745],
  darkgreen: [0, 0.392157, 0],
  darkgrey: [0.662745, 0.662745, 0.662745],
  darkkhaki: [0.741176, 0.717647, 0.419608],
  darkmagenta: [0.545098, 0, 0.545098],
  darkolivegreen: [0.333333, 0.419608, 0.184314],
  darkorange: [1, 0.54902, 0],
  darkorchid: [0.6, 0.196078, 0.8],
  darkred: [0.545098, 0, 0],
  darksalmon: [0.913725, 0.588235, 0.478431],
  darkseagreen: [0.560784, 0.737255, 0.560784],
  darkslateblue: [0.282353, 0.239216, 0.545098],
  darkslategray: [0.184314, 0.309804, 0.309804],
  darkslategrey: [0.184314, 0.309804, 0.309804],
  darkturquoise: [0, 0.807843, 0.819608],
  darkviolet: [0.580392, 0, 0.827451],
  deeppink: [1, 0.078431, 0.576471],
  deepskyblue: [0, 0.74902, 1],
  dimgray: [0.411765, 0.411765, 0.411765],
  dimgrey: [0.411765, 0.411765, 0.411765],
  dodgerblue: [0.117647, 0.564706, 1],
  firebrick: [0.698039, 0.133333, 0.133333],
  floralwhite: [1, 0.972549, 0.941176],
  forestgreen: [0.133333, 0.545098, 0.133333],
  fuchsia: [1, 0, 1],
  gainsboro: [0.862745, 0.862745, 0.862745],
  ghostwhite: [0.972549, 0.972549, 1],
  gold: [1, 0.843137, 0],
  goldenrod: [0.854902, 0.647059, 0.12549],
  gray: [0.745098, 0.745098, 0.745098],
  green: [0, 0.501961, 0],
  greenyellow: [0.678431, 1, 0.184314],
  grey: [0.745098, 0.745098, 0.745098],
  honeydew: [0.941176, 1, 0.941176],
  hotpink: [1, 0.411765, 0.705882],
  indianred: [0.803922, 0.360784, 0.360784],
  indigo: [0.294118, 0, 0.509804],
  ivory: [1, 1, 0.941176],
  khaki: [0.941176, 0.901961, 0.54902],
  lavender: [0.901961, 0.901961, 0.980392],
  lavenderblush: [1, 0.941176, 0.960784],
  lawngreen: [0.486275, 0.988235, 0],
  lemonchiffon: [1, 0.980392, 0.803922],
  lightblue: [0.678431, 0.847059, 0.901961],
  lightcoral: [0.941176, 0.501961, 0.501961],
  lightcyan: [0.878431, 1, 1],
  lightgoldenrod: [0.980392, 0.980392, 0.823529],
  lightgoldenrodyellow: [0.980392, 0.980392, 0.823529],
  lightgray: [0.827451, 0.827451, 0.827451],
  lightgreen: [0.564706, 0.933333, 0.564706],
  lightgrey: [0.827451, 0.827451, 0.827451],
  lightpink: [1, 0.713726, 0.756863],
  lightsalmon: [1, 0.627451, 0.478431],
  lightseagreen: [0.12549, 0.698039, 0.666667],
  lightskyblue: [0.529412, 0.807843, 0.980392],
  lightslategray: [0.466667, 0.533333, 0.6],
  lightslategrey: [0.466667, 0.533333, 0.6],
  lightsteelblue: [0.690196, 0.768627, 0.870588],
  lightyellow: [1, 1, 0.878431],
  lime: [0, 1, 0],
  limegreen: [0.196078, 0.803922, 0.196078],
  linen: [0.980392, 0.941176, 0.901961],
  magenta: [1, 0, 1],
  maroon: [0.690196, 0.188235, 0.376471],
  mediumaquamarine: [0.4, 0.803922, 0.666667],
  mediumblue: [0, 0, 0.803922],
  mediumorchid: [0.729412, 0.333333, 0.827451],
  mediumpurple: [0.576471, 0.439216, 0.858824],
  mediumseagreen: [0.235294, 0.701961, 0.443137],
  mediumslateblue: [0.482353, 0.407843, 0.933333],
  mediumspringgreen: [0, 0.980392, 0.603922],
  mediumturquoise: [0.282353, 0.819608, 0.8],
  mediumvioletred: [0.780392, 0.082353, 0.521569],
  midnightblue: [0.098039, 0.098039, 0.439216],
  mintcream: [0.960784, 1, 0.980392],
  mistyrose: [1, 0.894118, 0.882353],
  moccasin: [1, 0.894118, 0.709804],
  navajowhite: [1, 0.870588, 0.678431],
  navy: [0, 0, 0.501961],
  navyblue: [0, 0, 0.501961],
  oldlace: [0.992157, 0.960784, 0.901961],
  olive: [0.501961, 0.501961, 0],
  olivedrab: [0.419608, 0.556863, 0.137255],
  orange: [1, 0.647059, 0],
  orangered: [1, 0.270588, 0],
  orchid: [0.854902, 0.439216, 0.839216],
  palegoldenrod: [0.933333, 0.909804, 0.666667],
  palegreen: [0.596078, 0.984314, 0.596078],
  paleturquoise: [0.686275, 0.933333, 0.933333],
  palevioletred: [0.858824, 0.439216, 0.576471],
  papayawhip: [1, 0.937255, 0.835294],
  peachpuff: [1, 0.854902, 0.72549],
  peru: [0.803922, 0.521569, 0.247059],
  pink: [1, 0.752941, 0.796078],
  plum: [0.866667, 0.627451, 0.866667],
  powderblue: [0.690196, 0.878431, 0.901961],
  purple: [0.627451, 0.12549, 0.941176],
  rebeccapurple: [0.4, 0.2, 0.6],
  red: [1, 0, 0],
  rosybrown: [0.737255, 0.560784, 0.560784],
  royalblue: [0.254902, 0.411765, 0.882353],
  saddlebrown: [0.545098, 0.270588, 0.07451],
  salmon: [0.980392, 0.501961, 0.447059],
  sandybrown: [0.956863, 0.643137, 0.376471],
  seagreen: [0.180392, 0.545098, 0.341176],
  seashell: [1, 0.960784, 0.933333],
  sienna: [0.627451, 0.321569, 0.176471],
  silver: [0.752941, 0.752941, 0.752941],
  skyblue: [0.529412, 0.807843, 0.921569],
  slateblue: [0.415686, 0.352941, 0.803922],
  slategray: [0.439216, 0.501961, 0.564706],
  slategrey: [0.439216, 0.501961, 0.564706],
  snow: [1, 0.980392, 0.980392],
  springgreen: [0, 1, 0.498039],
  steelblue: [0.27451, 0.509804, 0.705882],
  tan: [0.823529, 0.705882, 0.54902],
  teal: [0, 0.501961, 0.501961],
  thistle: [0.847059, 0.74902, 0.847059],
  tomato: [1, 0.388235, 0.278431],
  turquoise: [0.25098, 0.878431, 0.815686],
  violet: [0.933333, 0.509804, 0.933333],
  wheat: [0.960784, 0.870588, 0.701961],
  white: [1, 1, 1],
  whitesmoke: [0.960784, 0.960784, 0.960784],
  yellow: [1, 1, 0],
  yellowgreen: [0.603922, 0.803922, 0.196078],
}

function colorNameToRgba(name: string): [number, number, number, number] | undefined {
  const lower = name.toLowerCase()
  const rgb = COLOR_NAMES[lower]
  if (rgb) return [rgb[0], rgb[1], rgb[2], 1]
  // Try hex color
  if (lower.startsWith('#')) {
    const hex = lower.slice(1)
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16) / 255
      const g = parseInt(hex.slice(2, 4), 16) / 255
      const b = parseInt(hex.slice(4, 6), 16) / 255
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      return [r, g, b, a]
    }
  }
  return undefined
}

// ─── Matrix operations ───

type Mat4 = number[][]

function identityMatrix(): Mat4 {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ]
}

function multiplyMatrix(a: Mat4, b: Mat4): Mat4 {
  const result: Mat4 = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        sum += a[i][k] * b[k][j]
      }
      result[i][j] = sum
    }
  }
  return result
}

function matrixToCsgVal(m: Mat4): CsgVal {
  return {
    kind: 'vector',
    items: m.map(row => ({
      kind: 'vector',
      items: row.map(v => ({ kind: 'number' as const, value: v }))
    }))
  }
}

// ─── Argument helpers ───

function getArg(args: readonly Argument[], name: string, scope: Scope): Value | undefined {
  for (const arg of args) {
    if (arg.name === name) {
      return evalExpr(arg.value, scope)
    }
  }
  return undefined
}

function getPositionalArg(args: readonly Argument[], index: number, scope: Scope): Value | undefined {
  let posIdx = 0
  for (const arg of args) {
    if (arg.name === undefined) {
      if (posIdx === index) return evalExpr(arg.value, scope)
      posIdx++
    }
  }
  return undefined
}

function getArgNumber(args: readonly Argument[], name: string, scope: Scope, defaultValue?: number): number {
  const v = getArg(args, name, scope)
  if (v === undefined) return defaultValue ?? 0
  return toNumber(v)
}

function getArgBool(args: readonly Argument[], name: string, scope: Scope, defaultValue?: boolean): boolean {
  const v = getArg(args, name, scope)
  if (v === undefined) return defaultValue ?? false
  return isTrue(v)
}

function getArgString(args: readonly Argument[], name: string, scope: Scope, defaultValue?: string): string {
  const v = getArg(args, name, scope)
  if (v === undefined) return defaultValue ?? ''
  if (isString(v)) return v.value
  return toStr(v)
}

function valueToVec3(v: Value | undefined, defaultVal: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (v === undefined) return defaultVal
  if (isVector(v)) {
    return [
      v.items.length > 0 ? toNumber(v.items[0]) : defaultVal[0],
      v.items.length > 1 ? toNumber(v.items[1]) : defaultVal[1],
      v.items.length > 2 ? toNumber(v.items[2]) : defaultVal[2],
    ]
  }
  if (isNumber(v)) {
    return [v.value, v.value, v.value]
  }
  return defaultVal
}

// ─── Module Evaluator ───

export interface ModuleEvalOptions {
  /** File loader for include/use directives. */
  fileLoader?: (path: string, cwd: string) => string | undefined
  /** Current working directory for resolving include/use paths. */
  cwd?: string
  /** Timestamp for import/surface nodes. */
  timestamp?: number
}

interface EvalContext {
  scope: Scope
  fileLoader?: (path: string, cwd: string) => string | undefined
  cwd: string
  timestamp: number
  /** Children passed to the current user module (for children() builtin). */
  childNodes: CsgTreeNode[]
}

export function evaluateModule(
  statements: readonly Stmt[],
  scope: Scope,
  options: ModuleEvalOptions = {},
): CsgTreeNode[] {
  const ctx: EvalContext = {
    scope,
    fileLoader: options.fileLoader,
    cwd: options.cwd ?? '.',
    timestamp: options.timestamp ?? Math.floor(Date.now() / 1000),
    childNodes: [],
  }

  // First pass: collect all top-level assignments, module defs, function defs
  // (OpenSCAD processes assignments in order, but module/function defs are available throughout)
  collectDefinitions(statements, scope)

  // Second pass: evaluate statements
  const results: CsgTreeNode[] = []
  for (const stmt of statements) {
    const nodes = evalStatement(stmt, ctx)
    results.push(...nodes)
  }

  return results
}

/** Collect module/function definitions so they're available throughout the file. */
function collectDefinitions(statements: readonly Stmt[], scope: Scope): void {
  for (const stmt of statements) {
    if (stmt.kind === 'moduleDef') {
      scope.setModule(stmt.name, {
        name: stmt.name,
        params: stmt.params,
        body: stmt.body,
        closure: scope,
      })
    } else if (stmt.kind === 'functionDef') {
      scope.setFunction(stmt.name, {
        name: stmt.name,
        params: stmt.params,
        body: stmt.body,
        closure: scope,
      })
    }
  }
}

function evalStatement(stmt: Stmt, ctx: EvalContext): CsgTreeNode[] {
  switch (stmt.kind) {
    case 'assignment': {
      ctx.scope.set(stmt.name, evalExpr(stmt.value, ctx.scope))
      return []
    }

    case 'moduleDef': {
      // Already collected in collectDefinitions, but inner module defs need to be registered
      ctx.scope.setModule(stmt.name, {
        name: stmt.name,
        params: stmt.params,
        body: stmt.body,
        closure: ctx.scope,
      })
      return []
    }

    case 'functionDef': {
      ctx.scope.setFunction(stmt.name, {
        name: stmt.name,
        params: stmt.params,
        body: stmt.body,
        closure: ctx.scope,
      })
      return []
    }

    case 'moduleInst':
      return evalModuleInst(stmt, ctx)

    case 'if':
      return evalIfStmt(stmt, ctx)

    case 'use':
    case 'include':
      // TODO: implement file loading
      return []

    case 'empty':
      return []
  }
}

/** Evaluate a list of child statements in a context. */
function evalChildStatements(statements: readonly Stmt[], ctx: EvalContext): CsgTreeNode[] {
  const results: CsgTreeNode[] = []
  for (const stmt of statements) {
    results.push(...evalStatement(stmt, ctx))
  }
  return results
}

function evalModuleInst(stmt: ModuleInstantiationStmt, ctx: EvalContext): CsgTreeNode[] {
  // Handle modifiers: * (disable), ! (show only), # (highlight), % (background)
  const hasDisable = stmt.modifiers.includes('*')
  const hasShowOnly = stmt.modifiers.includes('!')
  const hasHighlight = stmt.modifiers.includes('#')
  const hasBackground = stmt.modifiers.includes('%')

  if (hasDisable) {
    // Disabled module produces no output
    return []
  }

  const modPrefix = (hasHighlight ? '#' : '') + (hasBackground ? '%' : '') + (hasShowOnly ? '!' : '')

  // For builtins that need raw children statements (for, intersection_for, if, let), handle specially
  if (stmt.name === 'for') {
    const results = evalForModule(stmt, ctx)
    // for loop wraps all results in a group()
    if (results.length === 0) return []
    return [makeGroupNode(results, modPrefix)]
  }

  if (stmt.name === 'intersection_for') {
    const results = evalForModule(stmt, ctx)
    // intersection_for wraps all results in an intersection() node
    if (results.length === 0) return []
    return [{
      name: 'intersection',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: results,
    }]
  }

  // Evaluate children first (as CSG nodes)
  const childNodes = evalChildStatements(stmt.children, ctx)

  // Check user-defined modules first
  const userMod = ctx.scope.getModule(stmt.name)
  if (userMod !== undefined) {
    const results = evalUserModule(userMod, stmt.args, childNodes, ctx)
    // User module calls wrap their result in group()
    if (results.length === 0) return []
    return [makeGroupNode(results, modPrefix)]
  }

  // Check built-in modules
  const builtin = BUILTIN_MODULES.get(stmt.name)
  if (builtin !== undefined) {
    return builtin(stmt.args, childNodes, ctx, modPrefix, stmt.children)
  }

  // Unknown module - produce nothing
  return []
}

function evalForModule(stmt: ModuleInstantiationStmt, ctx: EvalContext): CsgTreeNode[] {
  const results: CsgTreeNode[] = []

  // for loops can have multiple assignments: for(a=[0:3], b=a*2) ...
  // Each assignment is evaluated and iterated in nested fashion.
  // In OpenSCAD, if the RHS is a scalar (number/string), it's treated as a
  // single-value binding (not iterated), similar to let().
  const iter = (argIdx: number, currentScope: Scope) => {
    if (argIdx >= stmt.args.length) {
      // Evaluate children with current scope
      const childCtx: EvalContext = { ...ctx, scope: currentScope }
      const childNodes = evalChildStatements(stmt.children, childCtx)
      results.push(...childNodes)
      return
    }
    const arg = stmt.args[argIdx]
    if (arg.name === undefined) return
    const val = evalExpr(arg.value, currentScope)
    // Collect values to iterate over
    const values: Value[] = []
    if (val.type === 'range') {
      const r = val.range
      for (let i = 0; i < r.count; i++) {
        values.push(num(r.start + i * r.step))
      }
    } else if (isVector(val)) {
      for (const item of val.items) values.push(item)
    } else {
      // Scalar value (number, string, etc.) — treat as single binding
      values.push(val)
    }
    for (const v of values) {
      const childScope = currentScope.child()
      childScope.set(arg.name, v)
      iter(argIdx + 1, childScope)
    }
  }
  iter(0, ctx.scope)

  return results
}

function evalUserModule(
  mod: UserModuleEntry,
  args: readonly Argument[],
  children: CsgTreeNode[],
  ctx: EvalContext,
): CsgTreeNode[] {
  const modScope = mod.closure.child()

  // Bind parameters
  for (let i = 0; i < mod.params.length; i++) {
    const param = mod.params[i]
    let argValue: Value | undefined

    // Look for named argument
    for (const a of args) {
      if (a.name === param.name) {
        argValue = evalExpr(a.value, ctx.scope)
        break
      }
    }

    // If not found by name, try positional
    if (argValue === undefined) {
      let posIdx = 0
      for (const a of args) {
        if (a.name === undefined) {
          if (posIdx === i) {
            argValue = evalExpr(a.value, ctx.scope)
            break
          }
          posIdx++
        }
      }
    }

    // Default value
    if (argValue === undefined && param.defaultValue !== undefined) {
      argValue = evalExpr(param.defaultValue, mod.closure)
    }

    modScope.set(param.name, argValue ?? UNDEF)
  }

  // Set $children to the number of children passed to this module
  modScope.set('$children', { type: 'number', value: children.length })

  // Handle special variables passed as arguments ($fn, $fa, $fs, etc.)
  for (const a of args) {
    if (a.name !== undefined && a.name.startsWith('$')) {
      modScope.set(a.name, evalExpr(a.value, ctx.scope))
    }
  }

  // Create a new context with the module scope and children
  const childCtx: EvalContext = { ...ctx, scope: modScope, childNodes: children }

  const results: CsgTreeNode[] = []
  for (const stmt of mod.body) {
    results.push(...evalStatement(stmt, childCtx))
  }

  return results
}

function evalIfStmt(stmt: IfStmt, ctx: EvalContext): CsgTreeNode[] {
  const cond = evalExpr(stmt.cond, ctx.scope)
  let results: CsgTreeNode[]
  if (isTrue(cond)) {
    results = evalChildStatements(stmt.then, ctx)
  } else if (stmt.els !== undefined) {
    results = evalChildStatements(stmt.els, ctx)
  } else {
    return []
  }
  // if statement wraps results in a group()
  if (results.length === 0) return []
  return [makeGroupNode(results, '')]
}

// ─── Builtin Modules ───

type BuiltinModule = (
  args: readonly Argument[],
  children: CsgTreeNode[],
  ctx: EvalContext,
  modPrefix: string,
  /** Raw child statements (needed for let/assert/echo modules) */
  childStatements: readonly Stmt[],
) => CsgTreeNode[]

function makeMultmatrixNode(matrix: Mat4, children: CsgTreeNode[], modPrefix: string): CsgTreeNode {
  return {
    name: 'multmatrix',
    modifiers: modPrefix,
    args: [],
    positional: [matrixToCsgVal(matrix)],
    children,
  }
}

function makeGroupNode(children: CsgTreeNode[], modPrefix: string): CsgTreeNode {
  return {
    name: 'group',
    modifiers: modPrefix,
    args: [],
    positional: [],
    children,
  }
}

const BUILTIN_MODULES = new Map<string, BuiltinModule>([
  // ─── Transformations ───

  ['translate', (args, children, ctx, modPrefix) => {
    const v = getArg(args, 'v', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    const [x, y, z] = valueToVec3(v)
    const m = identityMatrix()
    m[0][3] = x
    m[1][3] = y
    m[2][3] = z
    return [makeMultmatrixNode(m, children, modPrefix)]
  }],

  ['rotate', (args, children, ctx, modPrefix) => {
    const aVal = getArg(args, 'a', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    const vVal = getArg(args, 'v', ctx.scope) ?? getPositionalArg(args, 1, ctx.scope)

    let m = identityMatrix()

    if (aVal !== undefined && isVector(aVal)) {
      // rotate([x, y, z]) - Euler angles
      const [rx, ry, rz] = valueToVec3(aVal)
      m = multiplyMatrix(rotZ(rz), multiplyMatrix(rotY(ry), rotX(rx)))
    } else if (aVal !== undefined) {
      const angle = toNumber(aVal)
      if (vVal !== undefined && isVector(vVal)) {
        // rotate around arbitrary axis
        const [ax, ay, az] = valueToVec3(vVal)
        m = rotAxis(angle, ax, ay, az)
      } else {
        // rotate around Z axis by default
        m = rotZ(angle)
      }
    }

    return [makeMultmatrixNode(m, children, modPrefix)]
  }],

  ['scale', (args, children, ctx, modPrefix) => {
    const v = getArg(args, 'v', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    let sx = 1, sy = 1, sz = 1
    if (v !== undefined) {
      if (isVector(v)) {
        sx = v.items.length > 0 ? toNumber(v.items[0]) : 1
        sy = v.items.length > 1 ? toNumber(v.items[1]) : 1
        sz = v.items.length > 2 ? toNumber(v.items[2]) : 1
      } else if (isNumber(v)) {
        sx = sy = sz = v.value
      }
    }
    const m = identityMatrix()
    m[0][0] = sx
    m[1][1] = sy
    m[2][2] = sz
    return [makeMultmatrixNode(m, children, modPrefix)]
  }],

  ['mirror', (args, children, ctx, modPrefix) => {
    const v = getArg(args, 'v', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    const [nx, ny, nz] = valueToVec3(v, [0, 0, 0])
    // Normalize
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    let a = nx, b = ny, c = nz
    if (len > 0 && len !== 1) {
      a /= len
      b /= len
      c /= len
    }
    const m = identityMatrix()
    m[0][0] = 1 - 2 * a * a
    m[0][1] = -2 * a * b
    m[0][2] = -2 * a * c
    m[1][0] = -2 * a * b
    m[1][1] = 1 - 2 * b * b
    m[1][2] = -2 * b * c
    m[2][0] = -2 * a * c
    m[2][1] = -2 * b * c
    m[2][2] = 1 - 2 * c * c
    return [makeMultmatrixNode(m, children, modPrefix)]
  }],

  ['multmatrix', (args, children, ctx, modPrefix) => {
    const mVal = getPositionalArg(args, 0, ctx.scope) ?? getArg(args, 'm', ctx.scope)
    const m = identityMatrix()
    if (mVal !== undefined && isVector(mVal)) {
      const rows = mVal.items
      for (let i = 0; i < Math.min(4, rows.length); i++) {
        const row = rows[i]
        if (isVector(row)) {
          const cols = row.items
          for (let j = 0; j < Math.min(4, cols.length); j++) {
            m[i][j] = toNumber(cols[j])
          }
        }
      }
    }
    return [makeMultmatrixNode(m, children, modPrefix)]
  }],

  ['resize', (args, children, ctx, modPrefix) => {
    const newsize = getArg(args, 'newsize', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    const auto = getArg(args, 'auto', ctx.scope)
    const node: CsgTreeNode = {
      name: 'resize',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }
    if (newsize !== undefined) {
      node.args.push(['newsize', valueToCsgVal(newsize)])
    }
    if (auto !== undefined) {
      const autoVec = valueToVec3(auto, [0, 0, 0])
      node.args.push(['auto', {
        kind: 'vector',
        items: autoVec.map(v => ({ kind: 'boolean' as const, value: v !== 0 }))
      }])
    }
    const sv = getSpecialVars(ctx.scope)
    injectSpecialVars(node.args, sv)
    return [node]
  }],

  ['color', (args, children, ctx, modPrefix) => {
    const colorVal = getPositionalArg(args, 0, ctx.scope) ?? getArg(args, 'c', ctx.scope)
    const alpha = getArg(args, 'alpha', ctx.scope) ?? getPositionalArg(args, 1, ctx.scope)

    let rgba: [number, number, number, number] = [1, 1, 1, 1]

    if (colorVal !== undefined) {
      if (isString(colorVal)) {
        const named = colorNameToRgba(colorVal.value)
        if (named) {
          rgba = named
        } else {
          rgba = [0, 0, 0, 1]
        }
      } else if (isVector(colorVal)) {
        const items = colorVal.items
        if (items.length >= 3) {
          rgba = [toNumber(items[0]), toNumber(items[1]), toNumber(items[2]), 1]
          if (items.length >= 4) rgba[3] = toNumber(items[3])
        }
      }
    }

    if (alpha !== undefined) {
      rgba[3] = toNumber(alpha)
    }

    const node: CsgTreeNode = {
      name: 'color',
      modifiers: modPrefix,
      args: [],
      positional: [{
        kind: 'vector',
        items: rgba.map(v => ({ kind: 'number' as const, value: v }))
      }],
      children,
    }
    return [node]
  }],

  ['offset', (args, children, ctx, modPrefix) => {
    const rVal = getArg(args, 'r', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    const deltaVal = getArg(args, 'delta', ctx.scope)
    const chamferVal = getArg(args, 'chamfer', ctx.scope)

    const node: CsgTreeNode = {
      name: 'offset',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }

    if (deltaVal !== undefined) {
      node.args.push(['delta', valueToCsgVal(deltaVal)])
      if (chamferVal !== undefined) {
        node.args.push(['chamfer', valueToCsgVal(chamferVal)])
      }
    } else {
      const r = rVal !== undefined ? toNumber(rVal) : 0
      node.args.push(['r', { kind: 'number', value: r }])
      if (chamferVal !== undefined) {
        node.args.push(['chamfer', valueToCsgVal(chamferVal)])
      }
    }

    const sv = getSpecialVars(ctx.scope)
    injectSpecialVars(node.args, sv)
    return [node]
  }],

  ['hull', (args, children, ctx, modPrefix) => {
    return [{
      name: 'hull',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }]
  }],

  ['minkowski', (args, children, ctx, modPrefix) => {
    return [{
      name: 'minkowski',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }]
  }],

  ['render', (args, children, ctx, modPrefix) => {
    const convexity = getArg(args, 'convexity', ctx.scope)
    const node: CsgTreeNode = {
      name: 'render',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }
    if (convexity !== undefined) {
      node.args.push(['convexity', valueToCsgVal(convexity)])
    }
    return [node]
  }],

  // ─── Boolean Operations ───

  ['union', (args, children, ctx, modPrefix) => {
    return [{
      name: 'union',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }]
  }],

  ['difference', (args, children, ctx, modPrefix) => {
    return [{
      name: 'difference',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }]
  }],

  ['intersection', (args, children, ctx, modPrefix) => {
    return [{
      name: 'intersection',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }]
  }],

  // ─── Control Flow ───

  ['let', (args, children, _ctx, _modPrefix) => {
    // let() as a module - creates a new scope for children
    // Children are already evaluated, just pass through
    return children
  }],

  ['assert', (args, children, _ctx, _modPrefix) => {
    // assert as a module - just pass children through
    return children
  }],

  ['echo', (args, children, _ctx, _modPrefix) => {
    // echo as a module - just pass children through
    return children
  }],

  ['children', (args, children, ctx, _modPrefix) => {
    // children() returns the children passed to the current module
    const childNodes = ctx.childNodes
    const idxVal = getPositionalArg(args, 0, ctx.scope)
    if (idxVal !== undefined) {
      const idx = Math.floor(toNumber(idxVal))
      if (idx >= 0 && idx < childNodes.length) {
        return [childNodes[idx]]
      }
      return []
    }
    // children() without index wraps all children in group()
    if (childNodes.length === 0) return []
    return [makeGroupNode(childNodes, '')]
  }],

  ['assign', (args, children, ctx, _modPrefix) => {
    // assign() is deprecated but still works - just sets variables and passes children
    for (const arg of args) {
      if (arg.name !== undefined) {
        ctx.scope.set(arg.name, evalExpr(arg.value, ctx.scope))
      }
    }
    return children
  }],

  // ─── 3D Primitives ───

  ['cube', (args, children, ctx, modPrefix) => {
    const sizeVal = getArg(args, 'size', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    const center = getArgBool(args, 'center', ctx.scope, false)

    const node: CsgTreeNode = {
      name: 'cube',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: [],
    }

    if (sizeVal !== undefined) {
      if (isVector(sizeVal)) {
        node.args.push(['size', valueToCsgVal(sizeVal)])
      } else if (isNumber(sizeVal)) {
        const s = sizeVal.value
        node.args.push(['size', {
          kind: 'vector',
          items: [{ kind: 'number', value: s }, { kind: 'number', value: s }, { kind: 'number', value: s }]
        }])
      }
    } else {
      node.args.push(['size', {
        kind: 'vector',
        items: [{ kind: 'number', value: 1 }, { kind: 'number', value: 1 }, { kind: 'number', value: 1 }]
      }])
    }

    node.args.push(['center', { kind: 'boolean', value: center }])
    return [node]
  }],

  ['sphere', (args, children, ctx, modPrefix) => {
    const rVal = getArg(args, 'r', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    const dVal = getArg(args, 'd', ctx.scope)

    let r = 1
    if (rVal !== undefined) {
      r = toNumber(rVal)
    } else if (dVal !== undefined) {
      r = toNumber(dVal) / 2
    }

    const node: CsgTreeNode = {
      name: 'sphere',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: [],
    }

    const sv = getSpecialVars(ctx.scope)
    node.args.push(['$fn', { kind: 'number', value: sv.fn }])
    node.args.push(['$fa', { kind: 'number', value: sv.fa }])
    node.args.push(['$fs', { kind: 'number', value: sv.fs }])
    node.args.push(['r', { kind: 'number', value: r }])

    return [node]
  }],

  ['cylinder', (args, children, ctx, modPrefix) => {
    const hVal = getArg(args, 'h', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    const rVal = getArg(args, 'r', ctx.scope) ?? getPositionalArg(args, 1, ctx.scope)
    const r1Val = getArg(args, 'r1', ctx.scope)
    const r2Val = getArg(args, 'r2', ctx.scope)
    const dVal = getArg(args, 'd', ctx.scope)
    const d1Val = getArg(args, 'd1', ctx.scope)
    const d2Val = getArg(args, 'd2', ctx.scope)
    const center = getArgBool(args, 'center', ctx.scope, false)

    let r1 = 1, r2 = 1, h = 1

    if (hVal !== undefined) h = toNumber(hVal)

    if (r1Val !== undefined || r2Val !== undefined) {
      r1 = r1Val !== undefined ? toNumber(r1Val) : 1
      r2 = r2Val !== undefined ? toNumber(r2Val) : r1
    } else if (rVal !== undefined) {
      if (isVector(rVal)) {
        r1 = toNumber(rVal.items[0])
        r2 = rVal.items.length > 1 ? toNumber(rVal.items[1]) : r1
      } else {
        r1 = r2 = toNumber(rVal)
      }
    } else if (d1Val !== undefined || d2Val !== undefined) {
      r1 = d1Val !== undefined ? toNumber(d1Val) / 2 : 1
      r2 = d2Val !== undefined ? toNumber(d2Val) / 2 : r1
    } else if (dVal !== undefined) {
      const d = toNumber(dVal)
      r1 = r2 = d / 2
    }

    const node: CsgTreeNode = {
      name: 'cylinder',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: [],
    }

    const sv = getSpecialVars(ctx.scope)
    node.args.push(['$fn', { kind: 'number', value: sv.fn }])
    node.args.push(['$fa', { kind: 'number', value: sv.fa }])
    node.args.push(['$fs', { kind: 'number', value: sv.fs }])
    node.args.push(['h', { kind: 'number', value: h }])
    node.args.push(['r1', { kind: 'number', value: r1 }])
    node.args.push(['r2', { kind: 'number', value: r2 }])
    node.args.push(['center', { kind: 'boolean', value: center }])

    return [node]
  }],

  ['polyhedron', (args, children, ctx, modPrefix) => {
    const points = getArg(args, 'points', ctx.scope)
    const faces = getArg(args, 'faces', ctx.scope)
    const convexity = getArgNumber(args, 'convexity', ctx.scope, 1)
    const triangles = getArg(args, 'triangles', ctx.scope)

    const node: CsgTreeNode = {
      name: 'polyhedron',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: [],
    }

    if (points !== undefined) node.args.push(['points', valueToCsgVal(points)])
    if (faces !== undefined) {
      node.args.push(['faces', valueToCsgVal(faces)])
    } else if (triangles !== undefined) {
      node.args.push(['faces', valueToCsgVal(triangles)])
    }
    node.args.push(['convexity', { kind: 'number', value: convexity }])

    return [node]
  }],

  // ─── 2D Primitives ───

  ['square', (args, children, ctx, modPrefix) => {
    const sizeVal = getArg(args, 'size', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    const center = getArgBool(args, 'center', ctx.scope, false)

    const node: CsgTreeNode = {
      name: 'square',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: [],
    }

    if (sizeVal !== undefined) {
      if (isVector(sizeVal)) {
        node.args.push(['size', valueToCsgVal(sizeVal)])
      } else if (isNumber(sizeVal)) {
        const s = sizeVal.value
        node.args.push(['size', {
          kind: 'vector',
          items: [{ kind: 'number', value: s }, { kind: 'number', value: s }]
        }])
      }
    }
    node.args.push(['center', { kind: 'boolean', value: center }])
    return [node]
  }],

  ['circle', (args, children, ctx, modPrefix) => {
    const rVal = getArg(args, 'r', ctx.scope) ?? getPositionalArg(args, 0, ctx.scope)
    const dVal = getArg(args, 'd', ctx.scope)

    let r = 1
    if (rVal !== undefined) {
      r = toNumber(rVal)
    } else if (dVal !== undefined) {
      r = toNumber(dVal) / 2
    }

    const node: CsgTreeNode = {
      name: 'circle',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: [],
    }

    const sv = getSpecialVars(ctx.scope)
    node.args.push(['$fn', { kind: 'number', value: sv.fn }])
    node.args.push(['$fa', { kind: 'number', value: sv.fa }])
    node.args.push(['$fs', { kind: 'number', value: sv.fs }])
    node.args.push(['r', { kind: 'number', value: r }])

    return [node]
  }],

  ['polygon', (args, children, ctx, modPrefix) => {
    const points = getArg(args, 'points', ctx.scope)
    const paths = getArg(args, 'paths', ctx.scope)
    const convexity = getArgNumber(args, 'convexity', ctx.scope, 1)

    const node: CsgTreeNode = {
      name: 'polygon',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: [],
    }

    if (points !== undefined) {
      node.args.push(['points', valueToCsgVal(points)])
    }
    if (paths !== undefined) {
      node.args.push(['paths', valueToCsgVal(paths)])
    } else {
      node.args.push(['paths', { kind: 'undef' }])
    }
    node.args.push(['convexity', { kind: 'number', value: convexity }])

    return [node]
  }],

  // ─── Text ───

  ['text', (args, children, ctx, modPrefix) => {
    // text() has positional args: text (pos 0), size (pos 1)
    // Named args override positional ones
    const textPosVal = getPositionalArg(args, 0, ctx.scope)
    const sizePosVal = getPositionalArg(args, 1, ctx.scope)
    const textNamedVal = getArg(args, 'text', ctx.scope)
    const sizeNamedVal = getArg(args, 'size', ctx.scope)

    const text = textNamedVal !== undefined ? toStr(textNamedVal) : textPosVal !== undefined ? toStr(textPosVal) : ''
    const size = sizeNamedVal !== undefined ? toNumber(sizeNamedVal) : sizePosVal !== undefined ? toNumber(sizePosVal) : 10
    const font = getArgString(args, 'font', ctx.scope, '')
    const halign = getArgString(args, 'halign', ctx.scope, 'left')
    const valign = getArgString(args, 'valign', ctx.scope, 'baseline')
    const spacing = getArgNumber(args, 'spacing', ctx.scope, 1)
    const direction = getArgString(args, 'direction', ctx.scope, 'ltr')
    const language = getArgString(args, 'language', ctx.scope, 'en')
    const script = getArgString(args, 'script', ctx.scope, 'Latn')

    const node: CsgTreeNode = {
      name: 'text',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: [],
    }

    node.args.push(['text', { kind: 'string', value: text }])
    node.args.push(['size', { kind: 'number', value: size }])
    node.args.push(['spacing', { kind: 'number', value: spacing }])
    node.args.push(['font', { kind: 'string', value: font }])
    node.args.push(['direction', { kind: 'string', value: direction }])
    node.args.push(['language', { kind: 'string', value: language }])
    node.args.push(['script', { kind: 'string', value: script }])
    node.args.push(['halign', { kind: 'string', value: halign }])
    node.args.push(['valign', { kind: 'string', value: valign }])

    const sv = getSpecialVars(ctx.scope)
    injectSpecialVars(node.args, sv, args, ctx.scope)

    return [node]
  }],

  // ─── Extrusion ───

  ['linear_extrude', (args, children, ctx, modPrefix) => {
    const height = getArgNumber(args, 'height', ctx.scope, 100)
    const center = getArgBool(args, 'center', ctx.scope, false)
    const convexity = getArgNumber(args, 'convexity', ctx.scope, 1)
    const twistVal = getArg(args, 'twist', ctx.scope)
    const scaleVal = getArg(args, 'scale', ctx.scope)

    const node: CsgTreeNode = {
      name: 'linear_extrude',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }

    node.args.push(['height', { kind: 'number', value: height }])
    node.args.push(['center', { kind: 'boolean', value: center }])
    node.args.push(['convexity', { kind: 'number', value: convexity }])

    if (twistVal !== undefined) {
      node.args.push(['twist', valueToCsgVal(twistVal)])
    }

    // Scale is always output as a vector [sx, sy]
    if (scaleVal !== undefined) {
      if (isVector(scaleVal)) {
        node.args.push(['scale', valueToCsgVal(scaleVal)])
      } else if (isNumber(scaleVal)) {
        const s = scaleVal.value
        node.args.push(['scale', {
          kind: 'vector',
          items: [{ kind: 'number', value: s }, { kind: 'number', value: s }]
        }])
      }
    } else {
      node.args.push(['scale', {
        kind: 'vector',
        items: [{ kind: 'number', value: 1 }, { kind: 'number', value: 1 }]
      }])
    }

    const sv = getSpecialVars(ctx.scope)
    injectSpecialVars(node.args, sv)

    return [node]
  }],

  ['rotate_extrude', (args, children, ctx, modPrefix) => {
    const angle = getArgNumber(args, 'angle', ctx.scope, 360)
    const convexity = getArgNumber(args, 'convexity', ctx.scope, 2)

    const node: CsgTreeNode = {
      name: 'rotate_extrude',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }

    node.args.push(['angle', { kind: 'number', value: angle }])
    node.args.push(['convexity', { kind: 'number', value: convexity }])

    const sv = getSpecialVars(ctx.scope)
    injectSpecialVars(node.args, sv)

    return [node]
  }],

  // ─── Surface ───

  ['surface', (args, children, ctx, modPrefix) => {
    const file = getArgString(args, 'file', ctx.scope, '')
    const center = getArgBool(args, 'center', ctx.scope, false)
    const invert = getArgBool(args, 'invert', ctx.scope, false)

    const node: CsgTreeNode = {
      name: 'surface',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: [],
    }

    node.args.push(['file', { kind: 'string', value: file }])
    node.args.push(['center', { kind: 'boolean', value: center }])
    node.args.push(['invert', { kind: 'boolean', value: invert }])
    node.args.push(['timestamp', { kind: 'number', value: ctx.timestamp }])

    return [node]
  }],

  // ─── Import ───

  ['import', (args, children, ctx, modPrefix) => {
    const file = getArgString(args, 'file', ctx.scope, '')
    const layer = getArgString(args, 'layer', ctx.scope, '')
    const origin = getArg(args, 'origin', ctx.scope)
    const scale = getArgNumber(args, 'scale', ctx.scope, 1)
    const convexity = getArgNumber(args, 'convexity', ctx.scope, 1)

    const node: CsgTreeNode = {
      name: 'import',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children: [],
    }

    node.args.push(['file', { kind: 'string', value: file }])
    node.args.push(['layer', { kind: 'string', value: layer }])

    if (origin !== undefined) {
      node.args.push(['origin', valueToCsgVal(origin)])
    } else {
      node.args.push(['origin', {
        kind: 'vector',
        items: [{ kind: 'number', value: 0 }, { kind: 'number', value: 0 }]
      }])
    }

    node.args.push(['scale', { kind: 'number', value: scale }])
    node.args.push(['convexity', { kind: 'number', value: convexity }])

    const sv = getSpecialVars(ctx.scope)
    injectSpecialVars(node.args, sv)
    node.args.push(['timestamp', { kind: 'number', value: ctx.timestamp }])

    return [node]
  }],

  // ─── Projection ───

  ['projection', (args, children, ctx, modPrefix) => {
    const cut = getArgBool(args, 'cut', ctx.scope, false)
    const convexity = getArgNumber(args, 'convexity', ctx.scope, 0)

    const node: CsgTreeNode = {
      name: 'projection',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }

    node.args.push(['cut', { kind: 'boolean', value: cut }])
    node.args.push(['convexity', { kind: 'number', value: convexity }])

    return [node]
  }],

  // ─── Roof ───
  // roof() produces no output in CSG dump mode (requires CGAL/boost for geometry)
  ['roof', (_args, _children, _ctx, _modPrefix) => {
    return []
  }],

  // ─── fill ───

  ['fill', (args, children, ctx, modPrefix) => {
    const node: CsgTreeNode = {
      name: 'fill',
      modifiers: modPrefix,
      args: [],
      positional: [],
      children,
    }
    return [node]
  }],

  // ─── group ───

  ['group', (args, children, ctx, modPrefix) => {
    return [makeGroupNode(children, modPrefix)]
  }],
])

// ─── Rotation matrices ───

function rotX(angle: number): Mat4 {
  const rad = (angle * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [
    [1, 0, 0, 0],
    [0, c, -s, 0],
    [0, s, c, 0],
    [0, 0, 0, 1],
  ]
}

function rotY(angle: number): Mat4 {
  const rad = (angle * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [
    [c, 0, s, 0],
    [0, 1, 0, 0],
    [-s, 0, c, 0],
    [0, 0, 0, 1],
  ]
}

function rotZ(angle: number): Mat4 {
  const rad = (angle * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [
    [c, -s, 0, 0],
    [s, c, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ]
}

function rotAxis(angle: number, ax: number, ay: number, az: number): Mat4 {
  const rad = (angle * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const t = 1 - c

  // Normalize
  const len = Math.sqrt(ax * ax + ay * ay + az * az)
  let x = ax, y = ay, z = az
  if (len > 0 && len !== 1) {
    x /= len
    y /= len
    z /= len
  }

  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0],
    [0, 0, 0, 1],
  ]
}

// ─── Iteration ───

