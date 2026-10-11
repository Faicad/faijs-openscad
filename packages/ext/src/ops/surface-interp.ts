/**
 * K11: surfaceInterp — build a solid from a heightmap grid of points.
 *
 * The grid is triangulated into triangle faces via buildTriFace, then sewn
 * into a solid — same approach as the polyhedron op.  Side walls and a
 * bottom face are added to make it a closed solid (matching OpenSCAD semantics
 * where surface() produces a solid with bottom at z=0).
 */
import { getExtKernel } from '../kernel'
import { getLoadBaseDir } from './load'
import type { ShapeHandle, Vec3 } from 'occt-wasm'

/**
 * Check if three points form a degenerate (zero-area) triangle.
 * Uses cross product magnitude — if near zero, the points are collinear.
 */
function isDegenerate(a: Vec3, b: Vec3, c: Vec3, eps = 1e-10): boolean {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
  const cross = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  }
  const mag = Math.sqrt(cross.x * cross.x + cross.y * cross.y + cross.z * cross.z)
  return mag < eps
}

/**
 * Build a solid from a grid of 3D points by triangulating the grid.
 *
 * Top surface follows the heightmap.  Side walls connect the edges to z=0.
 * Bottom face is at z=0.  This makes a closed solid like OpenSCAD's surface().
 *
 * @param points  Row-major grid of 3D points (rows * cols points).
 * @param rows    Number of rows in the grid.
 * @param cols    Number of columns in the grid.
 * @param center  If true, center the surface at the origin.
 * @returns       A solid ShapeHandle.
 */
export async function surfaceInterp(
  points: Vec3[],
  rows: number,
  cols: number,
  center: boolean = false,
): Promise<ShapeHandle> {
  const k = await getExtKernel()

  if (points.length < rows * cols || rows < 2 || cols < 2) {
    return k.makeNullShape()
  }

  // Apply center offset: shift so the grid is centered at origin
  let offsetX = 0, offsetY = 0
  if (center) {
    offsetX = -(cols - 1) / 2
    offsetY = -(rows - 1) / 2
  }

  // Helper to get a grid point with offset applied
  const gp = (r: number, c: number): Vec3 => {
    const p = points[r * cols + c]
    return { x: p.x + offsetX, y: p.y + offsetY, z: p.z }
  }
  // Helper for bottom point (z=0)
  const bp = (r: number, c: number): Vec3 => {
    const p = points[r * cols + c]
    return { x: p.x + offsetX, y: p.y + offsetY, z: 0 }
  }

  const triFaces: ShapeHandle[] = []

  // Helper to safely add a triangle (skip degenerate)
  const addTri = (a: Vec3, b: Vec3, c: Vec3) => {
    if (!isDegenerate(a, b, c)) {
      triFaces.push(k.buildTriFace(a, b, c))
    }
  }

  // Top surface: two triangles per grid cell
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const p00 = gp(r, c)
      const p10 = gp(r, c + 1)
      const p01 = gp(r + 1, c)
      const p11 = gp(r + 1, c + 1)
      addTri(p00, p10, p11)
      addTri(p00, p11, p01)
    }
  }

  // Bottom surface: two triangles per grid cell (reversed winding for outward normal)
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const p00 = bp(r, c)
      const p10 = bp(r, c + 1)
      const p01 = bp(r + 1, c)
      const p11 = bp(r + 1, c + 1)
      addTri(p00, p01, p11)
      addTri(p00, p11, p10)
    }
  }

  // Side walls: front (r=0), back (r=rows-1), left (c=0), right (c=cols-1)
  // Front wall: row 0, going from top to bottom
  for (let c = 0; c < cols - 1; c++) {
    const t0 = gp(0, c), t1 = gp(0, c + 1)
    const b0 = bp(0, c), b1 = bp(0, c + 1)
    addTri(t0, b0, b1)
    addTri(t0, b1, t1)
  }
  // Back wall: row rows-1
  for (let c = 0; c < cols - 1; c++) {
    const t0 = gp(rows - 1, c), t1 = gp(rows - 1, c + 1)
    const b0 = bp(rows - 1, c), b1 = bp(rows - 1, c + 1)
    addTri(t0, t1, b1)
    addTri(t0, b1, b0)
  }
  // Left wall: col 0
  for (let r = 0; r < rows - 1; r++) {
    const t0 = gp(r, 0), t1 = gp(r + 1, 0)
    const b0 = bp(r, 0), b1 = bp(r + 1, 0)
    addTri(t0, t1, b1)
    addTri(t0, b1, b0)
  }
  // Right wall: col cols-1
  for (let r = 0; r < rows - 1; r++) {
    const t0 = gp(r, cols - 1), t1 = gp(r + 1, cols - 1)
    const b0 = bp(r, cols - 1), b1 = bp(r + 1, cols - 1)
    addTri(t0, b0, b1)
    addTri(t0, b1, t1)
  }

  if (triFaces.length === 0) {
    return k.makeNullShape()
  }

  const shell = k.sew(triFaces)
  return k.makeSolid(shell)
}

