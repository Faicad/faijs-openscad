import { describe, expect, it } from 'vitest'
import { DiagnosticBag, diagnostic } from './diagnostic'
import { DiagnosticCode, DIAGNOSTIC_CODES, isDowngradable } from './codes'
import { explainCode, formatDiagnosticsText, summarizeDiagnostics } from './format'

describe('DiagnosticBag', () => {
  it('defaults severity from the code registry', () => {
    const bag = new DiagnosticBag()
    const d = bag.add({ code: DiagnosticCode.OSC1003, message: 'unknown node' })
    expect(d.severity).toBe('error')
    const w = bag.add({ code: DiagnosticCode.OSC1004, message: 'unknown arg' })
    expect(w.severity).toBe('warning')
  })

  it('fills the hint from the registry when not overridden', () => {
    const d = diagnostic({ code: DiagnosticCode.OSC5001, message: 'missing' })
    expect(typeof d.hint).toBe('string')
    expect(d.hint!.length).toBeGreaterThan(0)
  })

  it('keeps an explicitly provided severity', () => {
    const d = diagnostic({
      code: DiagnosticCode.OSC5003,
      message: 'stderr noise',
      severity: 'info',
    })
    expect(d.severity).toBe('info')
  })

  it('filters by severity', () => {
    const bag = new DiagnosticBag()
    bag.add({ code: DiagnosticCode.OSC1003, message: 'a' })
    bag.add({ code: DiagnosticCode.OSC1004, message: 'b' })
    bag.add({ code: DiagnosticCode.OSC5001, message: 'c', severity: 'info' })
    expect(bag.errors()).toHaveLength(1)
    expect(bag.warnings()).toHaveLength(1)
    expect(bag.infos()).toHaveLength(1)
    expect(bag.hasErrors()).toBe(true)
  })

  it('--allow-partial downgrades only downgradable errors', () => {
    const bag = new DiagnosticBag()
    bag.add({ code: DiagnosticCode.OSC3002, message: 'no equivalent' }) // downgradable
    bag.add({ code: DiagnosticCode.OSC1002, message: 'unbalanced' }) // not downgradable
    const changed = bag.downgradePartial()
    expect(changed.map((c) => c.code)).toEqual([DiagnosticCode.OSC3002])
    expect(bag.hasErrors()).toBe(true) // syntax error must still fail
  })

  it('every code in the registry is unique and formed OSCxxxx', () => {
    const codes = DIAGNOSTIC_CODES.map((m) => m.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of codes) expect(c).toMatch(/^OSC\d{4}$/)
  })

  it('downgradable codes exclude syntax and dimension errors', () => {
    for (const c of [DiagnosticCode.OSC1001, DiagnosticCode.OSC1002, DiagnosticCode.OSC2003]) {
      expect(isDowngradable(c)).toBe(false)
    }
    expect(isDowngradable(DiagnosticCode.OSC3002)).toBe(true)
  })
})

describe('diagnostic rendering', () => {
  it('renders path:line:col with code and severity', () => {
    const d = diagnostic({
      code: DiagnosticCode.OSC1003,
      message: 'unknown node "foo"',
      path: 'a.csg',
      span: {
        start: { line: 3, column: 5, offset: 20 },
        end: { line: 3, column: 8, offset: 23 },
      },
    })
    expect(formatDiagnosticsText([d])).toContain('a.csg:3:5: OSC1003 error: unknown node "foo"')
  })

  it('summarizes counts', () => {
    expect(summarizeDiagnostics([])).toBe('no diagnostics')
    const bag = new DiagnosticBag()
    bag.add({ code: DiagnosticCode.OSC1003, message: 'a' })
    bag.add({ code: DiagnosticCode.OSC1003, message: 'b' })
    expect(summarizeDiagnostics(bag.all())).toBe('2 errors')
  })

  it('explain renders known and unknown codes', () => {
    expect(explainCode('OSC3201')).toContain('OSC3201')
    expect(explainCode('OSC9999')).toContain('Unknown diagnostic code')
  })
})
