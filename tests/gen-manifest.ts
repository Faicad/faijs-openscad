/**
 * Corpus manifest generator (plan §9.4 / T005).
 *
 * Emits a three-state manifest (`ported` / `blocked` / `skipped`) over the
 * OpenSCAD corpus. Hard rule: an entry may only be `blocked` or `skipped` with
 * a non-empty `blockedBy` — silence is not an acceptable corpus state.
 *
 * Usage:
 *   tsx tests/gen-manifest.ts [--src <openscad-root>] [--out <file>] [--kind csg|examples]
 *
 * Exit codes: 0 ok, 3 corpus not configured / incomplete.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { sha256Hex } from '../src/util/hash'
import { BASELINE } from '../src/baseline'
import { resolveCorpusRoot } from '../src/environment'

export type ManifestStatus = 'ported' | 'blocked' | 'skipped'

export interface ManifestEntry {
  /** Stable id: corpus-relative path, POSIX separators. */
  readonly id: string
  /** Same as id in M0 (kept separate: id may later be hash-based). */
  readonly source: string
  readonly sha256: string
  readonly bytes: number
  readonly kind: 'csg' | 'examples' | 'scad'
  readonly status: ManifestStatus
  readonly blockedBy: string[]
  readonly diagnostics: string[]
  readonly notes?: string
}

export interface CorpusManifest {
  readonly generatedBy: string
  readonly generatedAt: string
  readonly baseline: {
    readonly openscadCommit: string
    readonly faijsVersion: string
  }
  readonly counts: Record<ManifestStatus, number>
  readonly entries: ManifestEntry[]
}

const ROOT = resolve(import.meta.dirname, '..')

function collect(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith(suffix))
    .sort()
    .map((n) => join(dir, n))
}

/** Recursive collect: `examples/**\/*.scad` is nested by category. */
function collectRecursive(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectRecursive(full, suffix))
    else if (entry.name.endsWith(suffix)) out.push(full)
  }
  return out.sort()
}

function entryFor(absPath: string, corpusRoot: string, kind: ManifestEntry['kind'], blockedBy: string): ManifestEntry {
  const text = readFileSync(absPath, 'utf8')
  const id = relative(corpusRoot, absPath).split('\\').join('/')
  return {
    id,
    source: id,
    sha256: sha256Hex(text),
    bytes: Buffer.byteLength(text, 'utf8'),
    kind,
    status: 'blocked',
    blockedBy: [blockedBy],
    diagnostics: [],
    notes: 'M0 skeleton: converter pipeline not implemented yet.',
  }
}

/** Rejects any blocked/skipped entry without a reason. */
export function assertManifestInvariant(entries: readonly ManifestEntry[]): void {
  for (const e of entries) {
    if (e.status !== 'ported' && e.blockedBy.length === 0) {
      throw new Error(`manifest entry ${e.id} is ${e.status} without blockedBy — silent skips are forbidden`)
    }
  }
}

export function buildManifest(corpusRoot: string): CorpusManifest {
  const dumpDir = join(corpusRoot, 'tests', 'regression', 'dump')
  const dumpExamplesDir = join(corpusRoot, 'tests', 'regression', 'dump-examples')
  const examplesDir = join(corpusRoot, 'examples')

  const csgFiles = [
    ...collect(dumpDir, '-expected.csg').map((p) => [p, 'csg'] as const),
    ...collect(dumpExamplesDir, '-expected.csg').map((p) => [p, 'csg'] as const),
  ]
  const exampleFiles = collectRecursive(examplesDir, '.scad').map((p) => [p, 'examples'] as const)

  const entries: ManifestEntry[] = [
    ...csgFiles.map(([p, k]) => entryFor(p, corpusRoot, k, 'M0:converter-not-implemented')),
    ...exampleFiles.map(([p, k]) =>
      entryFor(p, corpusRoot, k, 'M0:needs-openscad-baseline-binary'),
    ),
  ]
  assertManifestInvariant(entries)

  const counts: Record<ManifestStatus, number> = { ported: 0, blocked: 0, skipped: 0 }
  for (const e of entries) counts[e.status]++

  return {
    generatedBy: 'faijs-openscad/tests/gen-manifest.ts',
    generatedAt: new Date().toISOString(),
    baseline: {
      openscadCommit: BASELINE.openscadSource.commit,
      faijsVersion: BASELINE.faijsVersion,
    },
    counts,
    entries,
  }
}

function main(): number {
  const args = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const corpusRoot = resolveCorpusRoot(get('--src'))
  if (!corpusRoot) {
    process.stderr.write(
      `${BASELINE.openscadSource.env} is not set (or does not exist) — cannot generate corpus manifest.\n`,
    )
    return 3
  }
  const out = resolve(ROOT, get('--out') ?? 'tests/corpus-manifest.json')
  const manifest = buildManifest(corpusRoot)
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  process.stdout.write(
    `wrote ${out}: ${manifest.entries.length} entries ` +
      `(ported=${manifest.counts.ported} blocked=${manifest.counts.blocked} skipped=${manifest.counts.skipped})\n`,
  )
  return 0
}

if (process.argv[1] && /gen-manifest\.(ts|js)$/.test(process.argv[1])) {
  process.exit(main())
}
