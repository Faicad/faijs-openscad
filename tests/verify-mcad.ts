/**
 * MCAD 移植正确性验证器（手动运行；长期保留）。
 *
 * 流程：对每个夹具 `use` MCAD 模块 → 调用 OpenSCAD（外部进程）求值为 `.csg`
 * → faijs-openscad 解析器解析 → 双路直方图对账。验证「移植正确性」即：
 * 真实世界（MCAD）模型产出的 CSG 能被本解析器零诊断解析，且 AST 不漏/不重节点。
 *
 * 不依赖 OpenSCAD 上游测试文件（GPL），只使用 MCAD（LGPL）作为黑盒输入。
 *
 * 用法：
 *   tsx tests/verify-mcad.ts              # 生成 + 解析 + 打印报告
 *   tsx tests/verify-mcad.ts --write      # 额外把 .csg 写回 tests/fixtures/mcad/csg/
 *
 * 环境变量：
 *   MCAD_LIB       MCAD 库根目录（含 *.scad）
 *   OPENSCAD_BIN   OpenSCAD 可执行文件路径
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parseCsg } from '../src/csg/parser'
import { countCsgNodesByName, type CsgDocument } from '../src/csg/ast'
import { NODE_LINE } from '../src/__probe__/corpus-scan'
import { MCAD_FIXTURES } from './fixtures/mcad/fixtures'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const MCAD_LIB = process.env.MCAD_LIB ?? 'C:/git/OpenSCAD/webmcp-openscad/public/libraries/MCAD'
const OPENSCAD_BIN =
  process.env.OPENSCAD_BIN ?? 'C:/Program Files/OpenSCAD/openscad.exe'
const BUILD = join(here, 'fixtures', 'mcad', 'build')
const CSG_OUT = join(here, 'fixtures', 'mcad', 'csg')
const WRITE = process.argv.includes('--write')

mkdirSync(BUILD, { recursive: true })
mkdirSync(CSG_OUT, { recursive: true })

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

interface Row {
  name: string
  csgBytes: number
  nodeCount: number
  diagnostics: number
  histMatch: boolean
  status: 'ok' | 'empty' | 'fail'
  note: string
}

const os = discoverOpenScad()
const MCAD_PARENT = resolve(MCAD_LIB, '..')
const OPENSCAD_PATH = `${MCAD_LIB};${MCAD_PARENT}`
const rows: Row[] = []

for (const fx of MCAD_FIXTURES) {
  // 文件名加 `mcad-` 前缀：避免夹具 .scad 与 MCAD 同名模块（如 boxes.scad）
  // 互相 `use` 时自我包含，导致模块「unknown」、几何为空。
  const scadPath = join(BUILD, `mcad-${fx.name}.scad`)
  writeFileSync(scadPath, fx.scad, 'utf8')
  const csgPath = join(CSG_OUT, `${fx.name}.csg`)
  const tmpCsg = join(BUILD, `${fx.name}.csg`)
  let csg = ''
  let note = ''
  if (!os) {
    note = 'openscad-not-found'
  } else {
    try {
      // OpenSCAD 2021.01 不支持 -L；用 OPENSCADPATH 注入库路径（含库目录与其父
      // 目录，因为部分 MCAD 文件用 `use <MCAD/...>` 方式引入）。
      // .csg 扩展名即触发 CSG 导出格式。
      execFileSync(
        os,
        ['-o', tmpCsg, scadPath],
        {
          timeout: 120_000,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: { ...process.env, OPENSCADPATH: OPENSCAD_PATH },
        },
      )
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
      name: fx.name,
      csgBytes: 0,
      nodeCount: 0,
      diagnostics: 0,
      histMatch: false,
      status: os ? 'empty' : 'fail',
      note: note || 'empty-csg',
    })
    continue
  }

  const pr = parseCsg(csg, { path: `${fx.name}.csg` })
  const astHist = countCsgNodesByName(pr.document as CsgDocument)
  const textHist = textHistogram(csg)
  const histMatch = mapsEqual(astHist, textHist)
  const nodeCount = [...astHist.values()].reduce((a, b) => a + b, 0)
  const diagnostics = pr.diagnostics.length

  if (WRITE) writeFileSync(csgPath, csg, 'utf8')

  rows.push({
    name: fx.name,
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

console.log('MCAD 移植正确性验证')
console.log(`  MCAD_LIB = ${MCAD_LIB}`)
console.log(`  OpenSCAD = ${os ?? '(未找到)'}`)
console.log(`  夹具总数 = ${rows.length}，生成 CSG = ${generated.length}，` +
  `零诊断且直方图一致 = ${okRows.length}`)
console.log(`  CSG 节点总数 = ${totalNodes}`)
console.log('')
console.log('fixture'.padEnd(24), 'bytes'.padStart(7), 'nodes'.padStart(7), 'diag'.padStart(5), 'hist'.padStart(6), ' status')
for (const r of rows) {
  console.log(
    r.name.padEnd(24),
    String(r.csgBytes).padStart(7),
    String(r.nodeCount).padStart(7),
    String(r.diagnostics).padStart(5),
    (r.histMatch ? 'ok' : '-').padStart(6),
    ' ',
    r.status === 'ok' ? 'PASS' : `${r.status}(${r.note})`,
  )
}

if (failRows.length > 0) {
  console.log(`\nFAIL: ${failRows.length} 个夹具未通过（见上）。`)
  process.exit(1)
}
console.log('\nALL PASS')
process.exit(0)
