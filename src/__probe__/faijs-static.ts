/**
 * Static (no-wasm) inspection of the installed @faicad/faijs package.
 *
 * Rationale: loading faijs initialises the OCCT wasm kernel, which is slow and
 * unsuitable for the regular unit/CI stage. But the *contract* we generate code
 * against — which ops exist on the cad script face, and which unit constants
 * exist — is fully visible in the installed dist files. These helpers read that
 * contract from disk so capability probes can assert it without booting wasm.
 *
 * Sources (faijs 0.29.5):
 *   dist/lang/symbol-table.generated.js  — default-exported map, keys are the
 *     cad script-face op names used by check() for "function does not exist".
 *   dist/units.js                        — unit constants (MM/DEGREE/RADIAN...).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { faijsPackageDir } from './env'

export function faijsDistDir(): string | undefined {
  const pkg = faijsPackageDir()
  if (!pkg) return undefined
  const dist = join(pkg, 'dist')
  return existsSync(dist) ? dist : undefined
}

/** cad script-face op names, or null when faijs is not installed. */
export function scriptFaceSymbols(): Set<string> | null {
  const dist = faijsDistDir()
  if (!dist) return null
  const file = join(dist, 'lang', 'symbol-table.generated.js')
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const out = new Set<string>()
  const re = /^\s{4}"([A-Za-z0-9_]+)"\s*:/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.add(m[1])
  return out.size > 0 ? out : null
}

/** Matches `export { a, b, type C } from './x.js'` and pulls the value names. */
const EXPORT_GROUP_RE = /^export\s*\{([^}]*)\}/gm
/** Matches `export * from './x.js'` — a re-export the reader must follow. */
const EXPORT_STAR_RE = /^export\s*\*\s*from\s*'([^']+)'/gm
/** Matches `export declare const NAME` / `export function NAME` in a .d.ts. */
const EXPORT_DECL_RE = /^export\s+declare\s+(?:const|function|class|let)\s+([A-Za-z_][A-Za-z0-9_]*)/gm

function namesFromExportGroups(text: string, into: Set<string>): void {
  // Fresh regex per call: a shared /g regex carries lastIndex across calls.
  const groups = new RegExp(EXPORT_GROUP_RE.source, 'gm')
  let m: RegExpExecArray | null
  while ((m = groups.exec(text)) !== null) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '')
      // `a as b` → take the exported alias `b`.
      const alias = name.split(/\s+as\s+/).pop()
      if (alias && /^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) into.add(alias)
    }
  }
  const decls = new RegExp(EXPORT_DECL_RE.source, 'gm')
  while ((m = decls.exec(text)) !== null) into.add(m[1])
}

/**
 * Collect every name a `.d.ts` re-exports, following `export *` chains.
 *
 * Needed because the ① face is assembled through re-export barrels:
 * `index.d.ts` → `export * from './api/index.js'` → `export * from
 * './generated/script-face.js'` (that last hop is where `mirror` / `applyMatrix` /
 * `offset` / `convexHull` actually come from). Reading only the top two files
 * silently loses them — which is how a first cut of this reader "proved"
 * `convexHull` absent.
 */
function collectExports(file: string, into: Set<string>, seen: Set<string>, depth: number): void {
  if (depth > 6 || seen.has(file) || !existsSync(file)) return
  seen.add(file)
  const text = readFileSync(file, 'utf8')
  namesFromExportGroups(text, into)

  const stars = new RegExp(EXPORT_STAR_RE.source, 'gm')
  let m: RegExpExecArray | null
  while ((m = stars.exec(text)) !== null) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue // package specifiers are out of scope
    const base = resolve(dirname(file), spec)
    // `./x.js` resolves to `./x.d.ts` on disk.
    collectExports(base.endsWith('.js') ? `${base.slice(0, -3)}.d.ts` : base, into, seen, depth + 1)
    collectExports(`${base}.d.ts`, into, seen, depth + 1)
  }
}

/**
 * ① TS 兼容面（`@faicad/faijs` 主导出）的导出名集合。
 *
 * 这才是**第三方 TS 库作者**该用的面（`docs/ops-api-inventory.zh.md` §1）。
 * 与 ② 脚本面（`scriptFaceSymbols`）和内部 `mod.cad`（38 键 BREP 命名空间）
 * 是三个不同的东西——本项目 2026-10-06 曾把三者混为一谈，见勘误文档 §0。
 *
 * 读取方式：静态解析 `dist/index.d.ts` 并跟随 `export *` 链，无需 wasm。
 */
export function tsCompatFaceSymbols(): Set<string> | null {
  const dist = faijsDistDir()
  if (!dist) return null
  const out = new Set<string>()
  collectExports(join(dist, 'index.d.ts'), out, new Set(), 0)
  return out.size > 0 ? out : null
}

/** Unit constants exported by faijs (MM, CM, INCH, DEGREE, RADIAN, ...). */
export function unitConstants(): Map<string, string> | null {
  const dist = faijsDistDir()
  if (!dist) return null
  const file = join(dist, 'units.js')
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const out = new Map<string, string>()
  const re = /^export const ([A-Z][A-Z0-9_]*)\s*=\s*([^;]+);/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.set(m[1], m[2].trim())
  return out.size > 0 ? out : null
}
