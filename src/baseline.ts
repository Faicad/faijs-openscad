/**
 * Baseline pin (plan §10).
 *
 * This module is the single source of truth for version/corpus pins.
 * `tests/baseline.json` is a *derived artifact* and `tests/check-baseline.ts`
 * fails when it drifts from here.
 *
 * Rule: only versions, library paths and counts may live here — never a
 * developer's absolute path. Paths come from `OPENSCAD_BIN` / `MCAD_LIB` / CLI
 * flags. OpenSCAD is referenced **only** as an external binary (`OPENSCAD_BIN`);
 * its GPL source is never pinned or copied.
 *
 * Verification baseline is **OpenSCAD `examples/`** (CC0-1.0, copied verbatim into
 * `tests/fixtures/openscad-examples/`): real-world `.scad` models evaluated by the
 * OpenSCAD binary into `.csg`, then parsed by this project's parser. The `examples/`
 * directory's CC0 declaration means it may be redistributed inside this AGPL repo.
 * MCAD (LGPL-2.1) is kept only as an **optional** supplementary dependency — solely
 * `Old/example023.scad` `use`s it transitively; it is not the verification corpus.
 */
export const BASELINE: Baseline = {
  openscadBinary: {
    env: 'OPENSCAD_BIN',
    /** The build used to evaluate the examples verification corpus on this machine. */
    requiredVersion: '2021.01',
    localSmokeVersion: '2021.01',
  },
  mcadLibrary: {
    env: 'MCAD_LIB',
    path: 'C:/git/OpenSCAD/webmcp-openscad/public/libraries/MCAD',
    license: 'LGPL-2.1',
    capturedAt: '2026-10-06',
    optional: true,
    note: '仅 examples/Old/example023.scad 的传递依赖；不是验证语料',
  },
  verificationCorpus: {
    fixtures: 50,
    csgNodes: 12435,
    license: 'CC0-1.0',
    fixturesPath: 'tests/fixtures/openscad-examples',
    csgPath: 'tests/fixtures/openscad-examples/csg/*.csg',
    generator: 'tests/verify-examples.ts',
    test: 'tests/examples-verify.test.ts',
  },
  faijsVersion: '0.29.5',
  faijsCadqueryReferenceVersion: '0.29.5',
}

/** Optional supplementary corpus: OpenSCAD upstream `*-expected.csg`. Gated on
 *  this env var; never part of the default verification baseline. */
export const OPENSCAD_SRC_ENV = 'OPENSCAD_SRC'

export interface Baseline {
  openscadBinary: {
    env: string
    requiredVersion: string
    localSmokeVersion: string
  }
  mcadLibrary: {
    env: string
    path: string
    license: string
    capturedAt: string
    optional?: boolean
    note?: string
  }
  verificationCorpus: {
    fixtures: number
    csgNodes: number
    license: string
    fixturesPath: string
    csgPath: string
    generator: string
    test: string
  }
  faijsVersion: string
  faijsCadqueryReferenceVersion: string
}
