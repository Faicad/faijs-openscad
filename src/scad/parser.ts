/**
 * .scad 递归下降语法分析器。
 *
 * 依据 OpenSCAD 公开的语法规则独立实现，不复制其 GPL 源码。
 *
 * 文法（简化版）：
 *   input        := (use | include | statement)*
 *   statement    := ';'
 *                  | '{' inner_input '}'
 *                  | module_instantiation
 *                  | assignment
 *                  | 'module' ID '(' params ')' statement
 *                  | 'function' ID '(' params ')' '=' expr ';'
 *   module_inst  := modifier* single_module_inst child_statement?
 *                  | if_statement
 *   single_mod   := ID '(' arguments ')'
 *   child_stmt   := ';' | '{' child_statements '}' | module_inst
 *   assignment   := ID '=' expr ';'
 *   expr         := ternary
 *   ternary      := logic_or ('?' expr ':' expr)?
 *   logic_or     := logic_and ('||' logic_and)*
 *   logic_and    := equality ('&&' equality)*
 *   equality     := comparison (('==' | '!=') comparison)*
 *   comparison   := bitor (('<' | '>' | '<=' | '>=') bitor)*
 *   bitor        := bitand ('|' bitand)*
 *   bitand       := shift ('&' shift)*
 *   shift        := addition (('<<' | '>>') addition)*
 *   addition     := multiplication (('+' | '-') multiplication)*
 *   multiplication := unary (('*' | '/' | '%') unary)*
 *   unary        := ('+' | '-' | '!' | '~') unary | exponent
 *   exponent     := call ('^' unary)?
 *   call         := primary ('(' arguments ')' | '[' expr ']' | '.' ID)*
 *   primary      := number | string | true | false | undef | ID
 *                  | '(' expr ')' | range | vector | list_comp
 *                  | 'function' '(' params ')' expr
 *                  | 'let' '(' args ')' expr
 *                  | 'assert' '(' args ')' expr?
 *                  | 'echo' '(' args ')' expr?
 *
 * 永不抛异常：出错时报告诊断并尝试恢复。
 */
import { DiagnosticBag, type Diagnostic, type Span } from '../diagnostics/diagnostic'
import { DiagnosticCode } from '../diagnostics/codes'
import { lexScad } from './lexer'
import type { KeywordKind, OperatorKind, Token } from './token'
import type {
  Argument,
  AssignmentStmt,
  Expr,
  FunctionDefStmt,
  IfStmt,
  ModuleDefStmt,
  ModuleInstantiationStmt,
  Parameter,
  ScadDocument,
  Stmt,
} from './ast'

export interface ParseOptions {
  readonly path?: string
}

export interface ParseResult {
  readonly document: ScadDocument
  readonly diagnostics: readonly Diagnostic[]
  readonly tokens: readonly Token[]
}

class Parser {
  private index = 0
  private readonly bag: DiagnosticBag

  constructor(
    private readonly tokens: readonly Token[],
    private readonly path: string | undefined,
    bag?: DiagnosticBag,
  ) {
    this.bag = bag ?? new DiagnosticBag()
  }

  private report(code: string, message: string, span: Span): void {
    this.bag.add({
      code,
      message,
      span,
      ...(this.path === undefined ? {} : { path: this.path }),
    })
  }

  private peek(ahead = 0): Token {
    const i = this.index + ahead
    return this.tokens[i < this.tokens.length ? i : this.tokens.length - 1]
  }

  private get current(): Token {
    return this.peek()
  }

  private get atEnd(): boolean {
    return this.peek().kind === 'eof'
  }

  private advance(): Token {
    const t = this.current
    if (t.kind !== 'eof') this.index++
    return t
  }

  private isKeyword(kw: KeywordKind): boolean {
    const t = this.current
    return t.kind === 'keyword' && t.keyword === kw
  }

  private isOperator(op: OperatorKind): boolean {
    const t = this.current
    return t.kind === 'operator' && t.op === op
  }

  private isPunct(p: string): boolean {
    const t = this.current
    return t.kind === 'punct' && t.punct === p
  }

  private eatPunct(p: string): boolean {
    if (this.isPunct(p)) {
      this.advance()
      return true
    }
    return false
  }

