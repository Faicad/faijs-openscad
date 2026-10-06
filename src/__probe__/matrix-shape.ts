/**
 * 语料实测：`multmatrix` 的矩阵构成分类（M2 前置调研）。
 *
 * 为什么必须先做这件事：OpenSCAD 的 `translate` / `rotate` / `scale` / `mirror`
 * 在 CSG dump 里**全部收敛成 `multmatrix`**（CSG 是已求值树，变换已被前端的
 * 变换矩阵折叠）。实测语料 17653 个节点里 `multmatrix` 有 4790 个，是最高频
 * 节点 —— 它能否映射，直接决定 v0 的诚实覆盖面，而不是一个边角情况。
 *
 * 而 faijs 的变换 op 没有「任意仿射矩阵」这个能力：
 *   - `cad.place(shape, { rotation: quat, position })` —— **刚性**（四元数只能
 *     表达 det=+1 的正交旋转 + 平移），平台面正式 op；
 *   - `cad.scale3d(shape, [x,y,z], { center })` —— 非等比缩放，属 `../3d_editor`
 *     消费面（手册 §4.4 标 🚫「不属 faijs 平台面」）；
 *   - **剪切（shear）没有任何落点**。
 *
 * 所以分类的实质是回答一个问题：语料里真实出现的矩阵，有多少落在
 * 「刚性」/「旋转+轴对齐缩放」/「含剪切」这三档里。含剪切的那部分如果非空，
 * emitter 就必须产出明确诊断（3xxx 保真码），而不是静默近似 —— 静默近似会让
 * 输出几何与 OpenSCAD 不一致，那正是本项目最不可接受的失败模式。
 *
 * 位于 `src/__probe__/`（被 `tsconfig.build.json` 排除），只服务测试与报告。
 */
import { readFileSync } from 'node:fs'
import { firstPositionalValue, walkCsg, type CsgNode } from '../csg/ast'
import { parseCsg } from '../csg/parser'
import { corpusFiles } from './corpus-scan'

/**
 * 矩阵元素的比较容差。
 *
 * ⚠️ 不能取 1e-9。CSG dump 里的矩阵元素是**截断到 6 位小数**的十进制字面量
 * （实测：`rotate([0,30,0])` 写出 `0.866025`、`0.5`，真值 √3/2 = 0.8660254037…）。
 * 于是 AᵀA 的对角元偏离 1 约 7e-7 —— 一个 1e-9 的「精确」容差会把**纯旋转
 * 全部误判成缩放**。本文件第一版正是如此：它报出「46.51% 是 scale-rotate」，
 * 而抽样打印显示那 2228 个矩阵清一色是 `0.866025 / 0.707107 / 0.939693` 这类
 * 旋转矩阵。取 1e-5 覆盖「6 位截断 × 3 项乘积」的最坏误差（≈3e-6）仍有余量，
 * 同时远小于语料里真实剪切的量级。
 */
const EPS = 1e-5

/** 行列式判退化用的容差：与正交性检验不同，这里要的是「真的压扁了」。 */
const DET_EPS = 1e-9

export type MatrixShape =
  | 'identity'
  | 'translation'
  | 'rigid'
  | 'mirror'
  | 'scale-rotate'
  | 'scale-mirror'
  | 'shear'
  | 'degenerate'
  | 'malformed'

export interface MatrixInfo {
  /** 已取出的 4×4 行主序矩阵（3×3 / 4×3 输入补齐为 4×4）。 */
  readonly matrix: number[][]
  readonly shape: MatrixShape
  /** 上左 3×3 的行列式；degenerate 时接近 0。 */
  readonly det: number
  /** 平移分量 [x,y,z]。 */
  readonly translation: readonly [number, number, number]
  /** 原文是否带子节点（`multmatrix(...) { ... }`）。 */
  readonly hasChildren: boolean
  /** 等比缩放因子（仅 scale-rotate / scale-mirror 且三轴等比时给出）。 */
  readonly uniformScale?: number
  readonly origin: string
}

/** 把 CSG 值里的数字行取出来；非 number 元素一律视为畸形。 */
function rowsFrom(value: ReturnType<typeof firstPositionalValue>): number[][] | undefined {
  if (!value || value.kind !== 'vector') return undefined
  const rows: number[][] = []
  for (const row of value.items) {
    if (row.kind !== 'vector') return undefined
    const cells: number[] = []
    for (const cell of row.items) {
      if (cell.kind !== 'number') return undefined
      cells.push(cell.value)
    }
    rows.push(cells)
  }
  return rows
}

