/**
 * 3D convex hull — incremental "beneath-beyond" algorithm.
 *
 * occt-wasm does not expose a convexHull API, so we implement the hull in
 * TypeScript.  The output is a list of triangular faces (triples of point
 * indices into the array the caller passed) with outward-facing normals.
 *
 * ── Why it is built the way it is ───────────────────────────────────────────
 *
 * The point clouds entering here are awkward.  A hull whose children are smooth
 * solids contributes ~1000 *tessellated* surface samples clustered at one
 * extreme of the cloud (a boat's bow sphere), mixed with the exact topology
 * vertices of each faceted child.  A textbook incremental hull — walk the points
 * in input order, glue a cone on each — tears on that input: a tessellated
 * sphere contributes latitude rings of near-coplanar points whose distances sit
 * right at the visibility threshold, so neighbouring faces disagree about
 * whether a given ring point is outside.  The visible region stops being simply
 * connected, the horizon loop no longer closes, and the shell comes apart.
 *
 * Once even one face is wrong it cascades: a tilted face makes every later point
 * look outside, each cone grows larger than the last, and the face count
 * explodes (observed: ~700 expected, ~170 000 produced, on the "toy sailboat"
 * basil).  So the design defends on three fronts:
 *
 *   1. Direction-extreme seeding (256 Fibonacci directions) grows the hull from
 *      a well-separated, irregularly placed subset before touching the dense
 *      clusters.
 *   2. Remaining points are inserted most-protruding-first, so every cone is a
 *      deep, unambiguous patch; marginal (≈noise) points sit below the
 *      tolerance and are never inserted at all.
 *   3. A validity escalator: if the result is not a closed 2-manifold, retry
 *      with a looser tolerance.  That is what finally tames the pathological
 *      clouds — the first attempt already gets the *shape* right (within ~3 %)
 *      and only one or two edges are broken, so a slightly relaxed tolerance
 *      resolves them at negligible geometric cost.
 *
 * ── Tolerance notes (each was a real bug) ───────────────────────────────────
 *
 *  - Face normals are stored UNnormalised (they cache the raw cross product), so
 *    the raw plane function scales with triangle area: comparing it against a
 *    fixed epsilon compares areas, not distances, and means a different
 *    threshold per face.  `faceDist` divides by |n| so one tolerance means the
 *    same thing everywhere.
 *
 *  - The tolerance scales with the cloud's bounding-box diagonal.  Input points
 *    come from float32 tessellation meshes, whose absolute quantisation noise
 *    grows with coordinate magnitude (roughly diag · 2⁻²³).  For model
 *    coordinates in the tens that is ~2e-6 — above a hardcoded 1e-6, which is
 *    precisely the regime that tore the visible patch.
 *
 *  - Returned indices are mapped back through `keepIdx` to the caller's array.
 *    Returning indices into the internally deduplicated copy shifts every index
 *    past the first discarded duplicate, so the caller would build faces from
 *    entirely different points — a silently broken shell.
 */

interface Pt {
  x: number
  y: number
  z: number
}

interface Face {
  /** Indices into the working (deduplicated) points array. */
  a: number
  b: number
  c: number
  /** Outward-facing normal (not normalised). */
  nx: number
  ny: number
  nz: number
  /** Plane offset: normal · point = d for any point on the face. */
  d: number
  /** 1 / |n| (0 when degenerate) — lets faceDist skip a sqrt per query. */
  invLen: number
  /** Scratch flag used during an insertion. */
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

function dist(a: Pt, b: Pt): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Squared distance — enough for ordering comparisons. */
function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

/** Build a face from three point indices, computing its outward normal & plane. */
function makeFace(points: Pt[], a: number, b: number, c: number): Face {
  const ab = sub(points[b], points[a])
  const ac = sub(points[c], points[a])
  const n = cross(ab, ac)
  const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z)
  return {
    a,
    b,
    c,
    nx: n.x,
    ny: n.y,
    nz: n.z,
    d: dot(n, points[a]),
    invLen: len > 0 ? 1 / len : 0,
    visible: false,
  }
}

