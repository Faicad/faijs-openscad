/**
 * emitter 单测（M2）：IR → `.fai.js` 的形态与拒绝策略。
 *
 * 断言的是**生成文本的形态**，因为「生成的代码能不能被 faijs 接受」正是
 * emitter 的全部职责。形态本身不是随便定的——每一条都对应一个实测探针：
 *   - 长度 `* MM`、矩阵裸数字   → emit/faijs-apply-matrix.probe.test.ts
 *   - profile 的弧角是裸弧度    → emit/faijs-2d-profile.probe.test.ts
 *   - 无 import 行（MM 是免 import 全局）→ emit/faijs-script-globals.probe.test.ts
 *   - setColor / setOpacity 是实例方法    → 同上（color 段）
 *
 * 最后一组用 faijs 自己的静态校验器过一遍生成物（faijs 未安装时整组跳过）。
 */
import { describe, expect, it } from 'vitest'
import { parseCsg } from '../csg/parser'
import { lowerCsg } from '../ir/lower'
import { faijsStaticCheck, staticCheckAvailable } from '../__probe__/faijs-check'
import { emitFaijs } from './faijs'

async function transpile(csg: string): Promise<string> {
  const { document } = parseCsg(csg, { path: 'test.csg' })
  const { model } = lowerCsg(document, { path: 'test.csg' })
  const result = emitFaijs(model)
  expect(result.ok, `expect emit to succeed, blocked=${result.blocked.join(',')}`).toBe(true)
  return result.code
}

/** 去掉头部注释，便于断言语句形态。 */
function body(code: string): string {
  return code
    .split('\n')
    .filter((l) => !l.startsWith('//'))
    .join('\n')
    .trim()
}

describe('emit: 3D 图元', () => {
  it('cube → cad.box，长度带 * MM；center 缺省时不写选项对象', async () => {
    expect(body(await transpile('cube(size = [15, 15, 15]);'))).toBe(
      'let part0 = await cad.box(15 * MM, 15 * MM, 15 * MM)\nlet result = part0',
    )
  })

  it('cube(center = true) → { centered: true }', async () => {
    expect(body(await transpile('cube(size = [15, 15, 15], center = true);'))).toContain(
      'await cad.box(15 * MM, 15 * MM, 15 * MM, { centered: true })',
    )
  })

  it('sphere → cad.sphere(r, { segments })（球心在原点，与 OpenSCAD 同）', async () => {
    const code = body(await transpile('sphere(r = 10);'))
    expect(code).toContain('await cad.sphere(10 * MM')
    expect(code).toContain('segments:')
  })

  it('等半径 cylinder → cad.cylinder(r, h)；center 透传为 centered', async () => {
    expect(body(await transpile('cylinder(h = 40, r1 = 5, r2 = 5, center = true);'))).toContain(
      'await cad.cylinder(5 * MM, 40 * MM, { centered: true',
    )
  })

  it('变半径 cylinder → cad.cone(rBottom, rTop, h)（不交换 r1/r2）', async () => {
    expect(body(await transpile('cylinder(h = 30, r1 = 5, r2 = 0);'))).toContain(
      'await cad.cone(5 * MM, 0 * MM, 30 * MM',
    )
  })

  it('zero 也带单位（0 * MM），不产生裸 0 —— 长度位必须显式带量纲', async () => {
    expect(body(await transpile('cube(size = [0, 1, 1]);'))).toContain('cad.box(0 * MM, 1 * MM, 1 * MM)')
  })
})

