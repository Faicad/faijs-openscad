/**
 * Public API of @faicad/faijs-openscad.
 *
 * Node entry point. The browser entry (./browser) deliberately excludes
 * everything that touches `node:fs` / `node:child_process`.
 *
 * Milestone status: M1 landed the CSG layer — dialect vocabulary, lexer,
 * recursive-descent parser and the span-carrying AST (`lexCsg` / `parseCsg`),
 * plus the capability table and the v0 (P0) delivery scope. M2 lands the
 * conversion half: `lowerCsg` (CSG AST -> Model IR, with default-args /
 * dimension-inference / group-normalize / matrix-fold / modifier-policy /
 * tessellation-policy / capability-classify) and `emitFaijs` (Model IR ->
 * deterministic `.fai.js`). The CLI that stitches them together is M3.
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

export { asPlanar, dimensionOf, lowerCsg } from './ir/lower'
export type { LowerOptions, LowerResult } from './ir/lower'

export { blockedNodes, hasBlocked, irChildren, walkIr } from './ir/model'
export type {
  IrBlocked,
  IrBox,
  IrCircle2D,
  IrColor,
  IrCone,
  IrCylinder,
  IrDifference,
  IrDimension,
  IrEmpty,
  IrExtrude,
  IrGeometry,
  IrGeometry2D,
  IrIntersection,
  IrModel,
  IrOrigin,
  IrPassthrough,
  IrPolygon2D,
  IrRect2D,
  IrSphere,
  IrTransform,
  IrUnion,
  Matrix4,
  Vec2,
  Vec3,
  Vec4,
} from './ir/model'

export { colorLiteral, emitFaijs } from './emit/faijs'
export type { EmitOptions, EmitResult } from './emit/faijs'

export {
  DEFAULT_FLOAT_PRECISION,
  degreeLiteral,
  exactNumber,
  formatNumber,
  lengthLiteral,
  radianLiteral,
  requiredUnitImports,
} from './emit/units'

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

// CLI commands (M3)
export { transpileFile, runTranspile } from './cli/commands/transpile'
export type { TranspileOptions, TranspileReport } from './cli/commands/transpile'

export { runDump } from './cli/commands/dump'
export type { DumpOptions } from './cli/commands/dump'

export { runCheck } from './cli/commands/check'
export type { CheckOptions, CheckReport } from './cli/commands/check'

export { runRun } from './cli/commands/run'
export type { RunOptions, RunReport } from './cli/commands/run'

export { runRunCand } from './cli/commands/run-cand'
export type { RunCandOptions, RunCandEntry, RunCandReport } from './cli/commands/run-cand'

export { runCorpus } from './cli/commands/corpus'
export type {
  CorpusOptions,
  CorpusStatus,
  CorpusManifestEntry,
  CorpusManifest,
} from './cli/commands/corpus'

// Parity (M4)
export {
  parseStl,
  computeMetrics,
  readStlMetrics,
} from './parity/stl-metrics'
export type {
  BoundingBox,
  MeshMetrics,
  MetricsOptions,
  StlTriangle,
} from './parity/stl-metrics'

export {
  compareMetrics,
  compareSurfaces,
  DEFAULT_TOLERANCE,
} from './parity/compare-mesh'
export type {
  ComparisonResult,
  ComparisonTolerance,
  ParityVerdict,
} from './parity/compare-mesh'

export {
  classifyAnalytic,
  buildReport,
  renderMarkdown,
  renderJson,
  ANALYTIC_FACET_THRESHOLD,
} from './parity/report'
export type {
  ParityEntry,
  ParityReport,
} from './parity/report'
