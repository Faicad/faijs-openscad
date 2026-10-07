/**
 * PROBE（permanent，M2）：`.fai.js` 脚本表达式里的全局标识符（`Math` 等）能不能用。
 *
 * ── 起因 ──
 * M2 的 2D 探针在 `cad.profile({ ... startAngle: Math.PI ... })` 上报
 * `ParseError: [parser] line 3: unknown identifier "Math" in expression`。
 * 这个报错有三种可能解释，对 emitter 的含义**完全不同**：
 *   (a) 缺少 import      → emitter 要生成 import 行
 *   (b) 求值器不支持     → Math 不能用，只能输出算好的字面量
 *   (c) 前置静态校验误拦 → 执行器本身没问题，只是校验器白名单漏项
 *
 * ── 结论：(c)，且 faijs ≥ 0.30.9 已修复 ──
 *   L1 `security-scanner` 的 `S4_SAFE_GLOBALS`（0.29.5 实测 34 项）**含** Math/
 *      JSON/Number/console… 以及单位常量 MM/INCH/DEGREE。这些名字**全都是**
 *      JS 语言内建、真实存在于 `globalThis` —— 所以「不需要 import」是设计事实，
 *      不是碰巧。
 *   L2 两个执行后端都支持：
 *      - vm-backend（默认）：`new Function('__ctx','__ns','__isGeom', src)` ——
 *        `new Function` 的函数体在**真实全局作用域**求值，`Math` 天然可见；
 *      - interp env（禁 eval 环境）：`S4_SAFE_GLOBALS.has(name)` →
 *        `globalThis[name]`。
 *   L3 `metadata-extractor.collectExprIdentifiers` 的已知标识符集合 ——
 *      0.29.5 只有 `paramNames` / `declared` / `SCRIPT_UNIT_NAMES`（无 S4），
 *      `Math` 落进 `else` 抛 `E_REFERENCE`。
 *      **0.30.9 修复**：metadata-extractor 现已引用 `S4_SAFE_GLOBALS`，
 *      `Math` 在 op 实参里放行。本 probe 的「缺口守门」用例即为此修复的探测器。
 *
 * ── ★ 决定性对照（同一函数、同一位置，只换实参）──
 *      `cad.box(10 * MM, 1, 1)`  → 放行   （MM 在 SCRIPT_UNIT_NAMES 里）
 *      `cad.box(Math.PI, 1, 1)`  → 0.29.5 抛错 / 0.30.9 放行
 *   两者在 S4 白名单里同级；0.30.9 起 metadata-extractor 把 S4 并入白名单，
 *   两者均放行。
 *
 * ── 触发条件曾是「位置」而非「标识符」──
 *   0.29.5：只有 **op 实参表达式**会拦，顶层常量行 RHS 不拦。
 *   0.30.9：op 实参也放行（S4 并入白名单），位置差异不再决定 Math 的去留。
 *
 * ── 对 M2 的含义 ──
 *   emitter 现有的「算好数值再输出字面量」策略（`emit/units.ts`）仍然有效，
 *   **不需要 import**。0.30.9 起亦可直出 `Math.PI` 到 op 实参 ——
 *   若将来要切换到人读友好的写法，不再需要先提升为顶层常量行。
 *
 * 静态组（L1/L2/L3 + 对照实验）**不需要 wasm**，只需安装 @faicad/faijs；
 * 真机组 §C 需 `FAIJS_PROBE_RUNTIME=1`。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { faijsDistDir } from '../__probe__/faijs-static'
import { faijsInstalled, faijsRuntimeEnabled } from '../__probe__/env'

const dist = faijsDistDir()
const installed = faijsInstalled()
const runtimeEnabled = installed && faijsRuntimeEnabled()

function distRead(rel: string): string {
  if (!dist) return ''
  const file = join(dist, rel)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

/**
 * 直接从 dist 加载**真实模块**（而非做文本匹配）——断言对象行为而不是源码长相。
 * `@vite-ignore` 阻止 vite 重写这个绝对 file URL 的动态 import。
 */