/**
 * Deduplicate points that coincide within `tol`, keeping first occurrences.
 *
 * A spatial hash rather than an O(n²) pairwise scan: the clouds here run to tens
 * of thousands of points (hull of eight spheres ≈ 32 500 samples), where the
 * naive scan costs ~5·10⁸ comparisons and dominates the whole op.  Points within
 * `tol` on every axis can differ by at most one cell per axis, so checking the
 * 3×3×3 neighbourhood is exactly equivalent.
 */
function dedupPoints(input: readonly Pt[], tol: number): { points: Pt[]; keepIdx: number[] } {
  const points: Pt[] = []
  const keepIdx: number[] = []
  if (!(tol > 0)) {
    for (let i = 0; i < input.length; i++) { points.push(input[i]); keepIdx.push(i) }
    return { points, keepIdx }
  }
  const cellSize = Math.max(tol, 1e-12)
  const inv = 1 / cellSize
  const grid = new Map<string, number[]>()
  for (let i = 0; i < input.length; i++) {
    const p = input[i]
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue
    const ix = Math.floor(p.x * inv)
    const iy = Math.floor(p.y * inv)
    const iz = Math.floor(p.z * inv)
    let dup = false
    for (let dx = -1; dx <= 1 && !dup; dx++) {
      for (let dy = -1; dy <= 1 && !dup; dy++) {
        for (let dz = -1; dz <= 1 && !dup; dz++) {
          const bucket = grid.get(`${ix + dx},${iy + dy},${iz + dz}`)
          if (bucket === undefined) continue
          for (const j of bucket) {
            const q = points[j]
            if (Math.abs(p.x - q.x) < tol && Math.abs(p.y - q.y) < tol && Math.abs(p.z - q.z) < tol) {
              dup = true
              break
            }
          }
        }
      }
    }
    if (dup) continue
    keepIdx.push(i)
    const ownKey = `${ix},${iy},${iz}`
    const own = grid.get(ownKey)
    if (own) own.push(points.length)
    else grid.set(ownKey, [points.length])
    points.push(p)
  }
  return { points, keepIdx }
}

/** True signed distance from point p to face f (positive = outside). */
function faceDist(f: Face, p: Pt): number {
  if (f.invLen === 0) return 0
  return (f.nx * p.x + f.ny * p.y + f.nz * p.z - f.d) * f.invLen
}

/** Number of Fibonacci-spread directions used for seed selection. */
const SEED_DIRECTIONS = 256

/** Refinement sweeps (the hull only grows, so the first settles everything). */
const MAX_REFINE_ROUNDS = 4

interface BuildResult {
  /** Triangular faces as indices into the ORIGINAL input array. */
  faces: [number, number, number][]
  /** True when the shell is a closed 2-manifold. */
  ok: boolean
}

/**
 * Try to build the hull of `input` using a given tolerance.
 * Cheap enough to call several times with escalating tolerances.
 */
