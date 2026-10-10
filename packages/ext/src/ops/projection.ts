/**
 * K08/K09: projection — project a 3D shape onto the XY plane.
 *
 * K08 (cut=true): section by Z=0 plane → 2D face.
 * K09 (cut=false): orthographic projection of all edges → 2D outline.
 *
 * Both use connectEdgesToWires (K07) to assemble unordered edges into
 * closed wires, then makeFace to create 2D faces.
 */
import { getExtKernel } from '../kernel'
import { connectEdgesToWires } from './connect-edges'
import type { ShapeHandle } from 'occt-wasm'

/**
 * K08: projection(cut=true) — section by Z=0 plane.
 *
 * Intersects the shape with the Z=0 plane, extracts the resulting edges,
 * connects them into wires, and builds faces.
 *
 * @param shape  3D shape to section.
 * @returns      2D face(s) representing the cross-section at Z=0.
 */
export async function projectCut(shape: ShapeHandle): Promise<ShapeHandle> {
  const k = await getExtKernel()

  // Section by Z=0 plane.
  const section = k.sectionPlane(shape, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  const edges = k.getSubShapes(section, 'edge')
  if (edges.length === 0) return k.makeNullShape()

  const wires = connectEdgesToWires(k, edges, 1e-2)
  if (wires.length === 0) return k.makeNullShape()

  const faces = wires.map((w) => k.makeFace(w))
  if (faces.length === 0) return k.makeNullShape()

  return faces.length === 1 ? faces[0] : k.sew(faces)
}

/**
 * K09: projection(cut=false) — orthographic outline projection.
 *
 * Projects all edges of the shape onto the XY plane (looking down Z),
 * connects them into wires, and builds faces.
 *
 * @param shape  3D shape to project.
 * @returns      2D face(s) representing the projected outline.
 */
export async function projectOutline(shape: ShapeHandle): Promise<ShapeHandle> {
  const k = await getExtKernel()

  // Project edges onto XY plane (view from +Z looking towards origin).
  const projData = k.projectEdges(shape, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

  // Collect all projected edges (visible + hidden outlines).
  const allEdges: ShapeHandle[] = []
  for (const key of ['visibleOutline', 'visibleSharp', 'visibleSmooth', 'hiddenOutline', 'hiddenSharp', 'hiddenSmooth'] as const) {
    const edgeShape = projData[key]
    if (edgeShape) {
      const subEdges = k.getSubShapes(edgeShape, 'edge')
      allEdges.push(...subEdges)
    }
  }

  if (allEdges.length === 0) return k.makeNullShape()

  const wires = connectEdgesToWires(k, allEdges, 1e-2)
  if (wires.length === 0) return k.makeNullShape()

  const faces = wires.map((w) => k.makeFace(w))
  if (faces.length === 0) return k.makeNullShape()

  return faces.length === 1 ? faces[0] : k.sew(faces)
}
