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
import { text } from './ops/text'
import { load } from './ops/load'
import { sphere as facetedSphere, cylinder as facetedCylinder, cone as facetedCone } from './ops/faceted-primitives'
import type { ShapeHandle, Vec3 } from 'occt-wasm'

export interface OpenSCADNamespace {
  /** K01: convex hull of a set of shapes. */
  hull(shapes: ShapeHandle[]): Promise<ShapeHandle>
  /** K02: 2D text profile from font rendering. */
  text(text: string, opts?: { size?: number; font?: string }): Promise<ShapeHandle>
  /** K03: external mesh asset loading (STL/DXF). */
  load(opts: { file: string }): Promise<ShapeHandle>
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
  surface(file: string, center?: boolean): Promise<ShapeHandle>
  /** K13: hardened 2D offset with recursive fallback on failure. */
  offset2d(profile: ShapeHandle, delta: number, chamfer: boolean): Promise<ShapeHandle>
  /** K14: OpenSCAD 兼容刻面球（n 经线 × floor(n/2) 奇倍数纬环）。 */
  sphere(radius: number, opts?: { segments?: number; center?: [number, number, number] }): Promise<ShapeHandle>
  /** K15: OpenSCAD 兼容刻面圆柱 / 棱台（n 段 + 扇形封盖）。 */
  cylinder(radius: number, height: number, opts?: { segments?: number; radiusTop?: number; centered?: boolean }): Promise<ShapeHandle>
  /** K16: OpenSCAD 兼容刻面圆锥（半径可退化为锥尖）。 */
  cone(radiusBottom: number, radiusTop: number, height: number, opts?: { segments?: number; centered?: boolean }): Promise<ShapeHandle>
}

export function createOpenSCADNamespace(): OpenSCADNamespace {
  return {
    hull,
    text,
    load,
    polyhedron,
    twistExtrude,
    projectCut,
    projectOutline,
    surfaceInterp,
    surface,
    offset2d,
    sphere: facetedSphere,
    cylinder: facetedCylinder,
    cone: facetedCone,
  }
}
