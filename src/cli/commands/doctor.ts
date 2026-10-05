/**
 * `doctor` command — print the environment report that decides which test
 * layers can run (plan §9.7 keeps regular CI independent of OpenSCAD).
 *
 * Exit codes: 0 report produced, 2 environment error (binary missing is
 * reported but NOT fatal — .csg conversion works without it).
 */
import { inspectEnvironment } from '../../environment'
import { formatDiagnosticsText, summarizeDiagnostics } from '../../diagnostics/format'
import type { Diagnostic } from '../../diagnostics/diagnostic'

export interface DoctorOptions {
  readonly json?: boolean
  readonly openscadBin?: string
  readonly openscadSrc?: string
}

export async function runDoctor(options: DoctorOptions = {}): Promise<number> {
  const report = await inspectEnvironment({
    ...(options.openscadBin === undefined ? {} : { openscadBin: options.openscadBin }),
    ...(options.openscadSrc === undefined ? {} : { openscadSrc: options.openscadSrc }),
  })

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    const lines: string[] = []
    lines.push(`${report.converter.name} ${report.converter.version}`)
    lines.push(`  node        : ${report.node.version} (${report.node.platform} ${report.node.arch})`)
    lines.push(
      report.openscad.available
        ? `  openscad    : ${report.openscad.version ?? '(unknown)'} @ ${report.openscad.path} [${report.openscad.source}]`
        : '  openscad    : NOT FOUND (.csg conversion still works; .scad needs a binary)',
    )
    lines.push(
      `  baseline    : ${report.openscad.matchesBaseline ? 'MATCH' : 'MISMATCH'} (required ${report.openscad.available ? 'baseline-build' : 'n/a'})`,
    )
    lines.push(
      report.faijs.installed
        ? `  faijs       : ${report.faijs.version ?? '(unknown)'}`
        : '  faijs       : NOT INSTALLED',
    )
    lines.push(
      report.corpus.configured
        ? `  corpus      : ${report.corpus.root} (counts match baseline: ${report.corpus.matchesBaseline ?? 'not counted'})`
        : '  corpus      : not configured (set OPENSCAD_SRC)',
    )
    const diags: readonly Diagnostic[] = report.diagnostics
    lines.push(`  diagnostics: ${summarizeDiagnostics(diags)}`)
    if (diags.length) lines.push(formatDiagnosticsText(diags))
    process.stdout.write(`${lines.join('\n')}\n`)
  }

  // A missing binary is a *capability* reduction, not a doctor failure: the
  // .csg pipeline (and therefore all unit tests) must still be usable.
  return 0
}
