/**
 * Node environment FontLoader for faijs text rendering.
 *
 * faijs's fontRegistry uses a FontLoader interface (dependency injection) to
 * abstract away how font binaries are obtained. In Node, we read from disk.
 *
 * Font name mapping: OpenSCAD defaults to "Liberation Sans". We resolve each
 * family against a per-platform candidate list and return the FIRST file that
 * actually exists on this machine (the old implementation hardcoded Linux
 * `/usr/share/fonts/dejavu/...` paths, which on Windows resolve to a bogus
 * `D:\usr\...` and make every text op fail with ENOENT).
 *
 * Priority: FAIJS_FONT_PATH / OPENSCAD_FONT_PATH env override → exact file →
 * per-platform system fonts (Windows: Arial/Times/Consola are the
 * metric-closest equivalents; Linux: DejaVu).
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FontLoader } from '@faicad/faijs/brep/text/fontRegistry'

function windowsFont(name: string): string {
  const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows'
  return join(win, 'Fonts', name)
}

/** Candidate file paths per font family, in preference order. */
const FONT_CANDIDATES: Record<string, string[]> = {
  // Liberation → closest metric-compatible system equivalent
  'liberation sans': [
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    windowsFont('arial.ttf'),
  ],
  'liberation serif': [
    '/usr/share/fonts/dejavu/DejaVuSerif.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
    windowsFont('times.ttf'),
  ],
  'liberation mono': [
    '/usr/share/fonts/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    windowsFont('consola.ttf'),
  ],
  // DejaVu direct (Linux), with Windows fallbacks
  'dejavu sans': [
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    windowsFont('arial.ttf'),
  ],
  'dejavu serif': [
    '/usr/share/fonts/dejavu/DejaVuSerif.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
    windowsFont('times.ttf'),
  ],
  'dejavu sans mono': [
    '/usr/share/fonts/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    windowsFont('consola.ttf'),
  ],
}

/** Env override checked first, in order. */
function envFontOverride(): string | undefined {
  return process.env.FAIJS_FONT_PATH || process.env.OPENSCAD_FONT_PATH
}

/**
 * Resolve an OpenSCAD font name to an EXISTING file path.
 *
 * OpenSCAD font strings can be "Liberation Sans", "Liberation Sans:style=Regular",
 * or just a font family name. We normalise by taking the part before ":" and
 * lowercasing. Returns null when nothing exists — caller falls back to default.
 */
function resolveFontPath(nameOrPath: string): string | null {
  // If it's already a file path that exists, use it directly
  if (existsSync(nameOrPath)) return nameOrPath

  // Normalise: take part before ":", strip whitespace, lowercase
  const family = nameOrPath.split(':')[0].trim().toLowerCase()

  for (const candidate of FONT_CANDIDATES[family] ?? []) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** First existing default font file, or null when the machine has none. */
function defaultFontPath(): string | null {
  const override = envFontOverride()
  if (override && existsSync(override)) return override
  for (const candidates of Object.values(FONT_CANDIDATES)) {
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** Create a FontLoader for Node environment using system fonts. */
export function createNodeFontLoader(): FontLoader {
  return {
    loadDefaultFont(): Promise<ArrayBuffer> {
      const path = defaultFontPath()
      if (!path) {
        return Promise.reject(new Error('no font file found on this system (set FAIJS_FONT_PATH)'))
      }
      return Promise.resolve(toArrayBuffer(readFileSync(path)))
    },

    async resolveFont(nameOrPath: string): Promise<ArrayBuffer | null> {
      const override = envFontOverride()
      const resolved = (override && existsSync(override)) || resolveFontPath(nameOrPath)
      if (typeof resolved !== 'string') return null
      return toArrayBuffer(readFileSync(resolved))
    },
  }
}

/** Lazy-init: set the font loader once on first text() call. */
let initialized = false

/** Ensure the Node font loader is installed in faijs's fontRegistry. */
export async function ensureFontLoader(): Promise<void> {
  if (initialized) return
  const { setFontLoader } = await import('@faicad/faijs/brep/text/fontRegistry')
  setFontLoader(createNodeFontLoader())
  initialized = true
}
