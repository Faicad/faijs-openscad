/**
 * `check` command — transpile + faijs static validation (plan §7.2, T302).
 *
 * Runs the full transpile pipeline, then feeds the generated `.fai.js` to
 * faijs's static checker (`extractMetadata`). This is the CI-friendly gate:
 * it doesn't need OCCT wasm, but it does need `@faicad/faijs` installed.
 *
 * Exit codes: 0 ok, 1 conversion or check error, 2 environment error.
 */
import { resolve, basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { parseCsg } from '../../csg/parser'
import { lowerCsg } from '../../ir/lower'
import { emitFaijs } from '../../emit/faijs'
import { OpenScadCliFrontend } from '../../frontend/openscad-cli'
import { formatDiagnosticsText, summarizeDiagnostics } from '../../diagnostics/format'
import type { Diagnostic } from '../../diagnostics/diagnostic'

export interface CheckOptions {
  /** Explicit OpenSCAD binary path. */
  readonly openscadBin?: string
  /** Timeout for the OpenSCAD subprocess, in ms. */
  readonly timeoutMs?: number
  /** Treat warnings as errors. */
  readonly strict?: boolean
  /** Print JSON report. */
  readonly json?: boolean
}

export interface CheckReport {
  readonly ok: boolean
  readonly input: string
  readonly transpileOk: boolean
  readonly staticCheckOk: boolean
  readonly staticCheckMessage?: string
  readonly parsedNodes: number
  readonly emittedStatements: number
  readonly blockedNodes: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

export async function runCheck(
  inputPath: string,
  options: CheckOptions = {},
): Promise<number> {
  const abs = resolve(inputPath)
  const diags: Diagnostic[] = []

  // ── Obtain CSG ──────────────────────────────────────────────────────
  let csgText: string
  const ext = abs.toLowerCase().endsWith('.csg')

  if (ext) {
    csgText = readFileSync(abs, 'utf8')
  } else {
    const frontend = new OpenScadCliFrontend(
      options.openscadBin === undefined ? {} : { binaryPath: options.openscadBin },
    )
    const artifact = await frontend.compileScad(
      { filePath: abs },
      { timeoutMs: options.timeoutMs },
    )
    diags.push(...artifact.diagnostics)
    csgText = artifact.csgText
  }

  if (csgText.length === 0) {
    const hasError = diags.some((d) => d.severity === 'error')
    if (!hasError) {
      diags.push({ code: 'OSC5003', severity: 'error', message: 'No CSG output.' })
    }
    const report: CheckReport = {
      ok: false,
      input: abs,
      transpileOk: false,
      staticCheckOk: false,
      parsedNodes: 0,
      emittedStatements: 0,
      blockedNodes: [],
      diagnostics: diags,
    }
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else process.stderr.write(`${formatDiagnosticsText(diags)}\n`)
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

  // ── faijs static check ───────────────────────────────────────────────
  let staticCheckOk = false
  let staticCheckMessage: string | undefined

  if (transpileOk && emitted.code.length > 0) {
    try {
      const { staticCheckAvailable, faijsStaticCheck } = await import(
        '../../__probe__/faijs-check'
      )
      const available = await staticCheckAvailable()
      if (!available) {
        staticCheckMessage = '@faicad/faijs not installed — static check skipped'
        staticCheckOk = false
        diags.push({
          code: 'OSC5001',
          severity: 'info',
          message: staticCheckMessage,
        })
      } else {
        const result = await faijsStaticCheck(emitted.code)
        if (result && result.ok) {
          staticCheckOk = true
        } else if (result) {
          staticCheckOk = false
          staticCheckMessage = result.message
          diags.push({
            code: 'OSC4001',
            severity: 'error',
            message: `faijs static check failed: ${result.message}`,
          })
        } else {
          staticCheckOk = false
          staticCheckMessage = 'faijs static check returned no result'
        }
      }
    } catch (err) {
      staticCheckOk = false
      staticCheckMessage = `faijs static check threw: ${String(err)}`
      diags.push({
        code: 'OSC4001',
        severity: 'error',
        message: staticCheckMessage,
      })
    }
  }

  const ok = transpileOk && staticCheckOk
  const strictMode = options.strict === true

  // In strict mode, warnings are also failures.
  const failOnWarnings = strictMode && diags.some((d) => d.severity === 'warning')
  const finalOk = ok && !failOnWarnings

  const report: CheckReport = {
    ok: finalOk,
    input: abs,
    transpileOk,
    staticCheckOk,
    ...(staticCheckMessage !== undefined ? { staticCheckMessage } : {}),
    parsedNodes: parsed.document.nodes.length,
    emittedStatements: emitted.statementNodes.length,
    blockedNodes: emitted.blocked,
    diagnostics: diags,
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    if (finalOk) {
      process.stdout.write(
        `ok: ${abs} — ${report.emittedStatements} statements, ${report.parsedNodes} CSG nodes\n`,
      )
    } else {
      const errs = diags.filter((d) => d.severity === 'error')
      if (errs.length > 0) process.stderr.write(`${formatDiagnosticsText(errs)}\n`)
      process.stderr.write(`${summarizeDiagnostics(diags)}\n`)
    }
  }

  if (!finalOk && !transpileOk) {
    // Environment vs conversion error
    const envError = diags.some(
      (d) => d.code === 'OSC5001' || d.code === 'OSC5003',
    )
    return envError && report.parsedNodes === 0 ? 2 : 1
  }
  return finalOk ? 0 : 1
}
