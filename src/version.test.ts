import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONVERTER_NAME, CONVERTER_VERSION, EMIT_PROTOCOL, FAIJS_TARGET_VERSION } from './version'
import { BASELINE } from './baseline'

const ROOT = resolve(import.meta.dirname, '..')

describe('converter identity', () => {
  it('CONVERTER_VERSION matches package.json (single source of truth for the pin)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string
      name: string
    }
    expect(CONVERTER_VERSION).toBe(pkg.version)
    expect(CONVERTER_NAME).toBe(pkg.name)
  })

  it('pins the faijs target it was developed against', () => {
    expect(FAIJS_TARGET_VERSION).toBe(BASELINE.faijsVersion)
    expect(FAIJS_TARGET_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('emit protocol is a positive integer', () => {
    expect(EMIT_PROTOCOL).toBeGreaterThan(0)
  })
})
