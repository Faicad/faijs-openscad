/**
 * `run-cand` command — batch transpile with filtering and caching
 * (plan §9.4–§9.5, T303).
 *
 * Runs the transpile pipeline over multiple examples, with optional filtering
 * by single file, directory, or blocked node type. Results are cached as a
 * JSON report so subsequent runs can skip unchanged files.
 *
 * Usage:
 *   faijs-openscad run-cand [path] [--filter-node hull] [--json] [--cache cache.json]
 *
 * Exit codes: 0 all ok, 1 at least one failure, 2 environment error, 3 no files found.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, extname, basename } from 'node:path'
import { parseCsg } from '../../csg/parser'
import { lowerCsg } from '../../ir/lower'
import { emitFaijs } from '../../emit/faijs'
import { OpenScadCliFrontend } from '../../frontend/openscad-cli'
import { countCsgNodesByName } from '../../csg/ast'
import { formatDiagnosticsText } from '../../diagnostics/format'
import type { Diagnostic } from '../../diagnostics/diagnostic'

export interface RunCandOptions {
  /** Filter: only run files that contain this CSG node type. */
  readonly filterNode?: string
  /** Filter: only run files whose name matches this substring. */
  readonly filterName?: string
  /** Output JSON report path. */
  readonly cache?: string
  /** Print JSON to stdout. */
  readonly json?: boolean
  /** Explicit OpenSCAD binary path. */
  readonly openscadBin?: string
  /** Timeout for each OpenSCAD subprocess, in ms. */
  readonly timeoutMs?: number
  /** Write .fai.js for successful conversions. */
  readonly writeFai?: boolean
}

export interface RunCandEntry {
  readonly input: string
  readonly ok: boolean
  readonly blockedNodes: readonly string[]
  readonly parsedNodes: number
  readonly emittedStatements: number
  readonly nodeHistogram: Record<string, number>
  readonly diagnostics: readonly Diagnostic[]
  readonly durationMs: number
}

export interface RunCandReport {
  readonly total: number
  readonly converted: number
  readonly blocked: number
  readonly failed: number
  readonly entries: RunCandEntry[]
  readonly durationMs: number
}

