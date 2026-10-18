/**
 * Node environment FontLoader for faijs text rendering.
 *
 * faijs's fontRegistry uses a FontLoader interface (dependency injection) to
 * abstract away how font binaries are obtained. In Node, we read from disk.
 *
 * Font resolution order:
 *   1. FAIJS_FONT_PATH / OPENSCAD_FONT_PATH env override (debugging escape hatch)
 *   2. BUNDLED Liberation Sans 2.00.1 (../fonts/, SIL OFL 1.1) — the same font
 *      files the OpenSCAD 2021.01 reference renders were produced with.
 *      OpenSCAD's DEFAULT_FONT is "Liberation Sans:style=Regular" and every
 *      font= spec in the CSG corpus is Liberation Sans (regular/bold), so the
 *      bundle covers the whole corpus. Bundling removes the old per-platform
 *      guessing (Arial on Windows, DejaVu on Linux) that made text geometry
 *      machine-dependent, and eliminates the old hardcoded-Linux-path bug
 *      (`/usr/share/fonts/dejavu/...` → bogus `D:\usr\...` on Windows).
 *   3. System fonts (DejaVu on Linux, Arial/Times/Consolas on Windows) — only
 *      reached when the bundle is missing.
 *
 * Note on OpenSCAD's text metrics: OpenSCAD 2021.01 scales glyph outlines by
 * 100/72 and advances by 100/72/1.024 (an upstream quirk, documented in
 * docs/plans/2026-10-18-openscad-font-rendering-investigation.md). That is
 * OpenSCAD's behavior, not a font problem — faijs deliberately renders with
 * correct font metrics and does NOT reproduce that scaling.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FontLoader } from '@faicad/faijs/brep/text/fontRegistry'

function windowsFont(name: string): string {
  const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows'
  return join(win, 'Fonts', name)
}

/**
 * Bundled font directory (package-root `fonts/`).
 *
 * Resolved relative to this module so it works both from `src/ops/` (vitest via
 * tsx) and from `dist/ops/` (compiled build) — both sit two levels below the
 * package root.
 */
const BUNDLED_FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fonts')

/** Candidate file paths per font family, in preference order (system fallbacks). */
const FONT_CANDIDATES: Record<string, string[]> = {
  // Liberation → metric-compatible system equivalents (fallback only)
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
 * Split an OpenSCAD font string into family + style.
 *
 * OpenSCAD font strings look like "Liberation Sans", "Liberation Sans:style=Regular"
 * or "Liberation Sans:style=Bold". We take the part before ":" as the family and
 * normalise the remainder (dropping an optional "style=" prefix), lowercased.
 */
function parseFamilyStyle(nameOrPath: string): { family: string; style: string } {
  const idx = nameOrPath.indexOf(':')
  if (idx < 0) return { family: nameOrPath.trim().toLowerCase(), style: '' }
  return {
    family: nameOrPath.slice(0, idx).trim().toLowerCase(),
    style: nameOrPath.slice(idx + 1).replace(/^style\s*=\s*/i, '').trim().toLowerCase(),
  }
}

/** Bundled file name for a (family, style) pair, or null when not bundled. */
function bundledFontFile(family: string, style: string): string | null {
  if (family !== 'liberation sans') return null
  const bold = style.includes('bold')
  const italic = style.includes('italic')
  if (bold && italic) return 'LiberationSans-BoldItalic.ttf'
  if (bold) return 'LiberationSans-Bold.ttf'
  if (italic) return 'LiberationSans-Italic.ttf'
  return 'LiberationSans-Regular.ttf'
}

/** Bundled font path when it exists on disk, else null. */
function bundledFontPath(family: string, style: string): string | null {
  const file = bundledFontFile(family, style)
  if (!file) return null
  const path = join(BUNDLED_FONT_DIR, file)
  return existsSync(path) ? path : null
}

/**
 * Resolve an OpenSCAD font name to an EXISTING file path.
 *
 * Order: exact file path → bundled Liberation Sans → system candidates.
 * Returns null when nothing exists — caller falls back to default.
 */
function resolveFontPath(nameOrPath: string): string | null {
  // If it's already a file path that exists, use it directly
  if (existsSync(nameOrPath)) return nameOrPath

  const { family, style } = parseFamilyStyle(nameOrPath)

  const bundled = bundledFontPath(family, style)
  if (bundled) return bundled

  for (const candidate of FONT_CANDIDATES[family] ?? []) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** First existing default font file, or null when the machine has none. */
function defaultFontPath(): string | null {
  const override = envFontOverride()
  if (override && existsSync(override)) return override
  // OpenSCAD's DEFAULT_FONT is "Liberation Sans:style=Regular" — bundled first.
  const bundled = bundledFontPath('liberation sans', '')
  if (bundled) return bundled
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

/** Create a FontLoader for Node environment using bundled + system fonts. */
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