  private eatOperator(op: OperatorKind): boolean {
    if (this.isOperator(op)) {
      this.advance()
      return true
    }
    return false
  }

  private describe(t: Token): string {
    switch (t.kind) {
      case 'eof':
        return 'end of input'
      case 'identifier':
        return `identifier '${t.name}'`
      case 'number':
        return `number '${t.raw}'`
      case 'string':
        return 'a string literal'
      case 'keyword':
        return `keyword '${t.keyword}'`
      case 'operator':
        return `operator '${t.op}'`
      case 'punct':
        return `'${t.punct}'`
    }
  }

  private spanBetween(start: Span, end: Span): Span {
    return { start: start.start, end: end.end }
  }

  parseDocument(): ScadDocument {
    const start = this.current.span
    const statements: Stmt[] = []
    while (!this.atEnd) {
      const before = this.index
      const stmt = this.parseStatement()
      if (stmt !== undefined) statements.push(stmt)
      if (this.index === before) this.advance()
    }
    return { statements, span: { start: start.start, end: this.current.span.end } }
  }

  private parseStatement(): Stmt | undefined {
    const t = this.current

    // use directive
    if (t.kind === 'keyword' && t.keyword === 'use') {
      const span = t.span
      this.advance()
      return { kind: 'use', path: t.directivePath ?? '', span }
    }

    // include directive
    if (t.kind === 'keyword' && t.keyword === 'include') {
      const span = t.span
      this.advance()
      return { kind: 'include', path: t.directivePath ?? '', span }
    }

    // module definition
    if (this.isKeyword('module')) {
      return this.parseModuleDef()
    }

    // function definition
    if (this.isKeyword('function')) {
      return this.parseFunctionDef()
    }

    // empty statement
    if (this.eatPunct(';')) {
      return { kind: 'empty', span: t.span }
    }

    // block { ... }
    if (this.isPunct('{')) {
      const start = this.current.span
      const body = this.parseBlock()
      return { kind: 'moduleInst', name: 'group', args: [], children: body, modifiers: [], span: this.spanBetween(start, this.current.span) }
    }

    // if statement
    if (this.isKeyword('if')) {
      return this.parseIfStatement()
    }

    // assignment: ID = expr ;
    if (t.kind === 'identifier') {
      const next = this.peek(1)
      if (next.kind === 'operator' && next.op === '=') {
        return this.parseAssignment()
      }
    }

    // module instantiation (with optional modifiers)
    return this.parseModuleInstantiation()
  }

  private parseModuleDef(): ModuleDefStmt {
    const start = this.current.span
    this.advance() // 'module'
    const nameToken = this.current
    if (nameToken.kind !== 'identifier') {
      this.report(DiagnosticCode.OSC1001, `Expected module name, found ${this.describe(nameToken)}`, nameToken.span)
      return { kind: 'moduleDef', name: '', params: [], body: [], span: start }
    }
    this.advance()
    const params = this.parseParameters()
    const body = this.parseChildStatements()
    return {
      kind: 'moduleDef',
      name: nameToken.name,
      params,
      body,
      span: this.spanBetween(start, this.current.span),
    }
  }

  private parseFunctionDef(): FunctionDefStmt {
    const start = this.current.span
    this.advance() // 'function'
    const nameToken = this.current
    if (nameToken.kind !== 'identifier') {
      this.report(DiagnosticCode.OSC1001, `Expected function name, found ${this.describe(nameToken)}`, nameToken.span)
      return { kind: 'functionDef', name: '', params: [], body: { kind: 'literal', type: 'undef', value: undefined, span: start }, span: start }
    }
    this.advance()
    const params = this.parseParameters()
    if (!this.eatOperator('=')) {
      this.report(DiagnosticCode.OSC1002, `Expected '=' after function parameters`, this.current.span)
    }
    const body = this.parseExpr()
    this.eatPunct(';')
    return {
      kind: 'functionDef',
      name: nameToken.name,
      params,
      body,
      span: this.spanBetween(start, this.current.span),
    }
  }

