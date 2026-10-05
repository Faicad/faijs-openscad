/**
 * Capability classification of CSG nodes (plan §5, §4.3 pass 7).
 *
 * This table is the single place that answers "how do we treat node X today?".
 * It is deliberately separate from the lowering pass so the classification can
 * be asserted by probes (M0) long before the emitter exists (M2), and so a node
 * can never be silently skipped: `unsupported` means BLOCKED, never "ignored".
 *
 * Classes:
 *   direct      — emitted as a plain `cad.*` call
 *   helper      — needs a runtime helper in @faicad/faijs-openscad/runtime
 *   approximate — emitted with a documented, non-equivalent deviation
 *   unsupported — must produce OSC3002 and a BLOCKED manifest entry
 */
import { CSG_NODE_VOCABULARY } from '../csg/dialect'

export type CapabilityClass = 'direct' | 'helper' | 'approximate' | 'unsupported'

export interface CapabilityEntry {
  readonly node: string
  readonly capability: CapabilityClass
  /** Milestone at which this mapping is expected to land. */
  readonly phase: 'P0' | 'P1' | 'P2' | 'P3'
  /** Short, checkable reason. Required for anything that is not `direct`. */
  readonly note: string
}

export const CAPABILITY_TABLE: readonly CapabilityEntry[] = [
  { node: 'cube', capability: 'direct', phase: 'P0', note: 'cad.box(w, d, h, { centered })' },
  { node: 'sphere', capability: 'direct', phase: 'P0', note: 'cad.sphere(r); analytic BREP vs faceted — see OSC3201' },
  { node: 'cylinder', capability: 'direct', phase: 'P0', note: 'cad.cylinder when r1===r2, else cad.cone' },
  { node: 'union', capability: 'direct', phase: 'P0', note: 'cad.union(...children)' },
  { node: 'difference', capability: 'direct', phase: 'P0', note: 'cad.subtract(base, ...tools)' },
  { node: 'intersection', capability: 'direct', phase: 'P0', note: 'cad.intersect(...children)' },
  { node: 'multmatrix', capability: 'direct', phase: 'P0', note: 'cad.applyMatrix(shape, m); invertible affine only' },
  { node: 'group', capability: 'direct', phase: 'P0', note: 'implicit union; compound NOT assumed (see group-semantics probe)' },
  { node: 'square', capability: 'direct', phase: 'P0', note: 'cad.profile rectangle' },
  { node: 'circle', capability: 'direct', phase: 'P0', note: 'cad.profile circle; arc angles in radians' },
  { node: 'polygon', capability: 'direct', phase: 'P0', note: 'cad.profile; paths=undef + hole rules need tests' },
  { node: 'linear_extrude', capability: 'direct', phase: 'P0', note: 'plain extrude only; twist/scale are P2' },
  { node: 'render', capability: 'direct', phase: 'P0', note: 'geometry passthrough; convexity is info only' },
  // 2026-10-06 measured: Shape carries setColor / setOpacity / setAppearance /
  // getAppearance as INSTANCE METHODS (ops-api-inventory §2.5), and calling them
  // works — `setColor('#e53935')` + `setOpacity(0.5)` round-trips through
  // getAppearance(). Appearance is not an op on the script face, which is why
  // this was mis-classified as `approximate` before.
  { node: 'color', capability: 'direct', phase: 'P0', note: 'Shape.setColor / setOpacity instance methods (not an op)' },

  { node: 'rotate_extrude', capability: 'helper', phase: 'P1', note: 'cad.revolve; plane/axis/angle-direction must be verified first' },
  { node: 'polyhedron', capability: 'unsupported', phase: 'P1', note: 'only absent op of 57 probed on the ① face (2026-10-06); BREP/mesh rebuild spike required' },
  { node: 'hull', capability: 'unsupported', phase: 'P1', note: 'cad.convexHull takes points (kernel hullFromPoints), not shapes — no shape-hull equivalent' },
  { node: 'minkowski', capability: 'unsupported', phase: 'P2', note: 'no exact kernel capability; must stay BLOCKED, never approximate silently' },
  { node: 'resize', capability: 'helper', phase: 'P1', note: 'bbox + scale/center; auto rules need OpenSCAD-behaviour tests' },
  { node: 'text', capability: 'unsupported', phase: 'P1', note: 'needs @faicad/faijs-extra + font resolution (OSC3101)' },
  { node: 'import', capability: 'unsupported', phase: 'P1', note: 'external asset; path resolution + supported suffixes' },

  { node: 'projection', capability: 'unsupported', phase: 'P2', note: 'cut=true needs a real 2D face; sectionByPlane only yields curves' },
  // 2026-10-06 measured: faijs `offset` is a 3D FULL-SURFACE offset — a 10mm box
  // with delta=2 becomes 2610.5 mm^3. Applied to a 2D profile it is a NO-OP
  // (area stays exactly 100, bbox unchanged). So OpenSCAD's 2D offset() has no
  // equivalent; the name collision is a trap, not a mapping.
  { node: 'offset', capability: 'unsupported', phase: 'P2', note: 'cad.offset is 3D full-surface (box+2 -> 2610.5) and a NO-OP on 2D profiles — not OpenSCAD 2D offset' },
  { node: 'surface', capability: 'unsupported', phase: 'P2', note: 'heightmap reading + mesh generation; own sub-project' },
  { node: 'fill', capability: 'unsupported', phase: 'P2', note: '2D hole filling rules undefined' },

  { node: 'roof', capability: 'unsupported', phase: 'P3', note: 'experimental OpenSCAD feature' },
]

