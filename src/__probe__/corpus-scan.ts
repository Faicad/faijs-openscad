/**
 * 语料扫描（共享工具）：从锁定的 OpenSCAD checkout 读出 CSG golden 的节点直方图。
 *
 * 抽出来的原因：同一段扫描逻辑原先在三处各写了一份 ——
 *   - `src/csg/csg-node-vocabulary.probe.test.ts`（词表探针）
 *   - `src/ir/shipped-scope.test.ts`（v0 范围守门）
 *   - `tests/coverage.ts`（覆盖率报告脚本）
 * 三份实现一旦漂移，「97.01% 可直接落地」这个数字会在报告和门禁之间对不上，
 * 而它正是决定里程碑范围的依据。所以只留一份。
 *
 * 位于 `src/__probe__/` 之下：该目录被 `tsconfig.build.json` 排除，不会进入
 * 发布产物 —— 这些函数只服务于测试与报告脚本。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CSG dump 里一行节点的形状：可选修饰符 + 可选空白 + 名字 + `(`。
 *
 * ⚠️ 修饰符与名字之间的 `\s*` 不能省。实测语料里有 29 行形如
 * `%\tcylinder(...)` / `%#\tcylinder(...)` —— 修饰符后面是**制表符**而不是
 * 紧贴名字。早先一版正则写作 `[%#!*]?` 且不允许中间空白，把这 29 个节点
 * （cylinder / cube / group / intersection / sphere / circle）静默漏掉，
 * 使节点总数停在 17624 而不是真实的 17653。这个 bug 是靠「AST 直方图 vs
 * 文本直方图对账」暴露出来的，见 `src/csg/corpus-parse.test.ts`。
 */
export const NODE_LINE = /^\s*[%#!*]*\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/

/** CSG dump 里一行的前置修饰符（`!`/`*` 已被 OpenSCAD 在导出前消解）。 */
export const MODIFIER_LINE = /^\s*([%#!*])/

/** 语料在两个目录下，都要扫。 */
export const CORPUS_SUBDIRS = [
  ['tests', 'regression', 'dump'],
  ['tests', 'regression', 'dump-examples'],
] as const

export function corpusFiles(root: string): string[] {
  const out: string[] = []
  for (const parts of CORPUS_SUBDIRS) {
    const dir = join(root, ...parts)
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.endsWith('-expected.csg')) out.push(join(dir, name))
    }
  }
  return out.sort()
}

export interface CorpusVocabulary {
  readonly nodes: Map<string, number>
  readonly modifiers: Map<string, number>
  readonly files: number
}

export function scanVocabulary(root: string): CorpusVocabulary {
  const nodes = new Map<string, number>()
  const modifiers = new Map<string, number>()
  let files = 0
  for (const file of corpusFiles(root)) {
    files++
    const text = readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = NODE_LINE.exec(line)
      if (m) nodes.set(m[1], (nodes.get(m[1]) ?? 0) + 1)
      const mod = MODIFIER_LINE.exec(line)
      if (mod) modifiers.set(mod[1], (modifiers.get(mod[1]) ?? 0) + 1)
    }
  }
  return { nodes, modifiers, files }
}
