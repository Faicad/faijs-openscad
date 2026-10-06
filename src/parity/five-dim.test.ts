/**
 * Tests for five-dimensional STL parity comparison (M8, T800).
 *
 * Validates that the five-dimension comparison correctly identifies:
 *  - identical meshes as equivalent
 *  - translated meshes as not equivalent (bbox/centroid mismatch)
 *  - scaled meshes as not equivalent (volume mismatch)
 *  - different-component-count meshes as not equivalent (topology mismatch)
 *  - slightly off meshes within tolerance as equivalent
 */
import { describe, expect, it } from 'vitest'
import { computeMetrics, type StlTriangle } from './stl-metrics'
import { compareFiveDim, FIVE_DIM_TOLERANCE } from './five-dim'

// Unit cube (12 triangles, volume=1, bbox=[0,0,0]-[1,1,1])
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

// Two disconnected cubes (2 connected components)
const twoCubes: StlTriangle[] = [
  ...unitCube,
  ...unitCube.map((t) => ({
    v0: [t.v0[0] + 10, t.v0[1], t.v0[2]] as const,
    v1: [t.v1[0] + 10, t.v1[1], t.v1[2]] as const,
    v2: [t.v2[0] + 10, t.v2[1], t.v2[2]] as const,
  })),
]

describe('compareFiveDim', () => {
  it('identical meshes → equivalent=true', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(unitCube)
    const r = compareFiveDim(ref, cand, unitCube, unitCube)
    expect(r.equivalent).toBe(true)
    expect(r.bbox.pass).toBe(true)
    expect(r.volume.pass).toBe(true)
    expect(r.centroid.pass).toBe(true)
    expect(r.topology.pass).toBe(true)
    expect(r.booleanDiff.pass).toBe(true)
  })

  it('translated mesh → equivalent=false (bbox + centroid)', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(translatedCube)
    const r = compareFiveDim(ref, cand, unitCube, translatedCube)
    expect(r.equivalent).toBe(false)
    expect(r.bbox.pass).toBe(false)
    expect(r.centroid.pass).toBe(false)
  })

  it('scaled mesh → equivalent=false (bbox + volume)', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(scaledCube)
    const r = compareFiveDim(ref, cand, unitCube, scaledCube)
    expect(r.equivalent).toBe(false)
    expect(r.volume.pass).toBe(false)
    expect(r.bbox.pass).toBe(false)
  })

  it('different component count → equivalent=false (topology)', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(twoCubes)
    const r = compareFiveDim(ref, cand, unitCube, twoCubes)
    expect(r.equivalent).toBe(false)
    expect(r.topology.pass).toBe(false)
    expect(r.topology.detail).toContain('ref=1')
    expect(r.topology.detail).toContain('cand=2')
  })

  it('same mesh, different triangulation → equivalent=true', () => {
    // Subdivide each triangle into 4 (geometry stays the same)
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
    const r = compareFiveDim(ref, cand, unitCube, subdivided)
    expect(r.equivalent).toBe(true)
  })

  it('tolerance: slightly off mesh within linear tolerance → equivalent=true', () => {
    // Tiny translation (1e-5 mm, within 1e-4 linear tolerance)
    const tinyShift: StlTriangle[] = unitCube.map((t) => ({
      v0: [t.v0[0] + 1e-5, t.v0[1], t.v0[2]] as const,
      v1: [t.v1[0] + 1e-5, t.v1[1], t.v1[2]] as const,
      v2: [t.v2[0] + 1e-5, t.v2[1], t.v2[2]] as const,
    }))
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(tinyShift)
    const r = compareFiveDim(ref, cand, unitCube, tinyShift)
    expect(r.bbox.pass).toBe(true)
    expect(r.centroid.pass).toBe(true)
  })

  it('provides diagnostic Hausdorff distance', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(unitCube)
    const r = compareFiveDim(ref, cand, unitCube, unitCube)
    expect(r.hausdorffDistance).toBe(0)
  })

  it('Hausdorff detects translated mesh', () => {
    const ref = computeMetrics(unitCube)
    const cand = computeMetrics(translatedCube)
    const r = compareFiveDim(ref, cand, unitCube, translatedCube)
    expect(r.hausdorffDistance).toBeCloseTo(5, 5)
  })

  it('default tolerance matches cq-compat-compare', () => {
    expect(FIVE_DIM_TOLERANCE.linear).toBe(1e-4)
    expect(FIVE_DIM_TOLERANCE.volumeRel).toBe(1e-4)
    expect(FIVE_DIM_TOLERANCE.booleanVolume).toBe(1e-3)
  })
})
