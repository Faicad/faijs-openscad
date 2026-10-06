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
  { file: 'emit/faijs-apply-matrix.probe.test.ts', topic: 'applyMatrix = multmatrix 落点（含裸数字/剪切/奇异）' },
  { file: 'emit/units.probe.test.ts', topic: 'units + literal policy' },
  { file: 'ir/group-semantics.probe.test.ts', topic: 'group/root vs union vs compound' },
  { file: 'ir/faceting.probe.test.ts', topic: '$fn/$fa/$fs faceting fidelity' },
  { file: 'ir/rotate-extrude.probe.test.ts', topic: 'rotate_extrude → revolve axis/angle' },
  { file: 'ir/matrix-shape.probe.test.ts', topic: 'multmatrix 矩阵构成（v0 变换覆盖面）' },
  { file: 'runtime/polyhedron.probe.test.ts', topic: 'polyhedron support state' },
  { file: 'runtime/hull.probe.test.ts', topic: 'hull vs convexHull semantics' },
]

/**
 * M1 起新增的关键测试。它们不是 probe（不依赖外部能力，因此不需要门控），
 * 但同样属于「不可静默删除」的资产 —— 每一条都守着一个一旦丢失就再也发现
 * 不了回归的不变式：词法边界、错误恢复的终止性、语料双路对账、v0 范围承诺。
 */
export const REQUIRED_TESTS: readonly { file: string; guards: string }[] = [
  { file: 'csg/lexer.test.ts', guards: '词法边界：科学计数法 / 转义 / 未闭合 / 非法字符' },
  { file: 'csg/parser.test.ts', guards: '语法与错误恢复：36 个畸形输入的终止性' },
  { file: 'csg/corpus-parse.test.ts', guards: '语料回归 + AST/文本双路直方图对账（225 golden）' },
  { file: 'ir/capability.test.ts', guards: '能力表自洽性' },
  { file: 'ir/shipped-scope.test.ts', guards: 'v0 只承诺 P0 的范围守门' },
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

describe('test inventory', () => {
  it('M1 关键测试仍然存在（不允许用后即删）', () => {
    const missing = REQUIRED_TESTS.filter((t) => !existsSync(join(SRC, t.file))).map((t) => t.file)
    expect(missing).toEqual([])
  })

  it('每条关键测试都写明了它守住的不变式', () => {
    for (const t of REQUIRED_TESTS) expect(t.guards.length).toBeGreaterThan(4)
  })
})
