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
})

describe('CLI command routing', () => {
  it('version prints the version and exits 0', async () => {
    const r = await run(['version'])
    expect(r.code).toBe(0)
    expect(r.out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    expect(r.err).toBe('')
  })

  it('help exits 0 and lists the commands', async () => {
    const r = await run(['help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('doctor')
    expect(r.err).toBe('')
    expect((await run([])).code).toBe(0)
  })

  it('doctor exits 0 whether or not OpenSCAD is installed', async () => {
    // A missing binary reduces capability; it must not fail the doctor command.
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

  it('commands scheduled for later milestones fail loudly instead of pretending', async () => {
    for (const cmd of ['transpile', 'dump', 'check', 'run', 'corpus', 'report']) {
      const r = await run([cmd])
      expect(r.code).toBe(1)
      expect(r.err).toContain('not implemented yet')
    }
  })

  it('unknown command exits 1', async () => {
    const r = await run(['frobnicate'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('unknown command')
  })
})
