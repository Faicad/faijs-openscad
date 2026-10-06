/**
 * CSG 词法分析（plan §4.2，M1）。
 *
 * 规则全部来自对 225 个 `*-expected.csg` 的**实测**（2026-10-06），
 * 关键事实：
 *
 *  - 出现的字符集是封闭的：`\t \n 空格 ! " # $ % & ' ( ) + , - . / 0-9 : ; = [ ] _ 字母 { }`
 *    外加任意非 ASCII（`text()` 的内容含阿拉伯文、西里尔文、`☺`、组合字符）。
 *  - 数字有 12763 种、共 114231 个，**全部**能被
 *    `-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?` 吃掉；确实存在科学计数法
 *    （`1e+06`、`1e+10`、`2.65809e-06`、`2.71051e-14`）与 `-0`。
 *  - 字符串转义只出现 4 种：`\"`(4) `\t`(2) `\n`(2) `\\`(6)。未知转义**保留
 *    反斜杠**而不是静默丢弃，避免改变 `text()` 的内容。
 *  - 语料里**没有注释**（行注释与块注释各 0 次）。这里仍然实现它们，因为
 *    手写/剪辑过的 `.csg` 会带注释，而静默把 `//` 当语法错误是更糟的体验。
 *  - `-` 作为独立标点产出，由 parser 组合成负数或 `-inf`；这样 `1e-06` 的
 *    指数符号不会被误切。
 *
 * 词法器**不抛异常**：无法识别的字符产生 OSC1001 并跳过，保证任何输入都能
 * 走完整条流程并得到可报告的结果。
 */
import { DiagnosticBag, type Diagnostic, type Span } from '../diagnostics/diagnostic'
import { DiagnosticCode } from '../diagnostics/codes'
import type { CsgModifierToken } from './ast'

/**
 * 标点集合。`-` 也是标点（而不是数字的一部分）：parser 用「`-` 后跟 number
 * 或 `inf`」来决定它是负号，这样 `1e-06` 中的 `-` 已被数字扫描吞掉，不会
 * 出现歧义。
 */
export const PUNCTUATION = ['(', ')', '[', ']', '{', '}', ',', ';', '=', '-'] as const
export type Punctuation = (typeof PUNCTUATION)[number]

export interface IdentifierToken {
  readonly kind: 'identifier'
  readonly name: string
  readonly span: Span
}

export interface NumberToken {
  readonly kind: 'number'
  readonly value: number
  readonly raw: string
  readonly span: Span
}

export interface StringToken {
  readonly kind: 'string'
  /** 已解转义的内容。 */
  readonly value: string
  /** 含引号的原始片段；未闭合时到行尾（或输入结尾）。 */
  readonly raw: string
  readonly span: Span
}

export interface PunctuationToken {
  readonly kind: 'punct'
  readonly punct: Punctuation
  readonly span: Span
}

export interface ModifierToken {
  readonly kind: 'modifier'
  readonly modifier: CsgModifierToken
  readonly span: Span
}

export interface EofToken {
  readonly kind: 'eof'
  readonly span: Span
}

export type Token =
  | IdentifierToken
  | NumberToken
  | StringToken
  | PunctuationToken
  | ModifierToken
  | EofToken

