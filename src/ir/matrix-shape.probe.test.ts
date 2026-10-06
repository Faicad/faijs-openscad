/**
 * PROBE（permanent，M2 前置）：`multmatrix` 的矩阵构成分类。
 *
 * 为什么这条必须长期存在：OpenSCAD 的 `translate` / `rotate` / `scale` / `mirror`
 * 在 CSG dump 里**全部收敛成 `multmatrix`**（CSG 是已求值树）。实测它是语料里
 * 最高频的节点（4790 / 17653），而 faijs 没有「任意仿射矩阵」这个 op。所以
 * 「v0 能覆盖多少」不是靠推测，只能靠把语料里真实出现的矩阵逐个分类。
 *
 * 这条测试守住两件一旦丢失就再也发现不了的东西：
 *
 *  1. **分类口径本身**。`EPS = 1e-5` 不是随手取的：CSG dump 把矩阵元素
 *     **截断到 6 位小数**（`rotate([0,30,0])` 写出 `0.866025`，真值是
 *     √3/2 = 0.8660254037…）。本文件第一版用 1e-9 的「精确」容差，结果把
 *     2228 个**纯旋转**判成 `scale-rotate`，还印出了一份看起来很合理的
 *     「46.51% 是缩放」直方图。是抽样打印原始矩阵才拆穿的。最后一条断言
 *     就是钉住这一点：容差收紧后 `rigid` 会从 2406 塌到 188。
 *  2. **v0 覆盖面**。刚性变换（`cad.place` 一个平台面 op 就能表达）占
 *     98.75%；真正无落点的只有 1 个剪切 + 5 个退化。这个比例是 v0 承诺
 *     的依据，掉了就说明语料或分类器漂了。
 *
 * 需要 `OPENSCAD_SRC`；未设置时整组跳过而不是假装通过。
 */
import { describe, expect, it } from 'vitest'
import { corpusRoot, hasCorpus } from '../__probe__/env'
import { matrixHistogram, scanMatrices, type MatrixInfo, type MatrixShape } from '../__probe__/matrix-shape'

const root = corpusRoot()
const infos = root === undefined ? [] : scanMatrices(root)
const hist = matrixHistogram(infos)
const countOf = (shape: MatrixShape): number => hist.get(shape) ?? 0

/** 上左 3×3 是否为「每行每列恰好一个 ±1」的轴对齐矩阵。 */
function isAxisAligned(info: MatrixInfo): boolean {
  const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => info.matrix[i][j]))
  const rowOk = A.every((row) => row.filter((v) => Math.abs(v) > 0.5).length === 1)
  const colOk = [0, 1, 2].every((j) => A.filter((row) => Math.abs(row[j]) > 0.5).length === 1)
  const unitOk = A.every((row) => row.every((v) => Math.abs(v) < 1e-9 || Math.abs(Math.abs(v) - 1) < 1e-9))
  return rowOk && colOk && unitOk
}

const basename = (p: string): string => p.replace(/\\/g, '/').split('/').slice(-1)[0]

describe.skipIf(!hasCorpus())('probe: multmatrix 矩阵构成（需 OPENSCAD_SRC）', () => {
  it('语料里共 4790 个 multmatrix —— 它是最高频节点，不是边角情况', () => {
    expect(infos).toHaveLength(4790)
  })

  it('分类直方图稳定（钉住 v0 覆盖面）', () => {
    expect(hist.get('rigid')).toBe(2406)
    expect(hist.get('translation')).toBe(2215)
    expect(hist.get('identity')).toBe(109)
    expect(hist.get('scale-rotate')).toBe(41)
    expect(hist.get('mirror')).toBe(13)
    expect(hist.get('degenerate')).toBe(5)
    expect(hist.get('shear')).toBe(1)
    expect(hist.get('malformed')).toBeUndefined()
  })

  it('刚性变换占 98.75% —— cad.place 一个平台面 op 即可表达', () => {
    const rigid = countOf('rigid') + countOf('translation') + countOf('identity')
    expect(rigid).toBe(4730)
    expect(rigid / infos.length).toBeGreaterThan(0.987)
  })

  it('容差不能退回 1e-9：dump 的矩阵元素被截断到 6 位小数', () => {
    // 直接验证「截断」这个前提本身，而不是只验证结论。
    // rotate([0,30,0]) 的 cos 分量在 dump 里写作 0.866025，真值 √3/2。
    const truncated = 0.866025
    const truth = Math.sqrt(3) / 2
    expect(Math.abs(truncated - truth)).toBeGreaterThan(1e-9) // 1e-9 容差必然失败
    expect(Math.abs(truncated - truth)).toBeLessThan(1e-6) // 1e-5 容差有余量
    // 结论侧：2406 个 rigid 就是「容差正确」的证据；用 1e-9 时它只剩 188。
    expect(countOf('rigid')).toBeGreaterThan(2000)
  })

  it('13 个镜像全部轴对齐 —— cad.mirror({ normal }) 够用，不需要任意平面', () => {
    const mirrors = infos.filter((i) => i.shape === 'mirror')
    expect(mirrors).toHaveLength(13)
    expect(mirrors.every(isAxisAligned)).toBe(true)
    expect(mirrors.every((m) => m.det < 0)).toBe(true)
  })

  it('缩放类 41 个：等比 18 / 非等比 23 —— 非等比没有平台面落点', () => {
    const scaled = infos.filter((i) => i.shape === 'scale-rotate' || i.shape === 'scale-mirror')
    expect(scaled).toHaveLength(41)
    expect(scaled.filter((i) => i.uniformScale !== undefined)).toHaveLength(18)
  })

  it('无落点的只有 6 个节点：1 个剪切 + 5 个退化，且能指名到文件', () => {
    const shear = infos.filter((i) => i.shape === 'shear')
    expect(shear).toHaveLength(1)
    expect(basename(shear[0].origin)).toBe('transform-tests-expected.csg')
    expect(shear[0].det).toBeCloseTo(0.312, 9)

    const degenerate = infos.filter((i) => i.shape === 'degenerate')
    expect(degenerate).toHaveLength(5)
    expect([...new Set(degenerate.map((d) => basename(d.origin)))].sort()).toEqual([
      'scale2D-tests-expected.csg',
      'scale3D-tests-expected.csg',
    ])
  })

  it('几乎全部带子节点 —— multmatrix 包住子树，emitter 必须展平而不是内联', () => {
    const withChildren = infos.filter((i) => i.hasChildren).length
    expect(withChildren).toBe(4773)
    expect(infos.length - withChildren).toBe(17)
  })
})
