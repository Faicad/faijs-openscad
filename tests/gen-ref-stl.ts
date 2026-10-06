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
    if (!existsSync(stlPath)) {
      failures.push({ name: rel, error: 'stl file missing' })
      console.log(`  MISSING: ${rel}`)
      continue
    }
    const hash = fileHash(stlPath)
    const bytes = statSync(stlPath).size
    entries.push({ name: rel, stlPath, hash, bytes })
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
console.log(`Generated ${entries.length} ref.stl files, ${failures.length} failures`)

// Write hash baseline
const hashFile = join(here, 'ref-stl-hashes.json')
const hashes = {
  generatedAt: new Date().toISOString(),
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
