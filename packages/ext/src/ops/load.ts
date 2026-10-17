/**
 * K03: load — external mesh asset loading (STL/DXF).
 *
 * OpenSCAD's import() module loads an external geometry file. We support:
 * - .stl → OCCT kernel.importStl() → 3D ShapeHandle
 * - .dxf → DXF parser → 2D wires → makeFace → 2D ShapeHandle
 *
 * File path resolution: the base directory is set by the host (parity runner)
 * via setLoadBaseDir() before executing each script. Import paths in OpenSCAD
 * are relative to the .scad source file's directory.
 */
import { getExtKernel } from '../kernel'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import type { ShapeHandle } from 'occt-wasm'

/** CJS require for optional faijs submodules (this package is ESM). */
const nodeRequire = createRequire(import.meta.url)

/** Base directory for resolving relative import paths. */
let loadBaseDir = process.cwd()

/** Set the base directory for resolving relative import paths. */
export function setLoadBaseDir(dir: string): void {
  loadBaseDir = dir
}

/** Get the current base directory. */
export function getLoadBaseDir(): string {
  return loadBaseDir
}

/**
 * Resolve a file path from the import statement to an absolute path.
 *
 * Tries:
 * 1. As-is (might already be absolute)
 * 2. Relative to loadBaseDir
 * 3. Search in EXAMPLES_ROOT subdirectories (fallback)
 */
function resolveFilePath(file: string): string {
  // 1. Absolute path or relative to CWD
  if (existsSync(file)) return resolve(file)

  // 2. Relative to base dir
  const resolved = resolve(loadBaseDir, file)
  if (existsSync(resolved)) return resolved

  // 3. Search in common fixture subdirectories
  const examplesRoot = resolve(loadBaseDir, '..')
  if (existsSync(examplesRoot)) {
    try {
      for (const entry of readdirSync(examplesRoot)) {
        const candidate = join(examplesRoot, entry, file)
        if (existsSync(candidate)) return candidate
      }
    } catch { /* ignore */ }
  }

  // 4. Last resort: return the resolved path (will fail with ENOENT)
  return resolved
}

export async function load(
  opts: { file: string },
): Promise<ShapeHandle> {
  const k = await getExtKernel()
  const filePath = resolveFilePath(opts.file)

  if (!existsSync(filePath)) {
    throw new Error(`openscad.load({ file: "${opts.file}" }) — file not found: ${filePath}`)
  }

  const ext = filePath.toLowerCase().split('.').pop()

  if (ext === 'stl') {
    return loadSTL(k, filePath)
  } else if (ext === 'dxf') {
    return loadDXF(k, filePath)
  } else if (ext === 'step' || ext === 'stp') {
    return loadSTEP(k, filePath)
  } else {
    throw new Error(`openscad.load({ file: "${opts.file}" }) — unsupported format: .${ext}`)
  }
}

/** Load STL file → 3D ShapeHandle via OCCT kernel.importStl(). */
function loadSTL(k: Awaited<ReturnType<typeof getExtKernel>>, filePath: string): ShapeHandle {
  const data = readFileSync(filePath)
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  return k.importStl(ab)
}

/** Load STEP file → 3D ShapeHandle via OCCT kernel.importStep(). */
function loadSTEP(k: Awaited<ReturnType<typeof getExtKernel>>, filePath: string): ShapeHandle {
  const data = readFileSync(filePath, 'utf8')
  return k.importStep(data)
}

