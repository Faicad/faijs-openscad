/**
 * STL metrics reader (M4, T401).
 *
 * Reads STL files (both ASCII and binary) and extracts geometric metrics
 * for parity comparison. No external dependencies — pure TypeScript.
 *
 * Supported formats:
 *  - ASCII STL (`solid ... endsolid`)
 *  - Binary STL (80-byte header + uint32 triangle count + 50-byte triangles)
 *
 * Metrics extracted:
 *  - bounding box (min/max/extent)
 *  - signed volume (via signed tetrahedron method)
 *  - surface area (sum of triangle areas)
 *  - centroid (area-weighted)
 *  - triangle count, vertex count (unique positions)
 *  - connected components (by shared edges)
 *  - manifold status (each edge shared by exactly 2 triangles)
 *
 * All floating-point comparisons use a configurable epsilon (default 1e-9).
 */

/** Bounding box in 3D. */
export interface BoundingBox {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
  readonly extent: readonly [number, number, number]
}

/** Geometric metrics extracted from an STL mesh. */
export interface MeshMetrics {
  /** Number of triangles (facets). */
  readonly triangleCount: number
  /** Number of unique vertex positions (within epsilon). */
  readonly vertexCount: number
  /** Axis-aligned bounding box. */
  readonly bbox: BoundingBox
  /** Unsigned volume of the mesh (absolute value of the signed tetrahedron sum). */
  readonly volume: number
  /** Total surface area. */
  readonly surfaceArea: number
  /** Area-weighted centroid. */
  readonly centroid: readonly [number, number, number]
  /** Number of connected components (triangles sharing edges). */
  readonly connectedComponents: number
  /** True if every edge is shared by exactly 2 triangles (closed manifold). */
  readonly isManifold: number
  /** Number of boundary edges (edges shared by only 1 triangle). */
  readonly boundaryEdges: number
  /** Number of non-manifold edges (shared by 3+ triangles). */
  readonly nonManifoldEdges: number
}

/** Options for metrics extraction. */
export interface MetricsOptions {
  /** Distance below which two positions are considered the same vertex. */
  readonly epsilon?: number
}

const DEFAULT_EPSILON = 1e-9

// ── STL parsing ───────────────────────────────────────────────────────────

/** A single triangle facet from the STL. */
interface Triangle {
  readonly v0: readonly [number, number, number]
  readonly v1: readonly [number, number, number]
  readonly v2: readonly [number, number, number]
}

/**
 * Parse an STL file (auto-detect ASCII vs binary).
 * @param buffer - The raw file bytes.
 * @returns Array of triangles.
 */
export function parseStl(buffer: ArrayBuffer | Uint8Array): Triangle[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

  // Try ASCII first: the first non-whitespace should be "solid".
  const headerStr = new TextDecoder().decode(bytes.slice(0, 512)).trimStart()
  if (headerStr.startsWith('solid')) {
    // Could still be binary with a "solid" header — check if binary parsing
    // gives a more reasonable triangle count.
    const ascii = parseAsciiStl(new TextDecoder().decode(bytes))
    if (ascii.length > 0) return ascii
  }

  return parseBinaryStl(bytes)
}

/** Parse ASCII STL text. */
function parseAsciiStl(text: string): Triangle[] {
  const triangles: Triangle[] = []
  // Match vertex triples within facet blocks.
  // We don't need the normal — we compute our own.
  const facetRegex = /facet\s+normal\s+([-\de.+]+)\s+([-\de.+]+)\s+([-\de.+]+)\s*[\s\S]*?endfacet/g
  const vertexRegex = /vertex\s+([-\de.+]+)\s+([-\de.+]+)\s+([-\de.+]+)/g

  let facetMatch: RegExpExecArray | null
  while ((facetMatch = facetRegex.exec(text)) !== null) {
    const facetBlock = facetMatch[0]
    const verts: Array<[number, number, number]> = []
    let vMatch: RegExpExecArray | null
    while ((vMatch = vertexRegex.exec(facetBlock)) !== null) {
      verts.push([parseFloat(vMatch[1]), parseFloat(vMatch[2]), parseFloat(vMatch[3])])
    }
    if (verts.length >= 3) {
      triangles.push({ v0: verts[0]!, v1: verts[1]!, v2: verts[2]! })
    }
    vertexRegex.lastIndex = 0
  }

  return triangles
}

