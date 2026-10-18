/**
 * K14+: OpenSCAD 兼容的 faceted 基础体（sphere / cylinder / cone）。
 *
 * 背景（2026-10-18）：faijs 的 `cad.sphere/cylinder/cone` 在 brep 模式下产出
 * **光滑** BREP（OCCT 原生 makeSphere 等），导出时对整张曲面用全局 angularDeflection
 * 重新三角化，给出的三角化密度与 OpenSCAD 的「分段数」语义不符（球多一倍纬度分辨率），
 * 导致与 OpenSCAD 参考 STL 在表面积上差 ~0.2–0.5%。
 *
 * 这里改为：直接用 OpenSCAD 的精确刻面拓扑生成网格，经 `polyhedron` 的重建管线
 * 固化为 faceted BREP。运行时若再以匹配分段分辨率的 angularDeflection 重新三角化，
 * 既有的刻面会被保留（实测：faceted BREP 经 runtime 三角化后三角数完全不变）。
 *
 * 拓扑规则（与 OpenSCAD 一致）：
 *  - sphere($fn=n)：n 条经线 + floor(n/2) 条纬环，纬环位于奇倍数极角 φ=(2j+1)·π/n；
 *  - cylinder($fn=n)：n 段棱柱 + 两端 n 角扇形封盖；
 *  - cone：同 cylinder，仅顶/底半径不同（含 r=0 退化为锥尖）。
 */
import { polyhedron } from './polyhedron'

type Vec3Arr = [number, number, number]

/** OpenSCAD 精确拓扑的刻面球（n 经线 × floor(n/2) 奇倍数纬环）。 */
function oscSphereGeometry(radius: number, segments: number): { vertices: Vec3Arr[]; faces: number[][] } {
  const n = Math.max(3, Math.floor(segments))
  const rings = Math.max(1, Math.floor(n / 2))
  const vertices: Vec3Arr[] = []
  const faces: number[][] = []
  vertices.push([0, 0, radius]) // 北极
  for (let j = 0; j < rings; j++) {
    const phi = ((2 * j + 1) * Math.PI) / n
    const z = radius * Math.cos(phi)
    const rr = radius * Math.sin(phi)
    for (let i = 0; i < n; i++) {
      const th = (i * 2 * Math.PI) / n
      vertices.push([rr * Math.cos(th), rr * Math.sin(th), z])
    }
  }
  vertices.push([0, 0, -radius]) // 南极
  const top = 0
  const bot = vertices.length - 1
  for (let i = 0; i < n; i++) faces.push([top, 1 + i, 1 + ((i + 1) % n)])
  for (let j = 0; j < rings - 1; j++) {
    const a = 1 + j * n
    const b = 1 + (j + 1) * n
    for (let i = 0; i < n; i++) {
      const ni = (i + 1) % n
      faces.push([a + i, b + i, b + ni])
      faces.push([a + i, b + ni, a + ni])
    }
  }
  const last = 1 + (rings - 1) * n
  for (let i = 0; i < n; i++) faces.push([bot, last + ((i + 1) % n), last + i])
  return { vertices, faces }
}