async function distImport<T>(rel: string): Promise<T> {
  const url = pathToFileURL(join(dist as string, rel)).href
  return (await import(/* @vite-ignore */ url)) as T
}

/** extractMetadata 的调用参数（与 runtime.ts:790 的 execute 路径同形）。 */
const EXTRACT_OPTS = { defaultNs: 'cad', security: 'strict', namespaces: [] as string[] }

type ExtractFn = (code: string, opts?: Record<string, unknown>) => unknown

// ── §A 静态层：白名单与两个执行后端 ──

describe.skipIf(!installed)('probe(static): Math 是「免 import 的安全全局」（L1/L2）', () => {
  it('S4_SAFE_GLOBALS 列出的 JS 内建全局，在 globalThis 上真实存在', async () => {
    const { S4_SAFE_GLOBALS } = await distImport<{ S4_SAFE_GLOBALS: Set<string> }>(
      'lang/security-scanner.js',
    )
    expect(S4_SAFE_GLOBALS).toBeInstanceOf(Set)

    // 「不需要 import」的证明：这些名字是 JS 语言自带，本来就在全局作用域上。
    const jsBuiltins = [
      'Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Date',
      'Map', 'Set', 'Promise', 'Symbol', 'RegExp', 'Error',
      'Infinity', 'NaN', 'undefined',
      'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'console',
    ]
    for (const name of jsBuiltins) {
      expect(S4_SAFE_GLOBALS.has(name), `${name} 应在 S4_SAFE_GLOBALS`).toBe(true)
      expect(name in globalThis, `${name} 应真实存在于 globalThis`).toBe(true)
    }

    // 单位常量与 Math 同处一个白名单（值由 runtime 注册到 globalThis）。
    for (const unit of ['MM', 'INCH', 'DEGREE']) {
      expect(S4_SAFE_GLOBALS.has(unit), `单位常量 ${unit} 应在 S4_SAFE_GLOBALS`).toBe(true)
    }
  })

  it('vm-backend（默认执行后端）用 new Function —— 函数体在真实全局作用域求值', () => {
    const text = distRead('cad-runtime/exec-backends/vm-backend.js')
    expect(text).toContain('new Function(')
    expect(text).toMatch(/new Function\(\s*'__ctx'\s*,\s*'__ns'\s*,\s*'__isGeom'/)
  })

  it('interp env（禁 eval 后端）经 S4_SAFE_GLOBALS 解析全局名 → globalThis', () => {
    const text = distRead('cad-runtime/interp/env.js')
    expect(text).toContain('S4_SAFE_GLOBALS')
    expect(text).toContain('globalThis')
  })

  it('★ 修复守门：metadata-extractor 已把 S4_SAFE_GLOBALS 并入标识符白名单', () => {
    const text = distRead('lang/metadata-extractor.js')
    expect(text).toContain('unknown identifier')
    expect(text).toContain('SCRIPT_UNIT_NAMES')
    // faijs ≥ 0.30.9 修复：metadata-extractor 现引用 S4_SAFE_GLOBALS，
    // Math 等 JS 内建全局在 op 实参里不再被 E_REFERENCE 拦截。
    // emitter 可安全直出 Math.PI 到 op 实参（仍可选保留字面量策略）。
    expect(text).toContain('S4_SAFE_GLOBALS')
  })
})

// ── §B 对照实验：同一提取器，同一位置，只换实参 ──

describe.skipIf(!installed)('probe(static): extractMetadata 是「位置敏感」的拦截者', () => {
  let extract: ExtractFn

  beforeAll(async () => {
    const mod = await distImport<{ extractMetadata: ExtractFn }>('lang/metadata-extractor.js')
    extract = mod.extractMetadata
  })

  it('op 实参里的 Math 放行（faijs ≥ 0.30.9 已修，0.29.5 曾抛 E_REFERENCE）', () => {
    expect(() => extract('let c = cad.box(Math.PI, 1, 1)', EXTRACT_OPTS)).not.toThrow()
  })

  it('★ 决定性对照：同一位置，单位常量 MM 与 Math 均放行', () => {
    // 两者在 S4_SAFE_GLOBALS 里同级；0.30.9 起 metadata-extractor 把 S4 并入
    // 白名单，两者在 op 实参里均放行。
    expect(() => extract('let c = cad.box(10 * MM, 1, 1)', EXTRACT_OPTS)).not.toThrow()
    expect(() => extract('let c = cad.box(Math.PI, 1, 1)', EXTRACT_OPTS)).not.toThrow()
  })

  it('顶层常量行的 Math 不抛 —— 拦截条件是「位置」而不是「标识符」', () => {
    expect(() => extract('let x = Math.PI', EXTRACT_OPTS)).not.toThrow()
    expect(() => extract('let x = Math.PI * 2', EXTRACT_OPTS)).not.toThrow()
  })

  it('数值字面量在任何位置都放行（emitter 现有策略的安全网）', () => {
    expect(() => extract('let c = cad.box(3.141592653589793, 1, 1)', EXTRACT_OPTS)).not.toThrow()
    expect(() =>
      extract(`let c = cad.profile({ contours: [{ segments: [
        { kind: 'line', x1: 0, y1: 0, x2: 3.141592653589793, y2: 0 }
      ] }] })`, EXTRACT_OPTS),
    ).not.toThrow()
  })

  it('嵌套对象属性值里的 Math 同样放行（faijs ≥ 0.30.9 已修）', () => {
    expect(() =>
      extract(`let c = cad.profile({ contours: [{ segments: [
        { kind: 'line', x1: 0, y1: 0, x2: Math.PI, y2: 0 }
      ] }] })`, EXTRACT_OPTS),
    ).not.toThrow()
  })
})

// ── §C 真机组：端到端确认拦截位置与绕行方案（需 wasm）──

describe.skipIf(!runtimeEnabled)('probe(runtime): createRuntime 下的 Math 行为矩阵', () => {
  interface ExecResult {
    readonly failedAt?: { message: string; lineNo?: number }
    readonly outputs: Map<string, unknown>
  }
  let execute: (code: string) => Promise<ExecResult>
  let volume: (s: unknown) => Promise<number>

  beforeAll(async () => {
    const { createRuntime, createNodePorts, initOcctWasm } = await import('@faicad/faijs/node')
    const face = (await import('@faicad/faijs')) as unknown as {
      volume: (s: unknown) => Promise<number>
    }
    volume = face.volume
    await initOcctWasm()
    const rt = createRuntime(createNodePorts(), 'brep')
    execute = async (code: string): Promise<ExecResult> =>
      (await rt.execute(code, { topology: 'auto' })) as unknown as ExecResult
  }, 180_000)

  it('顶层常量行 Math.PI 可用 —— 只有 op 实参才被拦', async () => {
    const r = await execute('let x = Math.PI')
    expect(r.failedAt?.message).toBeUndefined()
  })

  it('op 实参 Math.PI 放行（faijs ≥ 0.30.9 已修，0.29.5 曾端到端拦截）', async () => {
    const r = await execute('let c = cad.box(Math.PI, 1, 1)')
    expect(r.failedAt?.message).toBeUndefined()
    expect(r.outputs.has('c')).toBe(true)
  })

  it('op 实参 10 * MM 通过（同属免 import 全局，对照）', async () => {
    const r = await execute('let c = cad.box(10 * MM, 1, 1)')
    expect(r.failedAt?.message).toBeUndefined()
    expect(r.outputs.has('c')).toBe(true)
  })

  it('★ 绕行有效：先在常量行绑定 Math 结果，再在实参引用变量', async () => {
    // 这条同时是 emitter 的候选方案：想输出人读友好的 Math 表达式时，
    // 先提升为顶层常量行即可绕过 op 实参的静态校验。
    const r = await execute(`
      let pi = Math.PI
      let c = cad.box(pi, 1, 1)
    `)
    expect(r.failedAt?.message).toBeUndefined()
    // π×1×1 的体积即 π 本身 —— 证明 Math 的值真的算进了几何。
    expect(await volume(r.outputs.get('c'))).toBeCloseTo(Math.PI, 6)
  })
})
