/**
 * PROBE (permanent, plan §9.1 #5): faijs unit + literal policy.
 *
 * faijs stores dimensioned values in base units (length: mm, angle: degree) and
 * the script face requires explicit units on literals. The emitted `.fai.js`
 * therefore renders `15 * MM`, `45 * DEGREE` — except the radian slots
 * (`cad.revolve.angle`, profile arcs), which are RADIANS. Confusing the two is
 * a silent geometry error, so both the constants and our formatter are pinned
 * here.
 */
import { describe, expect, it } from 'vitest'
import { faijsInstalled, loadFaijs } from '../__probe__/env'
import { unitConstants } from '../__probe__/faijs-static'
import {
  degreeLiteral,
  formatNumber,
  lengthLiteral,
  radianLiteral,
  requiredUnitImports,
} from './units'

const units = unitConstants()

describe('probe: faijs units (static contract)', () => {
  it.skipIf(!faijsInstalled())('faijs exports MM / DEGREE / RADIAN', () => {
    const u = units as Map<string, string>
    for (const name of ['MM', 'DEGREE', 'RADIAN']) expect(u.has(name)).toBe(true)
  })

  it.skipIf(units === null)('base units are mm and degree; RADIAN is the degree conversion', () => {
    const u = units as Map<string, string>
    expect(u.get('MM')).toBe('1')
    expect(u.get('DEGREE')).toBe('1')
    expect(u.get('RADIAN')).toContain('180')
  })
})

describe('emitter literal policy', () => {
  it('renders lengths with MM and angles with DEGREE', () => {
    expect(lengthLiteral(15)).toBe('15 * MM')
    expect(degreeLiteral(45)).toBe('45 * DEGREE')
    expect(radianLiteral(Math.PI)).toBe('3.14159265359 * RADIAN')
  })

  it('normalises -0 and non-finite values deterministically', () => {
    expect(lengthLiteral(-0)).toBe('0 * MM')
    expect(formatNumber(Infinity)).toBe('Infinity')
    expect(formatNumber(-Infinity)).toBe('-Infinity')
    expect(formatNumber(NaN)).toBe('NaN')
  })

  it('never renders trailing float noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(1.5)).toBe('1.5')
    expect(formatNumber(1e-13)).toBe('0')
  })

  it('declares only the units the emitted file actually uses', () => {
    expect(requiredUnitImports({ length: true })).toEqual(['MM'])
    expect(requiredUnitImports({ length: true, degree: true })).toEqual(['MM', 'DEGREE'])
    expect(requiredUnitImports({})).toEqual([])
  })
})

describe('probe: faijs units (runtime, opt-in)', () => {
  it.skipIf(!faijsInstalled())('unit values come from the /units sub-path, not the package root', async () => {
    const loaded = await loadFaijs()
    if (!loaded) return
    // 2026-10-06 fact: the root export has NO MM/DEGREE/RADIAN (480 exports).
    expect(loaded.raw.MM).toBeUndefined()
    expect(loaded.raw.DEGREE).toBeUndefined()
    expect(loaded.units.MM).toBe(1)
    expect(loaded.units.DEGREE).toBe(1)
    expect(loaded.units.RADIAN).toBeCloseTo(180 / Math.PI, 10)
  })
})
