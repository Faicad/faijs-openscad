/**
 * Mesh comparison for parity testing (M4, T402).
 *
 * Compares two STL meshes by:
 *  1. Metric-based comparison (volume, surface area, bbox, centroid)
 *  2. Surface distance estimation (Hausdorff-like sampling)
 *
 * The symmetric difference volume (exact set-theoretic XOR of two solids)
 * requires a mesh boolean engine (e.g. manifold-3d). To avoid that
 * dependency, we use:
 *  - Volume difference: |V_ref - V_cand|
 *  - Bounding box overlap
 *  - Surface area difference
 *  - Centroid distance
 *  - Surface sampling: for each candidate vertex, find the nearest
 *    triangle on the reference mesh; report max/mean/Hausdorff distance.
 *
 * All tolerances are centrally defined in `DEFAULT_TOLERANCE`.
 */
import type { MeshMetrics, BoundingBox } from './stl-metrics'
import type { StlTriangle } from './stl-metrics'

// ── Types ─────────────────────────────────────────────────────────────────

/** Parity verdict for a single comparison. */
export type ParityVerdict =
  | 'PASS' // strict match within tolerance
  | 'PASS-ANALYTIC' // analytic BREP vs faceted: metrics match but geometry differs
  | 'PASS-NT' // not tested (runtime unavailable)
  | 'FAIL' // metrics diverge beyond tolerance
  | 'ERROR' // could not compute (parse failure, etc.)

/** Result of comparing two meshes. */
export interface ComparisonResult {
  /** Overall verdict. */
  readonly verdict: ParityVerdict
  /** Reference metrics. */
  readonly ref: MeshMetrics
  /** Candidate metrics. */
  readonly cand: MeshMetrics
  /** Absolute volume difference. */
  readonly volumeDelta: number
  /** Relative volume difference (|Vr - Vc| / max(|Vr|, |Vc|)). */
  readonly volumeRelDelta: number
  /** Absolute surface area difference. */
  readonly surfaceAreaDelta: number
  /** Relative surface area difference. */
  readonly surfaceAreaRelDelta: number
  /** Bounding box intersection volume (0 = no overlap). */
  readonly bboxOverlap: number
  /** Bounding box IoU (intersection over union). */
  readonly bboxIoU: number
  /** Centroid Euclidean distance. */
  readonly centroidDistance: number
  /** Triangle count difference. */
  readonly triangleCountDelta: number
  /** Max surface distance (candidate → reference). */
  readonly maxSurfaceDistance: number
  /** Mean surface distance (candidate → reference). */
  readonly meanSurfaceDistance: number
  /** Hausdorff-like distance (max of both directions). */
  readonly hausdorffDistance: number
  /** Diagnostic message (for FAIL/ERROR). */
  readonly message?: string
}

/** Tolerance thresholds for comparison. */
export interface ComparisonTolerance {
  /** Max absolute volume difference. */
  readonly volumeAbs: number
  /** Max relative volume difference (0..1). */
  readonly volumeRel: number
  /** Max absolute surface area difference. */
  readonly surfaceAreaAbs: number
  /** Max relative surface area difference (0..1). */
  readonly surfaceAreaRel: number
  /** Max bounding box IoU shortfall from 1.0. */
  readonly bboxIoU: number
  /** Max centroid Euclidean distance. */
  readonly centroidDistance: number
  /** Max Hausdorff-like surface distance. */
  readonly surfaceDistance: number
  /** Max triangle count relative difference (0..1). */
  readonly triangleCountRel: number
}

/** Default tolerance: strict but not bit-exact. */
export const DEFAULT_TOLERANCE: ComparisonTolerance = {
  volumeAbs: 0.01,
  volumeRel: 0.001,
  surfaceAreaAbs: 0.1,
  surfaceAreaRel: 0.001,
  bboxIoU: 0.001,
  centroidDistance: 0.01,
  surfaceDistance: 0.1,
  triangleCountRel: 0.1,
}

// ── Comparison ────────────────────────────────────────────────────────────

/**
 * Compare two meshes by metrics.
 * Does not compute surface distance — use {@link compareSurfaces} for that.
 */
