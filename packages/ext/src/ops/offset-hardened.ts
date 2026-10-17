/**
 * K13: offset2d hardened — 2D offset with recursive fallback.
 *
 * Uses offsetWire2D from occt-wasm.  When the offset fails (e.g. self-
 * intersection for large delta), recursively halves the delta and applies
 * the offset in two steps.  This "hardening" pattern matches the v3-plan.
 */
import { getExtKernel } from '../kernel'
import { JoinType } from 'occt-wasm'
import type { ShapeHandle } from 'occt-wasm'

/**
 * Offset a 2D profile by a distance, with recursive hardening.
 *
 * @param profile  2D face or wire to offset.
 * @param delta    Offset distance (positive = outward, negative = inward).
 * @param chamfer  If true, use tangent (chamfer) joins; if false, use arc joins.
 * @returns        An offset ShapeHandle.
 */
export async function offset2d(
  profile: ShapeHandle,
  delta: number,
  chamfer: boolean,
): Promise<ShapeHandle> {
  const k = await getExtKernel()

  // offsetWire2D requires a TopoDS_Wire. OpenSCAD children can arrive as an
  // edge (circle) or a face (polygon/text) — normalise before offsetting.
  let wire = profile
  try {
    if (!k.isWire(profile)) {
      wire = k.isFace(profile) ? k.outerWire(profile) : k.makeWire([profile])
    }
  } catch {
    // keep `profile` as-is; the offset attempt below produces the real error
  }

  const joinType = chamfer ? JoinType.Tangent : JoinType.Arc

  try {
    return k.offsetWire2D(wire, delta, joinType)
  } catch {
    // If delta is too small to halve, rethrow.
    if (Math.abs(delta) < 1e-6) throw new Error('offset2d failed even with near-zero delta')

    // Recursive halving: apply half the offset, then the other half.
    const half = delta / 2
    const intermediate = await offset2d(profile, half, chamfer)
    return offset2d(intermediate, half, chamfer)
  }
}
