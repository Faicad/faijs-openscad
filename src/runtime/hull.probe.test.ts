/**
 * PROBE (permanent, plan §9.1 #10): hull.
 *
 * ⛔ CORRECTION (2026-10-06, errors doc §0/§1): the previous version asserted
 * "convexHull is not reachable from the TS layer either" — that was measured
 * against the internal 38-key `mod.cad` object, not the ① TS compat face.
 * `convexHull` IS a ① face function.
 *
 * What still holds, and is now measured directly:
 *   - OpenSCAD `hull()` wraps **shapes** (any sub-node set).
 *   - faijs `convexHull` takes a **point set** — the occt kernel method behind it
 *     is literally named `hullFromPoints`. Feeding it a Shape throws
 *     `HULL_FAILED: convexHull failed: points.map is not a function` (measured).
 *   - `hull` / `minkowski` do not exist on either the ① or ② face.
 *
 * So the mapping stays BLOCKED: implementing OpenSCAD hull() over shapes needs
 * either a vertex-extraction layer feeding `convexHull(points)` or a new
 * `defineOp` in a faijs-openscad runtime library. Presence != equivalence.
 */
import { describe, expect, it } from 'vitest'
import { scriptFaceSymbols, tsCompatFaceSymbols } from '../__probe__/faijs-static'
import { capabilityOf } from '../ir/capability'

const scriptFace = scriptFaceSymbols()
const tsFace = tsCompatFaceSymbols()

describe('probe: hull (static)', () => {
  it.skipIf(scriptFace === null)('cad.hull is absent; cad.convexHull exists (script face)', () => {
    const set = scriptFace as Set<string>
    expect(set.has('hull')).toBe(false)
    expect(set.has('convexHull')).toBe(true)
  })

  it.skipIf(tsFace === null)('① face: hull/minkowski absent, convexHull present', () => {
    const set = tsFace as Set<string>
    expect(set.has('hull')).toBe(false)
    expect(set.has('minkowski')).toBe(false)
    expect(set.has('convexHull')).toBe(true)
  })

  it('OpenSCAD hull is classified unsupported until a shape-hull spike passes', () => {
    const entry = capabilityOf('hull')
    expect(entry.capability).toBe('unsupported')
    expect(entry.note).toContain('points')
  })

  it('two disjoint boxes are the canonical hull fixture', () => {
    // The spike must assert that the hull of these two boxes is the box that
    // spans from (0,0,0) to (30,10,10) — a convex hull of shapes, not of points.
    const boxes = [
      { size: [10, 10, 10], at: [0, 0, 0] },
      { size: [10, 10, 10], at: [20, 0, 0] },
    ]
    expect(boxes).toHaveLength(2)
  })
})
