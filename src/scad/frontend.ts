/**
 * 纯 TypeScript SCAD 前端适配层。
 *
 * 将 .scad 源代码通过自研 lexer → parser → evaluator → CSG dumper 转换为
 * 与 OpenSCAD `--export-format csg` 输出一致的 CSG 文本。
 *
 * 实现 FrontendKind = 'csg-text' 的 OpenScadFrontend 接口，
 * 但不需要外部 OpenSCAD 二进制进程。
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { DiagnosticBag, type Diagnostic } from '../diagnostics/diagnostic'
import { parseScad } from './parser'
import { evaluateModule, dumpCsgTree } from './module-evaluator'
import { Scope } from './value'
import { sha256Hex } from '../util/hash'
import type {
  CsgArtifact,
  CsgTextInput,
  FrontendInfo,
  OpenScadFrontend,
  ScadInput,
} from '../frontend/types'

export interface ScadFrontendOptions {
  /** Timestamp for import/surface nodes (defaults to 0). */
  readonly timestamp?: number
  /** Working directory for resolving include/use paths. */
  readonly cwd?: string
}

/**
 * Pure TypeScript SCAD frontend: parses .scad source, evaluates modules,
 * and dumps CSG text — no external OpenSCAD binary required.
 */
export class ScadFrontend implements OpenScadFrontend {
  readonly kind = 'csg-text' as const

  constructor(private readonly options: ScadFrontendOptions = {}) {}

  async inspect(): Promise<FrontendInfo> {
    return {
      kind: this.kind,
      available: true,
      identity: 'scad-frontend (pure TypeScript, no external OpenSCAD required)',
      diagnostics: [],
    }
  }

  async compileScad(input: ScadInput): Promise<CsgArtifact> {
    const bag = new DiagnosticBag()
    const filePath = resolve(input.filePath)
    const cwd = this.options.cwd ?? input.cwd ?? dirname(filePath)

    let source: string
    try {
      source = readFileSync(filePath, 'utf8')
    } catch (err) {
      const e = err as { code?: string; message?: string }
      bag.add({
        code: 'OSC5003' as never,
        message: `Failed to read .scad file: ${e.message ?? String(err)}`,
      })
      return {
        csgText: '',
        sha256: sha256Hex(''),
        producedBy: { kind: this.kind },
        sourcePath: input.filePath,
        diagnostics: bag.all(),
      }
    }

    const csgText = this.compileText(source, cwd, bag)

    return {
      csgText,
      sha256: sha256Hex(csgText),
      producedBy: { kind: this.kind },
      sourcePath: input.filePath,
      diagnostics: bag.all(),
    }
  }

  /** Compile .scad source text to CSG text. */
  compileText(source: string, cwd: string, bag?: DiagnosticBag): string {
    const ownBag = bag ?? new DiagnosticBag()

    // Parse the .scad source
    const { document, diagnostics } = parseScad(source, {})

    for (const d of diagnostics) {
      ownBag.add(d)
    }

    // Create root scope
    const scope = new Scope()

    // Set default special variables
    scope.set('$fn', { type: 'number', value: 0 })
    scope.set('$fa', { type: 'number', value: 12 })
    scope.set('$fs', { type: 'number', value: 2 })
    scope.set('$t', { type: 'number', value: 0 })
    scope.set('$preview', { type: 'boolean', value: true })

    // Evaluate modules → CSG tree → CSG text
    const nodes = evaluateModule(document.statements, scope, {
      cwd,
      timestamp: this.options.timestamp ?? 0,
    })

    return dumpCsgTree(nodes)
  }

  /** Compile already-existing CSG text (pass-through, for compatibility). */
  async compileCsgText(input: CsgTextInput): Promise<CsgArtifact> {
    const bag = new DiagnosticBag()
    return {
      csgText: input.text,
      sha256: sha256Hex(input.text),
      producedBy: { kind: this.kind },
      ...(input.label === undefined ? {} : { sourcePath: input.label }),
      diagnostics: bag.all(),
    }
  }
}

/**
 * Convenience function: compile .scad source to CSG text.
 */
export function compileScadToCsg(
  source: string,
  options: ScadFrontendOptions = {},
): { csgText: string; diagnostics: readonly Diagnostic[] } {
  const bag = new DiagnosticBag()
  const frontend = new ScadFrontend(options)
  const csgText = frontend.compileText(source, options.cwd ?? '.', bag)
  return { csgText, diagnostics: bag.all() }
}
