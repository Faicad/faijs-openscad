/**
 * PROBE (permanent, plan §9.1 #3): CSG node vocabulary of the corpus.
 *
 * The dialect table in `src/csg/dialect.ts` is an observation of real corpus
 * output, not an invented list. This probe re-derives the vocabulary from the
 * pinned OpenSCAD checkout and fails when a new node name appears — that is the
 * signal to review the dialect, not to silently ignore the node.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CSG_NODE_VOCABULARY, isKnownCsgNode } from './dialect'
import { coverageOf } from '../ir/capability'
import { corpusRoot, hasCorpus } from '../__probe__/env'

const NODE_LINE = /^\s*[%#!*]?([A-Za-z_][A-Za-z0-9_]*)\s*\(/
const MODIFIER_LINE = /^\s*([%#!*])/

function corpusFiles(root: string): string[] {
  const dump = join(root, 'tests', 'regression', 'dump')
  const dumpExamples = join(root, 'tests', 'regression', 'dump-examples')
  const out: string[] = []
  for (const dir of [dump, dumpExamples]) {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const n of names) {
      if (n.endsWith('-expected.csg')) out.push(join(dir, n))
    }
  }
  return out.sort()
}

export function scanVocabulary(root: string): {
  nodes: Map<string, number>
  modifiers: Map<string, number>
  files: number
} {
  const nodes = new Map<string, number>()
  const modifiers = new Map<string, number>()
  let files = 0
  for (const file of corpusFiles(root)) {
    files++
    const text = readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = NODE_LINE.exec(line)
      if (m) nodes.set(m[1], (nodes.get(m[1]) ?? 0) + 1)
      const mod = MODIFIER_LINE.exec(line)
      if (mod) modifiers.set(mod[1], (modifiers.get(mod[1]) ?? 0) + 1)
    }
  }
  return { nodes, modifiers, files }
}

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

    // Pinned 2026-10-06 over the 225 goldens (17624 nodes, 26 kinds): ~97% of the
    // node mass is `direct` (incl. appearance-by-instance-method), and the
    // `unsupported` remainder is ~2.3% across 401 nodes. `resize` is `helper`
    // (bbox + scale), so it is NOT in the blocked set.
    expect(report.total).toBeGreaterThan(10_000)
    expect(nodes.size).toBe(26)
    expect(report.byClass.direct.share).toBeGreaterThan(0.8)
    expect(report.byClass.unsupported.share).toBeLessThan(0.05)
    expect(report.blockedNodes).toEqual(
      ['fill', 'hull', 'import', 'minkowski', 'offset', 'polyhedron', 'projection', 'roof', 'surface', 'text'].sort(),
    )
  })
})
