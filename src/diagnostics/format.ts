import type { Diagnostic } from './diagnostic'
import { DIAGNOSTIC_CODES, getDiagnosticMeta } from './codes'

/** Render one diagnostic as `path:line:col: CODE severity: message`. */
export function formatDiagnosticText(d: Diagnostic): string {
  const where = d.span && d.path
    ? `${d.path}:${d.span.start.line}:${d.span.start.column}`
    : d.path ?? '<csg>'
  const head = `${where}: ${d.code} ${d.severity}: ${d.message}`
  return d.hint ? `${head}\n  hint: ${d.hint}` : head
}

export function formatDiagnosticsText(list: readonly Diagnostic[]): string {
  return list.map(formatDiagnosticText).join('\n')
}

export function formatDiagnosticsJson(list: readonly Diagnostic[]): string {
  return JSON.stringify(list, null, 2)
}

/** Human-readable summary grouped by severity, e.g. `2 errors, 1 warning`. */
export function summarizeDiagnostics(list: readonly Diagnostic[]): string {
  let errors = 0
  let warnings = 0
  let infos = 0
  for (const d of list) {
    if (d.severity === 'error') errors++
    else if (d.severity === 'warning') warnings++
    else infos++
  }
  const parts: string[] = []
  if (errors) parts.push(`${errors} error${errors === 1 ? '' : 's'}`)
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`)
  if (infos) parts.push(`${infos} info`)
  return parts.length ? parts.join(', ') : 'no diagnostics'
}

/** `faijs-openscad explain OSC3201` — one code, or the whole table. */
export function explainCode(code: string): string {
  const meta = getDiagnosticMeta(code)
  if (!meta) {
    const known = DIAGNOSTIC_CODES.map((m) => m.code).join(', ')
    return `Unknown diagnostic code: ${code}\nKnown codes: ${known}`
  }
  return [
    `${meta.code}  [${meta.defaultSeverity}]`,
    `  ${meta.title}`,
    `  hint: ${meta.hint}`,
    `  downgradable by --allow-partial: ${meta.downgradable ? 'yes' : 'no'}`,
  ].join('\n')
}

export function explainAllCodes(): string {
  return DIAGNOSTIC_CODES.map(
    (m) => `${m.code}  [${m.defaultSeverity}]  ${m.title}`,
  ).join('\n')
}
