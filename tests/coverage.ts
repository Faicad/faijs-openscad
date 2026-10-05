/**
 * Weighted corpus coverage report.
 *
 * Answers the scheduling question: how much of the pinned OpenSCAD CSG corpus
 * can land today, by node mass — not by node-kind count. See
 * `src/ir/capability.ts` `coverageOf` for why the distinction matters
 * (`multmatrix` alone is 4783 nodes while `roof` is 5).
 *
 * Usage:  OPENSCAD_SRC=C:/git/OpenSCAD/openscad npx tsx tests/coverage.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { coverageOf, type CapabilityClass } from '../src/ir/capability'
import { corpusRoot } from '../src/__probe__/env'

const NODE_LINE = /^\s*[%#!*]?([A-Za-z_][A-Za-z0-9_]*)\s*\(/

function histogram(root: string): { nodes: Map<string, number>; files: number } {
  const nodes = new Map<string, number>()
  let files = 0
  for (const dir of [
    join(root, 'tests', 'regression', 'dump'),
    join(root, 'tests', 'regression', 'dump-examples'),
  ]) {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('-expected.csg')) continue
      files++
      for (const line of readFileSync(join(dir, name), 'utf8').split(/\r?\n/)) {
        const m = NODE_LINE.exec(line)
        if (m) nodes.set(m[1], (nodes.get(m[1]) ?? 0) + 1)
      }
    }
  }
  return { nodes, files }
}

const root = corpusRoot()
if (!root) {
  console.error('OPENSCAD_SRC is not set (or does not point at an OpenSCAD checkout).')
  process.exit(1)
}

const { nodes, files } = histogram(root)
const report = coverageOf(nodes)

console.log(`corpus: ${files} CSG goldens, ${nodes.size} node kinds, ${report.total} nodes`)
for (const key of ['direct', 'helper', 'approximate', 'unsupported'] as CapabilityClass[]) {
  const b = report.byClass[key]
  console.log(
    `  ${key.padEnd(12)} kinds=${String(b.nodes).padStart(2)}  nodes=${String(b.count).padStart(6)}  share=${(b.share * 100).toFixed(2)}%`,
  )
}
console.log(`  blocked      ${report.blockedNodes.join(' ')}`)

const top = [...nodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log(`top nodes: ${top.map(([k, v]) => `${k}:${v}`).join(' ')}`)
