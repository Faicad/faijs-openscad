/**
 * K01: hull — convex hull of a set of shapes.
 *
 * Extracts all vertices from the input shapes, computes the 3D convex hull
 * (incremental algorithm, since occt-wasm does not expose convexHull),
 * builds triangle faces via buildTriFace, then sews them into a solid.
 */
import { getExtKernel } from '../kernel'
import { convexHull3D } from './convex-hull-3d'
import type { ShapeHandle, Vec3 } from 'occt-wasm'

/**
 * Compute the convex hull of a set of shapes.
 *
 * @param shapes  Input shapes (any OCCT shape with vertices).
 * @returns       A solid ShapeHandle representing the convex hull.
 */
export async function hull(shapes: ShapeHandle[]): Promise<ShapeHandle> {
  const k = await getExtKernel()

  // Extract all vertices from all input shapes.
  const points: Vec3[] = []
  for (const s of shapes) {
    const vertices = k.getSubShapes(s, 'vertex')
    for (const v of vertices) {
      points.push(k.vertexPosition(v))
    }
  }

  if (points.length < 4) {
    // Not enough points for a 3D hull — return a null shape.
    return k.makeNullShape()
  }

  // Compute convex hull triangulation.
  const triangles = convexHull3D(points)
  if (triangles.length === 0) {
    return k.makeNullShape()
  }

  // Build triangle faces and sew into a solid.
  const faces: ShapeHandle[] = []
  for (const [a, b, c] of triangles) {
    faces.push(k.buildTriFace(points[a], points[b], points[c]))
  }

  const shell = k.sew(faces)
  return k.makeSolid(shell)
}
