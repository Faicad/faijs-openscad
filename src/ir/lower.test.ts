/**
 * lower 单测（M2）：CSG AST → IR 的语义裁决。
 *
 * 这些用例覆盖 plan §4.3 的七个 pass，每条断言的都是**可观察的语义**而非实现
 * 细节：维度、归一化结果、诊断码、以及「范围外节点必须留痕」。
 */
import { describe, expect, it } from 'vitest'
import { parseCsg } from '../csg/parser'
import { DiagnosticCode } from '../diagnostics/codes'
import { lowerCsg, type LowerResult } from './lower'
import type { IrGeometry } from './model'

function lower(text: string): LowerResult {
  const { document } = parseCsg(text, { path: 'test.csg' })
  return lowerCsg(document, { path: 'test.csg' })
}

function root(text: string): IrGeometry {
  const { model, diagnostics } = lower(text)
  const errors = diagnostics.filter((d) => d.severity === 'error')
  expect(errors.map((d) => `${d.code} ${d.message}`)).toEqual([])
  return model.root
}

function codes(text: string): string[] {
  return lower(text).diagnostics.map((d) => d.code)
}

describe('lower: 3D 图元', () => {
  it('cube(size, center) → box，size 向量与 center 逐字保留', () => {
    const node = root('cube(size = [10, 20, 30], center = true);')
    expect(node.kind).toBe('box')
    if (node.kind !== 'box') return
    expect([node.width, node.depth, node.height]).toEqual([10, 20, 30])
    expect(node.centered).toBe(true)
    expect(node.dimension).toBe('3d')
  })

  it('cube 的 size 也可以是标量（OpenSCAD 允许），补齐成三个分量', () => {
    const node = root('cube(size = 7);')
    expect(node.kind === 'box' && [node.width, node.depth, node.height]).toEqual([7, 7, 7])
  })

  it('sphere(r) / sphere(d) 取半径；r 与 d 是同一语义的两种写法', () => {
    const byR = root('sphere(r = 10);')
    const byD = root('sphere(d = 20);')
    expect(byR.kind === 'sphere' && byR.radius).toBe(10)
    expect(byD.kind === 'sphere' && byD.radius).toBe(10)
  })

  it('cylinder 在 r1 === r2 时落 cylinder，否则落 cone（OpenSCAD 的 r1 在底、r2 在顶）', () => {
    const same = root('cylinder(h = 40, r1 = 5, r2 = 5, center = true);')
    expect(same.kind).toBe('cylinder')
    if (same.kind === 'cylinder') {
      expect([same.radius, same.height, same.centered]).toEqual([5, 40, true])
    }

    const tapered = root('cylinder(h = 40, r1 = 5, r2 = 0, center = false);')
    expect(tapered.kind).toBe('cone')
    if (tapered.kind === 'cone') {
      expect([tapered.radiusBottom, tapered.radiusTop, tapered.height]).toEqual([5, 0, 40])
    }
  })

  it('cylinder(h, r) 的单半径写法等价于 r1 = r2 = r', () => {
    const node = root('cylinder(h = 10, r = 3);')
    expect(node.kind).toBe('cylinder')
    if (node.kind === 'cylinder') expect(node.radius).toBe(3)
  })
})

describe('lower: 2D 图元', () => {
  it('square(size, center) → rect2d，缺省 size 是 [1,1]（OpenSCAD 默认）', () => {
    const node = root('square(center = true);')
    expect(node.kind).toBe('rect2d')
    if (node.kind === 'rect2d') {
      expect([node.width, node.height, node.centered]).toEqual([1, 1, true])
      expect(node.dimension).toBe('2d')
    }
  })

  it('circle(r) → circle2d（圆心恒在原点，与 OpenSCAD 一致）', () => {
    const node = root('circle(r = 10, $fn = 0);')
    expect(node.kind === 'circle2d' && node.radius).toBe(10)
  })

  it('polygon(points, paths = undef) 保留单环形态', () => {
    const node = root('polygon(points = [[0,0], [10,0], [10,10]], paths = undef);')
    expect(node.kind).toBe('polygon2d')
    if (node.kind === 'polygon2d') {
      expect(node.points).toEqual([
        [0, 0],
        [10, 0],
        [10, 10],
      ])
      expect(node.paths).toBeUndefined()
    }
  })

  it('polygon(points, paths) 保留多环（外环 + 孔）', () => {
    const node = root(
      'polygon(points = [[0,0],[10,0],[10,10],[0,10],[2,2],[6,2],[6,6],[2,6]], paths = [[0,1,2,3],[4,5,6,7]]);',
    )
    expect(node.kind === 'polygon2d' && node.paths).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ])
  })
})

