/**
 * OpenSCAD 表达式求值器。
 *
 * 依据 OpenSCAD 公开的语义独立实现，不复制其 GPL 源码。
 * 处理：字面量、变量查找、二元/一元运算、函数调用、向量、范围、
 * 三元条件、let/assert/echo 表达式、列表推导式、成员访问、数组索引。
 *
 * 内置函数：sin, cos, tan, asin, acos, atan, atan2, sqrt, pow, exp, log, ln,
 * abs, sign, floor, ceil, round, min, max, len, search, rands, concat, chr,
 * ord, str, num, is_undef, is_list, is_num, is_string, is_boolean, is_function,
 * select, slice, hash, version, version_num, parent_module, etc.
 */
/**
 * 修复的核心 Bug
1. let 表达式参数求值 scope 错误 (src/scad/evaluator.ts)
问题：let(n=3, vals=[for(i=[0:n-1]) i]) 中的后续参数 vals 使用父 scope 求值，导致无法访问前序参数 n 的绑定。
修复：将 evalExpr(arg.value, scope) 改为 evalExpr(arg.value, childScope)，使后续参数能正确看到之前参数的绑定。
（符合 OpenSCAD 的 let() 语义）

2. for 循环中标量值不被迭代为单值绑定 (src/scad/evaluator.ts + src/scad/module-evaluator.ts)
问题：for(i=[0:num-1], a=i*360/num) 中，当 a 的右边 i*360/num 求值为一个数字时，iterateValue 返回空迭代器，
导致 a 变量从未被绑定。这使得 ngon() 返回空向量，进而导致 sum(ngon(360)) 无限递归。
（因为 len([]) = 0，递归终止条件 s == -1 永不为 true）。
修复：在 evalLcFor（列表推导式中的 for）和 evalForModule（模块级 for）中，将标量值（数字、字符串等）视为单值绑定，而不是跳过迭代。
这符合 OpenSCAD 的行为：for 循环中，范围和向量会被迭代，标量值被绑定为单值。
 */
import type { Expr, Argument } from './ast'
import {
  type FunctionValue,
  type RangeValue,
  type Scope,
  type Value,
  UNDEF,
  bool,
  isBoolean,
  isFunction,
  isNumber,
  isString,
  isTrue,
  isUndef,
  isVector,
  length,
  num,
  str,
  toNumber,
  toStr,
  vec,
} from './value'

