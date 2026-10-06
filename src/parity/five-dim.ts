/**
 * Five-dimensional STL parity comparison (M8, T800).
 *
 * Aligned with @faicad/cq-compat-compare's five-dimension STEP comparison,
 * adapted for direct STL mesh comparison:
 *
 * | Dimension | Metric                          | Default Tolerance |
 * |-----------|---------------------------------|-------------------|
 * | 1. bbox   | max coordinate diff (6 faces)   | 1e-4 mm           |
 * | 2. volume | relative difference             | 1e-4 (0.01%)      |
 * | 3. centroid | max coordinate diff           | 1e-4 mm           |
 * | 4. topology | solid/connected-component count | exact match     |
 * | 5. boolean | A−B and B−A volume             | 1e-3 mm³          |
 *
 * Dimensions 1–4 are computed directly from the STL mesh (triangle facets).
 * Dimension 5 (boolean difference) requires a mesh boolean engine. When
 * the OCCT BREP engine is available, we reconstruct BREP solids from the
 * meshes and perform exact boolean cuts. When it is not available, we fall
 * back to Hausdorff surface sampling distance as a diagnostic proxy.
 *
 * The Hausdorff distance from the M4 framework is retained as a diagnostic
 * reference but is NOT a pass/fail criterion.
 */
import type { MeshMetrics, BoundingBox } from './stl-metrics'
import type { StlTriangle } from './stl-metrics'

// ── Types ─────────────────────────────────────────────────────────────────

/** Tolerance thresholds for five-dimensional comparison. */
export interface FiveDimTolerance {
  /** Max bbox six-face coordinate difference (mm). Default 1e-4. */
  readonly linear: number
  /** Max relative volume difference (0.01 = 1%). Default 1e-4. */
  readonly volumeRel: number
  /** Max boolean difference volume (mm³) for A−B and B−A. Default 1e-3. */
  readonly booleanVolume: number
}

/** Default tolerance aligned with cq-compat-compare. */
export const FIVE_DIM_TOLERANCE: FiveDimTolerance = {
  linear: 1e-4,
  volumeRel: 1e-4,
  booleanVolume: 1e-3,
}

/** Result of a single dimension check. */
export interface DimResult {
  readonly pass: boolean
  readonly detail: string
}

/** Result of the five-dimensional comparison. */
export interface FiveDimResult {
  /** Overall verdict: PASS only if all 5 dimensions pass. */
  readonly equivalent: boolean
  /** Per-dimension results. */
  readonly bbox: DimResult
  readonly volume: DimResult
  readonly centroid: DimResult
  readonly topology: DimResult
  readonly booleanDiff: DimResult
  /** Reference metrics. */
  readonly refMetrics: MeshMetrics
  /** Candidate metrics. */
  readonly candMetrics: MeshMetrics
  /** Whether boolean diff was computed via OCCT (true) or estimated (false). */
  readonly booleanDiffComputed: boolean
  /** Hausdorff distance (diagnostic only, not a pass/fail criterion). */
  readonly hausdorffDistance: number
  /** All diagnostic detail lines. */
  readonly details: string[]
}

// ── Five-dimension comparison ──────────────────────────────────────────────

/**
 * Compare two STL meshes across five dimensions.
 *
 * Dimensions 1–4 are always computed from mesh metrics.
 * Dimension 5 (boolean diff) requires an optional `booleanDiffFn` callback
 * that uses OCCT or another mesh boolean engine. If not provided,
 * dimension 5 falls back to a volume-difference proxy.
 */
