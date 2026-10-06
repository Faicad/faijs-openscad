/**
 * Browser-safe entry point.
 *
 * Contract (plan §12.3): this module must never pull in `node:fs`,
 * `node:child_process`, `node:os` or `node:crypto`. It exposes only the pure
 * layers — identity, the diagnostic model, the baseline pins, and (since M1)
 * the whole CSG layer: dialect vocabulary, lexer, parser, AST and the
 * capability/scope tables. All of those are pure computation, so a browser or
 * worker bundle can parse `.csg` and classify nodes without the Node-only
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
