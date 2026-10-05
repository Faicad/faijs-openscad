/**
 * API-shape probe for the installed @faicad/faijs (permanent, run manually).
 *
 * Why this exists: the emitter must generate calls that actually match the
 * installed faijs. Symbol-table presence alone is not enough — the *call shape*
 * (positional vs named-object args, unit carriers, which layer exposes what,
 * which engine is registered) decides whether the emitted `.fai.js` runs.
 * Findings are pinned as assertions in the *.probe.test.ts files.
 *
 * Run:  FAIJS_PROBE_RUNTIME=1 node tests/probe-faijs-api.mjs
 */
const mod = await import('@faicad/faijs')
const { MM } = await import('@faicad/faijs/units')

const top = Object.keys(mod).sort()
console.log('top-level export count:', top.length)
console.log('unit constants on top level:', top.filter((k) => /^(MM|CM|INCH|DEGREE|RADIAN)$/.test(k)).join(', ') || '(none)')
console.log('createApiNamespace:', typeof mod.createApiNamespace)
console.log('registerBrepEngine:', typeof mod.registerBrepEngine)

const cad = mod.cad ?? mod.default?.cad
console.log('mod.cad key count:', cad ? Object.keys(cad).length : 0)

const TS_OPS = [
  'box', 'sphere', 'cylinder', 'cone', 'union', 'subtract', 'intersect',
  'translate', 'rotate_euler', 'scale', 'mirror', 'applyMatrix', 'profile',
  'extrude', 'revolve', 'volume', 'compound', 'convexHull', 'offset',
  'polyhedron', 'hull', 'minkowski', 'boxBrep', 'fuseBrep', 'cutBrep',
]
if (cad) console.log('  TS cad layer:', TS_OPS.map((k) => `${k}=${typeof cad[k]}`).join(' '))

for (const sub of ['@faicad/faijs/units', '@faicad/faijs/node', '@faicad/faijs/api']) {
  try {
    const m = await import(sub)
    console.log(`${sub}: exports=${Object.keys(m).length}`)
    if (sub.endsWith('/units')) {
      for (const u of ['MM', 'DEGREE', 'RADIAN']) console.log(`  ${u} = ${m[u]}`)
    }
  } catch (e) {
    console.log(`${sub}: IMPORT FAILED (${e.code ?? e.message})`)
  }
}

if (process.env.FAIJS_PROBE_RUNTIME !== '1') process.exit(0)

async function attempt(label, fn) {
  try {
    const v = await fn()
    const shown = typeof v === 'number' ? v : typeof v === 'object' && v !== null ? '[object]' : String(v)
    console.log(`  OK   ${label}: ${shown}`)
    return v
  } catch (e) {
    console.log(`  FAIL ${label}: ${e.message}`)
    return undefined
  }
}

console.log('--- TS-layer smoke (default engine) ---')
const a = await attempt('box(20,20,20,{centered:true})', () => cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true }))
await attempt('volume(box20) [expect 8000]', () => cad.volume(a))
const moved = await attempt('translate(a,{offset:[5,0,0]})', () => cad.translate(a, { offset: [5 * MM, 0, 0] }))
await attempt('volume(translated) [expect 8000]', () => cad.volume(moved))
const c = await attempt('box(20,20,20,{centered:false})', () => cad.box(20 * MM, 20 * MM, 20 * MM))
await attempt('union(a, itself)', () => cad.union(a, a))
await attempt('union(a, c)', () => cad.union(a, c))
await attempt('intersect(a, c)', () => cad.intersect(a, c))
await attempt('subtract(a, c)', () => cad.subtract(a, c))
await attempt('volume(sphere r=10) [exact 4188.79]', async () => cad.volume(await cad.sphere({ radius: 10 * MM })))
await attempt('cylinder(h=10,r=5) [exact 785.4]', async () =>
  cad.volume(await cad.cylinder(10 * MM, 5 * MM)),
)
