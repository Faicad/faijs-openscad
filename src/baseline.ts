/**
 * Baseline pin (plan §10).
 *
 * This module is the single source of truth for version/corpus pins.
 * `tests/baseline.json` is a *derived artifact* and `tests/check-baseline.ts`
 * fails when it drifts from here.
 *
 * Rule: only versions, commits and counts may live here — never a developer's
 * absolute path. Paths come from `OPENSCAD_SRC` / `OPENSCAD_BIN` / CLI flags.
 */
export const BASELINE: Baseline = {
  openscadSource: {
    env: 'OPENSCAD_SRC',
    commit: 'c0ac8289f1c9db6f70891da5df3b4085b7eaf8b6',
    capturedAt: '2026-10-05',
  },
  openscadBinary: {
    env: 'OPENSCAD_BIN',
    /** The only build allowed to regenerate corpus goldens. */
    requiredVersion: 'baseline-build',
    /** Present on this machine; usable for smoke only — NOT for goldens. */
    localSmokeVersion: '2021.01',
  },
  corpusCounts: {
    dumpCsg: 169,
    dumpExamplesCsg: 56,
    testScad: 579,
    examplesScad: 50,
    astExpected: 28,
  },
  /** Relative to the OpenSCAD source root (value of OPENSCAD_SRC). */
  corpusPaths: {
    dumpCsg: 'tests/regression/dump/*-expected.csg',
    dumpExamplesCsg: 'tests/regression/dump-examples/*-expected.csg',
    testScad: 'tests/data/**/*.scad',
    examplesScad: 'examples/**/*.scad',
    astExpected: 'tests/regression/astdump/*-expected.ast',
  },
  faijsVersion: '0.29.5',
  faijsCadqueryReferenceVersion: '0.29.5',
}

export interface Baseline {
  openscadSource: {
    env: string
    commit: string
    capturedAt: string
  }
  openscadBinary: {
    env: string
    requiredVersion: string
    localSmokeVersion: string
  }
  corpusCounts: {
    dumpCsg: number
    dumpExamplesCsg: number
    testScad: number
    examplesScad: number
    astExpected: number
  }
  corpusPaths: {
    dumpCsg: string
    dumpExamplesCsg: string
    testScad: string
    examplesScad: string
    astExpected: string
  }
  faijsVersion: string
  faijsCadqueryReferenceVersion: string
}
