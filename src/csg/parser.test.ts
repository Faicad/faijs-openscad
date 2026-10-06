/**
 * CSG 解析器测试（M1）。
 *
 * 两类断言并重：
 *  1. **正确性** —— 语料实测过的每一种形态都能解析出预期的 AST。
 *  2. **终止性** —— 任何畸形输入都必须收敛（不死循环）且不抛异常。
 *     每个恢复分支都会报告诊断并前进；这组测试是那套逻辑的守门人。
 */
import { describe, expect, it } from 'vitest'
import { parseCsg } from './parser'
import { DiagnosticCode } from '../diagnostics/codes'
import {
  argumentAt,
  argumentOf,
  countCsgNodes,
  countCsgNodesByName,
  describeCsgValue,
  firstPositionalValue,
  positionalArguments,
  type CsgNumberValue,
  type CsgNode,
  type CsgValue,
  type CsgVectorValue,
} from './ast'

function one(text: string): CsgNode {
  const { document, diagnostics } = parseCsg(text)
  expect(diagnostics).toEqual([])
  expect(document.nodes).toHaveLength(1)
  return document.nodes[0]
}

describe('parser: 节点结构', () => {
  it('空文档产生零节点', () => {
    const { document, diagnostics } = parseCsg('')
    expect(diagnostics).toEqual([])
    expect(document.nodes).toEqual([])
    expect(document.span.start.offset).toBe(0)
  })

  it('叶子节点：cube(...) 以分号结尾、无子节点', () => {
    const node = one('cube(size = [1, 1, 1], center = false);')
    expect(node.name).toBe('cube')
    expect(node.terminator).toBe('semicolon')
    expect(node.children).toEqual([])
    expect(node.modifiers).toEqual([])
    expect(node.args.map((a) => a.name)).toEqual(['size', 'center'])
  })

  it('容器节点：group() { ... } 以花括号结尾并带子节点', () => {
    const node = one('group() {\n\tcube();\n\tsphere();\n}')
    expect(node.terminator).toBe('braces')
    expect(node.children.map((c) => c.name)).toEqual(['cube', 'sphere'])
    expect(node.bodySpan).toBeDefined()
  })

  it('空容器用分号写出时仍然保留「没有花括号」这个事实', () => {
    // 语料里 `intersection();` 这类空容器很常见，与 `intersection() {}`
    // 几何等价但文本不同 —— 保真要求保留差异。
    const bare = one('intersection();')
    const braced = one('intersection() {}')
    expect(bare.terminator).toBe('semicolon')
    expect(bare.bodySpan).toBeUndefined()
    expect(braced.terminator).toBe('braces')
    expect(braced.bodySpan).toBeDefined()
    expect(braced.children).toEqual([])
  })

  it('深层嵌套保持结构', () => {
    const node = one(`group() {
	multmatrix([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) {
		difference() {
			cube();
			sphere();
		}
	}
}`)
    expect(node.children).toHaveLength(1)
    const matrix = node.children[0]
    expect(matrix.name).toBe('multmatrix')
    const diff = matrix.children[0]
    expect(diff.name).toBe('difference')
    expect(diff.children.map((c) => c.name)).toEqual(['cube', 'sphere'])
  })

  it('多个顶层节点按顺序出现', () => {
    const { document } = parseCsg('group();\ngroup();\nminkowski(convexity = 0);')
    expect(document.nodes.map((n) => n.name)).toEqual(['group', 'group', 'minkowski'])
    expect(countCsgNodes(document)).toBe(3)
  })
})

describe('parser: 修饰符', () => {
  it('保留修饰符与出现顺序', () => {
    expect(one('%group();').modifiers).toEqual(['%'])
    expect(one('#group();').modifiers).toEqual(['#'])
    expect(one('%#group();').modifiers).toEqual(['%', '#'])
  })

  it('修饰符节点的 span 从修饰符本身开始', () => {
    const node = one('%group();')
    expect(node.span.start.offset).toBe(0)
    expect(node.nameSpan.start.offset).toBe(1)
  })
})

