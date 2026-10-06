# @faicad/faijs-openscad

把 OpenSCAD 模型转换成 faijs 代码（`.fai.js`）的独立转换器。

主线不是复刻 OpenSCAD 语言，而是复用 OpenSCAD 官方前端已经求值完成的输出：

```text
.scad ──(OpenSCAD 官方前端, 外部进程)──> 规范化 .csg
                                            │
                                            │ 自研 TypeScript lexer/parser
                                            ▼
                                        带源区间的 CSG AST
                                            │ lower + normalize + capability check
                                            ▼
                                        与 faijs 解耦的 Model IR
                                            │ deterministic emitter
                                            ▼
                                        可读可执行的 .fai.js ──(faijs)──> STL/STEP/3MF
```

`.csg` 可以直接作为输入，此时不需要安装 OpenSCAD。

---

## 当前状态：M2（Model IR + v0 emitter）已完成

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 包骨架、五阶段 CI、基线锁、OpenSCAD 发现与 doctor、三态 manifest、能力探针（含 ① 面 Host 装配测量） | ✅ 完成 |
| M1 | CSG lexer / parser / AST —— OpenSCAD examples 验证语料（50 示例 / 12435 节点，CC0）全部零诊断解析，含双路直方图对账 | ✅ 完成 |
| M2 | Model IR（7 个 pass）+ **v0 emitter**（14 个 P0 节点的 direct 映射）—— 22 个 P0-only 示例全部转出并通过 faijs 静态校验，28 个含范围外节点的示例明确 BLOCKED | ✅ 完成 |
| M3 | `.scad` CLI 与 examples 流水线（限 v0 范围） | ⬜ 未开始 |
| M4 | 几何 parity（限 v0 范围）与 analytic/faceted 裁决 | ⬜ 未开始 |
| P1 | `rotate_extrude` / `resize` / `polyhedron` / `hull` / `text` / `import` —— **不属于 v0** | ⬜ 未开始 |
| P2 | `minkowski` / 2D `offset` / `projection` / `surface` / `fill` 与发布 | ⬜ 未开始 |

CLI 目前只实现 `doctor` / `explain` / `version` / `help`；
`transpile` / `dump` / `check` / `run` / `corpus` / `report` 会明确返回退出码 1 而不是假装成功。

许可证已落盘：`LICENSE` 为 AGPL-3.0 全文（与 faijs-cadquery 逐字节一致，
sha256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`），
`package.json` 的 `license` 字段为 `AGPL-3.0-only`（T007 已关闭）。

---

## 首版（v0）交付范围：只承诺 P0

v0 承诺落地 **14 个节点**，全部是 `direct` 映射 —— 生成物只依赖 `@faicad/faijs` 的
① TS 兼容面，**不需要任何运行时 helper 库**：

```text
cube  sphere  cylinder  union  difference  intersection  multmatrix  group
square  circle  polygon  linear_extrude  render  color
```

范围外的 12 个节点（`rotate_extrude` `resize` `polyhedron` `hull` `minkowski` `text`
`import` `projection` `offset` `surface` `fill` `roof`）在 v0 **一律报 BLOCKED**
（诊断码 `OSC3002`）并进入 manifest 的三态清单 —— 不产出任何「近似」代码。
`approximate` 类在 v0 是**空集**：宁可 BLOCKED，也不交付「能跑但几何不同」的产物。

按 OpenSCAD examples 验证语料质量算，P0 节点均为 `direct`；范围外节点由 v0 范围门禁统一判 BLOCKED（不交付近似代码）：

```text
$ npx tsx tests/verify-examples.ts --write
OpenSCAD examples 验证语料：50 示例，12435 个 CSG 节点，22 种节点名
  P0 (direct)   kinds=14  nodes=12310  share=98.99%
  helper        kinds= 0  nodes=     0  share=  0.00%
  out-of-scope  kinds= 8  nodes=   125  share=  1.01%   (hull/import/offset/polyhedron/projection/rotate_extrude/surface/text)

