/**
 * K01: hull — convex hull of a set of shapes.
 *
 * Default path (general): sample the *surface* of each input shape (by
 * tessellating it), compute the 3D convex hull of those sample points
 * (incremental algorithm, since occt-wasm does not expose convexHull), then
 * build triangle faces and sew them into a solid.  We sample both BREP topology
 * vertices AND mesh samples (a sphere stores only its two poles as topology
 * vertices, so topology-only sampling would miss the bulging geometry the hull
 * must wrap).
 *
 * Fast path (rounded-cube idiom): the canonical OpenSCAD `hull()` of eight
 * spheres placed at the corners of a box is exactly that box with every edge
 * and corner filleted at the sphere radius.  Building it that way — as a real
 * BREP fillet — yields exact cylindrical/spherical fillets instead of the
 * faceted approximation a point-sampled convex hull produces.  (The point-hull
 * path is only reliable to ~2 000 points; eight spheres contribute ~8 500 and
 * had to be thinned, which under-sized the result by ~0.5 % and left the fillet
 * tessellation irregular.)  When the idiom is recognised we take the BREP path;
 * otherwise we fall back to the general point-hull.
 */
import { getExtKernel } from '../kernel'
import { convexHull3D } from './convex-hull-3d'
import type { ShapeHandle, Vec3 } from 'occt-wasm'

// Sampling deflections for hull surface points. Intentionally finer than
// OpenSCAD's $fa=12°/$fs=2 defaults: a convex hull is only as tight as the
// point cloud that wraps each curved surface, so we over-sample to ensure the
// resulting hull matches OpenSCAD's (which hulls its own finely-tessellated
// children). These values affect only the hull op, not global tessellation.
const HULL_ANGULAR = 0.1
const HULL_LINEAR = 0.5

/**
 * Upper bound on points handed to the hull algorithm; see the thinning step in
 * {@link hull}. Derived empirically — the incremental hull stays exact to about
 * this size and degrades sharply above it.
 */
const SAMPLE_CAP = 2000

/** Per-shape surface info used both for idiom detection and point-hull fallback. */
interface ShapeInfo {
  /** Exact BREP topology vertices (few; fully describe faceted children). */
  topo: Vec3[]
  /** Tessellated surface samples (capture the bulge of smooth children). */
  samples: Vec3[]
  /** Centroid of the samples — the sphere centre for a spherical child. */
  center: Vec3
  /** Max distance from `center` to a sample — the sphere radius. */
  radius: number
  /** True when the samples all sit on a common sphere centred at `center`. */
  sphereLike: boolean
}

/**
 * Summarise a shape's samples as a candidate sphere: radius = max distance from
 * `center`, and `sphereLike` when the distances are tightly clustered (a sphere:
 * ~0.2 % spread) versus spread out (a box ~42 %, a cylinder spans its axis).
 * The test is relative (scale-free) and robust to float32 quantisation and the
 * sub-percent offset between the BREP-bbox centre and the exact sphere centre.
 */
function summarizeSphere(
  center: Vec3,
  samples: readonly Vec3[],
): { radius: number; sphereLike: boolean } {
  if (samples.length === 0) return { radius: 0, sphereLike: false }
  let minD = Infinity
  let maxD = 0
  for (const p of samples) {
    const d = Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z)
    if (d < minD) minD = d
    if (d > maxD) maxD = d
  }
  const spread = maxD - minD
  const sphereLike = maxD > 0 && spread <= maxD * 0.1
  return { radius: maxD, sphereLike }
}

/** Group values that agree within `tol`. */
function uniqueClose(vals: number[], tol: number): number[] {
  const out: number[] = []
  for (const v of vals) {
    if (!out.some((u) => Math.abs(u - v) <= tol)) out.push(v)
  }
  return out
}

/** Distance from `p` to the axis-aligned box `[lo, hi]` (0 when inside). */
function distToBox(p: Vec3, lo: Vec3, hi: Vec3): number {
  const dx = Math.max(lo.x - p.x, 0, p.x - hi.x)
  const dy = Math.max(lo.y - p.y, 0, p.y - hi.y)
  const dz = Math.max(lo.z - p.z, 0, p.z - hi.z)
  return Math.hypot(dx, dy, dz)
}

/**
 * Recognise the rounded-cube idiom: eight equal spheres whose centres are the
 * eight corners of an axis-aligned box.  Returns the box corners (corner1 =
 * min, corner2 = max) and the fillet radius, or null when it does not apply.
 */
