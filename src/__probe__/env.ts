/**
 * Shared gating helpers for the permanent capability probes (plan §9.1 T006).
 *
 * Probes must be *permanent*: they are never deleted after the investigation
 * is over. But `npm test` must also stay hermetic — regular CI runs without an
 * OpenSCAD binary and without loading the OCCT wasm runtime. So every probe
 * that needs an external capability is gated here, and the gate is explicit,
 * recorded in the test name, and verifiable via `doctor`.
 *
 * Gates:
 *   corpus         — OPENSCAD_SRC points at an OpenSCAD checkout
 *   openscad binary— an OpenSCAD executable was discovered
 *   faijs runtime  — @faicad/faijs is installed AND FAIJS_PROBE_RUNTIME=1
 *
 * The runtime gate is opt-in because loading faijs initialises the OCCT wasm
 * kernel: slow, and not something the unit/lint stage should depend on.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { discoverOpenScadBinary } from '../frontend/discover-openscad'
import { resolveCorpusRoot } from '../environment'

const ROOT = resolve(import.meta.dirname, '..', '..')

export function corpusRoot(): string | undefined {
  return resolveCorpusRoot()
}

export function hasCorpus(): boolean {
  return corpusRoot() !== undefined
}

/** Path of the installed @faicad/faijs package, if present. */
export function faijsPackageDir(): string | undefined {
  const dir = join(ROOT, 'node_modules', '@faicad', 'faijs')
  return existsSync(join(dir, 'package.json')) ? dir : undefined
}

export function faijsInstalled(): boolean {
  return faijsPackageDir() !== undefined
}

/** Opt-in runtime gate: FAIJS_PROBE_RUNTIME=1 (or =true). */
export function faijsRuntimeEnabled(): boolean {
  const v = process.env.FAIJS_PROBE_RUNTIME
  return v === '1' || v === 'true'
}

export interface OpenScadBinaryProbe {
  readonly available: boolean
  readonly path?: string
  readonly version?: string
  readonly source?: string
}

export async function openScadBinary(): Promise<OpenScadBinaryProbe> {
  const found = await discoverOpenScadBinary()
  if (!found.path) return { available: false }
  return {
    available: true,
    path: found.path,
    ...(found.version === undefined ? {} : { version: found.version }),
    source: found.source,
  }
}

export interface LoadedFaijs {
  readonly cad: Record<string, unknown>
  readonly raw: Record<string, unknown>
  /** Unit constants; NOT on the package root — see '@faicad/faijs/units'. */
  readonly units: Record<string, number>
}

/**
 * Load @faicad/faijs and read the INTERNAL `mod.cad` object plus the unit table.
 * Returns null when unavailable; never throws — probes must be able to report
 * "absent" as a fact instead of crashing the suite.
 *
 * ⛔ 2026-10-06: the `cad` this returns is **not** an API face. It is a 38-key
 * internal BREP namespace (`boxBrep`/`fuseBrep`/`*Brep`) that happens to be
 * exported. It is neither the ① TS compat face (205 flat functions on the
 * package root) nor the ② cad script face (95 ops, `dist/lang/symbol-table.generated.js`).
 * Measuring capability against it produced five retracted findings — see
 * `outputs/2026-10-06-faijs-api-assumption-errors.md` §0.
 * Use `tsCompatFaceSymbols()` for the ① face and `scriptFaceSymbols()` for the ② face.
 *
 * Unit constants are also not on the package root — they come from `/units`.
 */
export async function loadFaijs(): Promise<LoadedFaijs | null> {
  if (!faijsInstalled() || !faijsRuntimeEnabled()) return null
  try {
    const mod = (await import('@faicad/faijs')) as Record<string, unknown>
    const cad = (mod.cad ?? (mod.default as Record<string, unknown> | undefined)?.cad) as
      | Record<string, unknown>
      | undefined
    if (!cad) return null
    let units: Record<string, number> = {}
    try {
      const u = (await import('@faicad/faijs/units')) as Record<string, unknown>
      units = {
        MM: u.MM as number,
        DEGREE: u.DEGREE as number,
        RADIAN: u.RADIAN as number,
      }
    } catch {
      units = {}
    }
    return { cad, raw: mod, units }
  } catch {
    return null
  }
}

/** Symbols we expect on the faijs scripting namespace (P0 mapping, plan §5.1). */
export const P0_REQUIRED_OPS = [
  'box',
  'sphere',
  'cylinder',
  'cone',
  'union',
  'subtract',
  'intersect',
  'translate',
  'rotate_euler',
  'scale',
  'mirror',
  'applyMatrix',
  'profile',
  'extrude',
  'revolve',
] as const

/**
 * Ops measured as present on the ① TS compat face but ABSENT from the internal
 * 38-key `mod.cad` object (faijs 0.29.5). Kept only to document that the two are
 * different surfaces — NOT because the ① face lacks them.
 *
 * ⛔ 2026-10-06: this list used to be called `TS_LAYER_ABSENT_OPS`, which produced
 * the retracted claim "the TS layer cannot call mirror/profile/extrude/revolve".
 * They are all present on the ① face; the 38-key object is an internal BREP
 * namespace (`boxBrep`/`fuseBrep`/…), not the library surface. See
 * `outputs/2026-10-06-faijs-api-assumption-errors.md` §0.
 */
export const INTERNAL_CAD_MISSING_OPS = [
  'mirror',
  'applyMatrix',
  'profile',
  'extrude',
  'revolve',
  'compound',
  'convexHull',
  'offset',
] as const

/** Known-missing / not-yet-equivalent ops: presence alone is NOT equivalence. */
export const GAP_OPS = ['polyhedron', 'hull', 'minkowski', 'offset', 'convexHull'] as const
