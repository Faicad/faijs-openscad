/**
 * createOpenSCADNamespace — builds the `openscad` namespace object that a faijs
 * host registers via `rt.registerLib('openscad', createOpenSCADNamespace())`.
 *
 * Every op is an async function taking raw kernel shapes (ShapeHandle) and
 * returning a ShapeHandle.  The host is responsible for converting between
 * faijs Shape wrappers and raw handles — same pattern as faijs-gears.
 */
import { hull } from './ops/hull'
import { polyhedron } from './ops/polyhedron'
import { twistExtrude } from './ops/twist-extrude'
import { projectCut, projectOutline } from './ops/projection'
import { surfaceInterp, surface } from './ops/surface-interp'
import { offset2d } from './ops/offset-hardened'
import type { ShapeHandle, Vec3 } from 'occt-wasm'

export interface OpenSCADNamespace {
  /** K01: convex hull of a set of shapes. */
  hull(shapes: ShapeHandle[]): Promise<ShapeHandle>
  /** K04: polyhedron from points and faces (face indices fan-triangulated). */
  polyhedron(points: Vec3[], faces: number[][]): Promise<ShapeHandle>
  /** K06: linear extrude with twist and optional scale. */
  twistExtrude(profile: ShapeHandle, height: number, twist: number, scale?: number): Promise<ShapeHandle>
  /** K08: projection cut=true — section by Z=0 plane. */
  projectCut(shape: ShapeHandle): Promise<ShapeHandle>
  /** K09: projection cut=false — orthographic outline projection. */
  projectOutline(shape: ShapeHandle): Promise<ShapeHandle>
  /** K11: surface from interpolated point grid. */
  surfaceInterp(points: Vec3[], rows: number, cols: number): Promise<ShapeHandle>
  /** K11 wrapper: surface from heightmap file (OpenSCAD surface() module). */
  surface(file: string): Promise<ShapeHandle>
  /** K13: hardened 2D offset with recursive fallback on failure. */
  offset2d(profile: ShapeHandle, delta: number, chamfer: boolean): Promise<ShapeHandle>
}

export function createOpenSCADNamespace(): OpenSCADNamespace {
  return {
    hull,
    polyhedron,
    twistExtrude,
    projectCut,
    projectOutline,
    surfaceInterp,
    surface,
    offset2d,
  }
}