/** Load DXF file → 2D ShapeHandle via DXF parser → wires → makeFace. */
function loadDXF(k: Awaited<ReturnType<typeof getExtKernel>>, filePath: string): ShapeHandle {
  const data = readFileSync(filePath, 'utf8')

  // Preferred: faijs core's brepjs-style DXF import (strict group-code pairing +
  // kernel.makeWire topology assembly) with evenodd hole classification
  // (importDxfProfiles → makeFace(outer) + addHolesInFace(holes)).
  // Fallback: the legacy ext parser below.
  try {
    // older @faicad/faijs without the module must fall through to the legacy
    // parser, not hard-crash.
    const mod = nodeRequire('@faicad/faijs/brep/dxf/dxf-import') as
      | {
          importDxf?: (k: unknown, text: string) => { ok: boolean; value?: ShapeHandle[]; error?: unknown }
          importDxfProfiles?: (k: unknown, text: string) => {
            ok: boolean
            value?: Array<{ outer: ShapeHandle; holes: ShapeHandle[] }>
            error?: unknown
          }
        }
      | undefined
    if (mod && typeof mod.importDxfProfiles === 'function') {
      const result = mod.importDxfProfiles(k, data)
      if (result.ok && result.value && result.value.length > 0) {
        // 每组：makeFace(outer) → addHolesInFace(holes) → 重组
        const faces: ShapeHandle[] = []
        for (const profile of result.value) {
          try {
            let face = k.makeFace(profile.outer)
            if (profile.holes.length > 0) {
              const holed = (k as unknown as { addHolesInFace: (f: ShapeHandle, hs: ShapeHandle[]) => ShapeHandle }).addHolesInFace(face, profile.holes)
              k.release(face)
              face = holed
            }
            faces.push(face)
          } catch {
            try { k.release(profile.outer) } catch { /* ignore */ }
          }
        }
        if (faces.length === 0) {
          throw new Error(`openscad.load({ file: "${filePath}" }) — all DXF profiles failed makeFace`)
        }
        if (faces.length === 1) return faces[0]
        try {
          return k.fuseAll(faces)
        } catch {
          let result2 = faces[0]
          for (let i = 1; i < faces.length; i++) {
            try { result2 = k.fuse(result2, faces[i]) } catch { /* skip */ }
          }
          return result2
        }
      }
      // faijs parser produced nothing — fall through to legacy parser
    }
  } catch {
    // module unavailable (old faijs) — fall through
  }

  const entities = parseDXF(data)

  const V3 = (x: number, y: number) => ({ x, y, z: 0 })
  const wires: ShapeHandle[] = []

  // Separate LINE entities (need to be connected into closed contours)
  // from other entities (CIRCLE, ARC, LWPOLYLINE, POLYLINE — already form wires)
  const lineSegments: Array<{ p1: { x: number; y: number }; p2: { x: number; y: number } }> = []
  for (const entity of entities) {
    if (entity.type === 'LINE' && entity.points.length >= 2) {
      lineSegments.push({ p1: entity.points[0], p2: entity.points[1] })
    } else {
      try {
        const wire = entityToWire(k, entity)
        if (wire !== null) wires.push(wire)
      } catch { /* skip */ }
    }
  }

  // Connect LINE segments into closed contours
  const contours = connectLineSegments(lineSegments)

  // Build a wire for each contour
  for (const contour of contours) {
    if (contour.length < 2) continue
    try {
      const edges: ShapeHandle[] = []
      for (let s = 0; s < contour.length - 1; s++) {
        edges.push(k.makeLineEdge(
          V3(contour[s].x, contour[s].y),
          V3(contour[s + 1].x, contour[s + 1].y),
        ))
      }
      // Close the contour if not already closed
      const first = contour[0], last = contour[contour.length - 1]
      if (Math.abs(first.x - last.x) > 1e-9 || Math.abs(first.y - last.y) > 1e-9) {
        edges.push(k.makeLineEdge(V3(last.x, last.y), V3(first.x, first.y)))
      }
      if (edges.length > 0) {
        wires.push(k.makeWire(edges))
      }
    } catch { /* skip contour */ }
  }

  if (wires.length === 0) {
    throw new Error(`openscad.load({ file: "${filePath}" }) — DXF parsing produced no wires`)
  }

  return facesFromWires(k, filePath, wires)
}

/**
 * Convert wires to 2D faces and fuse them into one shape (the common tail of
 * both DXF paths — faijs importDxf and the legacy ext parser).
 */
function facesFromWires(
  k: Awaited<ReturnType<typeof getExtKernel>>,
  filePath: string,
  wires: ShapeHandle[],
): ShapeHandle {
  // Convert wires to faces
  const faces: ShapeHandle[] = []
  for (const wire of wires) {
    try {
      const face = k.makeFace(wire)
      faces.push(face)
    } catch {
      try { k.release(wire) } catch { /* ignore */ }
    }
  }

  if (faces.length === 0) {
    throw new Error(`openscad.load({ file: "${filePath}" }) — all DXF wires failed makeFace`)
  }

  // Fuse all faces
  if (faces.length === 1) return faces[0]
  try {
    return k.fuseAll(faces)
  } catch {
    let result = faces[0]
    for (let i = 1; i < faces.length; i++) {
      try { result = k.fuse(result, faces[i]) } catch { /* skip */ }
    }
    return result
  }
}

/**
 * Connect LINE segments into closed contours by matching endpoints.
 *
 * DXF files often represent closed shapes as individual LINE entities.
 * We greedily chain segments by matching endpoints (within tolerance)
 * to build closed point sequences.
 */
