/**
 * `transpile` command — the full `.scad` / `.csg` → `.fai.js` pipeline
 * (plan §7.2, T302).
 *
 * Stitching layer: it connects the OpenSCAD CLI front-end (for `.scad` input)
 * or CSG-text front-end (for `.csg` input) to the parser → lower → emitter
 * pipeline, then writes the result (or refuses to, when blocked).
 *
 * Exit codes (plan §7.2):
 *   0  success, no error diagnostics
 *   1  syntax / lowering / emitter / unsupported error (including BLOCKED)
 *   2  environment error (OpenSCAD not found for `.scad` input)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { parseCsg } from '../../csg/parser'
import { lowerCsg } from '../../ir/lower'
import { parseScad } from '../../scad/parser'
import { lowerScad } from '../../ir/lower-scad'
import { emitFaijs } from '../../emit/faijs'
import { OpenScadCliFrontend } from '../../frontend/openscad-cli'
import type { CsgArtifact } from '../../frontend/types'
import { formatDiagnosticsText, summarizeDiagnostics } from '../../diagnostics/format'
import type { Diagnostic } from '../../diagnostics/diagnostic'

export interface TranspileOptions {
  /** Output path (`-o` / `--out`). If omitted, write to stdout. */
  readonly out?: string
  /** Explicit OpenSCAD binary path. */
  readonly openscadBin?: string
  /** Timeout for the OpenSCAD subprocess, in ms. */
  readonly timeoutMs?: number
  /** Write CSG dump alongside (for debugging). */
  readonly dumpCsg?: boolean
  /** Treat warnings as non-fatal (default: errors block, warnings pass). */
  readonly allowPartial?: boolean
  /** Print JSON report instead of code. */
  readonly json?: boolean
  /** Extra args for OpenSCAD (rarely needed). */
  readonly extraArgs?: readonly string[]
  /** Use compact mode (helper functions + inline formatting) to reduce output size. */
  readonly compact?: boolean
  /** Use structured lower path (parseScad → lowerScad), skipping CSG expansion. */
  readonly structured?: boolean
  /** Force CSG expansion path (overrides auto-selection). */
  readonly noStructured?: boolean
}

