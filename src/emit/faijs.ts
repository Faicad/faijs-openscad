/**
 * faijs emitter：Model IR → `.fai.js`（plan §4.4，M2）。
 *
 * 发射原则（每一条都由探针钉住，见 emit/*.probe.test.ts）：
 *
 *  - 每个几何节点一个稳定变量名 `part0`、`part1`……按**后序**分配，于是深层
 *    树被拆成顺序语句，报错行号能直接对回某个子树。
 *  - 长度字面量一律 `* MM`（`MM === 1`）；矩阵元素**裸数字**——旋转分量无量纲，
 *    逐元素加单位在语义上就是错的（emit/faijs-apply-matrix.probe.test.ts）。
 *  - profile 的弧角是**裸弧度**（emit/faijs-2d-profile.probe.test.ts 的实测形态），
 *    不加 `* RADIAN`：`RADIAN` 常量是「1 弧度 = 57.2958 度」的换算因子，
 *    乘上去会把 π 变成 180。
 *  - 单位常量 `MM` 与 `cad` 都是**免 import 的脚本面全局**（emit/faijs-script-globals.probe.test.ts），
 *    所以生成物没有任何 import 行。
 *  - 外观走 `Shape` 的实例方法 `setColor` / `setOpacity`，不是 op。
 *  - 遇到 `IrBlocked` 时**拒绝产出可执行代码**：`ok:false` 且 `code` 为空串。
 *    绝不生成「看起来能跑」的近似几何（plan §5.4）。
 */
import { CONVERTER_VERSION } from '../version'
import type { IrGeometry, IrModel, IrExpr, IrForLoop, IrIterator, IrIf, IrLet, IrModuleCall, IrExprCall, Matrix4, Vec2, Vec4 } from '../ir/model'
import { exactNumber, formatNumber, lengthLiteral } from './units'

export interface EmitOptions {
  /** 是否输出头部注释（源文件、版本、警告摘要）。默认 true。 */
  readonly header?: boolean
  /** 几何变量名前缀。默认 `part`。 */
  readonly variablePrefix?: string
  /**
   * 紧凑模式：去除多行矩阵/profile 段中的多余换行与空格，
   * 用于产出超大代码时压低于 faijs 静态校验器的 1 MiB 上限。
   * 默认 false（保持可读）。
   */
  readonly compact?: boolean
  /**
   * 强制把全部语句包进 `export default async (cad) => { ... }` 容器。
   * faijs 静态校验器对**扁平**脚本有 5000 条顶层语句上限（S5）；
   * 未显式指定时，顶层语句数接近上限会自动启用容器（见 `Emitter.wrapBody`）。
   */
  readonly container?: boolean
}

export interface EmitResult {
  /** 生成物。`ok === false` 时恒为空串 —— 没有「部分可用」的中间态。 */
  readonly code: string
  /** 是否成功产出可执行代码。 */
  readonly ok: boolean
  /** 未能转换的 CSG 节点名（稳定排序，空数组表示全部转换成功）。 */
  readonly blocked: readonly string[]
  /** 每条顶层语句对应的 IR 节点 id，按语句顺序（便于上游做源映射）。 */
  readonly statementNodes: readonly number[]
}

export function emitFaijs(model: IrModel, options: EmitOptions = {}): EmitResult {
  return new Emitter(options).run(model)
}

/**
 * faijs 静态校验器（S5）对**扁平**脚本的顶层语句上限是 5000。留约 100 条
 * 余量给 compact 模式的 helper 声明，超过即自动容器化（见 `wrapBody`）。
 */
const TOP_LEVEL_STATEMENT_LIMIT = 4900

class Emitter {
  private lines: string[] = []
  private readonly statementNodes: number[] = []
  private readonly blocked = new Set<string>()
  private counter = 0
  private readonly prefix: string
  private readonly withHeader: boolean
  private readonly compact: boolean
  /** 强制容器化（`export default async (cad) => { ... }`），未指定则按语句数自动判定。 */
  private readonly forceContainer: boolean
  /** Helpers needed (collected during emit, injected before body). */
  private readonly neededHelpers = new Set<'rect' | 'circle' | '__rect' | '__circle' | 'rands' | 'matMul' | '__len' | '__concat' | '__str' | '__cross'>()

