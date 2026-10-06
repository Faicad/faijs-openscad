/**
 * faijs 静态校验器的薄封装（M2 门禁用）。
 *
 * 为什么不是「跑一遍生成的 .fai.js」：执行需要 OCCT wasm（`FAIJS_PROBE_RUNTIME=1`，
 * 慢且不在常规 CI 里）。但 emitter 最常犯的错——op 名不存在、字面量形态不合法、
 * 引用了未声明的变量、op 实参里出现被静态校验拦下的全局名——**全部**在
 * `extractMetadata` 这一步就会暴露，不需要求值几何。
 *
 * 这正是 `runtime.execute` 的第一步（见 emit/faijs-script-globals.probe.test.ts 的
 * L3 证据），所以静态通过是「执行能跑」的必要条件。
 *
 * faijs 未安装时返回 `null`，调用方据此 skip —— 不假装通过。
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { faijsDistDir } from './faijs-static'

/** 与 `runtime.execute` 内部调用 extractMetadata 的参数同形。 */
const EXTRACT_OPTS = { defaultNs: 'cad', security: 'strict', namespaces: [] as string[] }

export interface StaticCheckResult {
  readonly ok: boolean
  /** 校验失败时的首条错误消息。 */
  readonly message?: string
}

type ExtractFn = (code: string, opts?: Record<string, unknown>) => unknown

let cached: ExtractFn | null | undefined

/** 加载 faijs 的 metadata-extractor；不可用时返回 null（并缓存该结论）。 */
async function loadExtract(): Promise<ExtractFn | null> {
  if (cached !== undefined) return cached
  const dist = faijsDistDir()
  if (!dist) {
    cached = null
    return cached
  }
  try {
    const url = pathToFileURL(join(dist, 'lang', 'metadata-extractor.js')).href
    const mod = (await import(/* @vite-ignore */ url)) as { extractMetadata?: ExtractFn }
    cached = mod.extractMetadata ?? null
  } catch {
    cached = null
  }
  return cached
}

/** faijs 是否可做静态校验（安装了 @faicad/faijs 且 dist/lang/metadata-extractor.js 在）。 */
export async function staticCheckAvailable(): Promise<boolean> {
  return (await loadExtract()) !== null
}

export async function faijsStaticCheck(code: string): Promise<StaticCheckResult | null> {
  const extract = await loadExtract()
  if (!extract) return null
  try {
    extract(code, EXTRACT_OPTS)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
