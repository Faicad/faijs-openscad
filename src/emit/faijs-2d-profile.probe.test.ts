/**
 * PROBE（permanent，M2）：2D 图元的落点 —— `cad.profile` → `cad.extrude`。
 *
 * 这是 M2 唯一的**真未知数**，其余映射都已闭合。理由：`square` 是语料里
 * 第三高频节点（2454 个），而 faijs 的脚本面**没有**矩形/圆形构造器 ——
 * 2D 的唯一入口是 `cad.profile({ contours: [{ segments: [...] }] })`，把图元
 * 展开成线段表。若这条路走不通，P0 里 `square`/`circle`/`polygon`/
 * `linear_extrude` 四个节点全部落不了地，M2 的覆盖面会从 97% 掉到 60% 出头。
 *
 * 所以先证明三件事，再写 emitter：
 *   1. 4 条 line 围出的矩形能构面，`area` 精确等于 100；
 *   2. 该面能喂给 `cad.extrude`，体积精确等于 1000（10×10×10）；
 *   3. 圆用**两段 arc** 表达可构面（源码注释：整圆 sweep≈2π 拆成两段弧），
 *      面积≈πr² —— 这同时确认了「弧角用弧度」这条单位例外。
 *
 * 第 3 条还带出一个保真结论：OpenSCAD 的 `circle(r, $fn=64)` 产生的是 **64 边形**
 * （真实棱面），而 profile 的 arc 是**真圆**。v0 取 analytic 口径（真圆 + OSC3201），
 * 与 `ir/faceting.probe.test.ts` 的实测一致。
 *
 * 需要 `FAIJS_PROBE_RUNTIME=1`；未开启时整组跳过。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { faijsInstalled, faijsRuntimeEnabled } from '../__probe__/env'

const runtimeEnabled = faijsInstalled() && faijsRuntimeEnabled()

interface ExecResult {
  readonly failedAt?: { message: string }
  readonly outputs: Map<string, unknown>
}

/** 语料里 square 的真实 dump 形态：size 向量 + center 布尔。 */
const SQUARE_10x10 = `
  let sq = cad.profile({ contours: [{ segments: [
    { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
    { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
    { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 }
  ] }] })
`