  constructor(options: EmitOptions) {
    this.prefix = options.variablePrefix ?? 'part'
    this.withHeader = options.header ?? true
    this.compact = options.compact ?? false
    this.forceContainer = options.container ?? false
  }

  run(model: IrModel): EmitResult {
    const rootVar = this.emitNode(model.root)

    if (this.blocked.size > 0) {
      return { code: '', ok: false, blocked: [...this.blocked].sort(), statementNodes: [] }
    }

    const body: string[] = []
    if (this.withHeader) body.push(...this.header(model))

    const inner: string[] = []
    // 结构化路径：发射顶层变量、function 定义、module 定义
    if (model.topBindings !== undefined && model.topBindings.length > 0) {
      for (const binding of model.topBindings) {
        inner.push(`const ${binding.name} = ${this.emitExpr(binding.value)}`)
      }
    }
    if (model.functionDefs !== undefined && model.functionDefs.length > 0) {
      for (const fn of model.functionDefs) {
        inner.push(this.emitFunctionDef(fn))
      }
    }
    if (model.moduleDefs !== undefined && model.moduleDefs.length > 0) {
      for (const mod of model.moduleDefs) {
        inner.push(...this.emitModuleDef(mod))
      }
    }
    inner.push(...this.lines)
    // Inject helper definitions after collecting all needed helpers.
    if (this.neededHelpers.size > 0) {
      inner.unshift(...this.helperDefs())
    }
    if (rootVar === undefined) {
      inner.push('// the CSG produced no geometry (every subtree is background `%` or an empty group)')
    } else {
      inner.push(`let result = ${rootVar}`)
    }
    body.push(...this.wrapBody(inner))

    return { code: `${body.join('\n')}\n`, ok: true, blocked: [], statementNodes: this.statementNodes }
  }

  /**
   * faijs 静态校验器（S5）对**扁平**脚本的顶层语句数有 5000 上限（超出即
   * `too many top-level statements`）。语句数接近上限时，把全部语句包进
   * `export default async (cad) => { ... }`：此时顶层只有 1 条语句，容器内的
   * 语句仍被 faijs 逐条执行、`result` 照常产出（已实测）。
   *
   * 小脚本保持扁平输出，便于阅读与把报错行号直接映射回某个子树。
   */
  private wrapBody(inner: readonly string[]): string[] {
    if (!this.forceContainer && inner.length <= TOP_LEVEL_STATEMENT_LIMIT) {
      return [...inner]
    }
    return ['export default async (cad) => {', ...inner, '}']
  }

  // ── Compact-mode helpers ─────────────────────────────────────────────────

