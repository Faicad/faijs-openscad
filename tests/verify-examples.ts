/**
 * OpenSCAD examples 移植正确性验证器（手动运行；长期保留）。
 *
 * 流程：对每个 OpenSCAD 官方 `examples/*.scad`（CC0 公共领域，已完整拷贝到
 * `tests/fixtures/openscad-examples/`）调用 OpenSCAD（外部进程）求值为 `.csg`
 * → faijs-openscad 解析器解析 → 双路直方图对账。验证「移植正确性」即：
 * 真实世界的 OpenSCAD 示例模型产出的 CSG 能被本解析器零诊断解析，且 AST 不漏/不重节点。
 *
 * 语料来源是 OpenSCAD 的 `examples/` 目录，其许可证为 CC0（见
 * `tests/fixtures/openscad-examples/COPYING-CC0.txt`），与本仓库的 AGPL 取向不冲突，
 * 因此整目录拷贝进本项目，并在同目录生成对应的 `.fai.js`（见 `tests/gen-examples-fai.ts`）。
 * 这与 OpenSCAD 的 `src/`（GPL）无关，也未使用 OpenSCAD 上游测试文件。
 *
 * 用法：
 *   tsx tests/verify-examples.ts              # 生成 + 解析 + 打印报告
 *   tsx tests/verify-examples.ts --write      # 额外把 .csg 写回 tests/fixtures/openscad-examples/csg/
 *
 * 环境变量：
 *   MCAD_LIB       MCAD 库根目录（仅 Old/example023.scad 的传递依赖需要；默认不要求）
 *   OPENSCAD_BIN   OpenSCAD 可执行文件路径
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parseCsg } from '../src/csg/parser'
import { countCsgNodesByName, type CsgDocument } from '../src/csg/ast'
import { NODE_LINE } from '../src/__probe__/corpus-scan'

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

function textHistogram(text: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const r = NODE_LINE.exec(line)
    if (r && r[1]) m.set(r[1], (m.get(r[1]) ?? 0) + 1)
  }
  return m
}

function mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

function discoverOpenScad(): string | undefined {
  for (const p of [OPENSCAD_BIN, process.env.OPENSCAD_BIN].filter(Boolean) as string[]) {
    if (existsSync(p)) return p
  }
  return undefined
}

/** 递归收集 examples 树下所有 .scad 文件路径（跳过 example-dir.json 等非 .scad）。 */
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

interface Row {
  rel: string
  csgBytes: number
  nodeCount: number
  diagnostics: number
  histMatch: boolean
  status: 'ok' | 'empty' | 'fail'
  note: string
}

const os = discoverOpenScad()
// 仅 Old/example023.scad 通过 `use <MCAD/...>` 传递依赖 MCAD；挂在 OPENSCADPATH 上
// 让其可求值。examples 本身仍是唯一验证语料，MCAD 不是语料。
const OPENSCAD_PATH = MCAD_LIB
const scadFiles = collectScad(EXAMPLES_ROOT)
const rows: Row[] = []

for (const scadPath of scadFiles) {
  const rel = relative(EXAMPLES_ROOT, scadPath).split('\\').join('/')
  let csg = ''
  let note = ''
  if (!os) {
    note = 'openscad-not-found'
  } else {
    try {
      const tmpCsg = join(BUILD, `${rel.replace(/[\\/]/g, '__')}.tmp.csg`)
      execFileSync(os, ['-o', tmpCsg, scadPath], {
        timeout: 120_000,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, OPENSCADPATH: OPENSCAD_PATH },
      })
      csg = readFileSync(tmpCsg, 'utf8')
    } catch (e: any) {
      note = String(e?.stderr ?? e?.message ?? e)
        .split('\n')
        .filter((l: string) => /ERROR|WARNING|deprecat/i.test(l))
        .slice(0, 1)
        .join(' ')
        .slice(0, 160)
    }
  }

  if (!csg) {
    rows.push({
      rel,
      csgBytes: 0,
      nodeCount: 0,
      diagnostics: 0,
      histMatch: false,
      status: os ? 'empty' : 'fail',
      note: note || 'empty-csg',
    })
    continue
  }

  const pr = parseCsg(csg, { path: rel })
  const astHist = countCsgNodesByName(pr.document as CsgDocument)
  const textHist = textHistogram(csg)
  const histMatch = mapsEqual(astHist, textHist)
  const nodeCount = [...astHist.values()].reduce((a, b) => a + b, 0)
  const diagnostics = pr.diagnostics.length

  if (WRITE) {
    const outPath = join(CSG_OUT, `${rel.replace(/[\\/]/g, '__')}.csg`)
    writeFileSync(outPath, csg, 'utf8')
  }

  rows.push({
    rel,
    csgBytes: csg.length,
    nodeCount,
    diagnostics,
    histMatch,
    status: diagnostics === 0 && histMatch ? 'ok' : 'fail',
    note: diagnostics === 0 ? (histMatch ? '' : 'histogram-mismatch') : pr.diagnostics[0].code,
  })
}

// ---- 报告 ----
const totalNodes = rows.reduce((a, r) => a + r.nodeCount, 0)
const okRows = rows.filter((r) => r.status === 'ok')
const failRows = rows.filter((r) => r.status !== 'ok')
const generated = rows.filter((r) => r.csgBytes > 0)

console.log('OpenSCAD examples 移植正确性验证（CC0 语料）')
console.log(`  EXAMPLES_ROOT = ${EXAMPLES_ROOT}`)
console.log(`  OpenSCAD = ${os ?? '(未找到)'}`)
console.log(`  示例总数 = ${rows.length}，生成 CSG = ${generated.length}，` +
  `零诊断且直方图一致 = ${okRows.length}`)
console.log(`  CSG 节点总数 = ${totalNodes}`)
console.log('')
console.log('example'.padEnd(40), 'bytes'.padStart(7), 'nodes'.padStart(7), 'diag'.padStart(5), 'hist'.padStart(6), ' status')
for (const r of rows) {
  console.log(
    r.rel.padEnd(40),
    String(r.csgBytes).padStart(7),
    String(r.nodeCount).padStart(7),
    String(r.diagnostics).padStart(5),
    (r.histMatch ? 'ok' : '-').padStart(6),
    ' ',
    r.status === 'ok' ? 'PASS' : `${r.status}(${r.note})`,
  )
}

if (failRows.length > 0) {
  console.log(`\nFAIL: ${failRows.length} 个示例未通过（见上）。`)
  process.exit(1)
}
console.log('\nALL PASS')
process.exit(0)
