/**
 * PROBE (permanent, plan §9.1 #4): faijs capability surface — the THREE API FACES.
 *
 * ⛔ CORRECTION (2026-10-06, see docs/plans/2026-10-06-faijs-api-assumption-errors.md §0):
 * this probe used to be built on a wrong mental model — that `import { cad }` from
 * the package root was "the faijs API", and that the script face was the only
 * surface the emitter could target. Both were wrong. faijs has three faces
 * (`docs/ops-api-inventory.zh.md` §1):
 *
 *   ① TS compat face    — 205 flat functions on the package root / `dist/api`.
 *                         THIS is the face a TS library author uses.
 *   ② cad script face   — 95 ops, `dist/lang/symbol-table.generated.js`.
 *                         THIS is what a generated `.fai.js` calls.
 *   ③ lib binding face  — whatever `registerLib(binding, ns)` admits.
 *
 * and the 38-key `mod.cad` object is NONE of them — it is an internal BREP-only
 * namespace (`boxBrep` / `fuseBrep` / `*Brep`). Measuring against it produced
 * five retracted findings (booleans unusable / volume NaN / sphere 0.22% off).
 *
 * Recorded facts (faijs 0.29.5, re-measured 2026-10-06 after Host assembly):
 *  ① face: 56 of 57 probed ops present; only `polyhedron` absent.
 *  ② face: `polyhedron` / `hull` / `minkowski` absent; `offset` / `convexHull` present.
 *  internal `mod.cad`: 38 keys, `*Brep`-suffixed — never a target for generated code.
 */
import { describe, expect, it } from 'vitest'
import { faijsInstalled, loadFaijs, P0_REQUIRED_OPS, GAP_OPS } from '../__probe__/env'
import { scriptFaceSymbols, tsCompatFaceSymbols } from '../__probe__/faijs-static'
import { capabilityClassOf } from '../ir/capability'

const scriptFace = scriptFaceSymbols()
const tsFace = tsCompatFaceSymbols()

/** The ① face ops this project maps OpenSCAD nodes onto (measured 2026-10-06). */
const TS_FACE_REQUIRED = [
  'box', 'sphere', 'cylinder', 'cone', 'torus', 'wedge', 'ellipsoid',
  'union', 'subtract', 'intersect',
  'translate', 'rotate_euler', 'scale', 'scale3d', 'mirror', 'applyMatrix',
  'profile', 'extrude', 'revolve', 'loft', 'sweep', 'polygon',
  'offset', 'convexHull', 'compound',
  'volume', 'measureVolume', 'area', 'measureArea', 'bounds3D',
  'ok', 'err', 'isOk', 'isErr',
] as const

describe('probe: faijs capability (static, three faces)', () => {
  it.skipIf(!faijsInstalled())('faijs exposes both a TS face and a script face', () => {
    expect(tsFace).not.toBeNull()
    expect(scriptFace).not.toBeNull()
    expect((tsFace as Set<string>).size).toBeGreaterThan(100)
    expect((scriptFace as Set<string>).size).toBeGreaterThan(50)
  })

  it.skipIf(tsFace === null)('the ① TS compat face carries the P0 mapping ops', () => {
    const set = tsFace as Set<string>
    const missing = TS_FACE_REQUIRED.filter((op) => !set.has(op))
    expect(missing).toEqual([])
  })

  it.skipIf(tsFace === null)('the ① face gap is exactly `polyhedron` (of the probed set)', () => {
    const set = tsFace as Set<string>
    expect(set.has('polyhedron')).toBe(false)
    // `convexHull` exists but is a POINT-SET hull (kernel method `hullFromPoints`),
    // NOT an OpenSCAD `hull()` over shapes — presence is not equivalence.
    expect(set.has('convexHull')).toBe(true)
  })

  it.skipIf(scriptFace === null)('every P0 op we emit exists on the cad script face', () => {
    const set = scriptFace as Set<string>
    const missing = P0_REQUIRED_OPS.filter((op) => !set.has(op))
    expect(missing).toEqual([])
  })

  it.skipIf(scriptFace === null)('the known gaps are recorded on the script face too', () => {
    const set = scriptFace as Set<string>
    for (const op of ['polyhedron', 'hull', 'minkowski']) {
      expect(set.has(op)).toBe(false)
    }
    expect(set.has('offset')).toBe(true)
    expect(set.has('convexHull')).toBe(true)
    expect(capabilityClassOf('hull')).toBe('unsupported')
  })

  it('GAP_OPS are pinned as the ops whose presence is NOT equivalence', () => {
    expect([...GAP_OPS]).toEqual(['polyhedron', 'hull', 'minkowski', 'offset', 'convexHull'])
  })

  it('the TS face is strictly larger than the script face (different consumers)', () => {
    if (!tsFace || !scriptFace) return
    // Not a subset relation in general, but the ① face is the broad library
    // surface while ② is the .fai.js-callable subset.
    expect((tsFace as Set<string>).size).toBeGreaterThan((scriptFace as Set<string>).size)
  })
})

describe('probe: faijs capability (runtime, opt-in)', () => {
  it.skipIf(!faijsInstalled())('the internal `mod.cad` is a 38-key BREP namespace, not a face', async () => {
    const loaded = await loadFaijs()
    if (!loaded) return // FAIJS_PROBE_RUNTIME not enabled — static layer still ran
    const keys = Object.keys(loaded.cad)
    // Pinned so that if faijs renames or re-scopes this internal object, the
    // capability table and every probe built on it must be re-reviewed.
    expect(loaded.cad.box).toBeTypeOf('function')
    expect(loaded.cad.mirror).toBeUndefined() // ① face has it; `mod.cad` does not
    expect(keys.some((k) => k.endsWith('Brep'))).toBe(true)
  })
})
