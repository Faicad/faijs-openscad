/**
 * CSG 递归下降解析器（plan §4.2，M1）。
 *
 * 文法（由 225 个语料 golden 实测反推，无一处凭推测）：
 *
 *   document  := statement*
 *   statement := modifier* node
 *   modifier  := '%' | '#' | '!'
 *   node      := IDENT '(' argList? ')' ( ';' | block )
 *   block     := '{' statement* '}'
 *   argList   := arg ( ',' arg )*
 *   arg       := IDENT '=' value    // 命名参数，17376 个
 *              | value              // 位置参数，7221 个（仅 multmatrix / color）
 *   value     := number | string | 'true' | 'false' | 'undef' | 'inf' | '-inf'
 *              | '-' number | vector
 *   vector    := '[' ( value ( ',' value )* )? ']'
 *
 * 与 OpenSCAD **语言**的区别（重要）：CSG 是已求值产物，所以这里没有
 * `for` / `if` / `let` / 函数调用 / 算术 / `$children`；参数值一定是字面量。
 * 实测 24597 个参数值全部落在上面 6 种形态内，没有一个例外。
 *
 * ⚠️ 位置参数占 29%，且**只**出现在 `multmatrix`（4×4 矩阵）与 `color`
 * （RGBA 向量）上。早先一版统计脚本只匹配 `name = value`，把这两个节点的
 * 参数静默跳过，得出过「参数全部是命名参数」的错误结论。
 *
 * 容错策略：解析器**不抛异常**，出错时报告诊断并前进/跳到下一个边界
 * （`,` `)` `;` `}`），保证任何输入都能得到一份（可能残缺的）AST 加一串
 * 可定位的诊断。每个循环都有「无进展就强制前进」的保底，杜绝死循环。
 */
import { DiagnosticBag, type Diagnostic, type Span } from '../diagnostics/diagnostic'
import { DiagnosticCode } from '../diagnostics/codes'
import { isKnownCsgNode } from './dialect'
import { lexCsg, type Punctuation, type Token } from './lexer'
import {
  joinSpans,
  type CsgArgument,
  type CsgDocument,
  type CsgModifierToken,
  type CsgNode,
  type CsgNodeTerminator,
  type CsgValue,
} from './ast'

export interface ParseOptions {
  /** 诊断里回指的来源标签（通常是文件路径）。 */
  readonly path?: string
  /**
   * 是否对不在词表里的节点名报 OSC1003。默认 `true`。
   * 语料回归会在词表不含新节点时失败，从而强制复核词表。
   */
  readonly reportUnknownNodes?: boolean
}

export interface ParseResult {
  readonly document: CsgDocument
  readonly diagnostics: readonly Diagnostic[]
  readonly tokens: readonly Token[]
}

function ensureEof(tokens: readonly Token[]): readonly Token[] {
  const last = tokens[tokens.length - 1]
  if (last !== undefined && last.kind === 'eof') return tokens
  const end = last === undefined ? { line: 1, column: 1, offset: 0 } : last.span.end
  return [...tokens, { kind: 'eof', span: { start: end, end } }]
}

class Parser {
  private index = 0

  constructor(
    private readonly tokens: readonly Token[],
    private readonly bag: DiagnosticBag,
    private readonly options: ParseOptions,
  ) {}

  private get path(): string | undefined {
    return this.options.path
  }

  private peek(ahead = 0): Token {
    const i = this.index + ahead
    return this.tokens[i < this.tokens.length ? i : this.tokens.length - 1]
  }

  private get current(): Token {
    return this.peek()
  }

  /**
   * 是否已到输入末尾。
   *
   * 刻意不写 `!this.atEnd`：getter 的属性访问会被 TS 收窄，
   * 在「进入循环时已排除 eof」的嵌套循环里会产生
   * `This comparison appears to be unintentional` 误报。走方法调用则每次
   * 重新求值，类型也不会被错误地固定住。
   */
  private get atEnd(): boolean {
    return this.peek().kind === 'eof'
  }