/** Parse binary STL (80-byte header + uint32 count + 50-byte triangles). */
function parseBinaryStl(bytes: Uint8Array): Triangle[] {
  if (bytes.length < 84) {
    throw new Error('Binary STL too short: must be at least 84 bytes (header + count)')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const triangleCount = view.getUint32(80, true)
  const expectedSize = 84 + triangleCount * 50
  if (bytes.length < expectedSize) {
    throw new Error(`Binary STL truncated: expected ${expectedSize} bytes, got ${bytes.length}`)
  }

  const triangles: Triangle[] = []
  let offset = 84
  for (let i = 0; i < triangleCount; i++) {
    // Skip normal (3 floats = 12 bytes)
    offset += 12
    const v0: [number, number, number] = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ]
    offset += 12
    const v1: [number, number, number] = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ]
    offset += 12
    const v2: [number, number, number] = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ]
    offset += 12
    // Skip attribute byte count (2 bytes)
    offset += 2
    triangles.push({ v0, v1, v2 })
  }

  return triangles
}

// ── Metrics computation ───────────────────────────────────────────────────

/**
 * Compute geometric metrics from an array of triangles.
 */
export function computeMetrics(triangles: readonly Triangle[], options: MetricsOptions = {}): MeshMetrics {
  const eps = options.epsilon ?? DEFAULT_EPSILON

  if (triangles.length === 0) {
    return {
      triangleCount: 0,
      vertexCount: 0,
      bbox: { min: [0, 0, 0], max: [0, 0, 0], extent: [0, 0, 0] },
      volume: 0,
      surfaceArea: 0,
      centroid: [0, 0, 0],
      connectedComponents: 0,
      isManifold: 0,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
    }
  }

  // Bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  // Volume (signed tetrahedron method)
  let volume = 0

  // Surface area
  let surfaceArea = 0

  // Centroid accumulator (area-weighted)
  let cx = 0, cy = 0, cz = 0

  // Vertex deduplication
  const vertexMap = new Map<string, number>()
  let nextVertexId = 0
  const vertexCount = new Set<number>()

  // Edge tracking for manifold check
  // Key: "vId0-vId1" (sorted, smaller first)
  const edgeCount = new Map<string, number>()

  // Triangle vertex indices (for connectivity)
  const triangleVertexIndices: Array<[number, number, number]> = []

  for (const tri of triangles) {
    const { v0, v1, v2 } = tri

    // Bounding box
    for (const v of [v0, v1, v2]) {
      if (v[0] < minX) minX = v[0]
      if (v[1] < minY) minY = v[1]
      if (v[2] < minZ) minZ = v[2]
      if (v[0] > maxX) maxX = v[0]
      if (v[1] > maxY) maxY = v[1]
      if (v[2] > maxZ) maxZ = v[2]
    }

    // Surface area (cross product method)
    const ex = v1[0] - v0[0], ey = v1[1] - v0[1], ez = v1[2] - v0[2]
    const fx = v2[0] - v0[0], fy = v2[1] - v0[1], fz = v2[2] - v0[2]
    const cxp = ey * fz - ez * fy
    const cyp = ez * fx - ex * fz
    const czp = ex * fy - ey * fx
    const area = 0.5 * Math.sqrt(cxp * cxp + cyp * cyp + czp * czp)
    surfaceArea += area

    // Centroid (area-weighted, using triangle centroid)
    const tcx = (v0[0] + v1[0] + v2[0]) / 3
    const tcy = (v0[1] + v1[1] + v2[1]) / 3
    const tcz = (v0[2] + v1[2] + v2[2]) / 3
    cx += tcx * area
    cy += tcy * area
    cz += tcz * area

    // Volume (signed tetrahedron: V = (v0 · (v1 × v2)) / 6).
    // The sign depends on vertex winding; for outward-facing normals
    // (CCW when viewed from outside), the sum gives a positive volume.
    // We take the absolute value at the end to handle either winding.
    const crossX = v1[1] * v2[2] - v1[2] * v2[1]
    const crossY = v1[2] * v2[0] - v1[0] * v2[2]
    const crossZ = v1[0] * v2[1] - v1[1] * v2[0]
    volume += (v0[0] * crossX + v0[1] * crossY + v0[2] * crossZ) / 6

    // Vertex deduplication
    const ids: number[] = []
    for (const v of [v0, v1, v2]) {
      const key = vertexKey(v, eps)
      let id = vertexMap.get(key)
      if (id === undefined) {
        id = nextVertexId++
        vertexMap.set(key, id)
      }
      ids.push(id)
      vertexCount.add(id)
    }
    triangleVertexIndices.push([ids[0]!, ids[1]!, ids[2]!])

    // Edge tracking
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
      const va = ids[a]!
      const vb = ids[b]!
      const ek = va < vb ? `${va}-${vb}` : `${vb}-${va}`
      edgeCount.set(ek, (edgeCount.get(ek) ?? 0) + 1)
    }
  }

  // Manifold check
  let boundaryEdges = 0
  let nonManifoldEdges = 0
  for (const count of edgeCount.values()) {
    if (count === 1) boundaryEdges++
    else if (count > 2) nonManifoldEdges++
  }
  const isManifold = boundaryEdges === 0 && nonManifoldEdges === 0 ? 1 : 0

  // Connected components (union-find)
  const components = countComponents(nextVertexId, triangleVertexIndices)

  // Centroid
  const totalArea = surfaceArea
  const centroid: [number, number, number] = totalArea > 0
    ? [cx / totalArea, cy / totalArea, cz / totalArea]
    : [0, 0, 0]

  return {
    triangleCount: triangles.length,
    vertexCount: vertexCount.size,
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      extent: [maxX - minX, maxY - minY, maxZ - minZ],
    },
    volume: Math.abs(volume),
    surfaceArea,
    centroid,
    connectedComponents: components,
    isManifold,
    boundaryEdges,
    nonManifoldEdges,
  }
}