/** OpenSCAD 精确拓扑的刻面圆柱/圆锥/棱台（n 段 + 扇形封盖）。 */
function oscCylinderGeometry(
  radiusBottom: number,
  radiusTop: number,
  height: number,
  segments: number,
  centered: boolean,
): { vertices: Vec3Arr[]; faces: number[][] } {
  const n = Math.max(3, Math.floor(segments))
  const z0 = centered ? -height / 2 : 0
  const z1 = centered ? height / 2 : height
  const vertices: Vec3Arr[] = []
  const faces: number[][] = []
  const hasBottom = radiusBottom > 0
  const hasTop = radiusTop > 0

  let bottomStart = 0
  if (hasBottom) {
    vertices.push([0, 0, z0]) // 底心
    bottomStart = 0
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * Math.PI) / n
      vertices.push([radiusBottom * Math.cos(a), radiusBottom * Math.sin(a), z0])
    }
  }
  let topStart = vertices.length
  if (hasTop) {
    vertices.push([0, 0, z1]) // 顶心
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * Math.PI) / n
      vertices.push([radiusTop * Math.cos(a), radiusTop * Math.sin(a), z1])
    }
  }

  if (hasBottom && hasTop) {
    // 侧壁（外法向：从底环外侧看逆时针）
    for (let i = 0; i < n; i++) {
      const ni = (i + 1) % n
      faces.push([bottomStart + 1 + i, topStart + 1 + ni, topStart + 1 + i])
      faces.push([bottomStart + 1 + i, bottomStart + 1 + ni, topStart + 1 + ni])
    }
    // 底盖（外法向朝下）
    for (let i = 0; i < n; i++) {
      const ni = (i + 1) % n
      faces.push([bottomStart, bottomStart + 1 + i, bottomStart + 1 + ni])
    }
    // 顶盖（外法向朝上）
    for (let i = 0; i < n; i++) {
      const ni = (i + 1) % n
      faces.push([topStart, topStart + 1 + ni, topStart + 1 + i])
    }
  } else if (hasBottom && !hasTop) {
    // 锥尖在顶部
    const apex = topStart
    for (let i = 0; i < n; i++) {
      const ni = (i + 1) % n
      faces.push([bottomStart + 1 + i, bottomStart + 1 + ni, apex])
    }
    for (let i = 0; i < n; i++) {
      const ni = (i + 1) % n
      faces.push([bottomStart, bottomStart + 1 + ni, bottomStart + 1 + i])
    }
  } else if (!hasBottom && hasTop) {
    const apex = bottomStart
    for (let i = 0; i < n; i++) {
      const ni = (i + 1) % n
      faces.push([apex, topStart + 1 + ni, topStart + 1 + i])
    }
    for (let i = 0; i < n; i++) {
      const ni = (i + 1) % n
      faces.push([topStart, topStart + 1 + i, topStart + 1 + ni])
    }
  }
  return { vertices, faces }
}

export interface FacetedPrimitiveOpts {
  segments?: number
  center?: [number, number, number]
}

/**
 * OpenSCAD 兼容刻面球。
 * @param radius 半径（mm）
 * @param opts.segments 经度分段数（$fn）；默认 30
 * @param opts.center 球心偏移（OpenSCAD `center` 语义：球心位置）
 */
export async function sphere(radius: number, opts?: FacetedPrimitiveOpts): Promise<import('occt-wasm').ShapeHandle> {
  const segments = opts?.segments ?? 30
  const g = oscSphereGeometry(radius, segments)
  const solid = await polyhedron(g.vertices as unknown[], g.faces)
  if (opts?.center) {
    // translate handled by caller via openscad namespace; keep simple: return as-is
  }
  return solid
}

/**
 * OpenSCAD 兼容刻面圆柱 / 棱台。
 * @param radius 半径（mm）；若同时给 radiusTop 则是棱台
 * @param height 高度（沿 +Z）
 */
export async function cylinder(
  radius: number,
  height: number,
  opts?: FacetedPrimitiveOpts & { radiusTop?: number; centered?: boolean },
): Promise<import('occt-wasm').ShapeHandle> {
  const segments = opts?.segments ?? 30
  const centered = opts?.centered ?? false
  const rTop = opts?.radiusTop ?? radius
  const g = oscCylinderGeometry(radius, rTop, height, segments, centered)
  return polyhedron(g.vertices as unknown[], g.faces)
}

/**
 * OpenSCAD 兼容刻面圆锥（radiusBottom=0 或 radiusTop=0 退化为锥尖）。
 */
export async function cone(
  radiusBottom: number,
  radiusTop: number,
  height: number,
  opts?: FacetedPrimitiveOpts & { centered?: boolean },
): Promise<import('occt-wasm').ShapeHandle> {
  const segments = opts?.segments ?? 30
  const centered = opts?.centered ?? false
  const g = oscCylinderGeometry(radiusBottom, radiusTop, height, segments, centered)
  return polyhedron(g.vertices as unknown[], g.faces)
}
