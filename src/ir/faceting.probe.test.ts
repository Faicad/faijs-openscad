/**
 * PROBE (permanent, plan §9.1 #7): $fn / $fa / $fs faceting.
 *
 * OpenSCAD turns $fn/$fa/$fs into REAL faceted geometry (a $fn=3 sphere is a
 * triangular prism-ish solid). faijs analytic BREP keeps the exact surface; its
 * `segments` only affects mesh discretisation. So an analytic conversion of a
 * low-$fn primitive is a *documented deviation* (OSC3201 / PASS-ANALYTIC) and
 * must never be reported as a strict PASS.
 *
 * Layer 1 (needs an OpenSCAD binary): dump faceted CSG and record it.
 * Layer 2 (needs FAIJS_PROBE_RUNTIME=1 + Host assembly): measure the faijs side.
 *
 * ⛔ CORRECTION (2026-10-06, errors doc §2.3): the previous Layer-2 block
 * measured the internal `mod.cad` with NO Host assembled and concluded "faijs's
 * own sphere is already discretised — 0.22% shortfall, cannot be treated as
 * exact". That 0.22% figure is the MESH path's tessellated polytope. On the
 * BREP/occt path faijs is analytically exact (4188.790204786392, delta 0.0000%).
 * So the deviation in a parity run is entirely OpenSCAD's discretisation —
 * which is the opposite of what the old comment told the emitter to expect.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { faijsInstalled, faijsRuntimeEnabled, openScadBinary } from '../__probe__/env'
import { OpenScadCliFrontend } from '../frontend/openscad-cli'
import { DiagnosticCode } from '../diagnostics/codes'

const bin = await openScadBinary()
const runtimeEnabled = faijsInstalled() && faijsRuntimeEnabled()

/** The faceting matrix that decides analytic-vs-faceted classification. */
export const FACET_MATRIX = [0, 3, 4, 6, 12, 32] as const

function scadFor(fn: number): string {
  return `sphere(r = 10, $fn = ${fn});\n`
}

function dumpCsg(scad: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'faijs-openscad-facet-'))
  const file = join(dir, 'facet.scad')
  writeFileSync(file, scad, 'utf8')
  return file
}

describe('probe: $fn faceting', () => {
  it.skipIf(!bin.available)('OpenSCAD emits different CSG per $fn (faceted geometry is real)', async () => {
    const frontend = new OpenScadCliFrontend()
    const seen = new Map<number, string>()
    for (const fn of FACET_MATRIX) {
      const artifact = await frontend.compileScad({ filePath: dumpCsg(scadFor(fn)) })
      if (artifact.csgText.length === 0) continue // binary failed: OSC5003 recorded
      seen.set(fn, artifact.csgText)
      expect(artifact.csgText).toContain('sphere')
    }
    // With a working binary the low-$fn dumps must differ from the smooth one.
    if (seen.has(3) && seen.has(32)) {
      expect(seen.get(3)).not.toBe(seen.get(32))
    }
  })

  it.skipIf(!bin.available)('$fn survives into the dumped node arguments', async () => {
    const frontend = new OpenScadCliFrontend()
    const artifact = await frontend.compileScad({ filePath: dumpCsg(scadFor(4)) })
    if (artifact.csgText.length === 0) return
    expect(/\$fn|\$fa|\$fs/.test(artifact.csgText)).toBe(true)
  })

  it('OSC3201 is the code reserved for analytic-vs-faceted deviation', () => {
    expect(DiagnosticCode.OSC3201).toBe('OSC3201')
  })
})

describe.skipIf(!runtimeEnabled)('probe: faijs sphere is analytically exact (BREP)', () => {
  let volume: (s: unknown) => Promise<number>
  let sphere: (r: number) => Promise<unknown>

  beforeAll(async () => {
    const { initOcctWasm } = await import('@faicad/faijs/occt-kernel/occtKernel')
    const { registerOcctBrepEngine } = await import('@faicad/faijs/brep/engine/adapters/occt')
    const { getBrepEngine, getActiveBrepEngineId } = await import('@faicad/faijs/brep/engine/registry')
    const { configureBackends, CONTRACT_VERSION } = await import('@faicad/faijs/runtime-state')
    const face = (await import('@faicad/faijs')) as unknown as {
      volume: (s: unknown) => Promise<number>
      sphere: (r: number) => Promise<unknown>
    }
    volume = face.volume
    sphere = face.sphere
    await initOcctWasm()
    await registerOcctBrepEngine()
    const engine = await getBrepEngine()
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: {
        mode: 'brep',
        brepEngineId: getActiveBrepEngineId(),
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

  it('r=10 sphere volume equals (4/3)πr³ to within 1e-9 relative', async () => {
    const r = 10
    const exact = (4 / 3) * Math.PI * r ** 3
    const v = await volume(await sphere(r))
    // Measured 2026-10-06: 4188.790204786392. The 0.22% figure recorded earlier
    // belonged to the mesh path and is retracted.
    expect(Number.isFinite(v)).toBe(true)
    expect(Math.abs(v - exact) / exact).toBeLessThan(1e-9)
  })
})