  private advance(): Token {
    const token = this.current
    if (token.kind !== 'eof') this.index++
    return token
  }

  private atPunct(punct: Punctuation): boolean {
    const token = this.current
    return token.kind === 'punct' && token.punct === punct
  }

  private eatPunct(punct: Punctuation): Token | undefined {
    return this.atPunct(punct) ? this.advance() : undefined
  }

  private report(code: string, message: string, span: Span): void {
    this.bag.add({
      code,
      message,
      span,
      ...(this.path === undefined ? {} : { path: this.path }),
    })
  }

  private describe(token: Token): string {
    switch (token.kind) {
      case 'eof':
        return 'end of input'
      case 'identifier':
        return `identifier '${token.name}'`
      case 'number':
        return `number '${token.raw}'`
      case 'string':
        return 'a string literal'
      case 'modifier':
        return `modifier '${token.modifier}'`
      case 'punct':
        return `'${token.punct}'`
    }
  }

  parseDocument(): CsgDocument {
    const start = this.current.span.start
    const nodes: CsgNode[] = []
    while (!this.atEnd) {
      const before = this.index
      const node = this.parseStatement()
      if (node !== undefined) nodes.push(node)
      // 保底：任何未能消费 token 的分支都不允许让循环空转。
      if (this.index === before) this.advance()
    }
    return { nodes, span: { start, end: this.current.span.end } }
  }

  private parseStatement(): CsgNode | undefined {
    const modifiers: CsgModifierToken[] = []
    let firstSpan: Span | undefined
    while (this.peek().kind === 'modifier') {
      const token = this.peek()
      if (token.kind === 'modifier') {
        modifiers.push(token.modifier)
        firstSpan ??= token.span
      }
      this.advance()
    }

    const nameToken = this.current
    if (nameToken.kind !== 'identifier') {
      this.report(
        DiagnosticCode.OSC1001,
        `Expected a node name, found ${this.describe(nameToken)}`,
        nameToken.span,
      )
      return undefined
    }
    this.advance()
    const name = nameToken.name

    const args: CsgArgument[] = []
    let argListSpan: Span | undefined
    if (this.atPunct('(')) {
      argListSpan = this.parseArgumentList(args)
    } else {
      this.report(
        DiagnosticCode.OSC1002,
        `Expected '(' after node name '${name}', found ${this.describe(this.current)}`,
        nameToken.span,
      )
    }

    const children: CsgNode[] = []
    let terminator: CsgNodeTerminator = 'semicolon'
    let bodySpan: Span | undefined
    if (this.atPunct(';')) {
      this.advance()
    } else if (this.atPunct('{')) {
      terminator = 'braces'
      bodySpan = this.parseBlock(children)
    } else {
      this.report(
        DiagnosticCode.OSC1002,
        `Expected ';' or '{' after '${name}', found ${this.describe(this.current)}`,
        this.current.span,
      )
    }

    if (this.options.reportUnknownNodes !== false && !isKnownCsgNode(name)) {
      this.report(DiagnosticCode.OSC1003, `Unknown CSG node '${name}'`, nameToken.span)
    }

    const span = joinSpans(firstSpan ?? nameToken.span, bodySpan ?? argListSpan ?? nameToken.span)
    return {
      kind: 'node',
      name,
      modifiers,
      args,
      children,
      terminator,
      span,
      nameSpan: nameToken.span,
      ...(argListSpan === undefined ? {} : { argListSpan }),
      ...(bodySpan === undefined ? {} : { bodySpan }),
    }
  }

  private parseBlock(out: CsgNode[]): Span {
    const open = this.advance()
    while (!this.atEnd && !this.atPunct('}')) {
      const before = this.index
      const child = this.parseStatement()
      if (child !== undefined) out.push(child)
      if (this.index === before) this.advance()
    }
    const close = this.eatPunct('}')
    if (close === undefined) {
      this.report(DiagnosticCode.OSC1002, "Unbalanced '{' — block is never closed", open.span)
      return open.span
    }
    return joinSpans(open.span, close.span)
  }

