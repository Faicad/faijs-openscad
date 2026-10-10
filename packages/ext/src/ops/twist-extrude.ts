/**
 * K06: twistExtrude — linear extrude with twist and optional scale.
 *
 * Uses makeHelixWireHanded to create a helical spine, then sweepFull with
 * a Linear scaling law to extrude the profile along the spine.  The twist
 * angle determines the pitch of the helix; negative twist produces a
 * left-handed helix.
 */
import { getExtKernel } from '../kernel'
import { SweepLaw } from 'occt-wasm'
import type { ShapeHandle } from 'occt-wasm'

/**
 * Extrude a 2D profile with twist and optional scale.
 *
 * @param profile  2D face/wire to extrude.
 * @param height   Extrusion height (Z direction).
 * @param twist    Twist angle in degrees (can be negative).
 * @param scale    Optional scale factor at the top (1 = no scaling).
 * @returns        A solid ShapeHandle.
 */
export async function twistExtrude(
  profile: ShapeHandle,
  height: number,
  twist: number,
  scale?: number,
): Promise<ShapeHandle> {
  const k = await getExtKernel()

  if (height <= 0) {
    return k.makeNullShape()
  }

  // Build helical spine along Z axis.
  const leftHanded = twist < 0
  const absTwist = Math.abs(twist)
  const pitch = absTwist > 1e-10 ? height / (absTwist / 360) : Infinity
  const spine = k.makeHelixWireHanded(
    { x: 0, y: 0, z: 0 },   // origin
    { x: 0, y: 0, z: 1 },   // axis
    pitch,
    height,
    0,                       // radius (spine is along Z)
    leftHanded,
  )

  // Configure sweep options.
  const opts: { law: SweepLaw; lawLength: number; lawEndFactor?: number } = {
    law: SweepLaw.Linear,
    lawLength: height,
  }
  if (scale !== undefined) {
    opts.lawEndFactor = scale
  }

  return k.sweepFull(profile, spine, opts)
}
