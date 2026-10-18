/**
 * ref.stl baseline generator (M8, T801).
 *
 * Renders OpenSCAD examples to STL files for parity comparison.
 * For each .scad in tests/fixtures/openscad-examples/, calls OpenSCAD
 * to export a binary STL into tests/fixtures/openscad-examples/stl/.
 *
 * Also computes SHA-256 hashes and writes them to tests/ref-stl-hashes.json.
 *
 * Usage:
 *   tsx tests/gen-ref-stl.ts            # generate STLs
 *   tsx tests/gen-ref-stl.ts --check    # verify hashes without regenerating
 *
 * Environment variables:
 *   OPENSCAD_BIN   OpenSCAD executable path
 *   MCAD_LIB       MCAD library root (only for Old/example023.scad)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const EXAMPLES_ROOT = join(here, 'fixtures', 'openscad-examples')
const STL_OUT = join(EXAMPLES_ROOT, 'stl')
const BUILD = join(EXAMPLES_ROOT, 'build')
const OPENSCAD_BIN =
  process.env.OPENSCAD_BIN ?? 'C:/Program Files/OpenSCAD/openscad.exe'
const MCAD_LIB =
  process.env.MCAD_LIB ?? 'C:/git/OpenSCAD/webmcp-openscad/public/libraries/MCAD'
const CHECK = process.argv.includes('--check')

mkdirSync(STL_OUT, { recursive: true })
mkdirSync(BUILD, { recursive: true })

/** Recursively collect all .scad files under a directory. */
function collectScad(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...collectScad(p))
    else if (name.endsWith('.scad')) out.push(p)
  }
  return out.sort()
}

/** Compute SHA-256 hash of a file. */
function fileHash(path: string): string {
  const buf = readFileSync(path)
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Render a .scad file to binary STL using OpenSCAD.
 */
export function renderScadToStl(
  scadPath: string,
  outPath: string,
  openscadBin: string = OPENSCAD_BIN,
  mcadLib: string = MCAD_LIB,
): { ok: boolean; error?: string } {
  try {
    execFileSync(openscadBin, ['-o', outPath, scadPath], {
      timeout: 120_000,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, OPENSCADPATH: mcadLib },
    })
    return { ok: true }
  } catch (e: any) {
    const detail = String(e?.stderr ?? e?.message ?? e)
      .split('\n')
      .filter((l: string) => /ERROR|WARNING|deprecat/i.test(l))
      .slice(0, 2)
      .join(' ')
      .slice(0, 300)
    return { ok: false, error: detail || String(e?.message ?? e) }
  }
}

export interface RefStlEntry {
  readonly name: string
  readonly stlPath: string
  readonly hash: string
  readonly bytes: number
}

const os = existsSync(OPENSCAD_BIN) ? OPENSCAD_BIN : undefined
const scadFiles = collectScad(EXAMPLES_ROOT)
const entries: RefStlEntry[] = []
const failures: Array<{ name: string; error: string }> = []
/** Check-mode only: examples whose on-disk hash differs from the baseline. */
const mismatches: Array<{ name: string; error: string }> = []
const hashFile = join(here, 'ref-stl-hashes.json')

/** Recorded hash baseline (check mode): example name → sha256. */
function loadHashBaseline(): { hashes: Map<string, string>; knownFailures: Set<string> } | null {
  try {
    const parsed = JSON.parse(readFileSync(hashFile, 'utf8')) as {
      entries?: Array<{ name: string; hash: string }>
      failedExamples?: Array<{ name: string }>
    }
    if (!Array.isArray(parsed.entries)) return null
    return {
      hashes: new Map(parsed.entries.map((e) => [e.name, e.hash])),
      knownFailures: new Set((parsed.failedExamples ?? []).map((e) => e.name)),
    }
  } catch {
    return null
  }
}

const baseline = CHECK ? loadHashBaseline() : null

if (!os) {
  console.error(`OpenSCAD not found at ${OPENSCAD_BIN}`)
  console.error('Set OPENSCAD_BIN environment variable to your openscad.exe path')
  process.exit(2)
}

