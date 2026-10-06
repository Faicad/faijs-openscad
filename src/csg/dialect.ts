/**
 * Observed CSG node vocabulary (plan §2.2).
 *
 * Source of truth: the 26-node CSG vocabulary (container/leaf classes) derived from the MCAD verification corpus
 * pinned by `src/baseline.ts`, cross-checked by
 * `src/csg/csg-node-vocabulary.probe.test.ts`. This is an *observation*, not a
 * promise: if the corpus grows a new node name, that probe fails on purpose so
 * the dialect is reviewed instead of silently ignored.
 *
 * Note: OpenSCAD's CSG dump already folds `translate` / `rotate` / `scale` /
 * `mirror` into `multmatrix`, so they are NOT part of the CSG vocabulary even
 * though they are part of the .scad language.
 */

export type CsgNodeCategory =
  | 'structure'
  | 'primitive3d'
  | 'primitive2d'
  | 'boolean'
  | 'transform'
  | 'extrude'
  | 'advanced'
  | 'appearance'

export interface CsgNodeSpec {
  readonly name: string
  readonly category: CsgNodeCategory
  /** Whether the node can carry children (`{ ... }`) or is a leaf (`;`). */
  readonly kind: 'container' | 'leaf'
}

export const CSG_NODE_SPECS: readonly CsgNodeSpec[] = [
  { name: 'group', category: 'structure', kind: 'container' },
  { name: 'cube', category: 'primitive3d', kind: 'leaf' },
  { name: 'sphere', category: 'primitive3d', kind: 'leaf' },
  { name: 'cylinder', category: 'primitive3d', kind: 'leaf' },
  { name: 'polyhedron', category: 'primitive3d', kind: 'leaf' },
  { name: 'square', category: 'primitive2d', kind: 'leaf' },
  { name: 'circle', category: 'primitive2d', kind: 'leaf' },
  { name: 'polygon', category: 'primitive2d', kind: 'leaf' },
  { name: 'text', category: 'primitive2d', kind: 'leaf' },
  { name: 'union', category: 'boolean', kind: 'container' },
  { name: 'difference', category: 'boolean', kind: 'container' },
  { name: 'intersection', category: 'boolean', kind: 'container' },
  { name: 'multmatrix', category: 'transform', kind: 'container' },
  { name: 'linear_extrude', category: 'extrude', kind: 'container' },
  { name: 'rotate_extrude', category: 'extrude', kind: 'container' },
  { name: 'projection', category: 'extrude', kind: 'container' },
  { name: 'offset', category: 'extrude', kind: 'container' },
  { name: 'hull', category: 'advanced', kind: 'container' },
  { name: 'minkowski', category: 'advanced', kind: 'container' },
  { name: 'resize', category: 'advanced', kind: 'container' },
  { name: 'roof', category: 'advanced', kind: 'container' },
  { name: 'surface', category: 'advanced', kind: 'leaf' },
  { name: 'import', category: 'advanced', kind: 'leaf' },
  { name: 'fill', category: 'advanced', kind: 'container' },
  { name: 'render', category: 'advanced', kind: 'container' },
  { name: 'color', category: 'appearance', kind: 'container' },
]

export const CSG_NODE_VOCABULARY: readonly string[] = CSG_NODE_SPECS.map((s) => s.name)

const SPEC_INDEX = new Map<string, CsgNodeSpec>(CSG_NODE_SPECS.map((s) => [s.name, s]))

export function csgNodeSpec(name: string): CsgNodeSpec | undefined {
  return SPEC_INDEX.get(name)
}

export function isKnownCsgNode(name: string): boolean {
  return SPEC_INDEX.has(name)
}

/** Modifiers that can survive into a CSG dump (`!` already selected the root). */
export const CSG_MODIFIERS = ['%', '#'] as const
export type CsgModifier = (typeof CSG_MODIFIERS)[number]

export function isCsgModifier(ch: string): ch is CsgModifier {
  return ch === '%' || ch === '#'
}
