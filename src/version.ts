/**
 * Converter identity + protocol versions.
 *
 * CONVERTER_VERSION must stay in lockstep with package.json; `version.test.ts`
 * asserts that. It is duplicated (instead of importing package.json) because
 * `rootDir` is `src` for the build, so a `../package.json` import would break
 * the emitted layout.
 */

export const CONVERTER_NAME = '@faicad/faijs-openscad'

/** Bumped with the package; mirrors package.json `version`. */
export const CONVERTER_VERSION = '0.29.5'

/**
 * CSG text dialect this converter understands. The CSG dump format is an
 * OpenSCAD *output* format, not a published stable API, so the dialect is
 * pinned by observed corpus + the baseline OpenSCAD build (see tests/baseline.json).
 */
export const CSG_DIALECT = 'openscad-csg'

/** Bump when the emitted `.fai.js` shape changes in a non-compatible way. */
export const EMIT_PROTOCOL = 1

/** faijs version this converter is developed against (peer range ^0.29.0). */
export const FAIJS_TARGET_VERSION = '0.29.5'
