/**
 * OpenSCAD 值系统。
 *
 * 依据 OpenSCAD 公开的语义独立实现，不复制其 GPL 源码。
 * 值类型：number, string, boolean, undef, vector, range, function。
 */
import type { Parameter } from './ast'

export type ValueType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'undef'
  | 'vector'
  | 'range'
  | 'function'
  | 'object'

export interface RangeValue {
  readonly start: number
  readonly step: number
  readonly end: number
  /** Number of values in the range. */
  readonly count: number
}

export interface FunctionValue {
  readonly name: string
  readonly params: readonly Parameter[]
  readonly body: import('./ast').Expr
  readonly closure: Scope
  /** Native function implementation (for builtins). */
  readonly native?: (args: readonly Value[]) => Value
}

export type Value =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'undef' }
  | { type: 'vector'; items: Value[] }
  | { type: 'range'; range: RangeValue }
  | { type: 'function'; fn: FunctionValue }
  | { type: 'object'; data: Record<string, Value> }

export const UNDEF: Value = { type: 'undef' }

export function num(v: number): Value {
  return { type: 'number', value: v }
}

export function str(v: string): Value {
  return { type: 'string', value: v }
}

export function bool(v: boolean): Value {
  return { type: 'boolean', value: v }
}

export function vec(items: Value[]): Value {
  return { type: 'vector', items }
}

export function isNumber(v: Value): v is { type: 'number'; value: number } {
  return v.type === 'number'
}

export function isString(v: Value): v is { type: 'string'; value: string } {
  return v.type === 'string'
}

export function isBoolean(v: Value): v is { type: 'boolean'; value: boolean } {
  return v.type === 'boolean'
}

export function isVector(v: Value): v is { type: 'vector'; items: Value[] } {
  return v.type === 'vector'
}

export function isFunction(v: Value): v is { type: 'function'; fn: FunctionValue } {
  return v.type === 'function'
}

export function isUndef(v: Value): boolean {
  return v.type === 'undef'
}

export function isTrue(v: Value): boolean {
  return v.type === 'boolean' ? v.value : v.type !== 'undef'
}

/** Convert a value to a number (OpenSCAD semantics). Returns NaN if not convertible. */
export function toNumber(v: Value): number {
  if (v.type === 'number') return v.value
  if (v.type === 'boolean') return v.value ? 1 : 0
  if (v.type === 'string') {
    const n = Number(v.value)
    return Number.isNaN(n) ? 0 : n
  }
  return Number.NaN
}

/** Convert a value to a string (OpenSCAD toString semantics). */
export function toStr(v: Value): string {
  switch (v.type) {
    case 'number':
      return formatNumber(v.value)
    case 'string':
      return v.value
    case 'boolean':
      return v.value ? 'true' : 'false'
    case 'undef':
      return 'undef'
    case 'vector':
      return `[${v.items.map(toStr).join(', ')}]`
    case 'range':
      return `[${formatNumber(v.range.start)} : ${v.range.step !== 1 ? `${formatNumber(v.range.step)} : ` : ''}${formatNumber(v.range.end)}]`
    case 'function':
      return v.fn.name || '<function>'
    case 'object':
      return '<object>'
  }
}

export function formatNumber(n: number): string {
  if (Number.isNaN(n)) return 'nan'
  if (n === Infinity) return 'inf'
  if (n === -Infinity) return '-inf'
  // OpenSCAD uses %.17g-like format for output
  // But for CSG dump, it uses a simpler format
  if (Number.isInteger(n)) return String(n)
  // Trim trailing zeros
  let s = n.toPrecision(15)
  // Remove trailing zeros after decimal point
  if (s.includes('.') && !s.includes('e')) {
    s = s.replace(/\.?0+$/, '')
  }
  return s
}

/** Get vector length (OpenSCAD len()). */
export function length(v: Value): number {
  if (v.type === 'vector') return v.items.length
  if (v.type === 'string') return v.value.length
  return 0
}

/** Get value at index (OpenSCAD array indexing). */
export function atIndex(v: Value, idx: number): Value {
  if (v.type === 'vector') {
    if (idx < 0 || idx >= v.items.length) return UNDEF
    return v.items[idx]
  }
  if (v.type === 'string') {
    if (idx < 0 || idx >= v.value.length) return UNDEF
    return str(v.value[idx])
  }
  return UNDEF
}

// ─── Scope ───

export class Scope {
  private vars = new Map<string, Value>()
  private modules = new Map<string, UserModuleEntry>()
  private functions = new Map<string, FunctionValue>()
  readonly parent: Scope | null

  constructor(parent: Scope | null = null) {
    this.parent = parent
  }

  get(name: string): Value | undefined {
    const v = this.vars.get(name)
    if (v !== undefined) return v
    return this.parent?.get(name)
  }

  set(name: string, value: Value): void {
    this.vars.set(name, value)
  }

  setLocal(name: string, value: Value): void {
    this.vars.set(name, value)
  }

  getFunction(name: string): FunctionValue | undefined {
    const f = this.functions.get(name)
    if (f !== undefined) return f
    return this.parent?.getFunction(name)
  }

  setFunction(name: string, fn: FunctionValue): void {
    this.functions.set(name, fn)
  }

  getModule(name: string): UserModuleEntry | undefined {
    const m = this.modules.get(name)
    if (m !== undefined) return m
    return this.parent?.getModule(name)
  }

  setModule(name: string, mod: UserModuleEntry): void {
    this.modules.set(name, mod)
  }

  child(): Scope {
    return new Scope(this)
  }
}

export interface UserModuleEntry {
  readonly name: string
  readonly params: readonly Parameter[]
  readonly body: readonly import('./ast').Stmt[]
  readonly closure: Scope
}
