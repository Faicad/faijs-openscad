/**
 * Quick probe: test if cad.sew or cad.compound works for 2D faces.
 * 
 * Usage: node tests/probe-2d-union.mjs
 */
import { createRuntime, createNodePorts, initOcctWasm } from '@faicad/faijs/node'

const log = (...a) => console.log(...a)

async function main() {
  await initOcctWasm()
  const rt = createRuntime(createNodePorts(), 'brep')

  // Create two 2D profiles (squares)
  const code = `
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

  // Test 1: cad.union (expected to fail)
  try {
    const r = await rt.execute(code + '\nlet out = cad.union(a, b)', { topology: 'auto' })
    log('union:', r.failedAt ? `FAIL: ${r.failedAt.message}` : 'OK')
  } catch (e) { log('union: THROW', String(e.message ?? e).slice(0, 200)) }

  // Test 2: cad.sew
  try {
    const r = await rt.execute(code + '\nlet out = cad.sew(a, b)', { topology: 'auto' })
    log('sew:', r.failedAt ? `FAIL: ${r.failedAt.message}` : 'OK')
  } catch (e) { log('sew: THROW', String(e.message ?? e).slice(0, 200)) }

  // Test 3: cad.compound
  try {
    const r = await rt.execute(code + '\nlet out = cad.compound(a, b)', { topology: 'auto' })
    log('compound:', r.failedAt ? `FAIL: ${r.failedAt.message}` : 'OK')
  } catch (e) { log('compound: THROW', String(e.message ?? e).slice(0, 200)) }

  // Test 4: cad.intersect (2D)
  try {
    const r = await rt.execute(code + '\nlet out = cad.intersect(a, b)', { topology: 'auto' })
    log('intersect:', r.failedAt ? `FAIL: ${r.failedAt.message}` : 'OK')
  } catch (e) { log('intersect: THROW', String(e.message ?? e).slice(0, 200)) }

  // Test 5: cad.subtract (2D)
  try {
    const r = await rt.execute(code + '\nlet out = cad.subtract(a, b)', { topology: 'auto' })
    log('subtract:', r.failedAt ? `FAIL: ${r.failedAt.message}` : 'OK')
  } catch (e) { log('subtract: THROW', String(e.message ?? e).slice(0, 200)) }

  rt.dispose()
}

main().catch(e => { console.error(e); process.exit(1) })