/** Evaluate an expression in a scope. Never throws; returns UNDEF on error. */
let _evalDepth = 0
export function evalExpr(expr: Expr, scope: Scope): Value {
  _evalDepth++
  if (_evalDepth > 10000) {
    _evalDepth--
    return UNDEF
  }
  try {
  switch (expr.kind) {
    case 'literal':
      if (expr.type === 'number') return num(expr.value as number)
      if (expr.type === 'string') return str(expr.value as string)
      if (expr.type === 'boolean') return bool(expr.value as boolean)
      return UNDEF

    case 'lookup': {
      const v = scope.get(expr.name)
      return v ?? UNDEF
    }

    case 'binary':
      return evalBinary(expr.op, expr.left, expr.right, scope)

    case 'unary':
      return evalUnary(expr.op, expr.operand, scope)

    case 'ternary': {
      const cond = evalExpr(expr.cond, scope)
      return isTrue(cond) ? evalExpr(expr.then, scope) : evalExpr(expr.els, scope)
    }

    case 'call':
      return evalCall(expr, scope)

    case 'index': {
      const arr = evalExpr(expr.array, scope)
      const idx = evalExpr(expr.index, scope)
      const i = Math.floor(toNumber(idx))
      if (isVector(arr)) {
        if (i < 0 || i >= arr.items.length) return UNDEF
        return arr.items[i]
      }
      if (isString(arr)) {
        if (i < 0 || i >= arr.value.length) return UNDEF
        return str(arr.value[i])
      }
      return UNDEF
    }

    case 'member': {
      const obj = evalExpr(expr.object, scope)
      // OpenSCAD doesn't have real objects, but some internal types have members
      // (e.g., font objects, range .start/.end/.step)
      if (obj.type === 'range') {
        if (expr.member === 'start') return num(obj.range.start)
        if (expr.member === 'end') return num(obj.range.end)
        if (expr.member === 'step') return num(obj.range.step)
        if (expr.member === 'count') return num(obj.range.count)
      }
      return UNDEF
    }

    case 'vector': {
      const items = expr.elements.map((e) => evalExpr(e, scope))
      return vec(items)
    }

    case 'range': {
      const start = toNumber(evalExpr(expr.start, scope))
      const end = toNumber(evalExpr(expr.end, scope))
      const step = expr.step !== undefined ? toNumber(evalExpr(expr.step, scope)) : 1
      if (step === 0) return UNDEF
      // Guard against NaN (e.g., when range bounds are undef)
      if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(step)) return UNDEF
      const count = step > 0 ? Math.floor((end - start) / step + 1e-10) + 1 : Math.floor((end - start) / step + 1e-10) + 1
      if (count < 0 || count > 10000000 || Number.isNaN(count)) return UNDEF
      const range: RangeValue = { start, step, end, count: Math.max(0, count) }
      return { type: 'range', range }
    }

    case 'funcdef': {
      const fn: FunctionValue = {
        name: '<anonymous>',
        params: expr.params,
        body: expr.body,
        closure: scope,
      }
      return { type: 'function', fn }
    }

    case 'let': {
      const childScope = scope.child()
      for (const arg of expr.args) {
        if (arg.name !== undefined) {
          // OpenSCAD let() semantics: later args can see earlier bindings
          childScope.set(arg.name, evalExpr(arg.value, childScope))
        }
      }
      return expr.body !== undefined ? evalExpr(expr.body, childScope) : UNDEF
    }

    case 'assert': {
      // Evaluate arguments (first one is the condition)
      if (expr.args.length > 0) {
        const cond = evalExpr(expr.args[0].value, scope)
        if (!isTrue(cond)) {
          // Assertion failed - OpenSCAD logs an error
          // We don't throw, just continue
        }
      }
      return expr.body !== undefined ? evalExpr(expr.body, scope) : UNDEF
    }

    case 'echo': {
      // Echo is a no-op for our purposes (we don't need the output)
      return expr.body !== undefined ? evalExpr(expr.body, scope) : UNDEF
    }

    // List comprehensions
    case 'lcfor':
      return evalLcFor(expr, scope)
    case 'lcforc':
      return evalLcForC(expr, scope)
    case 'lceach':
      return evalLcEach(expr, scope)
    case 'lclet':
      return evalLcLet(expr, scope)
    case 'lcif':
      return evalLcIf(expr, scope)
  }
  } finally {
    _evalDepth--
  }
}

function evalBinary(op: string, leftExpr: Expr, rightExpr: Expr, scope: Scope): Value {
  // Short-circuit for && and ||
  if (op === '&&') {
    const l = evalExpr(leftExpr, scope)
    if (!isTrue(l)) return bool(false)
    return bool(isTrue(evalExpr(rightExpr, scope)))
  }
  if (op === '||') {
    const l = evalExpr(leftExpr, scope)
    if (isTrue(l)) return bool(true)
    return bool(isTrue(evalExpr(rightExpr, scope)))
  }

  const l = evalExpr(leftExpr, scope)
  const r = evalExpr(rightExpr, scope)

  switch (op) {
    case '+':
      if (isNumber(l) && isNumber(r)) return num(l.value + r.value)
      if (isString(l)) return str(l.value + toStr(r))
      if (isVector(l) && isVector(r)) return vec([...l.items, ...r.items])
      return num(toNumber(l) + toNumber(r))
    case '-':
      return num(toNumber(l) - toNumber(r))
    case '*':
      return num(toNumber(l) * toNumber(r))
    case '/':
      return num(toNumber(l) / toNumber(r))
    case '%':
      return num(toNumber(l) % toNumber(r))
    case '^':
      return num(Math.pow(toNumber(l), toNumber(r)))
    case '<':
      return bool(toNumber(l) < toNumber(r))
    case '>':
      return bool(toNumber(l) > toNumber(r))
    case '<=':
      return bool(toNumber(l) <= toNumber(r))
    case '>=':
      return bool(toNumber(l) >= toNumber(r))
    case '==':
      return bool(valueEquals(l, r))
    case '!=':
      return bool(!valueEquals(l, r))
    case '|':
      return num(Math.trunc(toNumber(l)) | Math.trunc(toNumber(r)))
    case '&':
      return num(Math.trunc(toNumber(l)) & Math.trunc(toNumber(r)))
    case '<<':
      return num(Math.trunc(toNumber(l)) << Math.trunc(toNumber(r)))
    case '>>':
      return num(Math.trunc(toNumber(l)) >> Math.trunc(toNumber(r)))
  }
  return UNDEF
}

