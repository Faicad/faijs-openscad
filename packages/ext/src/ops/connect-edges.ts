/**
 * K07: connectEdgesToWires — connect unordered OCCT edges into closed wires.
 *
 * Ported from the faijs-gears pattern (kernel/gears.ts).  Section and HLR
 * operations return a compound of unordered edges; this utility matches
 * endpoints (O(n²)) and chains them into closed wires, bridging small gaps
 * with makeLineEdge when endpoints don't exactly coincide.
 *
 * Used internally by K08 (projectCut) and K09 (projectOutline).  Not directly
 * emitted in generated code.
 */
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'

interface EdgeInfo {
  handle: ShapeHandle
  start: Vec3
  end: Vec3
  used: boolean
}

function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function vecEq(a: Vec3, b: Vec3, tol: number): boolean {
  return dist(a, b) < tol
}

/**
 * Connect unordered edges into closed wires.
 *
 * Algorithm:
 * 1. For each edge, extract start/end points via curveParameters + curvePointAtParam.
 * 2. Greedily chain edges by matching endpoints (within tolerance).
 * 3. When a gap is found between two edges that should connect, bridge it
 *    with makeLineEdge.
 * 4. Reverse edges (reverseShape) as needed to maintain chain direction.
 * 5. Group chained edges into wires via makeWire.
 *
 * @param kernel  The OCCT kernel instance.
 * @param edges   Array of edge ShapeHandles (unordered).
 * @param tol     Endpoint matching tolerance (default 1e-2).
 * @returns       Array of wire ShapeHandles (each wire is a closed loop).
 */
export function connectEdgesToWires(
  kernel: OcctKernel,
  edges: ShapeHandle[],
  tol = 1e-2,
): ShapeHandle[] {
  if (edges.length === 0) return []

  // Extract start/end points for each edge.
  const infos: EdgeInfo[] = []
  for (const edge of edges) {
    const params = kernel.curveParameters(edge)
    const start = kernel.curvePointAtParam(edge, params.first)
    const end = kernel.curvePointAtParam(edge, params.last)
    infos.push({ handle: edge, start, end, used: false })
  }

  const wires: ShapeHandle[] = []

  for (let i = 0; i < infos.length; i++) {
    if (infos[i].used) continue

    // Start a new wire chain from edge i.
    const chain: ShapeHandle[] = []
    infos[i].used = true
    chain.push(infos[i].handle)
    let currentEnd = infos[i].end
    const wireStart = infos[i].start

    // Greedily extend the chain by matching endpoints.
    let found = true
    while (found && !vecEq(currentEnd, wireStart, tol)) {
      found = false
      for (let j = 0; j < infos.length; j++) {
        if (infos[j].used) continue

        // Try matching edge j's start to current end.
        if (vecEq(infos[j].start, currentEnd, tol)) {
          infos[j].used = true
          chain.push(infos[j].handle)
          currentEnd = infos[j].end
          found = true
          break
        }

        // Try matching edge j's end to current end (reverse needed).
        if (vecEq(infos[j].end, currentEnd, tol)) {
          infos[j].used = true
          const reversed = kernel.reverseShape(infos[j].handle)
          chain.push(reversed)
          currentEnd = infos[j].start // after reversal, end becomes start
          found = true
          break
        }
      }
    }

    // If the chain didn't close naturally, bridge the gap.
    if (!vecEq(currentEnd, wireStart, tol)) {
      // Find an unused edge that connects to currentEnd or wireStart.
      for (let j = 0; j < infos.length; j++) {
        if (infos[j].used) continue

        if (vecEq(infos[j].start, currentEnd, tol) && vecEq(infos[j].end, wireStart, tol)) {
          infos[j].used = true
          chain.push(infos[j].handle)
          currentEnd = wireStart
          break
        }
        if (vecEq(infos[j].end, currentEnd, tol) && vecEq(infos[j].start, wireStart, tol)) {
          infos[j].used = true
          const reversed = kernel.reverseShape(infos[j].handle)
          chain.push(reversed)
          currentEnd = wireStart
          break
        }
      }
    }

    // If still not closed, bridge with a line edge.
    if (!vecEq(currentEnd, wireStart, tol)) {
      const bridge = kernel.makeLineEdge(currentEnd, wireStart)
      chain.push(bridge)
    }

    if (chain.length > 0) {
      wires.push(kernel.makeWire(chain))
    }
  }

  return wires
}