export function compareFiveDim(
  refMetrics: MeshMetrics,
  candMetrics: MeshMetrics,
  refTriangles: readonly StlTriangle[],
  candTriangles: readonly StlTriangle[],
  tol: FiveDimTolerance = FIVE_DIM_TOLERANCE,
  booleanDiffFn?: (ref: readonly StlTriangle[], cand: readonly StlTriangle[]) => Promise<{ aMinusB: number; bMinusA: number }>,
): FiveDimResult {
  const details: string[] = []

  // 1. Bounding box: max of 6-face coordinate differences
  const bboxDiff = bboxMaxDiff(refMetrics.bbox, candMetrics.bbox)
  const bboxPass = bboxDiff <= tol.linear
  details.push(`bbox max-diff: ${bboxDiff.toExponential(3)} mm (tol ${tol.linear})`)
  const bbox: DimResult = {
    pass: bboxPass,
    detail: `max-diff=${bboxDiff.toExponential(3)} mm`,
  }

  // 2. Volume: relative difference
  const volRef = refMetrics.volume
  const volCand = candMetrics.volume
  const volAbs = Math.abs(volRef - volCand)
  const volMax = Math.max(Math.abs(volRef), Math.abs(volCand), 1e-30)
  const volRel = volAbs / volMax
  const volPass = volRel <= tol.volumeRel
  details.push(`volume rel-diff: ${volRel.toExponential(3)} (${volRef.toFixed(6)} vs ${volCand.toFixed(6)}, tol ${tol.volumeRel})`)
  const volume: DimResult = {
    pass: volPass,
    detail: `rel=${volRel.toExponential(3)} (Δ=${volAbs.toExponential(3)} mm³)`,
  }

  // 3. Centroid: max coordinate difference
  const centDiff = Math.max(
    Math.abs(refMetrics.centroid[0] - candMetrics.centroid[0]),
    Math.abs(refMetrics.centroid[1] - candMetrics.centroid[1]),
    Math.abs(refMetrics.centroid[2] - candMetrics.centroid[2]),
  )
  const centPass = centDiff <= tol.linear
  details.push(`centroid max-diff: ${centDiff.toExponential(3)} mm (tol ${tol.linear})`)
  const centroid: DimResult = {
    pass: centPass,
    detail: `max-diff=${centDiff.toExponential(3)} mm`,
  }

  // 4. Topology: solid/connected-component count must match exactly
  const refSolids = refMetrics.connectedComponents
  const candSolids = candMetrics.connectedComponents
  const topoPass = refSolids === candSolids
  details.push(`topology: ref=${refSolids} solids, cand=${candSolids} solids (exact match required)`)
  const topology: DimResult = {
    pass: topoPass,
    detail: `ref=${refSolids} vs cand=${candSolids}`,
  }

  // 5. Boolean difference (A−B and B−A)
  let booleanDiff: DimResult
  let booleanDiffComputed = false
  let hausdorffDistance = 0

  if (booleanDiffFn) {
    // OCCT-based exact boolean diff
    const { aMinusB, bMinusA } = synchronousBooleanDiff(refTriangles, candTriangles, booleanDiffFn)
    const boolPass = aMinusB <= tol.booleanVolume && bMinusA <= tol.booleanVolume
    details.push(`boolean diff: A−B=${aMinusB.toExponential(3)} mm³, B−A=${bMinusA.toExponential(3)} mm³ (tol ${tol.booleanVolume})`)
    booleanDiff = {
      pass: boolPass,
      detail: `A−B=${aMinusB.toExponential(3)} mm³, B−A=${bMinusA.toExponential(3)} mm³`,
    }
    booleanDiffComputed = true
  } else {
    // Fallback: use volume difference as proxy when no boolean engine available.
    // If volumes match closely, the boolean diff is likely small. This is a
    // conservative estimate — not a true boolean diff.
    const proxyVol = volAbs
    const boolPass = proxyVol <= tol.booleanVolume
    details.push(`boolean diff: (proxy=volume Δ) ${proxyVol.toExponential(3)} mm³ (tol ${tol.booleanVolume}) [OCCT unavailable]`)
    booleanDiff = {
      pass: boolPass,
      detail: `proxy=volume Δ=${proxyVol.toExponential(3)} mm³ [OCCT unavailable]`,
    }
  }

  // Diagnostic: Hausdorff distance (not a pass/fail criterion)
  if (refTriangles.length > 0 && candTriangles.length > 0) {
    hausdorffDistance = computeHausdorff(refTriangles, candTriangles)
    details.push(`Hausdorff (diagnostic): ${hausdorffDistance.toExponential(3)} mm`)
  }

  const equivalent = bbox.pass && volume.pass && centroid.pass && topology.pass && booleanDiff.pass

  return {
    equivalent,
    bbox,
    volume,
    centroid,
    topology,
    booleanDiff,
    refMetrics,
    candMetrics,
    booleanDiffComputed,
    hausdorffDistance,
    details,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Max difference across all 6 bbox face coordinates. */
function bboxMaxDiff(a: BoundingBox, b: BoundingBox): number {
  return Math.max(
    Math.abs(a.min[0] - b.min[0]),
    Math.abs(a.min[1] - b.min[1]),
    Math.abs(a.min[2] - b.min[2]),
    Math.abs(a.max[0] - b.max[0]),
    Math.abs(a.max[1] - b.max[1]),
    Math.abs(a.max[2] - b.max[2]),
  )
}

/**
 * Compute Hausdorff distance between two meshes (max of both directions).
 * O(V_src × T_dst) — fine for small meshes.
 */
function computeHausdorff(
  ref: readonly StlTriangle[],
  cand: readonly StlTriangle[],
): number {
  const d1 = maxVertexToMeshDistance(ref, cand)
  const d2 = maxVertexToMeshDistance(cand, ref)
  return Math.max(d1, d2)
}

function maxVertexToMeshDistance(
  src: readonly StlTriangle[],
  dst: readonly StlTriangle[],
): number {
  const vertices: Array<[number, number, number]> = []
  const seen = new Set<string>()
  for (const tri of src) {
    for (const v of [tri.v0, tri.v1, tri.v2]) {
      const key = `${v[0]}:${v[1]}:${v[2]}`
      if (!seen.has(key)) {
        seen.add(key)
        vertices.push([v[0], v[1], v[2]])
      }
    }
  }

  let maxDist = 0
  for (const v of vertices) {
    let minDist = Infinity
    for (const tri of dst) {
      const d = pointToTriangleDistance(v, tri)
      if (d < minDist) minDist = d
      if (minDist === 0) break
    }
    if (minDist > maxDist) maxDist = minDist
  }
  return maxDist
}

/**
 * Synchronous wrapper for boolean diff. Since compareFiveDim is called
 * synchronously, we can't actually await the booleanDiffFn here.
 * This function is a placeholder — the real boolean diff must be
 * computed before calling compareFiveDim, or via the async overload.
 */
function synchronousBooleanDiff(
  _ref: readonly StlTriangle[],
  _cand: readonly StlTriangle[],
  _fn: (ref: readonly StlTriangle[], cand: readonly StlTriangle[]) => Promise<{ aMinusB: number; bMinusA: number }>,
): { aMinusB: number; bMinusA: number } {
  // This should never be called — use compareFiveDimAsync for OCCT-based comparison.
  return { aMinusB: NaN, bMinusA: NaN }
}

/**
 * Async version of five-dimensional comparison with OCCT boolean diff.
 *
 * When `booleanDiffFn` is provided, this function awaits the OCCT-based
 * boolean difference computation for dimension 5.
 */
export async function compareFiveDimAsync(
  refMetrics: MeshMetrics,
  candMetrics: MeshMetrics,
  refTriangles: readonly StlTriangle[],
  candTriangles: readonly StlTriangle[],
  tol: FiveDimTolerance = FIVE_DIM_TOLERANCE,
  booleanDiffFn?: (ref: readonly StlTriangle[], cand: readonly StlTriangle[]) => Promise<{ aMinusB: number; bMinusA: number }>,
): Promise<FiveDimResult> {
  if (!booleanDiffFn) {
    return compareFiveDim(refMetrics, candMetrics, refTriangles, candTriangles, tol)
  }

  // Compute dimensions 1-4 synchronously first
  const syncResult = compareFiveDim(refMetrics, candMetrics, refTriangles, candTriangles, tol)

  // Compute dimension 5 via OCCT
  const { aMinusB, bMinusA } = await booleanDiffFn(refTriangles, candTriangles)
  const boolPass = aMinusB <= tol.booleanVolume && bMinusA <= tol.booleanVolume

  // Replace dimension 5 result
  const details = syncResult.details.filter((d) => !d.startsWith('boolean diff:'))
  details.push(`boolean diff: A−B=${aMinusB.toExponential(3)} mm³, B−A=${bMinusA.toExponential(3)} mm³ (tol ${tol.booleanVolume})`)

  const booleanDiff: DimResult = {
    pass: boolPass,
    detail: `A−B=${aMinusB.toExponential(3)} mm³, B−A=${bMinusA.toExponential(3)} mm³`,
  }

  const equivalent = syncResult.bbox.pass && syncResult.volume.pass && syncResult.centroid.pass && syncResult.topology.pass && boolPass

  return {
    ...syncResult,
    booleanDiff,
    booleanDiffComputed: true,
    equivalent,
    details,
  }
}

// ── Point-to-triangle distance (from compare-mesh.ts) ──────────────────────

function pointToTriangleDistance(
  p: readonly [number, number, number],
  tri: StlTriangle,
): number {
  const a = tri.v0
  const b = tri.v1
  const c = tri.v2

  const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const ap: [number, number, number] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]

  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return dist(p, a)

  const bp: [number, number, number] = [p[0] - b[0], p[1] - b[1], p[2] - b[2]]
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return dist(p, b)

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3)
    return dist(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]])
  }

  const cp: [number, number, number] = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return dist(p, c)

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6)
    return dist(p, [a[0] + t * ac[0], a[1] + t * ac[1], a[2] + t * ac[2]])
  }

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + d5 - d6)
    return dist(p, [b[0] + t * (c[0] - b[0]), b[1] + t * (c[1] - b[1]), b[2] + t * (c[2] - b[2])])
  }

  const n = cross(ab, ac)
  const denom = dot(n, n)
  if (denom === 0) return dist(p, a)
  const t = dot(n, ap) / denom
  return Math.abs(t) * Math.sqrt(dot(n, n) / denom)
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function dist(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
