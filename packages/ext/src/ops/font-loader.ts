/**
 * Node environment FontLoader for faijs text rendering.
 *
 * faijs's fontRegistry uses a FontLoader interface (dependency injection) to
 * abstract away how font binaries are obtained. In Node, we read from disk.
 *
 * Font name mapping: OpenSCAD defaults to "Liberation Sans" which is not
 * installed on this system. We map common OpenSCAD font names to DejaVu
 * equivalents that ARE installed at /usr/share/fonts/dejavu/.
 */
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import type { FontLoader } from '@faicad/faijs/brep/text/fontRegistry'

/** Map OpenSCAD font names to system font file paths. */
const FONT_MAP: Record<string, string> = {
  // Liberation → DejaVu (closest metric-compatible equivalent)
  'liberation sans': '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  'liberation serif': '/usr/share/fonts/dejavu/DejaVuSerif.ttf',
  'liberation mono': '/usr/share/fonts/dejavu/DejaVuSansMono.ttf',
  // DejaVu direct
  'dejavu sans': '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  'dejavu serif': '/usr/share/fonts/dejavu/DejaVuSerif.ttf',
  'dejavu sans mono': '/usr/share/fonts/dejavu/DejaVuSansMono.ttf',
}

const DEFAULT_FONT = '/usr/share/fonts/dejavu/DejaVuSans.ttf'

/**
 * Resolve an OpenSCAD font name to a file path.
 *
 * OpenSCAD font strings can be "Liberation Sans", "Liberation Sans:style=Regular",
 * or just a font family name. We normalise by taking the part before ":" and
 * lowercasing.
 */
function resolveFontPath(nameOrPath: string): string | null {
  // If it's already a file path that exists, use it directly
  if (existsSync(nameOrPath)) return nameOrPath

  // Normalise: take part before ":", strip whitespace, lowercase
  const family = nameOrPath.split(':')[0].trim().toLowerCase()

  // Check the font map
  if (family in FONT_MAP) return FONT_MAP[family]

  // Fallback: null means "not found", caller will use default
  return null
}

/** Create a FontLoader for Node environment using system fonts. */
export function createNodeFontLoader(): FontLoader {
  return {
    loadDefaultFont(): Promise<ArrayBuffer> {
      const buf = readFileSync(DEFAULT_FONT)
      // Convert Buffer to ArrayBuffer (the underlying buffer may be larger)
      return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    },

    async resolveFont(nameOrPath: string): Promise<ArrayBuffer | null> {
      const path = resolveFontPath(nameOrPath)
      if (!path) return null
      const buf = readFileSync(path)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
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
