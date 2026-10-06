/**
 * `dump` command — `.scad` → `.csg` via the OpenSCAD binary (plan §7.2, T302).
 *
 * This is a thin wrapper over the OpenSCadCliFrontend that writes the CSG text
 * to a file or stdout. It's useful for generating corpus fixtures without
 * running the full transpile pipeline.
 *
 * Exit codes: 0 ok, 1 conversion error, 2 environment error.
 */
import { writeFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { OpenScadCliFrontend } from '../../frontend/openscad-cli'
import { formatDiagnosticsText } from '../../diagnostics/format'

export interface DumpOptions {
  /** Output path (`-o`). If omitted, write to stdout. */
  readonly out?: string
  /** Explicit OpenSCAD binary path. */
  readonly openscadBin?: string
  /** Timeout for the OpenSCAD subprocess, in ms. */
  readonly timeoutMs?: number
}

export async function runDump(
  inputPath: string,
  options: DumpOptions = {},
): Promise<number> {
  const abs = resolve(inputPath)
  const ext = extname(abs).toLowerCase()

  if (ext === '.csg') {
    // Already CSG: just copy / echo.
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(abs, 'utf8')
    if (options.out !== undefined) {
      writeFileSync(options.out, text, 'utf8')
      process.stdout.write(`wrote ${options.out}\n`)
    } else {
      process.stdout.write(text)
    }
    return 0
  }

  if (ext !== '.scad') {
    process.stderr.write(`dump: unsupported file extension "${ext}". Use .scad or .csg.\n`)
    return 1
  }

  const frontend = new OpenScadCliFrontend(
    options.openscadBin === undefined ? {} : { binaryPath: options.openscadBin },
  )

  const artifact = await frontend.compileScad(
    { filePath: abs },
    { timeoutMs: options.timeoutMs },
  )

  // Surface environment errors.
  const hasEnvError = artifact.diagnostics.some(
    (d) => d.code === 'OSC5001' || d.code === 'OSC5003',
  )

  if (artifact.csgText.length === 0) {
    const errs = artifact.diagnostics.filter((d) => d.severity === 'error')
    if (errs.length > 0) {
      process.stderr.write(`${formatDiagnosticsText(errs)}\n`)
    }
    return hasEnvError ? 2 : 1
  }

  if (options.out !== undefined) {
    writeFileSync(options.out, artifact.csgText, 'utf8')
    process.stdout.write(`wrote ${options.out} (${artifact.csgText.length} bytes)\n`)
  } else {
    process.stdout.write(artifact.csgText)
  }

  // Print any info/warning diagnostics from OpenSCAD to stderr (not stdout,
  // so stdout stays clean CSG).
  const nonErrors = artifact.diagnostics.filter((d) => d.severity !== 'error')
  if (nonErrors.length > 0) {
    process.stderr.write(`${formatDiagnosticsText(nonErrors)}\n`)
  }

  return 0
}
