/**
 * OpenSCAD examples → `.fai.js` 生成器（手动运行；长期保留）。
 *
 * 目标（用户方案）：把 OpenSCAD 官方 `examples/` 完整拷贝进本项目后，在**同目录**
 * 为每个 `.scad` 生成对应的 `.fai.js`（`<name>.scad` → `<name>.fai.js`）。
 *
 * 管线：`.scad` →（OpenSCAD 外部进程）→ `.csg` → `parseCsg` → `lowerCsg`（Model IR）
 * → `emitFaijs`（`.fai.js`）。
 *
 * 当前进度（2026-10-06）：`scad → csg → parseCsg` 已可用并接入 examples 验证基线；
 * `lowerCsg` / `emitFaijs` 按计划是 **M2** 才落地，尚未在 `src/index.ts` 导出。因此本脚本
 * 在发射器就绪前会跑通 `.csg` 生成与解析，并在每个示例处说明 `.fai.js` 发射待 M2 接入；
 * 一旦 `emitFaijs` 在 `src/index.ts` 导出，本脚本即会在同目录写出真实 `.fai.js`，无需改动。
 *
 * 用法：
 *   tsx tests/gen-examples-fai.ts            # 解析 + （若发射器就绪）生成 .fai.js
 *   tsx tests/gen-examples-fai.ts --write    # 额外把中间 .csg 写回 csg/
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parseCsg } from '../src/csg/parser'
import type { CsgDocument } from '../src/csg/ast'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const EXAMPLES_ROOT = join(here, 'fixtures', 'openscad-examples')
const CSG_OUT = join(EXAMPLES_ROOT, 'csg')
const BUILD = join(EXAMPLES_ROOT, 'build')
const OPENSCAD_BIN =
  process.env.OPENSCAD_BIN ?? 'C:/Program Files/OpenSCAD/openscad.exe'
const MCAD_LIB =
  process.env.MCAD_LIB ?? 'C:/git/OpenSCAD/webmcp-openscad/public/libraries/MCAD'
const WRITE = process.argv.includes('--write')

mkdirSync(CSG_OUT, { recursive: true })
mkdirSync(BUILD, { recursive: true })

/** M2 发射器：一旦 `src/index.ts` 导出 `emitFaijs`，这里即可拿到真实实现。 */
let emitFaijs: ((doc: CsgDocument, opts: { sourcePath: string }) => string) | undefined
try {
  const mod = (await import('../src/index')) as Record<string, unknown>
  const fn = mod.emitFaijs
  if (typeof fn === 'function') emitFaijs = fn as typeof emitFaijs
} catch {
  /* ignore — emitter not wired yet */
}
const emitterReady = emitFaijs !== undefined

function discoverOpenScad(): string | undefined {
  for (const p of [OPENSCAD_BIN, process.env.OPENSCAD_BIN].filter(Boolean) as string[]) {
    if (existsSync(p)) return p
  }
  return undefined
}

function collectScad(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...collectScad(p))
    else if (name.endsWith('.scad')) out.push(p)
  }
  return out.sort()
}

const os = discoverOpenScad()
const scadFiles = collectScad(EXAMPLES_ROOT)
let generated = 0
let emitted = 0
const emittedFiles: string[] = []

for (const scadPath of scadFiles) {
  const rel = relative(EXAMPLES_ROOT, scadPath).split('\\').join('/')
  const faiPath = scadPath.replace(/\.scad$/, '.fai.js')
  let csg = ''
  try {
    const tmpCsg = join(BUILD, `${rel.replace(/[\\/]/g, '__')}.tmp.csg`)
    execFileSync(os!, ['-o', tmpCsg, scadPath], {
      timeout: 120_000,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, OPENSCADPATH: MCAD_LIB },
    })
    csg = readFileSync(tmpCsg, 'utf8')
  } catch {
    console.log(`skip ${rel} (no csg)`)
    continue
  }
  generated++
  if (WRITE) writeFileSync(join(CSG_OUT, `${rel.replace(/[\\/]/g, '__')}.csg`), csg, 'utf8')

  if (!emitterReady) {
    console.log(`parsed ${rel} — .fai.js 发射待 M2 (emitFaijs 未导出)`)
    continue
  }
  const { document } = parseCsg(csg, { path: rel })
  const code = emitFaijs!(document as CsgDocument, { sourcePath: rel })
  writeFileSync(faiPath, code, 'utf8')
  emitted++
  emittedFiles.push(faiPath)
}

console.log('')
console.log(`OpenSCAD examples → .fai.js 生成器`)
console.log(`  示例总数 = ${scadFiles.length}，生成 CSG = ${generated}`)
console.log(`  发射器状态 = ${emitterReady ? '已就绪' : 'M2 未接入（emitFaijs 尚未在 src/index.ts 导出）'}`)
console.log(`  实际写出 .fai.js = ${emitted}`)
if (!emitterReady) {
  console.log('  → 当前仅完成 scad→csg→parse；`.fai.js` 将在 M2 的 lowerCsg/emitFaijs 落地后由本脚本同目录产出。')
} else {
  for (const f of emittedFiles) console.log(`  wrote ${relative(ROOT, f)}`)
}
process.exit(0)