  private parseArgumentList(out: CsgArgument[]): Span {
    const open = this.advance()
    while (!this.atEnd && !this.atPunct(')')) {
      const before = this.index
      const arg = this.parseArgument(out.length)
      if (arg !== undefined) out.push(arg)
      if (this.index === before) {
        // 恢复：跳到下一个参数边界。若当前**就是**边界（skipToBoundary 原地
        // 不动），必须区分两种情况，否则这里会变成死循环：
        //   - `;` / `{` / `}` 属于外层语法，交还给外层处理（通常是未闭合的
        //     `(`，让外层仍能正确识别节点的结尾）；
        //   - 其它边界（`,` / `]`）就地吃掉一个 token 保证前进。
        this.skipToBoundary()
        if (this.index === before) {
          if (this.atPunct(';') || this.atPunct('{') || this.atPunct('}')) break
          this.advance()
        }
        this.eatPunct(',')
        continue
      }
      if (this.eatPunct(',') !== undefined) continue
      if (this.atPunct(')')) break
      this.report(
        DiagnosticCode.OSC1001,
        `Expected ',' or ')' in argument list, found ${this.describe(this.current)}`,
        this.current.span,
      )
      this.skipToBoundary()
      this.eatPunct(',')
    }
    const close = this.eatPunct(')')
    if (close === undefined) {
      this.report(DiagnosticCode.OSC1002, "Unbalanced '(' — argument list is never closed", open.span)
      return open.span
    }
    return joinSpans(open.span, close.span)
  }

  private skipToBoundary(): void {
    while (!this.atEnd) {
      if (
        this.atPunct(',') ||
        this.atPunct(')') ||
        this.atPunct(']') ||
        this.atPunct(';') ||
        this.atPunct('{') ||
        this.atPunct('}')
      ) {
        return
      }
      this.advance()
    }
  }

  private parseArgument(index: number): CsgArgument | undefined {
    const token = this.current

    // 命名参数 `name = value`：用「向前看一个 token」判定，而不是先消费再回退。
    // 这样 `undef` / `true` 这类既是值又可能是名字的字面量不会被误判。
    if (token.kind === 'identifier') {
      const next = this.peek(1)
      if (next.kind === 'punct' && next.punct === '=') {
        this.advance()
        this.advance()
        const value = this.parseValue()
        if (value === undefined) return undefined
        return {
          name: token.name,
          value,
          index,
          span: joinSpans(token.span, value.span),
          nameSpan: token.span,
        }
      }
    }

    // 位置参数：值本身。
    // 实测（2026-10-06）：`multmatrix([[..]])` 4790 次、`color([r,g,b,a])` 2431 次，
    // 是语料里 29% 的参数，不是边角情况。
    const value = this.parseValue()
    if (value === undefined) {
      if (token.kind !== 'identifier') {
        this.report(
          DiagnosticCode.OSC1001,
          `Expected an argument name or a value, found ${this.describe(token)}`,
          token.span,
        )
      }
      return undefined
    }
    return { value, index, span: value.span }
  }

