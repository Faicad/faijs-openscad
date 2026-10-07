/**
 * .scad 词法分析器。
 *
 * 依据 OpenSCAD 公开的语法规则独立实现，不复制其 GPL 源码。
 * 覆盖：标识符、关键字、数字（含科学计数法）、字符串（含转义）、
 * 运算符（多字符优先匹配）、标点、use/include 指令、注释（行/块）。
 *
 * 永不抛异常：非法字符产生诊断并跳过。
 */
import { DiagnosticBag, type Span } from '../diagnostics/diagnostic'
import { DiagnosticCode } from '../diagnostics/codes'
import type {
  KeywordKind,
  LexOptions,
  LexResult,
  NumberToken,
  OperatorKind,
  PunctuationToken,
  StringToken,
  Token,
} from './token'

const KEYWORDS = new Map<string, KeywordKind>([
  ['module', 'module'],
  ['function', 'function'],
  ['if', 'if'],
  ['else', 'else'],
  ['for', 'for'],
  ['let', 'let'],
  ['assert', 'assert'],
  ['echo', 'echo'],
  ['each', 'each'],
  ['true', 'true'],
  ['false', 'false'],
  ['undef', 'undef'],
])

// Multi-char operators sorted longest-first for greedy matching.
const OPERATORS: { text: string; op: OperatorKind }[] = [
  { text: '==', op: '==' },
  { text: '!=', op: '!=' },
  { text: '<=', op: '<=' },
  { text: '>=', op: '>=' },
  { text: '&&', op: '&&' },
  { text: '||', op: '||' },
  { text: '<<', op: '<<' },
  { text: '>>', op: '>>' },
  { text: '<', op: '<' },
  { text: '>', op: '>' },
  { text: '=', op: '=' },
  { text: '!', op: '!' },
  { text: '+', op: '+' },
  { text: '-', op: '-' },
  { text: '*', op: '*' },
  { text: '/', op: '/' },
  { text: '%', op: '%' },
  { text: '#', op: '#' },
  { text: '^', op: '^' },
  { text: '~', op: '~' },
  { text: '|', op: '|' },
  { text: '&', op: '&' },
  { text: '.', op: '.' },
  { text: ':', op: ':' },
  { text: '?', op: '?' },
]

const PUNCTUATION = new Set(['(', ')', '[', ']', '{', '}', ',', ';'])

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
        if (this.text[this.offset] !== '\n') {
          this.line++
          this.column = 1
        }
      } else {
        this.column++
      }
    }
  }

  reset(mark: Mark): void {
    this.offset = mark.offset
    this.line = mark.line
    this.column = mark.column
  }

  mark(): Mark {
    return { offset: this.offset, line: this.line, column: this.column }
  }

  position(): Span['start'] {
    return { line: this.line, column: this.column, offset: this.offset }
  }

  spanFrom(start: Span['start']): Span {
    return { start, end: this.position() }
  }

  slice(start: Span['start']): string {
    return this.text.slice(start.offset, this.offset)
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

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'
}

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

function scanString(s: Scanner): StringToken {
  const start = s.position()
  s.advance() // skip opening "
  let value = ''
  let closed = false
  while (!s.done) {
    const ch = s.peek()
    if (ch === '\\') {
      const next = s.peek(1)
      if (next === '\n') {
        s.advance(2) // line continuation
        continue
      }
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
    if (ch === '\n') break
    value += ch
    s.advance()
  }
  const span = s.spanFrom(start)
  if (!closed) s.report(DiagnosticCode.OSC1001, 'Unterminated string literal', span)
  const raw = s.slice(start)
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
      s.reset(mark)
    }
  }
  const span = s.spanFrom(start)
  return { kind: 'number', value: Number(raw), raw, span }
}

function scanIdentifierOrKeyword(s: Scanner): Token {
  const start = s.position()
  let name = ''
  while (isIdentPart(s.peek())) {
    name += s.peek()
    s.advance()
  }
  const span = s.spanFrom(start)
  const kw = KEYWORDS.get(name)
  if (kw !== undefined) {
    return { kind: 'keyword', keyword: kw, span }
  }
  return { kind: 'identifier', name, span }
}

function matchOperator(s: Scanner): Token | undefined {
  for (const { text, op } of OPERATORS) {
    let match = true
    for (let i = 0; i < text.length; i++) {
      if (s.peek(i) !== text[i]) {
        match = false
        break
      }
    }
    if (match) {
      const start = s.position()
      s.advance(text.length)
      return { kind: 'operator', op, span: s.spanFrom(start) }
    }
  }
  return undefined
}

/**
 * Try to scan a `use <path>` or `include <path>` directive.
 * Returns the token if matched, otherwise resets and returns undefined.
 */
function scanDirective(s: Scanner): Token | undefined {
  const mark = s.mark()
  // Read identifier
  let name = ''
  while (isIdentPart(s.peek())) {
    name += s.peek()
    s.advance()
  }
  if (name !== 'use' && name !== 'include') {
    s.reset(mark)
    return undefined
  }
  // Skip whitespace (including newlines) before `<`
  const saveMark = s.mark()
  while (!s.done && isSpace(s.peek())) s.advance()
  if (s.peek() !== '<') {
    // Not a directive — reset to just after the identifier
    s.reset(saveMark)
    const kw = name === 'use' ? 'use' : 'include'
    return {
      kind: 'keyword',
      keyword: kw,
      span: { start: { line: mark.line, column: mark.column, offset: mark.offset }, end: s.position() },
    }
  }
  // Read path between < and >
  s.advance() // skip <
  let pathStr = ''
  while (!s.done && s.peek() !== '>' && s.peek() !== '\n') {
    pathStr += s.peek()
    s.advance()
  }
  if (s.peek() === '>') s.advance()
  const span = s.spanFrom({ line: mark.line, column: mark.column, offset: mark.offset })
  const kw = name === 'use' ? 'use' : 'include'
  return { kind: 'keyword', keyword: kw, span, directivePath: pathStr }
}

/** Tokenize .scad source text. Never throws. */
export function lexScad(text: string, options: LexOptions = {}): LexResult {
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

    // use/include directive (must check before identifiers since they start with letters)
    const directive = scanDirective(s)
    if (directive !== undefined) {
      tokens.push(directive)
      continue
    }

    // String
    if (ch === '"') {
      tokens.push(scanString(s))
      continue
    }

    // Number
    if (isDigit(ch) || (ch === '.' && isDigit(s.peek(1)))) {
      tokens.push(scanNumber(s))
      continue
    }

    // Identifier / keyword
    if (isIdentStart(ch)) {
      tokens.push(scanIdentifierOrKeyword(s))
      continue
    }

    // Punctuation
    if (PUNCTUATION.has(ch)) {
      const start = s.position()
      s.advance()
      tokens.push({
        kind: 'punct',
        punct: ch as PunctuationToken['punct'],
        span: s.spanFrom(start),
      })
      continue
    }

    // Operators (multi-char first)
    const op = matchOperator(s)
    if (op !== undefined) {
      tokens.push(op)
      continue
    }

    // Illegal character
    const start = s.position()
    s.advance()
    s.report(
      DiagnosticCode.OSC1001,
      `Illegal character ${JSON.stringify(ch)} in .scad source`,
      s.spanFrom(start),
    )
  }

  return { tokens, diagnostics: bag.all() }
}