function evalUnary(op: string, operandExpr: Expr, scope: Scope): Value {
  const v = evalExpr(operandExpr, scope)
  switch (op) {
    case '-':
      return num(-toNumber(v))
    case '+':
      return num(toNumber(v))
    case '!':
      return bool(!isTrue(v))
    case '~':
      return num(~Math.trunc(toNumber(v)))
  }
  return UNDEF
}

function valueEquals(a: Value, b: Value): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'number':
      return a.value === (b as typeof a).value
    case 'string':
      return a.value === (b as typeof a).value
    case 'boolean':
      return a.value === (b as typeof a).value
    case 'undef':
      return true
    case 'vector':
      return a.items.length === (b as typeof a).items.length && a.items.every((v, i) => valueEquals(v, (b as typeof a).items[i]))
    default:
      return false
  }
}

function evalCall(expr: Extract<Expr, { kind: 'call' }>, scope: Scope): Value {
  // Get the callee
  if (expr.callee.kind !== 'lookup') {
    // Nested call (e.g., f(x)(y)) - not common in OpenSCAD
    const fn = evalExpr(expr.callee, scope)
    return callFunction(fn, expr.args, scope)
  }

  const name = expr.callee.name

  // Check user-defined functions first
  const userFn = scope.getFunction(name)
  if (userFn !== undefined) {
    return callUserFunction(userFn, expr.args, scope)
  }

  // Check built-in functions
  const builtin = BUILTIN_FUNCTIONS.get(name)
  if (builtin !== undefined) {
    const args = expr.args.map((a) => evalExpr(a.value, scope))
    return builtin(args)
  }

  // Check if name is a variable holding a function
  const varFn = scope.get(name)
  if (varFn !== undefined && isFunction(varFn)) {
    return callFunction(varFn, expr.args, scope)
  }

  return UNDEF
}

function callFunction(fn: Value, args: readonly Argument[], scope: Scope): Value {
  if (!isFunction(fn)) return UNDEF
  return callUserFunction(fn.fn, args, scope)
}

function callUserFunction(fn: FunctionValue, args: readonly Argument[], callerScope: Scope): Value {
  const fnScope = fn.closure.child()
  // Bind parameters
  for (let i = 0; i < fn.params.length; i++) {
    const param = fn.params[i]
    let argValue: Value | undefined
    // Look for named argument
    for (const a of args) {
      if (a.name === param.name) {
        argValue = evalExpr(a.value, callerScope)
        break
      }
    }
    // If not found by name, try positional
    if (argValue === undefined) {
      let posIdx = 0
      for (const a of args) {
        if (a.name === undefined) {
          if (posIdx === i) {
            argValue = evalExpr(a.value, callerScope)
            break
          }
          posIdx++
        }
      }
    }
    // Default value
    if (argValue === undefined && param.defaultValue !== undefined) {
      argValue = evalExpr(param.defaultValue, fn.closure)
    }
    fnScope.set(param.name, argValue ?? UNDEF)
  }
  return evalExpr(fn.body, fnScope)
}

