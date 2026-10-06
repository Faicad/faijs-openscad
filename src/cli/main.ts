#!/usr/bin/env node
/**
 * `faijs-openscad` CLI.
 *
 * Minimal, dependency-free argv parsing (no commander): the CLI must stay
 * installable as a thin bin over `dist/`.
 *
 * Exit codes (plan §7.2):
 *   0  success, no error diagnostics
 *   1  syntax / lowering / emitter / unsupported error
 *   2  environment error (OpenSCAD missing or version-incompatible under --strict)
 *   3  corpus / baseline incomplete
 */
import { runDoctor } from './commands/doctor'
import { runExplain } from './commands/explain'
import { runTranspile } from './commands/transpile'
import { runDump } from './commands/dump'
import { runCheck } from './commands/check'
import { runRun } from './commands/run'
import { runRunCand } from './commands/run-cand'
import { runCorpus } from './commands/corpus'
import { CONVERTER_NAME, CONVERTER_VERSION, EMIT_PROTOCOL } from '../version'

const USAGE = `${CONVERTER_NAME} ${CONVERTER_VERSION}

Usage:
  faijs-openscad transpile <input.scad|input.csg> [-o output.fai.js] [--openscad-bin <path>] [--timeout <ms>] [--dump-csg] [--json]
  faijs-openscad check <input.scad|input.csg> [--openscad-bin <path>] [--strict] [--json]
  faijs-openscad run <input.scad|input.csg> [-o output.stl] [--mode brep|mesh] [--openscad-bin <path>] [--json]
  faijs-openscad dump <input.scad> [-o output.csg] [--openscad-bin <path>]
  faijs-openscad run-cand [path] [--filter-node <name>] [--filter-name <substr>] [--cache <file>] [--json] [--write-fai]
  faijs-openscad corpus [--check] [--json]
  faijs-openscad doctor [--json] [--openscad-bin <path>]
  faijs-openscad explain [CODE]
  faijs-openscad version
  faijs-openscad help
`

interface ParsedArgs {
  readonly command?: string
  readonly positional: string[]
  readonly flags: Record<string, string | boolean>
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  let command: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const body = a.slice(2)
      const eq = body.indexOf('=')
      if (eq === -1) {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('-')) {
          flags[body] = next
          i++
        } else {
          flags[body] = true
        }
      } else {
        flags[body.slice(0, eq)] = body.slice(eq + 1)
      }
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      // Single-dash flags: -o value or -o=value (like --out)
      const body = a.slice(1)
      const eq = body.indexOf('=')
      if (eq === -1) {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('-')) {
          flags[body] = next
          i++
        } else {
          flags[body] = true
        }
      } else {
        flags[body.slice(0, eq)] = body.slice(eq + 1)
      }
      continue
    }
    if (command === undefined) command = a
    else positional.push(a)
  }
  return { command, positional, flags }
}

export function notImplemented(name: string): number {
  process.stderr.write(
    `faijs-openscad: command "${name}" is not implemented yet (see the development plan, milestone M1-M4).\n`,
  )
  return 1
}

function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const v = flags[name]
  return typeof v === 'string' ? v : undefined
}

function flagNumber(flags: Record<string, string | boolean>, name: string): number | undefined {
  const v = flags[name]
  if (typeof v !== 'string') return undefined
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? undefined : n
}

function flagBool(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true || flags[name] === 'true'
}

