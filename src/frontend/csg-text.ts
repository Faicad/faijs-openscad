/**
 * CSG-text front-end (plan §4.1 / §1.2).
 *
 * Turns already-existing CSG text into a `CsgArtifact`. This is the front-end
 * used by all unit tests and by corpus regression: it needs no OpenSCAD binary,
 * so `npm test` stays hermetic.
 *
 * Node-only (sha256 via node:crypto). The browser entry exposes the pure
 * parse/emit path instead; see src/browser.ts.
 */
import { DiagnosticBag } from '../diagnostics/diagnostic'
import { sha256Hex } from '../util/hash'
import type { CsgArtifact, CsgTextInput } from './types'

export class CsgTextFrontend {
  readonly kind = 'csg-text' as const

  /** CSG text is always available: there is no external dependency to probe. */
  async inspect() {
    return {
      kind: this.kind,
      available: true,
      identity: 'csg-text (no external OpenSCAD required)',
      diagnostics: [],
    }
  }

  async compile(input: CsgTextInput): Promise<CsgArtifact> {
    const bag = new DiagnosticBag()
    return {
      csgText: input.text,
      sha256: sha256Hex(input.text),
      producedBy: { kind: this.kind },
      ...(input.label === undefined ? {} : { sourcePath: input.label }),
      diagnostics: bag.all(),
    }
  }
}

/** Convenience functional wrapper. */
export async function csgTextToArtifact(input: CsgTextInput): Promise<CsgArtifact> {
  return new CsgTextFrontend().compile(input)
}
