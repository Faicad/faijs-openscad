/**
 * lowerScad：ScadAST → 结构化 Model IR（保留循环/递归/函数）。
 *
 * 与 lowerCsg（展开路径）的区别：lowerCsg 接收的是 OpenSCAD 前端完全展开后的
 * CSG AST，所有 for/if/module/递归已被展平。lowerScad 直接接收 ScadAST，
 * 保留 for → IrForLoop、if → IrIf、let → IrLet、用户 module → IrModuleCall，
 * emitter 据此发射 JS 的 for/if/递归 function，而非展开后的扁平语句。
 *
 * 内置 module 调用在 for/if 体内时参数可能依赖循环变量，此时用 IrExprCall
 * （参数化 faijs API 调用链）而非常量几何 IR（IrBox 等）。
 */
import type { Stmt, Expr, Argument, ModuleInstantiationStmt, IfStmt, Parameter } from '../scad/ast'
import type { ScadDocument } from '../scad/ast'
import { evalExpr } from '../scad/evaluator'
import {
  Scope,
  type Value,
  UNDEF,
  isNumber,
  isVector,
  isTrue,
  num,
  toNumber,
} from '../scad/value'
import { DiagnosticBag, type Diagnostic, type Span } from '../diagnostics/diagnostic'
import type {
  IrExpr,
  IrGeometry,
  IrModel,
  IrOrigin,
  IrForLoop,
  IrIterator,
  IrRangeSource,
  IrIf,
  IrLet,
  IrExprCall,
  IrModuleDef,
  IrFunctionDef,
  IrModuleCall,
  TessellationParams,
} from './model'
import { DEFAULT_FA, DEFAULT_FS } from './faceted-geometry'
import { readFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { parseScad } from '../scad/parser'

const callExpr = (callee: string, args: readonly IrExpr[]): IrExpr => ({ kind: 'call', callee, args })

export interface LowerScadOptions {
  readonly path?: string
  readonly openscadVersion?: string
}

export interface LowerScadResult {
  readonly model: IrModel
  readonly diagnostics: readonly Diagnostic[]
}

export function lowerScad(doc: ScadDocument, options: LowerScadOptions = {}): LowerScadResult {
  return new ScadLowerer(options).run(doc)
}

const BUILTIN_MODULES = new Set([
  'cube', 'sphere', 'cylinder', 'square', 'circle', 'polygon', 'polyhedron',
  'translate', 'rotate', 'scale', 'mirror', 'multmatrix', 'color',
  'union', 'difference', 'intersection', 'linear_extrude', 'rotate_extrude',
  'render', 'hull', 'minkowski', 'offset', 'fill', 'projection',
  'for', 'intersection_for', 'let', 'assert', 'echo', 'children',
])

const COLOR_NAMES: Record<string, [number, number, number]> = {
  red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1],
  cyan: [0, 1, 1], magenta: [1, 0, 1], yellow: [1, 1, 0],
  black: [0, 0, 0], white: [1, 1, 1], orange: [1, 0.5, 0],
  purple: [0.5, 0, 0.5], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5],
  silver: [0.753, 0.753, 0.753], teal: [0, 0.5, 0.5],
  olive: [0.5, 0.5, 0], maroon: [0.5, 0, 0], navy: [0, 0, 0.5],
  azure: [0, 0.5, 1], chartreuse: [0.5, 1, 0], gold: [1, 0.843, 0],
  pink: [1, 0.753, 0.796], brown: [0.647, 0.165, 0.165],
  coral: [1, 0.498, 0.314], turquoise: [0.251, 0.878, 0.816],
  salmon: [0.980, 0.502, 0.447], lime: [0, 1, 0],
  lavender: [0.902, 0.902, 0.980], tan: [0.824, 0.706, 0.549],
  khaki: [0.941, 0.902, 0.549], violet: [0.933, 0.510, 0.933],
  indigo: [0.294, 0, 0.509], crimson: [0.863, 0.078, 0.235],
  darkred: [0.545, 0, 0], darkgreen: [0, 0.392, 0],
  darkblue: [0, 0, 0.545], lightblue: [0.678, 0.847, 0.902],
  lightgreen: [0.565, 0.933, 0.565], lightgray: [0.827, 0.827, 0.827],
  lightgrey: [0.827, 0.827, 0.827], darkgray: [0.392, 0.392, 0.392],
  darkgrey: [0.392, 0.392, 0.392],
}

class ScadLowerer {
  private readonly bag = new DiagnosticBag()
  private nextId = 0
  private nextNodeId = 0
  private readonly path?: string
  private readonly openscadVersion?: string
  private readonly moduleDefs: IrModuleDef[] = []
  private readonly functionDefs: IrFunctionDef[] = []
  private readonly topBindings: { name: string; value: IrExpr }[] = []
  private readonly userModules = new Map<string, { params: readonly Parameter[]; body: readonly Stmt[] }>()
  private readonly userFunctions = new Map<string, { params: readonly Parameter[]; body: Expr }>()
  /** 返回矩阵的函数名集合（用于矩阵乘法类型推断）。 */
  private readonly matrixFunctions = new Set<string>()
  /** 矩阵变量名集合（module 参数默认值为矩阵，或顶层赋值为矩阵）。 */
  private readonly matrixVariables = new Set<string>()