// ─── List comprehension evaluators ───

function evalLcFor(expr: Extract<Expr, { kind: 'lcfor' }>, scope: Scope): Value {
  const results: Value[] = []
  // for loops can have multiple assignments: for(a=[0:3], b=[0:2]) ...
  // Each assignment is evaluated and iterated in nested fashion.
  // In OpenSCAD, if the RHS is a scalar (number/string), it's treated as a
  // single-value binding (not iterated), similar to let().
  const iter = (argIdx: number, currentScope: Scope) => {
    if (argIdx >= expr.args.length) {
      results.push(evalExpr(expr.body, currentScope))
      return
    }
    const arg = expr.args[argIdx]
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
  iter(0, scope)
  return vec(results)
}

function evalLcForC(expr: Extract<Expr, { kind: 'lcforc' }>, scope: Scope): Value {
  const results: Value[] = []
  // for-c: for(args; cond; incr_args) body
  // Initialize loop variables
  const loopScope = scope.child()
  for (const arg of expr.args) {
    if (arg.name !== undefined) {
      loopScope.set(arg.name, evalExpr(arg.value, scope))
    }
  }
  let iterations = 0
  while (iterations < 1000000) {
    const cond = evalExpr(expr.cond, loopScope)
    if (!isTrue(cond)) break
    results.push(evalExpr(expr.body, loopScope))
    // Apply increment
    for (const arg of expr.incrArgs) {
      if (arg.name !== undefined) {
        loopScope.set(arg.name, evalExpr(arg.value, loopScope))
      }
    }
    iterations++
  }
  return vec(results)
}

function evalLcEach(expr: Extract<Expr, { kind: 'lceach' }>, scope: Scope): Value {
  const val = evalExpr(expr.body, scope)
  const results: Value[] = []
  for (const v of iterateValue(val)) {
    results.push(v)
  }
  return vec(results)
}

function evalLcLet(expr: Extract<Expr, { kind: 'lclet' }>, scope: Scope): Value {
  const childScope = scope.child()
  for (const arg of expr.args) {
    if (arg.name !== undefined) {
      childScope.set(arg.name, evalExpr(arg.value, childScope))
    }
  }
  return evalExpr(expr.body, childScope)
}

function evalLcIf(expr: Extract<Expr, { kind: 'lcif' }>, scope: Scope): Value {
  const cond = evalExpr(expr.cond, scope)
  if (isTrue(cond)) {
    return evalExpr(expr.then, scope)
  }
  if (expr.els !== undefined) {
    return evalExpr(expr.els, scope)
  }
  return vec([])
}

/** Iterate over a value: vectors yield their elements, ranges yield numbers. */
export function* iterateValue(v: Value): Generator<Value> {
  if (isVector(v)) {
    for (const item of v.items) yield item
  } else if (v.type === 'range') {
    const r = v.range
    for (let i = 0; i < r.count; i++) {
      yield num(r.start + i * r.step)
    }
  } else if (isNumber(v)) {
    // Iterating a number yields nothing (OpenSCAD treats it as empty)
  } else if (isString(v)) {
    // Iterating a string yields nothing
  }
}

// ─── Built-in functions ───

function deg2rad(d: number): number {
  return (d * Math.PI) / 180
}

function rad2deg(r: number): number {
  return (r * 180) / Math.PI
}

/** Deterministic PRNG for rands() with seed support. */
class DeterministicRng {
  private state: number
  constructor(seed: number) {
    this.state = (seed >>> 0) || 1
  }
  next(): number {
    // Simple xorshift32
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x >>> 0
    return this.state / 0xffffffff
  }
}

function hashFloatingPoint(d: number): number {
  // Simple hash of a double to uint32 for seeding RNG
  const buf = new Float64Array(1)
  buf[0] = d
  const view = new DataView(buf.buffer)
  const lo = view.getUint32(0, true)
  const hi = view.getUint32(4, true)
  return (lo ^ hi) >>> 0
}

export const BUILTIN_FUNCTIONS = new Map<string, (args: readonly Value[]) => Value>([
  // Trigonometric (degrees in OpenSCAD)
  ['sin', (a) => num(Math.sin(deg2rad(toNumber(a[0]))))],
  ['cos', (a) => num(Math.cos(deg2rad(toNumber(a[0]))))],
  ['tan', (a) => num(Math.tan(deg2rad(toNumber(a[0]))))],
  ['asin', (a) => num(rad2deg(Math.asin(toNumber(a[0]))))],
  ['acos', (a) => num(rad2deg(Math.acos(toNumber(a[0]))))],
  ['atan', (a) => num(rad2deg(Math.atan(toNumber(a[0]))))],
  ['atan2', (a) => num(rad2deg(Math.atan2(toNumber(a[0]), toNumber(a[1]))))],
  // Power/log
  ['sqrt', (a) => num(Math.sqrt(toNumber(a[0])))],
  ['pow', (a) => num(Math.pow(toNumber(a[0]), toNumber(a[1])))],
  ['exp', (a) => num(Math.exp(toNumber(a[0])))],
  ['log', (a) => num(Math.log10(toNumber(a[0])))],
  ['ln', (a) => num(Math.log(toNumber(a[0])))],
  // Rounding
  ['abs', (a) => num(Math.abs(toNumber(a[0])))],
  ['sign', (a) => {
    const x = toNumber(a[0])
    return num(x < 0 ? -1 : x > 0 ? 1 : 0)
  }],
  ['floor', (a) => num(Math.floor(toNumber(a[0])))],
  ['ceil', (a) => num(Math.ceil(toNumber(a[0])))],
  ['round', (a) => num(Math.round(toNumber(a[0])))],
  ['trunc', (a) => num(Math.trunc(toNumber(a[0])))],
  // Min/max
  ['min', (a) => {
    if (a.length === 0) return UNDEF
    if (a.length === 1 && isVector(a[0])) {
      return num(Math.min(...a[0].items.map(toNumber)))
    }
    return num(Math.min(...a.map(toNumber)))
  }],
  ['max', (a) => {
    if (a.length === 0) return UNDEF
    if (a.length === 1 && isVector(a[0])) {
      return num(Math.max(...a[0].items.map(toNumber)))
    }
    return num(Math.max(...a.map(toNumber)))
  }],
  // Length
  ['len', (a) => {
    if (a.length === 0) return UNDEF
    const v = a[0]
    if (isVector(v) || isString(v)) return num(length(v))
    return UNDEF
  }],
  // Random numbers
  ['rands', (a) => {
    if (a.length < 3) return UNDEF
    const min = toNumber(a[0])
    const max = toNumber(a[1])
    const cnt = Math.abs(Math.floor(toNumber(a[2])))
    let rng: DeterministicRng
    if (a.length >= 4) {
      rng = new DeterministicRng(hashFloatingPoint(toNumber(a[3])))
    } else {
      rng = new DeterministicRng(Date.now())
    }
    const lo = Math.min(min, max)
    const hi = Math.max(min, max)
    const items: Value[] = []
    for (let i = 0; i < cnt; i++) {
      items.push(num(lo + rng.next() * (hi - lo)))
    }
    return vec(items)
  }],
  // Concat
  ['concat', (a) => {
    const items: Value[] = []
    for (const v of a) {
      if (isVector(v)) items.push(...v.items)
      else items.push(v)
    }
    return vec(items)
  }],
  // String functions
  ['str', (a) => str(a.map(toStr).join(''))],
  ['chr', (a) => {
    const chars = a.map((v) => String.fromCharCode(Math.trunc(toNumber(v))))
    return str(chars.join(''))
  }],
  ['ord', (a) => {
    if (a.length === 0 || !isString(a[0]) || a[0].value.length === 0) return UNDEF
    return num(a[0].value.charCodeAt(0))
  }],
  // Type checks
  ['is_undef', (a) => bool(a.length === 0 || isUndef(a[0]))],
  ['is_list', (a) => bool(a.length > 0 && isVector(a[0]))],
  ['is_num', (a) => bool(a.length > 0 && isNumber(a[0]))],
  ['is_string', (a) => bool(a.length > 0 && isString(a[0]))],
  ['is_boolean', (a) => bool(a.length > 0 && isBoolean(a[0]))],
  ['is_function', (a) => bool(a.length > 0 && isFunction(a[0]))],
  // Search
  ['search', (a) => {
    // search(search_value, vector, num_returns_per_match=1, index_col_num=0)
    if (a.length < 2) return vec([])
    const searchVal = a[0]
    const searchVec = a[1]
    if (!isVector(searchVec)) return vec([])
    const results: Value[] = []
    if (isVector(searchVal)) {
      for (const sv of searchVal.items) {
        const indices: Value[] = []
        for (let i = 0; i < searchVec.items.length; i++) {
          if (valueEquals(sv, searchVec.items[i])) {
            indices.push(num(i))
          }
        }
        results.push(vec(indices))
      }
    } else {
      for (let i = 0; i < searchVec.items.length; i++) {
        if (valueEquals(searchVal, searchVec.items[i])) {
          results.push(num(i))
        }
      }
    }
    return results.length === 1 && isVector(searchVal) ? results[0] : vec(results)
  }],
  // Select: select(list, idx1, idx2, ...) or select(list, [idx1, idx2, ...])
  ['select', (a) => {
    if (a.length < 2 || !isVector(a[0])) return UNDEF
    const items = a[0].items
    const indices: number[] = []
    for (let i = 1; i < a.length; i++) {
      const arg = a[i]
      if (isVector(arg)) {
        for (const v of arg.items) indices.push(Math.trunc(toNumber(v)))
      } else {
        indices.push(Math.trunc(toNumber(arg)))
      }
    }
    return vec(indices.map((idx) => {
      const i = idx < 0 ? idx + items.length : idx
      return i >= 0 && i < items.length ? items[i] : UNDEF
    }))
  }],
  // Slice: slice(vector, start, end) - not standard OpenSCAD but some libs use it
  ['slice', (a) => {
    if (a.length < 3 || !isVector(a[0])) return UNDEF
    const items = a[0].items
    const start = Math.trunc(toNumber(a[1]))
    const end = Math.trunc(toNumber(a[2]))
    return vec(items.slice(start, end))
  }],
  // Version
  ['version', () => vec([num(2021), num(1)])],
  ['version_num', () => num(20210100)],
  // Cross product (for 3D vectors)
  ['cross', (a) => {
    if (a.length < 2 || !isVector(a[0]) || !isVector(a[1])) return UNDEF
    const u = a[0].items.map(toNumber)
    const v = a[1].items.map(toNumber)
    if (u.length < 3 || v.length < 3) return UNDEF
    return vec([
      num(u[1] * v[2] - u[2] * v[1]),
      num(u[2] * v[0] - u[0] * v[2]),
      num(u[0] * v[1] - u[1] * v[0]),
    ])
  }],
  // Norm (vector magnitude)
  ['norm', (a) => {
    if (a.length === 0 || !isVector(a[0])) return UNDEF
    const items = a[0].items.map(toNumber)
    return num(Math.sqrt(items.reduce((s, x) => s + x * x, 0)))
  }],
  // List functions
  ['flatten', (a) => {
    if (a.length === 0 || !isVector(a[0])) return UNDEF
    const result: Value[] = []
    for (const v of a[0].items) {
      if (isVector(v)) result.push(...v.items)
      else result.push(v)
    }
    return vec(result)
  }],
  // Hash (for associative arrays via list of [key, value] pairs)
  ['hash', (a) => {
    // hash creates an object-like value from a vector of [key, value] pairs
    if (a.length === 0) return UNDEF
    return a[0]
  }],
  // Boolean functions
  ['alltrue', (a) => {
    if (a.length === 0 || !isVector(a[0])) return bool(false)
    return bool(a[0].items.every((v) => isTrue(v)))
  }],
])
