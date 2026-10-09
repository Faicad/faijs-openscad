# K01-K13 Implementation Plan (v3: Extension Library + openscad Namespace)

> Revision: v3. User corrections:
> 1. Write own extension library (like faijs-gears), do NOT modify faijs core.
> 2. Use own namespace `openscad`, do NOT merge into `cad`.

## Architecture: Extension Library with Own Namespace

### Pattern (reference: faijs-gears)

faijs-gears is a standalone subpackage: `peerDependencies: { "@faicad/faijs", "occt-wasm" }`, gets raw kernel via `initOcctWasm()`, implements ops using kernel methods directly, does NOT touch faijs core.

### Our Extension

Create `packages/ext/` inside faijs-openscad, exporting an **`openscad` namespace** (not merged into `cad`):

```
faijs-openscad/
  packages/ext/                   # @faicad/faijs-openscad-ext
    package.json                  # peerDeps: @faicad/faijs, occt-wasm
    src/
      kernel/index.ts             # getExtKernel() -> initOcctWasm()
      ops/
        hull.ts                   # K01
        polyhedron.ts             # K04
        twist-extrude.ts          # K06
        connect-edges.ts          # K07 (ported from faijs-gears)
        projection.ts             # K08/K09
        surface-interp.ts         # K11
        offset-hardened.ts        # K13
      namespace.ts                # createOpenSCADNamespace() -> { hull, polyhedron, ... }
      index.ts
  src/ir/lower-scad.ts            # builtinChain: add cases
  src/emit/faijs.ts               # emitter: openscad as script-face global
```

### Namespace Separation

Two distinct namespaces in generated code:

| Namespace | Source | Used for |
|-----------|--------|----------|
| `cad` | faijs core + faijs-extra | Existing ops: `cad.box()`, `cad.text()`, `cad.offset2d()`, `cad.load()`, etc. |
| `openscad` | Our extension | OpenSCAD-specific ops: `openscad.hull()`, `openscad.polyhedron()`, `openscad.twistExtrude()`, etc. |

**No merging, no override, no collision risk.** Clear provenance: `cad.*` = faijs, `openscad.*` = ours.

### Host Setup

```typescript
import { createEditorCadNamespace } from '@faicad/faijs-extra'
import { createOpenSCADNamespace } from '@faicad/faijs-openscad-ext'

rt.registerLib('cad', createEditorCadNamespace(), { default: true })
rt.registerLib('openscad', createOpenSCADNamespace())
```

### Emitter Change

Currently `cad` and `MM` are script-face globals (no import lines). Add `openscad` as a third script-face global.

Generated code example:
```javascript
// cad.* for existing faijs ops
let part0 = await cad.box(10, 10, 10, false)
// openscad.* for our extension ops
let part1 = await openscad.hull([part0])
let result = part1
```

## Task Classification

### Only faijs-openscad side, emits `cad.*` (faijs already has the op)

| Task | Existing faijs op | Emitted call |
|------|------------------|-------------|
| K02 text | `cad.text()` in faijs-extra | `cad.text(text, { size, font })` |
| K03 import | `cad.load({file})` in faijs-extra | `cad.load({ file: 'f.stl' })` |
| K05 offset | `cad.offset2d()` in faijs core | `cad.offset2d(child, { delta, chamfer })` |

### Extension library + faijs-openscad side, emits `openscad.*`

| Task | Extension op | Emitted call |
|------|-------------|-------------|
| K01 hull | `openscad.hull(shapes)` | `openscad.hull(__children)` |
| K04 polyhedron | `openscad.polyhedron(points, faces)` | `openscad.polyhedron(points, faces)` |
| K06 twist | `openscad.twistExtrude(profile, h, twist, scale?)` | `openscad.twistExtrude(...)` |
| K07 connectEdgesToWires | internal utility (not directly emitted) | used by K08/K09 |
| K08 projection cut | `openscad.projectCut(shape)` | `openscad.projectCut(child)` |
| K09 projection outline | `openscad.projectOutline(shape)` | `openscad.projectOutline(child)` |
| K11 surface interp | `openscad.surfaceInterp(points, rows, cols)` | `openscad.surfaceInterp(...)` |
| K13 offset harden | `openscad.offset2d(profile, delta, chamfer)` | `openscad.offset2d(child, delta, chamfer)` |

### Deferred

| Task | Reason |
|------|--------|
| K10 loft compatibility | occt-wasm loft lacks CheckCompatibility option. Non-blocking. |
| K12 exportStep options | occt-wasm toSTEP lacks advanced options. Non-blocking. |

## occt-wasm Already-Exposed APIs

All on occt-wasm 5.6.0 OcctKernel (verified from index.d.ts, 653 lines):

