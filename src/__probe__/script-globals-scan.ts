/**
 * 探索脚本（非测试）：`.fai.js` 表达式里的全局标识符（`Math` 等）到底能不能用。
 *
 * 背景：M2 写 2D emitter 时，探针在 `cad.profile({ ... startAngle: Math.PI ... })`
 * 上报 `ParseError: unknown identifier "Math" in expression`。但源码里存在三处
 * **放行** `Math` 的证据（S4_SAFE_GLOBALS / interp env / vm `new Function`）。
 * 矛盾必须先分清：**是「缺少 import」，还是「求值器真不支持」，还是「被前置的
 * 静态校验挡掉」**——这三者对 emitter 的含义完全不同。
 *
 * 本脚本按「源码到执行」的链路自上而下逐层取证：
 *   L1 静态层   security-scanner  S4_SAFE_GLOBALS 是否含 Math
 *   L2 执行器   vm-backend（new Function，全局作用域）/ interp env（S4 → globalThis）
 *   L3 前置校验 metadata-extractor.collectExprIdentifiers 的白名单构成
 *   L4 真机矩阵 createRuntime 跑 7 个场景，看**哪些位置**拦、**怎么绕**
 *
 * 结论固化在 `src/emit/faijs-script-globals.probe.test.ts`（本文件只做探索）。
 * 用法：`npx tsx src/__probe__/script-globals-scan.ts`
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { faijsDistDir } from './faijs-static'

const dist = faijsDistDir()
if (!dist) {
  console.error('faijs dist 未找到（@faicad/faijs 未安装？）')
  process.exit(1)
}
/**
 * narrow 后的非空根：`process.exit` 之后 `dist` 在**顶层**已是 string，
 * 但函数声明被提升，闭包内 TS 不保留该 narrow —— 故另取一个 string 常量。
 */
const distRoot: string = dist

