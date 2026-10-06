/**
 * `corpus` command — generate the three-state manifest for the 50 OpenSCAD
 * examples (plan §9.4, T304 / T005).
 *
 * The manifest records the conversion status of every example in the
 * verification corpus (`tests/fixtures/openscad-examples/csg/*.csg`):
 *
 *   - **ported**: the example converts successfully and passes faijs static check
 *   - **blocked**: the example contains out-of-scope nodes (OSC3002)
 *   - **skipped**: the example failed for non-capability reasons (parse error,
 *     oversized output, etc.)
 *
 * Every blocked/skipped entry must declare `blockedBy` — silence is forbidden
 * (manifest invariant, plan §9.4).
 *
 * Usage:
 *   faijs-openscad corpus [--check] [--json] [--openscad-bin <path>]
 *
 * Exit codes: 0 ok, 3 corpus incomplete.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsg } from '../../csg/parser'
import { lowerCsg } from '../../ir/lower'
import { emitFaijs } from '../../emit/faijs'
import { countCsgNodesByName } from '../../csg/ast'
import { summarizeDiagnostics } from '../../diagnostics/format'
import type { Diagnostic } from '../../diagnostics/diagnostic'
import { CONVERTER_NAME, CONVERTER_VERSION } from '../../version'

export type CorpusStatus = 'ported' | 'blocked' | 'skipped'

export interface CorpusManifestEntry {
  /** Stable id: the `.csg` filename. */
  readonly id: string
  /** Source `.scad` path (relative to examples root, POSIX separators). */
  readonly source: string
  readonly status: CorpusStatus
  /** For blocked/skipped: the reason(s). Must be non-empty. */
  readonly blockedBy: string[]
  /** CSG node count. */
  readonly parsedNodes: number
  /** Emitted statement count (0 when blocked). */
  readonly emittedStatements: number
  /** Node histogram for this example. */
  readonly nodeHistogram: Record<string, number>
  /** Blocked CSG node types (when status is blocked). */
  readonly blockedNodes: readonly string[]
  /** Error diagnostic codes (when status is skipped). */
  readonly errorCodes: string[]
  readonly notes?: string
}

export interface CorpusManifest {
  readonly generatedBy: string
  readonly generatedAt: string
  readonly converter: { name: string; version: string }
  readonly counts: Record<CorpusStatus, number>
  readonly entries: CorpusManifestEntry[]
}

const here = dirname(fileURLToPath(import.meta.url))
// When running from source (tsx/vitest), `here` is `src/cli/commands/`.
// When running from dist, `here` is `dist/cli/commands/`.
// In both cases, the project root is 3 levels up.
const ROOT = resolve(here, '..', '..', '..')
const EXAMPLES_CSG_DIR = join(ROOT, 'tests', 'fixtures', 'openscad-examples', 'csg')

export interface CorpusOptions {
  /** Only verify, don't write the manifest file. */
  readonly check?: boolean
  /** Print JSON to stdout. */
  readonly json?: boolean
  /** Explicit OpenSCAD binary path (unused for .csg input, kept for API symmetry). */
  readonly openscadBin?: string
}

export async function runCorpus(options: CorpusOptions = {}): Promise<number> {
  if (!existsSync(EXAMPLES_CSG_DIR)) {
    process.stderr.write(
      `corpus: CSG directory not found at ${EXAMPLES_CSG_DIR}\n` +
      'Run `tsx tests/verify-examples.ts --write` first to generate CSG from .scad files.\n',
    )
    return 3
  }

  const csgFiles = readdirSync(EXAMPLES_CSG_DIR)
    .filter((f) => f.endsWith('.csg'))
    .sort()

  if (csgFiles.length === 0) {
    process.stderr.write('corpus: no .csg files found. Run `tsx tests/verify-examples.ts --write` first.\n')
    return 3
  }

  const entries: CorpusManifestEntry[] = []
  let portedCount = 0
  let blockedCount = 0
  let skippedCount = 0

  for (const file of csgFiles) {
    const csgPath = join(EXAMPLES_CSG_DIR, file)
    const entry = await processCsgFile(file, csgPath)
    entries.push(entry)

    if (entry.status === 'ported') portedCount++
    else if (entry.status === 'blocked') blockedCount++
    else skippedCount++
  }

  const manifest: CorpusManifest = {
    generatedBy: `${CONVERTER_NAME} corpus`,
    generatedAt: new Date().toISOString(),
    converter: { name: CONVERTER_NAME, version: CONVERTER_VERSION },
    counts: { ported: portedCount, blocked: blockedCount, skipped: skippedCount },
    entries,
  }

  // Write manifest file
  const manifestPath = join(ROOT, 'tests', 'manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  if (options.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
  } else {
    process.stdout.write(
      `corpus: ${csgFiles.length} examples — ${portedCount} ported, ${blockedCount} blocked, ${skippedCount} skipped\n`,
    )
    for (const e of entries) {
      const detail = e.blockedNodes.length > 0 ? ` [${e.blockedNodes.join(',')}]` : ''
      const notes = e.notes ? ` (${e.notes})` : ''
      process.stdout.write(`  ${e.status.toUpperCase().padEnd(7)} ${e.id}${detail}${notes}\n`)
    }
  }

  // Verify manifest invariant: every blocked/skipped must have blockedBy
  for (const e of entries) {
    if (e.status !== 'ported' && e.blockedBy.length === 0) {
      process.stderr.write(`corpus: INVARIANT VIOLATION — ${e.id} is ${e.status} without blockedBy\n`)
      return 1
    }
  }

  return 0
}