describe('lower: group-normalize（pass 3）', () => {
  it('空 group → empty（不产出几何，也不报错）', () => {
    expect(root('group() { }').kind).toBe('empty')
  })

  it('单子 group → 透传该子，不产生多余的 union', () => {
    const node = root('group() { cube(size = [1,1,1]); }')
    expect(node.kind).toBe('box')
  })

  it('多子 group → 隐式 union（不使用 cad.compound，见 group-semantics 探针）', () => {
    const node = root('group() { cube(size = [1,1,1]); sphere(r = 1); }')
    expect(node.kind).toBe('union')
    if (node.kind === 'union') expect(node.children).toHaveLength(2)
  })

  it('文档根层多个节点也是隐式 union', () => {
    const node = root('cube(size = [1,1,1]); sphere(r = 1);')
    expect(node.kind).toBe('union')
  })
})

describe('lower: 维度推断（pass 2）', () => {
  it('2D 与 3D 子节点混合 → OSC2003（拒绝，而非静默丢几何）', () => {
    expect(codes('union() { cube(size = [1,1,1]); square(size = [1,1]); }')).toContain(
      DiagnosticCode.OSC2003,
    )
  })

  it('linear_extrude 的 2D 子节点得到 3D 结果，维度沿树传播', () => {
    const node = root(
      'linear_extrude(height = 10) { union() { square(size = [1,1]); circle(r = 2); } }',
    )
    expect(node.kind).toBe('extrude')
    if (node.kind === 'extrude') expect(node.dimension).toBe('3d')
  })

  it('linear_extrude 收到 3D 子节点 → OSC2002', () => {
    expect(codes('linear_extrude(height = 10) { cube(size = [1,1,1]); }')).toContain(
      DiagnosticCode.OSC2002,
    )
  })
})

describe('lower: rotate_extrude（T501）', () => {
  it('rotate_extrude 默认 angle=360 → revolve, angle = 2π', () => {
    const node = root('rotate_extrude() { circle(r = 5); }')
    expect(node.kind).toBe('revolve')
    if (node.kind === 'revolve') {
      expect(node.dimension).toBe('3d')
      expect(node.angle).toBeCloseTo(2 * Math.PI, 12)
    }
  })

  it('rotate_extrude(angle=180) → revolve, angle = π', () => {
    const node = root('rotate_extrude(angle = 180) { circle(r = 5); }')
    expect(node.kind).toBe('revolve')
    if (node.kind === 'revolve') {
      expect(node.angle).toBeCloseTo(Math.PI, 12)
    }
  })

  it('rotate_extrude(angle=-90) → revolve, negative angle preserved', () => {
    const node = root('rotate_extrude(angle = -90) { circle(r = 5); }')
    expect(node.kind).toBe('revolve')
    if (node.kind === 'revolve') {
      expect(node.angle).toBeCloseTo(-Math.PI / 2, 12)
    }
  })

  it('rotate_extrude 多子节点 → 先 union 再 revolve', () => {
    const node = root(
      'rotate_extrude() { union() { square(size = [1,1]); circle(r = 2); } }',
    )
    expect(node.kind).toBe('revolve')
    if (node.kind === 'revolve') expect(node.dimension).toBe('3d')
  })

  it('rotate_extrude 收到 3D 子节点 → OSC2002', () => {
    expect(codes('rotate_extrude() { cube(size = [1,1,1]); }')).toContain(
      DiagnosticCode.OSC2002,
    )
  })

  it('rotate_extrude 无子节点 → OSC2001', () => {
    expect(codes('rotate_extrude();')).toContain(DiagnosticCode.OSC2001)
  })
})

