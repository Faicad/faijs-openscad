/**
 * OpenSCAD examples 移植正确性回归（门禁）。
 *
 * 与 `src/csg/corpus-parse.test.ts` 口径一致，且语料是 OpenSCAD 官方 `examples/`
 * （CC0 公共领域，已完整拷贝到 `tests/fixtures/openscad-examples/`）——由 OpenSCAD
 * 外部进程求值为 `.csg`，落在 `tests/fixtures/openscad-examples/csg/` 下（生成脚本见
 * `tests/verify-examples.ts`）。这些 `.csg` 是 CC0 黑盒输入产物，不含任何上游 GPL 源码，
 * 也未使用 OpenSCAD 上游测试文件。
 *
 * 验收口径（与 corpus 回归一致）：
 *   1. 零诊断 —— 任何 OSC1001/1002/1003 都算失败；
 *   2. AST 节点直方图与独立文本扫描逐项相等（防漏/重节点）；
 *   3. 每个 span 都在文本范围内且非反向。
 *
 * 若 csg 目录不存在（未运行 verify-examples.ts --write），整组跳过而非假装通过。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCsg } from '../src/csg/parser'
import { countCsgNodesByName, walkCsg, type CsgNode } from '../src/csg/ast'
import { NODE_LINE } from '../src/__probe__/corpus-scan'

const here = dirname(fileURLToPath(import.meta.url))
const CSG_DIR = join(here, 'fixtures', 'openscad-examples', 'csg')
const hasCsg = existsSync(CSG_DIR)

function csgFiles(): string[] {
  if (!hasCsg) return []
  return readdirSync(CSG_DIR)
    .filter((f) => f.endsWith('.csg'))
    .map((f) => join(CSG_DIR, f))
    .sort()
}

function textHistogram(text: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const r = NODE_LINE.exec(line)
    if (r && r[1]) m.set(r[1], (m.get(r[1]) ?? 0) + 1)
  }
  return m
}

function mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

const files = csgFiles()

describe.skipIf(!hasCsg)('examples: CSG 解析（OpenSCAD examples 语料，需先运行 verify-examples.ts --write）', () => {
  it('语料存在且每个 golden 都零诊断解析成功', () => {
    expect(files.length).toBeGreaterThan(0)
    const failures: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const { diagnostics } = parseCsg(text, { path: file })
      if (diagnostics.length > 0) {
        const first = diagnostics[0]
        failures.push(
          `${file.split(/[\\/]/).pop()} @${first.span?.start.line}:${first.span?.start.column} ${first.code} ${first.message}`,
        )
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
    expect(failures).toHaveLength(0)
  })

  it('AST 节点直方图与独立文本扫描逐项相等', () => {
    const fromAst = new Map<string, number>()
    let nodeTotal = 0
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const { document } = parseCsg(text, { path: file })
      for (const [name, count] of countCsgNodesByName(document)) {
        fromAst.set(name, (fromAst.get(name) ?? 0) + count)
        nodeTotal += count
      }
    }
    const fromText = new Map<string, number>()
    for (const file of files) {
      for (const [name, count] of textHistogram(readFileSync(file, 'utf8'))) {
        fromText.set(name, (fromText.get(name) ?? 0) + count)
      }
    }
    expect(mapsEqual(fromAst, fromText)).toBe(true)
    // 实测 2026-10-06（50 个 OpenSCAD examples，OpenSCAD 2021.01 求值）：12435 个节点。
    expect(nodeTotal).toBe(12435)
  })

  it('每个 span 都在文本范围内且非反向', () => {
    const bad: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const { document } = parseCsg(text, { path: file })
      for (const node of document.nodes) {
        walkCsg(node, (n: CsgNode) => {
          if (n.span.start.offset > n.span.end.offset) bad.push(`${file}:${n.name} 反向 span`)
          if (n.span.end.offset > text.length) bad.push(`${file}:${n.name} span 越界`)
          if (n.span.start.line < 1 || n.span.start.column < 1) {
            bad.push(`${file}:${n.name} 行列非 1-based`)
          }
        })
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
  })
})
