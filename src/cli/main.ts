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
import { CONVERTER_NAME, CONVERTER_VERSION, EMIT_PROTOCOL } from '../version'

const USAGE = `${CONVERTER_NAME} ${CONVERTER_VERSION}

Usage:
  faijs-openscad doctor [--json]
  faijs-openscad explain [CODE]
  faijs-openscad version
  faijs-openscad help

Not implemented yet (planned milestones M1-M4):
  transpile, dump, check, run, corpus, report
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
      flags[a.slice(1)] = true
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
        json: flags.json === true,
        ...(typeof flags['openscad-bin'] === 'string' ? { openscadBin: flags['openscad-bin'] } : {}),
        ...(typeof flags['openscad-src'] === 'string' ? { openscadSrc: flags['openscad-src'] } : {}),
      })
    case 'explain':
      return runExplain(positional[0])
    case 'transpile':
    case 'dump':
    case 'check':
    case 'run':
    case 'corpus':
    case 'report':
      return notImplemented(command)
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
