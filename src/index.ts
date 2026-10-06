/**
 * Public API of @faicad/faijs-openscad.
 *
 * Node entry point. The browser entry (./browser) deliberately excludes
 * everything that touches `node:fs` / `node:child_process`.
 *
 * Milestone status: M1 lands the CSG layer — dialect vocabulary, lexer,
 * recursive-descent parser and the span-carrying AST (`lexCsg` / `parseCsg`),
 * plus the capability table and the v0 (P0) delivery scope. `lowerCsg` /
 * `emitFaijs` land with M2.
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

export {
  CSG_MODIFIERS,
  CSG_NODE_SPECS,
  CSG_NODE_VOCABULARY,
  csgNodeSpec,
  isCsgModifier,
  isKnownCsgNode,
} from './csg/dialect'
export type { CsgModifier, CsgNodeCategory, CsgNodeSpec } from './csg/dialect'

export {
  argumentAt,
  argumentOf,
  countCsgNodes,
  countCsgNodesByName,
  describeCsgValue,
  firstPositionalValue,
  joinSpans,
  positionalArguments,
  walkCsg,
} from './csg/ast'
export type {
  CsgArgument,
  CsgBooleanValue,
  CsgDocument,
  CsgInfinityValue,
  CsgModifierToken,
  CsgNode,
  CsgNodeTerminator,
  CsgNumberValue,
  CsgStringValue,
  CsgUndefValue,
  CsgValue,
  CsgValueKind,
  CsgVectorValue,
} from './csg/ast'

export { lexCsg, PUNCTUATION } from './csg/lexer'
export type {
  EofToken,
  IdentifierToken,
  LexOptions,
  LexResult,
  ModifierToken,
  NumberToken,
  Punctuation,
  PunctuationToken,
  StringToken,
  Token,
} from './csg/lexer'

export { parseCsg, parseCsgTokens } from './csg/parser'
export type { ParseOptions, ParseResult } from './csg/parser'

export {
  CAPABILITY_TABLE,
  capabilityClassOf,
  capabilityOf,
  coverageOf,
  isInShippedScope,
  nodesWithCapability,
  outOfShippedScope,
  shippedStatusOf,
  SHIPPED_NODES,
  SHIPPED_PHASE,
  unclassifiedNodes,
} from './ir/capability'
export type {
  CapabilityClass,
  CapabilityEntry,
  CoverageReport,
  ShippedPhase,
  ShippedStatus,
} from './ir/capability'

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