  private parseParameters(): readonly Parameter[] {
    const params: Parameter[] = []
    if (!this.eatPunct('(')) {
      this.report(DiagnosticCode.OSC1002, `Expected '(' after module/function name`, this.current.span)
      return params
    }
    while (!this.atEnd && !this.isPunct(')')) {
      const before = this.index
      const t = this.current
      if (t.kind !== 'identifier') {
        this.report(DiagnosticCode.OSC1001, `Expected parameter name, found ${this.describe(t)}`, t.span)
        this.skipToBoundary()
        if (this.index === before) this.advance()
        continue
      }
      this.advance()
      let defaultValue: Expr | undefined
      if (this.eatOperator('=')) {
        defaultValue = this.parseExpr()
      }
      params.push({ name: t.name, defaultValue, span: t.span })
      if (this.eatPunct(',')) continue
      if (this.isPunct(')')) break
      this.report(DiagnosticCode.OSC1001, `Expected ',' or ')' in parameter list`, this.current.span)
      this.skipToBoundary()
      this.eatPunct(',')
    }
    this.eatPunct(')')
    return params
  }

  private parseAssignment(): AssignmentStmt {
    const nameToken = this.current
    this.advance() // ID
    this.advance() // '='
    const value = this.parseExpr()
    this.eatPunct(';')
    return {
      kind: 'assignment',
      name: nameToken.kind === 'identifier' ? nameToken.name : '',
      value,
      span: this.spanBetween(nameToken.span, this.current.span),
    }
  }

  private parseIfStatement(): IfStmt {
    const start = this.current.span
    this.advance() // 'if'
    if (!this.eatPunct('(')) {
      this.report(DiagnosticCode.OSC1002, `Expected '(' after 'if'`, this.current.span)
    }
    const cond = this.parseExpr()
    this.eatPunct(')')
    const thenBody = this.parseChildStatements()
    let els: readonly Stmt[] | undefined
    if (this.isKeyword('else')) {
      this.advance()
      if (this.isKeyword('if')) {
        const elifStmt = this.parseIfStatement()
        els = [elifStmt]
      } else {
        els = this.parseChildStatements()
      }
    }
    return {
      kind: 'if',
      cond,
      then: thenBody,
      ...(els !== undefined ? { els } : {}),
      span: this.spanBetween(start, this.current.span),
    }
  }

  private parseModuleInstantiation(): ModuleInstantiationStmt | undefined {
    const start = this.current.span
    const modifiers: ('!' | '*' | '%' | '#')[] = []

    // Parse leading modifiers: ! * % #
    while (true) {
      const t = this.current
      if (t.kind === 'operator') {
        if (t.op === '!' || t.op === '*' || t.op === '%' || t.op === '#') {
          modifiers.push(t.op)
          this.advance()
          continue
        }
      }
      break
    }

    // Handle if as a module-like statement
    if (this.isKeyword('if')) {
      // If we already consumed modifiers, report error (shouldn't happen normally)
      // But OpenSCAD allows modifiers on if? Actually no, if is parsed at module_instantiation level.
      // We handle it by falling through to parseIfStatement and wrapping.
    }

    // Module name
    const nameToken = this.current
    if (nameToken.kind !== 'identifier' && !this.isKeyword('for') && !this.isKeyword('let') && !this.isKeyword('assert') && !this.isKeyword('echo') && !this.isKeyword('each')) {
      if (this.isKeyword('if')) {
        // This shouldn't normally be reached since if is handled in parseStatement
        // But if we get here with modifiers, it's an error
        this.report(DiagnosticCode.OSC1001, `Unexpected 'if' after modifiers`, nameToken.span)
      }
      this.report(DiagnosticCode.OSC1001, `Expected module name, found ${this.describe(nameToken)}`, nameToken.span)
      return undefined
    }

    let name: string
    if (nameToken.kind === 'identifier') {
      name = nameToken.name
    } else if (nameToken.kind === 'keyword') {
      name = nameToken.keyword
    } else {
      name = ''
    }
    this.advance()

    // Arguments
    const args = this.parseArguments()

    // Children (optional - may be ; or { ... })
    let children: readonly Stmt[] = []
    if (this.eatPunct(';')) {
      // no children
    } else if (this.isPunct('{') || this.isPunct(';') || this.isKeyword('if') || this.isKeyword('for') || this.isKeyword('let') || this.isKeyword('assert') || this.isKeyword('echo') || this.current.kind === 'identifier' || this.current.kind === 'operator') {
      if (this.isPunct('{')) {
        children = this.parseBlock()
      } else if (this.isPunct(';')) {
        this.advance()
      } else {
        // child_statement: a single module instantiation or if
        const child = this.parseChildStatement()
        if (child !== undefined) children = [child]
      }
    }

    return {
      kind: 'moduleInst',
      name,
      args,
      children,
      modifiers,
      span: this.spanBetween(start, this.current.span),
    }
  }