describe('lower: matrix-fold（pass 4）', () => {
  const IDENTITY = '[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]'

  it('恒等矩阵 → transform，矩阵逐字保留（行主序 4×4）', () => {
    const node = root(`multmatrix(${IDENTITY}) { cube(size = [1,1,1]); }`)
    expect(node.kind).toBe('transform')
    if (node.kind === 'transform') expect(node.matrix[3]).toEqual([0, 0, 0, 1])
  })

  it('奇异矩阵（OpenSCAD 的 scale([1,0,1]) 产物）→ OSC2004，不产出坏几何', () => {
    expect(codes('multmatrix([[1,0,0,0],[0,0,0,0],[0,0,1,0],[0,0,0,1]]) { cube(size=[1,1,1]); }')).toContain(
      DiagnosticCode.OSC2004,
    )
  })

  it('底行不是 [0,0,0,1] → OSC2002（faijs applyMatrix 的硬约束）', () => {
    expect(codes('multmatrix([[1,0,0,0],[0,1,0,0],[0,0,1,0],[1,0,0,1]]) { cube(size=[1,1,1]); }')).toContain(
      DiagnosticCode.OSC2002,
    )
  })

  it('无子节点的 multmatrix → empty（变换落空）', () => {
    expect(root(`multmatrix(${IDENTITY});`).kind).toBe('empty')
  })

  it('多子 multmatrix → 先隐式 union 再变换', () => {
    const node = root(`multmatrix(${IDENTITY}) { cube(size=[1,1,1]); sphere(r=1); }`)
    expect(node.kind).toBe('transform')
    if (node.kind === 'transform') expect(node.child.kind).toBe('union')
  })
})

describe('lower: modifier-policy（pass 5）', () => {
  it('`%` 的背景子树不进结果几何（与 OpenSCAD 导出语义一致）', () => {
    expect(root('%cube(size = [1,1,1]);').kind).toBe('empty')
  })

  it('`%` 只影响自己那棵子树，兄弟节点照常保留', () => {
    const node = root('%cube(size = [1,1,1]); sphere(r = 1);')
    expect(node.kind).toBe('sphere')
  })

  it('`#` 保留几何 + OSC3001（高亮语义在 faijs 侧不存在）', () => {
    const result = lower('#cube(size = [1,1,1]);')
    expect(result.model.root.kind).toBe('box')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3001)
  })
})

describe('lower: capability-classify（pass 7）', () => {
  it('范围外节点 → blocked + OSC3002（绝不静默跳过）', () => {
    const result = lower('hull() { cube(size=[1,1,1]); sphere(r=1); }')
    expect(result.model.root.kind).toBe('blocked')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3002)
  })

  it('blocked 节点在树里留痕，不会被 union 的空子过滤吞掉', () => {
    const node = root('group() { %cube(size=[1,1,1]); cube(size=[1,1,1]); }')
    expect(node.kind).toBe('box')
    const withBlocked = lower('group() { import(file = "x.stl"); cube(size=[1,1,1]); }')
    expect(withBlocked.model.root.kind).toBe('union')
    expect(withBlocked.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3002)
  })

  it('linear_extrude 带 twist / 非等比 scale 是 P2 → blocked', () => {
    expect(
      lower('linear_extrude(height = 10, twist = 90) { square(size = [1,1]); }').model.root.kind,
    ).toBe('blocked')
    expect(
      lower('linear_extrude(height = 10, scale = [2,2]) { square(size = [1,1]); }').model.root.kind,
    ).toBe('blocked')
  })

  it('linear_extrude 的 scale = [1,1] 属于默认值，不阻塞', () => {
    expect(
      lower('linear_extrude(height = 10, scale = [1,1]) { square(size = [1,1]); }').model.root.kind,
    ).toBe('extrude')
  })
})

