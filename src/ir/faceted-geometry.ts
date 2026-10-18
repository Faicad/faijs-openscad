/**
 * Fragment-count computation (M9 §1.3 语义修正后).
 *
 * **语义修正（M9 §1.3）**：`$fn`/`$fa`/`$fs` 是**导出参数**，不改变建模语义。
 * 转换器一律产出解析几何（sphere/cylinder/circle），这些变量只在导出时控制
 * 三角化分片密度。本模块仅提供从 `$fn`/`$fa`/`$fs` 换算**分段数**的函数
 *（`circleFragments` / `sphereFragments`），供 `lower.ts` 采集三角化参数使用。
 *
 * `facetedSphereGeometry` / `regularPolygonPoints` 保留供测试与探针使用，
 * 但**不再进入主转换管线**——主管线产出的始终是解析几何。
 *
 * OpenSCAD's faceting rules (for segment-count computation only):
 *  - `$fn > 0`: use exactly $fn segments
 *  - `$fn = 0` (or undef): compute from $fa (min angle) and $fs (min size)
 *    - For circles: fragments = max(3, min(ceil(360 / $fa), ceil(2*PI*r / $fs)))
 *    - For spheres: fn = max(3, min(ceil(180 / $fa), ceil(PI*r / $fs)))
 *      (half-circle because sphere uses latitude from pole to pole)
 *
 * Defaults: $fa = 12, $fs = 2
 */

/** Default OpenSCAD special variables. */
export const DEFAULT_FA = 12
export const DEFAULT_FS = 2

/**
 * Compute the number of fragments for a circle of radius `r`.
 * Used by cylinder, cone, and circle.
 */
export function circleFragments(
  r: number,
  fn: number | undefined,
  fa: number | undefined,
  fs: number | undefined,
): number {
  if (fn !== undefined && fn > 0) return Math.max(3, Math.floor(fn))
  const a = fa ?? DEFAULT_FA
  const s = fs ?? DEFAULT_FS
  return Math.max(
    3,
    Math.min(
      Math.ceil(360 / a),
      Math.ceil((2 * Math.PI * r) / s),
    ),
  )
}

/**
 * Compute the number of fragments for a sphere of radius `r`.
 *
 * 实验标定（2026-10-07，OpenSCAD 2024.x）：sphere 的分片公式与 circle 相同
 * （经度满圆 360°，全周长 2πr），**但下限是 5 而非 3**。旧公式用 180/πr/下限3
 * 是错误的（会算出 r=1 → 3 段，实际 OpenSCAD 产出 5 段 = 26 tris）。
 *
 *   fragments = max(5, min(ceil(360/$fa), ceil(2*π*r/$fs)))
 *
 * 验证：r=1,$fa=12,$fs=2 → max(5, min(30, 4)) = 5 → 26 tris ✅
 *       r=3 → max(5, min(30, 10)) = 10 → 96 tris ✅
 *       r=10 → max(5, min(30, 32)) = 30 → 896 tris ✅
 */
export function sphereFragments(
  r: number,
  fn: number | undefined,
  fa: number | undefined,
  fs: number | undefined,
): number {
  if (fn !== undefined && fn > 0) return Math.max(5, Math.floor(fn))
  const a = fa ?? DEFAULT_FA
  const s = fs ?? DEFAULT_FS
  return Math.max(
    5,
    Math.min(
      Math.ceil(360 / a),
      Math.ceil((2 * Math.PI * r) / s),
    ),
  )
}

/**
 * Generate vertices and triangular faces for a faceted sphere.
 *
 * **OpenSCAD 精确拓扑（2026-10-18 修正）**：
 * OpenSCAD 的 `sphere($fn=n)` 产出 n 条经线（经度分片）与 `floor(n/2)` 条纬环，
 * 纬环位于奇倍数极角 φ = (2j+1)·π/n（j = 0..rings-1），**不含 0°/180° 真极点**；
 * 顶/底用位于 z=±r·cos(π/n) 的平顶封盖闭合（故球体 z 向极值为 r·cos(π/n)，
 * 如 n=30 → 10·cos(6°)=9.9452，而非 r）。参考 STL 实测 maxZ=9.9452 已证实。
 *
 * - 顶点：2 个封盖中心（z=±r·cos(π/n)）+ n·rings 个环顶点
 * - 面：顶盖 n + 中间带 2·n·(rings-1) + 底盖 n = 2·n·rings
 * - 例：n=30 → rings=15 → 900 三角
 *
 * @param radius - Sphere radius
 * @param segments - Number of longitude segments (from $fn or computed)
 * @returns vertices and faces (each face is [v0, v1, v2])
 */
