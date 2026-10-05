/**
 * probe-faijs-host.mjs — 按《第三方库开发手册》装配 Host 后的能力探针（v3）
 *
 * 勘误 #0：此前所有结论是在「直接 import { cad } 并在 TS 里裸调」的前提下得出的——
 *   那等于在没有 Host 装配的情况下使用 ② 脚本面。手册 §3.1 明确 Host 必须先
 *   createRuntime + 提供内核（initOcctWasm）。缺装配 → 布尔报 "not manifold" /
 *   "no BREP engine registered"，这是**装配缺失**，不是 faijs 能力缺口。
 * 勘误 #1：`cad.box({ size:[...] })` 对象形态已移除（源码 primitives.ts:37）；
 *   手册 §4.1 的 `cad.box({ size: [30,30,5] })` 示例已过期。正确是位置形态
 *   `cad.box(10,10,10)`（slotMap 装箱为 { width, depth, height }）。
 * 勘误 #2：`.fai.js` 语句是**换行分隔**，不是 `;` 分隔。写成一行用 `;` 会在首条
 *   语句后停止执行（本探针 v2 的全部 NOOUT 即由此产生）。
 * 勘误 #3：`cad.profile` 需要 `{ contours: [{ segments: [...] }] }` 形态。
 *
 * 保留为长期探针（探测代码必须固化为测试，禁止删除）。
 * 用法：node tests/probe-faijs-host.mjs
 */
import { createRuntime, createNodePorts, initOcctWasm } from '@faicad/faijs/node'

const log = (...a) => console.log(...a)

const PROFILE = `cad.profile({ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 5 },
  { kind: 'line', x1: 10, y1: 5, x2: 0, y2: 0 }
], closed: true }] })`

const cases = {
  box: `let out = cad.box(10, 10, 10)`,
  sphere: `let out = cad.sphere(10)`,
  cylinder: `let out = cad.cylinder(5, 10)`,
  union: `let a = cad.box(10, 10, 10)
let b = cad.translate(a, [5, 0, 0])
let out = cad.union(a, b)`,
  subtract: `let a = cad.box(10, 10, 10)
let b = cad.translate(a, [5, 0, 0])
let out = cad.subtract(a, b)`,
  intersect: `let a = cad.box(10, 10, 10)
let b = cad.translate(a, [5, 0, 0])
let out = cad.intersect(a, b)`,
  profile: `let out = ${PROFILE}`,
  extrude: `let p = ${PROFILE}
let out = cad.extrude(p, [0, 0, 4])`,
  revolve: `let p = ${PROFILE}
let out = cad.revolve(p, 6.283185307179586)`,
  mirror: `let a = cad.box(10, 10, 10)
let out = cad.mirror(a, { normal: [1, 0, 0], at: [0, 0, 0] })`,
  applyMatrix: `let a = cad.box(10, 10, 10)
let out = cad.applyMatrix(a, [[1,0,0,5],[0,1,0,0],[0,0,1,0],[0,0,0,1]])`,
  offset: `let p = ${PROFILE}
let out = cad.offset(p, -1)`,
  convexHull: `let a = cad.box(10, 10, 10)
let out = cad.convexHull(a)`,
  scale3d: `let a = cad.box(10, 10, 10)
let out = cad.scale3d(a, [2, 1, 1])`,
  rotate_euler: `let a = cad.box(10, 10, 10)
let out = cad.rotate_euler(a, [0, 0, 45])`,
  translate: `let a = cad.box(10, 10, 10)
let out = cad.translate(a, [5, 0, 0])`,
  polyhedron: `let out = cad.polyhedron([[0,0,0],[10,0,0],[0,10,0],[0,0,10]], [[0,1,2],[0,1,3],[0,2,3],[1,2,3]])`,
  hull: `let a = cad.box(10, 10, 10)
let b = cad.translate(a, [20, 0, 0])
let out = cad.hull(a, b)`,
  minkowski: `let a = cad.box(10, 10, 10)
let b = cad.sphere(2)
let out = cad.minkowski(a, b)`,
  torus: `let out = cad.torus(10, 2)`,
  wedge: `let out = cad.wedge(10, 5, 8)`,
  loft: `let a = ${PROFILE}
let b = cad.translate(a, [0, 0, 10])
let out = cad.loft(a, b)`,
}

async function run(name, code) {
  const rt = createRuntime(createNodePorts(), 'brep')
  try {
    const r = await rt.execute(code, { topology: 'auto' })
    const failed = r.failedAt
    const out = r.outputs instanceof Map ? r.outputs.get('out') : undefined
    const keys = r.outputs instanceof Map ? [...r.outputs.keys()].join(',') : ''
    if (failed) {
      log(`${name.padEnd(14)} FAIL   ${String(failed.message).slice(0, 130)}`)
    } else if (out !== undefined) {
      const info =
        out && typeof out === 'object'
          ? `verts=${out.positions ? out.positions.length / 3 : '?'} tris=${out.indices ? out.indices.length / 3 : '?'}`
          : String(out)
      log(`${name.padEnd(14)} OK     ${info}`)
    } else {
      log(`${name.padEnd(14)} NOOUT  keys=[${keys}]`)
    }
  } catch (e) {
    log(`${name.padEnd(14)} THROW  ${String(e.message ?? e).slice(0, 130)}`)
  } finally {
    rt.dispose()
  }
}

async function main() {
  log('=== 1. initOcctWasm (Host 装配前置) ===')
  const t0 = Date.now()
  await initOcctWasm()
  log(`ok (${Date.now() - t0} ms)`)

  log('')
  log('=== 2. 脚本面 op 执行矩阵（Host 已装配，mode=brep） ===')
  for (const [name, code] of Object.entries(cases)) await run(name, code)

  log('')
  log('=== 3. 体积测量（装配后是否仍 NaN；脚本面用 cad.volume） ===')
  for (const [name, expr, exact] of [
    ['box', 'cad.box(10, 10, 10)', 1000],
    ['sphere', 'cad.sphere(10)', (4 / 3) * Math.PI * 1000],
    ['cylinder', 'cad.cylinder(5, 10)', Math.PI * 25 * 10],
  ]) {
    const rt = createRuntime(createNodePorts(), 'brep')
    try {
      const r = await rt.execute(`let s = ${expr}\nlet out = cad.volume(s)`, { topology: 'auto' })
      const v = r.outputs instanceof Map ? r.outputs.get('out') : undefined
      const delta = typeof v === 'number' && Number.isFinite(v) ? ((v - exact) / exact) * 100 : NaN
      log(
        `${name.padEnd(10)} volume=${String(v).padEnd(22)} exact=${exact.toFixed(3)} delta=${Number.isNaN(delta) ? 'NaN' : delta.toFixed(4) + '%'}${r.failedAt ? '  ' + String(r.failedAt.message).slice(0, 90) : ''}`,
      )
    } catch (e) {
      log(`${name.padEnd(10)} THROW ${String(e.message ?? e).slice(0, 110)}`)
    } finally {
      rt.dispose()
    }
  }
}

main().catch((e) => {
  console.error('PROBE FAILED:', e)
  process.exit(1)
})
