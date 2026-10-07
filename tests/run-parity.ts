/**
 * Parity runner (M8, T803).
 *
 * For each ported example (status=ported in manifest.json):
 *   1. Read cached CSG from tests/fixtures/openscad-examples/csg/
 *   2. Transpile CSG → IR → .fai.js
 *   3. Execute .fai.js via faijs runtime → get candidate mesh (positions + indices)
 *   4. Compute candidate STL metrics
 *   5. Read reference STL from tests/fixtures/openscad-examples/stl/
 *   6. Compute reference STL metrics
 *   7. Compare metrics → verdict (PASS / PASS-ANALYTIC / FAIL / ERROR)
 *   8. Output JSON + Markdown report
 *
 * Usage:
 *   npx tsx tests/run-parity.ts                    # run all ported examples
 *   npx tsx tests/run-parity.ts --json report.json # write JSON report
 *   npx tsx tests/run-parity.ts --md report.md     # write Markdown report
 *
 * Environment variables:
 *   OPENSCAD_BIN   OpenSCAD executable (not needed if CSG files are cached)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitFaijs, lowerCsg, parseCsg } from '../src/index'
import { readStlMetrics, computeMetrics, type MeshMetrics, type StlTriangle } from '../src/parity/stl-metrics'
import { compareMetrics, type ComparisonResult, type ParityVerdict } from '../src/parity/compare-mesh'
import { buildReport, renderMarkdown, renderJson, type ParityEntry } from '../src/parity/report'
import { CONVERTER_VERSION } from '../src/version'

// ── faijs runtime (loaded dynamically) ──────────────────────────────────────

interface FaijsShape {
  readonly positions: Float32Array | number[]
  readonly indices: Uint32Array | number[]
  readonly kind?: string
}

interface FaijsRuntime {
  execute(code: string, opts?: Record<string, unknown>): Promise<{
    failedAt?: { message?: string }
    outputs: Map<string, unknown>
  }>
  dispose(): void
}

interface FaijsNodeModule {
  createRuntime: (ports: unknown, mode: string) => FaijsRuntime
  createNodePorts: () => unknown
  initOcctWasm: () => Promise<void>
  /** M9 §1.3: solidToShape(kernel, solid, segments) — 重新三角化 BREP solid。 */
  solidToShape: (kernel: unknown, solid: unknown, segments?: number) => FaijsShape
}

// ── Paths ───────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const EXAMPLES_ROOT = join(here, 'fixtures', 'openscad-examples')
const CSG_DIR = join(EXAMPLES_ROOT, 'csg')
const STL_DIR = join(EXAMPLES_ROOT, 'stl')
const MANIFEST_PATH = join(here, 'manifest.json')

// ── CLI args ────────────────────────────────────────────────────────────────

const jsonOut = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : undefined
const mdOut = process.argv.includes('--md')
  ? process.argv[process.argv.indexOf('--md') + 1]
  : undefined

// ── Manifest ────────────────────────────────────────────────────────────────

interface ManifestEntry {
  readonly id: string
  readonly source: string
  readonly status: 'ported' | 'blocked' | 'skipped'
  readonly blockedBy?: readonly string[]
  readonly nodeHistogram?: Record<string, number>
}

