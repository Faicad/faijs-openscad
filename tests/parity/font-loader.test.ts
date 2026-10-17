/**
 * Font loader resolution tests (regression for 2026-10-17 Windows fix).
 *
 * The old implementation hardcoded `/usr/share/fonts/dejavu/DejaVuSans.ttf`.
 * On Windows that path silently resolves to `D:\usr\...` and every text op
 * failed with ENOENT. The fix resolves per-platform candidates and must keep
 * Linux behavior identical (DejaVu paths win when they exist).
 */
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createNodeFontLoader } from '../../packages/ext/src/ops/font-loader'

const LINUX_DEJAVU = '/usr/share/fonts/dejavu/DejaVuSans.ttf'

describe('createNodeFontLoader (cross-platform font resolution)', () => {
  it('default font resolves to an EXISTING file on this machine', async () => {
    const loader = createNodeFontLoader()
    const windowsFont = existsSync('C:\\Windows\\Fonts\\arial.ttf')
    const path =
      process.env.FAIJS_FONT_PATH ??
      (existsSync(LINUX_DEJAVU) ? LINUX_DEJAVU : windowsFont ? 'arial.ttf' : null)
    if (path === null) {
      // Machine has no mapped font at all — loader must report failure, not
      // a bogus non-existent path like `D:\usr\...`.
      await expect(loader.loadDefaultFont()).rejects.toThrow(/no font file found/)
      return
    }
    await expect(loader.loadDefaultFont()).resolves.toBeInstanceOf(ArrayBuffer)
  })

  it('Liberation Sans resolves on Linux to DejaVu; on Windows to a real system font', async () => {
    const loader = createNodeFontLoader()
    const buf = await loader.resolveFont('Liberation Sans')
    if (existsSync(LINUX_DEJAVU)) {
      // Linux: byte-identical to the dejavu file (behavior preserved).
      const { readFileSync } = await import('node:fs')
      expect(Buffer.compare(Buffer.from(buf!), readFileSync(LINUX_DEJAVU))).toBe(0)
    } else {
      // Windows (and any other platform): must NOT be the bogus `/usr/...` path —
      // i.e. resolution must have found SOME existing file, or return null.
      if (buf) expect(buf.byteLength).toBeGreaterThan(0)
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