function connectLineSegments(
  segments: Array<{ p1: { x: number; y: number }; p2: { x: number; y: number } }>,
): Array<Array<{ x: number; y: number }>> {
  const TOL = 1e-6
  const used = new Array(segments.length).fill(false)
  const contours: Array<Array<{ x: number; y: number }>> = []

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue
    used[start] = true
    const contour = [segments[start].p1, segments[start].p2]
    let currentEnd = segments[start].p2

    // Try to extend the contour
    let found = true
    while (found) {
      found = false
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue
        const seg = segments[i]
        // Check if seg.p1 matches currentEnd
        if (Math.abs(seg.p1.x - currentEnd.x) < TOL && Math.abs(seg.p1.y - currentEnd.y) < TOL) {
          contour.push(seg.p2)
          currentEnd = seg.p2
          used[i] = true
          found = true
          break
        }
        // Check if seg.p2 matches currentEnd (reverse direction)
        if (Math.abs(seg.p2.x - currentEnd.x) < TOL && Math.abs(seg.p2.y - currentEnd.y) < TOL) {
          contour.push(seg.p1)
          currentEnd = seg.p1
          used[i] = true
          found = true
          break
        }
      }
    }

    // Check if contour is closed (last point matches first)
    const first = contour[0], last = contour[contour.length - 1]
    if (Math.abs(first.x - last.x) < TOL && Math.abs(first.y - last.y) < TOL) {
      // Remove duplicate last point
      contour.pop()
    }

    if (contour.length >= 3) {
      contours.push(contour)
    }
  }

  return contours
}

// ── DXF Parser ──────────────────────────────────────────────────────────────

interface DXFEntity {
  type: 'LINE' | 'CIRCLE' | 'ARC' | 'POLYLINE' | 'LWPOLYLINE'
  points: Array<{ x: number; y: number }>
  center?: { x: number; y: number }
  radius?: number
  startAngle?: number
  endAngle?: number
  closed?: boolean
}

/**
 * Minimal DXF parser: extracts LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE entities.
 *
 * DXF is a tag-value format: group codes on one line, values on the next.
 * We scan for the ENTITIES section and parse each entity until ENDSEC.
 */
function parseDXF(data: string): DXFEntity[] {
  const lines = data.split(/\r?\n/)
  const entities: DXFEntity[] = []

  // Find the ENTITIES section: look for "ENTITIES" as a value
  let i = 0
  let inEntities = false
  while (i < lines.length) {
    const tag = lines[i].trim()

    // Section name: tag 2 with value "ENTITIES" starts the entities section
    if (tag === '2' && i + 1 < lines.length && lines[i + 1].trim() === 'ENTITIES') {
      inEntities = true
      i += 2
      continue
    }

    // End of section
    if (inEntities && tag === '0' && i + 1 < lines.length && lines[i + 1].trim() === 'ENDSEC') {
      break
    }

    // Entity start: tag 0 with an entity type value
    if (inEntities && tag === '0' && i + 1 < lines.length) {
      const entityType = lines[i + 1].trim()
      i += 2
      const result = parseEntity(lines, i, entityType)
      if (result) {
        entities.push(result.entity)
        i = result.nextIndex
      }
      continue
    }

    i++
  }

  return entities
}