v0 scope: 14 P0 node kinds direct；范围外 8 种节点由 shipped-scope 门禁判 BLOCKED
```


承诺范围由 `src/ir/shipped-scope.test.ts` 断言（P0 内必须全为 `direct`、且恰好等于
`direct` 全集、P0 覆盖语料质量 > 93%），任何范围漂移都会让 CI 失败。

---

## M1：CSG 解析层

| 文件 | 职责 |
|---|---|
| `src/csg/dialect.ts` | 26 个节点的词表（观察所得，附 container / leaf 分类） |
| `src/csg/ast.ts` | 带 `span`（1-based 行列 + 0-based offset）的 AST 与查询辅助 |
| `src/csg/lexer.ts` | 词法器：数字 / 科学计数法 / 字符串转义 / 注释 / 修饰符 |
| `src/csg/parser.ts` | 递归下降 + 错误恢复，**永不抛异常** |
| `src/csg/lexer.test.ts`、`parser.test.ts` | 单元层，含 36 个畸形输入的终止性测试 |
| `src/csg/corpus-parse.test.ts` | 语料回归（默认 OpenSCAD examples 验证语料）：零诊断 + 双路直方图对账 |
| `tests/examples-verify.test.ts` | OpenSCAD examples 验证语料回归（默认）：`tests/fixtures/openscad-examples/csg/*.csg` 零诊断 + 双路直方图对账 |

```ts
import { parseCsg, countCsgNodesByName } from '@faicad/faijs-openscad'

const { document, diagnostics } = parseCsg(csgText)
countCsgNodesByName(document) // Map<'multmatrix', 4790> …
```

验收结果：

```text
OpenSCAD examples 验证语料（50 示例）  全部零诊断解析
AST 直方图 == 文本直方图   22 种、12435 个节点，逐项相等
span 全部落在文本范围内    且行列 1-based 正确
terminator 与 bodySpan    全部自洽（有花括号必有区间）
```

---

## M2：Model IR 与 emitter

| 文件 | 职责 |
|---|---|
| `src/ir/model.ts` | Model IR 类型：3D/2D 图元、布尔、变换、成形、外观、`empty`、`blocked`；每节点带源区间 |
| `src/ir/lower.ts` | CSG AST → IR，一次承担 plan §4.3 的七个 pass（见下） |
| `src/emit/faijs.ts` | IR → `.fai.js`；稳定变量名、确定性输出、范围外节点拒绝产出 |
| `src/emit/units.ts` | **唯一**决定数字怎么渲染的地方（长度 `* MM`、角度规则） |
| `src/ir/lower.test.ts`、`src/emit/faijs.test.ts` | 单元层：pass 语义、生成物形态、拒绝策略、确定性 |
| `tests/examples-transpile.test.ts` | 门禁：P0-only 示例 100% 转出并过 faijs 静态校验；范围外示例 100% BLOCKED |

七个 pass 与实际裁决：

| pass | 裁决 |
|---|---|
| default-args | 补全 `cube` 的 size、`cylinder` 的 r1/r2、`square` 的 `[1,1]` 等 |
| dimension-inference | 2D/3D 混用 → `OSC2003` 拒绝（OpenSCAD 是警告后丢弃，这里不静默丢几何） |
| group-normalize | 空组 → `empty`；单子 → 透传；多子 → 隐式 union（**不用** `cad.compound`） |
| matrix-fold | 校验行主序 4×4 与底行 `[0,0,0,1]`；奇异矩阵 → `OSC2004` |
| modifier-policy | `%` 背景子树剔除；`#` 保留几何 + `OSC3001`（高亮语义不存在） |
| tessellation-policy | 显式 `$fn > 0` → `OSC3201`（analytic BREP 不保留棱面，不做假换算） |
| capability-classify | 范围外节点 → `IrBlocked` + `OSC3002`，**绝不静默跳过** |

生成物形态（`Basics/CSG.scad`，OpenSCAD 官方示例，CC0）：

```js
// source: Basics/CSG.scad
// generated by @faicad/faijs-openscad 0.29.5
// CSG -> IR -> faijs
let part0 = await cad.box(15 * MM, 15 * MM, 15 * MM, { centered: true })
let part1 = await cad.sphere(10 * MM)
let part2 = await cad.union(part0, part1)
let part3 = await cad.applyMatrix(part2, [
  [1, 0, 0, -24],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1]
])
// … 三个子树依此类推 …
let part11 = await cad.union(part3, part6, part10)
let result = part11
```

几条由探针钉住、不能凭直觉改的约定：

- **没有 import 行**：`cad` 与 `MM` 都是脚本面免 import 的全局（`S4_SAFE_GLOBALS`），
  `10 * MM` 可直接出现；但 op 实参里的 `Math` 会被前置静态校验拦下，所以数值一律
  预先算好输出字面量 —— 这正是 `emit/units.ts` 存在的理由。
- **矩阵元素写裸数字**，不加 `* MM`：旋转分量是无量纲的，逐元素加单位在语义上就是错的。
- **profile 的弧角是裸弧度**，不加 `* RADIAN`（`RADIAN` 是「1 弧度 = 57.2958 度」的
  换算因子，乘上去会把 π 变成 180）。
- **`linear_extrude(center = true)` 用一次平移矩阵**，而不是 `cad.translate` —— 后者
  属 3d_editor 消费面，不在 faijs 平台面上。

验收结果：

```text
50 个示例
  ├─ 22 个 P0-only        全部转出，且全部通过 faijs 静态校验（1 个超 1 MiB 源码上限，见下）
  └─ 28 个含范围外节点     全部 BLOCKED（OSC3002），code 为空串，绝不产出近似代码
生成语句总数 7697；同一输入两次输出字节一致
```

已知边界：`Advanced/module_recursion` 生成的程序约 1.3 MB，超过 faijs 静态校验器的
1 MiB 源码上限（`source too long`）。这是**输入规模**限制而非转换错误，已在门禁测试里
显式列出（不是跳过）。

### M2 期间由门禁暴露的真实缺陷（已修复并固化为回归断言）

**范围外节点曾被静默吞掉。** 当组合节点的子节点**全部**是范围外节点时（例如
`group() { color() { … linear_extrude() { projection() { … } } } }`），维度推断得到
「未知」，而 `combine` 把「无法推断维度」当成了「空几何」—— 于是 `blocked` 节点在
IR 树上消失，**7 个含 hull / import / projection / text 的示例被报成「转换成功」**。
修法是把「维度未知」拆成独立状态（`IrDimension` 的 `unknown`），保留节点本身；
`tests/examples-transpile.test.ts` 现在有一条断言把「有 OSC3002 却 ok:true」直接判死。

### M1 期间由对账暴露的两个真实缺陷（均已修复并固化为测试）

1. **位置参数被调研脚本漏掉**。语料里 **29%** 的参数（7221 个）是位置参数
   （没有 `name =`），且**只**出现在两个节点上：`multmatrix`（4×4 矩阵，4790 个）与
   `color`（RGBA 向量，2431 个）。早先的统计脚本只匹配 `name = value`，把这两个
   最高频的节点直接跳过，因此得出了「参数全部是命名参数」的**错误**结论。
   AST 因而改为 `name?: string` + `index: number`，并区分 named / positional。
2. **文本扫描漏掉 29 个节点**。原正则 `[%#!*]?` 既不允许修饰符后出现空白
   （`%\tcylinder(...)`，28 例），也不允许两个修饰符叠加（`%#multmatrix(...)`，1 例），
   使节点总数停在 17624 而非真实的 17653（在更早的全量语料统计上测得）。这个 bug 是靠
   「AST 直方图 vs 文本直方图逐项对账」抓出来的 —— 单看任何一路都不会发现。

---

## 快速开始

```bash
npm install
npm run build        # tsc -> dist + ESM 扩展名修正
npm test             # 单元测试 + 探针（不需要 OpenSCAD）
npm run lint
npm run typecheck
```

CLI：

```bash
node dist/cli/main.js doctor            # 环境报告（OpenSCAD / faijs / 语料）
node dist/cli/main.js doctor --json
node dist/cli/main.js explain OSC3201   # 诊断码说明
node dist/cli/main.js explain           # 全部诊断码
```

环境变量：

| 变量 | 用途 |
|---|---|
| `MCAD_LIB` | MCAD（LGPL）库根目录，**可选**：仅 `Old/example023.scad` 通过 `use <MCAD/...>` 传递依赖它；默认验证语料是 OpenSCAD examples，不需要它 |
| `OPENSCAD_BIN` | 指定 OpenSCAD 可执行文件路径 |
| `FAIJS_PROBE_RUNTIME=1` | 启用需要加载 faijs wasm 运行时的探针（较慢，默认关闭） |

脚本：

```bash
npm run baseline:check   # 校验 src/baseline.ts 与 tests/baseline.json 及语料数量
npx tsx tests/verify-examples.ts --write   # 用 OpenSCAD examples 生成验证语料（.csg）并解析对账
npm test tests/examples-verify.test.ts     # 门禁：examples 语料零诊断解析
npm test tests/examples-transpile.test.ts  # 门禁：P0-only 转出 + 过 faijs 静态校验，范围外一律 BLOCKED
npx tsx tests/gen-examples-fai.ts          # 为每个 P0-only example 在同目录写出 .fai.js（默认不入库）
```

直接运行的探针（长期保留，不参与 CI 默认阶段）：

```bash
node tests/probe-faijs-ts-face.mjs    # ① TS 兼容面 + Host 装配（结论以此为准）
node tests/probe-faijs-host.mjs       # ② cad 脚本面（经 runtime.execute）
FAIJS_PROBE_RUNTIME=1 node tests/probe-faijs-api.mjs   # 早期错误做法，留作反面证据
```

Windows 本地全量 CI：`pwsh scripts/ci.ps1`（lint → typecheck → build → test（外部硬看门狗 + stderr 零容忍）→ pack）。

---

## 目录

```text
src/
  version.ts          转换器身份与协议版本
  baseline.ts         版本/语料基线（唯一真相源）
  environment.ts      doctor / inspectEnvironment
  frontend/           OpenSCAD 前端适配（csg-text / cli / 二进制发现）
  csg/dialect.ts      实测得到的 CSG 节点词表（26 个）
  csg/ast.ts          带 span 的 CSG AST 与查询辅助
  csg/lexer.ts        词法器（数字 / 转义 / 注释 / 修饰符）
  csg/parser.ts       递归下降解析器（永不抛异常，带错误恢复）
  csg/*.test.ts       单元层 + 语料回归（双路直方图对账；OpenSCAD examples 验证为默认）
  ir/capability.ts    节点能力分级（direct / helper / approximate / unsupported）+ v0 范围
  ir/shipped-scope.test.ts  v0 范围守门（P0 全为 direct、覆盖质量 > 93%）
  emit/units.ts       单位与字面量策略（唯一允许决定数字怎么渲染的地方）
  diagnostics/        诊断模型、错误码表、格式化
  cli/                CLI 入口与命令
  __probe__/          探针共用的环境门控、faijs 静态契约扫描、语料扫描器
tests/
  baseline.json       由 src/baseline.ts 派生的基线产物（OpenSCAD examples 验证语料，CC0，不引用 OpenSCAD 源码）
  fixtures/openscad-examples/  OpenSCAD 官方 examples/ 完整拷贝（CC0）+ 生成的 .csg；同目录 .fai.js 由 gen-examples-fai.ts 产出
  gen-manifest.ts / check-baseline.ts / coverage.ts
  probe-faijs-ts-face.mjs   ① TS 兼容面探针（含 Host 装配）
  probe-faijs-host.mjs      ② 脚本面探针（经 runtime.execute）
  probe-faijs-api.mjs       早期错误做法，留作反面证据
```

---

## 关键约束与已确认事实

1. **OpenSCAD 只作为外部进程调用**。其源码是 GPL-2.0-or-later；本项目不链接、不复制其源码，npm 产物不含任何 OpenSCAD 二进制或上游源码。
2. **CSG 不是稳定 API**：词表与方言以 `src/baseline.ts` 锁定的 OpenSCAD 版本与语料口径为准；语料里出现新节点名时词表探针会失败，要求人工复核而不是静默忽略。
3. **语料基线**：默认验证语料为 **OpenSCAD 官方 `examples/`**（CC0-1.0，已完整拷贝到 `tests/fixtures/openscad-examples/`）的真实 `.scad`（50 示例 / 12435 节点，经本机 OpenSCAD 二进制求值为 `.csg`）。MCAD 仅作可选传递依赖，不是语料。
4. **CSG 参数有两种写法**（实测）：命名 `name = value` 17376 个；**位置** `value` 7221 个（占 29%），
   且只出现在两个节点上 —— `multmatrix`（4×4 矩阵，4790 个）与 `color`（RGBA 向量，2431 个）。
   AST 用 `name?: string` + `index: number` 同时表达两者；早期版本只认命名参数，
   会在这两个最高频的节点上直接解析失败。
5. **faijs 有三个 API 面，我们站在「库作者」这一面**（实测 2026-10-06）：

   | 面 | 消费者 | 形态 | 位置 |
   |---|---|---|---|
   | ① TS 兼容面 | **第三方 TS 库（本项目）** | 扁平函数 + 位置参数 + `Result`；57 个候选 op 里只有 `polyhedron` 缺失 | `@faicad/faijs` 主导出 |
   | ② cad 脚本面 | `.fai.js` | `cad.*`；语句边界 unwrap `Result` | Host 注入的 `cad` 命名空间（95 op） |
   | ③ 库边界面 | 库导出函数 | `defineOp` 声明，`registerLib` 接纳 | `@faicad/faijs/sdk` |

   实现新 op（填补 `polyhedron` / `hull` / `minkowski` 等缺口）应走**库开发指南**
   （`faijs/docs/library-dev-guide.zh.md`）的 `defineOp` 路线，而不是去扩展脚本面。

6. **`import { cad }` 拿到的 38 键对象不是任何一面**。它是一个内部 BREP 命名空间
   （`boxBrep`/`fuseBrep`/`*Brep`）。早期基于它得出的结论（布尔不可用 / `volume` 返回
   NaN / 球差 0.22%）**已全部撤回**——那是在**没有装配 Host** 的情况下测的假象。
7. **装配 Host 是硬前提**：`initOcctWasm()` → `registerOcctBrepEngine()` →
   `configureBackends({ config: { mode, brepEngineId, brepCapabilities }, kernel: { brep } })`。
   `brepCapabilities` 最容易被漏（`runtime.ts:577` 是 getter），漏了布尔会报
   `E_BREP_UNSUPPORTED (brepEngineId=<none>)`。
8. **装配后 ① 面是精确的**：`volume(sphere(10)) = 4188.790204786392`，与解析值误差 0.0000%。
   几何 parity 的差异应归因于 OpenSCAD 的 `$fn` 离散化，而不是 faijs 的误差。
9. **`convexHull` ≠ OpenSCAD 的 `hull`**：前者接受**点集**（内核方法 `hullFromPoints`），
   喂 shape 会抛 `points.map is not a function`。`offset` 同理——faijs 的 `offset` 是
   **3D 全表面**偏移（10mm box +2 → 2610.5 mm³），对 2D 轮廓是 **no-op**。
10. **`color` 走实例方法**：`Shape.setColor / setOpacity / setAppearance / getAppearance`
   实测可用（`setColor('#e53935')` + `setOpacity(0.5)` 经 `getAppearance()` 往返成功）。
11. **单位常量在 `@faicad/faijs/units`**（`MM=1`、`DEGREE=1`、`RADIAN=180/π`），主入口不导出。
12. **`.fai.js` 语句是换行分隔**，不是 `;` 分隔；写在一行会在首条语句后**静默截断**。
13. 详细勘误与对 faijs 的文档/设计建议见 `docs/plans/2026-10-06-faijs-api-assumption-errors.md`。
14. **许可证 `AGPL-3.0-only`**（与 faijs-cadquery 对齐，2026-10-06 落盘）。OpenSCAD 仅作外部
    进程调用（其 GPL-2.0-or-later 不影响本包分发）；`src/csg/` 的解析器是针对 CSG 输出格式的
    独立实现，未复制 OpenSCAD 的语法 / 词法 / 求值器实现（GPL）。

---

## 语料加权覆盖率（2026-10-06 实测）

**默认验证基线为 OpenSCAD examples 语料**（`npx tsx tests/verify-examples.ts --write`）：

```text
OpenSCAD examples 验证语料：50 示例，12435 个 CSG 节点，22 种节点名
  direct       kinds=14  nodes=12310  share= 98.99%
  helper       kinds= 0  nodes=    0  share=  0.00%
  out-of-scope kinds= 8  nodes=  125  share=  1.01%
  covered (P0 全集)  cube sphere cylinder union difference intersection multmatrix group
               square circle polygon linear_extrude render color
  out-of-scope 8 种    hull import offset polyhedron projection rotate_extrude surface text
```

examples 语料覆盖全部 14 个 P0 节点、12310 个 P0 节点（98.99% `direct`）；另有 8 种范围外节点
（125 个，1.01%）由 `src/ir/shipped-scope.test.ts` 的 v0 范围门禁统一判 **BLOCKED**，不交付任何
「近似」代码。`resize` / `minkowski` / `fill` / `roof` 这 4 种范围外节点未出现在 examples 中。


---

## 测试分层

- **常规 CI（无需 OpenSCAD 源码）**：CSG 词法/语法单测（含 36 个畸形输入的终止性）+ 静态契约探针
  + 词表/方言/清单不变量 + v0 范围守门 + **OpenSCAD examples 验证语料回归**（`tests/examples-verify.test.ts`）
  + **M2 转换门禁**（`tests/examples-transpile.test.ts`：P0-only 100% 转出并通过 faijs 静态校验，
  范围外节点 100% BLOCKED）。
- **M2 单元层**：`src/ir/lower.test.ts`（七个 pass 的语义裁决）与 `src/emit/faijs.test.ts`
  （生成物形态、拒绝策略、确定性），两者都不需要 OpenSCAD 二进制。
- **运行时层**：`FAIJS_PROBE_RUNTIME=1` 时加载 faijs wasm，验证 TS 层可用子集与几何事实。
- 所有探测性代码都以 `*.probe.test.ts` / `tests/probe-faijs-*.mjs` 形式**长期保留**，不允许用后即删；
  `src/probe-inventory.test.ts` 同时守住探针清单与 M1 关键测试清单。
