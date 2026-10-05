/** `explain [CODE]` — render the diagnostic code table (plan §8). */
import { explainAllCodes, explainCode } from '../../diagnostics/format'
import { isKnownDiagnosticCode } from '../../diagnostics/codes'

export function runExplain(code?: string): number {
  if (!code) {
    process.stdout.write(`${explainAllCodes()}\n`)
    return 0
  }
  const normalized = code.toUpperCase()
  if (!isKnownDiagnosticCode(normalized)) {
    process.stderr.write(`${explainCode(normalized)}\n`)
    return 1
  }
  process.stdout.write(`${explainCode(normalized)}\n`)
  return 0
}