export async function runRunCand(
  rootPath: string,
  options: RunCandOptions = {},
): Promise<number> {
  const abs = resolve(rootPath)
  const files = collectFiles(abs)

  if (files.length === 0) {
    process.stderr.write(`run-cand: no .scad or .csg files found under ${abs}\n`)
    return 3
  }

  // Load cache for skipping unchanged files.
  const cache = options.cache !== undefined ? loadCache(options.cache) : new Map<string, RunCandEntry>()

  const entries: RunCandEntry[] = []
  const startTime = Date.now()

  const frontend = new OpenScadCliFrontend(
    options.openscadBin === undefined ? {} : { binaryPath: options.openscadBin },
  )

  for (const file of files) {
    // Name filter
    if (options.filterName !== undefined && !basename(file).includes(options.filterName)) {
      continue
    }

    const start = Date.now()

    // Check cache
    const cacheKey = file
    const cached = cache.get(cacheKey)
    if (cached !== undefined) {
      // Re-apply node filter on cached entry
      if (options.filterNode !== undefined && !cached.nodeHistogram[options.filterNode]) {
        continue
      }
      entries.push(cached)
      continue
    }

    const diags: Diagnostic[] = []

    // Obtain CSG
    let csgText: string
    const ext = extname(file).toLowerCase()

    if (ext === '.csg') {
      csgText = readFileSync(file, 'utf8')
    } else {
      const artifact = await frontend.compileScad(
        { filePath: file },
        { timeoutMs: options.timeoutMs },
      )
      diags.push(...artifact.diagnostics)
      csgText = artifact.csgText
    }

    if (csgText.length === 0) {
      entries.push({
        input: file,
        ok: false,
        blockedNodes: [],
        parsedNodes: 0,
        emittedStatements: 0,
        nodeHistogram: {},
        diagnostics: diags,
        durationMs: Date.now() - start,
      })
      continue
    }

    // Parse
    const label = basename(file)
    const parsed = parseCsg(csgText, { path: label })
    diags.push(...parsed.diagnostics)

    // Build node histogram
    const histogramMap = countCsgNodesByName(parsed.document)
    const histogram: Record<string, number> = {}
    for (const [k, v] of histogramMap) histogram[k] = v

    // Node filter: skip files that don't contain the filtered node
    if (options.filterNode !== undefined && !histogram[options.filterNode]) {
      continue
    }

    // Lower + Emit
    const lowered = lowerCsg(parsed.document, { path: label })
    diags.push(...lowered.diagnostics)
    const emitted = emitFaijs(lowered.model)

    if (!emitted.ok) {
      diags.push({
        code: 'OSC3002',
        severity: 'error',
        message: `Conversion blocked: ${emitted.blocked.join(', ')}`,
      })
    }

    const hasErrors = diags.some((d) => d.severity === 'error')
    const ok = emitted.ok && !hasErrors

    // Write .fai.js if requested
    if (ok && options.writeFai && emitted.code.length > 0) {
      const faiPath = file.replace(/\.(scad|csg)$/, '.fai.js')
      writeFileSync(faiPath, emitted.code, 'utf8')
    }

    const entry: RunCandEntry = {
      input: file,
      ok,
      blockedNodes: emitted.blocked,
      parsedNodes: parsed.document.nodes.length,
      emittedStatements: emitted.statementNodes.length,
      nodeHistogram: histogram,
      diagnostics: diags,
      durationMs: Date.now() - start,
    }
    entries.push(entry)
    cache.set(cacheKey, entry)
  }

  const totalDuration = Date.now() - startTime

  // Save cache
  if (options.cache !== undefined) {
    saveCache(options.cache, cache)
  }

  const converted = entries.filter((e) => e.ok).length
  const blocked = entries.filter((e) => !e.ok && e.blockedNodes.length > 0).length
  const failed = entries.filter((e) => !e.ok && e.blockedNodes.length === 0).length

  const report: RunCandReport = {
    total: entries.length,
    converted,
    blocked,
    failed,
    entries,
    durationMs: totalDuration,
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(
      `run-cand: ${report.total} files, ${converted} converted, ${blocked} blocked, ${failed} failed (${totalDuration}ms)\n`,
    )
    for (const e of entries) {
      const status = e.ok ? 'PASS' : e.blockedNodes.length > 0 ? 'BLOCKED' : 'FAIL'
      const rel = relative(process.cwd(), e.input)
      const detail = e.blockedNodes.length > 0 ? ` [${e.blockedNodes.join(',')}]` : ''
      process.stdout.write(`  ${status}  ${rel}${detail}\n`)
    }
    const allDiags = entries.flatMap((e) => e.diagnostics.filter((d) => d.severity === 'error'))
    if (allDiags.length > 0) {
      process.stderr.write(`${formatDiagnosticsText(allDiags.slice(0, 20))}\n`)
    }
  }

  if (failed > 0) return 1
  if (blocked > 0 && converted === 0) return 1
  return 0
}

function collectFiles(root: string): string[] {
  const out: string[] = []
  if (!existsSync(root)) return out

  const st = statSync(root)
  if (st.isFile()) {
    const ext = extname(root).toLowerCase()
    if (ext === '.scad' || ext === '.csg') out.push(root)
  } else if (st.isDirectory()) {
    for (const name of readdirSync(root)) {
      out.push(...collectFiles(join(root, name)))
    }
  }
  return out.sort()
}

function loadCache(path: string): Map<string, RunCandEntry> {
  const map = new Map<string, RunCandEntry>()
  if (!existsSync(path)) return map
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { entries?: RunCandEntry[] }
    if (data.entries) {
      for (const e of data.entries) {
        map.set(e.input, e)
      }
    }
  } catch {
    // Corrupt cache — start fresh
  }
  return map
}

function saveCache(path: string, cache: Map<string, RunCandEntry>): void {
  const entries = [...cache.values()]
  writeFileSync(path, JSON.stringify({ entries }, null, 2), 'utf8')
}