  /**
   * Helper function definitions injected at the top of compact-mode output.
   * These shorten repeated patterns (rectangles, circles) to well under 50 bytes
   * per call, dramatically reducing total code size for examples like
   * module_recursion (2047 squares → ~1.1 MB → ~250 KB).
   */
  private helperDefs(): string[] {
    const defs: string[] = []
    if (this.neededHelpers.has('rect') || this.neededHelpers.has('__rect')) {
      defs.push(
        'function __rect(w,h,c){const p=cad.profile({contours:[{segments:[' +
          "{kind:'line',x1:0,y1:0,x2:w,y2:0}," +
          "{kind:'line',x1:w,y1:0,x2:w,y2:h}," +
          "{kind:'line',x1:w,y1:h,x2:0,y2:h}," +
          "{kind:'line',x1:0,y1:h,x2:0,y2:0}" +
          ']}]});return c?cad.applyMatrix(p,[[-1,0,0,w/2],[0,-1,0,h/2],[0,0,1,0],[0,0,0,1]]):p}',
      )
    }
    if (this.neededHelpers.has('circle') || this.neededHelpers.has('__circle')) {
      defs.push(
        'function __circle(r){const P=Math.PI;return cad.profile({contours:[{segments:[' +
          "{kind:'arc',cx:0,cy:0,radius:r,startAngle:0,endAngle:P,ccw:true,x1:r,y1:0,x2:-r,y2:0}," +
          "{kind:'arc',cx:0,cy:0,radius:r,startAngle:P,endAngle:2*P,ccw:true,x1:-r,y1:0,x2:r,y2:0}" +
          ']}]})}',
      )
    }
    if (this.neededHelpers.has('rands')) {
      defs.push(
        'function rands(min,max,count,seed){' +
          'function hashFP(d){const b=new Float64Array(1);b[0]=d;const v=new DataView(b.buffer);' +
          'return((v.getUint32(0,true)^v.getUint32(4,true))>>>0)}' +
          'function RNG(s){this.s=(s>>>0)||1;this.next=function(){let x=this.s;' +
          'x^=x<<13;x^=x>>>17;x^=x<<5;this.s=x>>>0;return this.s/4294967295}}' +
          'const rng=new RNG(hashFP(seed));const lo=Math.min(min,max),hi=Math.max(min,max);' +
          'const a=[];for(let i=0;i<count;i++)a.push(lo+rng.next()*(hi-lo));return a}',
      )
    }
    if (this.neededHelpers.has('matMul')) {
      defs.push(
        'function matMul(){const r=arguments[0];for(let k=1;k<arguments.length;k++){' +
          'const m=arguments[k],t=[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];' +
          'for(let i=0;i<4;i++)for(let j=0;j<4;j++)for(let l=0;l<4;l++)t[i][j]+=r[i][l]*m[l][j];' +
          'r=t}return r}',
      )
    }
    if (this.neededHelpers.has('__len')) {
      defs.push('function __len(v){return v.length}')
    }
    if (this.neededHelpers.has('__concat')) {
      defs.push('function __concat(){return [].concat.apply([],arguments)}')
    }
    if (this.neededHelpers.has('__str')) {
      defs.push('function __str(){return Array.from(arguments).map(a=>typeof a==="number"?String(a):a).join("")}')
    }
    if (this.neededHelpers.has('__cross')) {
      defs.push(
        'function __cross(a,b){return[' +
          'a[1]*b[2]-a[2]*b[1],' +
          'a[2]*b[0]-a[0]*b[2],' +
          'a[0]*b[1]-a[1]*b[0]]}',
      )
    }
    return defs
  }


  // ── 头部 ─────────────────────────────────────────────────────────────────

  private header(model: IrModel): string[] {
    const source = model.source.path ?? '(csg text)'
    const out = [
      `// source: ${source}`,
      `// generated by @faicad/faijs-openscad ${CONVERTER_VERSION}`,
    ]
    if (model.source.openscadVersion !== undefined) {
      out.push(`// OpenSCAD ${model.source.openscadVersion} -> CSG -> IR -> faijs`)
    } else {
      out.push('// CSG -> IR -> faijs')
    }
    return out
  }

  // ── 分发 ─────────────────────────────────────────────────────────────────

