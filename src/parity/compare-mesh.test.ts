/**
 * Tests for mesh comparison (M4, T402).
 *
 * Validates that the comparison correctly identifies:
 *  - identical meshes as PASS
 *  - translated meshes as FAIL (different bbox/centroid)
 *  - scaled meshes as FAIL (different volume)
 *  - differently subdivided meshes (same shape, different triangulation)
 */
import { describe, expect, it } from 'vitest'
import { computeMetrics, type StlTriangle } from './stl-metrics'
import { compareMetrics, compareSurfaces } from './compare-mesh'

// Unit cube (12 triangles, volume=1, area=6)
const unitCube: StlTriangle[] = [
  { v0: [0, 0, 0], v1: [1, 0, 0], v2: [1, 1, 0] },
  { v0: [0, 0, 0], v1: [1, 1, 0], v2: [0, 1, 0] },
  { v0: [0, 0, 1], v1: [1, 1, 1], v2: [1, 0, 1] },
  { v0: [0, 0, 1], v1: [0, 1, 1], v2: [1, 1, 1] },
  { v0: [0, 0, 0], v1: [0, 0, 1], v2: [1, 0, 1] },
  { v0: [0, 0, 0], v1: [1, 0, 1], v2: [1, 0, 0] },
  { v0: [0, 1, 0], v1: [1, 1, 1], v2: [0, 1, 1] },
  { v0: [0, 1, 0], v1: [1, 1, 0], v2: [1, 1, 1] },
  { v0: [0, 0, 0], v1: [0, 1, 0], v2: [0, 1, 1] },
  { v0: [0, 0, 0], v1: [0, 1, 1], v2: [0, 0, 1] },
  { v0: [1, 0, 0], v1: [1, 0, 1], v2: [1, 1, 1] },
  { v0: [1, 0, 0], v1: [1, 1, 1], v2: [1, 1, 0] },
]

// Translated cube (shifted by [5, 0, 0])
const translatedCube: StlTriangle[] = unitCube.map((t) => ({
  v0: [t.v0[0] + 5, t.v0[1], t.v0[2]] as const,
  v1: [t.v1[0] + 5, t.v1[1], t.v1[2]] as const,
  v2: [t.v2[0] + 5, t.v2[1], t.v2[2]] as const,
}))

// Scaled cube (2x in each dimension)
const scaledCube: StlTriangle[] = unitCube.map((t) => ({
  v0: [t.v0[0] * 2, t.v0[1] * 2, t.v0[2] * 2] as const,
  v1: [t.v1[0] * 2, t.v1[1] * 2, t.v1[2] * 2] as const,
  v2: [t.v2[0] * 2, t.v2[1] * 2, t.v2[2] * 2] as const,
}))

describe('compareMetrics', () => {
  it('identical meshes → PASS', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(unitCube)
    const r = compareMetrics(ref, cand)
    expect(r.verdict).toBe('PASS')
    expect(r.volumeDelta).toBe(0)
    expect(r.bboxIoU).toBeCloseTo(1, 6)
    expect(r.centroidDistance).toBe(0)
  })

  it('translated mesh → FAIL (centroid)', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(translatedCube)
    const r = compareMetrics(ref, cand)
    expect(r.verdict).toBe('FAIL')
    expect(r.centroidDistance).toBeCloseTo(5, 6)
  })

  it('scaled mesh → FAIL (volume)', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(scaledCube)
    const r = compareMetrics(ref, cand)
    expect(r.verdict).toBe('FAIL')
    expect(r.volumeDelta).toBeCloseTo(7, 1) // 8 - 1 = 7
  })

  it('same mesh but more triangles → PASS (volume/area match)', () => {
    // Subdivide each triangle into 4 (but geometry stays the same)
    const subdivided: StlTriangle[] = []
    for (const t of unitCube) {
      const m01: [number, number, number] = [(t.v0[0] + t.v1[0]) / 2, (t.v0[1] + t.v1[1]) / 2, (t.v0[2] + t.v1[2]) / 2]
      const m12: [number, number, number] = [(t.v1[0] + t.v2[0]) / 2, (t.v1[1] + t.v2[1]) / 2, (t.v1[2] + t.v2[2]) / 2]
      const m20: [number, number, number] = [(t.v2[0] + t.v0[0]) / 2, (t.v2[1] + t.v0[1]) / 2, (t.v2[2] + t.v0[2]) / 2]
      subdivided.push({ v0: t.v0, v1: m01, v2: m20 })
      subdivided.push({ v0: m01, v1: t.v1, v2: m12 })
      subdivided.push({ v0: m20, v1: m12, v2: t.v2 })
      subdivided.push({ v0: m01, v1: m12, v2: m20 })
    }
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(subdivided)
    const r = compareMetrics(ref, cand)
    expect(r.verdict).toBe('PASS')
    expect(r.triangleCountDelta).toBe(36) // 48 - 12
  })
})

describe('compareSurfaces', () => {
  it('identical meshes → Hausdorff = 0', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(unitCube)
    const r = compareSurfaces(unitCube, unitCube, ref, cand)
    expect(r.verdict).toBe('PASS')
    expect(r.hausdorffDistance).toBe(0)
  })

  it('translated mesh → FAIL (surface distance)', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(translatedCube)
    const r = compareSurfaces(unitCube, translatedCube, ref, cand)
    expect(r.verdict).toBe('FAIL')
    expect(r.hausdorffDistance).toBeCloseTo(5, 6)
  })
})
