/**
 * Parity report generator (M4, T406).
 *
 * Generates JSON and Markdown reports for the parity comparison of
 * OpenSCAD examples vs faijs generated code.
 *
 * Report structure:
 *  - Per-example verdict (PASS / PASS-ANALYTIC / PASS-NT / FAIL / ERROR)
 *  - Metric comparison table
 *  - Faceting matrix summary (T403)
 *  - Analytic classification rules (T404)
 *  - Tolerance configuration
 */
import type { ComparisonResult, ComparisonTolerance, ParityVerdict } from './compare-mesh'
import { DEFAULT_TOLERANCE } from './compare-mesh'
import type { FiveDimResult } from './five-dim'

// ── Types ─────────────────────────────────────────────────────────────────

export type { ParityVerdict } from './compare-mesh'

/** A single example's parity entry. */
export interface ParityEntry {
  /** Example file name (relative to fixtures/openscad-examples/). */
  readonly name: string
  /** Verdict. */
  readonly verdict: ParityVerdict
  /** Blocked-by reason (if not PASS). */
  readonly blockedBy?: string
  /** Comparison result (if computed). */
  readonly comparison?: ComparisonResult
  /** Five-dimension comparison result (if computed). */
  readonly fiveDim?: FiveDimResult
  /** $fn value used (if applicable). */
  readonly fn?: number
  /** Tessellation segments (M9 §1.3, from $fn/$fa/$fs). */
  readonly segments?: number
  /** Whether the example uses faceted primitives. */
  readonly hasFacetedPrimitives: boolean
  /** Whether STEP export is exact or approximate. */
  readonly stepExport: 'exact' | 'approximate' | 'n/a'
  /** Error message (for ERROR verdict). */
  readonly error?: string
}

/** The full parity report. */
export interface ParityReport {
  /** Timestamp (ISO 8601). */
  readonly timestamp: string
  /** Converter version. */
  readonly converterVersion: string
  /** OpenSCAD version used. */
  readonly openscadVersion?: string
  /** faijs version. */
  readonly faijsVersion?: string
  /** Tolerance used. */
  readonly tolerance: ComparisonTolerance
  /** Per-example entries. */
  readonly entries: readonly ParityEntry[]
  /** Summary counts. */
  readonly summary: {
    readonly total: number
    readonly pass: number
    readonly passAnalytic: number
    readonly passNT: number
    readonly fail: number
    readonly error: number
    readonly blocked: number
  }
}

// ── Analytic classification rules (T404) — deprecated under M9 §1.3 ──────

/**
 * Determine if a comparison should be classified as PASS-ANALYTIC.
 *
 * **⚠️ M9 §1.3 语义修正后此函数已废弃**——`run-parity.ts` 不再调用它。
 *
 * 旧语义（已否决）：faijs 产出解析几何，OpenSCAD 产出棱面体，低 `$fn` 时
 * 两边有系统性体积差，用 `PASS-ANALYTIC` 容忍。
 *
 * 新语义（M9 §1.3）：两边是同一解析几何的两次三角化，分片参数已对齐。
 * 不再需要 `PASS-ANALYTIC` 容忍类别——直接用 `comparison.verdict`。
 *
 * 函数保留供向后兼容与测试，但新代码不应调用。
 *
 * Rules (plan §5.5, §9.6, 旧版):
 *  1. If the example has no faceted primitives ($fn not set or $fn ≥ 32),
 *     and metrics match → PASS (strict).
 *  2. If the example has low-$fn primitives ($fn < 32), faijs BREP is
 *     analytically exact while OpenSCAD produces faceted geometry.
 *     Metrics will differ → PASS-ANALYTIC (not strict PASS).
 *  3. If metrics diverge beyond tolerance for reasons other than faceting
 *     → FAIL.
 *  4. If the comparison could not be computed → ERROR.
 */
export const ANALYTIC_FACET_THRESHOLD = 32

/**
 * Classify a comparison result with analytic-aware rules.
 */
export function classifyAnalytic(
  result: ComparisonResult,
  hasFacetedPrimitives: boolean,
  fn: number | undefined,
  _tol: ComparisonTolerance = DEFAULT_TOLERANCE,
): ParityVerdict {
  // ERROR takes precedence
  if (result.verdict === 'ERROR') return 'ERROR'

  // No faceted primitives: strict comparison
  if (!hasFacetedPrimitives) {
    return result.verdict
  }

  // Has faceted primitives: check if the difference is due to faceting
  const effectiveFn = fn ?? 0 // $fn=0 means default (smooth)
  const isLowFn = effectiveFn > 0 && effectiveFn < ANALYTIC_FACET_THRESHOLD

  if (isLowFn) {
    // Low $fn: OpenSCAD produces faceted, faijs produces analytic.
    // Volume of faceted < volume of analytic (inscribed polytope).
    // If the difference is in the expected direction and within
    // a looser tolerance (5x), it's PASS-ANALYTIC.
    const volumeRatio = result.cand.volume > 0
      ? result.ref.volume / result.cand.volume
      : 1
    // Faceted volume should be less than or equal to analytic volume
    if (volumeRatio <= 1.05 && volumeRatio >= 0.5) {
      return 'PASS-ANALYTIC'
    }
    // If volume difference is too large, it's a real failure
    return 'FAIL'
  }

  // $fn=0 (default) or $fn ≥ 32: should match closely
  return result.verdict
}