export function facetedSphereGeometry(
  radius: number,
  segments: number,
): { vertices: Array<[number, number, number]>; faces: Array<[number, number, number]> } {
  const n = Math.max(3, Math.floor(segments))
  const rings = Math.max(1, Math.floor(n / 2))
  const cosHalf = Math.cos(Math.PI / n)
  const vertices: Array<[number, number, number]> = []
  const faces: Array<[number, number, number]> = []

  // Top cap center (flat cap at z = r·cos(π/n); OpenSCAD has no ±r pole)
  vertices.push([0, 0, radius * cosHalf])
  // Latitude rings at odd-multiple polar angles: φ = (2j+1)·π/n
  for (let j = 0; j < rings; j++) {
    const phi = ((2 * j + 1) * Math.PI) / n
    const z = radius * Math.cos(phi)
    const ringR = radius * Math.sin(phi)
    for (let lon = 0; lon < n; lon++) {
      const theta = (lon * 2 * Math.PI) / n
      vertices.push([
        ringR * Math.cos(theta),
        ringR * Math.sin(theta),
        z,
      ])
    }
  }

  // Bottom cap center
  vertices.push([0, 0, -radius * cosHalf])

  const topPole = 0
  const bottomPole = vertices.length - 1

  // Top cap triangles (top pole → first ring)
  for (let lon = 0; lon < n; lon++) {
    const nextLon = (lon + 1) % n
    faces.push([topPole, 1 + lon, 1 + nextLon])
  }

  // Middle strips (between consecutive rings)
  for (let j = 0; j < rings - 1; j++) {
    const ringStart = 1 + j * n
    const nextRingStart = 1 + (j + 1) * n
    for (let lon = 0; lon < n; lon++) {
      const nextLon = (lon + 1) % n
      faces.push([ringStart + lon, nextRingStart + lon, nextRingStart + nextLon])
      faces.push([ringStart + lon, nextRingStart + nextLon, ringStart + nextLon])
    }
  }

  // Bottom cap triangles (last ring → bottom pole)
  const lastRingStart = 1 + (rings - 1) * n
  for (let lon = 0; lon < n; lon++) {
    const nextLon = (lon + 1) % n
    faces.push([bottomPole, lastRingStart + nextLon, lastRingStart + lon])
  }

  return { vertices, faces }
}

/**
 * Flat-array variant of {@link facetedSphereGeometry}.
 * Returns vertices as [x0,y0,z0, x1,y1,z1, ...] and faces as [v0,v1,v2, ...].
 */
export function facetedSphereGeometryFlat(
  radius: number,
  segments: number,
): { vertices: number[]; faces: number[] } {
  const { vertices: vv, faces: ff } = facetedSphereGeometry(radius, segments)
  const flatV: number[] = []
  for (const v of vv) flatV.push(v[0], v[1], v[2])
  const flatF: number[] = []
  for (const f of ff) flatF.push(f[0], f[1], f[2])
  return { vertices: flatV, faces: flatF }
}

/**
 * Generate a regular N-gon polygon for a faceted circle/cylinder cross-section.
 *
 * OpenSCAD's circle with $fn=N produces a regular N-gon with vertices at:
 *   for i = 0..N-1: angle = i * (360/N), point = [r*cos(angle), r*sin(angle)]
 *
 * @param radius - Circle radius
 * @param segments - Number of segments
 * @returns Array of 2D points [x, y]
 */
export function regularPolygonPoints(
  radius: number,
  segments: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let i = 0; i < segments; i++) {
    const angle = (i * 2 * Math.PI) / segments
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)])
  }
  return points
}

/**
 * Generate vertices and triangular faces for a faceted cylinder.
 *
 * OpenSCAD's cylinder tessellation:
 * - Bottom ring at z=0: n vertices
 * - Top ring at z=h: n vertices
 * - Bottom cap: n triangles (fan from vertex 0 of bottom ring)
 * - Top cap: n triangles (fan from vertex 0 of top ring)
 * - Side: 2*n triangles (quads split into two triangles)
 *
 * For `centered=true`, z range is [-h/2, h/2].
 *
 * @param radius - Cylinder radius
 * @param height - Cylinder height
 * @param segments - Number of segments
 * @param centered - If true, center on origin (z ∈ [-h/2, h/2])
 * @returns vertices (flat [x,y,z,...]) and faces (flat [v0,v1,v2,...])
 */