export interface LexResult {
  readonly tokens: readonly Token[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface LexOptions {
  /** 诊断里回指的来源标签（通常是文件路径）。 */
  readonly path?: string
}

interface Mark {
  readonly offset: number
  readonly line: number
  readonly column: number
}

class Scanner {
  private offset = 0
  private line = 1
  private column = 1

  constructor(
    private readonly text: string,
    private readonly path: string | undefined,
    private readonly bag: DiagnosticBag,
  ) {}

  get source(): string {
    return this.text
  }

  get done(): boolean {
    return this.offset >= this.text.length
  }

  peek(ahead = 0): string {
    return this.text[this.offset + ahead] ?? ''
  }

  advance(count = 1): void {
    for (let i = 0; i < count && this.offset < this.text.length; i++) {
      const ch = this.text[this.offset]
      this.offset++
      if (ch === '\n') {
        this.line++
        this.column = 1
      } else if (ch === '\r') {
        // CRLF 只算一次换行；孤立的 CR 也算换行。
        if (this.text[this.offset] !== '\n') {
          this.line++
          this.column = 1
        }
      } else {
        this.column++
      }
    }
  }

  mark(): Mark {
    return { offset: this.offset, line: this.line, column: this.column }
  }

  reset(mark: Mark): void {
    this.offset = mark.offset
    this.line = mark.line
    this.column = mark.column
  }

  position(): Span['start'] {
    return { line: this.line, column: this.column, offset: this.offset }
  }

  spanFrom(start: Span['start']): Span {
    return { start, end: this.position() }
  }

  report(code: string, message: string, span: Span): void {
    this.bag.add({
      code,
      message,
      span,
      ...(this.path === undefined ? {} : { path: this.path }),
    })
  }
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$'
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch)
}

function isPunctuation(ch: string): ch is Punctuation {
  return (PUNCTUATION as readonly string[]).includes(ch)
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'
}

function skipTrivia(s: Scanner): void {
  for (;;) {
    const ch = s.peek()
    if (ch !== '' && isSpace(ch)) {
      s.advance()
      continue
    }
    if (ch === '/' && s.peek(1) === '/') {
      while (!s.done && s.peek() !== '\n') s.advance()
      continue
    }
    if (ch === '/' && s.peek(1) === '*') {
      const start = s.position()
      s.advance(2)
      let closed = false
      while (!s.done) {
        if (s.peek() === '*' && s.peek(1) === '/') {
          s.advance(2)
          closed = true
          break
        }
        s.advance()
      }
      if (!closed) s.report(DiagnosticCode.OSC1002, 'Unterminated block comment', s.spanFrom(start))
      continue
    }
    return
  }
}

/**
 * 解一个字符串转义。实测只出现 `\"` `\t` `\n` `\\` 四种；其余保留反斜杠，
 * 以免 `text("A:\q")` 的内容被悄悄改写。
 */
function unescape(ch: string): string {
  switch (ch) {
    case 'n':
      return '\n'
    case 't':
      return '\t'
    case 'r':
      return '\r'
    case '"':
      return '"'
    case '\\':
      return '\\'
    default:
      return `\\${ch}`
  }
}

function scanString(s: Scanner): StringToken {
  const start = s.position()
  s.advance()
  let value = ''
  let closed = false
  while (!s.done) {
    const ch = s.peek()
    if (ch === '\\') {
      const next = s.peek(1)
      if (next === '') break
      value += unescape(next)
      s.advance(2)
      continue
    }
    if (ch === '"') {
      s.advance()
      closed = true
      break
    }
    // CSG 字符串不跨行：未闭合就到行尾收手，避免把后续语法吞进字符串。
    if (ch === '\n') break
    value += ch
    s.advance()
  }
  const span = s.spanFrom(start)
  const raw = s.source.slice(start.offset, span.end.offset)
  if (!closed) s.report(DiagnosticCode.OSC1001, 'Unterminated string literal', span)
  return { kind: 'string', value, raw, span }
}

function scanNumber(s: Scanner): NumberToken {
  const start = s.position()
  let raw = ''
  while (isDigit(s.peek())) {
    raw += s.peek()
    s.advance()
  }
  if (s.peek() === '.') {
    raw += '.'
    s.advance()
    while (isDigit(s.peek())) {
      raw += s.peek()
      s.advance()
    }
  }
  const expMarker = s.peek()
  if (expMarker === 'e' || expMarker === 'E') {
    const mark = s.mark()
    let tail = expMarker
    s.advance()
    const sign = s.peek()
    if (sign === '+' || sign === '-') {
      tail += sign
      s.advance()
    }
    if (isDigit(s.peek())) {
      while (isDigit(s.peek())) {
        tail += s.peek()
        s.advance()
      }
      raw += tail
    } else {
      // `1e` 不是指数（后面没有数字）：回退，让 `e` 作为标识符继续。
      s.reset(mark)
    }
  }
  const span = s.spanFrom(start)
  return { kind: 'number', value: Number(raw), raw, span }
}

function scanIdentifier(s: Scanner): IdentifierToken {
  const start = s.position()
  let name = ''
  while (isIdentPart(s.peek())) {
    name += s.peek()
    s.advance()
  }
  return { kind: 'identifier', name, span: s.spanFrom(start) }
}

/** 把 CSG 文本切成 token 流。永不抛异常。 */
export function lexCsg(text: string, options: LexOptions = {}): LexResult {
  const bag = new DiagnosticBag()
  const s = new Scanner(text, options.path, bag)
  const tokens: Token[] = []

  for (;;) {
    skipTrivia(s)
    if (s.done) {
      tokens.push({ kind: 'eof', span: s.spanFrom(s.position()) })
      break
    }
    const ch = s.peek()
    if (ch === '"') {
      tokens.push(scanString(s))
      continue
    }
    if (isDigit(ch) || (ch === '.' && isDigit(s.peek(1)))) {
      tokens.push(scanNumber(s))
      continue
    }
    if (isIdentStart(ch)) {
      tokens.push(scanIdentifier(s))
      continue
    }
    if (isPunctuation(ch)) {
      const start = s.position()
      s.advance()
      tokens.push({ kind: 'punct', punct: ch, span: s.spanFrom(start) })
      continue
    }
    if (ch === '%' || ch === '#' || ch === '!') {
      const start = s.position()
      s.advance()
      tokens.push({ kind: 'modifier', modifier: ch, span: s.spanFrom(start) })
      continue
    }
    // 非法字符：报告 + 前进一个字符，保证循环一定收敛。
    const start = s.position()
    s.advance()
    s.report(
      DiagnosticCode.OSC1001,
      `Illegal character ${JSON.stringify(ch)} in CSG text`,
      s.spanFrom(start),
    )
  }

  return { tokens, diagnostics: bag.all() }
}