  /** Parse a single child statement (for module instantiation children) */
  private parseChildStatement(): Stmt | undefined {
    if (this.isPunct(';')) {
      const span = this.current.span
      this.advance()
      return { kind: 'empty', span }
    }
    if (this.isPunct('{')) {
      const start = this.current.span
      const body = this.parseBlock()
      return { kind: 'moduleInst', name: 'group', args: [], children: body, modifiers: [], span: this.spanBetween(start, this.current.span) }
    }
    if (this.isKeyword('if')) {
      return this.parseIfStatement()
    }
    return this.parseModuleInstantiation()
  }

  private parseChildStatements(): readonly Stmt[] {
    if (this.isPunct('{')) {
      return this.parseBlock()
    }
    // Single statement
    const stmt = this.parseChildStatement()
    return stmt !== undefined ? [stmt] : []
  }

  private parseBlock(): readonly Stmt[] {
    const statements: Stmt[] = []
    this.advance() // '{'
    while (!this.atEnd && !this.isPunct('}')) {
      const before = this.index
      const stmt = this.parseStatement()
      if (stmt !== undefined) statements.push(stmt)
      if (this.index === before) this.advance()
    }
    this.eatPunct('}')
    return statements
  }

  private parseArguments(): readonly Argument[] {
    const args: Argument[] = []
    if (!this.eatPunct('(')) {
      this.report(DiagnosticCode.OSC1002, `Expected '('`, this.current.span)
      return args
    }
    while (!this.atEnd && !this.isPunct(')')) {
      const before = this.index
      // Named argument: ID = expr
      const t = this.current
      if (t.kind === 'identifier') {
        const next = this.peek(1)
        if (next.kind === 'operator' && next.op === '=') {
          this.advance() // ID
          this.advance() // '='
          const value = this.parseExpr()
          args.push({ name: t.name, value, span: this.spanBetween(t.span, this.current.span) })
          if (this.eatPunct(',')) continue
          if (this.isPunct(')')) break
          this.report(DiagnosticCode.OSC1001, `Expected ',' or ')' in argument list`, this.current.span)
          this.skipToBoundary()
          this.eatPunct(',')
          continue
        }
      }
      // Positional argument
      const value = this.parseExpr()
      if (value !== undefined) {
        args.push({ value, span: value.span })
      }
      if (this.eatPunct(',')) continue
      if (this.isPunct(')')) break
      this.report(DiagnosticCode.OSC1001, `Expected ',' or ')' in argument list`, this.current.span)
      this.skipToBoundary()
      this.eatPunct(',')
      if (this.index === before) this.advance()
    }
    this.eatPunct(')')
    return args
  }

  private skipToBoundary(): void {
    while (!this.atEnd) {
      if (this.isPunct(',') || this.isPunct(')') || this.isPunct(']') || this.isPunct(';') || this.isPunct('{') || this.isPunct('}')) return
      this.advance()
    }
  }

  // ─── Expression parsing (precedence climbing) ───

  private parseExpr(): Expr {
    return this.parseTernary()
  }

  private parseTernary(): Expr {
    const cond = this.parseLogicOr()
    if (this.eatOperator('?')) {
      const then = this.parseExpr()
      if (!this.eatOperator(':')) {
        this.report(DiagnosticCode.OSC1002, `Expected ':' in ternary expression`, this.current.span)
      }
      const els = this.parseExpr()
      return { kind: 'ternary', cond, then, els, span: this.spanBetween(cond.span, els.span) }
    }
    // let/assert/echo expressions with trailing body
    return this.maybeParseTrailingExpr(cond)
  }