  constructor(options: LowerScadOptions) {
    this.path = options.path
    this.openscadVersion = options.openscadVersion
  }

  run(doc: ScadDocument): LowerScadResult {
    const scope = createGlobalScope()

    // 处理 use/include：先收集导入的 module/function 定义
    const importedStmts = this.processImports(doc.statements)

    for (const stmt of importedStmts) {
      this.lowerTopStatement(stmt, scope)
    }

    for (const stmt of doc.statements) {
      this.lowerTopStatement(stmt, scope)
    }

    const geometries: IrGeometry[] = []
    for (const stmt of doc.statements) {
      if (stmt.kind === 'moduleInst' || stmt.kind === 'if' || stmt.kind === 'empty') {
        const g = this.lowerStatement(stmt, scope)
        geometries.push(...g)
      }
    }

    const root = this.combine(geometries, doc.span, 'root')
    const tessellation: TessellationParams = {
      angularDeflection: (DEFAULT_FA * Math.PI) / 180,
      linearDeflection: DEFAULT_FS,
    }

    return {
      model: {
        root,
        nodes: collectNodes(root),
        source: {
          ...(this.path === undefined ? {} : { path: basename(this.path) }),
          ...(this.openscadVersion === undefined ? {} : { openscadVersion: this.openscadVersion }),
        },
        tessellation,
        moduleDefs: this.moduleDefs,
        functionDefs: this.functionDefs,
        topBindings: this.topBindings,
      },
      diagnostics: this.bag.all(),
    }
  }

  private processImports(statements: readonly Stmt[], visited = new Set<string>()): Stmt[] {
    const imported: Stmt[] = []
    const basePath = this.path ?? process.cwd()
    const dir = dirname(basePath)

    for (const stmt of statements) {
      if (stmt.kind !== 'use' && stmt.kind !== 'include') continue
      const importPath = resolve(dir, stmt.path)
      if (visited.has(importPath)) continue
      visited.add(importPath)

      let text: string
      try {
        text = readFileSync(importPath, 'utf8')
      } catch {
        this.bag.add({ code: 'OSC5003', severity: 'warning', message: `Cannot read import: ${stmt.path}` })
        continue
      }

      const parsed = parseScad(text, { path: importPath })
      const nested = this.processImports(parsed.document.statements, visited)
      for (const s of nested) imported.push(s)

      for (const s of parsed.document.statements) {
        if (stmt.kind === 'use') {
          if (s.kind === 'moduleDef' || s.kind === 'functionDef' || s.kind === 'assignment') {
            imported.push(s)
          }
        } else {
          if (s.kind !== 'use' && s.kind !== 'include') imported.push(s)
        }
      }
    }
    return imported
  }

  private lowerTopStatement(stmt: Stmt, scope: Scope): void {
    switch (stmt.kind) {
      case 'assignment': {
        const v = evalExpr(stmt.value, scope)
        scope.set(stmt.name, v)
        if (this.exprIsMatrix(stmt.value)) this.matrixVariables.add(stmt.name)
        this.topBindings.push({ name: stmt.name, value: this.lowerExpr(stmt.value) })
        break
      }
      case 'moduleDef': {
        this.userModules.set(stmt.name, { params: stmt.params, body: stmt.body })
        for (const param of stmt.params) {
          if (param.defaultValue !== undefined && this.exprIsMatrix(param.defaultValue)) {
            this.matrixVariables.add(param.name)
          }
        }
        this.moduleDefs.push({
          name: stmt.name,
          params: stmt.params.map((p) => ({
            name: p.name,
            ...(p.defaultValue !== undefined ? { defaultValue: this.lowerExpr(p.defaultValue) } : {}),
          })),
          body: stmt.body
            .map((s) => this.lowerStatement(s, scope))
            .flat()
            .filter((g): g is IrGeometry => g !== undefined),
        })
        break
      }
      case 'functionDef': {
        this.userFunctions.set(stmt.name, { params: stmt.params, body: stmt.body })
        if (this.exprIsMatrix(stmt.body)) this.matrixFunctions.add(stmt.name)
        this.functionDefs.push({
          name: stmt.name,
          params: stmt.params.map((p) => ({
            name: p.name,
            ...(p.defaultValue !== undefined ? { defaultValue: this.lowerExpr(p.defaultValue) } : {}),
          })),
          body: this.lowerExpr(stmt.body),
        })
        break
      }
    }
  }

