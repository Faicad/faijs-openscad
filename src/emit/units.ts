/**
 * Unit + literal policy for the emitter (plan §4.4, §5.5).
 *
 * faijs stores every dimensioned value in a base unit (mm / degree) and the
 * script face requires literals to carry the unit explicitly (`10 * MM`,
 * `45 * DEGREE`). There is exactly ONE place allowed to decide how a number is
 * rendered — this module — so a future unit-contract change is a one-line fix
 * instead of a scattered one.
 *
 * Known exception: `cad.revolve`'s `angle` and profile arc angles are RADIANS
 * (faijs 0.29.5, packages/core/src/api/revolve.ts). Those call sites must use
 * `radianLiteral()` explicitly; see rotate-extrude.probe.test.ts.
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