function tryBuild(input: readonly Pt[], tol: number): BuildResult {
  // Deduplicate, remembering each survivor's index in the caller's array.
  const { points, keepIdx } = dedupPoints(input, tol)
  const n = points.length
  if (n < 4) return { faces: [], ok: false }

  // --- Robust initial tetrahedron via farthest-point selection. ---
  let i0 = 0
  for (let i = 1; i < n; i++) {
    if (points[i].x < points[i0].x) i0 = i
  }
  let i1 = -1
  let d1max = -1
  for (let i = 0; i < n; i++) {
    if (i === i0) continue
    const d = dist(points[i0], points[i])
    if (d > d1max) { d1max = d; i1 = i }
  }
  if (i1 < 0) return { faces: [], ok: false }

  let i2 = -1
  let d2max = -1
  const ab0 = sub(points[i1], points[i0])
  const base = d1max || 1
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1) continue
    const ai = sub(points[i], points[i0])
    const cr = cross(ab0, ai)
    const d = Math.sqrt(dot(cr, cr)) / base
    if (d > d2max) { d2max = d; i2 = i }
  }
  if (i2 < 0) return { faces: [], ok: false }

  let i3 = -1
  let d3max = -1
  const ac0 = sub(points[i2], points[i0])
  const n012 = cross(ab0, ac0)
  const nlen = Math.sqrt(dot(n012, n012)) || 1
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2) continue
    const ad = sub(points[i], points[i0])
    const d = Math.abs(dot(n012, ad)) / nlen
    if (d > d3max) { d3max = d; i3 = i }
  }
  if (i3 < 0) return { faces: [], ok: false }

  const faces: Face[] = []
  /** Points accounted for. The hull only grows, so one found inside stays in. */
  const processed = new Set<number>([i0, i1, i2, i3])
  /** Set when the shell visibly falls apart (a convex hull of n points never
   *  exceeds 2n-4 faces), used to abandon a hopeless attempt early. */
  let exploded = false

  for (const [a, b, c] of [
    [i0, i1, i2],
    [i0, i1, i3],
    [i0, i2, i3],
    [i1, i2, i3],
  ] as [number, number, number][]) {
    const f = makeFace(points, a, b, c)
    if (faceDist(f, interiorOf(points, i0, i1, i2, i3)) > 0) {
      f.a = c; f.b = b; f.c = a
      f.nx = -f.nx; f.ny = -f.ny; f.nz = -f.nz
      f.d = -f.d
    }
    faces.push(f)
  }
  const seedCentroid = interiorOf(points, i0, i1, i2, i3)

  /**
   * Glue point i onto the hull (standard beneath-beyond step).
   *
   * Horizon detection counts how many *visible* faces share each edge: an edge
   * shared by exactly one visible face borders the visible patch, so it is a
   * horizon edge.  It is kept with the direction it had on that visible face, so
   * the new triangle inherits its outward winding — no reference point involved,
   * hence no orientation drift as the hull grows.
   */
  function insertPoint(i: number): void {
    const p = points[i]

    let hasVisible = false
    for (const f of faces) {
      f.visible = faceDist(f, p) > tol
      if (f.visible) hasVisible = true
    }
    processed.add(i)
    if (!hasVisible) return // inside the hull — stays inside forever

    // Numeric edge key: this runs per edge per insertion, so allocating strings
    // here costs far more than the arithmetic it replaces.
    const edgeMap = new Map<number, { a: number; b: number; count: number }>()
    for (const f of faces) {
      if (!f.visible) continue
      for (const [ea, eb] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]] as const) {
        const key = ea < eb ? ea * n + eb : eb * n + ea
        const rec = edgeMap.get(key)
        if (rec) rec.count++
        else edgeMap.set(key, { a: ea, b: eb, count: 1 })
      }
    }
    const horizon: [number, number][] = []
    for (const rec of edgeMap.values()) {
      if (rec.count === 1) horizon.push([rec.a, rec.b])
    }

    // Retire the visible faces, then fan-triangulate from p to the horizon.
    for (let fi = faces.length - 1; fi >= 0; fi--) {
      if (faces[fi].visible) faces.splice(fi, 1)
    }
    for (const [ea, eb] of horizon) {
      const f = makeFace(points, ea, eb, i)
      if (f.invLen === 0) continue // degenerate (collinear) triangle
      faces.push(f)
    }
    if (faces.length > 2 * n) exploded = true
  }

  /**
   * Insert point i, but only keep it if the shell survives as a closed
   * 2-manifold — otherwise roll back and skip the point.
   *
   * This invariant is what stops the cascade: a single mis-oriented face makes
   * every later point look outside, each subsequent cone grows larger than the
   * last, and the face count runs away (measured ~170 000 instead of ~700 on the
   * "toy sailboat").  Refusing the one risky insertion costs almost nothing
   * geometrically — because these points sit near existing faces — while letting
   * it through destroys everything that follows.  Points are un-marked on
   * rollback so a later round can retry them against a fuller hull.
   */
  function tryInsert(i: number): boolean {
    const snapshot = faces.map((f) => ({
      a: f.a, b: f.b, c: f.c,
      nx: f.nx, ny: f.ny, nz: f.nz, d: f.d,
      invLen: f.invLen, visible: f.visible,
    }))
    insertPoint(i)
    if (!exploded && faces.length <= 2 * n && isClosedManifold(faces, n)) return true
    // Roll back: replay the saved shell and let a later round retry this point.
    faces.length = 0
    for (const f of snapshot) faces.push(f)
    exploded = false
    processed.delete(i)
    return false
  }

  // --- Phase 0: direction-extreme seeding. ---
  const seed = new Set<number>()
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let s = 0; s < SEED_DIRECTIONS; s++) {
    const uy = 1 - (2 * s + 1) / SEED_DIRECTIONS
    const r = Math.sqrt(Math.max(0, 1 - uy * uy))
    const phi = golden * s
    const dx = Math.cos(phi) * r
    const dz = Math.sin(phi) * r
    let bestVal = -Infinity
    let best = -1
    for (let i = 0; i < n; i++) {
      const v = points[i].x * dx + points[i].y * uy + points[i].z * dz
      if (v > bestVal) { bestVal = v; best = i }
    }
    if (best >= 0) seed.add(best)
  }

  // --- Phase 1: grow outward — farthest-from-centroid seed points first. ---
  let cx = 0, cy = 0, cz = 0
  for (const p of points) { cx += p.x; cy += p.y; cz += p.z }
  const centerAll: Pt = { x: cx / n, y: cy / n, z: cz / n }
  const seedOrder = [...seed].sort((a, b) => dist2(points[b], centerAll) - dist2(points[a], centerAll))
  for (const idx of seedOrder) {
    if (processed.has(idx)) continue
    tryInsert(idx)
  }

  // --- Phase 2: refine — remaining points, most-protruding first. ---
  for (let round = 0; round < MAX_REFINE_ROUNDS && !exploded; round++) {
    const pending: { idx: number; d: number }[] = []
    for (let i = 0; i < n; i++) {
      if (processed.has(i)) continue
      const p = points[i]
      let mx = -Infinity
      for (const f of faces) {
        const fd = faceDist(f, p)
        if (fd > mx) mx = fd
      }
      if (mx > tol) pending.push({ idx: i, d: mx })
    }
    if (pending.length === 0) break
    pending.sort((a, b) => b.d - a.d)
    for (const { idx } of pending) tryInsert(idx)
  }

  // Final orientation pass.  The centroid of the points is a convex combination
  // of them, hence strictly inside the hull, so orienting every face away from it
  // guarantees consistent outward winding.
  for (const f of faces) {
    if (faceDist(f, seedCentroid) > 0) {
      const tmp = f.b; f.b = f.c; f.c = tmp
      f.nx = -f.nx; f.ny = -f.ny; f.nz = -f.nz
      f.d = -f.d
    }
  }

  const mapped = faces.map((f) => [keepIdx[f.a], keepIdx[f.b], keepIdx[f.c]] as [number, number, number])
  return { faces: mapped, ok: !exploded && isClosedManifold(faces, n) }
}

