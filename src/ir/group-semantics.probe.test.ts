/**
 * PROBE (permanent, plan §9.1 #6): group / root semantics.
 *
 * OpenSCAD's `group() { a; b; }` at the root is an implicit union. faijs 0.29.5
 * also exposes `compound`, which keeps overlapping solids as separate components
 * instead of merging them — a *different* volume. The plan forbids guessing:
 * root/group maps to union until an overlap probe proves otherwise.
 *
 * ⛔ CORRECTION (2026-10-06, errors doc §0/§2.1): the previous runtime block
 * measured the internal `mod.cad` with NO Host assembled and recorded
 * "booleans throw Not manifold / no BREP engine registered". Those were
 * assembly defects, not faijs facts. Under a real assembly
 * (`initOcctWasm` + `registerOcctBrepEngine` + `configureBackends`) union works
 * and is exact — the geometric half of this probe now runs through
 * `runtime.execute` (the ② face), which assembles the brepChain for us.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { faijsInstalled, faijsRuntimeEnabled } from '../__probe__/env'
import { scriptFaceSymbols } from '../__probe__/faijs-static'
import { capabilityOf } from '../ir/capability'

const symbols = scriptFaceSymbols()
const runtimeEnabled = faijsInstalled() && faijsRuntimeEnabled()

describe('probe: group semantics (static)', () => {
  it.skipIf(symbols === null)('cad.compound exists — and is deliberately NOT used for group()', () => {
    expect((symbols as Set<string>).has('compound')).toBe(true)
    const group = capabilityOf('group')
    expect(group.capability).toBe('direct')
    expect(group.note).toContain('implicit union')
  })

  it('the group mapping carries the probe reference in its note', () => {
    expect(capabilityOf('group').note).toContain('group-semantics probe')
  })
})

describe.skipIf(!runtimeEnabled)('probe: group semantics (runtime, assembled host)', () => {
  let execute: (code: string) => Promise<{ failedAt?: { message: string }; outputs: Map<string, unknown> }>
  let volume: (s: unknown) => Promise<number>

  beforeAll(async () => {
    const { createRuntime, createNodePorts, initOcctWasm } = await import('@faicad/faijs/node')
    const face = (await import('@faicad/faijs')) as unknown as { volume: (s: unknown) => Promise<number> }
    volume = face.volume
    await initOcctWasm()
    const rt = createRuntime(createNodePorts(), 'brep')
    execute = async (code) => {
      const r = await rt.execute(code, { topology: 'auto' })
      return r as unknown as { failedAt?: { message: string }; outputs: Map<string, unknown> }
    }
  }, 180_000)

  it('union merges two overlapping 20mm cubes to exactly 12000 mm^3', async () => {
    // 20x20x20 with a 10mm x-offset clone spans 30mm in x → 20*20*30 = 12000.
    // Note: measure the RESULT SHAPE through the ① face — the script face's
    // `cad.volume(x)` registers a product rather than yielding a number.
    const r = await execute(`
      let a = cad.box(20, 20, 20)
      let b = cad.translate(a, [10, 0, 0])
      let merged = cad.union(a, b)
    `)
    expect(r.failedAt?.message).toBeUndefined()
    const merged = r.outputs.get('merged')
    expect(merged).toBeDefined()
    expect(await volume(merged)).toBeCloseTo(12000, 6)
  })

  it('a shape unioned with itself keeps its volume (no double-count)', async () => {
    const r = await execute(`
      let a = cad.box(20, 20, 20)
      let merged = cad.union(a, a)
    `)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await volume(r.outputs.get('merged'))).toBeCloseTo(8000, 6)
  })
})
