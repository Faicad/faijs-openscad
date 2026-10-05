/**
 * Browser-safe entry point.
 *
 * Contract (plan §12.3): this module must never pull in `node:fs`,
 * `node:child_process`, `node:os` or `node:crypto`. It exposes only the pure
 * layers — identity, the diagnostic model and the baseline pins — so a browser
 * / worker bundle can render and classify diagnostics without the Node-only
 * front-end or environment probes.
 */
export { CONVERTER_NAME, CONVERTER_VERSION, CSG_DIALECT, EMIT_PROTOCOL } from './version'

export { BASELINE } from './baseline'
export type { Baseline } from './baseline'

export {
  DiagnosticCode,
  DIAGNOSTIC_CODES,
  getDiagnosticMeta,
  isKnownDiagnosticCode,
  defaultSeverityOf,
  isDowngradable,
} from './diagnostics/codes'
export type { DiagnosticCodeId, DiagnosticCodeMeta, DiagnosticSeverity } from './diagnostics/codes'

export { DiagnosticBag, diagnostic, UNKNOWN_NODE_CODE } from './diagnostics/diagnostic'
export type { Diagnostic, DiagnosticInput, Span } from './diagnostics/diagnostic'

export {
  formatDiagnosticText,
  formatDiagnosticsText,
  formatDiagnosticsJson,
  summarizeDiagnostics,
  explainCode,
  explainAllCodes,
} from './diagnostics/format'
