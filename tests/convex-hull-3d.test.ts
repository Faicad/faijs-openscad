/**
 * Unit tests for convexHull3D (the hull behind OpenSCAD's `hull()`).
 *
 * These guard four distinct defects found while chasing the `Basics/hull` and
 * `Old/example006` parity failures — each one silently produced a *wrong* result
 * rather than throwing, so they are easy to reintroduce:
 *
 *  1. Returned face indices must index the array the caller passed.  Deduplication
 *     happens internally, and returning indices into that private copy shifted
 *     every index past the first dropped duplicate, so `hull.ts` built faces from
 *     entirely different points (→ 1109 pts, 151 volume instead of 8568).
 *  2. `faceDist` must normalise by |n|.  With the raw cross product it compares
 *     areas, not distances, so one tolerance meant a different threshold per face
 *     and neighbouring faces disagreed about visibility.
 *  3. The tolerance must scale with the model.  Points come from float32 meshes
 *     whose absolute noise grows with coordinate magnitude (~diag · 2⁻²³); a
 *     hardcoded 1e-6 sits *below* that noise for models in the tens of units.
 *  4. The result must be a closed 2-manifold containing every input point.  Near-
 *     coplanar latitude rings from a tessellated sphere used to tear the visible
 *     patch, cascading to ~170 000 faces instead of ~700.
 */
import { describe, expect, it } from 'vitest'
import { convexHull3D } from '../packages/ext/src/ops/convex-hull-3d'

type Pt = { x: number; y: number; z: number }

// ── helpers ────────────────────────────────────────────────────────────────

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Signed volume via the divergence theorem; positive ⇔ outward winding. */
function signedVolume(pts: Pt[], tris: readonly [number, number, number][]): number {
  let v = 0
  for (const [a, b, c] of tris) {
    const pa = pts[a], pb = pts[b], pc = pts[c]
    v += (pa.x * (pb.y * pc.z - pb.z * pc.y) +
      pa.y * (pb.z * pc.x - pb.x * pc.z) +
      pa.z * (pb.x * pc.y - pb.y * pc.x)) / 6
  }
  return v
}

