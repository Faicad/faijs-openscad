/**
 * Regression tests for the rounded-cube fast path of `hull()`.
 *
 * `hull()` recognises the canonical OpenSCAD idiom
 *
 *     hull() { translate([±r, ±r, ±r]) sphere(r); … }   // 8 corner spheres
 *
 * and builds it as a real BREP fillet instead of a point-sampled convex hull.
 * The derived geometry must be *exact*: the box corners land on
 * `sphereCentre ± radius`, so the fillet faces sit exactly on the sphere
 * surfaces.  Old/example006 (a die: that rounded cube minus 21 spheres) shows
 * why — when the cube misses the cutting spheres by even ~1e-6, OCCT's boolean
 * silently produces a broken solid (47 faces, a ±60 bounding box, volume off by
 * 40 000) instead of the die.
 *
 * Two distinct defects are guarded here:
 *
 *  1. The sphere *centre* must come from the geometry-based bounding box
 *     (`getBoundingBox(s, false)`).  A runtime sphere carries a tessellation
 *     whose bbox is inflated by the face tolerance — measured on a sphere at
 *     (10,10,10) r=10: `getBoundingBox(s, true)` = x[-0.0756, 20.0989], i.e. a
 *     centre 0.0117 off in x, versus the exact [0,20]^3 for `false`.  Using the
 *     inflated box shifted the whole rounded cube and inflated the fillet
 *     radius to 10.0117.
 *  2. The sphere *radius* must not be the float32 sample maximum.  The mesh
 *     positions are float32, which biases the maximum distance upward by ~1e-6
 *     (measured: 10.0000011 for a r=10 sphere).  Because the box corners are
 *     `centre ± radius`, that bias shifts every face of the cube off the exact
 *     sphere surface — enough to break the downstream boolean.
 */
import { describe, expect, it } from 'vitest'
import { getExtKernel } from '../packages/ext/src/kernel'
import { hull } from '../packages/ext/src/ops/hull'

const R = 10
const C = 40 // corner sphere centres at ±40 → rounded cube [-50, 50]^3

/** Analytic volume of an a×a×a box with every edge filleted at radius r. */
function filletedBoxVolume(a: number, r: number): number {
  const inner = a - 2 * r
  return (
    inner ** 3 +
    6 * inner ** 2 * r +
    12 * (Math.PI * r * r * 0.25) * inner +
    8 * (4 * Math.PI * r ** 3) / 3 / 8
  )
}

async function kernelAndSpheres(withTriangulation: boolean) {
  const k = await getExtKernel()
  const spheres = []
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const s = k.translate(k.makeSphere(R), sx * C, sy * C, sz * C)
        // Attaching a tessellation is what makes getBoundingBox(s, true)
        // inflate — this reproduces the runtime's sphere construction without
        // pulling the whole faijs runtime into a unit test.
        if (withTriangulation) k.tessellate(s, { angularDeflection: 0.209, linearDeflection: 2 })
        spheres.push(s)
      }
    }
  }
  return { k, spheres }
}

describe('hull() rounded-cube idiom', () => {
  it('derives exact geometry (centres and fillet radius) from the BREP bbox', async () => {
    const { k, spheres } = await kernelAndSpheres(true)
    const solid = await hull(spheres)

    const bb = k.getBoundingBox(solid, false)
    // Faces must sit exactly on the sphere surfaces: ±(C + R).
    for (const [lo, hi] of [
      [bb.xmin, bb.xmax],
      [bb.ymin, bb.ymax],
      [bb.zmin, bb.zmax],
    ] as const) {
      expect(lo).toBeCloseTo(-(C + R), 9)
      expect(hi).toBeCloseTo(C + R, 9)
    }

    // Volume must match the analytic filleted box, not a tolerance-inflated one.
    const analytic = filletedBoxVolume(2 * (C + R), R)
    expect(Math.abs(k.getVolume(solid) - analytic) / analytic).toBeLessThan(1e-6)
  })

  it('is robust when the shapes carry no triangulation', async () => {
    const { k, spheres } = await kernelAndSpheres(false)
    const solid = await hull(spheres)
    const bb = k.getBoundingBox(solid, false)
    expect(bb.xmin).toBeCloseTo(-(C + R), 9)
    expect(bb.xmax).toBeCloseTo(C + R, 9)
    const analytic = filletedBoxVolume(2 * (C + R), R)
    expect(Math.abs(k.getVolume(solid) - analytic) / analytic).toBeLessThan(1e-6)
  })

  it('still falls back to the point hull for a non-idiom input', async () => {
    const { k } = await kernelAndSpheres(false)
    // A single sphere is not the 8-corner idiom — the general path must run.
    const solid = await hull([k.translate(k.makeSphere(R), 0, 0, 0)])
    expect(k.getVolume(solid)).toBeGreaterThan(0)
  })
})
