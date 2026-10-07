/**
 * .scad 语法树 AST 定义。
 *
 * 依据 OpenSCAD 公开的语法规则独立实现，不复制其 GPL 源码。
 * AST 节点涵盖：语句（模块实例化、赋值、模块定义、函数定义）、
 * 表达式（字面量、变量查找、二元/一元运算、函数调用、向量、范围、
 * 列表推导式、三元条件、let/assert/echo 表达式、成员访问、数组索引）、
 * 参数列表。
 */
import type { Span } from '../diagnostics/diagnostic'

// ─── Expressions ───

export interface LiteralExpr {
  readonly kind: 'literal'
  readonly type: 'number' | 'string' | 'boolean' | 'undef'
  readonly value: number | string | boolean | undefined
  readonly span: Span
}

export interface LookupExpr {
  readonly kind: 'lookup'
  readonly name: string
  readonly span: Span
}

export interface BinaryOpExpr {
  readonly kind: 'binary'
  readonly op: string
  readonly left: Expr
  readonly right: Expr
  readonly span: Span
}

export interface UnaryOpExpr {
  readonly kind: 'unary'
  readonly op: string
  readonly operand: Expr
  readonly span: Span
}

export interface TernaryExpr {
  readonly kind: 'ternary'
  readonly cond: Expr
  readonly then: Expr
  readonly els: Expr
  readonly span: Span
}

export interface FunctionCallExpr {
  readonly kind: 'call'
  readonly callee: Expr
  readonly args: readonly Argument[]
  readonly span: Span
}

export interface ArrayLookupExpr {
  readonly kind: 'index'
  readonly array: Expr
  readonly index: Expr
  readonly span: Span
}

export interface MemberLookupExpr {
  readonly kind: 'member'
  readonly object: Expr
  readonly member: string
  readonly span: Span
}

export interface VectorExpr {
  readonly kind: 'vector'
  readonly elements: readonly Expr[]
  readonly span: Span
}

export interface RangeExpr {
  readonly kind: 'range'
  readonly start: Expr
  readonly end: Expr
  readonly step?: Expr
  readonly span: Span
}

export interface FunctionDefExpr {
  readonly kind: 'funcdef'
  readonly params: readonly Parameter[]
  readonly body: Expr
  readonly span: Span
}

export interface LetExpr {
  readonly kind: 'let'
  readonly args: readonly Argument[]
  readonly body: Expr
  readonly span: Span
}

export interface AssertExpr {
  readonly kind: 'assert'
  readonly args: readonly Argument[]
  readonly body?: Expr
  readonly span: Span
}

export interface EchoExpr {
  readonly kind: 'echo'
  readonly args: readonly Argument[]
  readonly body?: Expr
  readonly span: Span
}

// List comprehension elements
export interface LcForExpr {
  readonly kind: 'lcfor'
  readonly args: readonly Argument[]
  readonly body: Expr
  readonly span: Span
}

export interface LcForCExpr {
  readonly kind: 'lcforc'
  readonly args: readonly Argument[]
  readonly cond: Expr
  readonly incrArgs: readonly Argument[]
  readonly body: Expr
  readonly span: Span
}

export interface LcEachExpr {
  readonly kind: 'lceach'
  readonly body: Expr
  readonly span: Span
}

export interface LcLetExpr {
  readonly kind: 'lclet'
  readonly args: readonly Argument[]
  readonly body: Expr
  readonly span: Span
}

export interface LcIfExpr {
  readonly kind: 'lcif'
  readonly cond: Expr
  readonly then: Expr
  readonly els?: Expr
  readonly span: Span
}

export type ListComprehension =
  | LcForExpr
  | LcForCExpr
  | LcEachExpr
  | LcLetExpr
  | LcIfExpr

export type Expr =
  | LiteralExpr
  | LookupExpr
  | BinaryOpExpr
  | UnaryOpExpr
  | TernaryExpr
  | FunctionCallExpr
  | ArrayLookupExpr
  | MemberLookupExpr
  | VectorExpr
  | RangeExpr
  | FunctionDefExpr
  | LetExpr
  | AssertExpr
  | EchoExpr
  | ListComprehension

// ─── Arguments & Parameters ───

export interface Argument {
  readonly name?: string
  readonly value: Expr
  readonly span: Span
}

export interface Parameter {
  readonly name: string
  readonly defaultValue?: Expr
  readonly span: Span
}

// ─── Statements ───

export interface ModuleInstantiationStmt {
  readonly kind: 'moduleInst'
  readonly name: string
  readonly args: readonly Argument[]
  readonly children: readonly Stmt[]
  readonly modifiers: readonly ('!' | '*' | '%' | '#')[]
  readonly span: Span
}

export interface AssignmentStmt {
  readonly kind: 'assignment'
  readonly name: string
  readonly value: Expr
  readonly span: Span
}

export interface ModuleDefStmt {
  readonly kind: 'moduleDef'
  readonly name: string
  readonly params: readonly Parameter[]
  readonly body: readonly Stmt[]
  readonly span: Span
}

export interface FunctionDefStmt {
  readonly kind: 'functionDef'
  readonly name: string
  readonly params: readonly Parameter[]
  readonly body: Expr
  readonly span: Span
}

export interface UseStmt {
  readonly kind: 'use'
  readonly path: string
  readonly span: Span
}

export interface IncludeStmt {
  readonly kind: 'include'
  readonly path: string
  readonly span: Span
}

export interface IfStmt {
  readonly kind: 'if'
  readonly cond: Expr
  readonly then: readonly Stmt[]
  readonly els?: readonly Stmt[]
  readonly span: Span
}

export interface EmptyStmt {
  readonly kind: 'empty'
  readonly span: Span
}

export type Stmt =
  | ModuleInstantiationStmt
  | AssignmentStmt
  | ModuleDefStmt
  | FunctionDefStmt
  | UseStmt
  | IncludeStmt
  | IfStmt
  | EmptyStmt

export interface ScadDocument {
  readonly statements: readonly Stmt[]
  readonly span: Span
}