describe('parser: 值形态（覆盖语料实测的全部 6 种）', () => {
  it('number：含科学计数法与 -0', () => {
    const node = one('cube(size = [1e+06, 2.65809e-06, -0]);')
    const size = argumentOf(node, 'size')?.value
    expect(size?.kind).toBe('vector')
    const items = (size as CsgVectorValue).items
    expect(items.map((v) => (v.kind === 'number' ? v.value : NaN))).toEqual([
      1_000_000,
      2.65809e-6,
      -0,
    ])
    // raw 保留原字面量
    expect(items[0].kind === 'number' && items[0].raw).toBe('1e+06')
  })

  it('boolean：true / false', () => {
    const node = one('cube(center = false, convexity = true);')
    expect(argumentOf(node, 'center')?.value).toEqual(
      expect.objectContaining({ kind: 'boolean', value: false }),
    )
    expect(argumentOf(node, 'convexity')?.value).toEqual(
      expect.objectContaining({ kind: 'boolean', value: true }),
    )
  })

  it('string：保留 raw 与解转义后的内容', () => {
    const node = one('text(text = "a\\"b\\n", font = "Liberation Sans");')
    const text = argumentOf(node, 'text')?.value
    expect(text?.kind === 'string' && text.value).toBe('a"b\n')
    expect(text?.kind === 'string' && text.raw).toBe('"a\\"b\\n"')
  })

  it('undef', () => {
    const node = one('polygon(points = [], paths = undef);')
    expect(argumentOf(node, 'paths')?.value.kind).toBe('undef')
  })

  it('infinity：inf 与 -inf（语料实测存在）', () => {
    const node = one('cube(size = [inf, inf, inf], center = false);')
    const items = (argumentOf(node, 'size')?.value as CsgVectorValue).items
    expect(items.every((v) => v.kind === 'infinity' && v.sign === 1)).toBe(true)

    const neg = one('circle(r = -inf);')
    const r = argumentOf(neg, 'r')?.value
    expect(r?.kind === 'infinity' && r.sign).toBe(-1)
  })

  it('vector：空向量、嵌套矩阵、混合元素', () => {
    const empty = one('polyhedron(points = [], faces = []);')
    expect((argumentOf(empty, 'points')?.value as CsgVectorValue).items).toEqual([])

    const matrix = one(
      'multmatrix([[1, 0, 0, -10], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);',
    )
    // 矩阵是位置参数，不能用 argumentOf 取。
    const m = firstPositionalValue(matrix) as CsgVectorValue
    expect(m.kind).toBe('vector')
    expect(m.items).toHaveLength(4)
    expect((m.items[0] as CsgVectorValue).items).toHaveLength(4)
  })

  it('值的 span 覆盖自身、参数的 span 覆盖 name=value', () => {
    const node = one('cube(center = false);')
    const arg = argumentOf(node, 'center')
    expect(arg?.nameSpan?.start.offset).toBe(5)
    expect(arg?.span.start.offset).toBe(5)
    // `false` 结束于 offset 19，紧邻 `)`；`;` 之前
    expect(arg?.value.span.end.offset).toBe(19)
  })

  it('describeCsgValue 能渲染回接近原始的文本', () => {
    const node = one('cube(size = [1, 2.5, -0], center = undef, auto = [inf]);')
    const values: CsgValue[] = [
      argumentOf(node, 'size')!.value,
      argumentOf(node, 'center')!.value,
      argumentOf(node, 'auto')!.value,
    ]
    expect(values.map(describeCsgValue)).toEqual(['[1, 2.5, -0]', 'undef', '[inf]'])
  })
})

