/**
 * 加权语料覆盖率报告。
 *
 * 回答排期问题：按节点**质量**（而非节点**种类**）衡量，锁定的 OpenSCAD CSG 语料
 * 有多少能落地。为什么这个区分重要见 `src/ir/capability.ts` 的 `coverageOf`
 * ——`multmatrix` 一个节点就是 4783 个，而 `roof` 只有 5 个。
 *
 * 同时输出 **v0 范围**口径（决策 2026-10-06：首版只承诺 P0）：首版承诺的节点集合
 * 及其覆盖的语料质量，以及范围外必须报 BLOCKED 的节点。
 *
 * 用法：OPENSCAD_SRC=C:/git/OpenSCAD/openscad npx tsx tests/coverage.ts
 */
import {
  coverageOf,
  isInShippedScope,
  SHIPPED_NODES,
  type CapabilityClass,
} from '../src/ir/capability'
import { corpusRoot } from '../src/__probe__/env'
import { scanVocabulary } from '../src/__probe__/corpus-scan'

const root = corpusRoot()
if (!root) {
  console.error('OPENSCAD_SRC is not set (or does not point at an OpenSCAD checkout).')
  process.exit(1)
}

const { nodes, files } = scanVocabulary(root)
const report = coverageOf(nodes)

console.log(`corpus: ${files} CSG goldens, ${nodes.size} node kinds, ${report.total} nodes`)
for (const key of ['direct', 'helper', 'approximate', 'unsupported'] as CapabilityClass[]) {
  const b = report.byClass[key]
  console.log(
    `  ${key.padEnd(12)} kinds=${String(b.nodes).padStart(2)}  nodes=${String(b.count).padStart(6)}  share=${(b.share * 100).toFixed(2)}%`,
  )
}
console.log(`  blocked      ${report.blockedNodes.join(' ')}`)

// v0 范围口径：首版只承诺 P0，其余一律 BLOCKED。
let shippedCount = 0
const outOfScope = new Map<string, number>()
for (const [node, count] of nodes) {
  if (isInShippedScope(node)) shippedCount += count
  else outOfScope.set(node, count)
}
const shippedShare = shippedCount / report.total
console.log('')
console.log(
  `v0 scope: ${SHIPPED_NODES.length} node kinds, ${shippedCount}/${report.total} nodes = ${(shippedShare * 100).toFixed(2)}%`,
)
console.log(
  `  out-of-scope (BLOCKED in v0): ${[...outOfScope.keys()].sort().join(' ')}`,
)
console.log(
  `  out-of-scope mass: ${report.total - shippedCount} nodes = ${((1 - shippedShare) * 100).toFixed(2)}%`,
)

const top = [...nodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log(`top nodes: ${top.map(([k, v]) => `${k}:${v}`).join(' ')}`)
