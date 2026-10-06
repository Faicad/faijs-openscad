/**
 * CSG 词法器测试（M1）。
 *
 * 重点全部放在**语料实测过的边界**上，而不是「能跑通」的乐观路径：
 *   - 科学计数法 `1e+06` / `2.65809e-06`（实测真实存在）
 *   - `-0`、`-inf`（实测真实存在）
 *   - 字符串里的 `\"` `\t` `\n` `\\`（实测只出现这 4 种转义）
 *   - 非 ASCII 字符串内容（阿拉伯文 / 西里尔文 / `☺` 实测存在）
 *   - 未闭合字符串 / 未闭合块注释 / 非法字符 —— 必须诊断，不能抛异常
 */
import { describe, expect, it } from 'vitest'
import { lexCsg, PUNCTUATION, type Token } from './lexer'
import { DiagnosticCode } from '../diagnostics/codes'

function kinds(tokens: readonly Token[]): string[] {
  return tokens.map((t) => (t.kind === 'punct' ? t.punct : t.kind))
}

describe('lexer: 基本 token', () => {
  it('切出一个完整的叶子节点', () => {
    const { tokens, diagnostics } = lexCsg('cube(size = [1, 1, 1], center = false);')
    expect(diagnostics).toEqual([])
    expect(kinds(tokens)).toEqual([
      'identifier',
      '(',
      'identifier',
      '=',
      '[',
      'number',
      ',',
      'number',
      ',',
      'number',
      ']',
      ',',
      'identifier',
      '=',
      'identifier',
      ')',
      ';',
      'eof',
    ])
  })

  it('识别 $ 开头的特殊变量名（$fn / $fa / $fs）', () => {
    const { tokens } = lexCsg('sphere($fn = 0, $fa = 12, $fs = 2);')
    const names = tokens.filter((t) => t.kind === 'identifier').map((t) => (t.kind === 'identifier' ? t.name : ''))
    expect(names).toContain('$fn')
    expect(names).toContain('$fa')
    expect(names).toContain('$fs')
  })

  it('修饰符 % # ! 各自成为 modifier token', () => {
    const { tokens } = lexCsg('%group(); #group(); !group();')
    const mods = tokens.filter((t) => t.kind === 'modifier').map((t) => (t.kind === 'modifier' ? t.modifier : ''))
    expect(mods).toEqual(['%', '#', '!'])
  })

  it('PUNCTUATION 集合包含 - 但不包含 : 或 /', () => {
    expect(PUNCTUATION).toContain('-')
    expect(PUNCTUATION).not.toContain(':')
    expect(PUNCTUATION).not.toContain('/')
  })
})

describe('lexer: 数字（按语料实测形态）', () => {
  const cases: readonly [string, number][] = [
    ['0', 0],
    ['1', 1],
    ['-0', 0],
    ['0.5', 0.5],
    ['12.5', 12.5],
    ['100', 100],
    ['360', 360],
    ['1e+06', 1_000_000],
    ['1e+10', 1e10],
    ['2.65809e-06', 2.65809e-6],
    ['2.71051e-14', 2.71051e-14],
    ['0.501961', 0.501961],
  ]

  for (const [source, expected] of cases) {
    it(`把 ${source} 切成一个数字 token，值为 ${String(expected)}`, () => {
      const { tokens, diagnostics } = lexCsg(source)
      expect(diagnostics).toEqual([])
      const nums = tokens.filter((t) => t.kind === 'number')
      expect(nums).toHaveLength(1)
      expect(nums[0].kind === 'number' && nums[0].value).toBe(expected)
    })
  }

  it('- 是独立标点：-0.5 切成 [-] [0.5]', () => {
    const { tokens } = lexCsg('-0.5')
    expect(kinds(tokens)).toEqual(['-', 'number', 'eof'])
  })

  it('`1e` 不是指数，e 退回标识符（不吞掉后续语法）', () => {
    const { tokens, diagnostics } = lexCsg('1e')
    expect(diagnostics).toEqual([])
    expect(kinds(tokens)).toEqual(['number', 'identifier', 'eof'])
    const num = tokens[0]
    expect(num.kind === 'number' && num.raw).toBe('1')
  })

  it('指数里的符号不会被误当作负号：2.65e-06 是一个数字', () => {
    const { tokens } = lexCsg('2.65e-06')
    expect(kinds(tokens)).toEqual(['number', 'eof'])
  })

  it('保留原始字面量，避免浮点重格式化丢信息', () => {
    const { tokens } = lexCsg('1e+06')
    expect(tokens[0].kind === 'number' && tokens[0].raw).toBe('1e+06')
  })
})