  private lowerStatement(stmt: Stmt, scope: Scope): IrGeometry[] {
    switch (stmt.kind) {
      case 'moduleInst':
        return this.lowerModuleInst(stmt, scope)
      case 'if':
        return [this.lowerIf(stmt, scope)]
      case 'assignment':
      case 'moduleDef':
      case 'functionDef':
      case 'use':
      case 'include':
      case 'empty':
        return []
    }
  }

  private lowerModuleInst(stmt: ModuleInstantiationStmt, scope: Scope): IrGeometry[] {
    if (stmt.name === 'for' || stmt.name === 'intersection_for') {
      return [this.lowerForLoop(stmt, scope, stmt.name === 'intersection_for')]
    }
    if (stmt.name === 'let') {
      return [this.lowerLetModule(stmt, scope)]
    }

    if (BUILTIN_MODULES.has(stmt.name) && !this.userModules.has(stmt.name)) {
      return this.lowerBuiltinModule(stmt, scope)
    }

    if (this.userModules.has(stmt.name)) {
      return [this.lowerUserModuleCall(stmt, scope)]
    }

    return []
  }

  private lowerForLoop(stmt: ModuleInstantiationStmt, scope: Scope, isIntersection: boolean): IrForLoop {
    const iterators: IrIterator[] = stmt.args.map((arg) => {
      const source = this.lowerForSource(arg.value)
      return {
        varName: arg.name ?? '_',
        source,
      }
    })

    const body = stmt.children
      .map((child) => this.lowerStatement(child, scope))
      .flat()
      .filter((g): g is IrGeometry => g !== undefined)

    return {
      kind: 'forLoop',
      id: this.nextId++,
      origin: this.origin(stmt.span, stmt.name),
      dimension: '3d',
      iterators,
      body,
      ...(isIntersection ? { intersection: true } : {}),
    }
  }

  private lowerForSource(expr: Expr): IrRangeSource | IrExpr {
    const irExpr = this.lowerExpr(expr)
    if (irExpr.kind === 'range') {
      return {
        kind: 'range',
        start: irExpr.start,
        end: irExpr.end,
        ...(irExpr.step !== undefined ? { step: irExpr.step } : {}),
      }
    }
    return irExpr
  }

  private lowerIf(stmt: IfStmt, scope: Scope): IrIf {
    const thenBody = stmt.then
      .map((s) => this.lowerStatement(s, scope))
      .flat()
      .filter((g): g is IrGeometry => g !== undefined)

    const elsBody = stmt.els
      ?.map((s) => this.lowerStatement(s, scope))
      .flat()
      .filter((g): g is IrGeometry => g !== undefined)

    return {
      kind: 'if',
      id: this.nextId++,
      origin: this.origin(stmt.span, 'if'),
      dimension: '3d',
      cond: this.lowerExpr(stmt.cond),
      then: thenBody,
      ...(elsBody !== undefined ? { els: elsBody } : {}),
    }
  }

  private lowerLetModule(stmt: ModuleInstantiationStmt, scope: Scope): IrLet {
    const bindings = stmt.args.map((arg) => ({
      name: arg.name ?? '_',
      value: this.lowerExpr(arg.value),
    }))

    const body = stmt.children
      .map((child) => this.lowerStatement(child, scope))
      .flat()
      .filter((g): g is IrGeometry => g !== undefined)

    return {
      kind: 'let',
      id: this.nextId++,
      origin: this.origin(stmt.span, 'let'),
      dimension: '3d',
      bindings,
      body,
    }
  }

  private lowerUserModuleCall(stmt: ModuleInstantiationStmt, scope: Scope): IrModuleCall {
    const args = stmt.args.map((arg) => this.lowerExpr(arg.value))
    const children = stmt.children
      .map((child) => this.lowerStatement(child, scope))
      .flat()
      .filter((g): g is IrGeometry => g !== undefined)

    return {
      kind: 'moduleCall',
      id: this.nextId++,
      origin: this.origin(stmt.span, stmt.name),
      dimension: '3d',
      functionName: stmt.name,
      args,
      ...(children.length > 0 ? { children } : {}),
    }
  }