describe('emit: 2D profile', () => {
  it('square → 4 条 line 的矩形轮廓，逆时针、首尾相接', async () => {
    const code = body(await transpile('square(size = [10, 20]);'))
    expect(code).toContain('await cad.profile({ contours: [')
    expect(code.split("{ kind: 'line'").length - 1).toBe(4)
    expect(code).toContain("{ kind: 'line', x1: 0 * MM, y1: 0 * MM, x2: 10 * MM, y2: 0 * MM }")
    expect(code).toContain("{ kind: 'line', x1: 10 * MM, y1: 20 * MM, x2: 0 * MM, y2: 20 * MM }")
  })

  it('square(center = true) → 坐标以原点为中心', async () => {
    const code = body(await transpile('square(size = [10, 10], center = true);'))
    expect(code).toContain("{ kind: 'line', x1: -5 * MM, y1: -5 * MM, x2: 5 * MM, y2: -5 * MM }")
  })

  it('circle → polygon2d 轮廓（N-gon line段，不是 arc）', async () => {
    const code = body(await transpile('circle(r = 10);'))
    // Faceted approach: circle → polygon2d → lines (not arcs)
    expect(code.split("{ kind: 'line'").length - 1).toBeGreaterThanOrEqual(3)
    expect(code).not.toContain("kind: 'arc'")
  })

  it('polygon(paths = undef) → 单个闭环', async () => {
    const code = body(await transpile('polygon(points = [[0,0], [10,0], [10,10]], paths = undef);'))
    expect(code.split("{ kind: 'line'").length - 1).toBe(3)
    expect(code).toContain("{ kind: 'line', x1: 10 * MM, y1: 10 * MM, x2: 0 * MM, y2: 0 * MM }")
  })

  it('polygon 多环 → 两个 contour（外环 + 孔）', async () => {
    const code = body(
      await transpile(
        'polygon(points = [[0,0],[10,0],[10,10],[0,10],[2,2],[6,2],[6,6],[2,6]], paths = [[0,1,2,3],[4,5,6,7]]);',
      ),
    )
    expect(code.split('{ segments: [').length - 1).toBe(2)
  })
})

describe('emit: 组合与变换', () => {
  it('union → cad.union(a, b, ...)（≥2 个输入）', async () => {
    const code = body(await transpile('union() { cube(size=[1,1,1]); sphere(r=1); }'))
    expect(code).toContain('await cad.union(part0, part1)')
  })

  it('difference → cad.subtract(base, ...tools)（子顺序即主体在前）', async () => {
    const code = body(
      await transpile('difference() { cube(size=[10,10,10]); sphere(r=4); cylinder(h=20, r=1); }'),
    )
    expect(code).toContain('await cad.subtract(part0, part1, part2)')
  })

  it('intersection → cad.intersect(...)', async () => {
    const code = body(await transpile('intersection() { cube(size=[10,10,10]); sphere(r=6); }'))
    expect(code).toContain('await cad.intersect(part0, part1)')
  })

  it('multmatrix → cad.applyMatrix，矩阵裸数字、行主序 4 行', async () => {
    const code = body(
      await transpile('multmatrix([[1,0,0,-24],[0,1,0,0],[0,0,1,0],[0,0,0,1]]) { cube(size=[1,1,1]); }'),
    )
    expect(code).toContain('await cad.applyMatrix(part0, [')
    expect(code).toContain('  [1, 0, 0, -24],')
    expect(code).not.toContain('-24 * MM')
  })

  it('render() 只透传几何，不产生语句', async () => {
    const code = body(await transpile('render(convexity = 2) { cube(size=[1,1,1]); }'))
    expect(code).toBe('let part0 = await cad.box(1 * MM, 1 * MM, 1 * MM)\nlet result = part0')
  })

  it('group 单子不产生多余 union（归一化在 lower 完成）', async () => {
    const code = body(await transpile('group() { cube(size=[1,1,1]); }'))
    expect(code).not.toContain('cad.union')
  })
})