  /** Handle let(...) / assert(...) / echo(...) followed by a body expression */
  private maybeParseTrailingExpr(expr: Expr): Expr {
    if (expr.kind === 'call') {
      const callee = expr.callee
      if (callee.kind === 'lookup') {
        if (callee.name === 'let' || callee.name === 'assert' || callee.name === 'echo') {
          // Check if there's a trailing expression
          if (!this.isPunct(';') && !this.isPunct(',') && !this.isPunct(')') && !this.isPunct(']') && !this.isPunct('}')) {
            const body = this.parseExpr()
            if (callee.name === 'let') {
              return { kind: 'let', args: expr.args, body, span: this.spanBetween(expr.span, body.span) }
            }
            if (callee.name === 'assert') {
              return { kind: 'assert', args: expr.args, body, span: this.spanBetween(expr.span, body.span) }
            }
            return { kind: 'echo', args: expr.args, body, span: this.spanBetween(expr.span, body.span) }
          }
        }
      }
    }
    return expr
  }

  private parseLogicOr(): Expr {
    let left = this.parseLogicAnd()
    while (this.eatOperator('||')) {
      const right = this.parseLogicAnd()
      left = { kind: 'binary', op: '||', left, right, span: this.spanBetween(left.span, right.span) }
    }
    return left
  }

  private parseLogicAnd(): Expr {
    let left = this.parseEquality()
    while (this.eatOperator('&&')) {
      const right = this.parseEquality()
      left = { kind: 'binary', op: '&&', left, right, span: this.spanBetween(left.span, right.span) }
    }
    return left
  }

  private parseEquality(): Expr {
    let left = this.parseComparison()
    for (;;) {
      const t = this.current
      if (t.kind === 'operator' && (t.op === '==' || t.op === '!=')) {
        this.advance()
        const right = this.parseComparison()
        left = { kind: 'binary', op: t.op, left, right, span: this.spanBetween(left.span, right.span) }
      } else break
    }
    return left
  }

  private parseComparison(): Expr {
    let left = this.parseBitOr()
    for (;;) {
      const t = this.current
    if (t.kind === 'operator' && (t.op === '<' || t.op === '>' || t.op === '<=' || t.op === '>=')) {
        this.advance()
        const right = this.parseBitOr()
        left = { kind: 'binary', op: t.op, left, right, span: this.spanBetween(left.span, right.span) }
      } else break
    }
    return left
  }

  private parseBitOr(): Expr {
    let left = this.parseBitAnd()
    while (this.eatOperator('|')) {
      const right = this.parseBitAnd()
      left = { kind: 'binary', op: '|', left, right, span: this.spanBetween(left.span, right.span) }
    }
    return left
  }

  private parseBitAnd(): Expr {
    let left = this.parseShift()
    while (this.eatOperator('&')) {
      const right = this.parseShift()
      left = { kind: 'binary', op: '&', left, right, span: this.spanBetween(left.span, right.span) }
    }
    return left
  }

  private parseShift(): Expr {
    let left = this.parseAddition()
    for (;;) {
      const t = this.current
      if (t.kind === 'operator' && (t.op === '<<' || t.op === '>>')) {
        this.advance()
        const right = this.parseAddition()
        left = { kind: 'binary', op: t.op, left, right, span: this.spanBetween(left.span, right.span) }
      } else break
    }
    return left
  }

  private parseAddition(): Expr {
    let left = this.parseMultiplication()
    for (;;) {
      const t = this.current
      if (t.kind === 'operator' && (t.op === '+' || t.op === '-')) {
        this.advance()
        const right = this.parseMultiplication()
        left = { kind: 'binary', op: t.op, left, right, span: this.spanBetween(left.span, right.span) }
      } else break
    }
    return left
  }

  private parseMultiplication(): Expr {
    let left = this.parseUnary()
    for (;;) {
      const t = this.current
      if (t.kind === 'operator' && (t.op === '*' || t.op === '/' || t.op === '%')) {
        this.advance()
        const right = this.parseUnary()
        left = { kind: 'binary', op: t.op, left, right, span: this.spanBetween(left.span, right.span) }
      } else break
    }
    return left
  }

