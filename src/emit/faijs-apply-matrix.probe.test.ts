/**
 * PROBE（permanent，M2）：`cad.applyMatrix` 是不是 `multmatrix` 的直接落点。
 *
 * 起因是一次**差点做错的架构决定**。最初读 `docs/ops-api-inventory.md` 的
 * §3–§7 逐 op 手册，里面没有 `applyMatrix`，于是得出结论「faijs 没有任意仿射
 * 变换能力」，并准备设计一套「矩阵 → 四元数 + 缩放」的分解器，把 4790 个
 * `multmatrix` 拆成 `place` / `scale3d` / `mirror` 的组合，还要为剪切写降级诊断。
 *
 * 那个结论是错的。权威是 `dist/lang/symbol-table.generated.js`（脚本面 95 op 的
 * 唯一真源，`check()` 就用它），而手册**只覆盖了其中一部分**。`applyMatrix`
 * 在符号表里，源码注释更直接写着 "Matrix types for applyMatrix (OpenSCAD
 * multmatrix equivalent)"，签名是行主序 4×4 + 底行 `[0,0,0,1]` —— 与 OpenSCAD
 * `multmatrix(m)` 的参数形状**逐字一致**。
 *
 * 教训：判断「某个 op 存不存在」只能读符号表；手册是给人看的，会滞后。
 *
 * 本探针钉住三件事：
 *   1. 脚本面 `cad.applyMatrix` 真的可执行（不是只在符号表里挂名）；
 *   2. 矩阵字面量**写裸数字即可**，不需要 `* MM` —— 因为矩阵里旋转分量是
 *      无量纲的，逐元素加单位在语义上就是错的，必须实测而非推测；
 *   3. 奇异矩阵（OpenSCAD 里 `scale([1,0,1])` 的产物）会失败而不是静默产坏几何。
 *
 * 需要 `FAIJS_PROBE_RUNTIME=1`（要装 OCCT wasm）；未开启时整组跳过。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { faijsInstalled, faijsRuntimeEnabled } from '../__probe__/env'

const runtimeEnabled = faijsInstalled() && faijsRuntimeEnabled()

interface ExecResult {
  readonly failedAt?: { message: string }
  readonly outputs: Map<string, unknown>
}

describe.skipIf(!runtimeEnabled)('probe: cad.applyMatrix（需 FAIJS_PROBE_RUNTIME=1）', () => {
  let execute: (code: string) => Promise<ExecResult>
  let volume: (s: unknown) => Promise<number>

  beforeAll(async () => {
    const { createRuntime, createNodePorts, initOcctWasm } = await import('@faicad/faijs/node')
    const face = (await import('@faicad/faijs')) as unknown as { volume: (s: unknown) => Promise<number> }
    volume = face.volume
    await initOcctWasm()
    const rt = createRuntime(createNodePorts(), 'brep')
    execute = async (code: string): Promise<ExecResult> =>
      (await rt.execute(code, { topology: 'auto' })) as unknown as ExecResult
  }, 180_000)

  it('恒等矩阵可执行，形状不变（20³ = 8000）', async () => {
    const r = await execute(`
      let a = cad.box(20, 20, 20)
      let m = cad.applyMatrix(a, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
    `)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await volume(r.outputs.get('m'))).toBeCloseTo(8000, 6)
  })

  it('非平凡平移矩阵可执行 —— 而且矩阵写裸数字就够（不加 * MM）', async () => {
    // 平移不改变体积，所以体积不是这里的判据；真正要证明的是「能跑」，
    // 即矩阵字面量不需要 `10 * MM` 这种单位后缀。若 D8 R2 适用于矩阵元素，
    // 这条会以 E_ARGS 之类的错误失败。
    const r = await execute(`
      let a = cad.box(20, 20, 20)
      let m = cad.applyMatrix(a, [[1, 0, 0, 10], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
    `)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await volume(r.outputs.get('m'))).toBeCloseTo(8000, 6)
  })

  it('剪切矩阵可执行且保体积 —— 语料里那个 det=0.312 的 shear 有落点', async () => {
    // 实测语料（src/__probe__/matrix-shape.ts）：4790 个 multmatrix 里只有 1 个
    // 剪切（transform-tests-expected.csg，det=0.312）。剪切保持体积。
    const r = await execute(`
      let a = cad.box(20, 20, 20)
      let m = cad.applyMatrix(a, [[1, 0.5, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
    `)
    expect(r.failedAt?.message).toBeUndefined()
    // 剪切行列式为 1，体积不变。
    expect(await volume(r.outputs.get('m'))).toBeCloseTo(8000, 6)
  })

  it('等比缩放 diag(2,2,2) 体积 ×8（64000）', async () => {
    const r = await execute(`
      let a = cad.box(20, 20, 20)
      let m = cad.applyMatrix(a, [[2, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]])
    `)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await volume(r.outputs.get('m'))).toBeCloseTo(64000, 6)
  })

  it('非等比缩放 diag(0.7, 1.3, 1) 有落点 —— 不需要 scale3d（3d_editor 面）', async () => {
    // 语料里的非等比缩放形如 diag(0.7,1.3,1)，体积 ×0.91。
    const r = await execute(`
      let a = cad.box(20, 20, 20)
      let m = cad.applyMatrix(a, [[0.7, 0, 0, 0], [0, 1.3, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
    `)
    expect(r.failedAt?.message).toBeUndefined()
    expect(await volume(r.outputs.get('m'))).toBeCloseTo(8000 * 0.7 * 1.3, 6)
  })

  it('镜像矩阵可执行 —— det<0 也走 applyMatrix，不必用 cad.mirror', async () => {
    const r = await execute(`
      let a = cad.box(20, 20, 20)
      let m = cad.applyMatrix(a, [[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
    `)
    expect(r.failedAt?.message).toBeUndefined()
    // 镜像改变手性但不改变体积。
    expect(await volume(r.outputs.get('m'))).toBeCloseTo(8000, 6)
  })

  it('奇异矩阵失败（不静默产出坏几何）—— 这才是 v0 真正的无落点', async () => {
    // OpenSCAD 的 scale([1,0,1]) 会 dump 出 det=0 的矩阵（语料 5 个，
    // 集中在 scale2D-tests / scale3D-tests）。源码 topologyFns.ts 明确拒绝：
    // "singular matrix (determinant ≈0). Cannot apply a non-invertible transform."
    const r = await execute(`
      let a = cad.box(20, 20, 20)
      let m = cad.applyMatrix(a, [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
    `)
    expect(r.failedAt?.message).toBeDefined()
  })
})
