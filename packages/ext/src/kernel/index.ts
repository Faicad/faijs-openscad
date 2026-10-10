/**
 * Kernel access for the openscad extension library.
 *
 * Pattern (reference: faijs-gears): call initOcctWasm() from faijs to get the
 * raw OcctKernel instance, then use kernel methods directly.  We do NOT touch
 * faijs core — this is a standalone peer library.
 */
import { initOcctWasm } from '@faicad/faijs/occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'

/** The raw OCCT kernel handle — same type faijs uses internally. */
export type ExtKernel = OcctKernel
export type ExtShape = ShapeHandle
export type ExtVec3 = Vec3

let cached: Promise<OcctKernel> | undefined

/**
 * Get the OCCT kernel (initialises on first call, reuses afterwards).
 *
 * This is the single entry point for all extension ops.  Each op calls
 * `const k = await getExtKernel()` to obtain the kernel, then uses its
 * methods directly.
 */
export function getExtKernel(): Promise<OcctKernel> {
  if (cached === undefined) {
    cached = initOcctWasm()
  }
  return cached
}
