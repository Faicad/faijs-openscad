/**
 * STL import → solid reconstruction tests.
 *
 * Regression for two layered root causes found on 2026-10-17 (example012/016
 * `subtract: kernel cut failed`):
 *
 * 1. **GOTCHA(compound)**: bare `kernel.importStl()` returns a *compound of
 *    faces* — 64 unshared faces for example012.stl, no shell and no solid.
 *    `isValid()` is `true`, so nothing looks wrong, but using it as a boolean
 *    tool fails outright with `cut: boolean operation failed`. The load op must
 *    run the mesh→BREP reconstruction pipeline (sew + solidify) instead.
 *
 * 2. **GOTCHA(multi-shell)**: example016.stl legitimately holds **two disjoint
 *    closed blocks** (derived from Basics/LetterBlock.scad). `sewAndSolidify()`
 *    returns a *compound of shells* for that input — `isSolid()` false and
 *    `getSubShapes('solid')` empty — which also breaks boolean ops. Each shell
 *    must be turned into a solid (`makeSolid`) and fused.
 *
 * Both are pinned here through the ext `load` op, plus an end-to-end boolean
 * cut so a regression that silently returns a face compound cannot pass.
 */
import { describe, expect, it } from 'vitest'
import { initOcctWasm } from '@faicad/faijs/occt-kernel/occtKernel'
import { load, setLoadBaseDir } from '../../packages/ext/src/ops/load'
import { getExtKernel } from '../../packages/ext/src/kernel'

const STL_DIR = 'tests/fixtures/openscad-examples/Old'

describe('openscad.load — STL must yield boolean-ready solids', () => {
  it('example012.stl loads as a single closed solid', async () => {
    const k = await getExtKernel()
    setLoadBaseDir(STL_DIR)
    const shape = await load({ file: 'example012.stl' })

    expect(k.getShapeType(shape)).toBe('solid')
    expect(k.subShapeCount(shape, 'solid')).toBe(1)
    // 34 unique verts / 64 triangles — volume is exact for this mesh.
    expect(k.queryBatch([shape])[0].volume).toBeCloseTo(11547.668, 2)
  })

  it('example016.stl (two disjoint blocks) loads as two solids', async () => {
    const k = await getExtKernel()
    setLoadBaseDir(STL_DIR)
    const shape = await load({ file: 'example016.stl' })

    // A compound of two solids is legitimate here — the file really has two
    // disjoint blocks. What matters is that solids (not shells/faces) exist.
    expect(k.subShapeCount(shape, 'solid')).toBe(2)
    expect(k.queryBatch([shape])[0].volume).toBeCloseTo(23029.012, 2)
  })

  it('GOTCHA(compound): a raw importStl face compound cannot be cut, a reconstructed solid can', async () => {
    const k = await getExtKernel()
    const { readFileSync } = await import('node:fs')
    const data = readFileSync(`${STL_DIR}/example012.stl`)
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)

    // Baseline: the naive path still produces a face compound (documents *why*
    // the load op cannot just call importStl).
    const raw = k.importStl(ab)
    expect(k.subShapeCount(raw, 'solid')).toBe(0)
    expect(k.subShapeCount(raw, 'face')).toBe(64)

    const sphere = k.makeSphere(20)
    expect(() => k.cut(sphere, raw)).toThrow()

    // Fixed path: load op output cuts cleanly.
    setLoadBaseDir(STL_DIR)
    const solid = await load({ file: 'example012.stl' })
    const cut = k.cut(sphere, solid)
    expect(k.queryBatch([cut])[0].volume).toBeCloseTo(23541.156, 2)
  })

  it('GOTCHA(multi-shell): both blocks of example016.stl participate in the cut', async () => {
    const k = await getExtKernel()
    setLoadBaseDir(STL_DIR)
    const tool = await load({ file: 'example016.stl' })

    // blk2: box(60,28,14) @ z=7.5 minus box(8,32,32)
    const moved = k.transform(k.makeBox(60, 28, 14, true), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 7.5])
    const blk2 = k.cut(moved, k.makeBox(8, 32, 32, true))
    const blk2Vol = k.queryBatch([blk2])[0].volume

    const chopped = k.cut(blk2, k.transform(tool, [1, 0, 0, -18, 0, 1, 0, 0, 0, 0, 1, 0]))
    const choppedVol = k.queryBatch([chopped])[0].volume

    // Material must actually be removed — a single-shell fallback would leave
    // the volume untouched (only one of the two blocks overlaps blk2).
    expect(choppedVol).toBeLessThan(blk2Vol)
    expect(choppedVol).toBeCloseTo(18582.282, 2)
  })
})

// Keep the OCCT wasm warm across the file's tests (init is global/singleton).
describe('occt wasm', () => {
  it('initialises', async () => {
    await expect(initOcctWasm()).resolves.toBeDefined()
  })
})
