import { describe, expect, it } from 'vitest'
import { CAPABILITY_TABLE, capabilityClassOf, capabilityOf, nodesWithCapability, unclassifiedNodes } from './capability'
import { CSG_NODE_VOCABULARY } from '../csg/dialect'

describe('capability table', () => {
  it('classifies every node in the observed vocabulary', () => {
    expect(unclassifiedNodes()).toEqual([])
    for (const n of CSG_NODE_VOCABULARY) {
      expect(['direct', 'helper', 'approximate', 'unsupported']).toContain(capabilityClassOf(n))
    }
  })

  it('every non-direct entry carries a reason', () => {
    for (const e of CAPABILITY_TABLE) {
      if (e.capability !== 'direct') expect(e.note.length).toBeGreaterThan(10)
    }
  })

  it('unknown nodes fall back to unsupported (never skipped silently)', () => {
    expect(capabilityClassOf('definitely_not_a_node')).toBe('unsupported')
    expect(capabilityOf('definitely_not_a_node').note).toContain('never skipped')
  })

  it('P0 direct set matches the plan (§5.1)', () => {
    const p0Direct = CAPABILITY_TABLE.filter((e) => e.phase === 'P0' && e.capability === 'direct').map(
      (e) => e.node,
    )
    for (const n of ['cube', 'sphere', 'cylinder', 'union', 'difference', 'intersection', 'multmatrix', 'group', 'square', 'circle', 'polygon', 'linear_extrude', 'render']) {
      expect(p0Direct).toContain(n)
    }
  })

  it('minkowski stays unsupported: no silent approximation is allowed', () => {
    expect(capabilityClassOf('minkowski')).toBe('unsupported')
  })

  it('nodesWithCapability returns stable lists', () => {
    expect(nodesWithCapability('unsupported').length).toBeGreaterThan(0)
    expect(nodesWithCapability('direct').length).toBeGreaterThan(0)
  })
})
