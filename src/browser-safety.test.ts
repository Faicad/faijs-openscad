/**
 * Compatibility gate (plan §12.3): the `./browser` entry must not reach any
 * Node built-in. A future refactor that pulls `node:fs` into the diagnostic or
 * dialect layer would break browser bundling — this test catches it statically,
 * without needing a bundler in CI.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname)

const NODE_BUILTINS = new Set([
  'fs',
  'path',
  'os',
  'crypto',
  'child_process',
  'util',
  'url',
  'process',
  'buffer',
  'stream',
  'worker_threads',
])

/** Extract every module specifier imported/exported-from by a TS source file. */
export function extractSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const specs: string[] = []
  const re =
    /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3]
    if (spec) specs.push(spec)
  }
  return specs
}

/** Transitively collect every module reachable from `entry`. */
export function reachableModules(entry: string): { files: string[]; external: string[] } {
  const files: string[] = []
  const external: string[] = []
  const seen = new Set<string>()
  const queue: string[] = [entry]
  while (queue.length) {
    const file = queue.shift() as string
    if (seen.has(file)) continue
    seen.add(file)
    files.push(file)
    for (const spec of extractSpecifiers(file)) {
      if (spec.startsWith('node:') || NODE_BUILTINS.has(spec)) {
        external.push(spec)
        continue
      }
      if (spec.startsWith('.')) {
        const base = join(dirname(file), spec)
        const candidates = [`${base}.ts`, join(base, 'index.ts'), base]
        const hit = candidates.find((c) => existsSync(c) && !c.endsWith('.test.ts'))
        if (hit) queue.push(hit)
      } else {
        external.push(spec)
      }
    }
  }
  return { files, external }
}

describe('browser entry safety', () => {
  const entry = join(SRC, 'browser.ts')

  it('reaches no Node built-in, directly or transitively', () => {
    const { external } = reachableModules(entry)
    const nodeish = external.filter(
      (s) => s.startsWith('node:') || NODE_BUILTINS.has(s.split('/')[0]),
    )
    expect(nodeish).toEqual([])
  })

  it('reaches no bare/3rd-party runtime dependency either', () => {
    // The browser bundle must be closed: only relative modules + types.
    const { external } = reachableModules(entry)
    expect(external).toEqual([])
  })

  it('does not re-export the environment or CLI front-ends', () => {
    // Checked on the parsed specifiers, not the raw text: a comment mentioning
    // "environment" must not trip the gate.
    const specs = extractSpecifiers(entry)
    for (const banned of ['./environment', './frontend/openscad-cli', './frontend/discover-openscad']) {
      expect(specs).not.toContain(banned)
    }
  })
})