export function facetedCylinderGeometry(
  radius: number,
  height: number,
  segments: number,
  centered: boolean,
): { vertices: number[]; faces: number[] } {
  const n = segments
  const z0 = centered ? -height / 2 : 0
  const z1 = centered ? height / 2 : height
  const vertices: number[] = []
  const faces: number[] = []

  // Bottom ring (indices 0..n-1)
  for (let i = 0; i < n; i++) {
    const angle = (i * 2 * Math.PI) / n
    vertices.push(radius * Math.cos(angle), radius * Math.sin(angle), z0)
  }
  // Top ring (indices n..2n-1)
  for (let i = 0; i < n; i++) {
    const angle = (i * 2 * Math.PI) / n
    vertices.push(radius * Math.cos(angle), radius * Math.sin(angle), z1)
  }

  // Bottom cap (viewed from below = clockwise, so reverse for outward normal)
  for (let i = 1; i < n - 1; i++) {
    faces.push(0, i + 1, i) // reversed for downward normal
  }

  // Top cap (viewed from above = counter-clockwise)
  for (let i = 1; i < n - 1; i++) {
    faces.push(n, n + i, n + i + 1)
  }

  // Side faces: two triangles per quad
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n
    const b0 = i // bottom ring
    const b1 = next
    const t0 = n + i // top ring
    const t1 = n + next
    // Outward-facing: bottom→top→next-top, bottom→next-top→next-bottom
    faces.push(b0, t0, t1)
    faces.push(b0, t1, b1)
  }

  return { vertices, faces }
}

/**
 * Generate vertices and triangular faces for a faceted cone (frustum).
 *
 * Same topology as cylinder but with different top/bottom radii.
 * If one radius is 0, the corresponding ring collapses to a single apex vertex.
 *
 * @param radiusBottom - Bottom radius (z=0)
 * @param radiusTop - Top radius (z=h)
 * @param height - Cone height
 * @param segments - Number of segments
 * @param centered - If true, center on origin
 * @returns vertices (flat) and faces (flat)
 */
export function facetedConeGeometry(
  radiusBottom: number,
  radiusTop: number,
  height: number,
  segments: number,
  centered: boolean,
): { vertices: number[]; faces: number[] } {
  const n = segments
  const z0 = centered ? -height / 2 : 0
  const z1 = centered ? height / 2 : height
  const vertices: number[] = []
  const faces: number[] = []

  const hasBottom = radiusBottom > 0
  const hasTop = radiusTop > 0

  // Bottom ring (indices 0..n-1) — only if r1 > 0
  let bottomStart = 0
  if (hasBottom) {
    bottomStart = 0
    for (let i = 0; i < n; i++) {
      const angle = (i * 2 * Math.PI) / n
      vertices.push(radiusBottom * Math.cos(angle), radiusBottom * Math.sin(angle), z0)
    }
  }

  // Top ring — only if r2 > 0
  let topStart = 0
  if (hasTop) {
    topStart = vertices.length / 3
    for (let i = 0; i < n; i++) {
      const angle = (i * 2 * Math.PI) / n
      vertices.push(radiusTop * Math.cos(angle), radiusTop * Math.sin(angle), z1)
    }
  }

  if (hasBottom && hasTop) {
    // Frustum: same as cylinder side
    // Bottom cap
    for (let i = 1; i < n - 1; i++) {
      faces.push(bottomStart, bottomStart + i + 1, bottomStart + i)
    }
    // Top cap
    for (let i = 1; i < n - 1; i++) {
      faces.push(topStart, topStart + i, topStart + i + 1)
    }
    // Side
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n
      faces.push(bottomStart + i, topStart + i, topStart + next)
      faces.push(bottomStart + i, topStart + next, bottomStart + next)
    }
  } else if (hasBottom && !hasTop) {
    // Cone with apex at top
    const apex = vertices.length / 3
    vertices.push(0, 0, z1)
    // Bottom cap
    for (let i = 1; i < n - 1; i++) {
      faces.push(bottomStart, bottomStart + i + 1, bottomStart + i)
    }
    // Side (apex triangles)
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n
      faces.push(bottomStart + i, apex, bottomStart + next)
    }
  } else if (!hasBottom && hasTop) {
    // Cone with apex at bottom
    const apex = 0
    vertices.push(0, 0, z0)
    // Top cap (now starting at index 1)
    const topStartAdj = 1
    for (let i = 1; i < n - 1; i++) {
      faces.push(topStartAdj, topStartAdj + i, topStartAdj + i + 1)
    }
    // Side (apex triangles)
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n
      faces.push(apex, topStartAdj + i, topStartAdj + next)
    }
  }

  return { vertices, faces }
}