console.log('ref.stl baseline generator (M8, T801)')
console.log(`  EXAMPLES_ROOT = ${EXAMPLES_ROOT}`)
console.log(`  STL_OUT = ${STL_OUT}`)
console.log(`  OpenSCAD = ${os}`)
console.log(`  Mode = ${CHECK ? 'check' : 'generate'}`)
console.log(`  Examples found = ${scadFiles.length}`)
console.log('')

for (const scadPath of scadFiles) {
  const rel = relative(EXAMPLES_ROOT, scadPath).split('\\').join('/')
  const stlName = `${rel.replace(/[\\/]/g, '__')}.stl`
  const stlPath = join(STL_OUT, stlName)

  if (CHECK) {
    if (!baseline) {
      console.error(`No readable hash baseline at ${hashFile} — generate it first.`)
      process.exit(3)
    }
    if (!existsSync(stlPath)) {
      // Missing is only expected for examples the baseline already records as
      // render failures (2D/empty output). Anything else is real drift.
      if (baseline.knownFailures.has(rel)) {
        console.log(`  SKIP: ${rel} (known render failure)`)
      } else {
        failures.push({ name: rel, error: 'stl file missing' })
        console.log(`  MISSING: ${rel}`)
      }
      continue
    }
    const hash = fileHash(stlPath)
    const bytes = statSync(stlPath).size
    const recorded = baseline.hashes.get(rel)
    if (recorded === undefined) {
      mismatches.push({ name: rel, error: 'not present in baseline' })
      console.log(`  UNKNOWN: ${rel} (${bytes} bytes)`)
      continue
    }
    if (recorded !== hash) {
      mismatches.push({ name: rel, error: 'hash differs from baseline' })
      console.log(`  STALE: ${rel} (${bytes} bytes)`)
      continue
    }
    console.log(`  OK: ${rel} (${bytes} bytes)`)
    continue
  }

  const result = renderScadToStl(scadPath, stlPath)
  if (!result.ok) {
    failures.push({ name: rel, error: result.error ?? 'unknown' })
    console.log(`  FAIL: ${rel} — ${result.error}`)
    continue
  }

  if (!existsSync(stlPath)) {
    failures.push({ name: rel, error: 'no STL produced' })
    console.log(`  FAIL: ${rel} — no STL produced`)
    continue
  }

  const hash = fileHash(stlPath)
  const bytes = statSync(stlPath).size
  entries.push({ name: rel, stlPath, hash, bytes })
  console.log(`  OK: ${rel} (${bytes} bytes, ${hash.slice(0, 12)}…)`)
}

console.log('')
if (CHECK) {
  // `--check` verifies the on-disk STLs against the recorded baseline and
  // NEVER writes it (the old implementation re-recorded on every run, which
  // both made the check a no-op and clobbered the failure diagnostics).
  const bad = failures.length + mismatches.length
  console.log(`Checked ${scadFiles.length} examples against baseline: ${bad} differing`)
  if (bad > 0) {
    for (const f of [...failures, ...mismatches]) {
      console.error(`  DIFFERS: ${f.name} — ${f.error}`)
    }
    console.error(`WARNING: ${bad} example(s) differ from the baseline`)
    process.exit(1)
  }
  process.exit(0)
}

console.log(`Generated ${entries.length} ref.stl files, ${failures.length} failures`)

// Write hash baseline (deterministic: no timestamp — otherwise every
// regeneration changes the file and hash comparison becomes useless)
const hashes = {
  openscadBin: os,
  count: entries.length,
  failures: failures.length,
  entries: entries.map((e) => ({
    name: e.name,
    hash: e.hash,
    bytes: e.bytes,
  })),
  ...(failures.length > 0 ? { failedExamples: failures } : {}),
}
writeFileSync(hashFile, JSON.stringify(hashes, null, 2), 'utf8')
console.log(`Hashes written to ${relative(ROOT, hashFile)}`)

if (failures.length > 0) {
  console.error(`WARNING: ${failures.length} examples failed to render`)
  process.exit(1)
}
process.exit(0)
