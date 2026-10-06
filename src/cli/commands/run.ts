/**
 * `run` command — transpile + execute via faijs + export (plan §7.2, T302).
 *
 * This is the end-to-end command: `.scad` / `.csg` → `.fai.js` → faijs run →
 * STL / STEP / 3MF. It requires both the OpenSCAD binary (for `.scad` input)
 * and the OCCT wasm runtime (for faijs execution).
 *
 * When faijs runtime is not available, it falls back to transpile-only and
 * reports the limitation explicitly — never silently claims success.
 *
 * Exit codes: 0 ok, 1 conversion/execution error, 2 environment error.
 */
import { resolve, basename, extname } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseCsg } from '../../csg/parser'
import { lowerCsg } from '../../ir/lower'
import { emitFaijs } from '../../emit/faijs'
import { OpenScadCliFrontend } from '../../frontend/openscad-cli'
import { formatDiagnosticsText, summarizeDiagnostics } from '../../diagnostics/format'
import type { Diagnostic } from '../../diagnostics/diagnostic'

export interface RunOptions {
  /** Output path for the exported geometry (`--out`). */
  readonly out?: string
  /** Export mode: `brep` (STEP) or `mesh` (STL/3MF). Default `mesh`. */
  readonly mode?: 'brep' | 'mesh'
  /** Explicit OpenSCAD binary path. */
  readonly openscadBin?: string
  /** Timeout for the OpenSCAD subprocess, in ms. */
  readonly timeoutMs?: number
  /** Print JSON report. */
  readonly json?: boolean
}

export interface RunReport {
  readonly ok: boolean
  readonly input: string
  readonly output?: string
  readonly transpileOk: boolean
  readonly executionOk: boolean
  readonly executionMessage?: string
  readonly parsedNodes: number
  readonly emittedStatements: number
  readonly blockedNodes: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

export async function runRun(
  inputPath: string,
  options: RunOptions = {},
): Promise<number> {
  const abs = resolve(inputPath)
  const diags: Diagnostic[] = []

  // ── Obtain CSG ──────────────────────────────────────────────────────
  let csgText: string
  const ext = extname(abs).toLowerCase()

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
    diags.push(...artifact.diagnostics)
    csgText = artifact.csgText
  } else {
    process.stderr.write(`run: unsupported file extension "${ext}". Use .scad or .csg.\n`)
    return 1
  }

  if (csgText.length === 0) {
    const hasError = diags.some((d) => d.severity === 'error')
    if (!hasError) {
      diags.push({ code: 'OSC5003', severity: 'error', message: 'No CSG output.' })
    }
    const report: RunReport = {
      ok: false,
      input: abs,
      transpileOk: false,
      executionOk: false,
      parsedNodes: 0,
      emittedStatements: 0,
      blockedNodes: [],
      diagnostics: diags,
    }
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return 2
  }

  // ── Parse + Lower + Emit ─────────────────────────────────────────────
  const label = basename(abs)
  const parsed = parseCsg(csgText, { path: label })
  diags.push(...parsed.diagnostics)
  const lowered = lowerCsg(parsed.document, { path: label })
  diags.push(...lowered.diagnostics)
  const emitted = emitFaijs(lowered.model)

  if (!emitted.ok) {
    diags.push({
      code: 'OSC3002',
      severity: 'error',
      message: `Conversion blocked: ${emitted.blocked.join(', ')}`,
    })
  }

  const transpileOk = emitted.ok && !diags.some((d) => d.severity === 'error')

  if (!transpileOk) {
    const report: RunReport = {
      ok: false,
      input: abs,
      transpileOk: false,
      executionOk: false,
      parsedNodes: parsed.document.nodes.length,
      emittedStatements: emitted.statementNodes.length,
      blockedNodes: emitted.blocked,
      diagnostics: diags,
    }
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else {
      if (emitted.blocked.length > 0)
        process.stderr.write(`blocked: ${emitted.blocked.join(', ')}\n`)
      const errs = diags.filter((d) => d.severity === 'error')
      if (errs.length > 0) process.stderr.write(`${formatDiagnosticsText(errs)}\n`)
      process.stderr.write(`${summarizeDiagnostics(diags)}\n`)
    }
    return 1
  }

