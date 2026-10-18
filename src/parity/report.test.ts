/**
 * Tests for analytic classification and report generation (M4, T403-T406).
 */
import { describe, expect, it } from 'vitest'
import { computeMetrics, type StlTriangle } from './stl-metrics'
import { compareMetrics } from './compare-mesh'
import { classifyAnalytic, buildReport, renderMarkdown, renderJson, ANALYTIC_FACET_THRESHOLD } from './report'
import type { ParityEntry } from './report'

// Helper: make a mesh that looks like a faceted sphere (smaller volume than analytic)
const facetedSphereTriangles: StlTriangle[] = [
  { v0: [10, 0, 0], v1: [0, 10, 0], v2: [0, 0, 10] },
  { v0: [10, 0, 0], v1: [0, 0, 10], v2: [0, -10, 0] },
  { v0: [10, 0, 0], v1: [0, -10, 0], v2: [0, 0, -10] },
  { v0: [10, 0, 0], v1: [0, 0, -10], v2: [0, 10, 0] },
  { v0: [-10, 0, 0], v1: [0, 0, 10], v2: [0, 10, 0] },
  { v0: [-10, 0, 0], v1: [0, -10, 0], v2: [0, 0, 10] },
  { v0: [-10, 0, 0], v1: [0, 0, -10], v2: [0, -10, 0] },
  { v0: [-10, 0, 0], v1: [0, 10, 0], v2: [0, 0, -10] },
]

// Analytic sphere (exact volume: 4/3 * π * 10³ ≈ 4188.79)
// We simulate this with a high-resolution mesh — but for testing the
// classification logic, we just need two meshes where one has
// "smaller volume" (faceted) and one has "exact volume" (analytic).

// Helper: closed box mesh centered at origin, 10x10x10 (volume 1000)
function boxTriangles(h = 5): StlTriangle[] {
  const c: Array<[number, number, number]> = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ]
  const quads: Array<[number, number, number, number]> = [
    [0, 3, 2, 1], [4, 5, 6, 7], // bottom, top
    [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], // sides
  ]
  const tris: StlTriangle[] = []
  for (const [a, b, cc, d] of quads) {
    tris.push({ v0: c[a], v1: c[b], v2: c[cc] })
    tris.push({ v0: c[a], v1: c[cc], v2: c[d] })
  }
  return tris
}

// Helper: n-gon prism (circumradius r, height 2h) centered at origin.
// With n divisible by 4 the vertices land on ±axes, so bbox == [-r,r]^2 x [-h,h]
// (same bbox as boxTriangles(r)) while volume is smaller (inscribed polytope).
function prismTriangles(n: number, r: number, h: number): StlTriangle[] {
  const ring = (z: number) =>
    Array.from({ length: n }, (_, i) => {
      const th = (i * 2 * Math.PI) / n
      return [r * Math.cos(th), r * Math.sin(th), z] as [number, number, number]
    })
  const top = ring(h)
  const bottom = ring(-h)
  const tris: StlTriangle[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    tris.push({ v0: bottom[i], v1: bottom[j], v2: top[j] })
    tris.push({ v0: bottom[i], v1: top[j], v2: top[i] })
  }
  // caps: triangle fans from center vertices (wound outward)
  const topC: [number, number, number] = [0, 0, h]
  const botC: [number, number, number] = [0, 0, -h]
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    tris.push({ v0: topC, v1: top[i], v2: top[j] })
    tris.push({ v0: botC, v1: bottom[j], v2: bottom[i] })
  }
  return tris
}