describe('parser: 位置参数（语料占 29%，只在 multmatrix / color 上）', () => {
  it('multmatrix 的 4×4 矩阵是位置参数', () => {
    const node = one('multmatrix([[1, 0, 0, -10], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);')
    expect(node.args).toHaveLength(1)
    expect(node.args[0].name).toBeUndefined()
    expect(node.args[0].nameSpan).toBeUndefined()
    expect(node.args[0].index).toBe(0)
    const matrix = node.args[0].value as CsgVectorValue
    expect(matrix.kind).toBe('vector')
    expect(matrix.items).toHaveLength(4)
    const row0 = (matrix.items[0] as CsgVectorValue).items
    expect(row0).toHaveLength(4)
    expect((row0[3] as CsgNumberValue).value).toBe(-10)
  })

  it('color 的 RGBA 向量是位置参数', () => {
    const node = one('color([-1, -1, -1, -1]);')
    expect(node.args).toHaveLength(1)
    expect(node.args[0].name).toBeUndefined()
    const rgba = node.args[0].value as CsgVectorValue
    expect(rgba.items.map((v) => (v.kind === 'number' ? v.value : NaN))).toEqual([-1, -1, -1, -1])
  })

  it('positionalArguments / firstPositionalValue 可直取，argumentOf 不会误配', () => {
    const node = one('color([1, 0, 0, 1]);')
    expect(positionalArguments(node)).toHaveLength(1)
    expect(firstPositionalValue(node)?.kind).toBe('vector')
    expect(argumentOf(node, 'c')).toBeUndefined()
  })

  it('两种参数可以共存，index 反映真实序号', () => {
    const node = one('color([1, 0, 0, 1], alpha = 0.5);')
    expect(node.args.map((a) => a.name)).toEqual([undefined, 'alpha'])
    expect(node.args.map((a) => a.index)).toEqual([0, 1])
    expect(positionalArguments(node)).toHaveLength(1)
  })

  it('argumentAt 同时覆盖命名参数与位置参数', () => {
    const node = one('cube(size = [1, 1, 1], center = true);')
    expect(argumentAt(node, 0)?.name).toBe('size')
    expect(argumentAt(node, 1)?.name).toBe('center')
    expect(argumentAt(node, 9)).toBeUndefined()
  })

  it('标量位置参数也接受（cube(5) 的 size 是标量）', () => {
    const node = one('cube(5);')
    expect(node.args).toHaveLength(1)
    expect(node.args[0].name).toBeUndefined()
    expect(node.args[0].value.kind).toBe('number')
  })
})

describe('parser: 未知节点', () => {
  it('词表外的节点报 OSC1003，但仍然解析出结构', () => {
    const { document, diagnostics } = parseCsg('frobnicate(x = 1) { cube(); }')
    expect(diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.OSC1003])
    expect(document.nodes[0].name).toBe('frobnicate')
    expect(document.nodes[0].children.map((c) => c.name)).toEqual(['cube'])
  })

  it('reportUnknownNodes: false 时静默（供将来「宽容模式」使用）', () => {
    const { diagnostics } = parseCsg('frobnicate(x = 1);', { reportUnknownNodes: false })
    expect(diagnostics).toEqual([])
  })

  it('全部 26 个已知节点都不产生 OSC1003', () => {
    const names = [
      'group', 'cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle',
      'polygon', 'text', 'union', 'difference', 'intersection', 'multmatrix',
      'linear_extrude', 'rotate_extrude', 'projection', 'offset', 'hull',
      'minkowski', 'resize', 'roof', 'surface', 'import', 'fill', 'render', 'color',
    ]
    for (const name of names) {
      const { diagnostics } = parseCsg(`${name}();`)
      expect(diagnostics, name).toEqual([])
    }
  })
})

