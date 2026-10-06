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

describe('classifyAnalytic', () => {
  it('no faceted primitives + metrics match → PASS', () => {
    const ref = computeMetrics([{ v0: [0, 0, 0], v1: [1, 0, 0], v2: [0, 1, 0] }])
    const cand = computeMetrics([{ v0: [0, 0, 0], v1: [1, 0, 0], v2: [0, 1, 0] }])
    const result = compareMetrics(ref, cand)
    expect(classifyAnalytic(result, false, undefined)).toBe('PASS')
  })

  it('low $fn + faceted volume < analytic → PASS-ANALYTIC', () => {
    // Faceted (smaller volume) vs analytic (larger volume)
    // Volume ratio: ref/cand ≈ 0.8 (faceted is smaller)
    const ref = computeMetrics(facetedSphereTriangles)
    // Make a "larger" candidate by scaling up slightly
    const analyticTriangles = facetedSphereTriangles.map((t) => ({
      v0: [t.v0[0] * 1.05, t.v0[1] * 1.05, t.v0[2] * 1.05] as const,
      v1: [t.v1[0] * 1.05, t.v1[1] * 1.05, t.v1[2] * 1.05] as const,
      v2: [t.v2[0] * 1.05, t.v2[1] * 1.05, t.v2[2] * 1.05] as const,
    }))
    const cand = computeMetrics(analyticTriangles)
    const result = compareMetrics(ref, cand)
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
