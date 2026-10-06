/**
 * PROBE (permanent, plan §9.1 #3): CSG node vocabulary of the corpus.
 *
 * The dialect table in `src/csg/dialect.ts` is an observation of real corpus
 * output, not an invented list. This probe re-derives the vocabulary from the
 * pinned OpenSCAD checkout and fails when a new node name appears — that is the
 * signal to review the dialect, not to silently ignore the node.
 */
import { describe, expect, it } from 'vitest'
import { CSG_NODE_VOCABULARY, isKnownCsgNode } from './dialect'
import { coverageOf } from '../ir/capability'
import { corpusRoot, hasCorpus } from '../__probe__/env'
import { scanVocabulary } from '../__probe__/corpus-scan'

// 扫描实现已抽到 `../__probe__/corpus-scan`，与 v0 范围守门（`ir/shipped-scope.test.ts`）
// 和覆盖率报告（`tests/coverage.ts`）共用同一份，避免三处数字漂移。此处重新导出，
// 保持既有引用路径可用。
export { scanVocabulary }

describe('probe: CSG node vocabulary', () => {
  it.skipIf(!hasCorpus())('corpus vocabulary is a subset of the dialect table', () => {
    const root = corpusRoot()
    expect(root).toBeTruthy()
    const { nodes, files } = scanVocabulary(root as string)
    expect(files).toBeGreaterThan(0)

    const unknown = [...nodes.keys()].filter((n) => !isKnownCsgNode(n)).sort()
    // Failing here means the corpus grew a node: review + extend dialect.ts.
    expect(unknown).toEqual([])

    // The observed vocabulary must stay pinned in the dialect table.
    for (const name of CSG_NODE_VOCABULARY) expect(isKnownCsgNode(name)).toBe(true)
  })

  it.skipIf(!hasCorpus())('records the observed vocabulary and modifier set', () => {
    const root = corpusRoot() as string
    const { nodes, modifiers } = scanVocabulary(root)
    expect(nodes.size).toBeGreaterThan(0)
    // `!` and `*` are resolved by OpenSCAD before dumping; only `%`/`#` survive.
    for (const m of modifiers.keys()) expect(['%', '#']).toContain(m)
  })

  it('dialect table stays internally consistent', () => {
    expect(new Set(CSG_NODE_VOCABULARY).size).toBe(CSG_NODE_VOCABULARY.length)
    for (const n of CSG_NODE_VOCABULARY) expect(n).toMatch(/^[a-z_][a-z0-9_]*$/)
  })

  it.skipIf(!hasCorpus())('records the weighted coverage the plan is scheduled against', () => {
    const { nodes } = scanVocabulary(corpusRoot() as string)
    const report = coverageOf(nodes)

    // Pinned 2026-10-06 over the 225 goldens (17653 nodes, 26 kinds): ~97% of the
    // node mass is `direct` (incl. appearance-by-instance-method), and the
    // `unsupported` remainder is ~2.4% across 422 nodes. `resize` is `helper`
    // (bbox + scale), so it is NOT in the blocked set.
    // 17653 而非更早的 17624：旧扫描正则漏了 29 个「修饰符后有空白 / 多修饰符」
    // 的节点，详见 src/__probe__/corpus-scan.ts 的 NODE_LINE 注释。
    expect(report.total).toBeGreaterThan(10_000)
    expect(nodes.size).toBe(26)
    expect(report.byClass.direct.share).toBeGreaterThan(0.8)
    expect(report.byClass.unsupported.share).toBeLessThan(0.05)
    expect(report.blockedNodes).toEqual(
      ['fill', 'hull', 'import', 'minkowski', 'offset', 'polyhedron', 'projection', 'roof', 'surface', 'text'].sort(),
    )
  })
})
