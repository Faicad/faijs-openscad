/**
 * Tests for STL metrics reader (M4, T401).
 *
 * Uses known geometry (unit cube, sphere from OpenSCAD examples) to
 * validate volume, bbox, surface area, and manifold status.
 */
import { describe, expect, it } from 'vitest'
import { computeMetrics, parseStl, readStlMetrics, type StlTriangle } from './stl-metrics'

// ── Unit cube: 12 triangles, 8 vertices, volume=1, area=6 ─────────────────

const unitCubeTriangles: StlTriangle[] = [
  // Bottom (z=0, normal -Z)
  { v0: [0, 0, 0], v1: [1, 0, 0], v2: [1, 1, 0] },
  { v0: [0, 0, 0], v1: [1, 1, 0], v2: [0, 1, 0] },
  // Top (z=1, normal +Z)
  { v0: [0, 0, 1], v1: [1, 1, 1], v2: [1, 0, 1] },
  { v0: [0, 0, 1], v1: [0, 1, 1], v2: [1, 1, 1] },
  // Front (y=0, normal -Y)
  { v0: [0, 0, 0], v1: [0, 0, 1], v2: [1, 0, 1] },
  { v0: [0, 0, 0], v1: [1, 0, 1], v2: [1, 0, 0] },
  // Back (y=1, normal +Y)
  { v0: [0, 1, 0], v1: [1, 1, 1], v2: [0, 1, 1] },
  { v0: [0, 1, 0], v1: [1, 1, 0], v2: [1, 1, 1] },
  // Left (x=0, normal -X)
  { v0: [0, 0, 0], v1: [0, 1, 0], v2: [0, 1, 1] },
  { v0: [0, 0, 0], v1: [0, 1, 1], v2: [0, 0, 1] },
  // Right (x=1, normal +X)
  { v0: [1, 0, 0], v1: [1, 0, 1], v2: [1, 1, 1] },
  { v0: [1, 0, 0], v1: [1, 1, 1], v2: [1, 1, 0] },
]

describe('computeMetrics — unit cube', () => {
  const m = computeMetrics(unitCubeTriangles)

  it('triangle count', () => {
    expect(m.triangleCount).toBe(12)
  })

  it('vertex count (8 unique)', () => {
    expect(m.vertexCount).toBe(8)
  })

  it('bounding box', () => {
    expect(m.bbox.min).toEqual([0, 0, 0])
    expect(m.bbox.max).toEqual([1, 1, 1])
    expect(m.bbox.extent).toEqual([1, 1, 1])
  })

  it('volume = 1.0', () => {
    expect(m.volume).toBeCloseTo(1.0, 6)
  })

  it('surface area = 6.0', () => {
    expect(m.surfaceArea).toBeCloseTo(6.0, 6)
  })

  it('centroid = [0.5, 0.5, 0.5]', () => {
    expect(m.centroid[0]).toBeCloseTo(0.5, 6)
    expect(m.centroid[1]).toBeCloseTo(0.5, 6)
    expect(m.centroid[2]).toBeCloseTo(0.5, 6)
  })

  it('connected components = 1', () => {
    expect(m.connectedComponents).toBe(1)
  })

  it('is manifold (closed)', () => {
    expect(m.isManifold).toBe(1)
    expect(m.boundaryEdges).toBe(0)
    expect(m.nonManifoldEdges).toBe(0)
  })
})

// ── Single triangle (open mesh) ────────────────────────────────────────────

describe('computeMetrics — single triangle', () => {
  const tri: StlTriangle[] = [
    { v0: [0, 0, 0], v1: [1, 0, 0], v2: [0, 1, 0] },
  ]
  const m = computeMetrics(tri)

  it('volume = 0 (flat)', () => {
    expect(m.volume).toBe(0)
  })

  it('surface area = 0.5', () => {
    expect(m.surfaceArea).toBeCloseTo(0.5, 6)
  })

  it('not manifold (3 boundary edges)', () => {
    expect(m.isManifold).toBe(0)
    expect(m.boundaryEdges).toBe(3)
  })
})

// ── Empty mesh ─────────────────────────────────────────────────────────────

describe('computeMetrics — empty', () => {
  const m = computeMetrics([])

  it('all zeros', () => {
    expect(m.triangleCount).toBe(0)
    expect(m.vertexCount).toBe(0)
    expect(m.volume).toBe(0)
    expect(m.surfaceArea).toBe(0)
    expect(m.connectedComponents).toBe(0)
  })
})