interface Manifest {
  readonly entries: readonly ManifestEntry[]
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

// ── faijs execution ─────────────────────────────────────────────────────────

async function loadFaijs(): Promise<FaijsNodeModule> {
  return await import('@faicad/faijs/node') as unknown as FaijsNodeModule
}

let runtime: FaijsRuntime | undefined

async function getRuntime(mod: FaijsNodeModule): Promise<FaijsRuntime> {
  if (runtime === undefined) {
    runtime = mod.createRuntime(mod.createNodePorts(), 'brep')
  }
  return runtime
}

/**
 * Execute a .fai.js script and extract the `result` output as a Shape.
 *
 * M9 §1.3: 如果 `segments` 参数提供，使用 `solidToShape` 对 BREP solid 重新
 * 三角化，使 faijs 导出的网格分片密度与 OpenSCAD 的 `$fn` 对齐。
 * 返回 undefined if the script failed or produced no geometry.
 */
async function executeFaijs(
  mod: FaijsNodeModule,
  code: string,
  segments?: number,
): Promise<{ shape?: FaijsShape; error?: string }> {
  const rt = await getRuntime(mod)
  try {
    const r = await rt.execute(code, { topology: 'auto' })
    if (r.failedAt) {
      return { error: String(r.failedAt.message ?? r.failedAt) }
    }

    // M9 §1.3: 如果有 brepSolids 且提供了 segments，重新三角化
    if (segments !== undefined && (r as any).brepSolids?.size > 0) {
      const brepSolids = (r as any).brepSolids as Map<string, { solid: unknown; kernel: unknown }>
      // 取 'result' 或第一个 solid
      const entry = brepSolids.get('result') ?? brepSolids.values().next().value
      if (entry) {
        const shape = mod.solidToShape(entry.kernel, entry.solid, segments)
        if (shape.positions && shape.indices) {
          return { shape }
        }
      }
    }

    // 默认路径：直接从 outputs 取 result
    const out = r.outputs instanceof Map ? r.outputs.get('result') : undefined
    if (out === undefined || out === null) {
      return { error: 'no result variable in script output' }
    }
    const shape = out as FaijsShape
    if (!shape.positions || !shape.indices) {
      return { error: `output is not a Shape (no positions/indices): ${typeof out}` }
    }
    return { shape }
  } catch (e: any) {
    return { error: String(e?.message ?? e) }
  }
}

// ── Shape → STL triangles ───────────────────────────────────────────────────

function shapeToTriangles(shape: FaijsShape): StlTriangle[] {
  const positions = shape.positions
  const indices = shape.indices
  const triangles: StlTriangle[] = []
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    triangles.push({
      v0: [positions[a], positions[a + 1], positions[a + 2]],
      v1: [positions[b], positions[b + 1], positions[b + 2]],
      v2: [positions[c], positions[c + 1], positions[c + 2]],
    })
  }
  return triangles
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const manifest = loadManifest()
  const ported = manifest.entries.filter((e) => e.status === 'ported')

  console.log('Parity runner (T803)')
  console.log(`  Ported examples: ${ported.length}`)
  console.log('')

  // Load faijs runtime
  console.log('Loading faijs runtime...')
  const mod = await loadFaijs()
  await mod.initOcctWasm()
  console.log('  faijs OCCT wasm initialized')
  console.log('')

  const entries: ParityEntry[] = []
  const failures: Array<{ name: string; error: string }> = []