/** Count edges shared by exactly 1 face (holes) and by 3+ (non-manifold). */
function shellEdges(tris: readonly [number, number, number][]): {
  boundary: number
  nonManifold: number
} {
  const n = tris.length ? Math.max(...tris.flat()) + 1 : 0
  const counts = new Map<number, number>()
  for (const [a, b, c] of tris) {
    for (const [ea, eb] of [[a, b], [b, c], [c, a]] as const) {
      const key = ea < eb ? ea * n + eb : eb * n + ea
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let boundary = 0
  let nonManifold = 0
  for (const c of counts.values()) {
    if (c === 1) boundary++
    else if (c > 2) nonManifold++
  }
  return { boundary, nonManifold }
}

/** How far any input point protrudes past the hull (0 ⇒ hull contains them all). */
function maxProtrusion(pts: Pt[], tris: readonly [number, number, number][]): number {
  const faces = tris.map(([a, b, c]) => {
    const pa = pts[a], pb = pts[b], pc = pts[c]
    const ux = pb.x - pa.x, uy = pb.y - pa.y, uz = pb.z - pa.z
    const vx = pc.x - pa.x, vy = pc.y - pa.y, vz = pc.z - pa.z
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    return { nx, ny, nz, len, d: nx * pa.x + ny * pa.y + nz * pa.z }
  })
  let worst = 0
  for (const p of pts) {
    for (const f of faces) {
      if (f.len === 0) continue
      const dist = (f.nx * p.x + f.ny * p.y + f.nz * p.z - f.d) / f.len
      if (dist > worst) worst = dist
    }
  }
  return worst
}

/** Shared assertions: outward-wound, closed, and enclosing every point. */
function expectValidHull(pts: Pt[], tris: readonly [number, number, number][], scale = 1e-6) {
  const { boundary, nonManifold } = shellEdges(tris)
  expect(boundary, 'holes in shell').toBe(0)
  expect(nonManifold, 'non-manifold edges').toBe(0)
  expect(signedVolume(pts, tris)).toBeGreaterThan(0)
  expect(maxProtrusion(pts, tris)).toBeLessThanOrEqual(scale)
}

function unitCubeCorners(): Pt[] {
  const out: Pt[] = []
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) out.push({ x, y, z })
  return out
}

/** Lat/long gridded sphere — the pathological coplanar-ring input. */
function griddedSphere(rings: number, segs: number, r: number, c: Pt): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= rings; i++) {
    const theta = (i / rings) * Math.PI
    for (let j = 0; j < segs; j++) {
      const phi = (j / segs) * 2 * Math.PI
      out.push({
        x: c.x + r * Math.sin(theta) * Math.cos(phi),
        y: c.y + r * Math.sin(theta) * Math.sin(phi),
        z: c.z + r * Math.cos(theta),
      })
    }
  }
  return out
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('convexHull3D', () => {
  it('hulls a unit cube into exactly 12 triangles of volume 1', () => {
    const pts = unitCubeCorners()
    const tris = convexHull3D(pts)
    expect(tris).toHaveLength(12)
    expect(signedVolume(pts, tris)).toBeCloseTo(1, 10)
    expectValidHull(pts, tris, 1e-9)
  })

  it('ignores points in the interior', () => {
    const rnd = rng(1)
    const pts = [...unitCubeCorners()]
    for (let i = 0; i < 300; i++) {
      pts.push({ x: 0.2 + rnd() * 0.6, y: 0.2 + rnd() * 0.6, z: 0.2 + rnd() * 0.6 })
    }
    const tris = convexHull3D(pts)
    // still the cube: no interior point ever makes it onto the hull
    expect(tris).toHaveLength(12)
    expect(signedVolume(pts, tris)).toBeCloseTo(1, 10)
    expectValidHull(pts, tris, 1e-9)
  })

  it('survives coplanar latitude rings of a tessellated sphere', () => {
    // This input is what used to tear the visible patch apart.
    const pts = griddedSphere(24, 40, 2, { x: 0, y: 0, z: 0 })
    const tris = convexHull3D(pts)
    expectValidHull(pts, tris, 1e-6)
    const trueVol = (4 / 3) * Math.PI * 2 ** 3
    const vol = signedVolume(pts, tris)
    // inscribed polyhedron: must stay below the true sphere, but be close
    expect(vol).toBeLessThan(trueVol * 1.001)
    expect(vol).toBeGreaterThan(trueVol * 0.9)
  })

  it('returns indices into the CALLER array, not its deduplicated copy', () => {
    // Duplicates up front force the internal dedup to drop points; if the
    // returned indices referred to that private copy they would be shifted and
    // the caller would silently assemble faces from unrelated points.
    const first = { x: 0, y: 0, z: 0 }
    const pts: Pt[] = [first, { ...first }, { ...first }, ...unitCubeCorners()]
    const tris = convexHull3D(pts)
    // every index must address a real entry of `pts`
    for (const t of tris) for (const i of t) expect(i).toBeLessThan(pts.length)
    // ...and rebuilding from the caller's array must still be the unit cube
    expect(signedVolume(pts, tris)).toBeCloseTo(1, 10)
    expectValidHull(pts, tris, 1e-9)
  })

  it('scales its tolerance to the model (float32 noise far from the origin)', () => {
    // Same sphere as the gridded test, but centred at 10 000 and quantised to
    // float32 — absolute noise ~6e-4, far above the old hardcoded 1e-6 epsilon.
    const far = { x: 10000, y: 10000, z: 10000 }
    const pts = griddedSphere(20, 36, 1, far).map((p) => ({
      x: Math.fround(p.x),
      y: Math.fround(p.y),
      z: Math.fround(p.z),
    }))
    const tris = convexHull3D(pts)
    expectValidHull(pts, tris, 1e-3)
    const trueVol = (4 / 3) * Math.PI
    const vol = signedVolume(pts, tris)
    expect(vol).toBeLessThan(trueVol * 1.001)
    expect(vol).toBeGreaterThan(trueVol * 0.85)
  })

  it('hulls the composite "toy sailboat" cloud (sphere + thin boxes)', () => {
    // The actual Basics/hull case: a small sphere at the bow plus five long thin
    // boxes, ~1100 points with the two clusters wildly different in density.
    const pts: Pt[] = griddedSphere(20, 34, 1, { x: 0, y: 30, z: 2.5 })
    for (const b of [
      { s: [20, 1, 8], t: { x: 0, y: 10, z: -1 } },
      { s: [1, 1, 8], t: { x: 0, y: 10, z: -5 } },
      { s: [20, 1, 8], t: { x: 0, y: -8, z: -1 } },
      { s: [1, 1, 8], t: { x: 0, y: -8, z: -5 } },
      { s: [16, 1, 4], t: { x: 0, y: -30, z: 1 } },
    ]) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        pts.push({
          x: b.t.x + (sx * b.s[0]) / 2,
          y: b.t.y + (sy * b.s[1]) / 2,
          z: b.t.z + (sz * b.s[2]) / 2,
        })
      }
    }
    const tris = convexHull3D(pts)
    expectValidHull(pts, tris, 1e-6)
    // OpenSCAD's reference hull for this example has volume 8568.7
    const vol = signedVolume(pts, tris)
    expect(vol).toBeGreaterThan(8000)
    expect(vol).toBeLessThan(8800)
  })

  it('is unchanged by input order', () => {
    const pts = griddedSphere(16, 30, 2, { x: 0, y: 0, z: 0 })
    const forward = signedVolume(pts, convexHull3D(pts))
    const reversed = signedVolume([...pts].reverse(), convexHull3D([...pts].reverse()))
    expect(forward).toBeCloseTo(reversed, 6)
  })
})
