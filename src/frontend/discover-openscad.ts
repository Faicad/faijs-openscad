import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { promisify } from 'node:util'
import { DiagnosticBag } from '../diagnostics/diagnostic'
import { DiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/diagnostic'

const execFileAsync = promisify(execFile)

export type BinarySource =
  | 'explicit' // --openscad-bin / explicit parameter
  | 'env' // OPENSCAD_BIN
  | 'platform-default' // OS install location
  | 'PATH' // resolved through PATH lookup
  | 'none'

export interface DiscoveredBinary {
  readonly path?: string
  readonly source: BinarySource
  /** Parsed version string, e.g. `2021.01`. Undefined when not probed/failed. */
  readonly version?: string
  /** Raw `--version` output, kept for diagnostics. */
  readonly rawVersion?: string
  readonly diagnostics: readonly Diagnostic[]
}

export interface DiscoverOptions {
  /** Explicit path wins over everything else. */
  readonly explicitPath?: string
  /** Skip the `--version` probe (cheaper; used by pure path discovery). */
  readonly probeVersion?: boolean
  readonly timeoutMs?: number
}

/**
 * Platform install locations. Only *discovery* hints — the binary is always
 * executed as an external process and never bundled into the npm artifact
 * (see plan §13: OpenSCAD is GPL-2.0-or-later).
 */
export function platformDefaultPaths(): readonly string[] {
  switch (platform()) {
    case 'win32':
      return [
        'C:\\Program Files\\OpenSCAD\\openscad.exe',
        'C:\\Program Files (x86)\\OpenSCAD\\openscad.exe',
      ]
    case 'darwin':
      return ['/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD']
    default:
      return ['/usr/bin/openscad', '/usr/local/bin/openscad']
  }
}

/** Resolve `openscad` through PATH using the platform lookup command. */
export async function resolveFromPath(timeoutMs = 10_000): Promise<string | undefined> {
  const cmd = platform() === 'win32' ? 'where' : 'which'
  const arg = 'openscad'
  try {
    const { stdout } = await execFileAsync(cmd, [arg], {
      timeout: timeoutMs,
      windowsHide: true,
    })
    const first = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0)
    return first
  } catch {
    return undefined
  }
}

/**
 * Parse an OpenSCAD version from `--version` output.
 * Observed shape: `OpenSCAD version 2021.01`.
 * Dev builds append e.g. `2021.01.ai1234` / `.ci1234`; those suffixes are kept
 * because they matter when judging baseline compatibility.
 */
export function parseOpenScadVersion(raw: string): string | undefined {
  const m = /\b(\d{4}\.\d{2}(?:[.\-A-Za-z0-9]*)?)/.exec(raw)
  return m?.[1]
}

/**
 * Discover the OpenSCAD binary.
 *
 * Order (plan §4.1): explicit `--openscad-bin` → `OPENSCAD_BIN` → platform
 * default install path → PATH. Never throws: absence is reported as OSC5001.
 */
export async function discoverOpenScadBinary(
  options: DiscoverOptions = {},
): Promise<DiscoveredBinary> {
  const bag = new DiagnosticBag()
  const timeoutMs = options.timeoutMs ?? 20_000

  const candidates: Array<{ path?: string; source: BinarySource }> = [
    { path: options.explicitPath, source: 'explicit' },
    { path: process.env.OPENSCAD_BIN, source: 'env' },
  ]
  const defaults = platformDefaultPaths()
  for (const p of defaults) candidates.push({ path: p, source: 'platform-default' })
  const fromPath = await resolveFromPath(Math.min(timeoutMs, 10_000))
  if (fromPath) candidates.push({ path: fromPath, source: 'PATH' })

  for (const c of candidates) {
    if (!c.path || c.path.trim() === '') continue
    if (!existsSync(c.path)) continue
    const result: DiscoveredBinary = {
      path: c.path,
      source: c.source,
      diagnostics: bag.all(),
    }
    if (options.probeVersion === false) return result
    const probe = await probeVersion(c.path, timeoutMs)
    return { ...result, version: probe.version, rawVersion: probe.raw, diagnostics: bag.all() }
  }

  bag.add({
    code: DiagnosticCode.OSC5001,
    message:
      'OpenSCAD binary not found. Set --openscad-bin or OPENSCAD_BIN, or convert .csg input (needs no external binary).',
  })
  return { source: 'none', diagnostics: bag.all() }
}

/** Run `<bin> --version`; failures yield `version: undefined`, never throw. */
export async function probeVersion(
  binPath: string,
  timeoutMs = 20_000,
): Promise<{ version?: string; raw?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(binPath, ['--version'], {
      timeout: timeoutMs,
      windowsHide: true,
    })
    const raw = `${stdout ?? ''}${stderr ?? ''}`.trim()
    return { version: parseOpenScadVersion(raw), raw }
  } catch {
    return {}
  }
}