describe('emit: linear_extrude', () => {
  it('center = false → cad.extrude(f, { length })', async () => {
    const code = body(await transpile('linear_extrude(height = 10) { square(size=[4,4]); }'))
    expect(code).toContain('await cad.extrude(part0, { length: 10 * MM })')
    expect(code).not.toContain('applyMatrix')
  })

  it('center = true → 追加一次平移矩阵（不用 cad.translate，它不在平台面）', async () => {
    const code = body(
      await transpile('linear_extrude(height = 10, center = true) { square(size=[4,4]); }'),
    )
    expect(code).toContain('await cad.extrude(part0, { length: 10 * MM })')
    expect(code).toContain('await cad.applyMatrix(part1, [')
    expect(code).toContain('  [0, 0, 1, -5],')
    expect(code).not.toContain('cad.translate')
  })
})

describe('emit: rotate_extrude（T501）', () => {
  it('默认 360° → cad.revolve(profile, { axis, at }) without angle', async () => {
    const code = body(await transpile('rotate_extrude() { circle(r = 5); }'))
    expect(code).toContain('await cad.revolve(part0, { axis: [0, 0, 1], at: [0, 0, 0] })')
    // full turn must NOT include an angle field (revolve defaults to 2π)
    expect(code).not.toContain('angle:')
  })

  it('angle=180 → cad.revolve with bare radian angle (not * RADIAN)', async () => {
    const code = body(await transpile('rotate_extrude(angle = 180) { circle(r = 5); }'))
    expect(code).toContain('await cad.revolve(part0, { axis: [0, 0, 1], at: [0, 0, 0], angle:')
    // angle must be bare number (π = 3.141592653589793), NOT * RADIAN
    expect(code).toContain('angle: 3.141592653589793')
    expect(code).not.toContain('RADIAN')
  })

  it('angle=-90 → negative bare radian', async () => {
    const code = body(await transpile('rotate_extrude(angle = -90) { circle(r = 5); }'))
    expect(code).toContain('angle: -1.5707963267948966')
    expect(code).not.toContain('RADIAN')
  })
})

describe('emit: 外观', () => {
  it('color → setColor([r,g,b])，alpha = 1 时不调用 setOpacity', async () => {
    const code = body(await transpile('color([0.9, 0.2, 0.2, 1]) { cube(size=[1,1,1]); }'))
    expect(code).toContain('part0.setColor([0.9, 0.2, 0.2])')
    expect(code).not.toContain('setOpacity')
  })

  it('color 的 alpha < 1 → 追加 setOpacity', async () => {
    const code = body(await transpile('color([0, 0, 1, 0.5]) { cube(size=[1,1,1]); }'))
    expect(code).toContain('part0.setColor([0, 0, 1])')
    expect(code).toContain('part0.setOpacity(0.5)')
  })

  it('setColor 作用于子节点变量本身（不新增变量）', async () => {
    const code = body(await transpile('color([1, 0, 0, 1]) { cube(size=[1,1,1]); }'))
    expect(code).toBe(
      'let part0 = await cad.box(1 * MM, 1 * MM, 1 * MM)\npart0.setColor([1, 0, 0])\nlet result = part0',
    )
  })
})

describe('emit: 拒绝策略与确定性', () => {
  it('范围外节点 → ok:false 且 code 为空串（不产出「看起来能跑」的近似代码）', () => {
    const { document } = parseCsg('hull() { cube(size=[1,1,1]); sphere(r=1); }')
    const { model } = lowerCsg(document)
    const result = emitFaijs(model)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('')
    expect(result.blocked).toEqual(['hull'])
  })

  it('空模型（全部是 `%` 背景）→ ok:true 且不带 result 行', async () => {
    const code = await transpile('%cube(size=[1,1,1]);')
    expect(code).toContain('no geometry')
    expect(code).not.toContain('let result')
  })

  it('同样输入两次输出字节一致（deterministic）', async () => {
    const csg = 'difference() { cube(size=[10,10,10], center=true); sphere(r=6); }'
    expect(await transpile(csg)).toBe(await transpile(csg))
  })

  it('头部含源文件、转换器版本与非等价说明', async () => {
    const code = await transpile('cube(size=[1,1,1]);')
    expect(code).toContain('// source: test.csg')
    expect(code).toContain('// generated by @faicad/faijs-openscad ')
    expect(code).toContain('CSG -> IR -> faijs')
  })

  it('生成物没有任何 import 行（cad 与 MM 都是脚本面免 import 全局）', async () => {
    const code = await transpile('cube(size=[1,1,1]); sphere(r=1);')
    expect(code).not.toContain('import ')
  })

  it('每条语句都登记了 IR 节点 id（供上游做源映射）', async () => {
    const { document } = parseCsg('union() { cube(size=[1,1,1]); sphere(r=1); }')
    const { model } = lowerCsg(document)
    const result = emitFaijs(model)
    expect(result.statementNodes.length).toBe(3) // box, sphere, union
  })
})

