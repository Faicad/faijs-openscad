/**
 * probe-faijs-ts-face.mjs — ① TS 兼容面探针（库作者真正该用的面）
 *
 * 《ops-api-inventory》§1：faijs 有三个 API 面——
 *   ① TS 兼容面：第三方库（TS 代码）用；brepjs 原样：位置参数 + `Result` 原生
 *   ② cad 脚本面：`.fai.js` 用；`cad.*` 对象参数；语句边界 unwrap Result
 *   ③ 库边界面：registerLib 注册的库导出函数
 *
 * 此前我用 ② 的 `cad` 命名空间对象在 TS 里裸调，既没有 Host 装配、也用错了面。
 * 本探针改为：Host 装配后，直接调用 ① 的扁平 TS 函数（box / union / volume ...）。
 *
 * 保留为长期探针。用法：node tests/probe-faijs-ts-face.mjs
 */
import * as F from '@faicad/faijs'
import { createRuntime, createNodePorts, initOcctWasm } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs/brep/engine/adapters/occt'
import { getBrepEngine, getActiveBrepEngineId } from '@faicad/faijs/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION } from '@faicad/faijs/runtime-state'

/**
 * 库作者装配 —— 裸调 ① 面（不经 runtime.execute）必须手工完成三件事：
 *   1. initOcctWasm()               —— 初始化 wasm 内核
 *   2. registerOcctBrepEngine()     —— 把 occt 适配器注册进引擎注册表
 *   3. configureBackends({...})     —— 把 kernel/primitives 与 config 塞进全局
 *
 * ⚠️ 三个坑（都是本探针实测踩出来的）：
 *  - 只 createRuntime 不 registerOcctBrepEngine → `BREP engine API not available`。
 *    （脚本面走 runtime.execute 时 brepChain 会带 kernel，裸调不会。）
 *  - configureBackends 漏 config.brepCapabilities → 布尔报
 *    `E_BREP_UNSUPPORTED ... (brepEngineId=<none>)`。runtime.ts:577 那里是 **getter**，
 *    照抄 packages/sketch/src/faces-plane.test.ts:35 的 `config:{mode:'brep'}` 会漏掉它，
 *    因为 sketch 只用 directEdit / 不需要 fuse 能力。
 *  - 手册 §2.8：库作者只写模块、**不负责注册**——但库自己的测试必须装配 Host。
 *
 * 保留为长期探针。用法：node tests/probe-faijs-ts-face.mjs
 */
async function assembleHost() {
  await initOcctWasm()
  await registerOcctBrepEngine()
  const eng = await getBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: {
      mode: 'brep',
      brepEngineId: getActiveBrepEngineId(),
      brepCapabilities: eng.capabilities,
    },
    kernel: { brep: eng.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
    cad: undefined,
  })
  return eng
}

const log = (...a) => console.log(...a)

async function main() {
  const eng = await assembleHost()
  log(`host assembled: engine=${eng.id} evolution=${eng.capabilities.evolution.length} methods=${eng.capabilities.methods.length}`)

  log('=== 1. ① TS 兼容面：关键 op 是否存在 ===')
  const names = [
    'box', 'sphere', 'cylinder', 'cone', 'torus', 'wedge', 'ellipsoid',
    'union', 'subtract', 'intersect', 'fuse', 'cut', 'commonBrep',
    'translate', 'rotate', 'rotate_euler', 'scale', 'scale3d', 'mirror', 'applyMatrix',
    'profile', 'extrude', 'revolve', 'loft', 'sweep', 'polygon', 'polyhedron',
    'offset', 'convexHull', 'compound', 'structCompound', 'sew', 'sewAndSolidify',
    'shell', 'thicken', 'sectionByPlane', 'split', 'splitByPlane',
    'volume', 'measureVolume', 'area', 'measureArea', 'length', 'centerOfMass',
    'bounds3D', 'bboxMin', 'bboxMax', 'getFaces', 'getEdges', 'getSolids',
    'heal', 'autoHeal', 'fixShape', 'ok', 'err', 'isOk', 'isErr',
  ]
  const present = []
  const absent = []
  for (const n of names) (typeof F[n] === 'function' ? present : absent).push(n)
  log(`present(${present.length}): ${present.join(' ')}`)
  log('')
  log(`absent(${absent.length}): ${absent.join(' ')}`)

  log('')
  log('=== 2. ① 面直接调用：box / union / volume ===')
  // ⚠️ 重要：defineOp 包装的函数直接返回 `Promise<Shape>`（不是 Result！）。
  // 用 `F.isErr(shape)` 判定会误报——isErr 的判据是 `ok === false`，
  // 而 Shape 上根本没有 `ok` 字段。Result 只出现在库作者自己返回的值上。
  const isShapeLike = (v) => v !== null && typeof v === 'object' && 'positions' in v && 'indices' in v
  const describe = (v) =>
    isShapeLike(v)
      ? `Shape verts=${v.positions.length / 3} tris=${v.indices.length / 3} kind=${v.kind ?? '?'}`
      : JSON.stringify(v)?.slice(0, 140)

  try {
    const a = await F.box(10, 10, 10)
    log('box           ->', describe(a))
    const b = await F.translate(a, [5, 0, 0])
    log('translate     ->', describe(b))
    const u = await F.union(a, b)
    log('union         ->', describe(u))
    const v = await F.volume(u)
    log('volume(union) ->', JSON.stringify(isShapeLike(v) ? v : v))
  } catch (e) {
    log('THROW:', String(e.message ?? e).slice(0, 200))
  }

  log('')
  log('=== 3. 体积精度（① 面） ===')
  for (const [name, make, exact] of [
    ['box', () => F.box(10, 10, 10), 1000],
    ['sphere', () => F.sphere(10), (4 / 3) * Math.PI * 1000],
    ['cylinder', () => F.cylinder(5, 10), Math.PI * 25 * 10],
  ]) {
    try {
      const s = await make()
      if (!isShapeLike(s)) { log(`${name.padEnd(9)} make FAIL ${describe(s)}`); continue }
      const num = await F.volume(s)
      const delta = Number.isFinite(num) ? (((num - exact) / exact) * 100).toFixed(4) + '%' : 'NaN/undefined'
      log(`${name.padEnd(9)} volume=${String(num).padEnd(22)} exact=${exact.toFixed(3).padEnd(12)} delta=${delta}`)
    } catch (e) {
      log(`${name.padEnd(9)} THROW ${String(e.message ?? e).slice(0, 120)}`)
    }
  }
}

main().catch((e) => {
  console.error('PROBE FAILED:', e)
  process.exit(1)
})