/** Parse a single DXF entity starting at line index `startIdx`. */
function parseEntity(
  lines: string[],
  startIdx: number,
  type: string,
): { entity: DXFEntity; nextIndex: number } | null {
  let i = startIdx
  let x = 0, y = 0
  let x2 = 0, y2 = 0
  let radius = 0
  let startAngle = 0, endAngle = 0
  let closed = false

  // Read all tag-value pairs until we hit the next entity (tag 0)
  while (i < lines.length) {
    const tag = lines[i].trim()
    if (tag === '0') break // Next entity or ENDSEC

    const value = i + 1 < lines.length ? lines[i + 1].trim() : ''

    switch (tag) {
      case '10': x = parseFloat(value); break
      case '20': y = parseFloat(value); break
      case '11': x2 = parseFloat(value); break
      case '21': y2 = parseFloat(value); break
      case '40': radius = parseFloat(value); break
      case '50': startAngle = parseFloat(value); break
      case '51': endAngle = parseFloat(value); break
      case '70':
        if (type === 'LWPOLYLINE') closed = (parseInt(value) & 1) === 1
        break
    }

    i += 2
  }

  switch (type) {
    case 'LINE':
      return {
        entity: { type: 'LINE', points: [{ x, y }, { x: x2, y: y2 }] },
        nextIndex: i,
      }
    case 'CIRCLE':
      return {
        entity: { type: 'CIRCLE', points: [], center: { x, y }, radius },
        nextIndex: i,
      }
    case 'ARC':
      return {
        entity: { type: 'ARC', points: [], center: { x, y }, radius, startAngle, endAngle },
        nextIndex: i,
      }
    case 'LWPOLYLINE': {
      // Re-parse to collect all vertices (10/20 pairs appear multiple times)
      const verts: Array<{ x: number; y: number }> = []
      let cx = 0
      for (let j = startIdx; j < i; j += 2) {
        const t = lines[j].trim()
        const v = j + 1 < lines.length ? lines[j + 1].trim() : ''
        if (t === '10') cx = parseFloat(v)
        if (t === '20') verts.push({ x: cx, y: parseFloat(v) })
      }
      return {
        entity: { type: 'LWPOLYLINE', points: verts, closed },
        nextIndex: i,
      }
    }
    case 'POLYLINE': {
      // 3D POLYLINE — parse following VERTEX entities
      const verts: Array<{ x: number; y: number }> = []
      let j = i
      while (j < lines.length) {
        const t = lines[j].trim()
        const v = j + 1 < lines.length ? lines[j + 1].trim() : ''
        if (t === '0' && v === 'VERTEX') {
          let vx = 0, vy = 0
          j += 2
          while (j < lines.length) {
            const vt = lines[j].trim()
            if (vt === '0') break
            const vv = j + 1 < lines.length ? lines[j + 1].trim() : ''
            if (vt === '10') vx = parseFloat(vv)
            if (vt === '20') vy = parseFloat(vv)
            j += 2
          }
          verts.push({ x: vx, y: vy })
        } else if (t === '0' && v === 'SEQEND') {
          j += 2
          break
        } else {
          j++
        }
      }
      return {
        entity: { type: 'POLYLINE', points: verts, closed: true },
        nextIndex: j,
      }
    }
    default:
      // Unknown entity type — skip (i is already at the next tag 0)
      return null
  }
}

/** Convert a DXF entity to an OCCT wire (ShapeHandle). */
function entityToWire(k: Awaited<ReturnType<typeof getExtKernel>>, entity: DXFEntity): ShapeHandle | null {
  const V3 = (x: number, y: number) => ({ x, y, z: 0 })

  switch (entity.type) {
    case 'LINE': {
      if (entity.points.length < 2) return null
      const edges = [
        k.makeLineEdge(V3(entity.points[0].x, entity.points[0].y), V3(entity.points[1].x, entity.points[1].y)),
      ]
      return k.makeWire(edges)
    }
    case 'CIRCLE': {
      if (!entity.center || !entity.radius) return null
      const segments = 72
      const edges: ShapeHandle[] = []
      const cx = entity.center.x, cy = entity.center.y, r = entity.radius
      for (let s = 0; s < segments; s++) {
        const a1 = (2 * Math.PI * s) / segments
        const a2 = (2 * Math.PI * (s + 1)) / segments
        edges.push(k.makeLineEdge(
          V3(cx + r * Math.cos(a1), cy + r * Math.sin(a1)),
          V3(cx + r * Math.cos(a2), cy + r * Math.sin(a2)),
        ))
      }
      return k.makeWire(edges)
    }
    case 'ARC': {
      if (!entity.center || !entity.radius) return null
      const segments = 36
      const edges: ShapeHandle[] = []
      const cx = entity.center.x, cy = entity.center.y, r = entity.radius
      const startRad = (entity.startAngle ?? 0) * Math.PI / 180
      const endRad = (entity.endAngle ?? 360) * Math.PI / 180
      for (let s = 0; s < segments; s++) {
        const a1 = startRad + (endRad - startRad) * s / segments
        const a2 = startRad + (endRad - startRad) * (s + 1) / segments
        edges.push(k.makeLineEdge(
          V3(cx + r * Math.cos(a1), cy + r * Math.sin(a1)),
          V3(cx + r * Math.cos(a2), cy + r * Math.sin(a2)),
        ))
      }
      return k.makeWire(edges)
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (entity.points.length < 2) return null
      const edges: ShapeHandle[] = []
      for (let s = 0; s < entity.points.length - 1; s++) {
        edges.push(k.makeLineEdge(
          V3(entity.points[s].x, entity.points[s].y),
          V3(entity.points[s + 1].x, entity.points[s + 1].y),
        ))
      }
      if (entity.closed && entity.points.length > 2) {
        edges.push(k.makeLineEdge(
          V3(entity.points[entity.points.length - 1].x, entity.points[entity.points.length - 1].y),
          V3(entity.points[0].x, entity.points[0].y),
        ))
      }
      return k.makeWire(edges)
    }
    default:
      return null
  }
}