/** 归一化为 4×4；OpenSCAD 也接受 3×3 与 4×3。 */
function toMatrix4(rows: readonly number[][]): number[][] | undefined {
  const shape = `${rows.length}x${rows[0]?.length ?? 0}`
  const uniform = rows.every((r) => r.length === rows[0].length)
  if (!uniform) return undefined
  if (shape === '4x4') return rows.map((r) => [...r])
  if (shape === '4x3') {
    return [0, 1, 2, 3].map((i) => (i === 3 ? [0, 0, 0, 1] : [...rows[i], 0]))
  }
  if (shape === '3x3') {
    return [
      [rows[0][0], rows[0][1], rows[0][2], 0],
      [rows[1][0], rows[1][1], rows[1][2], 0],
      [rows[2][0], rows[2][1], rows[2][2], 0],
      [0, 0, 0, 1],
    ]
  }
  return undefined
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS
}

/**
 * 分类一个 4×4 仿射矩阵。
 *
 * 判据（A = 上左 3×3，t = 第 4 列）：
 *   - A ≈ I           → identity / translation
 *   - AᵀA ≈ I         → 正交：det>0 是刚体旋转（rigid），det<0 含镜像
 *   - AᵀA 对角且 ≠ I   → 旋转 × 轴对齐缩放（可还原，无剪切）
 *   - AᵀA 非对角      → 剪切，**faijs 无落点**
 *   - det ≈ 0         → 退化（压扁），几何上不再是实体
 */
export function classifyMatrix(m: readonly number[][]): {
  shape: MatrixShape
  det: number
  translation: [number, number, number]
  /**
   * 当 AᵀA = s²·I（三轴等比的纯缩放，无旋转或旋转任意）时给出 s。
   * `cad.scale(shape, s)` 接标量因子；非等比才需要 `scale3d` 的向量形态。
   */
  uniformScale?: number
} {
  const A = [
    [m[0][0], m[0][1], m[0][2]],
    [m[1][0], m[1][1], m[1][2]],
    [m[2][0], m[2][1], m[2][2]],
  ]
  const t: [number, number, number] = [m[0][3], m[1][3], m[2][3]]

  // 底行必须是 [0,0,0,1]，否则不是仿射矩阵。
  const affine = close(m[3][0], 0) && close(m[3][1], 0) && close(m[3][2], 0) && close(m[3][3], 1)
  if (!affine) {
    return { shape: 'malformed', det: NaN, translation: t }
  }

  const det =
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])

  if (Math.abs(det) <= DET_EPS) return { shape: 'degenerate', det, translation: t }

  // G = AᵀA。正交 ⇔ G ≈ I；无剪切 ⇔ G 非对角元全为 0；等比 ⇔ G ≈ s²·I。
  const G = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => A[0][i] * A[0][j] + A[1][i] * A[1][j] + A[2][i] * A[2][j]),
  )
  const orthogonal = G.every((r, i) => r.every((v, j) => close(v, i === j ? 1 : 0)))
  const diagonalUpToShear = close(G[0][1], 0) && close(G[0][2], 0) && close(G[1][2], 0)
  const uniformSq = G[0][0]
  const isUniform =
    diagonalUpToShear && close(G[1][1], uniformSq) && close(G[2][2], uniformSq) && uniformSq > 0
  const uniformScale = isUniform ? Math.sqrt(uniformSq) : undefined

  const isIdentity = A.every((r, i) => r.every((v, j) => close(v, i === j ? 1 : 0)))
  if (isIdentity) {
    const noTranslation = t.every((v) => close(v, 0))
    return { shape: noTranslation ? 'identity' : 'translation', det, translation: t }
  }

  if (orthogonal) {
    return { shape: det > 0 ? 'rigid' : 'mirror', det, translation: t }
  }
  if (diagonalUpToShear) {
    const base = { shape: (det > 0 ? 'scale-rotate' : 'scale-mirror') as MatrixShape, det, translation: t }
    return uniformScale === undefined ? base : { ...base, uniformScale }
  }
  return { shape: 'shear', det, translation: t }
}

/** 扫全部语料，收集每个 `multmatrix` 节点的矩阵分类。 */
export function scanMatrices(root: string): MatrixInfo[] {
  const out: MatrixInfo[] = []
  for (const file of corpusFiles(root)) {
    const text = readFileSync(file, 'utf8')
    const { document } = parseCsg(text)
    for (const node of document.nodes) {
      walkCsg(node, (n: CsgNode) => {
        if (n.name !== 'multmatrix') return
        const rows = rowsFrom(firstPositionalValue(n))
        const m = rows && toMatrix4(rows)
        if (!m) {
          out.push({
            matrix: [],
            shape: 'malformed',
            det: NaN,
            translation: [0, 0, 0],
            hasChildren: n.children.length > 0,
            origin: file,
          })
          return
        }
        const { shape, det, translation, uniformScale } = classifyMatrix(m)
        out.push({
          matrix: m,
          shape,
          det,
          translation,
          ...(uniformScale === undefined ? {} : { uniformScale }),
          hasChildren: n.children.length > 0,
          origin: file,
        })
      })
    }
  }
  return out
}

