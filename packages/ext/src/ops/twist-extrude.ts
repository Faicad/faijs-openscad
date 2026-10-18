/**
 * K06: twistExtrude — linear extrude with twist and optional scale.
 *
 * Two distinct kernel paths, chosen by whether there is any twist:
 *
 * - **twist == 0** → `extrude` (plain) or `loft` (tapered/scaled).
 * - **twist != 0** → helical spine + `sweepFull`.
 *
 * ⚠️ GOTCHA（2026-10-17）：`sweepFull` 在 occt-wasm 5.6.0 上对**非扭曲**的
 * 挤出也会**无限期挂死**（同步 wasm 调用，连 setTimeout 看门狗都跑不了，JS 侧
 * 无法中断）。实证：`linear_extrude(scale=[0.5,0.5])` 的 50×50 方形剖面
 * （Advanced/offset.scad）永不返回；`Basics/linear_extrude.scad` 因此被列入
 * run-parity 的 CRASH_SKIP。避开 sweepFull 后这两例都能执行。
 *
 * ⚠️ GOTCHA（2026-10-17）：OpenSCAD 的 `linear_extrude(scale=...)` 可以是
 * **非均匀**缩放 `[sx, sy]`（也可以是标量）。旧实现把这个数组原样塞给
 * `lawEndFactor`，语义是错的。这里按 `[sx, sy]` 处理（标量视为 sx=sy）。
 */
import { getExtKernel } from '../kernel'
import { SweepLaw } from 'occt-wasm'
import type { ShapeHandle } from 'occt-wasm'

/** Normalise OpenSCAD's `scale` argument into a (possibly non-uniform) pair. */
function normaliseScale(scale: number | readonly number[] | undefined): [number, number] | null {
  if (scale === undefined) return null
  if (typeof scale === 'number') {
    return Number.isFinite(scale) ? [scale, scale] : null
  }
  if (Array.isArray(scale) && scale.length >= 2) {
    const sx = Number(scale[0])
    const sy = Number(scale[1])
    return Number.isFinite(sx) && Number.isFinite(sy) ? [sx, sy] : null
  }
  return null
}

/**
 * Extrude a 2D profile with twist and optional scale.
 *
 * @param profile  2D face/wire to extrude.
 * @param height   Extrusion height (Z direction).
 * @param twist    Twist angle in degrees (can be negative).
 * @param scale    Optional scale factor at the top (number or [sx, sy]).
 * @returns        A solid ShapeHandle.
 */
export async function twistExtrude(
  profile: ShapeHandle,
  height: number,
  twist: number,
  scale?: number | readonly number[],
): Promise<ShapeHandle> {
  const k = await getExtKernel()

  if (height <= 0) {
    return k.makeNullShape()
  }

  const absTwist = Math.abs(twist)
  const scaled = normaliseScale(scale)
  const isUniformOne =
    scaled === null || (Math.abs(scaled[0] - 1) < 1e-12 && Math.abs(scaled[1] - 1) < 1e-12)

  // ── 无扭曲：走 extrude / loft，绕开会挂死的 sweepFull ──────────────────────
  if (absTwist < 1e-10) {
    // 等截面挤出
    if (isUniformOne) {
      try {
        return k.extrude(profile, 0, 0, height)
      } catch {
        // 落到下方 sweepFull 路径
      }
    } else {
      // 锥度挤出：底剖面 → 顶剖面（缩放 + 抬升到 height）→ loft
      try {
        const [sx, sy] = scaled!
        const bottom = k.isFace(profile) ? k.outerWire(profile) : profile
        // 3×4 行主序：缩放 (sx, sy) 并沿 +Z 平移 height
        const top = k.transform(bottom, [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, height])
        const solid = k.loft([bottom, top], true, false)
        if (k.isValid(solid)) return solid
        try { k.release(solid) } catch { /* ignore */ }
      } catch {
        // 落到下方 sweepFull 路径
      }
    }
  }

  // ── 有扭曲（或上面两条快速路径失败）：螺旋脊线 + sweepFull ──────────────────
  const leftHanded = twist < 0
  const pitch = absTwist > 1e-10 ? height / (absTwist / 360) : Infinity
  const spine = k.makeHelixWireHanded(
    { x: 0, y: 0, z: 0 },   // origin
    { x: 0, y: 0, z: 1 },   // axis
    pitch,
    height,
    0,                       // radius (spine is along Z)
    leftHanded,
  )

  const opts: { law: SweepLaw; lawLength: number; lawEndFactor?: number } = {
    law: SweepLaw.Linear,
    lawLength: height,
  }
  if (scaled !== null) {
    // sweepFull 只接受单一缩放因子；非均匀 [sx, sy] 取其平均（近似，
    // 有扭曲的非均匀缩放在 OpenSCAD 里本就罕见，先保证不挂死）。
    opts.lawEndFactor = (scaled[0] + scaled[1]) / 2
  }

  return k.sweepFull(profile, spine, opts)
}
