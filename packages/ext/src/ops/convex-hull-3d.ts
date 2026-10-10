/**
 * 3D convex hull — incremental algorithm.
 *
 * occt-wasm does not expose a convexHull API, so we implement the
 * incremental hull algorithm in TypeScript.  The output is a list of
 * triangular faces (each a triple of point indices) with outward-facing
 * normals.
 */

interface Pt {
  x: number
  y: number
  z: number
}

interface Face {
  /** Indices into the points array. */
  a: number
  b: number
  c: number
  /** Outward-facing normal (not normalised). */
  nx: number
  ny: number
  nz: number
  /** Plane offset: normal · point = d for any point on the face. */
  d: number
  /** Whether this face is visible from the current point being added. */
  visible: boolean
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Pt, b: Pt): Pt {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function dot(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function makeFace(points: Pt[], a: number, b: number, c: number): Face {
  const ab = sub(points[b], points[a])
  const ac = sub(points[c], points[a])
  const n = cross(ab, ac)
  return {
    a,
    b,
    c,
    nx: n.x,
    ny: n.y,
    nz: n.z,
    d: dot(n, points[a]),
    visible: false,
  }
}

/** Signed distance from point p to face f (positive = outside). */
function faceDist(f: Face, p: Pt): number {
  return f.nx * p.x + f.ny * p.y + f.nz * p.z - f.d
}

/**
 * Compute the convex hull of a set of 3D points.
 * @returns Array of triangular faces, each [iA, iB, iC] referencing the input points.
 */
export function convexHull3D(input: readonly Pt[]): [number, number, number][] {
  if (input.length < 4) return []

  // Deduplicate points.
  const points: Pt[] = []
  const tol = 1e-10
  for (const p of input) {
    let dup = false
    for (const q of points) {
      if (Math.abs(p.x - q.x) < tol && Math.abs(p.y - q.y) < tol && Math.abs(p.z - q.z) < tol) {
        dup = true
        break
      }
    }
    if (!dup) points.push(p)
  }
  if (points.length < 4) return []

  // Find 4 non-coplanar points for initial tetrahedron.
  let i0 = 0
  let i1 = -1
  for (let i = 1; i < points.length; i++) {
    if (dist(points[i0], points[i]) > tol) {
      i1 = i
      break
    }
  }
  if (i1 < 0) return []

  let i2 = -1
  for (let i = 0; i < points.length; i++) {
    if (i === i0 || i === i1) continue
    const ab = sub(points[i1], points[i0])
    const ac = sub(points[i], points[i0])
    if (dot(cross(ab, ac), cross(ab, ac)) > tol * tol) {
      i2 = i
      break
    }
  }
  if (i2 < 0) return []

  let i3 = -1
  for (let i = 0; i < points.length; i++) {
    if (i === i0 || i === i1 || i === i2) continue
    const ab = sub(points[i1], points[i0])
    const ac = sub(points[i2], points[i0])
    const ad = sub(points[i], points[i0])
    if (Math.abs(dot(cross(ab, ac), ad)) > tol * tol * tol) {
      i3 = i
      break
    }
  }
  if (i3 < 0) return []

  // Create initial tetrahedron (4 faces, outward normals).
  let faces: Face[] = [
    makeFace(points, i0, i1, i2),
    makeFace(points, i0, i1, i3),
    makeFace(points, i0, i2, i3),
    makeFace(points, i1, i2, i3),
  ]

  // Ensure outward-facing normals (centroid should be inside).
  const centroid: Pt = {
    x: (points[i0].x + points[i1].x + points[i2].x + points[i3].x) / 4,
    y: (points[i0].y + points[i1].y + points[i2].y + points[i3].y) / 4,
    z: (points[i0].z + points[i1].z + points[i2].z + points[i3].z) / 4,
  }
  for (const f of faces) {
    if (faceDist(f, centroid) > 0) {
      // Flip normal by swapping b and c.
      const tmp = f.b
      f.b = f.c
      f.c = tmp
      f.nx = -f.nx
      f.ny = -f.ny
      f.nz = -f.nz
      f.d = -f.d
    }
  }

  // Incrementally add remaining points.
  for (let i = 0; i < points.length; i++) {
    if (i === i0 || i === i1 || i === i2 || i === i3) continue
    const p = points[i]

    // Find visible faces.
    let hasVisible = false
    for (const f of faces) {
      f.visible = faceDist(f, p) > tol
      if (f.visible) hasVisible = true
    }
    if (!hasVisible) continue // point is inside

    // Find horizon edges (edges shared by one visible and one non-visible face).
    const horizon: [number, number][] = []
    for (let fi = 0; fi < faces.length; fi++) {
      if (!faces[fi].visible) continue
      const f = faces[fi]
      const edges: [number, number][] = [[f.a, f.b], [f.b, f.c], [f.c, f.a]]
      for (const [ea, eb] of edges) {
        // Check if the reverse edge exists in a non-visible face.
        let shared = false
        for (let fj = 0; fj < faces.length; fj++) {
          if (fj === fi || faces[fj].visible) continue
          const g = faces[fj]
          const gEdges: [number, number][] = [[g.a, g.b], [g.b, g.c], [g.c, g.a]]
          for (const [ga, gb] of gEdges) {
            if (ga === eb && gb === ea) {
              shared = true
              break
            }
          }
          if (shared) break
        }
        if (shared) horizon.push([ea, eb])
      }
    }

    // Remove visible faces.
    faces = faces.filter((f) => !f.visible)

    // Add new faces from point to horizon edges.
    for (const [ea, eb] of horizon) {
      faces.push(makeFace(points, ea, eb, i))
      // Ensure outward normal.
      if (faceDist(faces[faces.length - 1], centroid) > 0) {
        const f = faces[faces.length - 1]
        const tmp = f.b
        f.b = f.c
        f.c = tmp
        f.nx = -f.nx
        f.ny = -f.ny
        f.nz = -f.nz
        f.d = -f.d
      }
    }
  }

  return faces.map((f) => [f.a, f.b, f.c])
}

function dist(a: Pt, b: Pt): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