  /** 返回该子树的变量名；`empty`（无几何）返回 undefined。 */
  private emitNode(node: IrGeometry): string | undefined {
    switch (node.kind) {
      case 'box':
        return this.assign(
          `await cad.box(${lengthLiteral(node.width)}, ${lengthLiteral(node.depth)}, ${lengthLiteral(node.height)}${this.centeredOpt(node.centered)})`,
          node.id,
        )
      case 'sphere':
        return this.assign(`await cad.sphere(${lengthLiteral(node.radius)}${this.optionsExpr({ segments: node.segments })})`, node.id)
      case 'cylinder':
        return this.assign(
          `await cad.cylinder(${lengthLiteral(node.radius)}, ${lengthLiteral(node.height)}${this.optionsExpr({ centered: node.centered, segments: node.segments })})`,
          node.id,
        )
      case 'cone':
        return this.assign(
          `await cad.cone(${lengthLiteral(node.radiusBottom)}, ${lengthLiteral(node.radiusTop)}, ${lengthLiteral(node.height)}${this.optionsExpr({ centered: node.centered, segments: node.segments })})`,
          node.id,
        )
      case 'rect2d':
      case 'circle2d':
      case 'polygon2d':
        return this.assign(this.profileExpr(node), node.id)
      case 'union': {
        const names = this.emitAll(node.children)
        if (names.length === 0) return undefined
        if (names.length === 1) return names[0]
        // M9 A4: faijs `cad.union` rejects 2D face inputs ("wire/face/shell
        // geometry cannot fuse"). `cad.fuse` is the BREP-level boolean that
        // accepts both solid and face inputs, so use it for 2D unions.
        const op = node.dimension === '2d' ? 'cad.fuse' : 'cad.union'
        return this.assign(`await ${op}(${names.join(', ')})`, node.id)
      }
      case 'difference': {
        const names = this.emitAll(node.children)
        if (names.length === 0) return undefined
        if (names.length === 1) return names[0]
        return this.assign(`await cad.subtract(${names.join(', ')})`, node.id)
      }
      case 'intersection': {
        const names = this.emitAll(node.children)
        if (names.length === 0) return undefined
        if (names.length === 1) return names[0]
        return this.assign(`await cad.intersect(${names.join(', ')})`, node.id)
      }
      case 'transform': {
        const child = this.emitNode(node.child)
        if (child === undefined) return undefined
        return this.assign(`await cad.applyMatrix(${child}, ${matrixLiteral(node.matrix, this.compact)})`, node.id)
      }
      case 'extrude': {
        const child = this.emitNode(node.child)
        if (child === undefined) return undefined
        const solid = this.assign(`await cad.extrude(${child}, { length: ${lengthLiteral(node.length)} })`, node.id)
        if (!node.centered) return solid
        // center=true 时 OpenSCAD 把实体放在 z ∈ [-h/2, h/2]。用一次平移矩阵实现，
        // **不用 `cad.translate`** —— 该 op 属 3d_editor 消费面，不在 faijs 平台面
        // （手册 §4.9）。applyMatrix 的平移分量写裸数字，与 multmatrix 同一条约定。
        return this.assign(
          `await cad.applyMatrix(${solid}, ${matrixLiteral(translationMatrix(0, 0, -node.length / 2), this.compact)})`,
          node.id,
        )
      }
      case 'revolve': {
        const child = this.emitNode(node.child)
        if (child === undefined) return undefined
        // cad.revolve(profile, { axis, at, angle })
        // angle 是**裸弧度数字**——不乘 RADIAN。
        // RADIAN = 180/PI = 57.2958，乘上去会把 2π 变成 360（度），然后 revolve
        // 内部再 (360*180)/PI = 20626 度，几何完全错误。
        // 裸弧度数字在脚本面不做 dimension 检查（revolve 无 paramDims 声明）。
        const TWO_PI = 2 * Math.PI
        if (Math.abs(node.angle - TWO_PI) < 1e-12) {
          // 完整旋转：省略 angle，使用 revolve 默认 2π
          return this.assign(
            `await cad.revolve(${child}, { axis: [0, 0, 1], at: [0, 0, 0] })`,
            node.id,
          )
        }
        return this.assign(
          `await cad.revolve(${child}, { axis: [0, 0, 1], at: [0, 0, 0], angle: ${exactNumber(node.angle)} })`,
          node.id,
        )
      }
      case 'color': {
        const child = this.emitNode(node.child)
        if (child === undefined) return undefined
        const [, , , alpha] = node.rgba
        this.lines.push(`${child}.setColor(${colorLiteral(node.rgba)})`)
        if (alpha < 1) this.lines.push(`${child}.setOpacity(${formatNumber(alpha)})`)
        return child
      }
      case 'passthrough':
        // render(): 几何透传，不产生语句。
        return this.emitNode(node.child)
      case 'empty':
        return undefined
      case 'blocked':
        this.blocked.add(node.origin.csgNode)
        return undefined
      case 'forLoop':
        return this.emitForLoop(node)
      case 'if':
        return this.emitIf(node)
      case 'let':
        return this.emitLet(node)
      case 'moduleCall':
        return this.emitModuleCall(node)
      case 'exprCall':
        return this.emitExprCall(node)
    }
  }

  private emitAll(children: readonly IrGeometry[]): string[] {
    const out: string[] = []
    for (const child of children) {
      const name = this.emitNode(child)
      if (name !== undefined) out.push(name)
    }
    return out
  }

  // ── 表达式发射（结构化路径专用）─────────────────────────────────────────────

