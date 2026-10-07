/**
 * .scad 词法分析 token 定义。
 *
 * 依据 OpenSCAD 公开的语法规则独立实现，不复制其 GPL 源码。
 */
import type { Span } from '../diagnostics/diagnostic'

export type KeywordKind =
  | 'module'
  | 'function'
  | 'if'
  | 'else'
  | 'for'
  | 'let'
  | 'assert'
  | 'echo'
  | 'each'
  | 'true'
  | 'false'
  | 'undef'
  | 'use'
  | 'include'

export type OperatorKind =
  | '!'
  | '*'
  | '%'
  | '#'
  | '+'
  | '-'
  | '~'
  | '/'
  | '^'
  | '|'
  | '&'
  | '='
  | '<'
  | '>'
  | '.'
  | ':'
  | '?'
  | '<='
  | '>='
  | '=='
  | '!='
  | '&&'
  | '||'
  | '<<'
  | '>>'

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
  readonly value: string
  readonly raw: string
  readonly span: Span
}

export interface KeywordToken {
  readonly kind: 'keyword'
  readonly keyword: KeywordKind
  readonly span: Span
  /** For use/include directives: the file path between `<...>`. */
  readonly directivePath?: string
}

export interface OperatorToken {
  readonly kind: 'operator'
  readonly op: OperatorKind
  readonly span: Span
}

export interface PunctuationToken {
  readonly kind: 'punct'
  readonly punct: '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';'
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
  | KeywordToken
  | OperatorToken
  | PunctuationToken
  | EofToken

export interface LexResult {
  readonly tokens: readonly Token[]
  readonly diagnostics: readonly import('../diagnostics/diagnostic').Diagnostic[]
}

export interface LexOptions {
  readonly path?: string
}
