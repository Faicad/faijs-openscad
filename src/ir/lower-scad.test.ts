import { describe, it, expect } from 'vitest'
import { parseScad } from '../scad/parser'
import { lowerScad } from '../ir/lower-scad'
import { emitFaijs } from '../emit/faijs'

describe('lowerScad + emitFaijs: 结构化路径', () => {
  it('简单 for 循环 → JS for 循环（不展开）', () => {
    const scad = `
for (i = [0:3]) {
  translate([i * 10, 0, 0]) cube([1, 1, 1]);
}
`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model, diagnostics } = lowerScad(document, { path: 'test.scad' })
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)

    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('for (let i =')
    expect(result.code).toContain('cad.box(')
    expect(result.code).toContain('applyMatrix')
    expect(result.code).not.toContain('part0 = await cad.box(1 * MM, 1 * MM, 1 * MM, false)\nlet part1 = await cad.box')
  })

  it('for 循环体保留循环变量引用', () => {
    const scad = `
for (i = [0:5]) {
  translate([i * 10, 0, 0]) cube([2, 2, 2]);
}
`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model } = lowerScad(document, { path: 'test.scad' })
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('i * 10')
  })

  it('if 语句 → JS if（不展开）', () => {
    const scad = `
x = 5;
if (x > 3) {
  cube([1, 1, 1]);
} else {
  sphere(2);
}
`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model } = lowerScad(document, { path: 'test.scad' })
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('if (')
    expect(result.code).toContain('else')
  })

  it('顶层变量赋值 → JS const', () => {
    const scad = `
n = 10;
size = 5;
cube([size, size, n]);
`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model } = lowerScad(document, { path: 'test.scad' })
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('const n =')
    expect(result.code).toContain('const size =')
  })

  it('module_recursion 递归 → async function（不展开为 8189 条语句）', () => {
    const scad = `
function rnd(s, e, r) = r * (e - s) + s;
module tree(length, count) {
  square([length, length]);
  if (count > 0) {
    tree(rnd(0.6, 0.8, 1) * length, count - 1);
    tree(rnd(0.6, 0.8, 2) * length, count - 1);
  }
}
tree(100, 5);
`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model } = lowerScad(document, { path: 'test.scad' })
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('async function tree(')
    expect(result.code).toContain('if (')
    expect(result.code).toContain('tree(cad,')
    const lineCount = result.code.split('\n').length
    expect(lineCount).toBeLessThan(50)
  })
})