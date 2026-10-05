/**
 * PROBE (permanent): ① TS compat face under a REAL Host assembly — measurements.
 *
 * ⛔ Why this file exists (2026-10-06, errors doc §0/§2): the first round of
 * capability findings was measured by calling the internal `mod.cad` object with
 * NO Host assembled. That produced five findings, three of which were wrong:
 *
 *   retracted: "booleans are unusable"   → actually OK  (union/subtract/intersect)
 *   retracted: "volume() returns NaN"    → actually exact (delta 0.0000%)
 *   retracted: "sphere is 0.22% off"     → actually exact (4188.790204786392)
 *
 * The three assembly requirements, all measured here:
 *   1. `initOcctWasm()`             — boot the kernel.
 *   2. `registerOcctBrepEngine()`   — register the adapter (createRuntime alone is
 *      not enough for a bare ①-face call: `BREP engine API not available`).
 *   3. `configureBackends({ config: { mode, brepEngineId, brepCapabilities },
 *      kernel: { brep: engine.primitives } })` — `brepCapabilities` is REQUIRED;
 *      omitting it yields `E_BREP_UNSUPPORTED ... (brepEngineId=<none>)`.
 *
 * Gate: FAIJS_PROBE_RUNTIME=1 (booting OCCT wasm is too slow for the unit stage).
 * Mirrors tests/probe-faijs-ts-face.mjs — that script is the interactive version,
 * this test is the CI-pinned one. Both must be kept (probe-inventory guard).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { faijsInstalled, faijsRuntimeEnabled } from '../__probe__/env'

const enabled = faijsInstalled() && faijsRuntimeEnabled()

/** The ① face module, loaded lazily so the unit stage never touches wasm. */
type Face = Record<string, (...args: unknown[]) => unknown>
let F: Face
let engineId = ''

/** Is this value a faijs mesh Shape (has positions + indices)? */
function isShapeLike(v: unknown): v is { positions: number[]; indices: number[] } {
  return (
    v !== null &&
    typeof v === 'object' &&
    'positions' in (v as Record<string, unknown>) &&
    'indices' in (v as Record<string, unknown>)
  )
}

beforeAll(async () => {
  if (!enabled) return
  F = (await import('@faicad/faijs')) as unknown as Face
  const { initOcctWasm } = await import('@faicad/faijs/occt-kernel/occtKernel')
  const { registerOcctBrepEngine } = await import('@faicad/faijs/brep/engine/adapters/occt')
  const { getBrepEngine, getActiveBrepEngineId } = await import('@faicad/faijs/brep/engine/registry')
  const { configureBackends, CONTRACT_VERSION } = await import('@faicad/faijs/runtime-state')

  await initOcctWasm()
  await registerOcctBrepEngine()
  const engine = await getBrepEngine()
  engineId = getActiveBrepEngineId() ?? ''

  // NOTE: `brepCapabilities` is the field everyone forgets — runtime.ts:577
  // installs it as a getter reading the live brepChain, so a hand-written
  // configureBackends that omits it silently loses every fused/history capability.
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: {
      mode: 'brep',
      brepEngineId: engineId,
      brepCapabilities: engine.capabilities,
    },
    kernel: { brep: engine.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
    cad: undefined,
  } as never)
}, 180_000)

describe.skipIf(!enabled)('probe: ① TS face — host assembly', () => {
  it('the occt engine is the active BREP engine and declares history ops', () => {
    expect(engineId).toBe('occt')
    expect(typeof F.box).toBe('function')
  })

  it('defineOp products are Shapes, NOT Results (isErr(shape) misleads)', async () => {
    const a = await F.box(10, 10, 10)
    expect(isShapeLike(a)).toBe(true)
    // A Shape carries no `ok` discriminator, yet `isErr` still answers (false, by
    // `ok === false`) — which is exactly how the retracted round mis-read every
    // Shape as a failure. Result only wraps values a LIBRARY AUTHOR returns.
    expect((a as Record<string, unknown>).ok).toBeUndefined()
    expect(typeof (F.isErr as (v: unknown) => unknown)(a)).toBe('boolean')
  })

  it('booleans execute on the assembled host (retracted: "booleans unusable")', async () => {
    const a = (await F.box(10, 10, 10)) as never
    const b = (await F.translate(a, [5, 0, 0])) as never
    const u = await F.union(a, b)
    expect(isShapeLike(u)).toBe(true)
    if (!isShapeLike(u)) return
    // Union of a 10-cube with a 5mm-offset clone spans 15mm in x.
    expect(u.indices.length / 3).toBeGreaterThan(0)
  })

  it('volume(union) matches the exact 1500 mm^3 (retracted: "volume NaN")', async () => {
    const a = (await F.box(10, 10, 10)) as never
    const b = (await F.translate(a, [5, 0, 0])) as never
    const u = (await F.union(a, b)) as never
    const v = (await F.volume(u)) as number
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeCloseTo(1500, 6)
  })

  it('BREP primitives are analytically exact (retracted: "sphere 0.22% off")', async () => {
    const exact = {
      sphere: (4 / 3) * Math.PI * 1000,
      cylinder: Math.PI * 25 * 10,
      box: 1000,
    }
    const made: Record<string, unknown> = {
      sphere: await F.sphere(10),
      cylinder: await F.cylinder(5, 10),
      box: await F.box(10, 10, 10),
    }
    for (const [name, shape] of Object.entries(made)) {
      expect(isShapeLike(shape), name).toBe(true)
      const v = (await F.volume(shape)) as number
      // <= 1e-9 relative — the 0.22% figure belonged to the MESH path.
      expect(Math.abs(v - exact[name as keyof typeof exact]) / exact[name as keyof typeof exact], name)
        .toBeLessThan(1e-9)
    }
  })

  it('convexHull takes POINTS, not shapes (OpenSCAD hull() is a different thing)', async () => {
    const box = (await F.box(10, 10, 10)) as never
    // Measured: `HULL_FAILED: convexHull failed: points.map is not a function`.
    await expect(F.convexHull(box)).rejects.toThrow(/points\.map is not a function|HULL_FAILED/)
  })
})
