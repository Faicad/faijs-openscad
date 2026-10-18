/**
 * Font loader resolution tests (regression for 2026-10-17 Windows fix +
 * 2026-10-18 bundled Liberation Sans).
 *
 * History:
 * - The original implementation hardcoded `/usr/share/fonts/dejavu/DejaVuSans.ttf`.
 *   On Windows that path silently resolves to `D:\usr\...` and every text op
 *   failed with ENOENT. The fix resolves per-platform candidates.
 * - 2026-10-18: `packages/ext/fonts/` now bundles Liberation Sans 2.00.1 — the
 *   same font files the OpenSCAD 2021.01 reference renders used — so
 *   "Liberation Sans" (and its :style= variants) resolve to the bundle FIRST,
 *   identically on every machine. System fonts are fallback only.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createNodeFontLoader } from '../../packages/ext/src/ops/font-loader'

const BUNDLED_DIR = fileURLToPath(new URL('../../packages/ext/fonts/', import.meta.url))

function bundledBytes(file: string): Buffer {
  return readFileSync(BUNDLED_DIR + file)
}

describe('createNodeFontLoader (bundled Liberation Sans + system fallback)', () => {
  it('default font resolves to the BUNDLED Liberation Sans Regular', async () => {
    const loader = createNodeFontLoader()
    const buf = await loader.loadDefaultFont()
    expect(buf).toBeInstanceOf(ArrayBuffer)
    // OpenSCAD's DEFAULT_FONT is "Liberation Sans:style=Regular" — the default
    // must be the bundled Regular face (same file as the reference renders).
    if (!process.env.FAIJS_FONT_PATH) {
      expect(Buffer.compare(Buffer.from(buf), bundledBytes('LiberationSans-Regular.ttf'))).toBe(0)
    }
  })

  it('"Liberation Sans" resolves to the bundled Regular face', async () => {
    const loader = createNodeFontLoader()
    const buf = await loader.resolveFont('Liberation Sans')
    expect(buf).toBeInstanceOf(ArrayBuffer)
    if (!process.env.FAIJS_FONT_PATH) {
      expect(Buffer.compare(Buffer.from(buf!), bundledBytes('LiberationSans-Regular.ttf'))).toBe(0)
    }
  })

  it('":style=bold" / ":style=Bold" resolve to the bundled Bold face', async () => {
    const loader = createNodeFontLoader()
    if (process.env.FAIJS_FONT_PATH) return
    for (const spec of [
      'Liberation Sans:style=bold',
      'Liberation Sans:style=Bold',
      'liberation sans:bold',
    ]) {
      const buf = await loader.resolveFont(spec)
      expect(buf, spec).toBeInstanceOf(ArrayBuffer)
      expect(Buffer.compare(Buffer.from(buf!), bundledBytes('LiberationSans-Bold.ttf'))).toBe(0)
    }
  })

  it('":style=italic" resolves to the bundled Italic face', async () => {
    const loader = createNodeFontLoader()
    if (process.env.FAIJS_FONT_PATH) return
    const buf = await loader.resolveFont('Liberation Sans:style=italic')
    expect(buf).toBeInstanceOf(ArrayBuffer)
    expect(Buffer.compare(Buffer.from(buf!), bundledBytes('LiberationSans-Italic.ttf'))).toBe(0)
  })

  it('bundled faces exist on disk (bundle must ship with the package)', () => {
    for (const file of [
      'LiberationSans-Regular.ttf',
      'LiberationSans-Bold.ttf',
      'LiberationSans-Italic.ttf',
      'LiberationSans-BoldItalic.ttf',
      'LICENSE',
    ]) {
      expect(existsSync(BUNDLED_DIR + file), file).toBe(true)
    }
  })

  it('unknown family returns null (caller falls back to default) instead of a non-existent path', async () => {
    const loader = createNodeFontLoader()
    const buf = await loader.resolveFont('Totally Unknown Font Family 123')
    // null = not found is correct; a resolved buffer is only acceptable when
    // the env override exists.
    if (process.env.FAIJS_FONT_PATH && existsSync(process.env.FAIJS_FONT_PATH)) {
      expect(buf).toBeInstanceOf(ArrayBuffer)
    } else {
      expect(buf).toBeNull()
    }
  })
})