describe('lower: P1 blocked 节点（T502-T506）', () => {
  it('polyhedron(points, faces) → blocked + OSC3002，不报 OSC1004', () => {
    const result = lower(
      'polyhedron(points = [[0,0,0],[1,0,0],[0,1,0],[0,0,1]], faces = [[0,1,2],[0,1,3],[0,2,3],[1,2,3]]);',
    )
    expect(result.model.root.kind).toBe('blocked')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3002)
    // 参数名已登记，不应产生 OSC1004
    expect(result.diagnostics.map((d) => d.code)).not.toContain(DiagnosticCode.OSC1004)
  })

  it('text(text, size, font) → blocked + OSC3002，不报 OSC1004', () => {
    const result = lower(
      'text(text = "Hello", size = 10, font = "Liberation Sans", halign = "center", valign = "center");',
    )
    expect(result.model.root.kind).toBe('blocked')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3002)
    expect(result.diagnostics.map((d) => d.code)).not.toContain(DiagnosticCode.OSC1004)
  })

  it('hull() → blocked + OSC3002', () => {
    const result = lower('hull() { cube(size=[1,1,1]); sphere(r=1); }')
    expect(result.model.root.kind).toBe('blocked')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3002)
  })

  it('resize(newsize, auto) → blocked + OSC3002，不报 OSC1004', () => {
    const result = lower(
      'resize(newsize = [10, 20, 30], auto = [true, false, true]) { cube(size=[1,1,1]); }',
    )
    expect(result.model.root.kind).toBe('blocked')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3002)
    expect(result.diagnostics.map((d) => d.code)).not.toContain(DiagnosticCode.OSC1004)
  })

  it('import(file) → blocked + OSC3002，不报 OSC1004', () => {
    const result = lower('import(file = "part.stl");')
    expect(result.model.root.kind).toBe('blocked')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3002)
    expect(result.diagnostics.map((d) => d.code)).not.toContain(DiagnosticCode.OSC1004)
  })
})

describe('lower: 参数诊断', () => {
  it('缺必填参数 → OSC2001', () => {
    expect(codes('cylinder(center = false);')).toContain(DiagnosticCode.OSC2001)
  })

  it('参数类型不符 → OSC2002', () => {
    expect(codes('cube(size = "big");')).toContain(DiagnosticCode.OSC2002)
  })

  it('未知参数 → OSC1004（保留在 AST、lowering 忽略）', () => {
    expect(codes('cube(size = [1,1,1], frobnicate = 3);')).toContain(DiagnosticCode.OSC1004)
  })

  it('$fn/$fa/$fs 是动态作用域特殊变量，不算未知参数', () => {
    expect(codes('sphere(r = 1, $fn = 64, $fa = 12, $fs = 2);')).not.toContain(
      DiagnosticCode.OSC1004,
    )
  })

  it('显式 $fn > 0 → OSC3201（analytic 不保留棱面）', () => {
    expect(codes('sphere(r = 1, $fn = 12);')).toContain(DiagnosticCode.OSC3201)
  })

  it('$fn = 0（未显式指定）不报 OSC3201', () => {
    expect(codes('sphere(r = 1, $fn = 0);')).not.toContain(DiagnosticCode.OSC3201)
  })

  it('坏输入不抛异常：一条诊断换一个 empty，流程照常走完', () => {
    const result = lower('cube(size = "big"); sphere(r = 2);')
    expect(result.model.root.kind).toBe('sphere')
  })
})

describe('lower: 棱面参数采集（M9 §1.3 语义修正后）', () => {
  it('circle($fn=6) → circle2d（analytic），报 OSC3201（三角化参数已采集）', () => {
    const result = lower('circle(r = 10, $fn = 6);')
    expect(result.model.root.kind).toBe('circle2d')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3201)
    if (result.model.root.kind === 'circle2d') {
      expect(result.model.root.radius).toBe(10)
    }
  })

  it('circle($fn=0) → circle2d（analytic），不报 OSC3201', () => {
    const result = lower('circle(r = 10, $fn = 0);')
    expect(result.model.root.kind).toBe('circle2d')
    expect(result.diagnostics.map((d) => d.code)).not.toContain(DiagnosticCode.OSC3201)
  })

  it('circle 无 $fn → circle2d（analytic）', () => {
    const result = lower('circle(r = 10);')
    expect(result.model.root.kind).toBe('circle2d')
  })

  it('cylinder($fn=6) → cylinder（analytic），报 OSC3201', () => {
    const result = lower('cylinder(h = 20, r = 5, $fn = 6);')
    expect(result.model.root.kind).toBe('cylinder')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3201)
    if (result.model.root.kind === 'cylinder') {
      expect(result.model.root.radius).toBe(5)
      expect(result.model.root.height).toBe(20)
    }
  })

  it('cylinder($fn=6, center=true) → cylinder（analytic, centered）', () => {
    const result = lower('cylinder(h = 20, r = 5, $fn = 6, center = true);')
    expect(result.model.root.kind).toBe('cylinder')
    if (result.model.root.kind === 'cylinder') {
      expect(result.model.root.centered).toBe(true)
    }
  })

  it('cylinder 无 $fn → cylinder（analytic）', () => {
    const result = lower('cylinder(h = 20, r = 5);')
    expect(result.model.root.kind).toBe('cylinder')
  })

  it('cone（r1≠r2）$fn=6 → analytic cone + OSC3201', () => {
    const result = lower('cylinder(h = 20, r1 = 5, r2 = 3, $fn = 6);')
    expect(result.model.root.kind).toBe('cone')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3201)
  })

  it('sphere $fn=12 → analytic sphere + OSC3201', () => {
    const result = lower('sphere(r = 10, $fn = 12);')
    expect(result.model.root.kind).toBe('sphere')
    expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.OSC3201)
  })
})

