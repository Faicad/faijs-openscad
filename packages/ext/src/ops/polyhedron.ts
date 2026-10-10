/**
 * K04: polyhedron — build a solid from points and face indices.
 *
 * Each face (array of point indices) is fan-triangulated into triangles,
 * which are built via buildTriFace, then sewn into a solid.
 */
import { getExtKernel } from '../kernel'
import type { ShapeHandle, Vec3 } from 'occt-wasm'

/**
 * Build a polyhedron from explicit points and faces.
 *
 * @param points  Array of 3D vertices.
 * @param faces   Array of faces; each face is an array of point indices
 *                (counter-clockwise when viewed from outside).
 * @returns       A solid ShapeHandle.
 */
export async function polyhedron(points: Vec3[], faces: number[][]): Promise<ShapeHandle> {
  const k = await getExtKernel()

  if (points.length === 0 || faces.length === 0) {
    return k.makeNullShape()
  }

  // Fan-triangulate each face and build triangle faces.
  const triFaces: ShapeHandle[] = []
  for (const face of faces) {
    if (face.length < 3) continue
    for (let i = 1; i < face.length - 1; i++) {
      const a = points[face[0]]
      const b = points[face[i]]
      const c = points[face[i + 1]]
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
