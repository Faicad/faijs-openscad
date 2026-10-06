/**
 * MCAD 验证夹具（本项目的 AGPL 代码，非 MCAD 源码副本）。
 *
 * 这些 `.scad` 片段用于验证「移植正确性」：它们 `use` MCAD 库的模块（MCAD 为
 * LGPL-2.1，作为转换器的**黑盒输入样本**，不复制其源码），由 OpenSCAD 外部进程
 * 求值为 `.csg`，再交给 faijs-openscad 的 CSG 解析器解析。验证点只有两个：
 *   1. 解析零诊断（任何 OSC1001/1002/1003 都算失败）；
 *   2. AST 节点直方图与独立的文本扫描逐项相等（防止解析器漏/重节点）。
 *
 * 选择 MCAD 而非 OpenSCAD 自身测试文件的理由：OpenSCAD 上游为 GPL-2.0，本项目
 * 不引入其源码；MCAD 是随 OpenSCAD 分发的 LGPL 第三方库，几何覆盖面广（齿轮 /
 * 轴承 / 螺钉 / 型材 / 阵列 / 2D 形状 / 颜色），足以作为真实世界的解析语料。
 */
export interface McadFixture {
  /** 稳定 id（生成文件用，POSIX 风格）。 */
  readonly name: string
  /** 完整 .scad 文本：以 `use <mcad 模块>` 引入，再调用其几何体。 */
  readonly scad: string
}

export const MCAD_FIXTURES: readonly McadFixture[] = [
  {
    name: 'gears-test',
    scad: `use <gears.scad>\ntest_gears();\n`,
  },
  {
    name: 'gears-3d',
    scad: `use <gears.scad>\ndemo_3d_gears();\n`,
  },
  {
    name: 'involute-gears-test',
    scad: `use <involute_gears.scad>\ntest_gears();\n`,
  },
  {
    name: 'involute-bevel',
    scad: `use <involute_gears.scad>\ntest_bevel_gear();\n`,
  },
  {
    name: 'involute-double-helix',
    scad: `use <involute_gears.scad>\ntest_meshing_double_helix();\n`,
  },
  {
    name: 'bearing-test',
    scad: `use <bearing.scad>\ntest_bearing();\n`,
  },
  {
    name: 'color-demo',
    scad: `use <materials.scad>\ncolor_demo();\n`,
  },
  {
    name: 'shapes-2d',
    scad: `use <2Dshapes.scad>\nexample2DShapes();\n`,
  },
  {
    name: 'screw-auger',
    scad: `use <screw.scad>\ntest_auger();\n`,
  },
  {
    name: 'screw-ball',
    scad: `use <screw.scad>\ntest_ball_screw();\n`,
  },
  {
    name: 'polyholes',
    scad: `use <polyholes.scad>\ntest_polyhole();\n`,
  },
  {
    name: 'array-test',
    scad: `use <array.scad>\nCubic_and_Radial_Array_Test();\n`,
  },
  {
    name: 'regular-shapes',
    scad:
      `use <regular_shapes.scad>\n` +
      `hexagon_prism(height=10, radius=5);\n` +
      `torus(outerRadius=10, innerRadius=4);\n` +
      `cone(height=10, radius=5);\n` +
      `regular_polygon(sides=6, radius=10);\n` +
      `triangle(radius=10);\n`,
  },
  {
    name: 'shapes-lib',
    scad:
      `use <shapes.scad>\n` +
      `hexagon(10, 5);\n` +
      `tube(10, 5, 1);\n` +
      `roundedBox(10, 10, 10, 2);\n`,
  },
  {
    name: 'boxes',
    scad: `use <boxes.scad>\nroundedBox(10, 2, true);\n`,
  },
  {
    name: 'ngon-pie',
    scad:
      `use <2Dshapes.scad>\n` +
      `ngon(sides=6, radius=10, center=true);\n` +
      `pieSlice(20, 0, 90);\n` +
      `ellipse(10, 20);\n` +
      `roundedSquare([10, 10], 2);\n`,
  },
  {
    name: 'nuts-bolts',
    scad:
      `use <nuts_and_bolts.scad>\n` +
      `boltHole(size=3, length=10);\n` +
      `nutHole(size=3);\n`,
  },
  {
    name: 'lego',
    scad:
      `use <lego_compatibility.scad>\n` +
      `block(2, 1, 1/3, axle_hole=false, circular_hole=true, reinforcement=true, hollow_knob=true, flat_top=true);\n`,
  },
  {
    name: 'multiply',
    scad:
      `use <multiply.scad>\n` +
      `linear_multiply(4, 10, [0, 0, 1]) cube(5);\n`,
  },
  {
    name: 'stepper',
    scad: `use <motors.scad>\nstepper_motor_mount(17);\n`,
  },
  {
    name: 'servo',
    scad: `use <servos.scad>\nfutabas3003([0, 0, 0], [0, 0, 0]);\n`,
  },
  {
    name: 'profiles',
    scad: `use <profiles.scad>\nprofile_misumi_metric_2020();\n`,
  },
  {
    name: 'gridbeam',
    scad: `use <gridbeam.scad>\nxBeam(4);\n`,
  },
  {
    name: 'libtriangles',
    scad:
      `use <libtriangles.scad>\n` +
      `rightpyramid(5, 5, 5);\n` +
      `eqlprism(5, 5, 5);\n`,
  },
  {
    name: 'metric-fasteners',
    scad:
      `use <metric_fastners.scad>\n` +
      `bolt(3, 10);\n` +
      `washer(3);\n` +
      `cap_bolt(3, 10);\n`,
  },
  {
    name: 'hardware',
    scad:
      `use <hardware.scad>\n` +
      `rod(20);\n` +
      `translate([30, 0, 0]) screw(10, true);\n` +
      `translate([60, 0, 0]) bearing();\n` +
      `translate([90, 0, 0]) washer();\n`,
  },
]
