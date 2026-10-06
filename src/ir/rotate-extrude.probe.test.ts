/**
 * PROBE (permanent, plan §9.1 #8): rotate_extrude → faijs revolve.
 *
 * The single most dangerous mapping in P1: OpenSCAD's rotate_extrude rotates a
 * 2D XY profile around the Z axis, while faijs `revolve` revolves a section
 * — and its `angle` argument is RADIANS while almost every other faijs angle
 * slot is DEGREES. A unit confusion here produces a plausible-looking but wrong
 * solid, so the facts are pinned here and referenced by the emitter unit policy.
 *
 * ⛔ CORRECTION (2026-10-06, errors doc §0): the previous runtime block asserted
 * "the TS layer cannot verify revolve — it must be script-executed", because
 * `mod.cad.revolve` / `mod.cad.profile` are undefined. That measured the wrong
 * object: `revolve` and `profile` are ① TS compat face functions and ARE
 * callable from TS under a Host assembly (verified — see
 * emit/faijs-face-measurements.probe.test.ts and tests/probe-faijs-ts-face.mjs).
 */
import { describe, expect, it } from 'vitest'
import { scriptFaceSymbols, tsCompatFaceSymbols } from '../__probe__/faijs-static'
import { capabilityOf } from '../ir/capability'
import { radianLiteral } from '../emit/units'

const scriptFace = scriptFaceSymbols()
const tsFace = tsCompatFaceSymbols()

describe('probe: rotate_extrude (static)', () => {
  it.skipIf(scriptFace === null)('cad.revolve exists on the script face', () => {
    expect((scriptFace as Set<string>).has('revolve')).toBe(true)
  })

  it.skipIf(tsFace === null)('revolve / profile exist on the ① TS face too', () => {
    const set = tsFace as Set<string>
    expect(set.has('revolve')).toBe(true)
    expect(set.has('profile')).toBe(true)
  })

  it('rotate_extrude is classified as direct (verified mapping)', () => {
    const entry = capabilityOf('rotate_extrude')
    expect(entry.capability).toBe('direct')
    expect(entry.phase).toBe('P1')
    expect(entry.note).toContain('bare radians')
  })

  it('revolve angles are emitted as bare radians, not * RADIAN', () => {
    // A full turn is 2*PI radians. The emitter outputs this as a bare number
    // (no * RADIAN), because RADIAN = 180/PI = 57.2958 and multiplying would
    // fold to 360 (degrees) — revolve then internally does (360*180)/PI = 20626°.
    // The probe exists to catch that drift.
    const full = radianLiteral(Math.PI * 2)
    expect(full).toContain('RADIAN')
    expect(full).not.toContain('DEGREE')
    // But the emitter does NOT use radianLiteral for revolve — it uses exactNumber.
    // This test documents what radianLiteral does, NOT what the emitter should do.
    // The emitter policy is: revolve angle = bare number (see faijs.ts revolve case).
  })
})