describe('emit: faijs 静态校验（需安装 @faicad/faijs）', () => {
  it('生成的程序能通过 faijs 的 op 名与字面量校验', async () => {
    const available = await staticCheckAvailable()
    expect(available, '需要安装 @faicad/faijs（devDependency）').toBe(true)
    if (!available) return

    const code = await transpile(`
      difference() {
        cube(size = [30, 30, 10], center = true);
        union() {
          cylinder(h = 20, r1 = 4, r2 = 4, center = true);
          linear_extrude(height = 12, center = true) {
            polygon(points = [[-5,-5],[5,-5],[5,5],[-5,5]], paths = undef);
          }
        }
      }
      color([0.9, 0.2, 0.2, 0.6]) { sphere(r = 3); }
    `)
    const checked = await faijsStaticCheck(code)
    expect(checked).not.toBeNull()
    expect(checked?.message ?? '').toBe('')
  })
})

describe('emit: compact mode (T812)', () => {
  it('compact mode produces smaller output with helper functions', async () => {
    const code = body(await transpile('square(size = [10, 20]);'))
    const { document } = parseCsg('square(size = [10, 20]);')
    const { model } = lowerCsg(document)
    const compact = emitFaijs(model, { compact: true, header: false })
    // compact should use __rect helper
    expect(compact.code).toContain('function __rect')
    expect(compact.code).toContain('__rect(10 * MM, 20 * MM)')
    // compact should be shorter than normal
    expect(compact.code.length).toBeLessThan(code.length)
  })

  it('compact mode uses __circle helper for circles', async () => {
    const { document } = parseCsg('circle(r = 5);')
    const { model } = lowerCsg(document)
    const compact = emitFaijs(model, { compact: true, header: false })
    // circle now generates polygon2d, not circle2d — no __circle helper
    expect(compact.code).toContain('cad.profile(')
  })

  it('compact mode matrices are single-line', async () => {
    const { document } = parseCsg('multmatrix([[1,0,0,5],[0,1,0,0],[0,0,1,0],[0,0,0,1]]) { cube(size=[1,1,1]); }')
    const { model } = lowerCsg(document)
    const compact = emitFaijs(model, { compact: true, header: false })
    expect(compact.code).toContain('[[1,0,0,5],[0,1,0,0],[0,0,1,0],[0,0,0,1]]')
  })

  it('compact mode passes faijs static check', async () => {
    const available = await staticCheckAvailable()
    if (!available) return // skip if faijs not installed

    const _code = body(await transpile(`
      union() {
        square(size = [10, 20]);
        circle(r = 5);
        cube(size = [5, 5, 5]);
      }
    `))
    const { document } = parseCsg(`
      union() {
        square(size = [10, 20]);
        circle(r = 5);
        cube(size = [5, 5, 5]);
      }
    `)
    const { model } = lowerCsg(document)
    const compactCode = emitFaijs(model, { compact: true, header: false }).code
    const checked = await faijsStaticCheck(compactCode)
    expect(checked).not.toBeNull()
    expect(checked?.message ?? '').toBe('')
  })
})