  private lowerBuiltinModule(stmt: ModuleInstantiationStmt, scope: Scope): IrGeometry[] {
    if (stmt.name === 'children') {
      const getPos = (idx: number): Expr | undefined =>
        stmt.args.filter((a) => a.name === undefined)[idx]?.value
      const indexExpr = getPos(0)
      return [{
        kind: 'childrenRef',
        id: this.nextId++,
        origin: this.origin(stmt.span, 'children'),
        dimension: '3d',
        ...(indexExpr !== undefined ? { index: this.lowerExpr(indexExpr) } : {}),
      }]
    }

    const childGeometries = stmt.children
      .map((child) => this.lowerStatement(child, scope))
      .flat()
      .filter((g): g is IrGeometry => g !== undefined)

    const TRANSFORMS = new Set(['translate', 'rotate', 'scale', 'mirror', 'multmatrix', 'color'])
    if (TRANSFORMS.has(stmt.name)) {
      const transformChain = this.builtinChain(stmt, scope, false)
      if (transformChain.length === 0) return childGeometries
      return childGeometries.map((g) => {
        if (g.kind === 'exprCall') {
          return { ...g, chain: [...g.chain, ...transformChain] }
        }
        return g
      })
    }

    // render() — 几何透传
    if (stmt.name === 'render') {
      return childGeometries
    }

    // linear_extrude(height) { 2D profile } → cad.extrude(profile, { length })
    if (stmt.name === 'linear_extrude') {
      const getArg = (name: string): Expr | undefined => stmt.args.find((a) => a.name === name)?.value
      const getPos = (idx: number): Expr | undefined => stmt.args.filter((a) => a.name === undefined)[idx]?.value
      const hExpr = getArg('height') ?? getPos(0)
      const h: IrExpr = hExpr !== undefined ? this.lowerExpr(hExpr) : { kind: 'num', value: 1 }
      return childGeometries.map((g): IrExprCall => ({
        kind: 'exprCall',
        id: this.nextId++,
        origin: this.origin(stmt.span, 'linear_extrude'),
        dimension: '3d',
        child: g,
        chain: [{ method: 'cad.extrude', args: [{ kind: 'object', fields: [{ key: 'length', value: h }] }] }],
      }))
    }

    // rotate_extrude(angle) { 2D profile } → cad.revolve(profile, { axis, at, angle })
    if (stmt.name === 'rotate_extrude') {
      const getArg = (name: string): Expr | undefined => stmt.args.find((a) => a.name === name)?.value
      const getPos = (idx: number): Expr | undefined => stmt.args.filter((a) => a.name === undefined)[idx]?.value
      const angleExpr = getArg('angle') ?? getPos(0)
      const fields: { key: string; value: IrExpr }[] = [
        { key: 'axis', value: { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 1 }] } },
        { key: 'at', value: { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }] } },
      ]
      if (angleExpr !== undefined) {
        fields.push({ key: 'angle', value: this.deg2rad(this.lowerExpr(angleExpr)) })
      }
      return childGeometries.map((g): IrExprCall => ({
        kind: 'exprCall',
        id: this.nextId++,
        origin: this.origin(stmt.span, 'rotate_extrude'),
        dimension: '3d',
        child: g,
        chain: [{ method: 'cad.revolve', args: [{ kind: 'object', fields }] }],
      }))
    }

    const chain = this.builtinChain(stmt, scope, childGeometries.length > 0)
    if (chain.length === 0) return []

    const exprCall: IrExprCall = {
      kind: 'exprCall',
      id: this.nextId++,
      origin: this.origin(stmt.span, stmt.name),
      dimension: '3d',
      chain,
    }
    return [exprCall]
  }

  private builtinChain(
    stmt: ModuleInstantiationStmt,
    scope: Scope,
    hasChildren: boolean,
  ): { method: string; args: readonly IrExpr[] }[] {
    const getArg = (name: string): Expr | undefined =>
      stmt.args.find((a) => a.name === name)?.value
    const getPos = (idx: number): Expr | undefined =>
      stmt.args.filter((a) => a.name === undefined)[idx]?.value

    switch (stmt.name) {
      case 'cube': {
        const sizeExpr = getArg('size') ?? getPos(0)
        const centerExpr = getArg('center') ?? getPos(1)
        const [w, d, h] = this.sizeToExprs(sizeExpr, scope)
        const centered = this.evalBool(centerExpr, scope, false)
        return [{ method: 'cad.box', args: [w, d, h, this.boolExpr(centered)] }]
      }
      case 'sphere': {
        const rExpr = getArg('r') ?? getPos(0)
        const dExpr = getArg('d') ?? getPos(0)
        const r = rExpr !== undefined ? this.lenExpr(this.lowerExpr(rExpr)) : this.lenExpr(this.halfExpr(this.lowerExpr(dExpr ?? { kind: 'literal', type: 'number', value: 1, span: stmt.span })))
        const seg = this.segmentsExpr(stmt)
        return [{ method: 'cad.sphere', args: seg !== undefined ? [r, { kind: 'object', fields: [{ key: 'segments', value: seg }] }] : [r] }]
      }
      case 'cylinder': {
        const hExpr = getArg('h') ?? getPos(0)
        const rExpr = getArg('r') ?? getPos(1)
        const r1Expr = getArg('r1') ?? getPos(1)
        const r2Expr = getArg('r2') ?? getPos(2)
        const centerExpr = getArg('center')
        const h = this.lenExpr(this.lowerExpr(hExpr ?? { kind: 'literal', type: 'number', value: 1, span: stmt.span }))
        const centered = this.boolExpr(this.evalBool(centerExpr, scope, false))
        const seg = this.segmentsExpr(stmt)
        const segOpt = seg !== undefined ? [{ kind: 'object', fields: [{ key: 'segments', value: seg }] } as IrExpr] : []
        if (rExpr !== undefined) {
          const r = this.lenExpr(this.lowerExpr(rExpr))
          return [{ method: 'cad.cylinder', args: [r, h, centered, ...segOpt] }]
        }
        const r1 = this.lenExpr(this.lowerExpr(r1Expr ?? { kind: 'literal', type: 'number', value: 1, span: stmt.span }))
        const r2 = this.lenExpr(this.lowerExpr(r2Expr ?? { kind: 'literal', type: 'number', value: 1, span: stmt.span }))
        return [{ method: 'cad.cone', args: [r1, r2, h, centered, ...segOpt] }]
      }
      case 'square': {
        const sizeExpr = getArg('size') ?? getPos(0)
        const centerExpr = getArg('center') ?? getPos(1)
        const [w, h] = this.sizeToExprs(sizeExpr, scope)
        const centered = this.evalBool(centerExpr, scope, false)
        return [{ method: '__rect', args: [w, h, this.boolExpr(centered)] }]
      }
      case 'circle': {
        const rExpr = getArg('r') ?? getPos(0)
        const dExpr = getArg('d') ?? getPos(0)
        const r = rExpr !== undefined ? this.lenExpr(this.lowerExpr(rExpr)) : this.lenExpr(this.halfExpr(this.lowerExpr(dExpr ?? { kind: 'literal', type: 'number', value: 1, span: stmt.span })))
        return [{ method: '__circle', args: [r] }]
      }
      case 'translate': {
        const vExpr = getArg('v') ?? getPos(0)
        const m = this.translateMatrix(vExpr, scope)
        return [{ method: 'applyMatrix', args: [m] }]
      }
      case 'rotate': {
        const m = this.rotateMatrix(stmt, scope)
        return [{ method: 'applyMatrix', args: [m] }]
      }
      case 'scale': {
        const vExpr = getArg('v') ?? getPos(0)
        const m = this.scaleMatrix(vExpr, scope)
        return [{ method: 'applyMatrix', args: [m] }]
      }
      case 'multmatrix': {
        const mExpr = getPos(0) ?? getArg('m')
        if (mExpr === undefined) return []
        return [{ method: 'applyMatrix', args: [this.lowerExpr(mExpr)] }]
      }
      case 'color': {
        const cExpr = getPos(0) ?? getArg('c')
        if (cExpr === undefined) return []
        const c = this.lowerExpr(cExpr)
        if (c.kind === 'vector') {
          const r = c.elements[0] ?? { kind: 'num', value: 0 }
          const g = c.elements[1] ?? { kind: 'num', value: 0 }
          const b = c.elements[2] ?? { kind: 'num', value: 0 }
          const a = c.elements[3]
          const chain: { method: string; args: readonly IrExpr[] }[] = [{ method: 'setColor', args: [r, g, b] }]
          if (a !== undefined) chain.push({ method: 'setOpacity', args: [a] })
          return chain
        }
        if (c.kind === 'str') {
          const rgb = COLOR_NAMES[c.value.toLowerCase()]
          if (rgb !== undefined) {
            return [{ method: 'setColor', args: rgb.map((v) => ({ kind: 'num', value: v }) as IrExpr) }]
          }
        }
        return [{ method: 'setColor', args: [
          { kind: 'index', array: c, index: { kind: 'num', value: 0 } },
          { kind: 'index', array: c, index: { kind: 'num', value: 1 } },
          { kind: 'index', array: c, index: { kind: 'num', value: 2 } },
        ] }]
      }
      case 'union': {
        if (!hasChildren) return []
        return [{ method: 'cad.union', args: [{ kind: 'var', name: '__children' }] }]
      }
      case 'difference': {
        if (!hasChildren) return []
        return [{ method: 'cad.difference', args: [{ kind: 'var', name: '__children' }] }]
      }
      case 'intersection': {
        if (!hasChildren) return []
        return [{ method: 'cad.intersection', args: [{ kind: 'var', name: '__children' }] }]
      }
      case 'polygon': {
        const pointsExpr = getArg('points') ?? getPos(0)
        const pathsExpr = getArg('paths') ?? getPos(1)
        if (pointsExpr === undefined) return []
        const args: IrExpr[] = [this.lowerExpr(pointsExpr)]
        if (pathsExpr !== undefined) args.push(this.lowerExpr(pathsExpr))
        return [{ method: '__polygon', args }]
      }
      default:
        return []
    }
  }

  // ── 表达式 lower ──────────────────────────────────────────────────────────

  private lowerExpr(expr: Expr): IrExpr {
    switch (expr.kind) {
      case 'literal':
        if (expr.type === 'number') return { kind: 'num', value: expr.value as number }
        if (expr.type === 'string') return { kind: 'str', value: expr.value as string }
        if (expr.type === 'boolean') return { kind: 'bool', value: expr.value as boolean }
        return { kind: 'num', value: 0 }

      case 'lookup':
        return { kind: 'var', name: expr.name }

      case 'binary':
        if (expr.op === '*' && this.looksLikeMatrix(expr.left, expr.right)) {
          return { kind: 'matrixMul', matrices: this.collectMatrixMul(expr) }
        }
        return {
          kind: 'binary',
          op: expr.op,
          left: this.lowerExpr(expr.left),
          right: this.lowerExpr(expr.right),
        }

      case 'unary':
        return {
          kind: 'unary',
          op: expr.op,
          operand: this.lowerExpr(expr.operand),
        }

      case 'ternary':
        return {
          kind: 'ternary',
          cond: this.lowerExpr(expr.cond),
          then: this.lowerExpr(expr.then),
          els: this.lowerExpr(expr.els),
        }

      case 'call': {
        const callee = expr.callee.kind === 'lookup' ? expr.callee.name : ''
        const args = expr.args.map((a) => this.lowerExpr(a.value))
        return this.lowerBuiltinCall(callee, args)
      }

      case 'index':
        return {
          kind: 'index',
          array: this.lowerExpr(expr.array),
          index: this.lowerExpr(expr.index),
        }

      case 'vector':
        return { kind: 'vector', elements: expr.elements.map((e) => this.lowerExpr(e)) }

      case 'range':
        return {
          kind: 'range',
          start: this.lowerExpr(expr.start),
          end: this.lowerExpr(expr.end),
          ...(expr.step !== undefined ? { step: this.lowerExpr(expr.step) } : {}),
        }

      case 'funcdef':
      case 'let':
      case 'assert':
      case 'echo':
      case 'member':
        return { kind: 'num', value: 0 }
      case 'lcfor': {
        const iterators: IrIterator[] = expr.args.map((arg) => ({
          varName: arg.name ?? '_',
          source: this.lowerForSource(arg.value),
        }))
        return { kind: 'lcfor', iterators, body: this.lowerExpr(expr.body) }
      }
      case 'lcforc':
        return { kind: 'num', value: 0 }
      case 'lceach':
        return { kind: 'lceach', body: this.lowerExpr(expr.body) }
      case 'lclet': {
        const bindings = expr.args.map((arg) => ({
          name: arg.name ?? '_',
          value: this.lowerExpr(arg.value),
        }))
        return { kind: 'lclet', bindings, body: this.lowerExpr(expr.body) }
      }
      case 'lcif':
        return {
          kind: 'lcif',
          cond: this.lowerExpr(expr.cond),
          then: this.lowerExpr(expr.then),
          ...(expr.els !== undefined ? { els: this.lowerExpr(expr.els) } : {}),
        }
    }
  }

  // ── 矩阵辅助 ──────────────────────────────────────────────────────────────

  private deg2rad(e: IrExpr): IrExpr {
    return { kind: 'binary', op: '*', left: e, right: { kind: 'binary', op: '/', left: { kind: 'num', value: Math.PI }, right: { kind: 'num', value: 180 } } }
  }

  private lowerBuiltinCall(callee: string, args: readonly IrExpr[]): IrExpr {
    switch (callee) {
      case 'sin': return callExpr('Math.sin', [this.deg2rad(args[0])])
      case 'cos': return callExpr('Math.cos', [this.deg2rad(args[0])])
      case 'tan': return callExpr('Math.tan', [this.deg2rad(args[0])])
      case 'asin': return { kind: 'binary', op: '*', left: callExpr('Math.asin', [args[0]]), right: { kind: 'num', value: 180 / Math.PI } }
      case 'acos': return { kind: 'binary', op: '*', left: callExpr('Math.acos', [args[0]]), right: { kind: 'num', value: 180 / Math.PI } }
      case 'atan': return { kind: 'binary', op: '*', left: callExpr('Math.atan', [args[0]]), right: { kind: 'num', value: 180 / Math.PI } }
      case 'atan2': return { kind: 'binary', op: '*', left: callExpr('Math.atan2', [args[0], args[1]]), right: { kind: 'num', value: 180 / Math.PI } }
      case 'sqrt': return callExpr('Math.sqrt', [args[0]])
      case 'pow': return callExpr('Math.pow', [args[0], args[1]])
      case 'exp': return callExpr('Math.exp', [args[0]])
      case 'log': return callExpr('Math.log10', [args[0]])
      case 'ln': return callExpr('Math.log', [args[0]])
      case 'abs': return callExpr('Math.abs', [args[0]])
      case 'sign': return { kind: 'ternary', cond: { kind: 'binary', op: '<', left: args[0], right: { kind: 'num', value: 0 } }, then: { kind: 'num', value: -1 }, els: { kind: 'ternary', cond: { kind: 'binary', op: '>', left: args[0], right: { kind: 'num', value: 0 } }, then: { kind: 'num', value: 1 }, els: { kind: 'num', value: 0 } } }
      case 'floor': return callExpr('Math.floor', [args[0]])
      case 'ceil': return callExpr('Math.ceil', [args[0]])
      case 'round': return callExpr('Math.round', [args[0]])
      case 'trunc': return callExpr('Math.trunc', [args[0]])
      case 'min': return callExpr('Math.min', args)
      case 'max': return callExpr('Math.max', args)
      case 'len': return callExpr('__len', [args[0]])
      case 'rands': return callExpr('rands', args)
      case 'concat': return callExpr('__concat', args)
      case 'str': return callExpr('__str', args)
      case 'chr': return callExpr('String.fromCharCode', args.map((a) => callExpr('Math.round', [a])))
      case 'norm': return callExpr('Math.hypot', args)
      case 'cross': return callExpr('__cross', args)
      default: return { kind: 'call', callee, args }
    }
  }

  // ── 矩阵辅助 ──────────────────────────────────────────────────────────────

  private exprIsMatrix(e: Expr): boolean {
    if (e.kind === 'vector') return true
    if (e.kind === 'call' && e.callee.kind === 'lookup') {
      return this.matrixFunctions.has(e.callee.name)
    }
    if (e.kind === 'binary' && e.op === '*') {
      return this.exprIsMatrix(e.left) && this.exprIsMatrix(e.right)
    }
    if (e.kind === 'lookup') {
      return this.matrixVariables.has(e.name)
    }
    return false
  }

  private looksLikeMatrix(left: Expr, right: Expr): boolean {
    return this.exprIsMatrix(left) && this.exprIsMatrix(right)
  }

  private collectMatrixMul(expr: Expr): IrExpr[] {
    const parts: IrExpr[] = []
    const collect = (e: Expr): void => {
      if (e.kind === 'binary' && e.op === '*' && this.looksLikeMatrix(e.left, e.right)) {
        collect(e.left)
        collect(e.right)
      } else {
        parts.push(this.lowerExpr(e))
      }
    }
    collect(expr)
    return parts
  }

  private translateMatrix(vExpr: Expr | undefined, scope: Scope): IrExpr {
    const [x, y, z] = this.vec3Exprs(vExpr, scope)
    return {
      kind: 'vector',
      elements: [
        { kind: 'vector', elements: [{ kind: 'num', value: 1 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }, x] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 1 }, { kind: 'num', value: 0 }, y] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 1 }, z] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 1 }] },
      ],
    }
  }

  private rotateMatrix(stmt: ModuleInstantiationStmt, scope: Scope): IrExpr {
    const getArg = (name: string): Expr | undefined =>
      stmt.args.find((a) => a.name === name)?.value
    const getPos = (idx: number): Expr | undefined =>
      stmt.args.filter((a) => a.name === undefined)[idx]?.value

    const aExpr = getArg('a') ?? getPos(0)
    if (aExpr === undefined) return this.identityMatrixExpr()

    const aVal = evalExpr(aExpr, scope)
    if (isVector(aVal)) {
      const [rx, ry, rz] = aVal.items.map((v) => toNumber(v))
      return this.matrixMulExprs([
        this.rotZExpr({ kind: 'num', value: rz }),
        this.rotYExpr({ kind: 'num', value: ry }),
        this.rotXExpr({ kind: 'num', value: rx }),
      ])
    }
    const angle = this.lowerExpr(aExpr)
    return this.rotZExpr(angle)
  }

  private scaleMatrix(vExpr: Expr | undefined, scope: Scope): IrExpr {
    const [sx, sy, sz] = this.vec3Exprs(vExpr, scope, [1, 1, 1])
    return {
      kind: 'vector',
      elements: [
        { kind: 'vector', elements: [sx, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, sy, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, sz, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 1 }] },
      ],
    }
  }

  private rotZExpr(angle: IrExpr): IrExpr {
    const cos = callExpr('Math.cos', [angle])
    const sin = callExpr('Math.sin', [angle])
    const neg = (e: IrExpr): IrExpr => ({ kind: 'unary', op: '-', operand: e })
    return {
      kind: 'vector',
      elements: [
        { kind: 'vector', elements: [cos, neg(sin), { kind: 'num', value: 0 }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [sin, cos, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 1 }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 1 }] },
      ],
    }
  }

  private rotYExpr(angle: IrExpr): IrExpr {
    const cos = callExpr('Math.cos', [angle])
    const sin = callExpr('Math.sin', [angle])
    return {
      kind: 'vector',
      elements: [
        { kind: 'vector', elements: [cos, { kind: 'num', value: 0 }, sin, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 1 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'unary', op: '-', operand: sin }, { kind: 'num', value: 0 }, cos, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 1 }] },
      ],
    }
  }

  private rotXExpr(angle: IrExpr): IrExpr {
    const cos = callExpr('Math.cos', [angle])
    const sin = callExpr('Math.sin', [angle])
    return {
      kind: 'vector',
      elements: [
        { kind: 'vector', elements: [{ kind: 'num', value: 1 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, cos, { kind: 'unary', op: '-', operand: sin }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, sin, cos, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 1 }] },
      ],
    }
  }

  private matrixMulExprs(matrices: IrExpr[]): IrExpr {
    return { kind: 'matrixMul', matrices }
  }

  private identityMatrixExpr(): IrExpr {
    return {
      kind: 'vector',
      elements: [
        { kind: 'vector', elements: [{ kind: 'num', value: 1 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 1 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 1 }, { kind: 'num', value: 0 }] },
        { kind: 'vector', elements: [{ kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 0 }, { kind: 'num', value: 1 }] },
      ],
    }
  }

  // ── 表达式辅助 ────────────────────────────────────────────────────────────

  private lenExpr(e: IrExpr): IrExpr {
    return { kind: 'binary', op: '*', left: e, right: { kind: 'var', name: 'MM' } }
  }

  private halfExpr(e: IrExpr): IrExpr {
    return { kind: 'binary', op: '/', left: e, right: { kind: 'num', value: 2 } }
  }

  private boolExpr(b: boolean): IrExpr {
    return { kind: 'bool', value: b }
  }

  private evalBool(expr: Expr | undefined, scope: Scope, def: boolean): boolean {
    if (expr === undefined) return def
    const v = evalExpr(expr, scope)
    return isTrue(v)
  }

  private segmentsExpr(stmt: ModuleInstantiationStmt): IrExpr | undefined {
    const fnExpr = stmt.args.find((a) => a.name === '$fn')?.value
    if (fnExpr !== undefined) return this.lowerExpr(fnExpr)
    return undefined
  }

  private sizeToExprs(sizeExpr: Expr | undefined, scope: Scope): [IrExpr, IrExpr, IrExpr] {
    if (sizeExpr === undefined) return [this.lenExpr({ kind: 'num', value: 1 }), this.lenExpr({ kind: 'num', value: 1 }), this.lenExpr({ kind: 'num', value: 1 })]
    const ir = this.lowerExpr(sizeExpr)
    if (ir.kind === 'vector') {
      const w = this.lenExpr(ir.elements[0] ?? { kind: 'num', value: 1 })
      const d = this.lenExpr(ir.elements[1] ?? { kind: 'num', value: 1 })
      const h = this.lenExpr(ir.elements[2] ?? { kind: 'num', value: 1 })
      return [w, d, h]
    }
    const e = this.lenExpr(ir)
    return [e, e, e]
  }

  private vec3Exprs(vExpr: Expr | undefined, scope: Scope, def: number[] = [0, 0, 0]): [IrExpr, IrExpr, IrExpr] {
    if (vExpr === undefined) return [this.lenExpr({ kind: 'num', value: def[0] }), this.lenExpr({ kind: 'num', value: def[1] }), this.lenExpr({ kind: 'num', value: def[2] })]
    const ir = this.lowerExpr(vExpr)
    if (ir.kind === 'vector') {
      return [
        this.lenExpr(ir.elements[0] ?? { kind: 'num', value: def[0] }),
        this.lenExpr(ir.elements[1] ?? { kind: 'num', value: def[1] }),
        this.lenExpr(ir.elements[2] ?? { kind: 'num', value: def[2] }),
      ]
    }
    return [this.lenExpr(ir), this.lenExpr({ kind: 'num', value: 0 }), this.lenExpr({ kind: 'num', value: 0 })]
  }

  // ── 通用辅助 ──────────────────────────────────────────────────────────────

  private origin(span: Span, csgNode: string): IrOrigin {
    return { nodeId: this.nextNodeId++, span, csgNode, ...(this.path !== undefined ? { path: this.path } : {}) }
  }

  private combine(geometries: IrGeometry[], span: Span, csgNode: string): IrGeometry {
    if (geometries.length === 0) {
      return { kind: 'empty', id: this.nextId++, origin: this.origin(span, csgNode) }
    }
    if (geometries.length === 1) return geometries[0]
    return {
      kind: 'union',
      id: this.nextId++,
      origin: this.origin(span, csgNode),
      dimension: '3d',
      children: geometries,
    }
  }
}

function createGlobalScope(): Scope {
  return new Scope()
}

function collectNodes(root: IrGeometry): IrGeometry[] {
  const nodes: IrGeometry[] = []
  const visit = (n: IrGeometry): void => {
    nodes.push(n)
    for (const child of irChildrenLocal(n)) visit(child)
  }
  visit(root)
  return nodes
}

function irChildrenLocal(node: IrGeometry): readonly IrGeometry[] {
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
    case 'forLoop':
      return node.body
    case 'if':
      return [...node.then, ...(node.els ?? [])]
    case 'let':
      return node.body
    case 'moduleCall':
      return node.children ?? []
    case 'exprCall':
    case 'childrenRef':
    case 'box':
    case 'sphere':
    case 'cylinder':
    case 'cone':
    case 'polyhedron':
    case 'rect2d':
    case 'circle2d':
    case 'polygon2d':
    case 'empty':
    case 'blocked':
      return []
  }
}