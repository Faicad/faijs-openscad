/**
 * Environment inspection (`faijs-openscad doctor`, and the public
 * `inspectEnvironment()` API).
 *
 * Node-only: it probes the filesystem and an external process. The browser
 * entry deliberately does not export this module.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Diagnostic } from './diagnostics/diagnostic'
import { DiagnosticBag } from './diagnostics/diagnostic'
import { DiagnosticCode } from './diagnostics/codes'
import { BASELINE } from './baseline'
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

/** Locate the OpenSCAD source corpus root. */
export function resolveCorpusRoot(override?: string): string | undefined {
  const fromEnv = process.env[BASELINE.openscadSource.env]
  const root = override ?? (fromEnv && fromEnv.trim() !== '' ? fromEnv : undefined)
  if (!root) return undefined
  return existsSync(root) ? root : undefined
}

/** Count the corpus globs. Kept tiny: only `*-expected.csg` style suffixes. */
export function countCorpus(root: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const key of ['dumpCsg', 'dumpExamplesCsg', 'astExpected'] as const) {
    const rel = BASELINE.corpusPaths[key]
    const dirEnd = rel.lastIndexOf('/')
    const dir = join(root, rel.slice(0, dirEnd))
    const suffix = rel.slice(dirEnd + 1).replace(/\*/g, '')
    let n = 0
    try {
      for (const name of readdirSync(dir)) {
        if (name.endsWith(suffix)) n++
      }
    } catch {
      n = 0
    }
    counts[key] = n
  }
  return counts
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
        `(${BASELINE.openscadBinary.requiredVersion}, source commit ${BASELINE.openscadSource.commit}). ` +
        `Use it for smoke only — do NOT regenerate corpus goldens with it.`,
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
          : { counts: countCorpus(corpusRoot), matchesBaseline: corpusCountsMatch(countCorpus(corpusRoot)) }),
      }
    : { configured: false }

  if (!corpus.configured) {
    bag.add({
      code: DiagnosticCode.OSC5001,
      severity: 'info',
      message: `${BASELINE.openscadSource.env} is not set (or does not exist) — corpus + example gates are skipped.`,
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

export function corpusCountsMatch(counts: Record<string, number>): boolean {
  const expected = BASELINE.corpusCounts
  return (
    counts.dumpCsg === expected.dumpCsg &&
    counts.dumpExamplesCsg === expected.dumpExamplesCsg &&
    counts.astExpected === expected.astExpected
  )
}

export const FAIJS_TARGET = FAIJS_TARGET_VERSION