/**
 * Parse an Octave-format .dat file.
 *
 * Format:
 *   # Created by Octave ...
 *   # name: d
 *   # type: matrix
 *   # rows: N
 *   # columns: M
 *   <whitespace-separated values, one row per line>
 *
 * Returns a 2D array of numbers (rows × cols).
 */
function parseOctaveDat(content: string): number[][] {
  const lines = content.split('\n')
  const dataLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) {
      // Header line — skip (rows/cols inferred from data)
    } else if (trimmed.length > 0) {
      dataLines.push(trimmed)
    }
  }

  const result: number[][] = []
  for (const line of dataLines) {
    const values = line.split(/\s+/).map(Number)
    if (values.length > 0 && !values.some(isNaN)) {
      result.push(values)
    }
  }

  return result
}

/**
 * Parse a plain text heightmap file (whitespace-separated numbers).
 */
function parsePlainDat(content: string): number[][] {
  const lines = content.trim().split('\n')
  const result: number[][] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const values = trimmed.split(/\s+/).map(Number)
    if (values.length > 0 && !values.some(isNaN)) {
      result.push(values)
    }
  }
  return result
}

/**
 * Decode a PNG file to a grayscale heightmap.
 *
 * OpenSCAD converts pixel RGB to grayscale and normalizes to [0, 100].
 * Grayscale formula: (R*0.299 + G*0.587 + B*0.114) / 255 * 100
 */
async function decodePng(buf: Buffer): Promise<number[][]> {
  const { PNG } = await import('pngjs')
  const png = PNG.sync.read(buf)
  const { width, height, data } = png

  const result: number[][] = []
  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      // Grayscale conversion + normalize to [0, 100] like OpenSCAD
      const gray = (r * 0.299 + g * 0.587 + b * 0.114) / 255 * 100
      row.push(gray)
    }
    result.push(row)
  }
  return result
}

/**
 * Surface from file — reads a heightmap file and builds a solid.
 *
 * OpenSCAD's `surface(file)` reads:
 * - .dat/.txt: text file with whitespace-separated z-height values
 *   (supports Octave format with `#` header lines)
 * - .png: image file, pixel grayscale values normalized to [0, 100]
 *
 * The result is a solid with the top following the heightmap and bottom at z=0.
 *
 * @param file   Path to the heightmap data file (relative to loadBaseDir or absolute).
 * @param center If true, center the surface at the origin.
 * @returns      A solid ShapeHandle.
 */
export async function surface(file: string, center: boolean = false): Promise<ShapeHandle> {
  const { readFileSync, existsSync } = await import('node:fs')
  const { resolve, isAbsolute, extname } = await import('node:path')

  // Resolve file path relative to loadBaseDir
  const resolved = isAbsolute(file) ? file : resolve(getLoadBaseDir(), file)

  if (!existsSync(resolved)) {
    throw new Error(`ENOENT: no such file or directory, open '${file}'`)
  }

  const ext = extname(resolved).toLowerCase()
  let heightGrid: number[][]

  if (ext === '.png') {
    const buf = readFileSync(resolved)
    heightGrid = await decodePng(buf)
  } else {
    // .dat or .txt — could be Octave format or plain text
    const content = readFileSync(resolved, 'utf8')
    if (content.includes('# type: matrix') || content.includes('# rows:')) {
      heightGrid = parseOctaveDat(content)
    } else {
      heightGrid = parsePlainDat(content)
    }
  }

  const rows = heightGrid.length
  const cols = rows > 0 ? heightGrid[0].length : 0

  if (rows < 2 || cols < 2) {
    const k = await getExtKernel()
    return k.makeNullShape()
  }

  // Convert to 3D points (x=col, y=row, z=height)
  const points: Vec3[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({ x: c, y: r, z: heightGrid[r][c] ?? 0 })
    }
  }

  return surfaceInterp(points, rows, cols, center)
}
