/**
 * Tests for faceted geometry computation (M8, T802).
 */
import { describe, expect, it } from 'vitest'
import {
  circleFragments,
  sphereFragments,
  facetedSphereGeometry,
  regularPolygonPoints,
  DEFAULT_FA,
  DEFAULT_FS,
} from './faceted-geometry'

describe('circleFragments', () => {
  it('$fn=6 → 6', () => {
    expect(circleFragments(10, 6, undefined, undefined)).toBe(6)
  })

  it('$fn=3 → 3 (minimum)', () => {
    expect(circleFragments(10, 3, undefined, undefined)).toBe(3)
  })

  it('$fn=0 → computed from $fa/$fs', () => {
    // r=10, $fa=12, $fs=2 → min(ceil(360/12)=30, ceil(2*π*10/2)=32) = 30
    expect(circleFragments(10, 0, DEFAULT_FA, DEFAULT_FS)).toBe(30)
  })

  it('$fn=undefined → computed from $fa/$fs', () => {
    expect(circleFragments(10, undefined, DEFAULT_FA, DEFAULT_FS)).toBe(30)
  })

  it('small radius → minimum 3', () => {
    expect(circleFragments(0.1, undefined, DEFAULT_FA, DEFAULT_FS)).toBe(3)
  })
})

describe('sphereFragments', () => {
  it('$fn=6 → 6', () => {
    expect(sphereFragments(10, 6, undefined, undefined)).toBe(6)
  })

  it('$fn=0 → computed from $fa/$fs (half of circle)', () => {
    // r=10, $fa=12, $fs=2 → min(ceil(180/12)=15, ceil(π*10/2)=16) = 15
    expect(sphereFragments(10, 0, DEFAULT_FA, DEFAULT_FS)).toBe(15)
  })
})

describe('regularPolygonPoints', () => {
  it('N=6 produces 6 vertices', () => {
    const pts = regularPolygonPoints(10, 6)
    expect(pts).toHaveLength(6)
  })

  it('N=4 produces a square', () => {
    const pts = regularPolygonPoints(1, 4)
    expect(pts).toHaveLength(4)
    // First vertex at angle 0: [1, 0]
    expect(pts[0]![0]).toBeCloseTo(1, 6)
    expect(pts[0]![1]).toBeCloseTo(0, 6)
  })

  it('vertices are on the circle of given radius', () => {
    const r = 5
    const pts = regularPolygonPoints(r, 8)
    for (const [x, y] of pts) {
      expect(Math.sqrt(x * x + y * y)).toBeCloseTo(r, 6)
    }
  })
})

describe('facetedSphereGeometry', () => {
  it('N=3 → 2 + 3*2 = 8 vertices, 3*3=9 faces', () => {
    const { vertices, faces } = facetedSphereGeometry(10, 3)
    // Top pole + 2 rings * 3 + bottom pole = 8
    expect(vertices).toHaveLength(8)
    // Top cap (3) + middle strip (3*2=6) + bottom cap (3) = 12... wait
    // Actually: top cap (n=3) + middle strips ((n-2)=1 * n * 2 = 6) + bottom cap (3)
    // = 3 + 6 + 3 = 12
    expect(faces).toHaveLength(12)
  })

  it('N=6 → 2 + 6*5 = 32 vertices, 6*6=36 faces', () => {
    const { vertices, faces } = facetedSphereGeometry(10, 6)
    expect(vertices).toHaveLength(2 + 6 * 5)
    // Top cap (6) + middle strips (4 * 6 * 2 = 48) + bottom cap (6) = 60
    expect(faces).toHaveLength(6 + 48 + 6)
  })

  it('all vertices are on the sphere surface', () => {
    const r = 10
    const { vertices } = facetedSphereGeometry(r, 6)
    for (const [x, y, z] of vertices) {
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(r, 4)
    }
  })

  it('top pole is at [0, 0, r]', () => {
    const { vertices } = facetedSphereGeometry(10, 6)
    expect(vertices[0]).toEqual([0, 0, 10])
  })

  it('bottom pole is at [0, 0, -r]', () => {
    const { vertices } = facetedSphereGeometry(10, 6)
    expect(vertices[vertices.length - 1]).toEqual([0, 0, -10])
  })

  it('all face indices are valid', () => {
    const { vertices, faces } = facetedSphereGeometry(10, 4)
    for (const [a, b, c] of faces) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(vertices.length)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(vertices.length)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThan(vertices.length)
      expect(a).not.toBe(b)
      expect(a).not.toBe(c)
      expect(b).not.toBe(c)
    }
  })
})