export interface TranspileReport {
  readonly ok: boolean
  readonly input: string
  readonly output?: string
  readonly csgSha256?: string
  readonly parsedNodes: number
  readonly emittedStatements: number
  readonly blockedNodes: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

/**
 * Core transpile function: `.scad` or `.csg` path → `TranspileReport`.
 *
 * This is the programmatic API behind the `transpile` CLI command, also used
 * by the manifest generator and `run-cand`.
 */
export async function transpileFile(
  inputPath: string,
  options: TranspileOptions = {},
): Promise<TranspileReport> {
  const abs = resolve(inputPath)
  const ext = extname(abs).toLowerCase()

  // ── Structured path: parseScad → lowerScad → emitFaijs (no CSG expansion) ──
  if (ext === '.scad') {
    // Explicit flags take priority.
    if (options.structured) {
      return transpileStructured(abs, options)
    }
    if (options.noStructured) {
      // Fall through to CSG expansion path below.
    } else {
      // Auto-selection (Plan C): scan source for unsupported modules.
      // If the source uses modules that the structured path cannot handle,
      // fall back to CSG expansion with a warning diagnostic.
      const sourceText = readFileSync(abs, 'utf8')
      const unsupported = detectUnsupportedModules(sourceText)
      if (unsupported.length > 0) {
        // Fall back to CSG path — continue below.
        // The warning will be added to the report diagnostics.
        ;(options as { _autoFallback?: string[] })._autoFallback = unsupported
      } else {
        return transpileStructured(abs, options)
      }
    }
  }

  // ── Step 1: Obtain CSG text ────────────────────────────────────────────
  let artifact: CsgArtifact

  if (ext === '.csg') {
    // Direct CSG input — no OpenSCAD needed.
    const text = readFileSync(abs, 'utf8')
    artifact = {
      csgText: text,
      sha256: '',
      producedBy: { kind: 'csg-text' },
      sourcePath: abs,
      diagnostics: [],
    }
    artifact = { ...artifact, sha256: sha256Of(text) }
  } else if (ext === '.scad') {
    // External OpenSCAD binary → CSG.
    const frontend = new OpenScadCliFrontend(
      options.openscadBin === undefined ? {} : { binaryPath: options.openscadBin },
    )
    artifact = await frontend.compileScad(
      { filePath: abs },
      {
        timeoutMs: options.timeoutMs,
        ...(options.extraArgs?.length ? { extraArgs: options.extraArgs } : {}),
      },
    )
  } else {
    return {
      ok: false,
      input: abs,
      parsedNodes: 0,
      emittedStatements: 0,
      blockedNodes: [],
      diagnostics: [
        {
          code: 'OSC2002',
          severity: 'error',
          message: `Unsupported file extension "${ext}". Use .scad or .csg.`,
        },
      ],
    }
  }

  // Collect diagnostics from the front-end (e.g. OSC5001, OSC5003).
  const diags: Diagnostic[] = [...artifact.diagnostics]

  // Auto-fallback warning: if we fell back from structured to CSG due to
  // unsupported modules, emit an info diagnostic explaining the choice.
  const autoFallback = (options as { _autoFallback?: string[] })._autoFallback
  if (autoFallback !== undefined && autoFallback.length > 0) {
    diags.push({
      code: 'OSC3004',
      severity: 'info',
      message: `Auto-selected CSG expansion path: source uses unsupported module(s) ${autoFallback.join(', ')}. Use --structured to force structured path (with warnings) or --no-structured to suppress this message.`,
    })
  }

  // If OpenSCAD produced no CSG (binary missing, subprocess failed), bail.
  if (artifact.csgText.length === 0) {
    const hasError = diags.some((d) => d.severity === 'error')
    if (!hasError) {
      diags.push({
        code: 'OSC5003',
        severity: 'error',
        message: 'OpenSCAD produced no CSG output.',
      })
    }
    return {
      ok: false,
      input: abs,
      csgSha256: artifact.sha256,
      parsedNodes: 0,
      emittedStatements: 0,
      blockedNodes: [],
      diagnostics: diags,
    }
  }

  // Optional CSG dump for debugging.
  if (options.dumpCsg && options.out) {
    const csgPath = options.out.replace(/\.fai\.js$/, '.csg')
    if (csgPath !== options.out) {
      writeFileSync(csgPath, artifact.csgText, 'utf8')
    }
  }

  // ── Step 2: Parse CSG → AST ────────────────────────────────────────────
  const label = basename(abs)
  const parsed = parseCsg(artifact.csgText, { path: label })
  diags.push(...parsed.diagnostics)

  // ── Step 3: Lower AST → Model IR ───────────────────────────────────────
  const lowered = lowerCsg(parsed.document, {
    path: label,
    ...(artifact.producedBy.version !== undefined
      ? { openscadVersion: artifact.producedBy.version }
      : {}),
  })
  diags.push(...lowered.diagnostics)

  // ── Step 4: Emit IR → .fai.js ──────────────────────────────────────────
  // If compact mode is requested, use it directly. Otherwise, if the output
  // exceeds 1 MiB, retry with compact mode (auto-fallback).
  let emitted = emitFaijs(lowered.model, options.compact ? { compact: true } : {})
  if (!options.compact && emitted.ok && emitted.code.length > 1_000_000) {
    const compactEmitted = emitFaijs(lowered.model, { compact: true })
    if (compactEmitted.ok && compactEmitted.code.length < emitted.code.length) {
      emitted = compactEmitted
    }
  }

  // Determine ok/fail
  const errors = diags.filter((d) => d.severity === 'error')
  const hasErrors = errors.length > 0
  const isBlocked = !emitted.ok

  // OSC3002 errors are expected for blocked nodes — they're not "bugs".
  // But the transpile still fails (exit 1) because we can't produce code.
  if (isBlocked && !hasErrors) {
    // The emitter detected blocked nodes but the lowering didn't emit
    // OSC3002 — this shouldn't happen, but be explicit.
    diags.push({
      code: 'OSC3002',
      severity: 'error',
      message: `Conversion blocked: ${emitted.blocked.join(', ')}`,
    })
  }

  const ok = !isBlocked && !hasErrors
  const blocked = emitted.blocked
  const report: TranspileReport = {
    ok,
    input: abs,
    ...(options.out !== undefined ? { output: options.out } : {}),
    csgSha256: artifact.sha256,
    parsedNodes: countNodes(parsed.document),
    emittedStatements: emitted.statementNodes.length,
    blockedNodes: blocked,
    diagnostics: diags,
  }

  // ── Step 5: Write output ───────────────────────────────────────────────
  if (ok && emitted.code.length > 0) {
    if (options.out !== undefined) {
      writeFileSync(options.out, emitted.code, 'utf8')
    }
  }

  return report
}

/**
 * CLI entry point for `transpile`.
 * @returns exit code
 */
export async function runTranspile(
  inputPath: string,
  options: TranspileOptions = {},
): Promise<number> {
  const report = await transpileFile(inputPath, options)

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else if (report.ok) {
    // If -o is given, code is already written; print a summary.
    // If no -o, print the code to stdout.
    if (options.out !== undefined) {
      process.stdout.write(
        `wrote ${options.out} (${report.emittedStatements} statements, ${report.parsedNodes} CSG nodes)\n`,
      )
    } else {
      // Read back the code — it was not written to disk, so we need to
      // re-emit. But transpileFile already ran; for stdout mode we need
      // the code. Let's handle this more cleanly.
      // Actually, the report doesn't carry the code. For stdout mode,
      // let's re-run the pipeline. This is a design choice: stdout mode
      // is for quick inspection, not for large files.
      const code = await emitToStdout(inputPath, options)
      if (code !== undefined) process.stdout.write(code)
    }
  } else {
    // Failure: print diagnostics to stderr.
    if (report.blockedNodes.length > 0) {
      process.stderr.write(
        `blocked: ${report.blockedNodes.join(', ')}\n`,
      )
    }
    const errs = report.diagnostics.filter((d) => d.severity === 'error')
    if (errs.length > 0) {
      process.stderr.write(`${formatDiagnosticsText(errs)}\n`)
    }
    process.stderr.write(
      `${summarizeDiagnostics(report.diagnostics)}\n`,
    )
  }

  // Exit codes: 0 ok, 1 conversion error/blocked, 2 environment error
  if (report.ok) return 0
  const envError = report.diagnostics.some(
    (d) => d.code === 'OSC5001' || d.code === 'OSC5003',
  )
  return envError && report.parsedNodes === 0 ? 2 : 1
}

/**
 * Structured path: `.scad` → parseScad → lowerScad → emitFaijs.
 * Skips CSG expansion entirely — preserves loops, recursion, modules as JS constructs.
 */
async function transpileStructured(
  abs: string,
  options: TranspileOptions,
): Promise<TranspileReport> {
  const label = basename(abs)
  const diags: Diagnostic[] = []

  // Step 1: Read source
  let text: string
  try {
    text = readFileSync(abs, 'utf8')
  } catch {
    diags.push({ code: 'OSC5003', severity: 'error', message: `Cannot read file: ${abs}` })
    return { ok: false, input: abs, parsedNodes: 0, emittedStatements: 0, blockedNodes: [], diagnostics: diags }
  }

  // Step 2: Parse SCAD → AST
  const parsed = parseScad(text, { path: label })
  diags.push(...parsed.diagnostics)

  // Step 3: Lower AST → Model IR (structured)
  const lowered = lowerScad(parsed.document, { path: abs })
  diags.push(...lowered.diagnostics)

  // Step 4: Emit IR → .fai.js
  let emitted = emitFaijs(lowered.model, options.compact ? { compact: true } : {})
  if (!options.compact && emitted.ok && emitted.code.length > 1_000_000) {
    const compactEmitted = emitFaijs(lowered.model, { compact: true })
    if (compactEmitted.ok && compactEmitted.code.length < emitted.code.length) {
      emitted = compactEmitted
    }
  }

  const errors = diags.filter((d) => d.severity === 'error')
  const hasErrors = errors.length > 0
  const isBlocked = !emitted.ok

  if (isBlocked && !hasErrors) {
    diags.push({ code: 'OSC3002', severity: 'error', message: `Conversion blocked: ${emitted.blocked.join(', ')}` })
  }

  const ok = !isBlocked && !hasErrors
  const report: TranspileReport = {
    ok,
    input: abs,
    ...(options.out !== undefined ? { output: options.out } : {}),
    parsedNodes: countScadNodes(parsed.document),
    emittedStatements: emitted.statementNodes.length,
    blockedNodes: emitted.blocked,
    diagnostics: diags,
  }

  if (ok && emitted.code.length > 0 && options.out !== undefined) {
    writeFileSync(options.out, emitted.code, 'utf8')
  }

  return report
}

/**
 * For `transpile` without `-o`: run the pipeline and return the code string.
 * Returns `undefined` if the pipeline fails (diagnostics already printed).
 */
async function emitToStdout(
  inputPath: string,
  options: TranspileOptions,
): Promise<string | undefined> {
  const abs = resolve(inputPath)
  const ext = extname(abs).toLowerCase()

  // Structured path — no OpenSCAD binary needed.
  if (ext === '.scad') {
    const useStructured = options.structured ||
      (!options.noStructured && detectUnsupportedModules(readFileSync(abs, 'utf8')).length === 0)
    if (useStructured) {
      const text = readFileSync(abs, 'utf8')
      const label = basename(abs)
      const parsed = parseScad(text, { path: label })
      const lowered = lowerScad(parsed.document, { path: abs })
      const emitted = emitFaijs(lowered.model)
      return emitted.ok ? emitted.code : undefined
    }
  }

  let csgText: string
  if (ext === '.csg') {
    csgText = readFileSync(abs, 'utf8')
  } else if (ext === '.scad') {
    const frontend = new OpenScadCliFrontend(
      options.openscadBin === undefined ? {} : { binaryPath: options.openscadBin },
    )
    const artifact = await frontend.compileScad(
      { filePath: abs },
      { timeoutMs: options.timeoutMs },
    )
    csgText = artifact.csgText
    if (csgText.length === 0) {
      for (const d of artifact.diagnostics) {
        process.stderr.write(`${d.code} ${d.severity}: ${d.message}\n`)
      }
      return undefined
    }
  } else {
    return undefined
  }

  const label = basename(abs)
  const parsed = parseCsg(csgText, { path: label })
  const lowered = lowerCsg(parsed.document, { path: label })
  const emitted = emitFaijs(lowered.model)
  return emitted.ok ? emitted.code : undefined
}

// ── auto-path-selection helpers ─────────────────────────────────────────────

/**
 * Builtin modules that the structured lower path does not yet support.
 * Used by the auto-selection logic to decide whether to fall back to CSG.
 */
const UNSUPPORTED_MODULE_KEYWORDS = [
  'hull', 'minkowski', 'offset', 'projection', 'polyhedron',
  'surface', 'text', 'fill',
]

/**
 * Scan .scad source text for modules that the structured path cannot handle.
 * Returns a list of unsupported module names found in the source.
 *
 * Uses a simple regex to detect module calls (word followed by `(`) which is
 * fast and good enough for auto-selection (false positives only cause an
 * unnecessary CSG fallback, which is safe).
 */
export function detectUnsupportedModules(sourceText: string): string[] {
  const found: string[] = []
  for (const name of UNSUPPORTED_MODULE_KEYWORDS) {
    const re = new RegExp(`\\b${name}\\s*\\(`, 'i')
    if (re.test(sourceText)) {
      found.push(name)
    }
  }
  return found
}

// ── helpers ────────────────────────────────────────────────────────────────

function countNodes(doc: { readonly nodes: readonly unknown[] }): number {
  return doc.nodes.length
}

function countScadNodes(doc: { readonly statements: readonly unknown[] }): number {
  return doc.statements.length
}

function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
