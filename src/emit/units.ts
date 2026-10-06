/**
 * Unit + literal policy for the emitter (plan §4.4, §5.5).
 *
 * faijs stores every dimensioned value in a base unit (mm / degree) and the
 * script face requires literals to carry the unit explicitly (`10 * MM`,
 * `45 * DEGREE`). There is exactly ONE place allowed to decide how a number is
 * rendered — this module — so a future unit-contract change is a one-line fix
 * instead of a scattered one.
 *
 * Angle slots need care, and the two of them behave differently:
 *
 *  - `cad.revolve`'s `angle` is RADIANS in the API (faijs 0.29.5,
 *    packages/core/src/api/revolve.ts) while faijs's base unit is DEGREE, so a
 *    radian value there must be rendered with `radianLiteral()`
 *    (`RADIAN === 57.29577951308232` is exactly that conversion factor).
 *    See rotate-extrude.probe.test.ts.
 *  - profile arc angles are also radians, but the slot takes the **raw radian
 *    number** — `radianLiteral()` there would multiply by 57.2958 and turn π
 *    into 180. `emit/faijs-2d-profile.probe.test.ts` pins the literal form
 *    (`startAngle: 3.141592653589793`, no unit suffix).
 *
 * Why literals and never expressions: the emitter must not emit `Math.PI` or any
 * arithmetic into an op argument. `Math` IS a sanctioned global on the script
 * face (S4_SAFE_GLOBALS) and both exec backends evaluate it — but the pre-exec
 * static checker (metadata-extractor.collectExprIdentifiers) does not list S4 in
 * its identifier whitelist, so a bare `Math` inside an op argument is rejected
 * with E_REFERENCE before execution. Precomputing here sidesteps that entirely.
 * Full layered evidence: emit/faijs-script-globals.probe.test.ts.
 */

/** Default significant formatting: deterministic, no exponent, no trailing junk. */
export const DEFAULT_FLOAT_PRECISION = 12

/** formatNumber(1) === '1', not '1.0' — keeps emitted code idiomatic. */
export function formatNumber(value: number, precision = DEFAULT_FLOAT_PRECISION): string {
  if (!Number.isFinite(value)) {
    if (value === Infinity) return 'Infinity'
    if (value === -Infinity) return '-Infinity'
    return 'NaN'
  }
  // -0 must render as 0: `-0 * MM` is legal but noisy, and differs from OpenSCAD.
  if (value === 0) return '0'
  const rounded = Number(value.toFixed(precision))
  if (rounded === 0) return '0'
  const s = String(rounded)
  return s
}

/**
 * 精确往返的数值字面量：不做定点舍入，直接取该 double 的最短往返表示。
 *
 * 只用于 emitter **自己算出**的常量（如整圆拆成两段弧的 π / 2π）。这类值没有
 * 十进制噪声，`formatNumber` 的 12 位定点舍入反而会把它们改写成另一个数
 * （π → 3.14159265359）。来自 CSG 文本的数值走 `formatNumber`，那里需要舍入。
 */
export function exactNumber(value: number): string {
  if (!Number.isFinite(value)) return formatNumber(value)
  return Object.is(value, -0) ? '0' : String(value)
}

/** Length literal in millimetres, e.g. `15 * MM`. */
export function lengthLiteral(mm: number, precision = DEFAULT_FLOAT_PRECISION): string {
  return `${formatNumber(mm, precision)} * MM`
}

/** Angle literal in degrees, e.g. `45 * DEGREE`. */
export function degreeLiteral(deg: number, precision = DEFAULT_FLOAT_PRECISION): string {
  return `${formatNumber(deg, precision)} * DEGREE`
}

/** Angle literal in radians — only for the radian slots (revolve / profile arc). */
export function radianLiteral(rad: number, precision = DEFAULT_FLOAT_PRECISION): string {
  return `${formatNumber(rad, precision)} * RADIAN`
}

/** The units the generated header must import from faijs. */
export function requiredUnitImports(used: {
  length?: boolean
  degree?: boolean
  radian?: boolean
}): string[] {
  const out: string[] = []
  if (used.length) out.push('MM')
  if (used.degree) out.push('DEGREE')
  if (used.radian) out.push('RADIAN')
  return out
}
