/**
 * Guard the version/corpus pins (plan §10).
 *
 * `src/baseline.ts` is the single source of truth; `tests/baseline.json` is a
 * derived artifact. This script fails when they drift, and — when OPENSCAD_SRC
 * is configured — when the on-disk corpus no longer matches the pinned counts.
 *
 * Exit codes: 0 ok, 3 baseline/corpus incomplete (plan §7.2).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BASELINE } from '../src/baseline'
import { countCorpus, resolveCorpusRoot } from '../src/environment'

const ROOT = resolve(import.meta.dirname, '..')
const JSON_PATH = join(ROOT, 'tests', 'baseline.json')

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

  const root = resolveCorpusRoot()
  if (!root) {
    process.stdout.write(
      `${BASELINE.openscadSource.env} not configured — baseline JSON/TS consistency OK, corpus counts not verified.\n`,
    )
    return 0
  }
  const counts = countCorpus(root)
  const ok =
    counts.dumpCsg === BASELINE.corpusCounts.dumpCsg &&
    counts.dumpExamplesCsg === BASELINE.corpusCounts.dumpExamplesCsg &&
    counts.astExpected === BASELINE.corpusCounts.astExpected
  if (!ok) {
    process.stderr.write(
      `corpus drift: expected ${JSON.stringify(BASELINE.corpusCounts)}, found ${JSON.stringify(counts)}\n` +
        'Re-pin deliberately (update src/baseline.ts) — never auto-overwrite goldens.\n',
    )
    return 3
  }
  process.stdout.write(`baseline OK (corpus at ${root})\n`)
  return 0
}

process.exit(main())