// ── Report generation ─────────────────────────────────────────────────────

/**
 * Build a parity report from individual entries.
 */
export function buildReport(
  entries: readonly ParityEntry[],
  options: {
    converterVersion: string
    openscadVersion?: string
    faijsVersion?: string
    tolerance?: ComparisonTolerance
  },
): ParityReport {
  const summary = {
    total: entries.length,
    pass: entries.filter((e) => e.verdict === 'PASS').length,
    passAnalytic: entries.filter((e) => e.verdict === 'PASS-ANALYTIC').length,
    passNT: entries.filter((e) => e.verdict === 'PASS-NT').length,
    fail: entries.filter((e) => e.verdict === 'FAIL').length,
    error: entries.filter((e) => e.verdict === 'ERROR').length,
    blocked: entries.filter((e) => e.blockedBy !== undefined).length,
  }

  return {
    timestamp: new Date().toISOString(),
    converterVersion: options.converterVersion,
    openscadVersion: options.openscadVersion,
    faijsVersion: options.faijsVersion,
    tolerance: options.tolerance ?? DEFAULT_TOLERANCE,
    entries,
    summary,
  }
}

/**
 * Render a parity report as Markdown.
 */
export function renderMarkdown(report: ParityReport): string {
  const lines: string[] = []

  lines.push('# Parity Report')
  lines.push('')
  lines.push(`- **Timestamp**: ${report.timestamp}`)
  lines.push(`- **Converter**: ${report.converterVersion}`)
  if (report.openscadVersion) lines.push(`- **OpenSCAD**: ${report.openscadVersion}`)
  if (report.faijsVersion) lines.push(`- **faijs**: ${report.faijsVersion}`)
  lines.push('')

  // Summary
  const s = report.summary
  lines.push('## Summary')
  lines.push('')
  lines.push('| Verdict | Count |')
  lines.push('|---|---|')
  lines.push(`| PASS | ${s.pass} |`)
  lines.push(`| PASS-ANALYTIC | ${s.passAnalytic} |`)
  lines.push(`| PASS-NT | ${s.passNT} |`)
  lines.push(`| FAIL | ${s.fail} |`)
  lines.push(`| ERROR | ${s.error} |`)
  lines.push(`| **Total** | ${s.total} |`)
  lines.push('')

  // Tolerance
  const t = report.tolerance
  lines.push('## Tolerance')
  lines.push('')
  lines.push('| Parameter | Value |')
  lines.push('|---|---|')
  lines.push(`| Volume (abs) | ${t.volumeAbs} |`)
  lines.push(`| Volume (rel) | ${t.volumeRel} |`)
  lines.push(`| Surface area (abs) | ${t.surfaceAreaAbs} |`)
  lines.push(`| Surface area (rel) | ${t.surfaceAreaRel} |`)
  lines.push(`| Bbox IoU | ${t.bboxIoU} |`)
  lines.push(`| Centroid distance | ${t.centroidDistance} |`)
  lines.push(`| Surface distance | ${t.surfaceDistance} |`)
  lines.push(`| Triangle count (rel) | ${t.triangleCountRel} |`)
  lines.push('')

  // Per-example table
  lines.push('## Per-Example Results')
  lines.push('')
  lines.push('| Example | Verdict | Volume Δ | Area Δ | Bbox IoU | Centroid dist | Hausdorff | Tessellation | STEP |')
  lines.push('|---|---|---|---|---|---|---|---|---|')

  for (const e of report.entries) {
    const c = e.comparison
    const vol = c ? c.volumeDelta.toFixed(6) : '—'
    const area = c ? c.surfaceAreaDelta.toFixed(6) : '—'
    const iou = c ? c.bboxIoU.toFixed(6) : '—'
    const cent = c ? c.centroidDistance.toFixed(6) : '—'
    const haus = c ? c.hausdorffDistance.toFixed(6) : '—'
    const tess = e.segments !== undefined ? `seg=${e.segments}` : (e.fn !== undefined ? `fn=${e.fn}` : 'default')
    lines.push(`| ${e.name} | ${e.verdict} | ${vol} | ${area} | ${iou} | ${cent} | ${haus} | ${tess} | ${e.stepExport} |`)
  }
  lines.push('')

  // Blocked details
  const blocked = report.entries.filter((e) => e.blockedBy)
  if (blocked.length > 0) {
    lines.push('## Blocked Examples')
    lines.push('')
    for (const e of blocked) {
      lines.push(`- **${e.name}**: ${e.blockedBy}`)
    }
    lines.push('')
  }

  // Failures
  const failures = report.entries.filter((e) => e.verdict === 'FAIL' || e.verdict === 'ERROR')
  if (failures.length > 0) {
    lines.push('## Failures & Errors')
    lines.push('')
    for (const e of failures) {
      const msg = e.comparison?.message ?? e.error ?? '(no detail)'
      lines.push(`### ${e.name} — ${e.verdict}`)
      lines.push('')
      lines.push(`> ${msg}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * Render a parity report as JSON.
 */
export function renderJson(report: ParityReport): string {
  return JSON.stringify(report, null, 2)
}
