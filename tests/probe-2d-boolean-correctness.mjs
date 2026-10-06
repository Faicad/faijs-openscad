/**
 * Probe: verify 2D intersect/subtract produce correct geometry.
 * Two overlapping 10x10 squares at [0,0] and [5,5].
 * Intersection should be a 5x5 square = 25 area.
 * Difference should be 10*10 - 5*5 = 75 area.
 * 
 * Usage: node tests/probe-2d-boolean-correctness.mjs
 */
import { createRuntime, createNodePorts, initOcctWasm } from '@faicad/faijs/node'
import * as F from '@faicad/faijs'

const log = (...a) => console.log(...a)

async function main() {
  await initOcctWasm()
  const rt = createRuntime(createNodePorts(), 'brep')

  const profileCode = `
let a = cad.profile({ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 }
], closed: true }] })
let b = cad.profile({ contours: [{ segments: [
  { kind: 'line', x1: 5, y1: 5, x2: 15, y2: 5 },
  { kind: 'line', x1: 15, y1: 5, x2: 15, y2: 15 },
  { kind: 'line', x1: 15, y1: 15, x2: 5, y2: 15 },
  { kind: 'line', x1: 5, y1: 15, x2: 5, y2: 5 }
], closed: true }] })
`

  // Test intersect
  const r1 = await rt.execute(profileCode + '\nlet out = cad.intersect(a, b)', { topology: 'auto' })
  if (r1.failedAt) {
    log('intersect FAIL:', r1.failedAt.message)
  } else {
    const shape = r1.outputs.get('out')
    const area = await F.area(shape)
    log(`intersect: area=${area?.toFixed(4)} (expected 25)`)
  }

  // Test subtract
  const r2 = await rt.execute(profileCode + '\nlet out = cad.subtract(a, b)', { topology: 'auto' })
  if (r2.failedAt) {
    log('subtract FAIL:', r2.failedAt.message)
  } else {
    const shape = r2.outputs.get('out')
    const area = await F.area(shape)
    log(`subtract: area=${area?.toFixed(4)} (expected 75)`)
  }

  // Test compound (just groups them, area should be sum = 200 if measured)
  const r3 = await rt.execute(profileCode + '\nlet out = cad.compound(a, b)', { topology: 'auto' })
  if (r3.failedAt) {
    log('compound FAIL:', r3.failedAt.message)
  } else {
    const shape = r3.outputs.get('out')
    const area = await F.area(shape)
    log(`compound: area=${area?.toFixed(4)} (expected 200 if sum, 175 if union)`)
  }

  // Test: extrude then union (3D workaround for 2D union)
  const r4 = await rt.execute(profileCode + `
let a3 = cad.extrude(a, { length: 1 })
let b3 = cad.extrude(b, { length: 1 })
let u3 = cad.union(a3, b3)
let out = u3
`, { topology: 'auto' })
  if (r4.failedAt) {
    log('extrude-then-union FAIL:', r4.failedAt.message)
  } else {
    const shape = r4.outputs.get('out')
    const vol = await F.volume(shape)
    log(`extrude-then-union: vol=${vol?.toFixed(4)} (expected 175 = (100+100-25)*1)`)
  }

  rt.dispose()
}

main().catch(e => { console.error(e); process.exit(1) })