/** Centroid of four points. */
function interiorOf(points: Pt[], a: number, b: number, c: number, d: number): Pt {
  return {
    x: (points[a].x + points[b].x + points[c].x + points[d].x) / 4,
    y: (points[a].y + points[b].y + points[c].y + points[d].y) / 4,
    z: (points[a].z + points[b].z + points[c].z + points[d].z) / 4,
  }
}

/** True when every edge is shared by exactly two faces. */
function isClosedManifold(faces: readonly Face[], n: number): boolean {
  if (faces.length === 0) return false
  const e = new Map<number, number>()
  for (const f of faces) {
    for (const [ea, eb] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]] as const) {
      const key = ea < eb ? ea * n + eb : eb * n + ea
      e.set(key, (e.get(key) ?? 0) + 1)
    }
  }
  for (const c of e.values()) if (c !== 2) return false
  return true
}

/**
 * Compute the convex hull of a set of 3D points.
 * @returns Triangular faces, each [iA, iB, iC] indexing the array passed in,
 *          with outward-facing winding.
 */
export function convexHull3D(input: readonly Pt[]): [number, number, number][] {
  if (input.length < 4) return []

  // Scale-aware base tolerance: float32 tessellation noise grows with the size
  // of the model, so a fixed epsilon is only meaningful for one coordinate scale.
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const p of input) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (p.z > maxZ) maxZ = p.z
  }
  const ddx = maxX - minX
  const ddy = maxY - minY
  const ddz = maxZ - minZ
  const diag = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz)
  const baseTol = diag > 0 ? diag * 1e-6 : 1e-6

  // Escalate the tolerance until we get a usable shell.  Most clouds are valid on
  // the first try; the residual ones are already geometrically close and only
  // need the visibility test to be a little more forgiving.
  let fallback: [number, number, number][] = []
  for (const scale of [1, 4, 16] as number[]) {
    const r = tryBuild(input, baseTol * scale)
    if (r.ok) return r.faces
    if (fallback.length === 0) fallback = r.faces
  }
  return fallback
}
