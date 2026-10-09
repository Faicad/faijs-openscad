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

  it('rands helper 与 evaluator 算法一致（确定性）', () => {
    const scad = `x = rands(0, 1, 5, 42)[0]; cube([x, x, x]);`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model } = lowerScad(document, { path: 'test.scad' })
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('function rands(')
    expect(result.code).toContain('rands(0, 1, 5, 42)')
  })

  it('cos/sin 正确映射为 Math.cos/Math.sin（角度转弧度）', () => {
    const scad = `a = cos(45); cube([a, a, a]);`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model } = lowerScad(document, { path: 'test.scad' })
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('Math.cos')
    expect(result.code).toContain('3.14159')
    expect(result.code).toContain('180')
  })

  it('矩阵乘法 m * mt(...) 转为 matMul', () => {
    const scad = `
identity = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
function mt(x, y) = [[1,0,0,x],[0,1,0,y],[0,0,1,0],[0,0,0,1]];
module tree(m = identity) {
  multmatrix(m * mt(10, 20)) cube([1, 1, 1]);
}
tree();
`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model } = lowerScad(document, { path: 'test.scad' })
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('matMul(')
    expect(result.code).toContain('function matMul(')
  })

  it('setColor 直接取元素（非 [r,g,b][0]）', () => {
    const scad = `color([0.5, 0.3, 0.1]) cube([1, 1, 1]);`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model } = lowerScad(document, { path: 'test.scad' })
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('setColor(0.5, 0.3, 0.1)')
    expect(result.code).not.toContain('[0.5, 0.3, 0.1][0]')
  })

  it('intersection_for → cad.intersect（非 cad.union）', () => {
    const scad = `
intersection_for(i = [0:3]) {
  translate([i * 10, 0, 0]) cube([1, 1, 1]);
}
`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model, diagnostics } = lowerScad(document, { path: 'test.scad' })
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('cad.intersect')
    expect(result.code).not.toContain('cad.union(...')
  })

  it('children() → __unionChildren(__children)', () => {
    const scad = `
module place() {
  children();
}
place() cube([1, 1, 1]);
`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model, diagnostics } = lowerScad(document, { path: 'test.scad' })
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('...__children')
    expect(result.code).toContain('__unionChildren')
  })

  it('列表推导式 [for (i = [0:3]) i * 2] → JS IIFE 数组', () => {
    const scad = `
a = [for (i = [0:3]) i * 2];
cube([a[0], a[1], a[2]]);
`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model, diagnostics } = lowerScad(document, { path: 'test.scad' })
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('for (let i =')
    expect(result.code).toContain('.push(')
  })

  it('$fn 传递给 sphere → segments 参数', () => {
    const scad = `sphere(r = 5, $fn = 32);`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model, diagnostics } = lowerScad(document, { path: 'test.scad' })
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('cad.sphere(')
  })

  it('linear_extrude → cad.extrude(profile, { length })', () => {
    const scad = `linear_extrude(height = 20) square([10, 10]);`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model, diagnostics } = lowerScad(document, { path: 'test.scad' })
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('cad.extrude(')
    expect(result.code).toContain('length')
  })

  it('rotate_extrude → cad.revolve(profile, { axis, at, angle })', () => {
    const scad = `rotate_extrude(angle = 180) square([5, 5]);`
    const { document } = parseScad(scad, { path: 'test.scad' })
    const { model, diagnostics } = lowerScad(document, { path: 'test.scad' })
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    const result = emitFaijs(model, { header: false })
    expect(result.ok).toBe(true)
    expect(result.code).toContain('cad.revolve(')
    expect(result.code).toContain('axis')
    expect(result.code).toContain('angle')
  })
})