/** Read an STL file and compute metrics. */
export function readStlMetrics(
  buffer: ArrayBuffer | Uint8Array,
  options: MetricsOptions = {},
): MeshMetrics {
  const triangles = parseStl(buffer)
  return computeMetrics(triangles, options)
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Quantize a vertex position to a string key for deduplication. */
function vertexKey(v: readonly [number, number, number], eps: number): string {
  // Round to epsilon grid to merge near-coincident vertices.
  const rx = Math.round(v[0] / eps)
  const ry = Math.round(v[1] / eps)
  const rz = Math.round(v[2] / eps)
  return `${rx}:${ry}:${rz}`
}

/** Union-Find for connected components. */
class UnionFind {
  private readonly parent: Int32Array
  private readonly rank: Uint8Array

  constructor(n: number) {
    this.parent = new Int32Array(n)
    this.rank = new Uint8Array(n)
    for (let i = 0; i < n; i++) this.parent[i] = i
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]
      x = this.parent[x]!
    }
    return x
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra
    } else {
      this.parent[rb] = ra
      this.rank[ra]++
    }
  }
}

/** Count connected components by shared vertices (not edges). */
function countComponents(
  vertexCount: number,
  triangles: ReadonlyArray<readonly [number, number, number]>,
): number {
  if (vertexCount === 0) return 0
  const uf = new UnionFind(vertexCount)
  for (const [a, b, c] of triangles) {
    uf.union(a, b)
    uf.union(b, c)
  }
  const roots = new Set<number>()
  for (let i = 0; i < vertexCount; i++) {
    roots.add(uf.find(i))
  }
  return roots.size
}

// Re-export Triangle for testing.
export type { Triangle as StlTriangle }
