/**
 * Faceted primitive topology tests (regression for 2026-10-18 example005 bug).
 *
 * The degenerate-cone branches of `oscCylinderGeometry` used to reference an
 * apex vertex that was never pushed into the `vertices` array, so EVERY side
 * face index pointed past the end of the array. `polyhedron` silently dropped
 * those faces (`pts[idx] === undefined`), leaving only the bottom cap — an
 * open, invalid shell that made `cad.boolean(fuse)` return an EMPTY shape,
 * which is why `Old/example005` rendered as 0 triangles / volume 0.
 *
 * These invariants are what caught it and what keeps it dead:
 *  1. every face index is in range (no silently-dropped faces);
 *  2. the mesh is a closed, oriented 2-manifold (each directed edge once);
 *  3. the signed volume matches the analytic inscribed-polygon volume.
 */
import { describe, expect, it } from 'vitest'
import { oscCylinderGeometry, oscSphereGeometry } from '../../packages/ext/src/ops/faceted-primitives'

type V3 = readonly [number, number, number]
interface Geom {
  readonly vertices: ReadonlyArray<V3>
  readonly faces: ReadonlyArray<ReadonlyArray<number>>
}

/** Signed volume via divergence theorem over fan-triangulated faces. */
function signedVolume(g: Geom): number {
  let v = 0
  for (const f of g.faces) {
    for (let i = 1; i < f.length - 1; i++) {
      const a = g.vertices[f[0]]!
      const b = g.vertices[f[i]]!
      const c = g.vertices[f[i + 1]]!
      v += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
  }
  return v
}

/**
 * Assert the mesh is a closed oriented 2-manifold: every face index in range,
 * and every directed edge used exactly once (so each edge has exactly one
 * opposite twin → watertight shell).
 */
function expectClosedManifold(g: Geom, label: string): void {
  const n = g.vertices.length
  const directed = new Map<string, number>()
  for (const f of g.faces) {
    for (const idx of f) {
      expect(idx, `${label}: face index out of range`).toBeGreaterThanOrEqual(0)
      expect(idx, `${label}: face index ${idx} >= vertexCount ${n}`).toBeLessThan(n)
    }
    for (let i = 0; i < f.length; i++) {
      const key = `${f[i]}->${f[(i + 1) % f.length]}`
      directed.set(key, (directed.get(key) ?? 0) + 1)
    }
  }
  for (const [key, count] of directed) {
    expect(count, `${label}: directed edge ${key} used ${count}× (must be 1)`).toBe(1)
  }
  // Every directed edge must have exactly one opposite twin.
  for (const key of directed.keys()) {
    const [a, b] = key.split('->')
    expect(directed.has(`${b}->${a}`), `${label}: edge ${key} has no twin (open surface)`).toBe(true)
  }
}

/** Area of a regular n-gon inscribed in a circle of radius r (OpenSCAD's facet base). */
function inscribedNGonArea(n: number, r: number): number {
  return (n / 2) * r * r * Math.sin((2 * Math.PI) / n)
}

describe('oscCylinderGeometry (cylinder / cone / frustum topology)', () => {
  const N = 30

  it('cylinder (rBottom = rTop) is a closed manifold with the prismatic volume', () => {
    const g = oscCylinderGeometry(10, 10, 20, N, false)
    expectClosedManifold(g, 'cylinder')
    expect(g.faces.length).toBe(4 * N) // 侧壁 N 个四边形→2N 三角 + 两个 N 三角封盖
    const expected = inscribedNGonArea(N, 10) * 20
    expect(signedVolume(g)).toBeCloseTo(expected, 6)
  })

  it('cone with radiusTop = 0 keeps its apex AND its lateral surface', () => {
    const g = oscCylinderGeometry(120, 0, 80, N, false)
    expectClosedManifold(g, 'cone r->0')
    expect(g.faces.length).toBe(N * 2) // N lateral triangles + N base cap triangles
    const expected = (inscribedNGonArea(N, 120) * 80) / 3
    expect(signedVolume(g)).toBeCloseTo(expected, 6)
  })

  it('cone with radiusBottom = 0 keeps its apex AND its lateral surface', () => {
    const g = oscCylinderGeometry(0, 120, 80, N, false)
    expectClosedManifold(g, 'cone 0->r')
    expect(g.faces.length).toBe(N * 2)
    const expected = (inscribedNGonArea(N, 120) * 80) / 3
    expect(signedVolume(g)).toBeCloseTo(expected, 6)
  })

  it('frustum volume is the conic-mean formula of the two bases', () => {
    const rb = 12
    const rt = 6
    const h = 9
    const g = oscCylinderGeometry(rb, rt, h, N, false)
    expectClosedManifold(g, 'frustum')
    const expected = (h / 3) * (inscribedNGonArea(N, rb) + Math.sqrt(inscribedNGonArea(N, rb) * inscribedNGonArea(N, rt)) + inscribedNGonArea(N, rt))
    expect(signedVolume(g)).toBeCloseTo(expected, 6)
  })

  it('centered variants keep their z-extent symmetric', () => {
    const g = oscCylinderGeometry(5, 0, 20, 8, true)
    expectClosedManifold(g, 'centered cone')
    const zs = g.vertices.map((v) => v[2])
    expect(Math.min(...zs)).toBeCloseTo(-10, 12)
    expect(Math.max(...zs)).toBeCloseTo(10, 12)
    expect(signedVolume(g)).toBeGreaterThan(0)
  })

  it('fully degenerate cone (both radii 0) yields empty geometry, not phantom faces', () => {
    const g = oscCylinderGeometry(0, 0, 10, N, false)
    expect(g.faces.length).toBe(0)
    expect(g.vertices.length).toBe(0)
  })
})

describe('oscSphereGeometry (OpenSCAD flat-cap topology)', () => {
  it('is a closed manifold and stops short of ±r by the flat-cap amount', () => {
    const N = 30
    const r = 10
    const g = oscSphereGeometry(r, N)
    expectClosedManifold(g, 'sphere')
    const maxZ = Math.max(...g.vertices.map((v) => v[2]))
    expect(maxZ).toBeCloseTo(r * Math.cos(Math.PI / N), 12)
    // Inscribed n-gon based sphere must be a hair under the true ball volume.
    const vol = signedVolume(g)
    expect(vol).toBeGreaterThan(0)
    expect(vol).toBeLessThan((4 / 3) * Math.PI * r * r * r)
    expect(vol / ((4 / 3) * Math.PI * r * r * r)).toBeGreaterThan(0.98)
  })
})