// ── Two disconnected cubes ─────────────────────────────────────────────────

describe('computeMetrics — two disconnected cubes', () => {
  // Second cube offset by 10 in X
  const tri2 = unitCubeTriangles.map((t) => ({
    v0: [t.v0[0] + 10, t.v0[1], t.v0[2]] as const,
    v1: [t.v1[0] + 10, t.v1[1], t.v1[2]] as const,
    v2: [t.v2[0] + 10, t.v2[1], t.v2[2]] as const,
  }))
  const m = computeMetrics([...unitCubeTriangles, ...tri2])

  it('2 connected components', () => {
    expect(m.connectedComponents).toBe(2)
  })

  it('volume = 2.0', () => {
    expect(m.volume).toBeCloseTo(2.0, 6)
  })

  it('24 triangles', () => {
    expect(m.triangleCount).toBe(24)
  })

  it('16 unique vertices', () => {
    expect(m.vertexCount).toBe(16)
  })
})

// ── ASCII STL parsing ──────────────────────────────────────────────────────

describe('parseStl — ASCII', () => {
  const asciiStl = `solid test
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 1 1 0
    endloop
  endfacet
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 1 1 0
      vertex 0 1 0
    endloop
  endfacet
endsolid test`

  it('parses 2 triangles', () => {
    const buf = new TextEncoder().encode(asciiStl)
    const tris = parseStl(buf)
    expect(tris).toHaveLength(2)
  })

  it('correct vertex coordinates', () => {
    const buf = new TextEncoder().encode(asciiStl)
    const tris = parseStl(buf)
    expect(tris[0]!.v0).toEqual([0, 0, 0])
    expect(tris[0]!.v1).toEqual([1, 0, 0])
    expect(tris[0]!.v2).toEqual([1, 1, 0])
  })
})

// ── Binary STL parsing ─────────────────────────────────────────────────────

describe('parseStl — binary', () => {
  it('parses a single-triangle binary STL', () => {
    // 80-byte header + 4-byte count + 50 bytes per triangle
    const buf = new ArrayBuffer(84 + 50)
    const view = new DataView(buf)
    // Header (80 bytes of zeros)
    // Triangle count = 1
    view.setUint32(80, 1, true)
    // Normal (3 floats at offset 84)
    view.setFloat32(84, 0, true)
    view.setFloat32(88, 0, true)
    view.setFloat32(92, 1, true)
    // v0 at offset 96
    view.setFloat32(96, 0, true)
    view.setFloat32(100, 0, true)
    view.setFloat32(104, 0, true)
    // v1 at offset 108
    view.setFloat32(108, 1, true)
    view.setFloat32(112, 0, true)
    view.setFloat32(116, 0, true)
    // v2 at offset 120
    view.setFloat32(120, 0, true)
    view.setFloat32(124, 1, true)
    view.setFloat32(128, 0, true)
    // attribute byte count at offset 132
    view.setUint16(132, 0, true)

    const tris = parseStl(new Uint8Array(buf))
    expect(tris).toHaveLength(1)
    expect(tris[0]!.v0).toEqual([0, 0, 0])
    expect(tris[0]!.v1).toEqual([1, 0, 0])
    expect(tris[0]!.v2).toEqual([0, 1, 0])
  })
})

// ── Known sphere (from OpenSCAD examples, if available) ───────────────────

describe('readStlMetrics — from file bytes', () => {
  it('unit cube ASCII STL round-trip', () => {
    const asciiStl = `solid cube
${unitCubeTriangles.map((t) =>
  `  facet normal 0 0 0\n    outer loop\n      vertex ${t.v0[0]} ${t.v0[1]} ${t.v0[2]}\n      vertex ${t.v1[0]} ${t.v1[1]} ${t.v1[2]}\n      vertex ${t.v2[0]} ${t.v2[1]} ${t.v2[2]}\n    endloop\n  endfacet`,
).join('\n')}
endsolid cube`
    const buf = new TextEncoder().encode(asciiStl)
    const m = readStlMetrics(buf)
    expect(m.triangleCount).toBe(12)
    expect(m.volume).toBeCloseTo(1.0, 6)
    expect(m.surfaceArea).toBeCloseTo(6.0, 6)
    expect(m.isManifold).toBe(1)
  })
})
