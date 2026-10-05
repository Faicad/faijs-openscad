import { defaultSeverityOf, DiagnosticCode, DIAGNOSTIC_CODES, isDowngradable } from './codes'

export type { DiagnosticSeverity } from './codes'

/**
 * A source span inside CSG text (or, when known, inside the originating .scad).
 * `line`/`column` are 1-based; `offset` is 0-based into the text the span refers to.
 */
export interface Span {
  readonly start: { line: number; column: number; offset: number }
  readonly end: { line: number; column: number; offset: number }
}

export interface Diagnostic {
  readonly code: string
  readonly severity: 'error' | 'warning' | 'info'
  readonly message: string
  /** File the span refers to. Omitted for span-less diagnostics. */
  readonly path?: string
  readonly span?: Span
  readonly hint?: string
  readonly nodeId?: number
}

export interface DiagnosticInput {
  code: string
  message: string
  severity?: 'error' | 'warning' | 'info'
  path?: string
  span?: Span
  hint?: string
  nodeId?: number
}

/** Create a diagnostic, filling severity/hint from the code registry. */
export function diagnostic(input: DiagnosticInput): Diagnostic {
  const meta = defaultSeverityOf(input.code)
  return {
    code: input.code,
    severity: input.severity ?? meta,
    message: input.message,
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.span === undefined ? {} : { span: input.span }),
    hint: input.hint ?? hintFor(input.code),
    ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
  }
}

function hintFor(code: string): string | undefined {
  return DIAGNOSTIC_CODES.find((m) => m.code === code)?.hint
}

/** Collect diagnostics with an aggregate query API. */
export class DiagnosticBag {
  private readonly items: Diagnostic[] = []

  add(input: DiagnosticInput): Diagnostic {
    const d = diagnostic(input)
    this.items.push(d)
    return d
  }

  addAll(inputs: readonly DiagnosticInput[]): void {
    for (const i of inputs) this.add(i)
  }

  /** Merge another bag (e.g. from a nested pass). */
  merge(other: DiagnosticBag | readonly Diagnostic[]): void {
    const list = other instanceof DiagnosticBag ? other.all() : other
    this.items.push(...list)
  }

  all(): readonly Diagnostic[] {
    return this.items
  }

  get size(): number {
    return this.items.length
  }

  errors(): Diagnostic[] {
    return this.items.filter((d) => d.severity === 'error')
  }

  warnings(): Diagnostic[] {
    return this.items.filter((d) => d.severity === 'warning')
  }

  infos(): Diagnostic[] {
    return this.items.filter((d) => d.severity === 'info')
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'error')
  }

  hasCode(code: string): boolean {
    return this.items.some((d) => d.code === code)
  }

  /**
   * `--allow-partial`: downgrade *downgradable* errors to warnings.
   * Non-downgradable codes (syntax errors, dimension errors, ...) stay errors —
   * a partial run must still never emit silently-wrong geometry.
   */
  downgradePartial(): Diagnostic[] {
    const changed: Diagnostic[] = []
    for (let i = 0; i < this.items.length; i++) {
      const d = this.items[i]
      if (d.severity === 'error' && isDowngradable(d.code)) {
        const next: Diagnostic = { ...d, severity: 'warning' }
        this.items[i] = next
        changed.push(next)
      }
    }
    return changed
  }
}

export const UNKNOWN_NODE_CODE = DiagnosticCode.OSC1003