function detectRoundedBox(infos: readonly ShapeInfo[], tol: number): {
  corner1: Vec3
  corner2: Vec3
  r: number
} | null {
  if (infos.length !== 8) return null
  for (const info of infos) if (!info.sphereLike) return null

  const r = infos[0].radius
  const rTol = Math.max(tol, r * 1e-3)
  for (const info of infos) {
    if (Math.abs(info.radius - r) > rTol) return null
  }

  // The eight centres must be the 2×2×2 corners of an axis-aligned box.
  const centers = infos.map((i) => i.center)
  const xs = uniqueClose(centers.map((c) => c.x), tol).sort((a, b) => a - b)
  const ys = uniqueClose(centers.map((c) => c.y), tol).sort((a, b) => a - b)
  const zs = uniqueClose(centers.map((c) => c.z), tol).sort((a, b) => a - b)
  if (xs.length !== 2 || ys.length !== 2 || zs.length !== 2) return null

  // Confirm the full corner set: every centre is one of the 8 combinations.
  const combos = new Set<string>()
  for (const c of centers) {
    combos.add(`${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)}`)
  }
  if (combos.size !== 8) return null

  const corner1: Vec3 = { x: xs[0] - r, y: ys[0] - r, z: zs[0] - r }
  const corner2: Vec3 = { x: xs[1] + r, y: ys[1] + r, z: zs[1] + r }

  // Sanity net: the filleted box IS the convex hull of the eight spheres, so
  // every input sample must lie within `r` of the inner box (the box shrunk by
  // the fillet radius).  A centre or radius derived from a tolerance-inflated
  // bounding box would push samples outside; catching that here keeps a bad
  // idiom from silently mis-placing geometry in the downstream boolean (a
  // rounded cube offset by ~0.01 mm made OCCT drop whole cutting spheres).
  const innerLo: Vec3 = { x: corner1.x + r, y: corner1.y + r, z: corner1.z + r }
  const innerHi: Vec3 = { x: corner2.x - r, y: corner2.y - r, z: corner2.z - r }
  const slack = Math.max(tol, r * 1e-3)
  for (const info of infos) {
    for (const s of info.samples) {
      if (distToBox(s, innerLo, innerHi) > r + slack) return null
    }
  }

  return { corner1, corner2, r }
}

/**
 * Compute the convex hull of a set of shapes.
 *
 * @param shapes  Input shapes (any OCCT shape — surfaces are sampled via mesh).
 * @returns       A solid ShapeHandle representing the convex hull.
 */
