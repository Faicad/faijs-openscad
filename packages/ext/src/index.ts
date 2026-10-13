/**
 * @faicad/faijs-openscad-ext â€?OpenSCAD extension library for faijs.
 *
 * Provides OpenSCAD-specific geometric operations (hull, polyhedron, twist
 * extrude, projection, surface interpolation, hardened offset) as a standalone
 * peer library.  Uses the occt-wasm kernel directly via initOcctWasm().
 *
 * Usage (host setup):
 * ```typescript
 * import { createEditorCadNamespace } from '@faicad/faijs/extra'
 * import { createOpenSCADNamespace } from '@faicad/faijs-openscad-ext'
 *
 * rt.registerLib('cad', createEditorCadNamespace(), { default: true })
 * rt.registerLib('openscad', createOpenSCADNamespace())
 * ```
 */
export { createOpenSCADNamespace, type OpenSCADNamespace } from './namespace'
export { getExtKernel, type ExtKernel, type ExtShape, type ExtVec3 } from './kernel'
export { hull } from './ops/hull'
export { polyhedron } from './ops/polyhedron'
export { twistExtrude } from './ops/twist-extrude'
export { projectCut, projectOutline } from './ops/projection'
export { surfaceInterp, surface } from './ops/surface-interp'
export { offset2d } from './ops/offset-hardened'
export { connectEdgesToWires } from './ops/connect-edges'
export { text } from './ops/text'
export { load } from './ops/load'