  private parseUnary(): Expr {
    const t = this.current
    if (t.kind === 'operator' && (t.op === '+' || t.op === '-' || t.op === '!' || t.op === '~')) {
      this.advance()
      const operand = this.parseUnary()
      return { kind: 'unary', op: t.op, operand, span: this.spanBetween(t.span, operand.span) }
    }
    return this.parseExponent()
  }

  private parseExponent(): Expr {
    const left = this.parseCall()
    if (this.eatOperator('^')) {
      const right = this.parseUnary()
      return { kind: 'binary', op: '^', left, right, span: this.spanBetween(left.span, right.span) }
    }
    return left
  }

  private parseCall(): Expr {
    let expr = this.parsePrimary()
    for (;;) {
      if (this.isPunct('(')) {
        const args = this.parseArguments()
        expr = { kind: 'call', callee: expr, args, span: this.spanBetween(expr.span, this.current.span) }
        continue
      }
      if (this.isPunct('[')) {
        this.advance()
        const index = this.parseExpr()
        this.eatPunct(']')
        expr = { kind: 'index', array: expr, index, span: this.spanBetween(expr.span, this.current.span) }
        continue
      }
      // Member access: .ID
      if (this.isOperator('.')) {
        this.advance()
        const member = this.current
        if (member.kind !== 'identifier') {
          this.report(DiagnosticCode.OSC1001, `Expected member name after '.'`, member.span)
        } else {
          this.advance()
          expr = { kind: 'member', object: expr, member: member.name, span: this.spanBetween(expr.span, member.span) }
        }
        continue
      }
      break
    }
    return expr
  }

  private parsePrimary(): Expr {
    const t = this.current

    // number
    if (t.kind === 'number') {
      this.advance()
      return { kind: 'literal', type: 'number', value: t.value, span: t.span }
    }

    // string
    if (t.kind === 'string') {
      this.advance()
      return { kind: 'literal', type: 'string', value: t.value, span: t.span }
    }

    // true / false / undef
    if (t.kind === 'keyword') {
      if (t.keyword === 'true') {
        this.advance()
        return { kind: 'literal', type: 'boolean', value: true, span: t.span }
      }
      if (t.keyword === 'false') {
        this.advance()
        return { kind: 'literal', type: 'boolean', value: false, span: t.span }
      }
      if (t.keyword === 'undef') {
        this.advance()
        return { kind: 'literal', type: 'undef', value: undefined, span: t.span }
      }
      // function expression
      if (t.keyword === 'function') {
        this.advance()
        const params = this.parseParameters()
        const body = this.parseExpr()
        return { kind: 'funcdef', params, body, span: this.spanBetween(t.span, body.span) }
      }
      // let / assert / echo as function-like (they become calls, trailing body handled in maybeParseTrailingExpr)
      if (t.keyword === 'let' || t.keyword === 'assert' || t.keyword === 'echo') {
        const name = t.keyword
        this.advance()
        const args = this.parseArguments()
        const call: Expr = {
          kind: 'call',
          callee: { kind: 'lookup', name, span: t.span },
          args,
          span: this.spanBetween(t.span, this.current.span),
        }
        return call
      }
    }

    // identifier
    if (t.kind === 'identifier') {
      this.advance()
      return { kind: 'lookup', name: t.name, span: t.span }
    }

    // parenthesized expression
    if (this.isPunct('(')) {
      this.advance()
      const inner = this.parseExpr()
      this.eatPunct(')')
      return inner
    }

    // range: [ expr : expr ] or [ expr : expr : expr ]
    if (this.isPunct('[')) {
      return this.parseVectorOrRange()
    }

    this.report(DiagnosticCode.OSC1001, `Expected an expression, found ${this.describe(t)}`, t.span)
    this.advance()
    return { kind: 'literal', type: 'undef', value: undefined, span: t.span }
  }