  for (const entry of ported) {
    const csgPath = join(CSG_DIR, entry.id)
    const stlPath = join(STL_DIR, `${entry.source.replace(/[\\/]/g, '__')}.stl`)

    console.log(`  ${entry.id}`)

    // 1. Read CSG
    if (!existsSync(csgPath)) {
      console.log(`    SKIP: CSG not found at ${relative(ROOT, csgPath)}`)
      entries.push({
        name: entry.source,
        verdict: 'ERROR',
        hasFacetedPrimitives: false,
        stepExport: 'n/a',
        error: `CSG file not found: ${entry.id}`,
      })
      failures.push({ name: entry.source, error: 'CSG not found' })
      continue
    }
    const csg = readFileSync(csgPath, 'utf8')

    // 2. Transpile — auto-fallback to compact mode if output exceeds 1 MiB
    // (faijs static checker rejects source > 1,048,576 bytes).
    const { document } = parseCsg(csg, { path: entry.source })
    const lowered = lowerCsg(document, { path: entry.source })
    let emitted = emitFaijs(lowered.model)
    if (emitted.ok && emitted.code.length > 1_000_000) {
      const compactEmitted = emitFaijs(lowered.model, { compact: true })
      if (compactEmitted.ok && compactEmitted.code.length < emitted.code.length) {
        emitted = compactEmitted
      }
    }

    if (!emitted.ok) {
      console.log(`    BLOCKED: ${emitted.blocked.join(', ')}`)
      entries.push({
        name: entry.source,
        verdict: 'ERROR',
        blockedBy: emitted.blocked.join(', '),
        hasFacetedPrimitives: false,
        stepExport: 'n/a',
        error: `Blocked: ${emitted.blocked.join(', ')}`,
      })
      failures.push({ name: entry.source, error: `blocked: ${emitted.blocked.join(', ')}` })
      continue
    }

    // Check for faceted primitives
    const hasFaceted = lowered.diagnostics.some((d) => d.code === 'OSC3201')
    // M9 §1.3 A2: 从 lowered.tessellation 获取三角化参数
    const tessellation = lowered.tessellation
    const tessSegments = tessellation?.segments

    // 3. Execute via faijs — M9 §1.3 A3: 按 tessellation 参数重新三角化
    const execResult = await executeFaijs(mod, emitted.code, tessSegments)
    if (execResult.error || !execResult.shape) {
      console.log(`    EXEC ERROR: ${execResult.error ?? 'no shape'}`)
      entries.push({
        name: entry.source,
        verdict: 'ERROR',
        hasFacetedPrimitives: hasFaceted,
        stepExport: 'n/a',
        error: execResult.error ?? 'no shape produced',
      })
      failures.push({ name: entry.source, error: execResult.error ?? 'no shape' })
      continue
    }

    // 4. Compute candidate metrics
    const candTriangles = shapeToTriangles(execResult.shape)
    const candMetrics = computeMetrics(candTriangles)
    const tessInfo = tessSegments !== undefined ? ` (seg=${tessSegments})` : ''
    console.log(`    candidate: ${candMetrics.triangleCount} tris, vol=${candMetrics.volume.toFixed(4)}${tessInfo}`)

    // 5. Read reference STL
    if (!existsSync(stlPath)) {
      console.log(`    SKIP: ref STL not found`)
      entries.push({
        name: entry.source,
        verdict: 'PASS-NT',
        hasFacetedPrimitives: hasFaceted,
        stepExport: 'n/a',
        error: 'Reference STL not found',
      })
      continue
    }
    const refBuffer = readFileSync(stlPath)
    const refMetrics = readStlMetrics(new Uint8Array(refBuffer).buffer)
    console.log(`    reference: ${refMetrics.triangleCount} tris, vol=${refMetrics.volume.toFixed(4)}`)

    // 6. Compare — M9 §1.3: parity 比对的是同一解析几何的两次三角化
    const comparison = compareMetrics(refMetrics, candMetrics)
    // 语义修正后：两边都是同一解析几何的三角化，不再有 analytic-vs-faceted 区别
    const verdict = comparison.verdict

    console.log(`    verdict: ${verdict} (volΔ=${comparison.volumeDelta.toFixed(6)}, IoU=${comparison.bboxIoU.toFixed(6)})`)

    entries.push({
      name: entry.source,
      verdict,
      comparison,
      hasFacetedPrimitives: hasFaceted,
      stepExport: 'exact',
      ...(tessellation?.fn !== undefined ? { fn: tessellation.fn } : {}),
      ...(tessSegments !== undefined ? { segments: tessSegments } : {}),
    })
  }

  // Dispose runtime
  runtime?.dispose()

  // Build report
  const report = buildReport(entries, {
    converterVersion: CONVERTER_VERSION,
  })

  console.log('')
  console.log('=== Summary ===')
  const s = report.summary
  console.log(`  PASS:          ${s.pass}`)
  console.log(`  PASS-ANALYTIC: ${s.passAnalytic}`)
  console.log(`  PASS-NT:       ${s.passNT}`)
  console.log(`  FAIL:          ${s.fail}`)
  console.log(`  ERROR:         ${s.error}`)
  console.log(`  Total:         ${s.total}`)

  if (failures.length > 0) {
    console.log('')
    console.log('Failures:')
    for (const f of failures) console.log(`  ${f.name}: ${f.error}`)
  }

  // Write reports
  if (jsonOut) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(jsonOut, renderJson(report), 'utf8')
    console.log(`\nJSON report written to ${relative(ROOT, resolve(jsonOut))}`)
  }
  if (mdOut) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(mdOut, renderMarkdown(report), 'utf8')
    console.log(`Markdown report written to ${relative(ROOT, resolve(mdOut))}`)
  }
}

main().catch((e) => {
  console.error('Parity runner failed:', e)
  process.exit(1)
})
