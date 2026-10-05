/**
 * Manifest contract tests (plan §9.4 / T005).
 *
 * The three-state manifest is the difference between "we don't support it yet"
 * and "we don't know". A blocked/skipped entry without a reason is forbidden,
 * and this is enforced in tests — not just in a code comment.
 */
import { describe, expect, it } from 'vitest'
import { assertManifestInvariant, buildManifest } from './gen-manifest'
import type { ManifestEntry } from './gen-manifest'

function entry(status: ManifestEntry['status'], blockedBy: string[]): ManifestEntry {
  return {
    id: 'x',
    source: 'x',
    sha256: '0'.repeat(64),
    bytes: 1,
    kind: 'csg',
    status,
    blockedBy,
    diagnostics: [],
  }
}

describe('manifest invariants', () => {
  it('rejects blocked/skipped entries without a reason', () => {
    expect(() => assertManifestInvariant([entry('blocked', [])])).toThrow(/without blockedBy/)
    expect(() => assertManifestInvariant([entry('skipped', [])])).toThrow(/without blockedBy/)
  })

  it('accepts blocked entries that declare why', () => {
    expect(() => assertManifestInvariant([entry('blocked', ['M0:converter-not-implemented'])])).not.toThrow()
  })

  it('ported entries need no reason', () => {
    expect(() => assertManifestInvariant([entry('ported', [])])).not.toThrow()
  })
})

describe('buildManifest', () => {
  // The corpus is an external checkout; when it is absent the builder is still
  // exercised through the invariant tests above (which is what CI guarantees).
  const root = process.env.OPENSCAD_SRC
  it.skipIf(!root)('produces one blocked-but-explained entry per corpus file', () => {
    const manifest = buildManifest(root as string)
    expect(manifest.entries.length).toBeGreaterThan(0)
    for (const e of manifest.entries) {
      expect(e.status).toBe('blocked')
      expect(e.blockedBy.length).toBeGreaterThan(0)
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(manifest.counts.blocked).toBe(manifest.entries.length)
    expect(manifest.baseline.openscadCommit).toMatch(/^[0-9a-f]{40}$/)
  })
})
