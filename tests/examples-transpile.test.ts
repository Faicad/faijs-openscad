/**
 * M2 门禁：OpenSCAD examples 语料 → IR → `.fai.js`（plan §11 的 G2）。
 *
 * 与 `examples-verify.test.ts` 的分工：那一层只管「CSG 能不能零诊断解析」，
 * 这一层只管「解析之后能不能产出可被 faijs 接受的代码」。两者共用同一份语料
 * （`tests/fixtures/openscad-examples/csg/`，由 `tests/verify-examples.ts --write` 生成）。
 *
 * 验收口径按 v0 的承诺（首版只承诺 P0）分两半：
 *
 *   A. **只含 P0 节点的 example 必须 100% 转换成功**，且生成物通过 faijs 的
 *      静态校验（`extractMetadata`：op 名、字面量形态、变量引用）。
 *   B. **含范围外节点的 example 必须全部 BLOCKED**，且原因可枚举——
 *      「没跑成功」与「明确拒绝」是两种状态，绝不能混为一谈。
 *
 * 语料里出现新节点时，A 或 B 会失败：那正是要复核能力表与 emitter 的信号。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCsg } from '../src/csg/parser'
import { lowerCsg } from '../src/ir/lower'
import { emitFaijs } from '../src/emit/faijs'
import { faijsStaticCheck, staticCheckAvailable } from '../src/__probe__/faijs-check'

const here = dirname(fileURLToPath(import.meta.url))
const CSG_DIR = join(here, 'fixtures', 'openscad-examples', 'csg')
const hasCsg = existsSync(CSG_DIR)

interface Transpiled {
  readonly name: string
  readonly ok: boolean
  readonly blocked: readonly string[]
  readonly code: string
  readonly statementCount: number
  /** lower/emit 阶段的 error 诊断码（去重）。 */
  readonly errorCodes: readonly string[]
}

function transpileAll(): Transpiled[] {
  if (!hasCsg) return []
  const out: Transpiled[] = []
  for (const file of readdirSync(CSG_DIR).filter((f) => f.endsWith('.csg')).sort()) {
    const text = readFileSync(join(CSG_DIR, file), 'utf8')
    const parsed = parseCsg(text, { path: file })
    const lowered = lowerCsg(parsed.document, { path: file })
    const emitted = emitFaijs(lowered.model)
    const errorCodes = new Set<string>()
    for (const d of [...parsed.diagnostics, ...lowered.diagnostics]) {
      if (d.severity === 'error') errorCodes.add(d.code)
    }
    out.push({
      name: file,
      ok: emitted.ok,
      blocked: emitted.blocked,
      code: emitted.code,
      statementCount: emitted.statementNodes.length,
      errorCodes: [...errorCodes].sort(),
    })
  }
  return out
}

const results = transpileAll()
const converted = results.filter((r) => r.ok)
const refused = results.filter((r) => !r.ok)