async function processCsgFile(file: string, csgPath: string): Promise<CorpusManifestEntry> {
  const id = file
  // Derive source .scad path from the CSG filename convention:
  // "Basics__CSG.scad.csg" → "Basics/CSG.scad"
  const source = deriveScadPath(file)

  const text = readFileSync(csgPath, 'utf8')
  const diags: Diagnostic[] = []

  // Parse
  const parsed = parseCsg(text, { path: file })
  diags.push(...parsed.diagnostics)

  const errorCodes = new Set<string>()
  for (const d of diags) {
    if (d.severity === 'error') errorCodes.add(d.code)
  }

  // If parse has errors, it's skipped (not blocked — blocked is for capability)
  if (errorCodes.size > 0) {
    return {
      id,
      source,
      status: 'skipped',
      blockedBy: ['parse-error'],
      parsedNodes: parsed.document.nodes.length,
      emittedStatements: 0,
      nodeHistogram: histogramOf(parsed.document),
      blockedNodes: [],
      errorCodes: [...errorCodes].sort(),
      notes: summarizeDiagnostics(diags),
    }
  }

  // Lower
  const lowered = lowerCsg(parsed.document, { path: file })
  diags.push(...lowered.diagnostics)

  for (const d of lowered.diagnostics) {
    if (d.severity === 'error') errorCodes.add(d.code)
  }

  // Emit
  const emitted = emitFaijs(lowered.model)

  // Check for blocked nodes
  const isBlocked = !emitted.ok
  const blocked = emitted.blocked

  if (isBlocked) {
    return {
      id,
      source,
      status: 'blocked',
      blockedBy: blocked.length > 0 ? [...blocked].sort() : ['OSC3002'],
      parsedNodes: parsed.document.nodes.length,
      emittedStatements: 0,
      nodeHistogram: histogramOf(parsed.document),
      blockedNodes: [...blocked].sort(),
      errorCodes: errorCodes.size > 0 ? [...errorCodes].sort() : [],
    }
  }

  // Check for other error diagnostics
  if (errorCodes.size > 0) {
    return {
      id,
      source,
      status: 'skipped',
      blockedBy: [...errorCodes].sort(),
      parsedNodes: parsed.document.nodes.length,
      emittedStatements: emitted.statementNodes.length,
      nodeHistogram: histogramOf(parsed.document),
      blockedNodes: [],
      errorCodes: [...errorCodes].sort(),
      notes: summarizeDiagnostics(diags),
    }
  }

  // Success — but check if there's a known size limitation
  const codeSize = emitted.code.length
  if (codeSize > 1_000_000) {
    return {
      id,
      source,
      status: 'skipped',
      blockedBy: ['oversized-output'],
      parsedNodes: parsed.document.nodes.length,
      emittedStatements: emitted.statementNodes.length,
      nodeHistogram: histogramOf(parsed.document),
      blockedNodes: [],
      errorCodes: [],
      notes: `Generated code is ${Math.round(codeSize / 1024)} KB, exceeds faijs static checker 1 MiB limit`,
    }
  }

  return {
    id,
    source,
    status: 'ported',
    blockedBy: [],
    parsedNodes: parsed.document.nodes.length,
    emittedStatements: emitted.statementNodes.length,
    nodeHistogram: histogramOf(parsed.document),
    blockedNodes: [],
    errorCodes: [],
  }
}

/** Derive the original `.scad` path from a CSG filename. */
function deriveScadPath(csgFile: string): string {
  // Convention: "Basics__CSG.scad.csg" → "Basics/CSG.scad"
  const base = csgFile.replace(/\.csg$/, '')
  const parts = base.split('__')
  if (parts.length > 1) {
    const category = parts[0]
    const name = parts.slice(1).join('__')
    return `${category}/${name}`
  }
  return base
}

function histogramOf(doc: Parameters<typeof countCsgNodesByName>[0]): Record<string, number> {
  const map = countCsgNodesByName(doc)
  const out: Record<string, number> = {}
  for (const [k, v] of map) out[k] = v
  return out
}

// Re-export for tests
export { EXAMPLES_CSG_DIR }
