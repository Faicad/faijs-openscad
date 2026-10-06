import { describe, expect, it } from 'vitest'
import { main, parseArgs } from './main'

/**
 * The CI gate has *zero tolerance for test stderr* (see scripts/ci.ps1), and
 * several CLI paths deliberately write to stderr (unknown command, unknown
 * code, not-implemented). Those paths are asserted here with the streams
 * captured, so the assertion is real without polluting the suite output.
 */
interface Captured {
  out: string[]
  err: string[]
  restore: () => void
}

type Writable = { write: (chunk: unknown) => boolean }

function captureStdio(): Captured {
  const out: string[] = []
  const err: string[] = []
  const stdout = process.stdout as unknown as Writable
  const stderr = process.stderr as unknown as Writable
  const origOut = stdout.write.bind(process.stdout)
  const origErr = stderr.write.bind(process.stderr)
  stdout.write = (chunk: unknown) => {
    out.push(String(chunk))
    return true
  }
  stderr.write = (chunk: unknown) => {
    err.push(String(chunk))
    return true
  }
  return {
    out,
    err,
    restore: () => {
      stdout.write = origOut
      stderr.write = origErr
    },
  }
}

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const cap = captureStdio()
  try {
    const code = await main(argv)
    return { code, out: cap.out.join(''), err: cap.err.join('') }
  } finally {
    cap.restore()
  }
}

describe('CLI argv parsing', () => {
  it('splits command, positionals and flags', () => {
    const r = parseArgs(['explain', 'OSC3201', '--json'])
    expect(r.command).toBe('explain')
    expect(r.positional).toEqual(['OSC3201'])
    expect(r.flags.json).toBe(true)
  })

  it('supports --flag=value', () => {
    const r = parseArgs(['doctor', '--openscad-bin=/x/y'])
    expect(r.flags['openscad-bin']).toBe('/x/y')
  })

  it('treats everything after -- as positional', () => {
    const r = parseArgs(['transpile', '--', '--weird'])
    expect(r.positional).toEqual(['--weird'])
  })

  it('supports -o shorthand for output', () => {
    const r = parseArgs(['transpile', 'input.scad', '-o', 'out.fai.js'])
    expect(r.command).toBe('transpile')
    expect(r.positional).toEqual(['input.scad'])
    expect(r.flags.o).toBe('out.fai.js')
  })
})

describe('CLI command routing', () => {
  it('version prints the version and exits 0', async () => {
    const r = await run(['version'])
    expect(r.code).toBe(0)
    expect(r.out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    expect(r.err).toBe('')
  })

  it('help exits 0 and lists all commands', async () => {
    const r = await run(['help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('transpile')
    expect(r.out).toContain('dump')
    expect(r.out).toContain('check')
    expect(r.out).toContain('run')
    expect(r.out).toContain('corpus')
    expect(r.out).toContain('doctor')
    expect(r.err).toBe('')
    expect((await run([])).code).toBe(0)
  })

  it('doctor exits 0 whether or not OpenSCAD is installed', async () => {
    const r = await run(['doctor'])
    expect(r.code).toBe(0)
    expect(r.err).toBe('')
    const json = await run(['doctor', '--json'])
    expect(json.code).toBe(0)
    expect(JSON.parse(json.out)).toHaveProperty('converter')
  })

  it('explain prints a known code', async () => {
    const r = await run(['explain', 'OSC3201'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('OSC3201')
  })

  it('explain rejects an unknown code with exit 1', async () => {
    const r = await run(['explain', 'NOPE'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('Unknown diagnostic code')
  })

  it('transpile without input exits 1', async () => {
    const r = await run(['transpile'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('missing input file')
  })

  it('dump without input exits 1', async () => {
    const r = await run(['dump'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('missing input file')
  })

  it('check without input exits 1', async () => {
    const r = await run(['check'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('missing input file')
  })

  it('run without input exits 1', async () => {
    const r = await run(['run'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('missing input file')
  })

  it('transpile with unsupported extension exits 1', async () => {
    const r = await run(['transpile', 'foo.txt'])
    expect(r.code).toBe(1)
  })

  it('report is still not implemented', async () => {
    const r = await run(['report'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('not implemented yet')
  })

  it('unknown command exits 1', async () => {
    const r = await run(['frobnicate'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('unknown command')
  })
})