describe('parser: 诊断与恢复', () => {
  it('缺少 ; 或 { 报 OSC1002', () => {
    const { diagnostics } = parseCsg('cube()')
    expect(diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.OSC1002])
  })

  it('参数列表未闭合报 OSC1002，但节点结尾仍被正确识别', () => {
    const { document, diagnostics } = parseCsg('cube(size = [1, 1, 1];')
    expect(diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC1002)
    // 关键：`;` 必须还给外层，节点仍然是 semicolon 结尾而不是悬空。
    expect(document.nodes).toHaveLength(1)
    expect(document.nodes[0].terminator).toBe('semicolon')
  })

  it('块未闭合报 OSC1002 且子节点仍被收集', () => {
    const { document, diagnostics } = parseCsg('group() {\n\tcube();')
    expect(diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.OSC1002])
    expect(document.nodes[0].children.map((c) => c.name)).toEqual(['cube'])
  })

  it('命名参数缺少 = 时报 OSC1001（值与名字粘连）', () => {
    // `size 1` 里 `size` 落在值位置 → 未知标识符；随后 `1` 也不是合法参数边界。
    // 注意 `cube(1);` 是合法的位置参数，不能拿来当反例。
    const { diagnostics } = parseCsg('cube(size 1);')
    expect(diagnostics[0].code).toBe(DiagnosticCode.OSC1001)
    expect(diagnostics[0].message).toContain("'size'")
    for (const d of diagnostics) expect(d.code).toBe(DiagnosticCode.OSC1001)
  })

  it('值位置出现裸标识符报 OSC1001', () => {
    const { diagnostics } = parseCsg('cube(size = whatever);')
    expect(diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.OSC1001])
  })

  it('`-` 后不是数字或 inf 时报 OSC1001', () => {
    const { diagnostics } = parseCsg('cube(size = -);')
    expect(diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.OSC1001])
  })

  it('括号失衡不影响后续节点继续解析', () => {
    const { document, diagnostics } = parseCsg('cube(size = [1, 1, 1);\nsphere();')
    expect(diagnostics.length).toBeGreaterThan(0)
    const names = document.nodes.map((n) => n.name)
    expect(names).toContain('cube')
    expect(names).toContain('sphere')
  })

  it('诊断带 span 与 hint（可直接指回源位置）', () => {
    const { diagnostics } = parseCsg('cube(size = whatever);', { path: 'demo.csg' })
    const d = diagnostics[0]
    expect(d.span?.start.line).toBe(1)
    expect(d.path).toBe('demo.csg')
    expect(d.hint).toBeTruthy()
  })
})

describe('parser: 终止性（任何畸形输入都必须收敛）', () => {
  const nasty: readonly string[] = [
    '',
    ' ',
    ';;;',
    ')',
    '}',
    ']',
    '(',
    'cube(',
    'cube()',
    'cube(size',
    'cube(size =',
    'cube(size = )',
    'cube(size = [)',
    'cube(size = []',
    'cube(,);',
    'cube(,,);',
    'cube(=);',
    'cube(a = 1 b = 2);',
    'cube(a = 1,,b = 2);',
    'group(){',
    'group(){}',
    'group(){}}}',
    'group(){{}}',
    '%',
    '%#!',
    '#group()',
    '"unterminated',
    '/* unterminated',
    '//only a comment',
    'cube(size = "半角"not closed);',
    'cube(size = [[[[[]]]]]);',
    'cube(size = [1, [2, [3, [4]]]);',
    '\u0000',
    '@#$%^&',
    'cube(size = [1, 1, 1], center = false);garbage',
    'text(text = "a\\"b", size = 10);',
  ]

  it(`${nasty.length} 个畸形输入全部收敛且不抛异常`, () => {
    for (const input of nasty) {
      let result: ReturnType<typeof parseCsg> | undefined
      expect(() => {
        result = parseCsg(input)
      }, JSON.stringify(input)).not.toThrow()
      expect(result?.tokens[result.tokens.length - 1].kind, JSON.stringify(input)).toBe('eof')
    }
  })

  it('畸形输入不会被静默忽略：要么零诊断，要么带可报告的错误码', () => {
    for (const input of nasty) {
      const { diagnostics } = parseCsg(input)
      for (const d of diagnostics) {
        expect(['OSC1001', 'OSC1002', 'OSC1003'], JSON.stringify(input)).toContain(d.code)
        expect(d.message.length).toBeGreaterThan(0)
      }
    }
  })

  it('节点计数对畸形输入也保持可解释（不出现负值或 NaN）', () => {
    for (const input of nasty) {
      const { document } = parseCsg(input)
      expect(Number.isInteger(countCsgNodes(document))).toBe(true)
      expect(countCsgNodes(document)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('parser: 辅助查询', () => {
  it('countCsgNodesByName 统计嵌套内的节点', () => {
    const { document } = parseCsg('group() {\n\tcube();\n\tgroup() {\n\t\tcube();\n\t}\n}')
    const counts = countCsgNodesByName(document)
    expect(counts.get('group')).toBe(2)
    expect(counts.get('cube')).toBe(2)
  })

  it('argumentOf 取最后出现的同名参数（与 OpenSCAD 一致）', () => {
    const node = one('cube(size = [1, 1, 1], size = [2, 2, 2]);')
    const size = argumentOf(node, 'size')?.value as CsgVectorValue
    expect((size.items[0] as CsgNumberValue).value).toBe(2)
  })
})