  // ── Execute via faijs ────────────────────────────────────────────────
  let executionOk = false
  let executionMessage: string | undefined

  // Check if runtime execution is available (FAIJS_PROBE_RUNTIME=1).
  const runtimeEnabled = process.env.FAIJS_PROBE_RUNTIME === '1'

  if (!runtimeEnabled) {
    executionMessage =
      'faijs runtime execution is not enabled (set FAIJS_PROBE_RUNTIME=1 and ensure OCCT wasm is installed)'
    diags.push({
      code: 'OSC5001',
      severity: 'info',
      message: executionMessage,
    })
  } else {
    try {
      // Write the .fai.js to a temp file and execute it.
      const tmpFai = abs.replace(/\.(scad|csg)$/, '.fai.js')
      writeFileSync(tmpFai, emitted.code, 'utf8')

      // Attempt to run the faijs script.
      const result = await executeFaijs(tmpFai, options.out, options.mode ?? 'mesh')
      if (result.ok) {
        executionOk = true
        executionMessage = result.message
      } else {
        executionOk = false
        executionMessage = result.message
        diags.push({
          code: 'OSC4001',
          severity: 'error',
          message: `faijs execution failed: ${result.message}`,
        })
      }
    } catch (err) {
      executionOk = false
      executionMessage = `faijs execution threw: ${String(err)}`
      diags.push({
        code: 'OSC4001',
        severity: 'error',
        message: executionMessage,
      })
    }
  }

  const ok = transpileOk && executionOk

  const report: RunReport = {
    ok,
    input: abs,
    ...(options.out !== undefined ? { output: options.out } : {}),
    transpileOk,
    executionOk,
    ...(executionMessage !== undefined ? { executionMessage } : {}),
    parsedNodes: parsed.document.nodes.length,
    emittedStatements: emitted.statementNodes.length,
    blockedNodes: emitted.blocked,
    diagnostics: diags,
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else if (ok) {
    process.stdout.write(
      `ok: ${abs} → ${options.out ?? '(executed)'} (${report.emittedStatements} statements)\n`,
    )
  } else {
    process.stderr.write(`${summarizeDiagnostics(diags)}\n`)
    if (executionMessage && !executionOk) {
      process.stderr.write(`execution: ${executionMessage}\n`)
    }
  }

  return ok ? 0 : 1
}

/**
 * Execute a `.fai.js` file via the faijs runtime and export geometry.
 *
 * This is guarded by FAIJS_PROBE_RUNTIME and requires OCCT wasm.
 */
async function executeFaijs(
  faiPath: string,
  outPath: string | undefined,
  mode: 'brep' | 'mesh',
): Promise<{ ok: boolean; message: string }> {
  // The faijs runtime execution path is still under development.
  // For now, we report that the code was generated but execution
  // requires the full runtime stack.
  if (outPath === undefined) {
    return { ok: false, message: 'No output path specified (--out required for run)' }
  }

  // Try to dynamically import faijs and execute.
  try {
    const faijsPkg = await import('@faicad/faijs')
    const faijs = faijsPkg as unknown as {
      run?: (code: string, options: { output: string; mode: string }) => Promise<unknown>
      execute?: (code: string, options: { output: string; mode: string }) => Promise<unknown>
    }

    const code = readFileSync(faiPath, 'utf8')
    const runner = faijs.run ?? faijs.execute
    if (runner === undefined) {
      return {
        ok: false,
        message: 'faijs package does not expose run/execute function',
      }
    }

    await runner.call(faijsPkg, code, { output: outPath, mode })
    return { ok: true, message: `exported ${outPath}` }
  } catch (err) {
    return { ok: false, message: String(err) }
  }
}
