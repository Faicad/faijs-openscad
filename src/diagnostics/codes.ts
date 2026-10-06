/**
 * Diagnostic codes.
 *
 * Numbering (see plan §8):
 *   1xxx  lexer / parser (CSG text level)
 *   2xxx  IR lowering / validation
 *   3xxx  capability + fidelity policy
 *   4xxx  emitted runtime helper execution
 *   5xxx  environment / external OpenSCAD front-end
 *
 * Every code has a stable default severity and a one-line summary so
 * `faijs-openscad explain <CODE>` and JSON reports can both render it without
 * duplicating strings.
 */

export const DiagnosticCode = {
  // --- 1xxx: lexer / parser -------------------------------------------------
  OSC1001: 'OSC1001', // illegal CSG token
  OSC1002: 'OSC1002', // unbalanced ( ) [ ] { }
  OSC1003: 'OSC1003', // unknown CSG node
  OSC1004: 'OSC1004', // unknown argument (warning by default, value preserved)

  // --- 2xxx: IR lowering / validation --------------------------------------
  OSC2001: 'OSC2001', // missing required argument
  OSC2002: 'OSC2002', // argument type / dimension error
  OSC2003: 'OSC2003', // illegal 2D/3D mix in a subtree
  OSC2004: 'OSC2004', // singular or illegal matrix

  // --- 3xxx: capability + fidelity -----------------------------------------
  OSC3001: 'OSC3001', // `#` highlight semantics dropped
  OSC3002: 'OSC3002', // no faijs equivalent for this node
  OSC3003: 'OSC3003', // runtime helper required but output mode is `direct`
  OSC3101: 'OSC3101', // external resource dependency, unresolvable path
  OSC3201: 'OSC3201', // analytic mode did not preserve explicit faceting
  OSC3202: 'OSC3202', // mesh-only geometry: STEP export is approximate (not exact BREP)

  // --- 4xxx: emitted runtime ------------------------------------------------
  OSC4001: 'OSC4001', // runtime helper execution failed

  // --- 5xxx: environment ----------------------------------------------------
  OSC5001: 'OSC5001', // OpenSCAD binary not found
  OSC5002: 'OSC5002', // OpenSCAD version does not match baseline
  OSC5003: 'OSC5003', // OpenSCAD subprocess failed
} as const

export type DiagnosticCodeId = (typeof DiagnosticCode)[keyof typeof DiagnosticCode]

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface DiagnosticCodeMeta {
  readonly code: DiagnosticCodeId
  readonly defaultSeverity: DiagnosticSeverity
  readonly title: string
  readonly hint: string
  /** Codes that `--allow-partial` may downgrade from error to warning. */
  readonly downgradable: boolean
}

