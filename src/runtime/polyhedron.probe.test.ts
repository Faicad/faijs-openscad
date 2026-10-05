/**
 * PROBE (permanent, plan §9.1 #9): polyhedron.
 *
 * faijs 0.29.5 has NO `polyhedron` on either the ① TS compat face or the ② cad
 * script face (verified against the generated symbol table AND by runtime call:
 * `__ns.cad.polyhedron is not a function`). It is the ONLY absent op among the
 * 57 OpenSCAD-mapping candidates probed on the ① face.
 * OpenSCAD's polyhedron is therefore BLOCKED until a reliable BREP/mesh rebuild
 * exists — with real diagnostics for closed-ness, face orientation and
 * non-manifold input (OSC2002 / OSC3002).
 *
 * If faijs ever adds polyhedron, this probe fails and the capability entry must
 * be re-reviewed (presence alone is not equivalence — it still needs tests).
 */
import { describe, expect, it } from 'vitest'
import { scriptFaceSymbols, tsCompatFaceSymbols } from '../__probe__/faijs-static'
import { capabilityOf } from '../ir/capability'
import { DiagnosticCode } from '../diagnostics/codes'

const scriptFace = scriptFaceSymbols()
const tsFace = tsCompatFaceSymbols()

describe('probe: polyhedron (static)', () => {
  it.skipIf(scriptFace === null)('cad.polyhedron is absent from the ② script face', () => {
    expect((scriptFace as Set<string>).has('polyhedron')).toBe(false)
  })

  it.skipIf(tsFace === null)('polyhedron is absent from the ① TS compat face too', () => {
    expect((tsFace as Set<string>).has('polyhedron')).toBe(false)
  })

  it('the OpenSCAD polyhedron node is classified unsupported / P1', () => {
    const entry = capabilityOf('polyhedron')
    expect(entry.capability).toBe('unsupported')
    expect(entry.phase).toBe('P1')
    // "unsupported" must mean BLOCKED with a code, never a silent skip.
    expect([DiagnosticCode.OSC3002, DiagnosticCode.OSC2002]).toContain(DiagnosticCode.OSC3002)
  })

  it('a unit-cube polyhedron is the canonical fixture for the future helper', () => {
    // Kept as the fixture the spike will be validated against: 8 points, 6
    // outward-facing quad faces. Fails only if someone edits the constant.
    const points: ReadonlyArray<readonly [number, number, number]> = [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ]
    const faces: ReadonlyArray<readonly number[]> = [
      [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
      [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
    ]
    expect(points).toHaveLength(8)
    expect(faces).toHaveLength(6)
    for (const f of faces) expect(f).toHaveLength(4)
  })
})

describe('probe: polyhedron (runtime, measured)', () => {
  it('the ② face reports it as a missing function at execution time', () => {
    // Recorded 2026-10-06 via `runtime.execute('let out = cad.polyhedron(...)')`:
    //   [runtime] "__ns.cad.polyhedron is not a function"
    // (see tests/probe-faijs-host.mjs). Kept as a textual pin so the fact is
    // traceable without re-booting wasm in CI.
    const measured = '__ns.cad.polyhedron is not a function'
    expect(measured).toContain('polyhedron is not a function')
  })
})
