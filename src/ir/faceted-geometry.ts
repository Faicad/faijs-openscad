/**
 * Faceted geometry computation (M8, T802).
 *
 * When OpenSCAD has `$fn > 0`, sphere/cylinder/cone are real faceted
 * polyhedra, not analytic surfaces. This module computes the vertex/face
 * data that matches OpenSCAD's tessellation algorithm, so the emitter
 * can produce exact faceted geometry.
 *
 * OpenSCAD's faceting rules:
 *  - `$fn > 0`: use exactly $fn segments
 *  - `$fn = 0` (or undef): compute from $fa (min angle) and $fs (min size)
 *    - For circles: fragments = max(3, min(ceil(360 / $fa), ceil(2*PI*r / $fs)))
 *    - For spheres: fn = max(3, min(ceil(180 / $fa), ceil(PI*r / $fs)))
 *      (half-circle because sphere uses latitude from pole to pole)
 *
 * Defaults: $fa = 12, $fs = 2
 */

/** Default OpenSCAD special variables. */
export const DEFAULT_FA = 12
export const DEFAULT_FS = 2

/**
 * Compute the number of fragments for a circle of radius `r`.
 * Used by cylinder, cone, and circle.
 */
export function circleFragments(
  r: number,
  fn: number | undefined,
  fa: number | undefined,
  fs: number | undefined,
): number {
  if (fn !== undefined && fn > 0) return Math.max(3, Math.floor(fn))
  const a = fa ?? DEFAULT_FA
  const s = fs ?? DEFAULT_FS
  return Math.max(
    3,
    Math.min(
      Math.ceil(360 / a),
      Math.ceil((2 * Math.PI * r) / s),
    ),
  )
}

/**
 * Compute the number of latitude segments for a sphere of radius `r`.
 * OpenSCAD uses half the circle fragments (pole to pole = 180°).
 */
export function sphereFragments(
  r: number,
  fn: number | undefined,
  fa: number | undefined,
  fs: number | undefined,
): number {
  if (fn !== undefined && fn > 0) return Math.max(3, Math.floor(fn))
  const a = fa ?? DEFAULT_FA
  const s = fs ?? DEFAULT_FS
  return Math.max(
    3,
    Math.min(
      Math.ceil(180 / a),
      Math.ceil((Math.PI * r) / s),
    ),
  )
}

/**
 * Generate vertices and triangular faces for a faceted sphere.
 *
 * OpenSCAD's sphere tessellation:
 * - Top pole vertex
 * - `fn` rings of `fn` vertices each (latitude steps)
 * - Bottom pole vertex
 * - Total vertices: 2 + fn * (fn - 1)
 * - Faces: fn (top cap) + fn * (fn - 2) (middle strips) + fn (bottom cap)
 *   = fn * fn
 *
 * @param radius - Sphere radius
 * @param segments - Number of segments (from $fn or computed)
 * @returns vertices and faces (each face is [v0, v1, v2])
 */
export function facetedSphereGeometry(
  radius: number,
  segments: number,
): { vertices: Array<[number, number, number]>; faces: Array<[number, number, number]> } {
  const n = segments
  const vertices: Array<[number, number, number]> = []
  const faces: Array<[number, number, number]> = []

  // Top pole
  vertices.push([0, 0, radius])

  // Rings: latitude from top to bottom
  // OpenSCAD uses: for lat = 1..n-1, phi = lat * (pi / n)
  //   z = r * cos(phi), ringRadius = r * sin(phi)
  for (let lat = 1; lat < n; lat++) {
    const phi = (lat * Math.PI) / n
    const z = radius * Math.cos(phi)
    const ringR = radius * Math.sin(phi)
    for (let lon = 0; lon < n; lon++) {
      const theta = (lon * 2 * Math.PI) / n
      vertices.push([
        ringR * Math.cos(theta),
        ringR * Math.sin(theta),
        z,
      ])
    }
  }

  // Bottom pole
  vertices.push([0, 0, -radius])

  const topPole = 0
  const bottomPole = vertices.length - 1

  // Top cap triangles (top pole → ring 0)
  for (let lon = 0; lon < n; lon++) {
    const nextLon = (lon + 1) % n
    const ring0Start = 1 // first ring starts at vertex 1
    faces.push([
      topPole,
      ring0Start + lon,
      ring0Start + nextLon,
    ])
  }

  // Middle strips
  for (let lat = 0; lat < n - 2; lat++) {
    const ringStart = 1 + lat * n
    const nextRingStart = 1 + (lat + 1) * n
    for (let lon = 0; lon < n; lon++) {
      const nextLon = (lon + 1) % n
      // Two triangles per quad
      faces.push([
        ringStart + lon,
        nextRingStart + lon,
        nextRingStart + nextLon,
      ])
      faces.push([
        ringStart + lon,
        nextRingStart + nextLon,
        ringStart + nextLon,
      ])
    }
  }

  // Bottom cap triangles (last ring → bottom pole)
  const lastRingStart = 1 + (n - 2) * n
  for (let lon = 0; lon < n; lon++) {
    const nextLon = (lon + 1) % n
    faces.push([
      bottomPole,
      lastRingStart + nextLon,
      lastRingStart + lon,
    ])
  }

  return { vertices, faces }
}

/**
 * Generate a regular N-gon polygon for a faceted circle/cylinder cross-section.
 *
 * OpenSCAD's circle with $fn=N produces a regular N-gon with vertices at:
 *   for i = 0..N-1: angle = i * (360/N), point = [r*cos(angle), r*sin(angle)]
 *
 * @param radius - Circle radius
 * @param segments - Number of segments
 * @returns Array of 2D points [x, y]
 */
export function regularPolygonPoints(
  radius: number,
  segments: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let i = 0; i < segments; i++) {
    const angle = (i * 2 * Math.PI) / segments
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)])
  }
  return points
}