  private emitExpr(expr: IrExpr): string {
    switch (expr.kind) {
      case 'num':
        return formatNumber(expr.value)
      case 'str':
        return JSON.stringify(expr.value)
      case 'bool':
        return String(expr.value)
      case 'var':
        return expr.name
      case 'binary':
        return `(${this.emitExpr(expr.left)} ${expr.op} ${this.emitExpr(expr.right)})`
      case 'unary':
        return `(${expr.op}${this.emitExpr(expr.operand)})`
      case 'ternary':
        return `(${this.emitExpr(expr.cond)} ? ${this.emitExpr(expr.then)} : ${this.emitExpr(expr.els)})`
      case 'call':
        if (expr.callee === 'rands') this.neededHelpers.add('rands')
        if (expr.callee === '__len') this.neededHelpers.add('__len')
        if (expr.callee === '__concat') this.neededHelpers.add('__concat')
        if (expr.callee === '__str') this.neededHelpers.add('__str')
        if (expr.callee === '__cross') this.neededHelpers.add('__cross')
        return `${expr.callee}(${expr.args.map((a) => this.emitExpr(a)).join(', ')})`
      case 'index':
        return `${this.emitExpr(expr.array)}[${this.emitExpr(expr.index)}]`
      case 'vector':
        return `[${expr.elements.map((e) => this.emitExpr(e)).join(', ')}]`
      case 'range':
        return `[${this.emitExpr(expr.start)}, ${this.emitExpr(expr.end)}]`
      case 'matrixMul':
        this.neededHelpers.add('matMul')
        return `matMul(${expr.matrices.map((m) => this.emitExpr(m)).join(', ')})`
    }
  }

  // ── 控制流发射 ────────────────────────────────────────────────────────────

  private emitForLoop(node: IrForLoop): string | undefined {
    const partsVar = `${this.prefix}_parts_${this.counter++}`
    this.lines.push(`const ${partsVar} = []`)
    this.statementNodes.push(node.id)

    this.emitForIterators(node.iterators, 0, () => {
      for (const child of node.body) {
        const name = this.emitNode(child)
        if (name !== undefined) {
          this.lines.push(`${partsVar}.push(${name})`)
        }
      }
    })

    return this.assign(`cad.union(...${partsVar})`, node.id)
  }

  private emitForIterators(iterators: readonly IrIterator[], idx: number, emitBody: () => void): void {
    if (idx >= iterators.length) {
      emitBody()
      return
    }
    const iter = iterators[idx]
    if (iter.source.kind === 'range') {
      const r = iter.source
      const stepExpr = r.step !== undefined ? this.emitExpr(r.step) : '1'
      this.lines.push(`for (let ${iter.varName} = ${this.emitExpr(r.start)}; ${iter.varName} <= ${this.emitExpr(r.end)}; ${iter.varName} += ${stepExpr}) {`)
      this.emitForIterators(iterators, idx + 1, emitBody)
      this.lines.push('}')
    } else {
      this.lines.push(`for (const ${iter.varName} of ${this.emitExpr(iter.source)}) {`)
      this.emitForIterators(iterators, idx + 1, emitBody)
      this.lines.push('}')
    }
  }

  private emitIf(node: IrIf): string | undefined {
    const partsVar = `${this.prefix}_parts_${this.counter++}`
    this.lines.push(`const ${partsVar} = []`)
    this.statementNodes.push(node.id)

    this.lines.push(`if (${this.emitExpr(node.cond)}) {`)
    for (const child of node.then) {
      const name = this.emitNode(child)
      if (name !== undefined) this.lines.push(`${partsVar}.push(${name})`)
    }
    if (node.els !== undefined && node.els.length > 0) {
      this.lines.push('} else {')
      for (const child of node.els) {
        const name = this.emitNode(child)
        if (name !== undefined) this.lines.push(`${partsVar}.push(${name})`)
      }
    }
    this.lines.push('}')

    return this.assign(`cad.union(...${partsVar})`, node.id)
  }

  private emitLet(node: IrLet): string | undefined {
    for (const binding of node.bindings) {
      this.lines.push(`const ${binding.name} = ${this.emitExpr(binding.value)}`)
    }
    const names = this.emitAll(node.body)
    if (names.length === 0) return undefined
    if (names.length === 1) return names[0]
    return this.assign(`await cad.union(${names.join(', ')})`, node.id)
  }

  private emitModuleCall(node: IrModuleCall): string | undefined {
    const args = node.args.map((a) => this.emitExpr(a)).join(', ')
    return this.assign(`await ${node.functionName}(cad, ${args})`, node.id)
  }

