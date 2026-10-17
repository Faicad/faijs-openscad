/**
 * K02: text — 2D text profile from font rendering.
 *
 * OpenSCAD's text() module produces a 2D polygon profile from font glyph
 * outlines. We use faijs's built-in textBlueprints() which calls opentype.js
 * to trace glyph outlines and converts them to OCCT wires (BRepHandle[]).
 *
 * Pipeline:
 *   1. Ensure Node FontLoader is installed (maps "Liberation Sans" → DejaVu Sans)
 *   2. Load/ensure the requested font
 *   3. Disable complex GSUB features (opentype.js 1.x doesn't support lookupType 6 format 2)
 *   4. Call textBlueprints(kernel, text, { fontSize, fontFamily }) → wire[]
 *   5. For each wire: makeFace(wire) → 2D face
 *   6. Fuse all faces into a single 2D compound shape
 *
 * The result is a 2D shape (face/compound) that can be used with
 * linear_extrude, rotate_extrude, etc.
 */
import { getExtKernel } from '../kernel'
import { ensureFontLoader } from './font-loader'
import type { ShapeHandle } from 'occt-wasm'

/** Set of fonts we've already patched to disable unsupported GSUB features. */
const patchedFonts = new WeakSet<object>()

/**
 * Patch an opentype.js Font object to disable complex GSUB features.
 *
 * opentype.js 1.x throws on lookupType 6 format 2 (chaining contextual
 * extension substitution). OpenSCAD doesn't apply OpenType features anyway,
 * so we override stringToGlyphIndexes to skip feature processing entirely.
 */
function patchFontGSUB(font: unknown): void {
  if (patchedFonts.has(font as object)) return
  patchedFonts.add(font as object)

  const f = font as {
    charToGlyphIndex: (ch: string) => number
    stringToGlyphIndexes: (s: string, options?: unknown) => number[]
    defaultRenderOptions: { features: unknown[] }
  }

  // Override stringToGlyphIndexes to skip GSUB feature application.
  // OpenSCAD doesn't apply ligatures/contextual substitutions — it renders
  // each character independently using its base glyph.
  f.stringToGlyphIndexes = function (s: string): number[] {
    const indexes: number[] = []
    for (let i = 0; i < s.length; i++) {
      indexes.push(this.charToGlyphIndex(s[i]))
    }
    return indexes
  }

  // Also clear features in defaultRenderOptions as a belt-and-suspenders measure
  f.defaultRenderOptions.features = []
}

export async function text(
  textStr: string,
  opts?: { size?: number; font?: string },
): Promise<ShapeHandle> {
  const k = await getExtKernel()

  // Step 1: Install Node font loader (lazy, once)
  await ensureFontLoader()

  // Step 2: Load the requested font
  const { ensureFont, getFont, setFontLoader } = await import('@faicad/faijs/brep/text/fontRegistry')
  const fontName = opts?.font ?? 'Liberation Sans'
  try {
    await ensureFont(fontName)
  } catch {
    // If ensureFont fails (no loader, etc.), try loading default directly
    const { createNodeFontLoader } = await import('./font-loader')
    setFontLoader(createNodeFontLoader())
    await ensureFont(fontName)
  }

  // Step 3: Patch font to disable unsupported GSUB features
  const font = getFont('default')
  if (font) {
    patchFontGSUB(font)
  }

  // Step 4: Call textBlueprints to get wire array
  // 0.35.x: textBlueprints takes the BrepEngineApi contract face; the raw
  // occt kernel satisfies it at runtime, the brands just differ in types.
  const { textBlueprints } = await import('@faicad/faijs/brep/text/text-to-solid')
  const fontSize = opts?.size ?? 10
  const wires = textBlueprints(k as unknown as Parameters<typeof textBlueprints>[0], textStr, {
    startX: 0,
    startY: 0,
    fontSize,
    fontFamily: 'default',
  })

  if (wires.length === 0) {
    throw new Error(`openscad.text("${textStr}") produced no geometry — font rendering returned empty path`)
  }

  // Step 5: Convert each wire to a 2D face
  const faces: ShapeHandle[] = []
  for (const wire of wires) {
    try {
      const face = k.makeFace(wire as unknown as ShapeHandle)
      faces.push(face)
    } catch {
      // Some wires may fail makeFace (e.g. degenerate or open wires)
      try { k.release(wire as unknown as ShapeHandle) } catch { /* ignore */ }
    }
  }

  if (faces.length === 0) {
    throw new Error(`openscad.text("${textStr}") — all wires failed makeFace conversion`)
  }

  // Step 6: Fuse all faces into a single compound
  if (faces.length === 1) {
    return faces[0]
  }

  // Use fuseAll to merge multiple faces
  try {
    const result = k.fuseAll(faces)
    for (const f of faces) {
      try { k.release(f) } catch { /* ignore */ }
    }
    return result
  } catch {
    // If fuseAll fails, try pairwise fuse
    let result = faces[0]
    for (let i = 1; i < faces.length; i++) {
      try {
        result = k.fuse(result, faces[i])
      } catch {
        // Skip faces that fail to fuse
      }
    }
    return result
  }
}
