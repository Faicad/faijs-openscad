/**
 * Environment inspection (`faijs-openscad doctor`, and the public
 * `inspectEnvironment()` API).
 *
 * Node-only: it probes the filesystem and an external process. The browser
 * entry deliberately does not export this module.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Diagnostic } from './diagnostics/diagnostic'
import { DiagnosticBag } from './diagnostics/diagnostic'
import { DiagnosticCode } from './diagnostics/codes'
import { BASELINE, OPENSCAD_SRC_ENV } from './baseline'
import { discoverOpenScadBinary } from './frontend/discover-openscad'
import { CONVERTER_NAME, CONVERTER_VERSION, FAIJS_TARGET_VERSION } from './version'

export interface FaijsProbe {
  readonly installed: boolean
  readonly version?: string
  readonly resolvedFrom?: string
}

export interface CorpusProbe {
  readonly configured: boolean
  readonly root?: string
  readonly counts?: Record<string, number>
  readonly matchesBaseline?: boolean
}

export interface EnvironmentReport {
  readonly converter: { name: string; version: string }
  readonly node: { version: string; platform: string; arch: string }
  readonly openscad: {
    readonly available: boolean
    readonly path?: string
    readonly source?: string
    readonly version?: string
    readonly matchesBaseline: boolean
  }
  readonly faijs: FaijsProbe
  readonly corpus: CorpusProbe
  readonly diagnostics: readonly Diagnostic[]
}

export interface InspectOptions {
  /** Override the OpenSCAD binary path. */
  readonly openscadBin?: string
  /** Override the OpenSCAD source root (corpus). */
  readonly openscadSrc?: string
  /** Working directory used to resolve `node_modules/@faicad/faijs`. */
  readonly cwd?: string
  /** Skip counting corpus files (faster). */
  readonly skipCorpusCount?: boolean
}

/** Read the installed @faicad/faijs version, if any. */
export function probeFaijs(cwd = process.cwd()): FaijsProbe {
  const candidate = join(cwd, 'node_modules', '@faicad', 'faijs', 'package.json')
  if (!existsSync(candidate)) return { installed: false }
  try {
    const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string }
    return { installed: true, version: pkg.version, resolvedFrom: candidate }
  } catch {
    return { installed: true, resolvedFrom: candidate }
  }
}

const REPO_ROOT = dirname(fileURLToPath(import.meta.url)) + '/..'
const EXAMPLES_CSG_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'openscad-examples', 'csg')

/** Locate the optional OpenSCAD upstream corpus root (skipped by default). */
export function resolveCorpusRoot(override?: string): string | undefined {
  const fromEnv = process.env[OPENSCAD_SRC_ENV]
  const root = override ?? (fromEnv && fromEnv.trim() !== '' ? fromEnv : undefined)
  if (!root) return undefined
  return existsSync(root) ? root : undefined
}

/** Count the optional OpenSCAD upstream corpus: `*-expected.csg` files (recursive). */
export function countCorpus(root: string): Record<string, number> {
  const counts: Record<string, number> = { csg: 0 }
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('-expected.csg')) counts.csg++
    }
  }
  walk(root)
  return counts
}

/** Whether the OpenSCAD `examples/` verification corpus on disk matches the pinned fixture count. */
export function examplesCorpusMatchesBaseline(): boolean {
  let n = 0
  try {
    for (const name of readdirSync(EXAMPLES_CSG_DIR)) {
      if (name.endsWith('.csg')) n++
    }
  } catch {
    return false
  }
  return n === BASELINE.verificationCorpus.fixtures
}

export async function inspectEnvironment(options: InspectOptions = {}): Promise<EnvironmentReport> {
  const bag = new DiagnosticBag()
  const cwd = options.cwd ?? process.cwd()

  const found = await discoverOpenScadBinary({ explicitPath: options.openscadBin })
  bag.addAll(found.diagnostics)

  const matchesBaseline =
    found.version !== undefined && found.version.startsWith(BASELINE.openscadBinary.requiredVersion)
  if (found.version !== undefined && !matchesBaseline) {
    bag.add({
      code: DiagnosticCode.OSC5002,
      message:
        `OpenSCAD ${found.version} differs from the baseline build ` +
        `(${BASELINE.openscadBinary.requiredVersion}). ` +
        `Use it for smoke only — do NOT regenerate the examples verification corpus with it.`,
    })
  }

  const faijs = probeFaijs(cwd)
  if (!faijs.installed) {
    bag.add({
      code: DiagnosticCode.OSC5001,
      severity: 'info',
      message: `@faicad/faijs not found under ${cwd}/node_modules — emit/execute gates will be unavailable.`,
    })
  } else if (faijs.version !== BASELINE.faijsVersion) {
    bag.add({
      code: DiagnosticCode.OSC5002,
      severity: 'info',
      message: `faijs ${faijs.version} differs from pinned ${BASELINE.faijsVersion}.`,
    })
  }

  const corpusRoot = resolveCorpusRoot(options.openscadSrc)
  const corpus: CorpusProbe = corpusRoot
    ? {
        configured: true,
        root: corpusRoot,
        ...(options.skipCorpusCount
          ? {}
          : { counts: countCorpus(corpusRoot), matchesBaseline: examplesCorpusMatchesBaseline() }),
      }
    : { configured: false }

  if (!corpus.configured) {
    bag.add({
      code: DiagnosticCode.OSC5001,
      severity: 'info',
      message: `${OPENSCAD_SRC_ENV} is not set (or does not exist) — OpenSCAD upstream corpus + example gates are skipped; OpenSCAD examples verification corpus is the default baseline.`,
    })
  }

  return {
    converter: { name: CONVERTER_NAME, version: CONVERTER_VERSION },
    node: { version: process.version, platform: process.platform, arch: process.arch },
    openscad: {
      available: found.path !== undefined,
      ...(found.path === undefined ? {} : { path: found.path }),
      ...(found.path === undefined ? {} : { source: found.source }),
      ...(found.version === undefined ? {} : { version: found.version }),
      matchesBaseline,
    },
    faijs,
    corpus,
    diagnostics: bag.all(),
  }
}

export const FAIJS_TARGET = FAIJS_TARGET_VERSION