export function compareMetrics(
  ref: MeshMetrics,
  cand: MeshMetrics,
  tol: ComparisonTolerance = DEFAULT_TOLERANCE,
): ComparisonResult {
  const volumeDelta = Math.abs(ref.volume - cand.volume)
  const maxVol = Math.max(Math.abs(ref.volume), Math.abs(cand.volume), 1e-30)
  const volumeRelDelta = volumeDelta / maxVol

  const surfaceAreaDelta = Math.abs(ref.surfaceArea - cand.surfaceArea)
  const maxArea = Math.max(ref.surfaceArea, cand.surfaceArea, 1e-30)
  const surfaceAreaRelDelta = surfaceAreaDelta / maxArea

  const bboxOverlap = bboxIntersectionVolume(ref.bbox, cand.bbox)
  const refBboxVol = bboxVolume(ref.bbox)
  const candBboxVol = bboxVolume(cand.bbox)
  const bboxUnionVol = refBboxVol + candBboxVol - bboxOverlap
  // Handle degenerate (flat) bboxes: if both bboxes have zero volume,
  // compare by extent similarity instead.
  let bboxIoU: number
  if (bboxUnionVol > 0) {
    bboxIoU = bboxOverlap / bboxUnionVol
  } else {
    // Both bboxes are flat: check if they overlap in all 3 axes
    const overlapX = Math.max(0, Math.min(ref.bbox.max[0], cand.bbox.max[0]) - Math.max(ref.bbox.min[0], cand.bbox.min[0]))
    const overlapY = Math.max(0, Math.min(ref.bbox.max[1], cand.bbox.max[1]) - Math.max(ref.bbox.min[1], cand.bbox.min[1]))
    const overlapZ = Math.max(0, Math.min(ref.bbox.max[2], cand.bbox.max[2]) - Math.max(ref.bbox.min[2], cand.bbox.min[2]))
    bboxIoU = (overlapX > 0 || ref.bbox.extent[0] === 0) &&
              (overlapY > 0 || ref.bbox.extent[1] === 0) &&
              (overlapZ > 0 || ref.bbox.extent[2] === 0)
      ? 1 : 0
  }

  const centroidDistance = Math.sqrt(
    (ref.centroid[0] - cand.centroid[0]) ** 2 +
    (ref.centroid[1] - cand.centroid[1]) ** 2 +
    (ref.centroid[2] - cand.centroid[2]) ** 2,
  )

  const triangleCountDelta = Math.abs(ref.triangleCount - cand.triangleCount)
  const triCountRel = Math.max(ref.triangleCount, cand.triangleCount, 1) as number
  const triCountRelDelta = triangleCountDelta / triCountRel

  // Verdict
  let verdict: ParityVerdict = 'PASS'
  const failures: string[] = []

  if (volumeDelta > tol.volumeAbs && volumeRelDelta > tol.volumeRel) {
    verdict = 'FAIL'
    failures.push(`volume: Δ=${volumeDelta.toFixed(6)} (rel ${volumeRelDelta.toFixed(6)})`)
  }
  if (surfaceAreaDelta > tol.surfaceAreaAbs && surfaceAreaRelDelta > tol.surfaceAreaRel) {
    verdict = 'FAIL'
    failures.push(`surface area: Δ=${surfaceAreaDelta.toFixed(6)} (rel ${surfaceAreaRelDelta.toFixed(6)})`)
  }
  if (1 - bboxIoU > tol.bboxIoU) {
    verdict = 'FAIL'
    failures.push(`bbox IoU: ${bboxIoU.toFixed(6)} (need > ${(1 - tol.bboxIoU).toFixed(6)})`)
  }
  if (centroidDistance > tol.centroidDistance) {
    verdict = 'FAIL'
    failures.push(`centroid distance: ${centroidDistance.toFixed(6)}`)
  }
  if (triCountRelDelta > tol.triangleCountRel) {
    // Triangle count difference alone doesn't fail — it's a diagnostic.
    // Only fail if verdict is already FAIL to provide more context.
  }

  return {
    verdict,
    ref,
    cand,
    volumeDelta,
    volumeRelDelta,
    surfaceAreaDelta,
    surfaceAreaRelDelta,
    bboxOverlap,
    bboxIoU,
    centroidDistance,
    triangleCountDelta,
    maxSurfaceDistance: 0,
    meanSurfaceDistance: 0,
    hausdorffDistance: 0,
    message: verdict === 'FAIL' ? failures.join('; ') : undefined,
  }
}