const TABLE_INDEX = new Map<string, CapabilityEntry>(CAPABILITY_TABLE.map((e) => [e.node, e]))

export function capabilityOf(node: string): CapabilityEntry {
  const hit = TABLE_INDEX.get(node)
  if (hit) return hit
  return {
    node,
    capability: 'unsupported',
    phase: 'P3',
    note: 'unknown node — must be reported, never skipped',
  }
}

export function capabilityClassOf(node: string): CapabilityClass {
  return capabilityOf(node).capability
}

/** Every known CSG node must be classified: an unclassified node is a bug. */
export function unclassifiedNodes(): string[] {
  return CSG_NODE_VOCABULARY.filter((n) => !TABLE_INDEX.has(n))
}

export function nodesWithCapability(c: CapabilityClass): string[] {
  return CAPABILITY_TABLE.filter((e) => e.capability === c).map((e) => e.node)
}

/** Per-class node counts and share, weighted by an observed node histogram. */
export interface CoverageReport {
  readonly total: number
  readonly byClass: Record<CapabilityClass, { nodes: number; count: number; share: number }>
  /** Nodes seen in the corpus that the table classes as `unsupported`. */
  readonly blockedNodes: readonly string[]
}

/**
 * Weight a corpus node histogram by the capability table.
 *
 * Rationale (2026-10-06): raw node-kind counts hide the shape of the work. The
 * OpenSCAD CSG corpus is dominated by a handful of node kinds — `multmatrix`
 * (4783), `group` (4626), `square` (2454), `color` (2431) — so "11 of 26 node
 * kinds are unsupported" sounds alarming while the *mass* they represent is
 * small. This report answers the question that actually drives scheduling:
 * how much of the corpus can land today, by weight.
 */
export function coverageOf(histogram: ReadonlyMap<string, number>): CoverageReport {
  const byClass = {
    direct: { nodes: 0, count: 0, share: 0 },
    helper: { nodes: 0, count: 0, share: 0 },
    approximate: { nodes: 0, count: 0, share: 0 },
    unsupported: { nodes: 0, count: 0, share: 0 },
  } satisfies Record<CapabilityClass, { nodes: number; count: number; share: number }>

  let total = 0
  const blocked: string[] = []
  for (const [node, count] of histogram) {
    const entry = capabilityOf(node)
    total += count
    const bucket = byClass[entry.capability]
    bucket.nodes += 1
    bucket.count += count
    if (entry.capability === 'unsupported') blocked.push(node)
  }
  for (const key of Object.keys(byClass) as CapabilityClass[]) {
    byClass[key].share = total === 0 ? 0 : byClass[key].count / total
  }
  return { total, byClass, blockedNodes: blocked.sort() }
}
