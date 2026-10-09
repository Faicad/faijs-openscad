/**
 * Verify all 50 examples transpile with the structured path (parseScad → lowerScad → emitFaijs).
 * Checks: zero error diagnostics (warnings are OK).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseScad } from '../src/scad/parser'
import { lowerScad } from '../src/ir/lower-scad'
import { emitFaijs } from '../src/emit/faijs'

const examplesDir = join('tests', 'fixtures', 'openscad-examples')

function findScadFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      results.push(...findScadFiles(path))
    } else if (entry.endsWith('.scad')) {
      results.push(path)
    }
  }
  return results.sort()
}

const files = findScadFiles(examplesDir)
console.log(`Found ${files.length} .scad files`)

let passCount = 0
let failCount = 0
const failures: { file: string; errors: string[]; warnings: string[] }[] = []

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const label = file.replace(examplesDir + '/', '')
  
  try {
    const parsed = parseScad(text, { path: label })
    const lowered = lowerScad(parsed.document, { path: label })
    const emitted = emitFaijs(lowered.model, { header: false })
    
    const errors = [...parsed.diagnostics, ...lowered.diagnostics]
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.code}: ${d.message}`)
    
    const warnings = [...parsed.diagnostics, ...lowered.diagnostics]
      .filter((d) => d.severity === 'warning')
      .map((d) => `${d.code}: ${d.message}`)
    
    if (errors.length > 0 || !emitted.ok) {
      failCount++
      failures.push({ file: label, errors: errors.length > 0 ? errors : ['emit failed'], warnings })
    } else {
      passCount++
      if (warnings.length > 0) {
        console.log(`  ✓ ${label} (${warnings.length} warnings)`)
      }
    }
  } catch (e) {
    failCount++
    failures.push({ file: label, errors: [String(e)], warnings: [] })
  }
}

console.log(`\nResults: ${passCount}/${files.length} passed, ${failCount} failed`)

if (failures.length > 0) {
  console.log('\nFailures:')
  for (const f of failures) {
    console.log(`  ✗ ${f.file}`)
    for (const e of f.errors) console.log(`    ERROR: ${e}`)
  }
  process.exit(1)
} else {
  console.log('\n✅ All 50 examples transpile with --structured (zero error diagnostics)')
}
