/**
 * Public API of @faicad/faijs-openscad.
 *
 * Node entry point. The browser entry (./browser) deliberately excludes
 * everything that touches `node:fs` / `node:child_process`.
 *
 * Milestone status: M0 exposes identity, diagnostics, the front-end
 * abstraction and environment inspection. `parseCsg` / `lowerCsg` /
 * `emitFaijs` land with M1-M2.
 */
export {
  CONVERTER_NAME,
  CONVERTER_VERSION,
  CSG_DIALECT,
  EMIT_PROTOCOL,
  FAIJS_TARGET_VERSION,
} from './version'

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

export { CsgTextFrontend, csgTextToArtifact } from './frontend/csg-text'
export { OpenScadCliFrontend, resolveOpenScadVersion, DEFAULT_TIMEOUT_MS } from './frontend/openscad-cli'
export {
  discoverOpenScadBinary,
  parseOpenScadVersion,
  platformDefaultPaths,
  probeVersion,
  resolveFromPath,
} from './frontend/discover-openscad'
export type {
  BinarySource,
  DiscoveredBinary,
  DiscoverOptions,
} from './frontend/discover-openscad'
export type {
  CsgArtifact,
  CsgTextInput,
  FrontendInfo,
  FrontendKind,
  FrontendOptions,
  OpenScadFrontend,
  ScadInput,
} from './frontend/types'

export { inspectEnvironment, probeFaijs, resolveCorpusRoot, countCorpus } from './environment'
export type { EnvironmentReport, InspectOptions, FaijsProbe, CorpusProbe } from './environment'