  private emitExprCall(node: IrExprCall): string | undefined {
    if (node.chain.length === 0) return undefined
    const parts: string[] = []
    for (let i = 0; i < node.chain.length; i++) {
      const link = node.chain[i]
      const args = link.args.map((a) => this.emitExpr(a)).join(', ')
      if (i === 0) {
        parts.push(`await ${link.method}(${args})`)
      } else {
        parts.push(`${link.method}(${args})`)
      }
    }
    return this.assign(parts.join('.'), node.id)
  }

  // ── function / module 定义发射 ─────────────────────────────────────────────

  private emitFunctionDef(fn: { name: string; params: readonly { name: string; defaultValue?: IrExpr }[]; body: IrExpr }): string {
    const params = fn.params.map((p) => {
      if (p.defaultValue !== undefined) return `${p.name} = ${this.emitExpr(p.defaultValue)}`
      return p.name
    })
    return `function ${fn.name}(${params.join(', ')}) { return ${this.emitExpr(fn.body)} }`
  }

  private emitModuleDef(mod: { name: string; params: readonly { name: string; defaultValue?: IrExpr }[]; body: readonly IrGeometry[] }): string[] {
    const params = mod.params.map((p) => {
      if (p.defaultValue !== undefined) return `${p.name} = ${this.emitExpr(p.defaultValue)}`
      return p.name
    })
    const lines: string[] = []
    lines.push(`async function ${mod.name}(cad, ${params.join(', ')}) {`)
    const savedLines = this.lines
    const savedCounter = this.counter
    this.lines = []
    const names = this.emitAll(mod.body)
    lines.push(...this.lines.map((l) => `  ${l}`))
    if (names.length === 0) {
      lines.push('  return undefined')
    } else if (names.length === 1) {
      lines.push(`  return ${names[0]}`)
    } else {
      lines.push(`  return await cad.union(${names.join(', ')})`)
    }
    this.lines = savedLines
    this.counter = savedCounter
    lines.push('}')
    return lines
  }

  private assign(expr: string, nodeId: number): string {
    const name = `${this.prefix}${this.counter++}`
    this.lines.push(`let ${name} = ${expr}`)
    this.statementNodes.push(nodeId)
    return name
  }

  private centeredOpt(centered: boolean): string {
    // 默认即 `centered: false`，省略选项让输出更接近手写 faijs。
    return centered ? ', { centered: true }' : ''
  }

  /**
   * 构造图元选项字符串（centered + segments）。
   * M9 §1.3：把 per-primitive segments 写进 cad.sphere/cylinder/cone 调用，
   * 让 runtime 创建图元时就用正确三角化密度（而非事后重新三角化）。
   */
  private optionsExpr(opts: { centered?: boolean; segments?: number }): string {
    const parts: string[] = []
    if (opts.centered) parts.push('centered: true')
    if (opts.segments !== undefined) parts.push(`segments: ${opts.segments}`)
    return parts.length > 0 ? `, { ${parts.join(', ')} }` : ''
  }

  // ── 2D profile ───────────────────────────────────────────────────────────

  /**
   * 三种 2D 图元统一落到 `cad.profile({ contours: [{ segments: [...] }] })`。
   * 坐标加 `* MM`；弧的 `startAngle` / `endAngle` 是**裸弧度**。
   */
  private profileExpr(node: IrGeometry): string {
    // Compact-mode fast paths: use helper functions for common shapes.
    if (this.compact) {
      if (node.kind === 'rect2d' && !node.centered) {
        this.neededHelpers.add('rect')
        return `await __rect(${lengthLiteral(node.width)}, ${lengthLiteral(node.height)})`
      }
      if (node.kind === 'circle2d') {
        this.neededHelpers.add('circle')
        return `await __circle(${lengthLiteral(node.radius)})`
      }
    }

    const contours: string[][] = []
    if (node.kind === 'rect2d') {
      contours.push(rectLoop(node.width, node.height, node.centered))
    } else if (node.kind === 'circle2d') {
      contours.push(circleArcs(node.radius))
    } else if (node.kind === 'polygon2d') {
      const loops = polygonLoops(node.points, node.paths)
      for (const loop of loops) contours.push(loop)
    } else {
      throw new Error(`profileExpr called with ${node.kind}`)
    }

    if (this.compact) {
      const rendered = contours.map((segments) => `{segments:[${segments.join(',')}]}`)
      return `await cad.profile({contours:[${rendered.join(',')}]})`
    }
    const rendered = contours.map(
      (segments) => `  { segments: [\n${segments.map((s) => `    ${s}`).join(',\n')}\n  ] }`,
    )
    return `await cad.profile({ contours: [\n${rendered.join(',\n')}\n] })`
  }
}