export const DIAGNOSTIC_CODES: readonly DiagnosticCodeMeta[] = [
  {
    code: DiagnosticCode.OSC1001,
    defaultSeverity: 'error',
    title: 'Illegal CSG token',
    hint: 'The CSG text contains a token the lexer cannot recognise. Check the OpenSCAD build that produced it against tests/baseline.json.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC1002,
    defaultSeverity: 'error',
    title: 'Unbalanced bracket',
    hint: 'A ( ) [ ] or { } group is not closed. This usually means a truncated or hand-edited CSG dump.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC1003,
    defaultSeverity: 'error',
    title: 'Unknown CSG node',
    hint: 'The node name is not in the known dialect vocabulary. Add it to src/csg/dialect.ts only after inspecting real corpus output.',
    downgradable: true,
  },
  {
    code: DiagnosticCode.OSC1004,
    defaultSeverity: 'warning',
    title: 'Unknown argument',
    hint: 'The argument is preserved in the AST but ignored during lowering. Confirm the OpenSCAD version that emitted it.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC2001,
    defaultSeverity: 'error',
    title: 'Missing required argument',
    hint: 'The node needs an argument that is absent and has no dialect default. Supply a default in the default-args pass only with corpus evidence.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC2002,
    defaultSeverity: 'error',
    title: 'Argument type or dimension error',
    hint: 'An argument was given with the wrong value kind (number / vector / matrix / string / bool / undef).',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC2003,
    defaultSeverity: 'error',
    title: 'Illegal 2D/3D combination',
    hint: 'A 3D operation received 2D children (or vice versa). OpenSCAD would warn-and-drop; this converter refuses instead of emitting wrong geometry.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC2004,
    defaultSeverity: 'error',
    title: 'Singular or illegal matrix',
    hint: 'multmatrix() must be an invertible 4x4 affine matrix; faijs cad.applyMatrix has the same constraint.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC3001,
    defaultSeverity: 'warning',
    title: 'Highlight (`#`) semantics dropped',
    hint: 'The geometry is kept, but OpenSCAD debug-highlight rendering has no faijs equivalent.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC3002,
    defaultSeverity: 'error',
    title: 'No faijs equivalent',
    hint: 'This node has no exact faijs mapping yet. It must be reported as BLOCKED, never silently skipped.',
    downgradable: true,
  },
  {
    code: DiagnosticCode.OSC3003,
    defaultSeverity: 'error',
    title: 'Runtime helper required but output mode is direct',
    hint: 'Re-run with --output-style hybrid (or implement the exact direct mapping) — direct mode may not invent approximated geometry.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC3101,
    defaultSeverity: 'error',
    title: 'Unresolvable external resource',
    hint: 'import()/surface()/text() needs a file (or font) that cannot be resolved. Pass --assets-dir / --fonts-dir.',
    downgradable: true,
  },
  {
    code: DiagnosticCode.OSC3201,
    defaultSeverity: 'warning',
    title: 'Faceting not preserved in analytic mode',
    hint: 'OpenSCAD $fn/$fa/$fs produced real faceted geometry; faijs analytic BREP keeps exact surfaces. Reported as PASS-ANALYTIC, never as strict PASS.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC3202,
    defaultSeverity: 'warning',
    title: 'Mesh-only geometry: STEP export is approximate',
    hint: 'This operation produces triangle-mesh geometry (e.g. polyhedron, surface, import STL). STL export is exact; STEP export uses OCCT mesh→BREP reconstruction and is not analytically precise.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC4001,
    defaultSeverity: 'error',
    title: 'Runtime helper execution failed',
    hint: 'A generated helper call threw while executing the .fai.js. This is a converter/runtime bug, not a user modelling error.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC5001,
    defaultSeverity: 'error',
    title: 'OpenSCAD binary not found',
    hint: 'Set --openscad-bin or OPENSCAD_BIN, or use .csg input which needs no external binary.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC5002,
    defaultSeverity: 'warning',
    title: 'OpenSCAD version differs from baseline',
    hint: 'Output is only a smoke signal; do NOT regenerate the corpus golden with a non-baseline binary.',
    downgradable: false,
  },
  {
    code: DiagnosticCode.OSC5003,
    defaultSeverity: 'error',
    title: 'OpenSCAD subprocess failed',
    hint: 'The OpenSCAD front-end exited non-zero. The original stderr is attached to the diagnostic message.',
    downgradable: false,
  },
]

const CODE_INDEX = new Map<string, DiagnosticCodeMeta>(DIAGNOSTIC_CODES.map((m) => [m.code, m]))

export function getDiagnosticMeta(code: string): DiagnosticCodeMeta | undefined {
  return CODE_INDEX.get(code)
}

export function isKnownDiagnosticCode(code: string): boolean {
  return CODE_INDEX.has(code)
}

export function defaultSeverityOf(code: string): DiagnosticSeverity {
  return CODE_INDEX.get(code)?.defaultSeverity ?? 'error'
}

export function isDowngradable(code: string): boolean {
  return CODE_INDEX.get(code)?.downgradable === true
}
