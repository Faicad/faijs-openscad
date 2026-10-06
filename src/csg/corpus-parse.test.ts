/**
 * 语料回归（M1 的核心验收门禁）：225 个 `*-expected.csg` 全部可解析。
 *
 * 「能解析」在这里有明确的量化含义，不是「没抛异常」：
 *   1. 零诊断 —— 任何 OSC1001/1002/1003 都算失败；
 *   2. **节点直方图必须与独立的文本扫描逐项相等** —— 这是防止「解析器悄悄
 *      漏掉或重复某些节点」的关键断言。两份统计走完全不同的代码路径
 *      （正则逐行扫描 vs 递归下降 + AST 遍历），只有在都正确时才会一致；
 *   3. 每个 span 都落在文本范围内，且 `terminator` 与 `bodySpan` 自洽。
 *
 * 需要 `OPENSCAD_SRC`；未设置时整组跳过而不是假装通过。
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCsg } from './parser'
import { countCsgNodesByName, walkCsg, type CsgNode } from './ast'
import { corpusFiles, NODE_LINE, scanVocabulary } from '../__probe__/corpus-scan'
import { corpusRoot, hasCorpus } from '../__probe__/env'

const root = corpusRoot()
const files = root === undefined ? [] : corpusFiles(root)

/** 以该节点为根的子树深度（叶子为 1）。 */
function depthOf(node: CsgNode): number {
  let deepest = 0
  for (const child of node.children) deepest = Math.max(deepest, depthOf(child))
  return deepest + 1
}

/** 整篇文档的最大嵌套深度。 */
function documentDepth(nodes: readonly CsgNode[]): number {
  let deepest = 0
  for (const node of nodes) deepest = Math.max(deepest, depthOf(node))
  return deepest
}

describe.skipIf(!hasCorpus())('corpus: CSG 解析（需 OPENSCAD_SRC）', () => {
  it('语料规模与基线一致：225 个 golden', () => {
    expect(files).toHaveLength(225)
  })

  it('每个 golden 都零诊断解析成功', () => {
    const failures: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const { diagnostics } = parseCsg(text, { path: file })
      if (diagnostics.length > 0) {
        const first = diagnostics[0]
        failures.push(
          `${basename(file)} @${first.span?.start.line}:${first.span?.start.column} ${first.code} ${first.message}`,
        )
      }
    }
    // 只打印前若干条，避免一次失败刷屏。
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
    // 文本侧直方图由 scanVocabulary 独立产出（正则逐行扫描），与 AST 遍历
    // 走的是完全不同的代码路径。
    const fromText = scanVocabulary(root as string).nodes

    const names = [...new Set([...fromAst.keys(), ...fromText.keys()])].sort()
    const mismatches = names
      .filter((n) => (fromAst.get(n) ?? 0) !== (fromText.get(n) ?? 0))
      .map((n) => `${n}: ast=${fromAst.get(n) ?? 0} text=${fromText.get(n) ?? 0}`)

    expect(mismatches).toEqual([])
    // 与覆盖率报告同一口径：17653 个节点、26 种。
    // 这个数字曾经是 17624 —— 差在 29 个「修饰符后有制表符」的节点上
    // （`%\tcylinder(...)`），文本扫描侧漏检，ast 侧才是对的。
    expect(nodeTotal).toBe(17653)
    expect(fromAst.size).toBe(26)
  })

  it('修饰符的两种写法都不会让任一统计漏检（实测 29 例）', () => {
    // 这 29 例是「AST 直方图 vs 文本直方图」对账时暴露出来的，拆开看是两类：
    //   · 28 例「修饰符 + 空白 + 名字」，如 `%\tcylinder(...)`
    //   ·  1 例「两个修饰符紧贴名字」，如 `%#multmatrix(...)`
    // 旧正则 `[%#!*]?` 两类都漏：既只允许一个修饰符，也不允许中间出现空白。
    let spacedAfterModifier = 0
    let stackedModifiers = 0
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const line of text.split(/\r?\n/)) {
        if (!/^\s*[%#!*]*\s*[A-Za-z_]/.test(line)) continue
        if (/^\s*[%#!*]+\s+[A-Za-z_]/.test(line)) spacedAfterModifier++
        else if (/^\s*[%#!*]{2,}[A-Za-z_]/.test(line)) stackedModifiers++
        else continue
        expect(NODE_LINE.test(line), `${basename(file)}: ${line.trim()}`).toBe(true)
      }
    }
    expect(spacedAfterModifier).toBe(28)
    expect(stackedModifiers).toBe(1)
  })

  it('每个 span 都在文本范围内且非反向', () => {
    const bad: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const { document } = parseCsg(text, { path: file })
      for (const node of document.nodes) {
        walkCsg(node, (n) => {
          if (n.span.start.offset > n.span.end.offset) bad.push(`${basename(file)}:${n.name} 反向 span`)
          if (n.span.end.offset > text.length) bad.push(`${basename(file)}:${n.name} span 越界`)
          if (n.span.start.line < 1 || n.span.start.column < 1) {
            bad.push(`${basename(file)}:${n.name} 行列非 1-based`)
          }
        })
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
  })

  it('terminator 与 bodySpan 自洽（有花括号必有区间，反之亦然）', () => {
    const bad: string[] = []
    for (const file of files) {
      const { document } = parseCsg(readFileSync(file, 'utf8'), { path: file })
      for (const node of document.nodes) {
        walkCsg(node, (n) => {
          const braced = n.terminator === 'braces'
          if (braced !== (n.bodySpan !== undefined)) bad.push(`${basename(file)}:${n.name}`)
          if (!braced && n.children.length > 0) bad.push(`${basename(file)}:${n.name} 分号结尾却有子节点`)
        })
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
  })

  it('记录语料的实际形状（节点总数、节点种类、最大嵌套深度）', () => {
    let nodeTotal = 0
    let deepest = 0
    const kinds = new Set<string>()
    for (const file of files) {
      const { document } = parseCsg(readFileSync(file, 'utf8'), { path: file })
      for (const [name, count] of countCsgNodesByName(document)) {
        kinds.add(name)
        nodeTotal += count
      }
      deepest = Math.max(deepest, documentDepth(document.nodes))
    }
    // 实测 2026-10-06（修正扫描器后）：17653 个节点、26 种、最深 27 层
    // （for-tests 的 group 叠罗汉）。
    expect(nodeTotal).toBe(17653)
    expect(kinds.size).toBe(26)
    expect(deepest).toBeGreaterThan(5)
    expect(deepest).toBeLessThan(100)
  })
})
