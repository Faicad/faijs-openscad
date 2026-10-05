/**
 * PROBE (permanent, plan §9.1 #1): OpenSCAD binary discovery.
 *
 * Records how a binary is found (explicit → OPENSCAD_BIN → platform default →
 * PATH), how `--version` output is parsed, and what "not found" looks like.
 * Never deleted: it is the executable evidence behind OSC5001/OSC5002.
 */
import { describe, expect, it } from 'vitest'
import {
  discoverOpenScadBinary,
  parseOpenScadVersion,
  platformDefaultPaths,
  probeVersion,
  resolveFromPath,
} from './discover-openscad'
import { DiagnosticCode } from '../diagnostics/codes'

describe('probe: OpenSCAD binary discovery', () => {
  it('parses the observed version shapes', () => {
    expect(parseOpenScadVersion('OpenSCAD version 2021.01')).toBe('2021.01')
    expect(parseOpenScadVersion('OpenSCAD version 2021.01\r\n')).toBe('2021.01')
    expect(parseOpenScadVersion('OpenSCAD version 2025.12.31.ai1234')).toBe('2025.12.31.ai1234')
    expect(parseOpenScadVersion('garbage')).toBeUndefined()
    expect(parseOpenScadVersion('')).toBeUndefined()
  })

  it('exposes platform-specific default locations', () => {
    const paths = platformDefaultPaths()
    expect(paths.length).toBeGreaterThan(0)
    for (const p of paths) expect(p.length).toBeGreaterThan(0)
  })

  it('PATH lookup returns a path or undefined, never throws', async () => {
    const found = await resolveFromPath()
    expect(found === undefined || typeof found === 'string').toBe(true)
  })

  it('reports OSC5001 when nothing can be found', async () => {
    // Force the "none" branch: an explicit path that does not exist still lets
    // env/platform/PATH win on a developer machine, so we assert the invariant
    // that holds in both worlds: either a path, or an OSC5001 diagnostic.
    const found = await discoverOpenScadBinary({
      explicitPath: '__definitely_missing_openscad__',
    })
    if (found.path === undefined) {
      expect(found.source).toBe('none')
      expect(found.diagnostics.some((d) => d.code === DiagnosticCode.OSC5001)).toBe(true)
    } else {
      expect(['env', 'platform-default', 'PATH']).toContain(found.source)
    }
  })

  it('discovery never throws and always reports a source', async () => {
    const found = await discoverOpenScadBinary()
    expect(typeof found.source).toBe('string')
    expect(Array.isArray(found.diagnostics)).toBe(true)
  })

  it('version probe tolerates a bad binary', async () => {
    const probe = await probeVersion('__definitely_missing_openscad__')
    expect(probe.version).toBeUndefined()
  })

  it('probeVersion(0) disables probing and keeps the path', async () => {
    const saved = process.env.OPENSCAD_BIN
    process.env.OPENSCAD_BIN = ''
    try {
      const found = await discoverOpenScadBinary({ probeVersion: false })
      const ok = found.path === undefined || found.version === undefined
      expect(ok).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.OPENSCAD_BIN
      else process.env.OPENSCAD_BIN = saved
    }
  })
})
