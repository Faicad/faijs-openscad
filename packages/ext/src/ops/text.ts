/**
 * K02: text — 2D text profile from font rendering.
 *
 * OpenSCAD's text() module produces a 2D polygon profile from a font glyph.
 * This requires a font rendering library (e.g. opentype.js) to convert glyph
 * outlines to polygon profiles.  Until that dependency is wired in, this stub
 * throws a clear error so callers know the operation is not yet implemented.
 */
export async function text(
  text: string,
  opts?: { size?: number; font?: string },
): Promise<never> {
  throw new Error(
    `openscad.text("${text}") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles`,
  )
}