function read(rel: string): string {
  const file = join(distRoot, rel)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`)
}

// ── L1 静态门禁：security-scanner ──

section('L1 静态门禁 security-scanner：S4_SAFE_GLOBALS 是否含 Math')
{
  const text = read('lang/security-scanner.js')
  // S4_SAFE_GLOBALS 是一条 `new Set([...])`；抓 Math / Number / JSON 是否在内。
  const hasMath = /['"]Math['"]/.test(text)
  console.log(`  dist/lang/security-scanner.js 存在: ${text.length > 0}`)
  console.log(`  文本中出现 'Math': ${hasMath}`)
  const m = text.match(/S4_SAFE_GLOBALS\s*=\s*new Set\(\[([\s\S]{0,400}?)\]\)/)
  console.log(`  S4_SAFE_GLOBALS 摘录: ${m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 200) : '(未匹配到)'}`)
}

// ── L2 执行器：两个后端各自的机制 ──

section('L2a 执行器 vm-backend：源码文本如何求值')
{
  const text = read('cad-runtime/exec-backends/vm-backend.js')
  console.log(`  dist/.../vm-backend.js 存在: ${text.length > 0}`)
  const fn = text.match(/new Function\(([^)]*)\)/)
  console.log(`  new Function 形参表: ${fn ? fn[1] : '(未匹配到)'}`)
  console.log('  → new Function 的函数体在**真实全局作用域**求值，Math 天然可见（无需注入/import）')
}

section('L2b 执行器 interp env：S4_SAFE_GLOBALS 如何解析')
{
  const text = read('cad-runtime/interp/env.js')
  console.log(`  dist/.../interp/env.js 存在: ${text.length > 0}`)
  const hit = text.match(/S4_SAFE_GLOBALS\.has\([^)]*\)[\s\S]{0,160}/)
  console.log(`  解析片段: ${hit ? hit[0].replace(/\s+/g, ' ').trim() : '(未匹配到)'}`)
}

// ── L3 前置校验：metadata-extractor ──

section('L3 前置校验 metadata-extractor：collectExprIdentifiers 的白名单')
{
  const text = read('lang/metadata-extractor.js')
  console.log(`  dist/lang/metadata-extractor.js 存在: ${text.length > 0}`)
  const idx = text.indexOf('unknown identifier')
  console.log(`  抛 E_REFERENCE 处摘录: ${idx >= 0 ? text.slice(Math.max(0, idx - 320), idx + 60).replace(/\s+/g, ' ').trim() : '(未找到)'}`)
  console.log(`  该文件是否引用 S4_SAFE_GLOBALS: ${/S4_SAFE_GLOBALS/.test(text)}`)
  console.log(`  该文件是否引用 SCRIPT_UNIT_NAMES: ${/SCRIPT_UNIT_NAMES/.test(text)}`)
}

// ── L2 机制复刻：把源码直接交给 vm 后端同款包装，证明 Math 可执行 ──

section('L2c 机制复刻：vm-backend 同款 new Function 包装跑 Math')
async function vmLikeEval(body: string, ctx: Record<string, unknown>): Promise<void> {
  // 逐字复刻 cad-runtime/exec-backends/vm-backend.ts 的 runUnit：
  //   const src = `return (async () => {\n${unit.body}\n})()`
  //   const fn = new Function('__ctx', '__ns', '__isGeom', src)
  //   await fn(host.ctx, host.namespaces, host.isGeom)
  const src = `return (async () => {\n${body}\n})()`
  const fn = new Function('__ctx', '__ns', '__isGeom', src)
  await fn(ctx, {}, () => false)
}
{
  const ctx: Record<string, unknown> = {}
  await vmLikeEval('__ctx.x = Math.PI * 2', ctx)
  console.log(`  __ctx.x = Math.PI * 2  →  x = ${String(ctx.x)}`)
  console.log(`  期望            →  x = ${Math.PI * 2}`)
  console.log(`  ✓ 执行器机制本身完全支持 Math（不经任何前置校验时）`)
}

// ── L4 真机矩阵 ──

section('L4 真机矩阵：createRuntime 各位置行为')
{
  const { createRuntime, createNodePorts, initOcctWasm } = await import('@faicad/faijs/node')
  await initOcctWasm()
  const rt = createRuntime(createNodePorts(), 'brep')

  interface Case { id: string; why: string; code: string }
  const cases: Case[] = [
    {
      id: 'S1',
      why: '顶层常量行 RHS（非 op 实参）',
      code: 'let x = Math.PI',
    },
    {
      id: 'S2',
      why: '顶层常量行 RHS —— 字面量对照',
      code: 'let x = 3.141592653589793',
    },
    {
      id: 'S3',
      why: 'op **位置实参**（box 边长）',
      code: 'let c = cad.box(Math.PI, 1, 1)',
    },
    {
      id: 'S4',
      why: 'op 实参 —— 字面量对照',
      code: 'let c = cad.box(3.141592653589793, 1, 1)',
    },
    {
      id: 'S5',
      why: 'op 实参 —— **单位常量**对照（MM，同属免 import 全局）',
      code: 'let c = cad.box(10 * MM, 1, 1)',
    },
    {
      id: 'S6',
      why: 'op 实参 —— 嵌套对象属性值（M2 实际踩到的形态）',
      code: `let c = cad.profile({ contours: [{ segments: [
        { kind: 'line', x1: 0, y1: 0, x2: Math.PI, y2: 0 },
        { kind: 'line', x1: 3.141592653589793, y1: 0, x2: 3.141592653589793, y2: 1 },
        { kind: 'line', x1: 3.141592653589793, y1: 1, x2: 0, y2: 1 },
        { kind: 'line', x1: 0, y1: 1, x2: 0, y2: 0 }
      ] }] })`,
    },
    {
      id: 'S7',
      why: '**绕行候选**：先常量行绑定 Math 结果，再在实参里引用该变量',
      code: `let pi = Math.PI
let c = cad.profile({ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: pi, y2: 0 },
  { kind: 'line', x1: pi, y1: 0, x2: pi, y2: 1 },
  { kind: 'line', x1: pi, y1: 1, x2: 0, y2: 1 },
  { kind: 'line', x1: 0, y1: 1, x2: 0, y2: 0 }
] }] })`,
    },
  ]

  for (const c of cases) {
    let msg = '(ok)'
    let envKeys = ''
    try {
      const r = (await rt.execute(c.code, { topology: 'auto' })) as unknown as {
        failedAt?: { message: string; callee: string; lineNo?: number }
        outputs: Map<string, unknown>
      }
      if (r.failedAt) msg = `FAIL line=${r.failedAt.lineNo} callee=${r.failedAt.callee} :: ${r.failedAt.message}`
      else envKeys = [...r.outputs.keys()].join(',')
    } catch (err) {
      msg = `THROW :: ${err instanceof Error ? err.message : String(err)}`
    }
    console.log(`  ${c.id}  ${c.why}`)
    console.log(`      → ${msg}${envKeys ? `  outputs=[${envKeys}]` : ''}`)
  }
}

console.log('\n完成。\n')