  private parseVectorOrRange(): Expr {
    const start = this.current.span
    this.advance() // '['

    // Empty vector
    if (this.eatPunct(']')) {
      return { kind: 'vector', elements: [], span: this.spanBetween(start, this.current.span) }
    }

    // List comprehension: for/let/each/if as first element inside [...]
    if (this.isKeyword('for') || this.isKeyword('let') || this.isKeyword('each') || this.isKeyword('if')) {
      const lc = this.parseListComprehension()
      this.eatPunct(',') // optional trailing comma
      this.eatPunct(']')
      return lc
    }

    const first = this.parseExpr()

    // Range: [start : end] or [start : step : end]
    if (this.eatOperator(':')) {
      const second = this.parseExpr()
      if (this.eatOperator(':')) {
        const third = this.parseExpr()
        this.eatPunct(']')
        return { kind: 'range', start: first, step: second, end: third, span: this.spanBetween(start, this.current.span) }
      }
      this.eatPunct(']')
      return { kind: 'range', start: first, end: second, span: this.spanBetween(start, this.current.span) }
    }

    // Normal vector elements
    const elements: Expr[] = [first]
    while (this.eatPunct(',')) {
      if (this.isPunct(']')) break // trailing comma
      const elem = this.parseExpr()
      elements.push(elem)
    }
    this.eatPunct(']')
    return { kind: 'vector', elements, span: this.spanBetween(start, this.current.span) }
  }

  /** Parse a list comprehension element (for/let/each/if inside [...]) */
  private parseListComprehension(): Expr {
    const t = this.current

    // for (args) element
    if (t.kind === 'keyword' && t.keyword === 'for') {
      const start = t.span
      this.advance()
      const args = this.parseArguments()
      // Check for for-c: for(args; cond; incr_args)
      if (this.eatPunct(';')) {
        const cond = this.parseExpr()
        if (this.eatPunct(';')) {
          const incrArgs = this.parseArguments()
          const body = this.parseVectorElement()
          return { kind: 'lcforc', args, cond, incrArgs, body, span: this.spanBetween(start, body.span) }
        }
      }
      const body = this.parseVectorElement()
      return { kind: 'lcfor', args, body, span: this.spanBetween(start, body.span) }
    }

    // let (args) element
    if (t.kind === 'keyword' && t.keyword === 'let') {
      const start = t.span
      this.advance()
      const args = this.parseArguments()
      const body = this.parseVectorElement()
      return { kind: 'lclet', args, body, span: this.spanBetween(start, body.span) }
    }

    // each element
    if (t.kind === 'keyword' && t.keyword === 'each') {
      const start = t.span
      this.advance()
      const body = this.parseVectorElement()
      return { kind: 'lceach', body, span: this.spanBetween(start, body.span) }
    }

    // if (cond) element [else element]
    if (t.kind === 'keyword' && t.keyword === 'if') {
      const start = t.span
      this.advance()
      if (!this.eatPunct('(')) {
        this.report(DiagnosticCode.OSC1002, `Expected '(' after 'if'`, this.current.span)
      }
      const cond = this.parseExpr()
      this.eatPunct(')')
      const then = this.parseVectorElement()
      let els: Expr | undefined
      if (this.isKeyword('else')) {
        this.advance()
        els = this.parseVectorElement()
      }
      return { kind: 'lcif', cond, then, ...(els !== undefined ? { els } : {}), span: this.spanBetween(start, (els ?? then).span) }
    }

    this.report(DiagnosticCode.OSC1001, `Expected list comprehension`, t.span)
    this.advance()
    return { kind: 'literal', type: 'undef', value: undefined, span: t.span }
  }

  /** Parse a vector element (which can itself be a list comprehension or expression) */
  private parseVectorElement(): Expr {
    // A vector element can be a list comprehension (for/let/each/if) or a normal expr
    if (this.isKeyword('for') || this.isKeyword('let') || this.isKeyword('each') || this.isKeyword('if')) {
      return this.parseListComprehension()
    }
    return this.parseExpr()
  }
}

/** Parse .scad source text into an AST. Never throws. */
export function parseScad(text: string, options: ParseOptions = {}): ParseResult {
  const lexed = lexScad(text, options.path === undefined ? {} : { path: options.path })
  const bag = new DiagnosticBag()
  bag.merge(lexed.diagnostics)
  const parser = new Parser(lexed.tokens, options.path, bag)
  const document = parser.parseDocument()
  return { document, diagnostics: bag.all(), tokens: lexed.tokens }
}
