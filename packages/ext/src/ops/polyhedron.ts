/**
 * K04: polyhedron — build a solid from points and face indices.
 *
 * Each face (array of point indices) is fan-triangulated into triangles,
 * which are built via buildTriFace, then sewn into a solid.
 */
import { getExtKernel } from '../kernel'
import type { ShapeHandle, Vec3 } from 'occt-wasm'

/**
 * Normalise a vertex to {x,y,z}. Generated code passes plain `[x,y,z]`
 * arrays (they survive the JSON/JS round-trip), while host callers may pass
 * proper Vec3 objects — accept both.
 */
function asVec3(p: unknown): Vec3 | undefined {
  if (Array.isArray(p) && p.length >= 3 && p.every((v) => typeof v === 'number')) {
    return { x: p[0], y: p[1], z: p[2] }
  }
  if (
    p !== null && typeof p === 'object' &&
    typeof (p as Vec3).x === 'number' &&
    typeof (p as Vec3).y === 'number' &&
    typeof (p as Vec3).z === 'number'
  ) {
    return p as Vec3
  }
  return undefined
}

/**
 * Build a polyhedron from explicit points and faces.
 *
 * @param points  Array of 3D vertices (`{x,y,z}` or `[x,y,z]`).
 * @param faces   Array of faces; each face is an array of point indices
 *                (counter-clockwise when viewed from outside).
 * @returns       A solid ShapeHandle.
 */
export async function polyhedron(points: unknown[], faces: number[][]): Promise<ShapeHandle> {
  const k = await getExtKernel()

  const vecs = points.map(asVec3)
  if (vecs.some((v) => v === undefined)) {
    throw new Error(`polyhedron: malformed points — every vertex must be [x,y,z] or {x,y,z}`)
  }
  const pts = vecs as Vec3[]

  if (pts.length === 0 || faces.length === 0) {
    return k.makeNullShape()
  }

  // Fan-triangulate each face and build triangle faces.
  const triFaces: ShapeHandle[] = []
  for (const face of faces) {
    if (face.length < 3) continue
    for (let i = 1; i < face.length - 1; i++) {
      const a = pts[face[0]]
      const b = pts[face[i]]
      const c = pts[face[i + 1]]
      if (a && b && c) {
        triFaces.push(k.buildTriFace(a, b, c))
      }
    }
  }

  if (triFaces.length === 0) {
    return k.makeNullShape()
  }

  const shell = k.sew(triFaces)
  return k.makeSolid(shell)
}