export async function main(argv: readonly string[]): Promise<number> {
  const { command, positional, flags } = parseArgs(argv)

  if (flags.version === true && command === undefined) {
    process.stdout.write(`${CONVERTER_NAME} ${CONVERTER_VERSION} (emit protocol ${EMIT_PROTOCOL})\n`)
    return 0
  }

  switch (command) {
    case undefined:
    case 'help':
    case '-h':
      process.stdout.write(USAGE)
      return 0
    case 'version':
    case '--version':
      process.stdout.write(`${CONVERTER_VERSION}\n`)
      return 0
    case 'doctor':
      return runDoctor({
        json: flagBool(flags, 'json'),
        ...flagString(flags, 'openscad-bin') !== undefined ? { openscadBin: flagString(flags, 'openscad-bin') } : {},
        ...flagString(flags, 'openscad-src') !== undefined ? { openscadSrc: flagString(flags, 'openscad-src') } : {},
      })
    case 'explain':
      return runExplain(positional[0])
    case 'transpile': {
      const input = positional[0]
      if (!input) {
        process.stderr.write('transpile: missing input file\n')
        return 1
      }
      return runTranspile(input, {
        ...flagString(flags, 'o') !== undefined || flagString(flags, 'out') !== undefined
          ? { out: flagString(flags, 'o') ?? flagString(flags, 'out') }
          : {},
        ...flagString(flags, 'openscad-bin') !== undefined ? { openscadBin: flagString(flags, 'openscad-bin') } : {},
        ...flagNumber(flags, 'timeout') !== undefined ? { timeoutMs: flagNumber(flags, 'timeout') } : {},
        dumpCsg: flagBool(flags, 'dump-csg'),
        allowPartial: flagBool(flags, 'allow-partial'),
        json: flagBool(flags, 'json'),
      })
    }
    case 'dump': {
      const input = positional[0]
      if (!input) {
        process.stderr.write('dump: missing input file\n')
        return 1
      }
      return runDump(input, {
        ...flagString(flags, 'o') !== undefined || flagString(flags, 'out') !== undefined
          ? { out: flagString(flags, 'o') ?? flagString(flags, 'out') }
          : {},
        ...flagString(flags, 'openscad-bin') !== undefined ? { openscadBin: flagString(flags, 'openscad-bin') } : {},
        ...flagNumber(flags, 'timeout') !== undefined ? { timeoutMs: flagNumber(flags, 'timeout') } : {},
      })
    }
    case 'check': {
      const input = positional[0]
      if (!input) {
        process.stderr.write('check: missing input file\n')
        return 1
      }
      return runCheck(input, {
        ...flagString(flags, 'openscad-bin') !== undefined ? { openscadBin: flagString(flags, 'openscad-bin') } : {},
        ...flagNumber(flags, 'timeout') !== undefined ? { timeoutMs: flagNumber(flags, 'timeout') } : {},
        strict: flagBool(flags, 'strict'),
        json: flagBool(flags, 'json'),
      })
    }
    case 'run': {
      const input = positional[0]
      if (!input) {
        process.stderr.write('run: missing input file\n')
        return 1
      }
      const mode = flagString(flags, 'mode')
      return runRun(input, {
        ...flagString(flags, 'o') !== undefined || flagString(flags, 'out') !== undefined
          ? { out: flagString(flags, 'o') ?? flagString(flags, 'out') }
          : {},
        ...mode !== undefined ? { mode: mode as 'brep' | 'mesh' } : {},
        ...flagString(flags, 'openscad-bin') !== undefined ? { openscadBin: flagString(flags, 'openscad-bin') } : {},
        ...flagNumber(flags, 'timeout') !== undefined ? { timeoutMs: flagNumber(flags, 'timeout') } : {},
        json: flagBool(flags, 'json'),
      })
    }
    case 'run-cand': {
      const path = positional[0] ?? '.'
      return runRunCand(path, {
        ...flagString(flags, 'filter-node') !== undefined ? { filterNode: flagString(flags, 'filter-node') } : {},
        ...flagString(flags, 'filter-name') !== undefined ? { filterName: flagString(flags, 'filter-name') } : {},
        ...flagString(flags, 'cache') !== undefined ? { cache: flagString(flags, 'cache') } : {},
        json: flagBool(flags, 'json'),
        ...flagString(flags, 'openscad-bin') !== undefined ? { openscadBin: flagString(flags, 'openscad-bin') } : {},
        ...flagNumber(flags, 'timeout') !== undefined ? { timeoutMs: flagNumber(flags, 'timeout') } : {},
        writeFai: flagBool(flags, 'write-fai'),
      })
    }
    case 'corpus':
      return runCorpus({
        check: flagBool(flags, 'check'),
        json: flagBool(flags, 'json'),
        ...flagString(flags, 'openscad-bin') !== undefined ? { openscadBin: flagString(flags, 'openscad-bin') } : {},
      })
    case 'report':
      return notImplemented('report')
    default:
      process.stderr.write(`faijs-openscad: unknown command "${command}"\n\n${USAGE}`)
      return 1
  }
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1] &&
  /cli[\\/]main\.(js|ts)$/.test(process.argv[1])

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((err) => {
      process.stderr.write(`faijs-openscad: fatal: ${String(err)}\n`)
      process.exitCode = 1
    })
}