  private parseValue(): CsgValue | undefined {
    const token = this.current
    if (token.kind === 'number') {
      this.advance()
      return { kind: 'number', value: token.value, raw: token.raw, span: token.span }
    }
    if (token.kind === 'string') {
      this.advance()
      return { kind: 'string', value: token.value, raw: token.raw, span: token.span }
    }
    if (this.atPunct('[')) return this.parseVector()
    if (token.kind === 'punct' && token.punct === '-') {
      this.advance()
      const inner = this.current
      if (inner.kind === 'number') {
        this.advance()
        return {
          kind: 'number',
          value: -inner.value,
          raw: `-${inner.raw}`,
          span: joinSpans(token.span, inner.span),
        }
      }
      if (inner.kind === 'identifier' && inner.name === 'inf') {
        this.advance()
        return { kind: 'infinity', sign: -1, span: joinSpans(token.span, inner.span) }
      }
      this.report(
        DiagnosticCode.OSC1001,
        `Expected a number or 'inf' after '-', found ${this.describe(inner)}`,
        inner.span,
      )
      return undefined
    }
    if (token.kind === 'identifier') {
      if (token.name === 'true' || token.name === 'false') {
        this.advance()
        return { kind: 'boolean', value: token.name === 'true', span: token.span }
      }
      if (token.name === 'undef') {
        this.advance()
        return { kind: 'undef', span: token.span }
      }
      if (token.name === 'inf') {
        this.advance()
        return { kind: 'infinity', sign: 1, span: token.span }
      }
      if (token.name === 'nan') {
        // 语料实测 0 次，但 OpenSCAD 会产生 NaN（如 0/0）。防御性支持，
        // 保留 raw 以免后续无法区分「算出来的 NaN」与「写错的值」。
        this.advance()
        return { kind: 'number', value: Number.NaN, raw: 'nan', span: token.span }
      }
      this.report(
        DiagnosticCode.OSC1001,
        `Unexpected identifier '${token.name}' in a value position`,
        token.span,
      )
      this.advance()
      return undefined
    }
    this.report(
      DiagnosticCode.OSC1001,
      `Expected a value, found ${this.describe(token)}`,
      token.span,
    )
    return undefined
  }

  private parseVector(): CsgValue {
    const open = this.advance()
    const items: CsgValue[] = []
    while (!this.atEnd && !this.atPunct(']')) {
      const before = this.index
      const item = this.parseValue()
      if (item !== undefined) items.push(item)
      if (this.index === before) {
        // `;` / `{` / `}` 属于外层语法：立刻放弃这个向量并交还控制权，
        // 否则未闭合的 `[` 会把后面整段文档吞进来（实测会在
        // `cube(size = [1, 1, 1);` 上把后续所有节点吃掉）。
        if (this.atPunct(';') || this.atPunct('{') || this.atPunct('}')) break
        this.advance()
        continue
      }
      if (this.eatPunct(',') !== undefined) continue
      if (this.atPunct(']')) break
      this.report(
        DiagnosticCode.OSC1001,
        `Expected ',' or ']' in a vector, found ${this.describe(this.current)}`,
        this.current.span,
      )
      this.skipVectorToBoundary()
      this.eatPunct(',')
    }
    const close = this.eatPunct(']')
    if (close === undefined) {
      this.report(DiagnosticCode.OSC1002, "Unbalanced '[' — vector is never closed", open.span)
      return { kind: 'vector', items, span: open.span }
    }
    return { kind: 'vector', items, span: joinSpans(open.span, close.span) }
  }

  /** 向量内的错误恢复：停在 `,` / `]`，或交还给外层的 `;` / `{` / `}`。 */
  private skipVectorToBoundary(): void {
    while (!this.atEnd) {
      if (this.atPunct(',') || this.atPunct(']')) return
      if (this.atPunct(';') || this.atPunct('{') || this.atPunct('}')) return
      this.advance()
    }
  }
}

/** 把 CSG 文本解析成 AST。永不抛异常。 */
export function parseCsg(text: string, options: ParseOptions = {}): ParseResult {
  const lexed = lexCsg(text, options.path === undefined ? {} : { path: options.path })
  return parseCsgTokens(lexed.tokens, options, lexed.diagnostics)
}

/**
 * 从既有 token 流解析（供测试与工具复用）。
 * `lexDiagnostics` 会被并入结果，保证调用方拿到完整诊断集。
 */
export function parseCsgTokens(
  tokens: readonly Token[],
  options: ParseOptions = {},
  lexDiagnostics: readonly Diagnostic[] = [],
): ParseResult {
  const bag = new DiagnosticBag()
  bag.merge(lexDiagnostics)
  const parser = new Parser(ensureEof(tokens), bag, options)
  const document = parser.parseDocument()
  return { document, diagnostics: bag.all(), tokens }
}
