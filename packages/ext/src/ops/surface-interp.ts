/**
 * K11: surfaceInterp — interpolate a grid of points into a smooth surface.
 *
 * Each row of the grid is interpolated into a B-spline curve via
 * interpolatePoints, then the curves are lofted into a solid.
 */
import { getExtKernel } from '../kernel'
import type { ShapeHandle, Vec3 } from 'occt-wasm'

/**
 * Interpolate a grid of points into a smooth surface solid.
 *
 * @param points  Row-major grid of 3D points (rows * cols points).
 * @param rows    Number of rows in the grid.
 * @param cols    Number of columns in the grid.
 * @returns       A solid ShapeHandle representing the interpolated surface.
 */
export async function surfaceInterp(
  points: Vec3[],
  rows: number,
  cols: number,
): Promise<ShapeHandle> {
  const k = await getExtKernel()

  if (points.length < rows * cols || rows < 2 || cols < 2) {
    return k.makeNullShape()
  }

  // Interpolate each row into a B-spline curve.
  const curves: ShapeHandle[] = []
  for (let r = 0; r < rows; r++) {
    const rowPoints = points.slice(r * cols, (r + 1) * cols)
    curves.push(k.interpolatePoints(rowPoints, false))
  }

  // Loft the curves into a solid.
  return k.loft(curves, true, false)
}

/**
 * Surface from file — reads a heightmap file and interpolates.
 *
 * OpenSCAD's `surface(file)` reads a text file containing a grid of
 * whitespace-separated z-height values.  This function reads the file,
 * converts to 3D points (x=col, y=row, z=height), and calls surfaceInterp.
 *
 * @param file  Path to the heightmap data file.
 * @returns     A solid ShapeHandle.
 */
export async function surface(file: string): Promise<ShapeHandle> {
  const { readFileSync } = await import('node:fs')
  const content = readFileSync(file, 'utf8')
  const lines = content.trim().split('\n')
  const rows = lines.length
  const cols = lines[0].trim().split(/\s+/).length

  const points: Vec3[] = []
  for (let r = 0; r < rows; r++) {
    const values = lines[r].trim().split(/\s+/).map(Number)
    for (let c = 0; c < cols; c++) {
      points.push({ x: c, y: r, z: values[c] ?? 0 })
    }
  }

  return surfaceInterp(points, rows, cols)
}
