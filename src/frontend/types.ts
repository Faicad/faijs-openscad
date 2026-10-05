import type { Diagnostic } from '../diagnostics/diagnostic'

/**
 * Front-end abstraction (plan §4.1).
 *
 * The converter never talks to OpenSCAD directly: it consumes an already
 * evaluated CSG document produced by *some* front-end. That keeps the parser /
 * IR / emitter independent of the OpenSCAD binary, keeps the npm artifact free
 * of GPL sources, and lets the corpus tests run without any external process.
 */
export type FrontendKind = 'cli' | 'wasm' | 'csg-text'

/** A `.scad` source to be evaluated by an external OpenSCAD front-end. */
export interface ScadInput {
  /** Absolute or cwd-relative path to the `.scad` file. */
  readonly filePath: string
  /** Working directory used to resolve `include`/`use`/`import` relative paths. */
  readonly cwd?: string
}

/** CSG text that already exists (corpus golden, unit fixture, bug repro). */
export interface CsgTextInput {
  readonly text: string
  /** Optional label used in diagnostics when there is no file on disk. */
  readonly label?: string
}

/** Normalised output of any front-end. */
export interface CsgArtifact {
  /** Raw CSG text, exactly as produced (never pre-normalised by this layer). */
  readonly csgText: string
  /** sha256 of `csgText`; used by the corpus manifest for reproducibility. */
  readonly sha256: string
  readonly producedBy: {
    readonly kind: FrontendKind
    /** e.g. `cli`, `wasm`, or `csg-text`. */
    readonly binaryPath?: string
    readonly version?: string
  }
  /** Original source path when the input was a file. */
  readonly sourcePath?: string
  /** Diagnostics raised while obtaining the CSG (never thrown). */
  readonly diagnostics: readonly Diagnostic[]
}

export interface FrontendOptions {
  /** Hard timeout for an external process, in ms. Default 120_000. */
  readonly timeoutMs?: number
  /** Extra argv appended before the input path (escape hatch, use sparingly). */
  readonly extraArgs?: readonly string[]
  /** Environment overrides for the subprocess. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Working directory for relative path resolution. */
  readonly cwd?: string
}

export interface FrontendInfo {
  readonly kind: FrontendKind
  readonly available: boolean
  /** Human readable identity, e.g. `OpenSCAD 2021.01 (C:\Program Files\...)`. */
  readonly identity?: string
  readonly binaryPath?: string
  readonly version?: string
  readonly diagnostics: readonly Diagnostic[]
}

export interface OpenScadFrontend {
  readonly kind: FrontendKind
  /** Cheap availability/version probe. Must never throw. */
  inspect(): Promise<FrontendInfo>
  /** Evaluate a `.scad` file into CSG text. */
  compileScad(input: ScadInput, options?: FrontendOptions): Promise<CsgArtifact>
}
