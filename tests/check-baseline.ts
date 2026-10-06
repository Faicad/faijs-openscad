/**
 * Guard the version/corpus pins (plan §10).
 *
 * `src/baseline.ts` is the single source of truth; `tests/baseline.json` is a
 * derived artifact. This script fails when they drift, and verifies the OpenSCAD
 * `examples/` verification corpus on disk matches the pinned fixture count.
 *
 * Exit codes: 0 ok, 3 baseline/corpus incomplete (plan §7.2).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BASELINE } from '../src/baseline'

const ROOT = resolve(import.meta.dirname, '..')
const JSON_PATH = join(ROOT, 'tests', 'baseline.json')
const EXAMPLES_CSG_DIR = join(ROOT, 'tests', 'fixtures', 'openscad-examples', 'csg')

function countExamplesCsg(): number {
  try {
    return readdirSync(EXAMPLES_CSG_DIR).filter((n) => n.endsWith('.csg')).length
  } catch {
    return -1
  }
}

function main(): number {
  if (!existsSync(JSON_PATH)) {
    process.stderr.write(`baseline.json missing at ${JSON_PATH}\n`)
    return 3
  }
  const onDisk = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as unknown
  const a = JSON.stringify(onDisk)
  const b = JSON.stringify(BASELINE)
  if (a !== b) {
    process.stderr.write(
      'tests/baseline.json is out of sync with src/baseline.ts.\n' +
        'Update src/baseline.ts, then re-emit the JSON (or run with --fix).\n',
    )
    if (process.argv.includes('--fix')) {
      writeFileSync(JSON_PATH, `${b}\n`, 'utf8')
      process.stdout.write('baseline.json re-emitted from src/baseline.ts\n')
      return 0
    }
    return 3
  }

  const n = countExamplesCsg()
  if (n < 0) {
    process.stdout.write(
      `examples csg dir (${EXAMPLES_CSG_DIR}) missing — run \`npx tsx tests/verify-examples.ts --write\` first.\n`,
    )
    return 3
  }
  if (n !== BASELINE.verificationCorpus.fixtures) {
    process.stderr.write(
      `examples corpus drift: expected ${BASELINE.verificationCorpus.fixtures} .csg, found ${n}\n` +
        'Re-run tests/verify-examples.ts --write deliberately — never auto-overwrite goldens.\n',
    )
    return 3
  }
  process.stdout.write(`baseline OK (OpenSCAD examples verification corpus: ${n} fixtures)\n`)
  return 0
}

process.exit(main())