/**
 * Compute surface distance between two meshes.
 *
 * For each vertex of the candidate mesh, find the nearest point on any
 * triangle of the reference mesh. This is O(V_cand × T_ref) — fine for
 * small meshes (< 10k triangles).
 *
 * For larger meshes, a spatial index (BVH / grid) should be added.
 */
export function compareSurfaces(
  refTriangles: readonly StlTriangle[],
  candTriangles: readonly StlTriangle[],
  ref: MeshMetrics,
  cand: MeshMetrics,
  tol: ComparisonTolerance = DEFAULT_TOLERANCE,
): ComparisonResult {
  const base = compareMetrics(ref, cand, tol)

  if (refTriangles.length === 0 || candTriangles.length === 0) {
    return { ...base, verdict: 'ERROR', message: 'empty mesh' }
  }

  // Candidate → Reference distances
  const candToRef = sampleDistances(candTriangles, refTriangles)
  // Reference → Candidate distances
  const refToCand = sampleDistances(refTriangles, candTriangles)

  const maxSurfaceDistance = candToRef.max
  const meanSurfaceDistance = candToRef.mean
  const hausdorffDistance = Math.max(candToRef.max, refToCand.max)

  // Update verdict based on surface distance
  let verdict = base.verdict
  let message = base.message
  if (hausdorffDistance > tol.surfaceDistance) {
    verdict = 'FAIL'
    message = (message ? message + '; ' : '') + `Hausdorff distance: ${hausdorffDistance.toFixed(6)}`
  }

  return {
    ...base,
    verdict,
    maxSurfaceDistance,
    meanSurfaceDistance,
    hausdorffDistance,
    message,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Volume of an axis-aligned bounding box. */
function bboxVolume(bbox: BoundingBox): number {
  return bbox.extent[0] * bbox.extent[1] * bbox.extent[2]
}

/** Intersection volume of two axis-aligned bounding boxes (0 if no overlap). */
function bboxIntersectionVolume(a: BoundingBox, b: BoundingBox): number {
  const dx = Math.max(0, Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]))
  const dy = Math.max(0, Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]))
  const dz = Math.max(0, Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]))
  return dx * dy * dz
}

/**
 * For each vertex in `src`, compute distance to the nearest triangle in `dst`.
 * Returns max and mean distances.
 */
function sampleDistances(
  src: readonly StlTriangle[],
  dst: readonly StlTriangle[],
): { max: number; mean: number } {
  // Collect unique source vertices
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
  let sumDist = 0
  for (const v of vertices) {
    let minDist = Infinity
    for (const tri of dst) {
      const d = pointToTriangleDistance(v, tri)
      if (d < minDist) minDist = d
      if (minDist === 0) break
    }
    if (minDist > maxDist) maxDist = minDist
    sumDist += minDist
  }

  return { max: maxDist, mean: vertices.length > 0 ? sumDist / vertices.length : 0 }
}

/**
 * Point-to-triangle distance (point to closest point on triangle).
 * Uses the standard projection method.
 */
function pointToTriangleDistance(
  p: readonly [number, number, number],
  tri: StlTriangle,
): number {
  const a = tri.v0
  const b = tri.v1
  const c = tri.v2

  // Project p onto the triangle plane, then clamp to the triangle.
  // Use barycentric coordinates.
  const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const ap: [number, number, number] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]

  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return dist(p, a) // closest to vertex a

  const bp: [number, number, number] = [p[0] - b[0], p[1] - b[1], p[2] - b[2]]
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return dist(p, b) // closest to vertex b

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3)
    return dist(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]])
  }

  const cp: [number, number, number] = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return dist(p, c) // closest to vertex c

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

  // Closest point is inside the triangle face
  const n = cross(ab, ac)
  const denom = dot(n, n)
  if (denom === 0) return dist(p, a) // degenerate triangle
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