describe.skipIf(!hasCsg)('M2 门禁 A：P0-only example 全部转换成功', () => {
  it('语料规模与转换基线（50 个 example：22 个 P0-only 转出，28 个含范围外节点）', () => {
    expect(results.length).toBe(50)
    expect(converted.length).toBe(22)
    expect(refused.length).toBe(28)
    // 转出的语句总数是回归基线：结构改动会移动这个数，必须被看见。
    expect(converted.reduce((n, r) => n + r.statementCount, 0)).toBe(7697)
  })

  it('★ 有范围外节点 ⇒ 一定 ok:false（2026-10-06 修复的静默吞掉回归）', () => {
    // 曾经的 bug：组合节点的子节点**全部**是范围外节点时，维度推断返回「未知」，
    // 被 combine 当成「空几何」，于是 blocked 在树上消失 —— 7 个含 hull/import/
    // projection/text 的 example 被报成「转换成功」。这条断言把那个洞焊死。
    const lying = converted.filter((r) => r.errorCodes.includes('OSC3002'))
    expect(lying.map((r) => r.name)).toEqual([])
  })

  it('转换成功的一组里没有任何 error 诊断（警告可以，错误不行）', () => {
    const bad = converted.filter((r) => r.errorCodes.length > 0)
    expect(bad.map((r) => `${r.name} ${r.errorCodes.join(',')}`)).toEqual([])
  })

  it('生成物确定性：同一 example 两次转换字节一致', () => {
    const mismatched: string[] = []
    for (const r of converted) {
      const again = transpileOne(r.name)
      if (again.code !== r.code) mismatched.push(r.name)
    }
    expect(mismatched).toEqual([])
  })

  it('生成物通过 faijs 静态校验（op 名 / 字面量 / 变量引用）', async () => {
    const available = await staticCheckAvailable()
    expect(available, '需要安装 @faicad/faijs（devDependency）').toBe(true)
    if (!available) return

    const failures: string[] = []
    for (const r of converted) {
      const checked = await faijsStaticCheck(r.code)
      if (checked && !checked.ok) failures.push(`${r.name}: ${checked.message}`)
    }

    // 已知例外（且只有这一个）：Advanced/module_recursion 递归出的程序超过 faijs
    // 静态校验器的 1 MiB 源码上限（`source too long`）。这是**输入规模**限制，
    // 不是转换错误——所以它在这里被显式列出，而不是被跳过。
    const oversized = failures.filter((f) => f.includes('source too long'))
    const real = failures.filter((f) => !f.includes('source too long'))
    expect(oversized.map((f) => f.split(':')[0])).toEqual([
      'Advanced__module_recursion.scad.csg',
    ])
    expect(real).toEqual([])
  })
})

describe.skipIf(!hasCsg)('M2 门禁 B：含范围外节点的 example 全部明确 BLOCKED', () => {
  it('每个被拒的 example 都带 OSC3002（没有「静默不转换」这种状态）', () => {
    const silent = refused.filter(
      (r) => r.blocked.length === 0 || !r.errorCodes.includes('OSC3002'),
    )
    expect(silent.map((r) => r.name)).toEqual([])
  })

  it('拒绝原因可枚举，且只有已知的范围外节点', () => {
    const histogram = new Map<string, number>()
    for (const r of refused) {
      for (const node of r.blocked) histogram.set(node, (histogram.get(node) ?? 0) + 1)
    }
    expect([...histogram.entries()].sort()).toEqual([
      ['hull', 3],
      ['import', 6],
      ['linear_extrude', 4],
      ['offset', 2],
      ['polyhedron', 1],
      ['projection', 4],
      ['rotate_extrude', 3],
      ['surface', 1],
      ['text', 8],
    ])
  })

  it('被拒的 example 不产出任何可执行代码（code 为空串）', () => {
    expect(refused.filter((r) => r.code !== '').map((r) => r.name)).toEqual([])
  })

  it('linear_extrude 被拒的是带 twist / 非等比 scale 的那几个，纯拉伸不受影响', () => {
    const refusedExtrude = refused.filter((r) => r.blocked.includes('linear_extrude')).map((r) => r.name)
    expect(refusedExtrude.sort()).toEqual([
      'Advanced__offset.scad.csg',
      'Basics__linear_extrude.scad.csg',
      'Old__example009.scad.csg',
      'Old__example020.scad.csg',
    ])
  })
})

function transpileOne(name: string): Transpiled {
  const text = readFileSync(join(CSG_DIR, name), 'utf8')
  const parsed = parseCsg(text, { path: name })
  const lowered = lowerCsg(parsed.document, { path: name })
  const emitted = emitFaijs(lowered.model)
  return {
    name,
    ok: emitted.ok,
    blocked: emitted.blocked,
    code: emitted.code,
    statementCount: emitted.statementNodes.length,
    errorCodes: [],
  }
}