- `getSubShapes(shape, type)` / `vertexPosition(vertex)` - sub-shape extraction
- `curveParameters(edge)` / `curvePointAtParam(edge, param)` - edge endpoints (B-spline safe)
- `makeLineEdge(a, b)` / `makeWire(edges[])` / `makeFace(wire)` - topology construction
- `reverseShape(shape)` - reverse direction
- `sew(shapes[], tol)` / `makeSolid(shell)` - sewing
- `buildTriFace(a, b, c)` - triangle face
- `convexHull(points[])` - QuickHull
- `sectionByPlane(shape, plane)` - planar section
- `projectEdges(shape, dir)` - edge projection (returns flattened edges)
- `sweepFull(profile, spine, opts)` - sweep with law
- `makeHelixWireHanded(o, a, p, h, r, left?)` - handed helix
- `interpolatePoints(points[], periodic?)` - B-spline interpolation
- `loft(wires[], isSolid?, ruled?)` - loft
- `offsetFace(face, delta, chamfer)` - face offset

## Per-Task Implementation

### K01 hull

Extension `ops/hull.ts`:
```typescript
export async function hull(shapes: BrepHandle[]): Promise<BrepHandle> {
  const k = await getExtKernel()
  const points: BrepVec3[] = []
  for (const s of shapes) {
    for (const v of k.getSubShapes(s, 'vertex')) points.push(k.vertexPosition(v))
  }
  const triangles = k.convexHull(points)
  const faces = triangles.map(t => k.buildTriFace(t.a, t.b, t.c))
  return k.makeSolid(k.sew(faces))
}
```
faijs-openscad: `case 'hull'` -> `openscad.hull(__children)`

### K02 text
faijs-openscad only: `case 'text'` -> `cad.text(text, { size, font })`

### K03 import
faijs-openscad only: `import("f.stl")` -> `cad.load({ file: 'f.stl' })`

### K04 polyhedron

Extension `ops/polyhedron.ts`:
```typescript
export async function polyhedron(points: BrepVec3[], faces: number[][]): Promise<BrepHandle> {
  const k = await getExtKernel()
  const triFaces: BrepHandle[] = []
  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i++)
      triFaces.push(k.buildTriFace(points[face[0]], points[face[i]], points[face[i+1]]))
  }
  return k.makeSolid(k.sew(triFaces))
}
```
faijs-openscad: `case 'polyhedron'` -> `openscad.polyhedron(points, faces)`

### K05 offset
faijs-openscad only: `case 'offset'` -> `cad.offset2d(child, { delta, chamfer })`

### K06 twist extrude

Extension `ops/twist-extrude.ts`:
```typescript
export async function twistExtrude(
  profile: BrepHandle, height: number, twist: number, scale?: number,
): Promise<BrepHandle> {
  const k = await getExtKernel()
  const leftHanded = twist < 0
  const pitch = twist !== 0 ? height / (Math.abs(twist) / 360) : Infinity
  const spine = k.makeHelixWireHanded([0,0,0], [0,0,1], pitch, height, 0, leftHanded)
  const opts: SweepFullOptions = { law: 'Linear' }
  if (scale !== undefined) opts.lawEndFactor = scale
  return k.sweepFull(profile, spine, opts)
}
```
faijs-openscad: `linear_extrude` with twist/scale -> `openscad.twistExtrude(profile, height, twist, scale)`

### K07 connectEdgesToWires

Extension `ops/connect-edges.ts`: **verbatim port** from faijs-gears `kernel/gears.ts`.
Uses: `curveParameters` + `curvePointAtParam` + `makeLineEdge` + `reverseShape` + `makeWire`.
O(n^2) endpoint matching + gap bridging. Type rename GearKernel -> ExtKernel only.

Internal utility, not directly emitted in generated code. Used by K08/K09.

### K08 projection(cut=true)

Extension `ops/projection.ts`:
```typescript
export async function projectCut(shape: BrepHandle): Promise<BrepHandle> {
  const k = await getExtKernel()
  const section = k.sectionByPlane(shape, { point: [0,0,0], normal: [0,0,1] })
  const edges = k.getSubShapes(section, 'edge')
  const wires = connectEdgesToWires(k, edges, 1e-2)
  const faces = wires.map(w => k.makeFace(w))
  if (faces.length === 0) return k.makeEmptyShape()
  return faces.length === 1 ? faces[0] : k.sew(faces)
}
```
faijs-openscad: `case 'projection'` cut=true -> `openscad.projectCut(child)`

### K09 projection(cut=false)