// ── 字面量 ──────────────────────────────────────────────────────────────────

/**
 * 行主序 4×4 矩阵，元素**裸数字**（applyMatrix 的既有约定，实测见
 * emit/faijs-apply-matrix.probe.test.ts:58）。
 */
function matrixLiteral(matrix: Matrix4, compact = false): string {
  const rows = matrix.map((row) => `[${row.map((v) => formatNumber(v)).join(compact ? ',' : ', ')}]`)
  return compact ? `[${rows.join(',')}]` : `[\n${rows.map((r) => `  ${r}`).join(',\n')}\n]`
}

function translationMatrix(x: number, y: number, z: number): Matrix4 {
  return [
    [1, 0, 0, x],
    [0, 1, 0, y],
    [0, 0, 1, z],
    [0, 0, 0, 1],
  ]
}

// ── 轮廓构造 ────────────────────────────────────────────────────────────────

function line(x1: number, y1: number, x2: number, y2: number): string {
  return `{ kind: 'line', x1: ${lengthLiteral(x1)}, y1: ${lengthLiteral(y1)}, x2: ${lengthLiteral(x2)}, y2: ${lengthLiteral(y2)} }`
}

/** 矩形 → 4 条逆时针 line。`center` 与 OpenSCAD 的 `square(size, center)` 同义。 */
function rectLoop(width: number, height: number, centered: boolean): string[] {
  const x0 = centered ? -width / 2 : 0
  const y0 = centered ? -height / 2 : 0
  const x1 = x0 + width
  const y1 = y0 + height
  return [line(x0, y0, x1, y0), line(x1, y0, x1, y1), line(x1, y1, x0, y1), line(x0, y1, x0, y0)]
}

/**
 * 圆 → 两段半圆弧（faijs 的 profile 注释：整圆 sweep≈2π 必须拆成两段）。
 * 角度是**弧度**；端点显式给出（probe 的形态逐字复刻）。
 */
function circleArcs(radius: number): string[] {
  const arc = (start: number, end: number, x1: number, y1: number, x2: number, y2: number): string =>
    `{ kind: 'arc', cx: ${lengthLiteral(0)}, cy: ${lengthLiteral(0)}, radius: ${lengthLiteral(radius)}, ` +
    `startAngle: ${exactNumber(start)}, endAngle: ${exactNumber(end)}, ccw: true, ` +
    `x1: ${lengthLiteral(x1)}, y1: ${lengthLiteral(y1)}, x2: ${lengthLiteral(x2)}, y2: ${lengthLiteral(y2)} }`
  const PI = Math.PI
  const TWO_PI = 2 * Math.PI
  return [arc(0, PI, radius, 0, -radius, 0), arc(PI, TWO_PI, -radius, 0, radius, 0)]
}

/**
 * `polygon(points, paths)` → 每个环一组 line。
 * `paths === undefined` 时整份 points 是一个环（OpenSCAD 的默认形态）。
 */
function polygonLoops(points: readonly Vec2[], paths?: readonly (readonly number[])[]): string[][] {
  const indices = paths ?? [points.map((_, i) => i)]
  return indices.map((path) => {
    const out: string[] = []
    for (let i = 0; i < path.length; i++) {
      const a = points[path[i]]
      const b = points[path[(i + 1) % path.length]]
      out.push(line(a[0], a[1], b[0], b[1]))
    }
    return out
  })
}

/** 供测试复用的颜色字面量（`[r,g,b]`）。 */
export function colorLiteral(rgba: Vec4): string {
  return `[${formatNumber(rgba[0])}, ${formatNumber(rgba[1])}, ${formatNumber(rgba[2])}]`
}