describe('classifyAnalytic', () => {
  it('no faceted primitives + metrics match → PASS', () => {
    const ref = computeMetrics([{ v0: [0, 0, 0], v1: [1, 0, 0], v2: [0, 1, 0] }])
    const cand = computeMetrics([{ v0: [0, 0, 0], v1: [1, 0, 0], v2: [0, 1, 0] }])
    const result = compareMetrics(ref, cand)
    expect(classifyAnalytic(result, false, undefined)).toBe('PASS')
  })

  it('low $fn + faceted volume < analytic → PASS-ANALYTIC', () => {
    // 参照（解析）：10³ 立方体；候选（刻面）：同 bbox 内接 12 边形棱柱
    // （体积 750 < 1000）。bbox 完全一致（IoU=1）、质心都在原点，
    // 仅体积/表面积差 25% —— 正是「BREP 解析 vs 内接多面体」的刻面差形态。
    // （旧用例把候选整体放大 1.05 倍当「解析体」，bbox IoU=20³/21³≈0.864，
    //  前提本身不成立，恒 FAIL；且 classifyAnalytic 从未使用 fn 参数。）
    const ref = computeMetrics(boxTriangles(5))
    const cand = computeMetrics(prismTriangles(12, 5, 5))
    const result = compareMetrics(ref, cand)
    expect(result.verdict).toBe('FAIL') // 严格容差下不过（体积差 25%）
    expect(result.bboxIoU).toBeGreaterThan(0.99)
    // hasFacetedPrimitives=true, fn=6 (< 32)
    expect(classifyAnalytic(result, true, 6)).toBe('PASS-ANALYTIC')
  })

  it('low $fn + huge volume difference → FAIL', () => {
    const ref = computeMetrics(facetedSphereTriangles)
    const hugeTriangles = facetedSphereTriangles.map((t) => ({
      v0: [t.v0[0] * 10, t.v0[1] * 10, t.v0[2] * 10] as const,
      v1: [t.v1[0] * 10, t.v1[1] * 10, t.v1[2] * 10] as const,
      v2: [t.v2[0] * 10, t.v2[1] * 10, t.v2[2] * 10] as const,
    }))
    const cand = computeMetrics(hugeTriangles)
    const result = compareMetrics(ref, cand)
    // volume ratio would be way off
    expect(classifyAnalytic(result, true, 6)).toBe('FAIL')
  })

  it('$fn=0 (default, smooth) → strict PASS or FAIL', () => {
    const ref = computeMetrics(facetedSphereTriangles)
    const cand = computeMetrics(facetedSphereTriangles)
    const result = compareMetrics(ref, cand)
    // $fn=0 means default (smooth), so strict comparison
    expect(classifyAnalytic(result, true, 0)).toBe('PASS')
  })

  it('$fn ≥ threshold → strict comparison', () => {
    const ref = computeMetrics(facetedSphereTriangles)
    const cand = computeMetrics(facetedSphereTriangles)
    const result = compareMetrics(ref, cand)
    expect(classifyAnalytic(result, true, ANALYTIC_FACET_THRESHOLD)).toBe('PASS')
  })
})

describe('buildReport + renderMarkdown', () => {
  it('builds a report with correct summary counts', () => {
    const entries: ParityEntry[] = [
      { name: 'a.scad', verdict: 'PASS', hasFacetedPrimitives: false, stepExport: 'exact' },
      { name: 'b.scad', verdict: 'PASS-ANALYTIC', hasFacetedPrimitives: true, stepExport: 'exact' },
      { name: 'c.scad', verdict: 'FAIL', hasFacetedPrimitives: false, stepExport: 'exact', blockedBy: 'metric mismatch' },
      { name: 'd.scad', verdict: 'PASS-NT', hasFacetedPrimitives: false, stepExport: 'n/a' },
      { name: 'e.scad', verdict: 'ERROR', hasFacetedPrimitives: false, stepExport: 'n/a', error: 'parse failed' },
    ]
    const report = buildReport(entries, { converterVersion: '0.1.0' })
    expect(report.summary.total).toBe(5)
    expect(report.summary.pass).toBe(1)
    expect(report.summary.passAnalytic).toBe(1)
    expect(report.summary.passNT).toBe(1)
    expect(report.summary.fail).toBe(1)
    expect(report.summary.error).toBe(1)
    expect(report.summary.blocked).toBe(1)
  })

  it('renders Markdown with all sections', () => {
    const entries: ParityEntry[] = [
      { name: 'Basics/CSG.scad', verdict: 'PASS', hasFacetedPrimitives: false, stepExport: 'exact' },
      { name: 'Basics/faceted.scad', verdict: 'PASS-ANALYTIC', hasFacetedPrimitives: true, stepExport: 'exact', fn: 6 },
    ]
    const report = buildReport(entries, { converterVersion: '0.1.0' })
    const md = renderMarkdown(report)
    expect(md).toContain('# Parity Report')
    expect(md).toContain('## Summary')
    expect(md).toContain('## Tolerance')
    expect(md).toContain('## Per-Example Results')
    expect(md).toContain('Basics/CSG.scad')
    expect(md).toContain('PASS')
    expect(md).toContain('PASS-ANALYTIC')
  })

  it('renders JSON', () => {
    const entries: ParityEntry[] = [
      { name: 'a.scad', verdict: 'PASS', hasFacetedPrimitives: false, stepExport: 'exact' },
    ]
    const report = buildReport(entries, { converterVersion: '0.1.0' })
    const json = renderJson(report)
    const parsed = JSON.parse(json)
    expect(parsed.summary.total).toBe(1)
    expect(parsed.entries[0].name).toBe('a.scad')
  })
})