Extension `ops/projection.ts`:
```typescript
export async function projectOutline(shape: BrepHandle): Promise<BrepHandle> {
  const k = await getExtKernel()
  const projData = k.projectEdges(shape, [0, 0, 1])
  const edges = projData.edges ?? k.getSubShapes(projData.shape, 'edge')
  const wires = connectEdgesToWires(k, edges, 1e-2)
  const faces = wires.map(w => k.makeFace(w))
  if (faces.length === 0) return k.makeEmptyShape()
  return faces.length === 1 ? faces[0] : k.sew(faces)
}
```
faijs-openscad: `case 'projection'` cut=false -> `openscad.projectOutline(child)`

### K11 surface interpolation

Extension `ops/surface-interp.ts`:
```typescript
export async function surfaceInterp(
  points: BrepVec3[], rows: number, cols: number,
): Promise<BrepHandle> {
  const k = await getExtKernel()
  const curves: BrepHandle[] = []
  for (let r = 0; r < rows; r++) {
    const rowPoints = points.slice(r * cols, (r + 1) * cols)
    curves.push(k.interpolatePoints(rowPoints, false))
  }
  return k.makeSolid(k.loft(curves, true, false))
}
```
faijs-openscad: `case 'surface'` -> `openscad.surfaceInterp(points, rows, cols)`

### K13 offset hardening

Extension `ops/offset-hardened.ts`:
```typescript
export async function offset2d(
  profile: BrepHandle, delta: number, chamfer: boolean,
): Promise<BrepHandle> {
  const k = await getExtKernel()
  try {
    return k.offsetFace(profile, delta, chamfer)
  } catch (e) {
    if (Math.abs(delta) < 1e-6) throw e
    const half = delta / 2
    const a = await offset2d(profile, half, chamfer)
    return offset2d(a, half, chamfer)
  }
}
```
faijs-openscad: `case 'offset'` -> `openscad.offset2d(child, delta, chamfer)`

Note: This does NOT override `cad.offset2d`. It is a separate `openscad.offset2d`.
We can choose at mapping time which to use (K05 uses `cad.offset2d`, K13 uses `openscad.offset2d`).
Or simply always use `openscad.offset2d` for OpenSCAD `offset()` module.

## Implementation Order

### Setup (before everything)

| Task | Effort |
|------|--------|
| Create packages/ext/ scaffold (package.json, tsconfig, kernel/index.ts, namespace.ts, index.ts) | 0.25d |
| Emitter: add `openscad` as script-face global | 0.1d |

### Batch 1 (parallel, no interdependencies)

| Task | Effort | Emits | Files |
|------|--------|-------|-------|
| K02 text | 0.25d | `cad.text` | lower-scad.ts |
| K03 import | 0.25d | `cad.load` | lower-scad.ts |
| K05 offset | 0.25d | `cad.offset2d` | lower-scad.ts |
| K01 hull | 0.5d | `openscad.hull` | ext/ops/hull.ts, lower-scad.ts |
| K04 polyhedron | 0.5d | `openscad.polyhedron` | ext/ops/polyhedron.ts, lower-scad.ts |
| K06 twist | 0.5d | `openscad.twistExtrude` | ext/ops/twist-extrude.ts, lower-scad.ts |
| K07 connectEdgesToWires | 0.25d | (internal) | ext/ops/connect-edges.ts |
| K11 surface interp | 0.5d | `openscad.surfaceInterp` | ext/ops/surface-interp.ts, lower-scad.ts |
| K13 offset harden | 0.25d | `openscad.offset2d` | ext/ops/offset-hardened.ts, lower-scad.ts |

### Batch 2 (depends on K07)

| Task | Effort | Emits | Files |
|------|--------|-------|-------|
| K08 projection cut | 0.5d | `openscad.projectCut` | ext/ops/projection.ts, lower-scad.ts |
| K09 projection outline | 0.25d | `openscad.projectOutline` | ext/ops/projection.ts (same) |

## Total Effort

- Setup: 0.35d
- Batch 1: 3.25d (9 tasks, parallelizable)
- Batch 2: 0.75d (2 tasks)
- **Total: 4.35d**

## What We Do NOT Touch

- faijs core (`/root/faijs/packages/core/`) -- zero changes
- faijs-extra (`/root/faijs/packages/faijs-extra/`) -- zero changes
- occt-wasm -- zero changes
- faijs-gears -- only read for reference (K07 port)
- `cad` namespace -- not modified, not extended, not overridden

## Namespace Summary

| Namespace | Ops | Source |
|-----------|-----|--------|
| `cad` | box, sphere, cylinder, cone, union, difference, intersect, extrude, revolve, text, load, offset2d, ... | faijs core + faijs-extra (untouched) |
| `openscad` | hull, polyhedron, twistExtrude, projectCut, projectOutline, surfaceInterp, offset2d | our extension (packages/ext/) |