export async function hull(shapes: ShapeHandle[]): Promise<ShapeHandle> {
  const k = await getExtKernel()

  // Tessellate each shape once; keep the results per shape (for idiom detection)
  // and aggregate them (for the point-hull fallback).
  const infos: ShapeInfo[] = []
  for (const s of shapes) {
    const topoVerts = k.getSubShapes(s, 'vertex')
    const topo: Vec3[] = topoVerts.map((v) => k.vertexPosition(v))
    const samples: Vec3[] = []
    // Few topology vertices ⇒ smooth surface ⇒ supplement with mesh samples
    // to capture the bulging geometry the hull must wrap.
    if (topoVerts.length < 8) {
      const mesh = k.tessellate(s, {
        angularDeflection: HULL_ANGULAR,
        linearDeflection: HULL_LINEAR,
      })
      const pos = mesh.positions
      for (let i = 0; i < pos.length; i += 3) {
        samples.push({ x: pos[i], y: pos[i + 1], z: pos[i + 2] })
      }
    }
    let center: Vec3 = { x: 0, y: 0, z: 0 }
    // The centre must be EXACT.  A sphere's *triangulated* bbox is inflated by
    // the face tolerance and — worse — asymmetrically: a runtime sphere at
    // (10,10,10) r=10 reports getBoundingBox(s, true) = x[-0.0756, 20.0989]
    // (centre x = 10.0117) while getBoundingBox(s, false) is the exact
    // [0,20]^3.  Deriving the rounded-cube idiom from the triangulated bbox
    // therefore shifts the whole solid by ~0.01 mm and inflates the fillet
    // radius to 10.0117, which makes downstream cuts of exactly-placed
    // spheres fail *silently* (OCCT drops the tool: Old/example006 lost the
    // five pits of one die face).  Prefer the geometry-based bbox; fall back
    // to the triangulated one, then to the sample bbox.
    const bbExact = k.getBoundingBox(s, false)
    const bb = bbExact && Number.isFinite(bbExact.xmin) && Number.isFinite(bbExact.xmax)
      ? bbExact
      : k.getBoundingBox(s, true)
    if (bb && Number.isFinite(bb.xmin) && Number.isFinite(bb.xmax)) {
      center = { x: (bb.xmin + bb.xmax) / 2, y: (bb.ymin + bb.ymax) / 2, z: (bb.zmin + bb.zmax) / 2 }
    } else if (samples.length > 0) {
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      for (const p of samples) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); minZ = Math.min(minZ, p.z)
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); maxZ = Math.max(maxZ, p.z)
      }
      center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }
    }
    // Radius from the *samples* measured against that centre.  With an exact
    // centre this is the true radius to float32 precision — but float32
    // quantisation biases the maximum *upward* (measured: 10.0000011 for a
    // r=10 runtime sphere).  That 1e-6 bias is not harmless: the idiom derives
    // the box corners as `centre ± radius`, so it shifts every face of the
    // rounded cube off the exact sphere surface by 1e-6 — and a rounded cube
    // whose faces miss the cutting spheres by even that much makes OCCT's
    // boolean produce a broken solid (Old/example006: 47 faces, ±60 bbox,
    // volume off by 40 000).
    //
    // For a sphere the exact BREP bbox half-extent IS the radius, to the last
    // bit (measured: 10.000000000000000000).  Prefer it, but only when it
    // agrees with the samples to 0.1 %: a disagreement means the bbox is not a
    // trustworthy radius source (e.g. it fell back to the triangulated box,
    // which carries the face-tolerance inflation), so keep the sample value.
    const { radius: sampleRadius, sphereLike } = summarizeSphere(center, samples)
    let radius = sampleRadius
    if (bb && sampleRadius > 0) {
      const halfExtent = Math.max(
        (bb.xmax - bb.xmin) / 2,
        (bb.ymax - bb.ymin) / 2,
        (bb.zmax - bb.zmin) / 2,
      )
      if (halfExtent > 0 && Math.abs(halfExtent - sampleRadius) <= sampleRadius * 1e-3) {
        radius = halfExtent
      }
    }
    infos.push({ topo, samples, center, radius, sphereLike })
  }

  // ── Fast path: rounded-cube idiom → real BREP fillet ──
  const idiom = detectRoundedBox(infos, Math.max(1e-3, Math.max(...infos.map((i) => i.radius)) * 1e-3))
  if (idiom) {
    try {
      const box = k.makeBoxFromCorners(idiom.corner1, idiom.corner2)
      const edges = k.getSubShapes(box, 'edge')
      const rounded = k.fillet(box, edges, idiom.r)
      return orientPositive(k, rounded)
    } catch {
      // Fillet refused (radius/geometry edge case) — fall through to point-hull.
    }
  }

  // ── General path: convex hull of sampled points ──
  const topoPoints: Vec3[] = []
  const samplePoints: Vec3[] = []
  for (const info of infos) {
    topoPoints.push(...info.topo)
    samplePoints.push(...info.samples)
  }

  // Thin the smooth-surface samples when the cloud gets big.  The incremental
  // hull is reliable to ~2000 points but breaks down on dense clusters: with a
  // child count of eight it was fed ~32 500 samples and produced a folded shell
  // (3.6 M signed volume instead of ~975 k) with half its points left outside.
  // Because they are consecutive samples of the same surface, taking every nth
  // keeps the cloud evenly spread — measured on that very case, thinning to
  // 1/8th still gives 967 799 against a true 975 587, i.e. well under 1 % loss,
  // and no point left outside.  Topology vertices are never thinned: they are
  // few and carry the exact corners of faceted children.
  let points: Vec3[] = [...topoPoints, ...samplePoints]
  if (points.length > SAMPLE_CAP && samplePoints.length > 0) {
    const budget = Math.max(1, SAMPLE_CAP - topoPoints.length)
    const stride = Math.max(1, Math.ceil(samplePoints.length / budget))
    const thinned = samplePoints.filter((_, i) => i % stride === 0)
    points = [...topoPoints, ...thinned]
  }

  if (points.length < 4) {
    // Not enough points for a 3D hull — return a null shape.
    return k.makeNullShape()
  }

  // Compute the convex hull triangulation.  convexHull3D returns triangular
  // faces indexing the `points` array we passed, with outward-facing winding,
  // so we can build the OCCT faces straight from them.
  const triangles = convexHull3D(points)
  if (triangles.length === 0) {
    return k.makeNullShape()
  }

  const faces: ShapeHandle[] = []
  for (const [a, b, c] of triangles) {
    const pa = points[a]
    const pb = points[b]
    const pc = points[c]
    faces.push(k.buildTriFace(pa, pb, pc))
  }

  const shell = k.sew(faces)
  const solid = k.makeSolid(shell)

  // Sewing can hand back an inside-out shell (measured: the rounded cube in
  // Old/example006 comes out at −969 818 either way round the input triangles —
  // `sew` re-orients them itself, so our winding cannot control it).  A negative
  // volume means every face points inward, and boolean ops downstream (that
  // example subtracts 21 spheres from the hull) misbehave badly against such a
  // solid — it collapsed to 2 124 instead of ~930 000.  Reverse it into the
  // positive convention.
  return orientPositive(k, solid)
}

/**
 * Return the solid with a positive (outward) orientation.  `sew`/`fillet` may
 * hand back an inside-out shell; a negative volume means every face points
 * inward, which breaks downstream boolean ops.
 */
function orientPositive(
  k: Awaited<ReturnType<typeof getExtKernel>>,
  solid: ShapeHandle,
): ShapeHandle {
  try {
    if (k.getVolume(solid) < 0) return k.reverseShape(solid)
  } catch {
    // Volume query is unreliable for degenerate results — keep the solid as-is.
  }
  return solid
}