/** 分类直方图。 */
export function matrixHistogram(infos: readonly MatrixInfo[]): Map<MatrixShape, number> {
  const out = new Map<MatrixShape, number>()
  for (const info of infos) out.set(info.shape, (out.get(info.shape) ?? 0) + 1)
  return out
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('__probe__/matrix-shape.ts')) {
  const root = process.env.OPENSCAD_SRC
  if (!root) {
    console.error('OPENSCAD_SRC 未设置')
    process.exit(1)
  }
  const infos = scanMatrices(root)
  const hist = [...matrixHistogram(infos).entries()].sort((a, b) => b[1] - a[1])
  const total = infos.length
  console.log(`multmatrix 总数: ${total}`)
  for (const [shape, n] of hist) {
    console.log(`  ${shape.padEnd(14)} ${String(n).padStart(5)}  ${((n / total) * 100).toFixed(2)}%`)
  }
  const withChildren = infos.filter((i) => i.hasChildren).length
  console.log(`  带子节点 ${withChildren} / 无子节点 ${total - withChildren}`)
  const weird = infos.filter((i) => i.shape === 'shear' || i.shape === 'degenerate' || i.shape === 'malformed')
  console.log(`\n剪切/退化/畸形 详情（最多 25 条）:`)
  for (const info of weird.slice(0, 25)) {
    const short = info.origin.replace(/\\/g, '/').split('/').slice(-1)[0]
    const t = info.translation.map((v) => Number(v.toFixed(6))).join(',')
    console.log(`  ${info.shape.padEnd(11)} det=${info.det.toFixed(6).padStart(10)} t=[${t}] ${short}`)
  }

  // 抽样复核：分类器必须能被人工读懂，否则「46.51% 是 scale-rotate」这类
  // 结论只是数字。默认打 8 个 scale-rotate 与 3 个 rigid 的原始矩阵。
  const sample = (shape: MatrixShape, n: number): void => {
    const picked = infos.filter((i) => i.shape === shape).slice(0, n)
    if (picked.length === 0) return
    console.log(`\n${shape} 抽样 ${picked.length} 条:`)
    for (const info of picked) {
      const short = info.origin.replace(/\\/g, '/').split('/').slice(-1)[0]
      console.log(`  [${short}]`)
      for (const row of info.matrix) console.log(`    [${row.map((v) => String(v).padStart(10)).join(', ')}]`)
    }
  }
  sample('scale-rotate', 8)
  sample('rigid', 3)

  // 「等比 vs 非等比」决定能否用标量 `cad.scale(shape, s)`；非等比才需要向量形态。
  const scaled = infos.filter((i) => i.shape === 'scale-rotate' || i.shape === 'scale-mirror')
  const uniform = scaled.filter((i) => i.uniformScale !== undefined)
  console.log(`\n缩放类 ${scaled.length} 个：等比 ${uniform.length}，非等比 ${scaled.length - uniform.length}`)
  if (uniform.length > 0) {
    const factors = [...new Set(uniform.map((i) => i.uniformScale!.toFixed(6)))].sort()
    console.log(`  等比因子取值: ${factors.join(', ')}`)
  }
  const nonUniform = scaled.filter((i) => i.uniformScale === undefined)
  for (const info of nonUniform.slice(0, 6)) {
    const short = info.origin.replace(/\\/g, '/').split('/').slice(-1)[0]
    const rows = info.matrix.slice(0, 3).map((r) => `[${r.slice(0, 3).map((v) => v.toFixed(4)).join(',')}]`)
    console.log(`  非等比 ${short} ${rows.join(' ')}`)
  }

  console.log(`\nmirror 明细 ${infos.filter((i) => i.shape === 'mirror').length} 条:`)
  for (const info of infos.filter((i) => i.shape === 'mirror')) {
    const short = info.origin.replace(/\\/g, '/').split('/').slice(-1)[0]
    const rows = info.matrix.slice(0, 3).map((r) => `[${r.map((v) => v.toFixed(4)).join(',')}]`)
    console.log(`  ${short} ${rows.join(' ')}`)
  }
}
