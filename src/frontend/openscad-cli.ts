/**
 * OpenSCAD CLI front-end (plan §4.1).
 *
 * Executes the official OpenSCAD binary as an *external process* via
 * `execFile` with an argv array — never a shell string — and reads the CSG dump
 * from stdout. OpenSCAD is GPL-2.0-or-later; it is invoked, not linked, and is
 * never bundled into the published npm artifact.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DiagnosticBag } from '../diagnostics/diagnostic'
import { DiagnosticCode } from '../diagnostics/codes'
import { sha256Hex } from '../util/hash'
import { discoverOpenScadBinary, probeVersion } from './discover-openscad'
import type {
  CsgArtifact,
  FrontendInfo,
  FrontendOptions,
  OpenScadFrontend,
  ScadInput,
} from './types'

const execFileAsync = promisify(execFile)

export const DEFAULT_TIMEOUT_MS = 120_000

export interface OpenScadCliFrontendOptions {
  /** Explicit binary path (highest precedence). */
  readonly binaryPath?: string
}

export class OpenScadCliFrontend implements OpenScadFrontend {
  readonly kind = 'cli' as const

  constructor(private readonly options: OpenScadCliFrontendOptions = {}) {}

  async inspect(): Promise<FrontendInfo> {
    const bag = new DiagnosticBag()
    const found = await discoverOpenScadBinary({ explicitPath: this.options.binaryPath })
    bag.addAll(found.diagnostics)
    if (!found.path) {
      return { kind: this.kind, available: false, diagnostics: bag.all() }
    }
    return {
      kind: this.kind,
      available: true,
      binaryPath: found.path,
      ...(found.version === undefined ? {} : { version: found.version }),
      identity: `OpenSCAD ${found.version ?? '(unknown version)'} — ${found.path}`,
      diagnostics: bag.all(),
    }
  }

  async compileScad(input: ScadInput, options: FrontendOptions = {}): Promise<CsgArtifact> {
    const bag = new DiagnosticBag()
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const found = await discoverOpenScadBinary({ explicitPath: this.options.binaryPath })
    bag.addAll(found.diagnostics)
    if (!found.path) {
      return {
        csgText: '',
        sha256: sha256Hex(''),
        producedBy: { kind: this.kind },
        sourcePath: input.filePath,
        diagnostics: bag.all(),
      }
    }

    const args = ['--export-format', 'csg', '-o', '-', input.filePath]
    if (options.extraArgs?.length) args.unshift(...options.extraArgs)

    try {
      const { stdout, stderr } = await execFileAsync(found.path, args, {
        cwd: options.cwd ?? input.cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        env: options.env ? { ...process.env, ...options.env } : undefined,
      })
      // OpenSCAD writes warnings to stderr even on success; surface them as info
      // so CI stderr-zero-tolerance is not triggered by the child's own stream.
      if (stderr && stderr.trim().length > 0) {
        bag.add({
          code: DiagnosticCode.OSC5003,
          severity: 'info',
          message: `OpenSCAD wrote to stderr: ${stderr.trim().slice(0, 500)}`,
        })
      }
      return {
        csgText: stdout ?? '',
        sha256: sha256Hex(stdout ?? ''),
        producedBy: { kind: this.kind, binaryPath: found.path, version: found.version },
        sourcePath: input.filePath,
        diagnostics: bag.all(),
      }
    } catch (err) {
      const e = err as { code?: string | number; message?: string; stderr?: string; killed?: boolean }
      const detail = e.stderr?.trim() || e.message || String(err)
      bag.add({
        code: DiagnosticCode.OSC5003,
        message: `OpenSCAD front-end failed (${e.code ?? 'exit non-zero'})${e.killed ? ' — killed by timeout' : ''}: ${detail.slice(0, 800)}`,
      })
      return {
        csgText: '',
        sha256: sha256Hex(''),
        producedBy: { kind: this.kind, binaryPath: found.path, version: found.version },
        sourcePath: input.filePath,
        diagnostics: bag.all(),
      }
    }
  }
}

/**
 * Version of the binary that would be used, or `undefined`.
 * Exposed for `doctor` and for the version-mismatch probe (OSC5002).
 */
export async function resolveOpenScadVersion(
  binaryPath?: string,
): Promise<{ path?: string; version?: string; raw?: string }> {
  const found = await discoverOpenScadBinary({ explicitPath: binaryPath })
  if (!found.path) return {}
  const probe = await probeVersion(found.path)
  return { path: found.path, version: probe.version, raw: probe.raw }
}
