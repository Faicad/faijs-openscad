/**
 * 首版交付范围的守门测试（决策 2026-10-06：**首版只承诺 P0**）。
 *
 * 存在的理由：范围承诺最容易在文档里腐烂 —— 文档说「只承诺 P0」，代码却悄悄
 * 把 `rotate_extrude` 也生成出来，等下游跑出错误的几何才发现。这里把承诺变成
 * 断言，任何扩大/缩小都会让测试失败，必须显式改这条测试。
 *
 * 两条核心不变式：
 *   I1. v0 范围内**全部是 `direct`** —— 生成物只依赖 `@faicad/faijs` ① 面，
 *       不需要任何运行时 helper 库。
 *   I2. v0 范围**等价于 `direct` 全集** —— 不存在「已 direct 但不在承诺范围内」
 *       的节点，也不存在「在范围内但不是 direct」的节点。
 */
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_TABLE,
  SHIPPED_NODES,
  SHIPPED_PHASE,
  coverageOf,
  isInShippedScope,
  nodesWithCapability,
  outOfShippedScope,
  shippedStatusOf,
  type CapabilityClass,
} from './capability'
import { scanVocabulary } from '../__probe__/corpus-scan'
import { corpusRoot, hasCorpus } from '../__probe__/env'

describe('shipped scope: v0 只承诺 P0', () => {
  it('I1: P0 范围内没有 helper / approximate / unsupported', () => {
    const notDirect = CAPABILITY_TABLE.filter(
      (e) => e.phase === SHIPPED_PHASE && e.capability !== 'direct',
    )
    // 失败意味着 v0 要么需要写 runtime helper，要么要交付近似几何 ——
    // 两者都是对「只承诺 P0」的扩大，必须显式改这条测试并同步 README。
    expect(notDirect.map((e) => `${e.node}:${e.capability}`)).toEqual([])
  })

  it('I2: v0 范围恰好等于 direct 全集', () => {
    expect([...SHIPPED_NODES].sort()).toEqual([...nodesWithCapability('direct')].sort())
  })

  it('v0 不做任何近似交付（approximate 是空集）', () => {
    // 首版宁可 BLOCKED 也不产出「看起来能跑但几何不同」的代码。
    expect(nodesWithCapability('approximate')).toEqual([])
  })

  it('范围名单由能力表派生，没有第二份手工维护的清单', () => {
    const derived = CAPABILITY_TABLE.filter((e) => e.phase === SHIPPED_PHASE).map((e) => e.node)
    expect([...SHIPPED_NODES]).toEqual(derived)
    expect(new Set(SHIPPED_NODES).size).toBe(SHIPPED_NODES.length)
    expect(SHIPPED_NODES.length).toBeGreaterThan(0)
  })

  it('v0 范围内的节点判定为 shipped，范围外的判定为 blocked-out-of-scope', () => {
    for (const node of SHIPPED_NODES) expect(shippedStatusOf(node)).toBe('shipped')
    for (const node of outOfShippedScope()) {
      expect(shippedStatusOf(node)).toBe('blocked-out-of-scope')
      expect(isInShippedScope(node)).toBe(false)
    }
    // 未知节点（表里没有的）也必须落到 blocked，不能默认放行。
    expect(shippedStatusOf('no_such_node')).toBe('blocked-out-of-scope')
  })

  it('范围外的每个节点都带可报告的理由（不能静默跳过）', () => {
    for (const node of outOfShippedScope()) {
      const entry = CAPABILITY_TABLE.find((e) => e.node === node)
      expect(entry, `${node} 必须出现在能力表里`).toBeDefined()
      expect(entry?.note.trim().length ?? 0).toBeGreaterThan(0)
    }
  })

  it('范围外的节点分类必须落在预期集合内（防止误标 direct 后绕过 I2）', () => {
    const allowed: CapabilityClass[] = ['helper', 'approximate', 'unsupported']
    for (const node of outOfShippedScope()) {
      const entry = CAPABILITY_TABLE.find((e) => e.node === node)
      expect(allowed, `${node} 不应出现在 v0 范围外却又是 direct`).toContain(entry?.capability)
    }
  })
})

describe('shipped scope: 语料加权覆盖（需 OPENSCAD_SRC）', () => {
  it.skipIf(!hasCorpus())('v0 范围覆盖语料节点质量 > 93%（2026-10-06 实测 97.01%）', () => {
    const { nodes, files } = scanVocabulary(corpusRoot() as string)
    const report = coverageOf(nodes)

    let shipped = 0
    let blocked = 0
    const blockedNodes = new Set<string>()
    for (const [node, count] of nodes) {
      if (isInShippedScope(node)) shipped += count
      else {
        blocked += count
        blockedNodes.add(node)
      }
    }

    expect(files).toBeGreaterThan(200)
    expect(report.total).toBeGreaterThan(10_000)

    const share = shipped / report.total
    // 实测 2026-10-06：97.01% direct / 0.59% helper / 2.39% unsupported（17653 节点）。
    // 阈值取 93% 而不是 97%：给语料自身的抖动留余量，但任何结构性退化
    // （比如有人把某个高频节点移出 P0）都会撞上这条线。
    expect(share).toBeGreaterThan(0.93)

    // 范围外的质量必须很小 —— 首版「只承诺 P0」之所以可接受，正是因为这个数。
    expect(1 - share).toBeLessThan(0.07)

    // 固化「范围外的节点是哪些」，让变化必须被看见。
    expect([...blockedNodes].sort()).toEqual(
      ['fill', 'hull', 'import', 'minkowski', 'offset', 'polyhedron', 'projection', 'resize', 'roof', 'rotate_extrude', 'surface', 'text'].sort(),
    )
    expect(blocked).toBeGreaterThan(0)
  })
})
