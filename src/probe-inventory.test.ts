/**
 * Inventory guard for the permanent probes (plan §9.1 T006, user rule:
 * "有用的探测必须保留为测试代码").
 *
 * A probe that gets deleted because "the investigation is over" is exactly the
 * regression this file exists to prevent. If a probe must move, update the list
 * here in the same commit.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname)

/** The probes mandated by the development plan (§9.1) + the 2026-10-06 face probe. */
export const REQUIRED_PROBES: readonly { file: string; topic: string }[] = [
  { file: 'frontend/openscad-bin.probe.test.ts', topic: 'OpenSCAD binary discovery + version' },
  { file: 'frontend/csg-dialect.probe.test.ts', topic: 'CSG dialect drift between builds' },
  { file: 'csg/csg-node-vocabulary.probe.test.ts', topic: 'corpus node vocabulary' },
  { file: 'emit/faijs-capability.probe.test.ts', topic: 'faijs three API faces capability' },
  { file: 'emit/faijs-face-measurements.probe.test.ts', topic: '① face under Host assembly (measurements)' },
  { file: 'emit/units.probe.test.ts', topic: 'units + literal policy' },
  { file: 'ir/group-semantics.probe.test.ts', topic: 'group/root vs union vs compound' },
  { file: 'ir/faceting.probe.test.ts', topic: '$fn/$fa/$fs faceting fidelity' },
  { file: 'ir/rotate-extrude.probe.test.ts', topic: 'rotate_extrude → revolve axis/angle' },
  { file: 'runtime/polyhedron.probe.test.ts', topic: 'polyhedron support state' },
  { file: 'runtime/hull.probe.test.ts', topic: 'hull vs convexHull semantics' },
]

describe('probe inventory', () => {
  it('all mandated probes still exist', () => {
    const missing = REQUIRED_PROBES.filter((p) => !existsSync(join(SRC, p.file))).map((p) => p.file)
    expect(missing).toEqual([])
  })

  it('every probe file is actually a vitest file (name convention)', () => {
    for (const p of REQUIRED_PROBES) {
      expect(p.file.endsWith('.probe.test.ts')).toBe(true)
    }
  })
})
