/**
 * OpenSCAD examples → `.fai.js` 生成器（手动运行；长期保留）。
 *
 * 目标（用户方案）：把 OpenSCAD 官方 `examples/` 完整拷贝进本项目后，在**同目录**
 * 为每个 `.scad` 生成对应的 `.fai.js`（`<name>.scad` → `<name>.fai.js`）。
 *
 * 管线：`.scad` →（OpenSCAD 外部进程）→ `.csg` → `parseCsg` → `lowerCsg`（Model IR）
 * → `emitFaijs`（`.fai.js`）。
 *
 * M2 已落地，`lowerCsg` / `emitFaijs` 均在 `src/index.ts` 导出，因此本脚本现在会
 * 真正写出 `.fai.js`；含范围外节点的示例**不产出文件**（emitter 返回 `ok:false`），
 * 而是打印其 BLOCKED 原因 —— 空文件比"看起来能跑"的近似代码更危险。
 *
 * 用法：
 *   tsx tests/gen-examples-fai.ts            # 优先复用已有 .csg，缺失时才调用 OpenSCAD
 *   tsx tests/gen-examples-fai.ts --write    # 额外把中间 .csg 写回 csg/
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { emitFaijs, lowerCsg, parseCsg } from '../src/index'

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
let blocked = 0
const emittedFiles: string[] = []
const blockedFiles: string[] = []
const skipped: string[] = []

for (const scadPath of scadFiles) {
  const rel = relative(EXAMPLES_ROOT, scadPath).split('\\').join('/')
  const faiPath = scadPath.replace(/\.scad$/, '.fai.js')
  const cachedCsg = join(CSG_OUT, `${rel.replace(/[\\/]/g, '__')}.csg`)
  let csg = ''

  // 优先复用已生成的 .csg：没有 OpenSCAD 二进制时也能跑（与 examples-verify 同源）。
  if (existsSync(cachedCsg)) {
    csg = readFileSync(cachedCsg, 'utf8')
  } else if (os) {
    try {
      const tmpCsg = join(BUILD, `${rel.replace(/[\\/]/g, '__')}.tmp.csg`)
      execFileSync(os, ['-o', tmpCsg, scadPath], {
        timeout: 120_000,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, OPENSCADPATH: MCAD_LIB },
      })
      csg = readFileSync(tmpCsg, 'utf8')
    } catch {
      skipped.push(rel)
      continue
    }
  } else {
    skipped.push(rel)
    continue
  }

  generated++
  if (WRITE && !existsSync(cachedCsg)) writeFileSync(cachedCsg, csg, 'utf8')

  const { document } = parseCsg(csg, { path: rel })
  const lowered = lowerCsg(document, { path: rel })
  const result = emitFaijs(lowered.model)

  if (!result.ok) {
    // 范围外节点：明确不产出文件。写一个"能跑但几何不同"的近似产物是最坏的选择。
    blocked++
    blockedFiles.push(`${rel}  (${result.blocked.join(', ')})`)
    continue
  }

  writeFileSync(faiPath, result.code, 'utf8')
  emitted++
  emittedFiles.push(faiPath)
}

console.log('')
console.log('OpenSCAD examples -> .fai.js 生成器')
console.log(`  示例总数 = ${scadFiles.length}，拿到 CSG = ${generated}，缺 CSG = ${skipped.length}`)
console.log(`  写出 .fai.js = ${emitted}，BLOCKED（范围外节点，不产出文件）= ${blocked}`)
for (const f of emittedFiles) console.log(`  wrote ${relative(ROOT, f)}`)
for (const b of blockedFiles) console.log(`  blocked ${b}`)
for (const s of skipped) console.log(`  skipped ${s} (no csg; set OPENSCAD_BIN to generate)`)
process.exit(0)