describe('lower: 三角化参数采集（M9 §1.3, A2）', () => {
  it('sphere($fn=24) → tessellation.fn=24, segments=24', () => {
    const result = lower('sphere(r = 10, $fn = 24);')
    expect(result.tessellation).toBeDefined()
    expect(result.tessellation?.fn).toBe(24)
    expect(result.tessellation?.segments).toBe(24)
    expect(result.model.tessellation?.fn).toBe(24)
  })

  it('circle($fn=6) → tessellation.fn=6, segments=6', () => {
    const result = lower('circle(r = 10, $fn = 6);')
    expect(result.tessellation?.fn).toBe(6)
    expect(result.tessellation?.segments).toBe(6)
  })

  it('cylinder($fn=8) → tessellation.fn=8', () => {
    const result = lower('cylinder(h = 20, r = 5, $fn = 8);')
    expect(result.tessellation?.fn).toBe(8)
  })

  it('无 $fn/$fa/$fs → tessellation=undefined', () => {
    const result = lower('sphere(r = 10);')
    expect(result.tessellation).toBeUndefined()
    expect(result.model.tessellation).toBeUndefined()
  })

  it('$fn=0 → tessellation=undefined（不触发采集）', () => {
    const result = lower('sphere(r = 10, $fn = 0);')
    expect(result.tessellation).toBeUndefined()
  })

  it('多节点取最大 $fn', () => {
    const result = lower('sphere(r = 10, $fn = 12); cylinder(h = 5, r = 3, $fn = 24);')
    expect(result.tessellation?.fn).toBe(24)
    expect(result.tessellation?.segments).toBe(24)
  })

  it('$fa/$fs 采集（取最小值 = 最严格），且按半径算 segments', () => {
    const result = lower('sphere(r = 10, $fa = 6, $fs = 1);')
    expect(result.tessellation?.fa).toBe(6)
    expect(result.tessellation?.fs).toBe(1)
    expect(result.tessellation?.fn).toBeUndefined()
    // sphere r=10, $fa=6, $fs=1 → max(5, min(ceil(360/6)=60, ceil(2π·10/1)=63)) = 60
    expect(result.tessellation?.segments).toBe(60)
  })

  it('sphere(r=1, $fa=12, $fs=2) → segments=5（OpenSCAD 默认，下限 5）', () => {
    const result = lower('sphere(r = 1, $fa = 12, $fs = 2);')
    expect(result.tessellation?.segments).toBe(5)
  })

  it('cylinder(r=1, $fa=12, $fs=2) → segments=4（circle 公式，下限 3）', () => {
    const result = lower('cylinder(h = 5, r = 1, $fa = 12, $fs = 2);')
    // circle r=1 → max(3, min(30, ceil(π)=4)) = 4
    expect(result.tessellation?.segments).toBe(4)
  })

  it('linear_extrude 的 $fn 也被采集', () => {
    const result = lower('linear_extrude(height = 10, $fn = 16) { circle(r = 5); }')
    expect(result.tessellation?.fn).toBe(16)
  })
})
