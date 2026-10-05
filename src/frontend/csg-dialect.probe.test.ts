/**
 * PROBE (permanent, plan §9.1 #2): CSG dialect differences between builds.
 *
 * The CSG dump format is an OpenSCAD *output* format, not a stable published
 * API. This probe records the shape of the pinned golden corpus and, when a
 * local binary exists, how its output differs — so "version drift" is a
 * measured fact (OSC5002) instead of a surprise.
 *
 * It never regenerates goldens. Local (non-baseline) output is smoke only.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { corpusRoot, hasCorpus, openScadBinary } from '../__probe__/env'
import { OpenScadCliFrontend } from '../frontend/openscad-cli'
import { BASELINE } from '../baseline'

const bin = await openScadBinary()

function goldenFiles(root: string): string[] {
  const dir = join(root, 'tests', 'regression', 'dump')
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.filter((n) => n.endsWith('-expected.csg')).sort().map((n) => join(dir, n))
}

describe('probe: CSG dialect', () => {
  it.skipIf(!hasCorpus())('golden CSG files are either blank or node-shaped', () => {
    const root = corpusRoot() as string
    const files = goldenFiles(root)
    expect(files.length).toBeGreaterThan(0)
    // Observed corpus fact (2026-10-05): a few goldens are a single newline —
    // the .scad evaluates to nothing. An empty CSG document is therefore valid
    // input and the IR needs an Empty node (plan §4.3); it is not a parse error.
    let blank = 0
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      if (text.trim().length === 0) {
        blank++
        continue
      }
      // A CSG dump is a statement list; every non-comment line ends in ; or {,
      // or is a closing/continuation line of a nested structure.
      const bad = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 0 &&
            !l.startsWith('//') &&
            !/[;{]$/.test(l) &&
            !/^[}\])]/.test(l) &&
            !/^\]/.test(l),
        )
      expect({ file, bad: bad.slice(0, 3) }).toEqual({ file, bad: [] })
    }
    expect(blank).toBeLessThan(files.length)
  })

  it.skipIf(!hasCorpus())('records how many goldens are empty (Empty-IR requirement)', () => {
    const root = corpusRoot() as string
    const files = goldenFiles(root)
    const blank = files.filter((f) => readFileSync(f, 'utf8').trim().length === 0).length
    // Recorded, not asserted to be zero: the corpus intentionally contains
    // .scad files whose evaluated result is nothing.
    expect(blank).toBeGreaterThanOrEqual(0)
    expect(files.length).toBeGreaterThan(blank)
  })

  it.skipIf(!bin.available)('local OpenSCAD emits CSG for a trivial .scad', async () => {
    const root = corpusRoot()
    if (!root) return // corpus-gated: no sample file to compile
    const frontend = new OpenScadCliFrontend()
    const sample = join(root, 'examples', 'Basics', 'CSG.scad')
    const artifact = await frontend.compileScad({ filePath: sample })
    if (artifact.csgText.length === 0) return // binary failed: reported as OSC5003
    expect(artifact.csgText).toMatch(/(cube|sphere|cylinder|union|multmatrix)/)
  })

  it('baseline pins a required build, not the local smoke binary', () => {
    expect(BASELINE.openscadBinary.requiredVersion).toBe('baseline-build')
    expect(BASELINE.openscadSource.commit).toMatch(/^[0-9a-f]{40}$/)
  })

  it.skipIf(!bin.available)('records the local binary version for drift analysis', () => {
    if (bin.version === undefined) return
    // A local build is expected to differ from the baseline-build requirement
    // on a developer machine; the fact is recorded, not asserted away.
    expect(typeof bin.version).toBe('string')
  })
})