describe.skipIf(!runtimeEnabled)('probe: cad.profile 2D 落点（需 FAIJS_PROBE_RUNTIME=1）', () => {
  let execute: (code: string) => Promise<ExecResult>
  let volume: (s: unknown) => Promise<number>
  let area: (s: unknown) => Promise<number>

  beforeAll(async () => {
    const { createRuntime, createNodePorts, initOcctWasm } = await import('@faicad/faijs/node')
    const face = (await import('@faicad/faijs')) as unknown as {
      volume: (s: unknown) => Promise<number>
      area: (s: unknown) => Promise<number>
    }
    volume = face.volume
    area = face.area
    await initOcctWasm()
    const rt = createRuntime(createNodePorts(), 'brep')
    execute = async (code: string): Promise<ExecResult> =>
      (await rt.execute(code, { topology: 'auto' })) as unknown as ExecResult
  }, 180_000)

  it('4 条 line 围成的矩形能构面，面积精确等于 100', async () => {
    const r = await execute(SQUARE_10x10)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await area(r.outputs.get('sq'))).toBeCloseTo(100, 6)
  })

  it('profile 产物能喂给 extrude，体积精确等于 1000（10×10×10）', async () => {
    // 这一条是整套 emitter 的地基：square + linear_extrude 全靠它。
    const r = await execute(`
      ${SQUARE_10x10}
      let box = cad.extrude(sq, { length: 10 })
    `)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await volume(r.outputs.get('box'))).toBeCloseTo(1000, 6)
  })

  it('圆：两段 arc（弧度角）可构面，面积≈πr² —— 确认单位例外 + 字面量约束', async () => {
    // ⛔ 角度必须写**字面量**：op 实参里的 `Math` 会被**前置静态校验**拦下
    // （`ParseError: unknown identifier "Math" in expression`）。
    // 注意措辞：**不是**求值器不支持 —— `Math` 属于 S4_SAFE_GLOBALS 的免 import
    // 全局，vm（`new Function`）与 interp 两个执行后端都能求值；拦点在
    // metadata-extractor.collectExprIdentifiers 的标识符白名单漏了 S4。
    // 分层取证见 `emit/faijs-script-globals.probe.test.ts`。
    // emitter 因此输出算好的数值 —— 这正是 emit/units.ts 存在的理由。
    const r = await execute(`
      let c = cad.profile({ contours: [{ segments: [
        { kind: 'arc', cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: 3.141592653589793, ccw: true, x1: 10, y1: 0, x2: -10, y2: 0 },
        { kind: 'arc', cx: 0, cy: 0, radius: 10, startAngle: 3.141592653589793, endAngle: 6.283185307179586, ccw: true, x1: -10, y1: 0, x2: 10, y2: 0 }
      ] }] })
    `)
    expect(r.failedAt?.message).toBeUndefined()
    // analytic：真圆的面积，不是 64 边形的面积（64 边形约 314.03）。
    expect(await area(r.outputs.get('c'))).toBeCloseTo(Math.PI * 100, 4)
  })

  it('圆拉伸后体积≈πr²h —— circle + linear_extrude 也成立', async () => {
    const r = await execute(`
      let c = cad.profile({ contours: [{ segments: [
        { kind: 'arc', cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: 3.141592653589793, ccw: true, x1: 10, y1: 0, x2: -10, y2: 0 },
        { kind: 'arc', cx: 0, cy: 0, radius: 10, startAngle: 3.141592653589793, endAngle: 6.283185307179586, ccw: true, x1: -10, y1: 0, x2: 10, y2: 0 }
      ] }] })
      let cyl = cad.extrude(c, { length: 5 })
    `)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await volume(r.outputs.get('cyl'))).toBeCloseTo(Math.PI * 100 * 5, 3)
  })

  it('多环（外环 + 内环）= 带孔的 profile —— polygon(paths) 的落点', async () => {
    // profile.ts 的环语义：嵌套 = 孔，不相交 = 独立岛。面积 = 100 - 16 = 84。
    const r = await execute(`
      let ring = cad.profile({ contours: [
        { segments: [
          { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
          { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
          { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
          { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 }
        ] },
        { segments: [
          { kind: 'line', x1: 2, y1: 2, x2: 6, y2: 2 },
          { kind: 'line', x1: 6, y1: 2, x2: 6, y2: 6 },
          { kind: 'line', x1: 6, y1: 6, x2: 2, y2: 6 },
          { kind: 'line', x1: 2, y1: 6, x2: 2, y2: 2 }
        ] }
      ] })
    `)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await area(r.outputs.get('ring'))).toBeCloseTo(100 - 16, 6)
  })

  it('setColor / setOpacity 是实例方法（color 节点的落点）', async () => {
    // 判据是「语句执行不失败 + 形状仍然有效」，**不是** outputs 里有绑定：
    // outputs 只登记 `cad.*` 调用的产物，方法调用的返回值不进 outputs
    // （第一版断言 `outputs.get('got')` 因此拿到 undefined）。
    const r = await execute(`
      ${SQUARE_10x10}
      sq.setColor('#e53935')
      sq.setOpacity(0.5)
    `)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await area(r.outputs.get('sq'))).toBeCloseTo(100, 6)
  })

  it('setColor 接受 [r,g,b] 数组形态（OpenSCAD color 的 RGBA 向量）', async () => {
    const r = await execute(`
      ${SQUARE_10x10}
      sq.setColor([0.9, 0.2, 0.2])
      sq.setOpacity(0.4)
    `)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await area(r.outputs.get('sq'))).toBeCloseTo(100, 6)
  })
})