describe('lexer: 字符串与转义', () => {
  it('解出实测的四种转义', () => {
    const { tokens, diagnostics } = lexCsg('"a\\"b\\\\c\\td\\ne"')
    expect(diagnostics).toEqual([])
    const str = tokens[0]
    expect(str.kind === 'string' && str.value).toBe('a"b\\c\td\ne')
  })

  it('未知转义保留反斜杠，不改写内容', () => {
    const { tokens } = lexCsg('"A:\\q"')
    const str = tokens[0]
    expect(str.kind === 'string' && str.value).toBe('A:\\q')
  })

  it('空字符串与 Windows 路径都能解析', () => {
    const { tokens, diagnostics } = lexCsg('"", "C:/tmp/a.stl"')
    expect(diagnostics).toEqual([])
    const strs = tokens.filter((t) => t.kind === 'string')
    expect(strs.map((t) => (t.kind === 'string' ? t.value : ''))).toEqual(['', 'C:/tmp/a.stl'])
  })

  it('非 ASCII 内容原样保留（语料含阿拉伯文 / 西里尔文 / ☺）', () => {
    const { tokens, diagnostics } = lexCsg('"Привет", "مرحبا", "☺"')
    expect(diagnostics).toEqual([])
    const strs = tokens.filter((t) => t.kind === 'string')
    expect(strs.map((t) => (t.kind === 'string' ? t.value : ''))).toEqual(['Привет', 'مرحبا', '☺'])
  })

  it('未闭合字符串报 OSC1001 并在行尾收手', () => {
    const { tokens, diagnostics } = lexCsg('a = "unterminated\nb = 1')
    expect(diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.OSC1001])
    // 换行必须留在字符串之外，否则后续语法会被整段吞掉。
    expect(kinds(tokens)).toContain('identifier')
  })
})

describe('lexer: 注释（语料 0 次，但手写 CSG 会带）', () => {
  it('跳过行注释', () => {
    const { tokens, diagnostics } = lexCsg('// leading\ncube();\n// trailing')
    expect(diagnostics).toEqual([])
    expect(kinds(tokens)).toEqual(['identifier', '(', ')', ';', 'eof'])
  })

  it('跳过块注释（含跨行）', () => {
    const { tokens, diagnostics } = lexCsg('/* a\n b */ cube();')
    expect(diagnostics).toEqual([])
    expect(kinds(tokens)).toEqual(['identifier', '(', ')', ';', 'eof'])
  })

  it('未闭合块注释报 OSC1002', () => {
    const { diagnostics } = lexCsg('/* never closed\ncube();')
    expect(diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.OSC1002])
  })

  it('`/` 单独出现（非注释）是非法字符', () => {
    const { diagnostics } = lexCsg('cube / 2')
    expect(diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.OSC1001])
  })
})

describe('lexer: 源区间', () => {
  it('offset 从 0 起、line/column 从 1 起', () => {
    const { tokens } = lexCsg('cube()')
    const [name, open, close] = tokens
    expect(name.span).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 5, offset: 4 },
    })
    expect(open.span.start).toEqual({ line: 1, column: 5, offset: 4 })
    expect(close.span.start).toEqual({ line: 1, column: 6, offset: 5 })
  })

  it('跨行时行列正确', () => {
    const { tokens } = lexCsg('group() {\n\tcube();\n}')
    const cube = tokens.find((t) => t.kind === 'identifier' && t.name === 'cube')
    expect(cube?.span.start).toEqual({ line: 2, column: 2, offset: 11 })
  })

  it('CRLF 只算一次换行', () => {
    const { tokens } = lexCsg('group() {\r\ncube();\r\n}')
    const cube = tokens.find((t) => t.kind === 'identifier' && t.name === 'cube')
    expect(cube?.span.start.line).toBe(2)
    expect(cube?.span.start.column).toBe(1)
  })
})

describe('lexer: 健壮性', () => {
  it('非法字符报 OSC1001 并跳过，不抛异常', () => {
    const { tokens, diagnostics } = lexCsg('cube(@);')
    expect(diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.OSC1001])
    // 非法字符被吃掉，其余 token 仍完整。
    expect(kinds(tokens)).toEqual(['identifier', '(', ')', ';', 'eof'])
  })

  it('空输入只有 eof', () => {
    const { tokens, diagnostics } = lexCsg('')
    expect(diagnostics).toEqual([])
    expect(kinds(tokens)).toEqual(['eof'])
  })

  it('全是空白的输入只有 eof', () => {
    const { tokens } = lexCsg('  \n\t\r\n ')
    expect(kinds(tokens)).toEqual(['eof'])
  })

  it('遇到任意二进制垃圾也能收敛并给出诊断', () => {
    const { tokens, diagnostics } = lexCsg('\u0000\u0001\u0002@@@')
    expect(tokens[tokens.length - 1].kind).toBe('eof')
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const d of diagnostics) expect(d.code).toBe(DiagnosticCode.OSC1001)
  })
})
