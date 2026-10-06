# faijs-openscad 开发计划

> 日期：2026-10-05  
> 目标项目：`C:/my/Faicad/faijs-openscad`  
> 本文只制定计划，不创建项目代码。  
> 事实基线：仅依据 2026-10-05 的当前源码、仓库自带测试和本机可执行程序；未使用历史 `docs/plans` 作为现状依据。

---

> ## ⚠️ 勘误（2026-10-06 追加）——读本文前必看
>
> 本文 §5 等处的 faijs 现状描述，部分基于**错误的 API 面**：把
> 「`import { cad }` 的 38 键对象」当成了 faijs 的对外接口，且**没有装配 Host**。
> 实地复核后，以下结论已被**撤回**（详见
> `docs/plans/2026-10-06-faijs-api-assumption-errors.md`，v2）：
>
> | 本文中的说法 | 复核结果 |
> |---|---|
> | 布尔运算默认不可用 | **错**。装配 `initOcctWasm` + `registerOcctBrepEngine` + `configureBackends` 后 union/subtract/intersect 全部可用且精确 |
> | `volume()` 静默返回 NaN | **错**。① TS 兼容面上 `volume(shape)` 精确（sphere r=10 → 4188.790204786392，误差 0.0000%） |
> | faijs 的球差 0.22%、不是精确球 | **错**。那个数字是 **mesh 路径**的多面体体积；BREP 路径解析精确 |
> | TS 层无法验证 `profile/extrude/revolve/mirror/applyMatrix/offset` | **错**。它们是 ① TS 兼容面的自由函数，57 个候选里只有 `polyhedron` 缺失 |
>
> 仍然成立并已加固的结论：
> - 主线「OpenSCAD 官方前端 → CSG → 自研 parser → IR → emitter」**不变**；
> - 生成代码面向 ② 脚本面（`.fai.js`）**不变**；
> - **新增**：填补 `polyhedron` / `hull` / `minkowski` 等缺口，不应去扩展脚本面，
>   而应按 `faijs/docs/library-dev-guide.zh.md` 用 `@faicad/faijs/sdk` 的 `defineOp`
>   写一个 faijs-openscad runtime 库（与 `faijs-extra` / `sheetmetal` / `faijs-gears` 同构）；
> - **新增**：语料加权覆盖率 97.01% direct / 0.60% helper / 2.39% unsupported（225 golden，17624 节点），
>   用 `npm run coverage` 复现；M1/M2 的范围应以这个加权口径重新核对。
> - **修正**：`convexHull` 是**点集**凸包（内核 `hullFromPoints`），不等于 OpenSCAD 的 `hull`；
>   faijs `offset` 是 **3D 全表面**偏移，对 2D 轮廓是 no-op。本文 §5.1 的映射表在这两行需按此修正。

---

> ## ✅ 决策记录（2026-10-06，项目所有者拍板）
>
> | 决策项 | 结论 | 落盘位置 |
> |---|---|---|
> | T007 许可证 | **`AGPL-3.0-only`**，与 faijs-cadquery 对齐（LICENSE 逐字节一致，sha256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`） | `LICENSE`、`package.json` → `license`、`NOTICE` |
> | 首版交付范围 | **只承诺 P0**：14 个节点，全部 `direct`，不引入运行时 helper 库 | `src/ir/capability.ts` → `SHIPPED_PHASE` / `SHIPPED_NODES`；守门测试 `src/ir/shipped-scope.test.ts` |
>
> 「只承诺 P0」的可执行含义（由测试断言，不是纸面承诺）：
>
> 1. v0 范围内**全部是 `direct`** → 生成物只依赖 `@faicad/faijs` ① 面，**不需要写 runtime 库**；
> 2. v0 范围**恰好等于 `direct` 全集** → 不存在「已可用却没承诺」或「承诺了却要 helper」的节点；
> 3. `approximate` 在 v0 是**空集** → 范围外一律 `OSC3002` BLOCKED，**不产出近似几何**；
> 4. v0 覆盖语料 **17097 / 17624 = 97.01%** 的节点质量，门禁阈值 > 93%。
>
> 因此本文 §6 里程碑中的 **M1–M4 按 P0 范围执行**；P1/P2 章节保留为后续规划，
> **不属于 v0 承诺**。范围外的 12 个节点：`rotate_extrude` `resize` `polyhedron` `hull`
> `minkowski` `text` `import` `projection` `offset` `surface` `fill` `roof`。
>
> **验证基线（2026-10-06）**：移植正确性以 **OpenSCAD 官方 `examples/`**（CC0-1.0）为默认验证输入——
> 该目录已**完整拷贝**进本项目（`tests/fixtures/openscad-examples/`，含 `COPYING-CC0.txt`），并在同目录
> 由 `tests/gen-examples-fai.ts` 生成对应的 `.fai.js`。经本机 OpenSCAD 二进制求值为 `.csg` 后由自研解析器
> 解析（50 示例 / 12435 节点，全部零诊断）；**不**依赖 OpenSCAD 源码仓库自带的测试文件，详见 §2.2 与 §9.4。

---

## 1. 结论先行

建议把 `faijs-openscad` 定位为一个**独立 TypeScript/ESM 转换器包**，主线不是从头复刻 OpenSCAD 语言，而是：

```text
.scad
  │
  │ OpenSCAD 官方前端（CLI，后续可换 WASM）
  ▼
规范化 .csg 文本
  │
  │ faijs-openscad 自研 lexer/parser
  ▼
带源区间的 CSG AST
  │
  │ lower + normalize + capability check
  ▼
与 faijs 解耦的 Model IR
  │
  │ deterministic emitter
  ▼
可读、可检查、可执行的 .fai.js
  │
  │ faijs check/run/export
  ▼
STL / STEP / 3MF
```

### 1.1 为什么采用这条主线

1. OpenSCAD 当前二进制已经能通过 `--export-format csg` 输出求值后的 CSG 树；模块、函数、变量、`for`、`if`、`let`、`children()`、`include/use`、特殊变量等高层语义已由官方二进制处理，项目不读取其源码。
2. OpenSCAD 官方 `examples/`（CC0-1.0）提供齿轮 / 轴承 / 文字 / 旋转挤出 / 投影 / 屋顶 / 轮廓 / 阵列 / 2D 形状 / 颜色等 **50 个真实模型**，作为黑盒输入即可开发解析器、IR 和代码生成器，无需复制 OpenSCAD 源码或引入其测试文件（详见 §2.2）。
3. CSG 语料里实际出现的节点词表只有 26 个，远小于完整 OpenSCAD 语言前端。
4. 直接复制 `faijs-cadquery/src/transpile.ts` 的“AST → 字符串”结构不合适。OpenSCAD CSG 存在树形子节点、2D/3D 维度、隐式 union、矩阵、颜色和 unsupported 节点，必须有显式 IR 与诊断层。
5. 纯 TypeScript OpenSCAD lexer/parser/evaluator 只在后期有明确需求时启动；首期不重复实现官方语言语义。

### 1.2 项目应提供两种输入模式

- **`.scad` 模式**：调用外部 OpenSCAD 前端生成 CSG，再转换为 `.fai.js`。这是用户入口。
- **`.csg` 模式**：直接转换已有 CSG。用于无 OpenSCAD 环境、单元测试、语料回归和问题复现。

### 1.3 输出策略

- 能由当前 faijs 脚本面准确表达的节点，直接生成 `cad.*` 调用。
- 只有确实缺失且能够准确实现的能力才进入 `@faicad/faijs-openscad/runtime` helper 层。
- 不能保证语义等价的节点必须产生明确诊断；默认失败，不允许像现有 CadQuery 转译器那样静默生成 `[unhandled ...]` 注释后仍返回成功。
- 默认生成**顺序化、可读、可调试**的代码，不生成超长嵌套表达式。

---

## 2. 调研基线

### 2.1 仓库与版本

| 项目             | 当前基线                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| 本机 OpenSCAD    | `C:/Program Files/OpenSCAD/openscad.exe`，版本 `2021.01`（**仅作外部求值器，不依赖其源码**）            |
| OpenSCAD examples（CC0） | `tests/fixtures/openscad-examples/`，已完整拷贝进本项目的验证语料；MCAD（LGPL）仅 `Old/example023.scad` 的**可选**传递依赖 |
| faijs-cadquery | `C:/my/Faicad/faijs-cadquery`，commit `9647e2fbe03aaf068334b458886f49dc413cf6e0`，包版本 `0.29.5`     |
| faijs          | `C:/my/Faicad/faijs`，commit `2bb3ec82182bcf4854c66384b94ffb783de2042f`，包版本 `0.29.5`              |
| faijs-openscad | 当前不存在                                                                                            |

OpenSCAD **只**作为外部二进制被调用（CLI 把 `.scad` 求值为 `.csg`）；项目不引入、不复制其 GPL 源码，
也不依赖其源码仓库的测试文件作为语料。移植正确性验证以 OpenSCAD 官方 `examples/`（CC0-1.0，已完整拷贝进
本项目）的真实 `.scad` 为输入，经本机 OpenSCAD 2021.01 求值为 `.csg` 后由自研解析器解析（详见 §2.2、§2.3 与 §9）。
MCAD（LGPL-2.1）仅作可选传递依赖（`Old/example023.scad` 通过 `use <MCAD/...>` 引用），**不是**验证语料。文档所记录的
OpenSCAD 版本即本机可用构建 `2021.01`；若日后升级构建，需在 `tests/baseline.json` 显式 pin 并审阅 diff。

### 2.2 验证语料（OpenSCAD examples，CC0-1.0）

移植正确性验证以 **OpenSCAD 官方 `examples/`** 的真实 `.scad` 为输入样本，经 OpenSCAD 二进制求值为 `.csg`
后供解析器解析；**不**使用 OpenSCAD 源码仓库自带的测试文件作为语料。`examples/` 目录以 **CC0 1.0**
（公共领域，见 `tests/fixtures/openscad-examples/COPYING-CC0.txt`）发布，已**完整拷贝**进本项目
（`tests/fixtures/openscad-examples/`），可随本 AGPL 包再分发，与 OpenSCAD `src/` 的 GPL 无关。

`examples/` 是 OpenSCAD 官方随包发布的示例集，几何覆盖面广（齿轮 / 文字 / 旋转挤出 / 投影 / 屋顶 / 轮廓 /
阵列 / 2D 形状 / 颜色 / 旧版示例等），足以作为真实世界的解析语料。项目只把它当**黑盒输入**，不复制其源码。
同目录下由 `tests/gen-examples-fai.ts` 为每个 `.scad` 生成对应的 `.fai.js`（M2 发射器就绪后生效）。

| 语料 | 数量 | 说明 |
| --- | --: | --- |
| OpenSCAD examples 目录 | 50 | 完整拷贝进 `tests/fixtures/openscad-examples/` 的 CC0 真实模型（Advanced/Basics/Functions/Old/Parametric） |
| 生成的 CSG 节点 | 12435 | 经本机 OpenSCAD 2021.01 求值、由自研解析器零诊断解析（2026-10-06 实测） |
| 同目录 .fai.js | 50 | 由 `tests/gen-examples-fai.ts` 经 M2 发射器产出（当前发射器未落地，待 M2） |

CSG 方言实际出现的节点名共 26 个（与 OpenSCAD CSG 输出格式一致），均已纳入解析器能力矩阵：

```text
circle color cube cylinder difference fill group hull import intersection
linear_extrude minkowski multmatrix offset polygon polyhedron projection render
resize roof rotate_extrude sphere square surface text union
```

修饰符中出现 `%` 和 `#`；`!` 已在 OpenSCAD 导出前完成 root 选择，`*` 禁用节点不会进入结果树。
以上节点词表已由 OpenSCAD examples 产出的 CSG 实测覆盖验证（见 §2.3）。

### 2.3 OpenSCAD 官方前端（外部二进制）的可用性

OpenSCAD 以**外部二进制**形式被调用，把 `.scad` 求值为规范化 `.csg`；项目不读取、不复制其 GPL 源码，
也不依赖其源码仓库的测试文件。模块、函数、变量、`for`/`if`/`let`、`children()`、`include/use`、
特殊变量等高层语义全部由官方二进制处理，自研解析器只需处理求值后的 CSG 文本。

验证流程（语料为 OpenSCAD examples，CC0）：`tests/verify-examples.ts` 对每个 `.scad` 调用 OpenSCAD
（外部进程）求值为 `.csg` → 自研 CSG 解析器解析 → AST 节点直方图与独立文本扫描逐项对账。该流程已在本机
实际跑通（OpenSCAD 2021.01）：

```text
tests/verify-examples.ts --write
  EXAMPLES_ROOT = tests/fixtures/openscad-examples
  OpenSCAD = C:/Program Files/OpenSCAD/openscad.exe
  示例总数 = 50，生成 CSG = 50，零诊断且直方图一致 = 50
  CSG 节点总数 = 12435
```

能够输出包含 `multmatrix`、`union`、`intersection`、`difference`、`cube`、`sphere`、`circle`、`polygon`、
`color`、`cylinder`、`group` 等真实几何的规范 CSG 文本，且均被解析器零诊断解析。门禁测试见
`tests/examples-verify.test.ts`（Vitest，需先运行 `verify-examples.ts --write` 生成 `.csg`）。

### 2.4 faijs-cadquery 可复用与不可复用部分

#### 可复用

- 独立包结构、TypeScript/ESM 配置和 browser-safe 子入口。
- `peerDependencies` 模式和版本对齐方式。
- `lint → typecheck → build → test → pack` 五阶段 CI。
- Vitest、进程级 watchdog、stderr 零容忍。
- `manifest.json` 的 `ported / blocked / skipped` 三态管理。
- golden fixture、候选运行、几何比较和报告生成方法论。
- Windows 下子进程与 UTF-8 的处理经验。

#### 不可复用

- `src/transpile.ts` 的弱类型 AST 和“直接拼字符串”架构。
- Python AST 外部进程链路。
- `Workplane`、选择器、pending wire 等 CadQuery 专用运行时。
- “unsupported 生成注释但退出码仍为 0”的策略。
- “最后一个赋值变量就是结果”的终端推断。

当前 CadQuery 转译器的事实依据包括：

- `faijs-cadquery/src/transpile.ts:17-35`：AST 只有 `_type` 与任意字段，没有判别联合和源区间。
- `faijs-cadquery/src/transpile.ts:94-146`：直接拼接输出文本。
- `faijs-cadquery/src/transpile.ts:151-170`：未知语句只输出注释。
- `faijs-cadquery/src/parity-smoke.test.ts:45-132`：30 个稳定 STEP golden 进入 Vitest；全量 parity 留在本地流程。

### 2.5 当前 faijs 目标面的关键约束

1. `@faicad/faijs` 当前版本为 `0.29.5`。
2. `cad.box`、`cad.sphere`、`cad.cylinder`、`cad.cone` 存在；锚点语义见 `packages/core/src/api/primitives.ts:223-403`。
3. `cad.translate`、`cad.rotate_euler`、`cad.scale`、`cad.scale3d` 存在，见 `packages/core/src/api/transform.ts:221-368`。
4. `cad.applyMatrix`、`cad.convexHull`、`cad.offset` 已进入当前脚本面，而不是仅 TS 内部 API：
   - `packages/core/src/api/generated/script-face.ts:9-16,21-62`
   - `packages/core/src/lang/symbol-table.generated.ts:88-94`
5. `cad.applyMatrix` 对应 OpenSCAD `multmatrix`，但只支持可逆 4×4 仿射矩阵，见 `packages/core/src/api/brep-mirror/topologyFns.ts:70-129`。
6. 2D 轮廓入口是 `cad.profile`；线段、圆弧和样条数据结构见 `packages/core/src/api/profile.ts:33-120`。
7. `cad.revolve` 的 `angle` 是**弧度**，见 `packages/core/src/api/revolve.ts:123-143`；大部分其他 faijs 角度槽是度。
8. 长度与角度字面量必须显式带单位；例如 `10 * MM`、`45 * DEGREE`。当前检查见 `packages/core/src/lang/dimension-check.test.ts:45-87`。
9. `cad.polyhedron`、形状集合语义的 `hull`、`minkowski` 当前仍缺失；`arg-spec.ts:3927-3939` 将这三类登记为 skip。
10. `cad.offset` 是 3D 全表面偏置，不等价于 OpenSCAD 2D `offset()`。
11. core 导出支持 STL、STEP、3MF；CLI 常用输出为 STL/STEP，不应在计划中声称已有 GLB 导出。

---

## 3. 产品目标与非目标

### 3.1 目标

1. 提供稳定 CLI，把 `.scad` 或 `.csg` 转换成 `.fai.js`。
2. 默认生成可读、可检查、可执行的 faijs 代码。
3. 以 OpenSCAD 官方 `examples/`（CC0-1.0，已完整拷贝进 `tests/fixtures/openscad-examples/`）为验证语料（50 示例、12435 个 CSG 节点；详见 §2.2），并在同目录生成对应的 `.fai.js`；可选用用户自带 `.scad`。
4. 建立明确的能力矩阵、版本锁、三态 manifest 和可复现报告。
5. 对 unsupported、近似转换和外部资源依赖提供结构化诊断。
6. 支持 Node 环境；浏览器入口至少支持 CSG 文本到 faijs 文本的纯转换。
7. 所有用于摸清 faijs/OpenSCAD 行为的探测都保留为长期测试，不删除。

### 3.2 首期非目标

1. 不复刻 OpenSCAD GUI、预览器、Customizer 或动画时间轴。
2. 不在 P0-P2 实现完整 `.scad` lexer/parser/evaluator。
3. 不复制 OpenSCAD 的 Flex/Bison/C++ 源码到项目。
4. 不承诺生成代码保留原始模块、变量、注释和参数化结构；主线保证的是**求值后几何语义转换**。
5. 不用“放宽容差”掩盖几何差异。
6. 不把近似实现记为完全等价。

---

## 4. 核心架构

### 4.1 前端适配层

定义统一接口：

```ts
interface OpenScadFrontend {
  readonly kind: 'cli' | 'wasm' | 'csg-text'
  inspect(): Promise<FrontendInfo>
oooooooooooooooooo: FrontendOptions): Promise<CsgArtifact>
}
```

首期实现：

- `CsgTextFrontend`：直接接收 CSG 文本，不依赖外部程序。
- `OpenScadCliFrontend`：使用 `execFile` 调用 OpenSCAD；禁止拼接 shell 命令。
- 二进制发现顺序：显式 `--openscad-bin` → `OPENSCAD_BIN` → 平台默认安装路径 → PATH。
- `doctor` 输出二进制路径、版本、源码 baseline、faijs 版本与能力探针结果。

后期可选：

- `OpenScadWasmFrontend`：包装官方 `node-module` 构建；接口与 CLI frontend 一致。
- 只有浏览器、离线部署或无外部进程是明确需求时才投入。

### 4.2 CSG lexer/parser

CSG 解析器必须是项目自研、纯 TypeScript、零运行时依赖，并满足：

- token 带 `start/end` offset、行、列；
- 支持数字、负零、Infinity、布尔、`undef`、字符串转义、向量、嵌套矩阵；
- 支持命名参数、空参数、`;` 叶节点和 `{ ... }` 容器节点；
- 支持 `%`、`#` 修饰符；
- 对未知参数可产生 warning 后保留；
- 对未知节点默认 error；仅 `--allow-partial` 下才允许跳过；
- parser 不直接知道 faijs API。

建议 AST：

```ts
interface CsgNode {
  id: number
  name: string
  modifier?: '%' | '#'
  args: Array<{ name?: string; value: CsgValue; span: Span }>
  children: CsgNode[]
  span: Span
}
```

### 4.3 规范 IR

IR 不能等同于字符串模板。建议至少区分：

- 3D：`Box`、`Sphere`、`Cylinder`、`Polyhedron`；
- 2D：`Rectangle2D`、`Circle2D`、`Polygon2D`、`Text2D`；
- 组合：`Union`、`Difference`、`Intersection`、`Group`、`Empty`；
- 变换：`MatrixTransform`；
- 成形：`LinearExtrude`、`RotateExtrude`、`Projection`、`Offset2D`；
- 高级：`Hull`、`Minkowski`、`Resize`、`Surface`、`ImportGeometry`、`Roof`；
- 外观：`Color`；
- 元数据：`origin`、`sourceDialect`、`warnings`、2D/3D 维度。

必需 passes：

1. `default-args`：补全不同 CSG 版本省略的默认参数。
2. `dimension-inference`：标记 2D/3D，阻止错误混合。
3. `group-normalize`：区分空组、单子组、多子隐式 union。
4. `matrix-fold`：合并连续矩阵并校验可逆性。
5. `modifier-policy`：`%` 背景子树从结果几何剔除；`#` 保留几何但记录“高亮丢失”。
6. `tessellation-policy`：解释 `$fn/$fa/$fs`，但不把它错误等同为 faijs BREP 的 `segments`。
7. `capability-classify`：为每个节点标记 `direct / helper / approximate / unsupported`。

### 4.4 faijs emitter

发射原则：

- 每个几何节点生成稳定变量名：`part0`、`part1`……；
- 深层树拆成顺序语句，便于定位错误；
- 所有几何调用统一显式 `await`，不混用隐式提升；
- 长度字面量统一输出 `* MM`；常规角度输出 `* DEGREE`；`revolve.angle` 与 profile arc 保留弧度；
- 默认生成 `let result = ...` 终端变量；
- 只在实际使用 helper 时生成 runtime import；
- 输出固定头部包含源文件、OpenSCAD 版本、转换器版本和非等价警告摘要；
- 使用内部 deterministic writer，不依赖格式化器才能得到稳定输出。

示例形态：

```js
// source: examples/Basics/CSG.scad (OpenSCAD 官方示例，CC0)
// generated by @faicad/faijs-openscad

let part0 = await cad.box(15 * MM, 15 * MM, 15 * MM, { centered: true })
let part1 = await cad.sphere(10 * MM)
let part2 = await cad.union(part0, part1)
let part3 = await cad.applyMatrix(part2, [
  [1, 0, 0, -24],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
])
let result = part3
```

当前 `cad.applyMatrix` 没有 `paramDims` 元数据，矩阵中的平移项按 faijs 基准长度单位 mm 输出裸数值；该约定必须由专门探针锁定。若 faijs 后续给矩阵增加量纲契约，只允许在 emitter 的单一单位策略处调整。

### 4.5 runtime helper 边界

runtime helper 只用于以下情况：

1. 当前 `cad` 脚本面没有对应能力；
2. 现有能力只能从 TS API 获得；
3. 可以实现精确或明确标注的近似语义；
4. helper 有独立单测、能力探针和失败诊断。

禁止把已有的 `cad.applyMatrix`、`cad.convexHull`、`cad.offset` 再包一层同名 helper。当前代码已经把它们放入脚本面，应直接调用；但 OpenSCAD `hull()` 与 2D `offset()` 的语义仍不能直接用这些 op 替代。

建议 runtime 入口：

```ts
export function createOpenScadNamespace(): LibNamespace
```

包元数据建议先使用：

```json
{
  "faijs": { "autoLift": false }
}
```

所有异步调用由生成代码显式 `await`，避免隐式提升掩盖调用边界。该值在 M0 通过最小库注册探针后最终锁定。

---

## 5. 能力分级与映射

### 5.1 P0：先形成可用闭环

| OpenSCAD CSG               | faijs 目标                            | 备注                              |
| -------------------------- | ----------------------------------- | ------------------------------- |
| `cube(size, center)`       | `cad.box(w, d, h, { centered })`    | 长度加 `MM`                        |
| `sphere(r)`                | `cad.sphere(r)`                     | 默认走解析 BREP；显式低 `$fn` 的棱面差异单列诊断  |
| `cylinder(h,r1,r2,center)` | `r1===r2 ? cad.cylinder : cad.cone` | 参数顺序与锚点必须测试                     |
| `union`                    | `cad.union(...children)`            | 空/单子节点单独处理                      |
| `difference`               | `cad.subtract(base, ...tools)`      | 无 base 为错误                      |
| `intersection`             | `cad.intersect(...children)`        |                                 |
| `group` / root             | 默认按隐式 union 处理                      | 禁止无依据改成 `cad.compound`；先做重叠实体探针 |
| `multmatrix`               | `cad.applyMatrix(shape, matrix)`    | 当前脚本面已存在；BREP-only              |
| `square`                   | `cad.profile` 矩形轮廓                  | 2D face                         |
| `circle`                   | `cad.profile` 圆轮廓                   | profile arc 用弧度                 |
| `polygon`                  | `cad.profile` 多轮廓                   | `paths=undef` 与孔洞规则要测试          |
| 简单 `linear_extrude`        | `cad.extrude`                       | 先支持无 twist、无非等比 scale           |
| `color`                    | `setColor` / `setOpacity`           | 外观丢失不影响几何，但需行为测试                |
| `render`                   | 几何透传                                | `convexity` 只记录 info            |
| `%`                        | 删除背景子树                              | 与 OpenSCAD 导出语义一致               |
| `#`                        | 保留几何、丢弃高亮                           | warning                         |


P0 不以“固定某个数量的用例”作为虚假指标。实现时由语料扫描器自动计算“只含 P0 节点”的用例集合，**该集合必须 100% 解析、发射、check 和执行成功**。

### 5.2 P1：高价值精确扩展

| 特性 | 计划 |
|---|---|
| `rotate_extrude` | 映射到 `cad.revolve`；先验证 OpenSCAD XY 轮廓到 faijs 旋转截面平面的坐标变换、`start` 与角度方向 |
| `polyhedron` | 先做 BREP/mesh 重建 spike；只有闭合性、面方向、自交诊断可靠后进入正式 helper |
| `hull(children)` | 不能直接把形状传给 `cad.convexHull(points)`；需可靠提取全部顶点后调用，先做准确性与性能 spike |
| 非刚性 `multmatrix` | 当前 `cad.applyMatrix` 已支持一般可逆仿射矩阵，直接使用并测试剪切、镜像、非均匀缩放 |
| `resize` | 读取 bbox 后计算缩放与居中；`auto` 规则需按 OpenSCAD 行为建立测试 |
| `text` | 通过 `@faicad/faijs-extra`，明确字体目录、字体替代和缺字诊断 |
| `import` | 优先支持 STL、STEP、BREP；通过 `faijs-extra` 或 core import op，路径相对源 `.scad` 解析 |

### 5.3 P2：能力缺口与高风险模块

| 特性 | 计划 |
|---|---|
| `linear_extrude(twist/scale/slices)` | 逐项探针；`twistExtrude` 可作为候选，但输入 wire/face 与缩放律必须验证 |
| `projection(cut=true)` | `sectionByPlane` 只产交线，不天然等价于 OpenSCAD 2D 面；需专门 helper 或保持 blocked |
| `projection(cut=false)` | 需要真正投影并合并 2D 区域；无精确实现前 blocked |
| 2D `offset` | 当前 `cad.offset` 是 3D 全表面偏置，禁止误映射；需独立 2D 算法/helper |
| `minkowski` | 没有精确内核能力前 blocked；不得用随意膨胀近似后标为通过 |
| `surface` | 高度图读取、网格生成、中心与 invert 语义；作为独立子项目实现 |
| `fill` | 2D 孔洞填充规则；无精确实现前 blocked |

### 5.4 P3：暂不支持或条件启动

- `roof` 实验功能；
- `$t` 动画帧；
- GUI 视口变量 `$vpt/$vpr/$vpd/$vpf`；
- OpenSCAD preview 高亮/透明背景的完整视觉语义；
- 完整原生 `.scad` 前端；
- 与 OpenSCAD GUI Customizer 对齐。

### 5.5 `$fn/$fa/$fs`：必须单独处理

OpenSCAD 的 `$fn/$fa/$fs` 会改变圆柱、圆锥、球等实体的实际棱面几何；而 faijs 的 BREP 基本体是解析曲面，`segments` 只影响网格离散化。源码明确写明 sphere 的 `segments` 不影响 BREP：

- `faijs/packages/core/src/primitives/brep-primitives.ts:110-117`
- cylinder/cone 直接走内核解析曲面：`:121-159`

因此计划提供两种保真策略：

1. **`analytic`（默认）**：生成更 idiomatic 的 faijs 解析 BREP；对显式低 `$fn` 产生 `OSC3201`，报告“棱面语义未保留”。
2. **`faceted`（P1/P2）**：通过 profile/polyhedron helper 重建 OpenSCAD 棱面实体；用于严格几何 parity。

必须先建立 `$fn=3/4/6/12/0` 的 sphere/cylinder/cone 探针，再决定哪些节点能够从 `analytic` 晋级为严格 PASS。

---

## 6. 项目目录建议

```text
faijs-openscad/
├─ package.json
├─ LICENSE                         # M0 由项目所有者确认；建议与 faijs-cadquery 对齐
├─ NOTICE
├─ README.md
├─ tsconfig.json
├─ tsconfig.build.json
├─ vitest.config.ts
├─ eslint.config.mjs
├─ .gitignore
├─ .github/workflows/ci.yml
├─ scripts/
│  ├─ ci.ps1
│  ├─ run-tests-with-watchdog.mjs
│  └─ fix-import-extensions.mjs
├─ src/
│  ├─ index.ts
│  ├─ browser.ts
│  ├─ version.ts
│  ├─ frontend/
│  │  ├─ types.ts
│  │  ├─ csg-text.ts
│  │  ├─ openscad-cli.ts
│  │  └─ discover-openscad.ts
│  ├─ csg/
│  │  ├─ token.ts
│  │  ├─ lexer.ts
│  │  ├─ ast.ts
│  │  ├─ parser.ts
│  │  ├─ value.ts
│  │  └─ dialect.ts
│  ├─ ir/
│  │  ├─ nodes.ts
│  │  ├─ lower.ts
│  │  ├─ validate.ts
│  │  └─ passes/
│  │     ├─ default-args.ts
│  │     ├─ dimension-inference.ts
│  │     ├─ group-normalize.ts
│  │     ├─ matrix-fold.ts
│  │     ├─ modifier-policy.ts
│  │     ├─ tessellation-policy.ts
│  │     └─ capability-classify.ts
│  ├─ emit/
│  │  ├─ faijs-emitter.ts
│  │  ├─ writer.ts
│  │  ├─ units.ts
│  │  └─ names.ts
│  ├─ runtime/
│  │  ├─ index.ts
│  │  ├─ polyhedron.ts
│  │  ├─ hull.ts
│  │  ├─ offset2d.ts
│  │  ├─ projection.ts
│  │  └─ surface.ts
│  ├─ diagnostics/
│  │  ├─ codes.ts
│  │  ├─ diagnostic.ts
│  │  └─ format.ts
│  ├─ cli/
│  │  ├─ main.ts
│  │  ├─ doctor.ts
│  │  └─ commands/
│  └─ __fixtures__/               # 项目原创、最小化 CSG 夹具
├─ tests/
│  ├─ baseline.json
│  ├─ manifest.json
│  ├─ gen-manifest.ts
│  ├─ run-cand.ts
│  ├─ run-ref.ts
│  ├─ compare-mesh.ts
│  ├─ mesh-metrics.ts
│  ├─ fixtures/
│  │  ├─ csg/
│  │  ├─ fai/
│  │  └─ geometry/
│  └─ reports/
└─ out/                            # 不入库
```

### 6.1 package exports

建议：

```json
{
  "name": "@faicad/faijs-openscad",
  "version": "0.29.5",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./browser": {
      "types": "./dist/browser.d.ts",
      "default": "./dist/browser.js"
    },
    "./runtime": {
      "types": "./dist/runtime/index.d.ts",
      "default": "./dist/runtime/index.js"
    },
    "./cli": {
      "types": "./dist/cli/main.d.ts",
      "default": "./dist/cli/main.js"
    }
  },
  "bin": {
    "faijs-openscad": "./dist/cli/main.js"
  }
}
```

依赖原则：

- parser/IR/emitter 不依赖 OpenSCAD 二进制或 GPL 库；
- `@faicad/faijs` 使用 peerDependency；
- `@faicad/faijs-extra` 使用 optionalPeerDependency，仅在 text/import 路径启用；
- `occt-wasm` 只在确有 runtime helper 需要时加入 peerDependency；
- mesh parity 所需库放 devDependency，不进入运行时产物。

---

## 7. 公共 API 与 CLI

### 7.1 TypeScript API

```ts
export function parseCsg(
  source: string,
  options?: ParseOptions,
): ParseResult

export function lowerCsg(
  ast: CsgDocument,
  options?: LowerOptions,
): LowerResult

export function emitFaijs(
  model: ModelIr,
  options?: EmitOptions,
): EmitResult

export function transpileCsg(
  source: string,
  options?: TranspileOptions,
): TranspileResult

export async function transpileScadFile(
  inputPath: string,
  options?: TranspileFileOptions,
): Promise<TranspileResult>

export async function inspectEnvironment(
  options?: InspectOptions,
): Promise<EnvironmentReport>
```

关键 options：

```ts
interface TranspileOptions {
  sourcePath?: string
  partName?: string
  strict?: boolean                 // 默认 true
  allowPartial?: boolean           // 默认 false
  outputStyle?: 'direct' | 'hybrid'// 默认 direct，必要时自动升级 hybrid
  fidelity?: 'analytic' | 'faceted'// 默认 analytic
  floatPrecision?: number          // 默认 12
  assetsDir?: string
  fontsDir?: string
}
```

结果必须带统计与诊断：

```ts
interface TranspileResult {
  ok: boolean
  code?: string
  ast?: CsgDocument
  ir?: ModelIr
  diagnostics: Diagnostic[]
  stats: {
    parsedNodes: number
    emittedNodes: number
    directNodes: number
    helperNodes: number
    approximateNodes: number
    blockedNodes: number
  }
}
```

### 7.2 CLI

```text
faijs-openscad transpile input.scad -o output.fai.js
faijs-openscad transpile input.csg -o output.fai.js
faijs-openscad dump input.scad -o output.csg
faijs-openscad check input.scad --strict
faijs-openscad run input.scad --out output.step --mode brep
faijs-openscad doctor
faijs-openscad explain OSC3201
faijs-openscad corpus --check
faijs-openscad report
```

退出码：

- `0`：成功且无 error；
- `1`：语法、lower、emitter 或 unsupported error；
- `2`：环境错误，如 OpenSCAD 不存在或版本不符合严格要求；
- `3`：语料/baseline 不完整。

---

## 8. 诊断设计

```ts
interface Diagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  path?: string
  span?: {
    start: { line: number; column: number; offset: number }
    end: { line: number; column: number; offset: number }
  }
  hint?: string
  nodeId?: number
}
```

初始错误码：

| 代码 | 含义 |
|---|---|
| `OSC1001` | 非法 CSG token |
| `OSC1002` | 括号、方括号或花括号不匹配 |
| `OSC1003` | 未知 CSG 节点 |
| `OSC1004` | 未知参数；默认 warning 并保留 |
| `OSC2001` | 必填参数缺失 |
| `OSC2002` | 参数类型或维度错误 |
| `OSC2003` | 2D/3D 子树非法组合 |
| `OSC2004` | 奇异或非法矩阵 |
| `OSC3001` | `#` 高亮语义丢失 |
| `OSC3002` | 节点没有 faijs 等价实现 |
| `OSC3003` | 需要 runtime helper，但当前输出模式为 direct |
| `OSC3101` | 依赖外部资源，路径不可解析 |
| `OSC3201` | analytic 模式未保留 OpenSCAD 显式棱面语义 |
| `OSC4001` | runtime helper 执行失败 |
| `OSC5001` | 未找到 OpenSCAD 二进制 |
| `OSC5002` | OpenSCAD 版本与 baseline 不匹配 |
| `OSC5003` | OpenSCAD 子进程失败 |

规则：

- 未知节点和 unsupported 默认是 error；
- `--allow-partial` 只把指定诊断降为 warning，仍在生成文件头与 JSON 报告中列出；
- 不生成“看似成功、实际丢几何”的文件；
- OpenSCAD stderr 原样收集，但向用户展示时结构化为 `OSC5xxx`；
- CSG 诊断能定位 CSG 行列；OpenSCAD 自身报错能保留 `.scad` 行列；CSG 节点无法反推原 `.scad` 位置时必须如实说明。

---

## 9. 测试体系

### 9.1 L0：能力探针（永久保留）

所有前期探测必须落成 `*.probe.test.ts`，完成调查后也不删除：

1. `openscad-bin.probe.test.ts`：二进制发现、版本解析、缺失行为。
2. `csg-dialect.probe.test.ts`：2021.01 与当前 golden 参数差异归一。
3. `csg-node-vocabulary.probe.test.ts`：CSG 节点词表变化（基于 OpenSCAD examples 验证语料，22 个节点名）。
4. `faijs-capability.probe.test.ts`：`cad.applyMatrix`、`cad.convexHull`、`cad.offset`、`cad.profile`、`cad.revolve` 的当前存在性与签名。
5. `units.probe.test.ts`：`MM/DEGREE/RADIAN` 与量纲检查。
6. `group-semantics.probe.test.ts`：重叠实体下 `group/root` 应映射 union 还是 compound。
7. `faceting.probe.test.ts`：`$fn=3/4/6/12/0` 下 sphere/cylinder/cone 的体积、bbox、面数差异。
8. `rotate-extrude.probe.test.ts`：平面、轴、角度方向与 start 参数。
9. `polyhedron.probe.test.ts`：闭合、反向面、非流形输入。
10. `hull.probe.test.ts`：从 shape 提取点集后的几何与性能。

### 9.2 L1：lexer/parser 单元测试

覆盖：

- 全部值类型和转义；
- `inf`、`-inf`、`-0`、`undef`；
- 空参数、命名参数、尾逗号；
- 四层以上嵌套；
- `%/#`；
- 坏 token、截断输入、超深输入；
- span 的行列准确性；
- parse → print → parse 结构等价。

至少维护 30 个项目原创微型 fixture，确保 `npm test` 不依赖外部 OpenSCAD 仓库。

### 9.3 L2：IR 与 emitter 测试

- 每个 CSG 节点至少一个 AST→IR 测试；
- 每个 pass 独立测试；
- 每个映射至少一个 `.fai.js` snapshot；
- 输出再送入 faijs `check()`；
- 单位、角度、变量命名、await、终端 result 都有专门断言；
- 相同 AST 重复发射必须字节一致。

### 9.4 L3：OpenSCAD examples 验证语料测试（默认门禁）

移植正确性验证以 OpenSCAD examples（CC0）语料为输入，不依赖 OpenSCAD 源码仓库的测试文件：

- `tests/examples-verify.test.ts`：解析 `tests/fixtures/openscad-examples/csg/*.csg`（由 `tests/verify-examples.ts`
  经 OpenSCAD 2021.01 求值生成），断言每个 golden 零诊断、AST 节点直方图与文本扫描逐项相等；
- 若 `csg/` 目录不存在（未运行 `verify-examples.ts --write`），整组跳过而非假装通过；
- `tests/fixtures/openscad-examples/`：OpenSCAD 官方 `examples/` 完整拷贝（CC0，50 个 `.scad`），同目录 `.fai.js` 由 `tests/gen-examples-fai.ts` 产出。

门禁：

- 50/50 示例均能被 parser 读取且零诊断；
- 节点词表新增时测试失败并要求更新 dialect；
- P0-only 子集 100% lower、emit、faijs check、执行；
- blocked 必须写 `blockedBy`，不能静默略过；
- 生成报告包含 `PASS / PASS-ANALYTIC / PASS-NT / BLOCKED / FAIL / ERROR`。

### 9.5 L4：examples 端到端（同目录生成 .fai.js）

流程（输入为 `tests/fixtures/openscad-examples/` 下的 `.scad`，经 OpenSCAD 二进制求值）：

```text
examples/Basics/CSG.scad                 （OpenSCAD 官方示例，CC0）
  → OpenSCAD CSG
  → faijs-openscad
  → examples/Basics/CSG.fai.js           （同目录生成，由 tests/gen-examples-fai.ts 产出）
  → faijs check
  → faijs run
  → candidate.stl
```

样例只要依赖未检出的库、字体或资源，必须登记为 blocked/skip 并写原因。

### 9.6 L5：几何 parity

OpenSCAD 参考输出与 faijs 候选统一使用 STL：

```text
ref.stl  = OpenSCAD 渲染 sample.scad
cand.stl = faijs 执行 generated.fai.js
```

比较器至少检查：

- 包围盒；
- 有符号体积；
- 表面积；
- 质心；
- 连通分量；
- manifold 状态；
- 基于 `manifold-3d` 的对称差体积，或稳定的双向表面采样距离。

容差只在 `tests/compare-mesh.ts` 一处配置。禁止为单个失败样例局部放宽阈值。解析 BREP 替代 OpenSCAD 棱面体的情况单列 `PASS-ANALYTIC`，不得伪装为严格 PASS。

### 9.7 CI

沿用 faijs-cadquery 的五阶段顺序：

1. lint；
2. typecheck；
3. build；
4. test（进程级 watchdog + stderr 零容忍）；
5. `npm pack` 并检查包内容。

CI 分层：

- 常规 CI：原创 fixture + parser/IR/emitter + OpenSCAD examples 验证语料（`tests/examples-verify.test.ts`）+ P0 小型执行 smoke，不依赖 OpenSCAD 源码。
- nightly/手工 CI：配置匹配版本 OpenSCAD，运行 examples 与几何 parity（examples 已随仓库提供）。

---

## 10. 版本锁与可复现性

`tests/baseline.json` 不硬编码单一开发者路径，只记录版本与默认候选路径；**不**引用 OpenSCAD 源码
仓库或其测试文件，移植正确性验证以 OpenSCAD examples（CC0）语料为基线：

```json
{
  "openscadBinary": {
    "requiredVersion": "2021.01",
    "env": "OPENSCAD_BIN",
    "localSmokeVersion": "2021.01"
  },
  "mcadLibrary": {
    "env": "MCAD_LIB",
    "path": "C:/git/OpenSCAD/webmcp-openscad/public/libraries/MCAD",
    "license": "LGPL-2.1",
    "capturedAt": "2026-10-06",
    "optional": true,
    "note": "仅 examples/Old/example023.scad 的传递依赖；不是验证语料"
  },
  "verificationCorpus": {
    "fixtures": 50,
    "csgNodes": 12435,
    "license": "CC0-1.0",
    "fixturesPath": "tests/fixtures/openscad-examples",
    "csgPath": "tests/fixtures/openscad-examples/csg/*.csg",
    "generator": "tests/verify-examples.ts",
    "test": "tests/examples-verify.test.ts"
  },
  "faijsVersion": "0.29.5",
  "faijsCadqueryReferenceVersion": "0.29.5"
}
```


原则：

- 路径来自环境变量或 CLI 参数；
- commit、版本、数量、hash 才进入 baseline；
- corpus 发生变化必须显式执行 pin 命令并审阅 diff；
- 不自动覆盖 golden；
- 本机旧版 OpenSCAD 的输出不得更新当前源码 baseline。

---

## 11. 里程碑与任务拆解

### M0：项目骨架与事实探针

| ID | 任务 | 产物 | 验收 |
|---|---|---|---|
| T001 | 创建独立包骨架 | package/tsconfig/eslint/vitest/exports | build、typecheck、pack 通过 |
| T002 | 复用五阶段 CI 与 watchdog | CI 脚本 | 本地与远程步骤一致；stderr 零容忍 |
| T003 | 建立版本与语料 baseline | `tests/baseline.json` | 版本、commit、数量可校验 |
| T004 | 实现 OpenSCAD 发现与 doctor | frontend/CLI | 2021.01 被识别并提示版本不匹配 |
| T005 | 建立三态 manifest | manifest 与生成器 | blocked 必填 blockedBy |
| T006 | 固化 10 类能力探针 | `*.probe.test.ts` | 探针永久保留 |
| T007 | 确认项目许可证 | LICENSE/NOTICE | 所有者确认后落盘 |

**G0 门禁**：空包也能完整通过 lint、typecheck、build、test、pack。

### M1：CSG lexer/parser

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| T101 | token/value/span | M0 | 原创 fixture 单测全绿 |
| T102 | 递归下降 parser | T101 | 26 节点通用语法可解析 |
| T103 | dialect/default 参数层 | T102 | 2021.01 与当前 CSG 均可归一 |
| T104 | 错误恢复与诊断 | T102 | 坏输入准确定位，退出非零 |
| T105 | CSG printer | T102 | parse-print-parse 结构等价 |
| T106 | 225 corpus parse | T103 | 225/225 无 parser error |

**G1 门禁**：OpenSCAD examples 验证语料（50 个示例）全部零诊断解析，未知节点为 0；warning 有完整汇总。

### M2：IR 与 P0 emitter

> **状态（2026-10-06）：T201–T208 已落地。** 实现与本文档的三处偏离，均已在
> README「M2」一节与本仓库代码注释里记录：
>
> 1. 不引入独立的 `IrGroup` —— group 归一化在 lower 内一次性完成
>    （空 → `IrEmpty`；单子 → 透传；多子 → `IrUnion`），与 pass 3 的表述一致但产物更少。
> 2. `linear_extrude(center = true)` 用一次 `cad.applyMatrix` 平移完成，**不用** `cad.translate`：
>    后者属 3d_editor 消费面，不在 faijs 平台面（手册 §4.9）。
> 3. T208 的「deterministic snapshots」以**字节一致性断言**实现（同输入两次 emit 必须完全相同），
>    没有落 golden 文件——emitter 一改就要整体重生成，维护成本高于收益。
>
> **G2 门禁的实测口径**：P0-only corpus **100% emit** 且 **100% 通过 faijs 静态校验**
> （`extractMetadata`：op 名 / 字面量形态 / 变量引用）。「执行成功」需要 OCCT wasm，
> 属 `FAIJS_PROBE_RUNTIME=1` 的运行时层，尚未在常规 CI 中开启——静态校验是它的必要条件，
> 不是替代品。另有一个已知规模边界：`Advanced/module_recursion` 生成的程序约 1.3 MB，
> 超过 faijs 静态校验器的 1 MiB 源码上限。

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| T201 | Model IR 与维度系统 | M1 | 类型检查、节点测试 |
| T202 | lower 与默认参数 | T201 | 26 节点均有明确分类 |
| T203 | group/matrix/modifier passes | T202 | 探针通过 |
| T204 | 单位与角度 emitter | T202 | faijs check 通过 |
| T205 | 3D 原语与布尔 | T204 | P0 fixtures 执行成功 |
| T206 | 2D profile 与简单 extrude | T204 | 2D→3D fixtures 成功 |
| T207 | color/render/root | T204 | 外观与最终 result 正确 |
| T208 | deterministic snapshots | T205-T207 | 重复输出字节一致 |

**G2 门禁**：机器识别出的 P0-only corpus 100% emit、faijs check 和执行成功。

### M3：CLI 与完整样例流水线

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| T301 | `.scad → CSG` CLI adapter | M1 | 支持路径、stdout、timeout、stderr |
| T302 | `transpile/check/run/dump/doctor` | M2 | CLI e2e 全绿 |
| T303 | `run-cand` 与缓存 | T302 | 可按单例、目录、节点类型筛选 |
| T304 | 50 examples manifest | T303 | 每例都有状态与原因 |
| T305 | Windows 路径/中文/空格测试 | T301 | 不经 shell 拼接，路径正确 |

**G3 门禁**：所有不含 P1-P3 节点且不依赖缺失资源的 examples 全部跑通。

### M4：几何 parity 与棱面策略

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| T401 | STL 指标读取器 | M3 | 已知立方体/球体单测 |
| T402 | 对称差/表面距离比较 | T401 | 稳定识别相同、平移、缩放和细分差异 |
| T403 | `$fn` 探针矩阵 | T402 | sphere/cylinder/cone 差异量化 |
| T404 | `analytic` 分类规则 | T403 | PASS-ANALYTIC 不混入 PASS |
| T405 | `faceted` polyhedron runtime spike | T403 | 能导出 watertight STL/STEP 或明确 blocked |
| T406 | 报告生成 | T402-T405 | JSON + Markdown，容差集中 |

**G4 门禁**：每个 P0 样例都有严格 PASS、PASS-ANALYTIC、BLOCKED 或 FAIL 的可解释结果，无未知状态。

### M5：P1 精确扩展

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| T501 | rotate_extrude 坐标与角度 | G4 | 官方样例与 feature tests 通过 |
| T502 | polyhedron helper | T405 | 合法、反向面、非流形测试 |
| T503 | hull helper spike/实现 | T502 | 形状 hull 与 OpenSCAD 对比 |
| T504 | resize | G4 | auto 规则测试 |
| T505 | text/font 适配 | G4 | 可配置字体；缺字体明确失败 |
| T506 | import/assets 适配 | G4 | 相对路径与 supported suffix 测试 |

**G5 门禁**：P1 节点分别达到各自 feature corpus 的 100% 有状态覆盖；未实现项保持 blocked，不能静默通过。

### M6：P2 与发布准备

| ID | 任务 | 依赖 | 验收 |
|---|---|---|---|
| T601 | twist/scale extrude spike | G5 | 精确性结论与测试 |
| T602 | projection spike | G5 | cut true/false 分开裁决 |
| T603 | offset2d spike | G5 | 禁止误用 3D `cad.offset` |
| T604 | minkowski spike | G5 | 无精确方案则正式 blocked |
| T605 | surface/fill 评估 | G5 | 独立工作量与依赖清单 |
| T606 | package/browser/runtime exports | T601-T605 | npm pack 内容审计 |
| T607 | 全量 corpus 与 examples 报告 | T606 | 275 个入口全部有状态 |

**G6 发布门禁**：

- 常规 CI 全绿；
- OpenSCAD examples 验证语料全部进入 manifest；
- 不存在“未运行但记为 ported”；
- 诊断和报告可复现；
- 包内不含 OpenSCAD 二进制或上游 GPL 源码；
- README 明确版本、能力和保真级别。

### M7：可选纯 TypeScript `.scad` 前端

只有以下条件至少满足两项，才启动：

1. 浏览器/小程序环境必须直接接收 `.scad`；
2. 必须提供 `.scad` 精确行列级源映射；
3. 必须保留原始参数化、模块和函数结构，而非输出求值后几何；
4. 官方 CLI/WASM 成为不可接受的部署依赖；
5. P0-P2 的剩余 blocker 主要来自前端，而非 faijs 几何能力。

届时单独立项实现 lexer、parser、作用域、值系统、函数/模块、动态特殊变量、include/use、list comprehension 和递归保护；不得把它混进当前 CSG 主线导致首个可用版本延期。

---

## 12. 验收标准

### 12.1 功能验收

- `.csg` 可以在无 OpenSCAD 环境下转换；
- `.scad` 在配置 OpenSCAD 后一条命令转换；
- 生成代码通过 faijs `check()`；
- P0 样例可执行并导出 STL/STEP；
- unsupported 默认阻断成功状态；
- 生成代码稳定、可读、带来源与版本信息。

### 12.2 质量验收

- lexer/parser/IR/emitter 分层，禁止直接字符串替换；
- 核心模块行覆盖率不低于 90%，分支覆盖率不低于 85%；
- OpenSCAD examples 验证语料（50 个示例）全部零诊断解析；
- P0-only corpus 100% 执行；
- 50 个 examples 100% 登记状态；
- 所有探针长期保留；
- stderr 零容忍；
- 测试有进程级超时；
- 几何容差集中管理；
- corpus 版本和 hash 可复现。

### 12.3 兼容性验收

- Windows 路径、空格、中文文件名；
- OpenSCAD 2021.01 与 baseline 版本的 CSG 方言；
- Node 22；
- faijs `0.29.x`；
- browser 入口不引用 `node:fs`、`node:child_process`。

---

## 13. 许可证与分发边界

OpenSCAD 当前源码（`src/`）声明 GPL-2.0-or-later；其 `examples/` 目录提供 CC0 声明，可完整 vendoring 进本项目作为验证语料。建议采取以下边界：

1. OpenSCAD 只作为外部程序调用，不链接、不打包到 npm 产物；
2. 不复制 OpenSCAD 的语法 / 词法 / 求值器实现（GPL）；
3. CSG 解析器按观察到的 CSG 输出格式和项目自研测试独立实现；
4. 验证语料使用 OpenSCAD `examples/`（CC0-1.0，已完整拷贝进 `tests/fixtures/openscad-examples/`）作为黑盒输入，不复制 OpenSCAD 源码仓库的测试文件；MCAD（LGPL）仅作可选传递依赖；
5. `examples/` 已 vendoring 进本项目，保留来源目录与 `COPYING-CC0.txt` 声明；
6. `NOTICE` 明确 OpenSCAD 是可选外部工具；
7. 发布前做一次许可证审查。

项目许可证建议与 `faijs-cadquery` 一致采用 `AGPL-3.0-only`，但这是所有者决策；在 M0 的 T007 确认前不要生成最终 LICENSE。

以上是工程隔离建议，不替代正式法律意见。

---

## 14. 主要风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| OpenSCAD CSG 不是正式稳定 API | 方言漂移 | dialect 层、版本锁、未知参数 warning、双版本 probe |
| 本机 OpenSCAD 2021.01 与源码不一致 | golden 污染 | 旧版只 smoke；当前源码 expected CSG 为基线 |
| CSG 丢失原始变量/模块/注释 | 代码不可逆、不可参数化 | 明确产品定位；需要保留结构时走 M7 |
| faijs 解析 BREP 与 OpenSCAD 棱面体不同 | 几何 parity 偏差 | analytic/faceted 双模式，PASS-ANALYTIC 单列 |
| 2D/3D 语义混淆 | 运行错误 | IR 维度系统与 validate |
| `revolve`/profile arc 角度单位不同 | 几何严重错误 | 单点单位策略 + 永久 probe |
| group/隐式 union 误映射 | 重叠体积错误 | 重叠实体探针，不用 compound 猜测 |
| helper 侵入过大 | 形成第二个 CAD 内核 | helper 只补精确缺口，每项先 spike |
| 外部资源、字体、include 路径 | 样例不可复现 | assetsDir/fontsDir、相对源路径、manifest blocker |
| 为追求通过率放宽容差 | 虚假成功 | 容差集中；FAIL/PASS-ANALYTIC/PASS-NT 分离 |

---

## 15. 推荐实施顺序

```text
M0 骨架与探针
  → M1 CSG parser（先吃完 OpenSCAD examples 验证语料）
  → M2 IR + P0 emitter（先做到 check/execute）
  → M3 .scad CLI 与 examples manifest
  → M4 几何 parity + analytic/faceted 裁决
  → M5 polyhedron/hull/text/import 等 P1
  → M6 高风险 P2 与发布
  → M7 仅在明确需求触发时实现纯 TS .scad 前端
```

最关键的首个纵向切片应当只有一个例子：

```text
examples/Basics/CSG.scad (OpenSCAD 官方示例，CC0)
  → OpenSCAD CSG
  → parse
  → IR
  → emit .fai.js
  → faijs check
  → faijs run
  → STL parity report
```

这个切片跑通后，再扩展节点，不先堆满 runtime helper。

---

## 16. 开工前必须确认的三个决策

1. **许可证**：是否采用建议的 `AGPL-3.0-only`。
2. **默认保真模式**：建议 `analytic`，并把显式棱面差异列为 `PASS-ANALYTIC`；严格 faceted 模式后补。
3. **首个发布边界**：建议首版只承诺 P0 + 可解释 blocker，不以“支持全部 OpenSCAD”作为发布口径。

除此之外，主技术路线已经可以直接执行，无需再做架构选型。

---

## 17. 关键索引（不含 OpenSCAD 源码）

- `C:/my/Faicad/faijs-cadquery/package.json:20-80`
- `C:/my/Faicad/faijs-cadquery/src/transpile.ts:17-170`
- `C:/my/Faicad/faijs-cadquery/src/parity-smoke.test.ts:45-132`
- `C:/my/Faicad/faijs-cadquery/src/workplane.ts:53-98`
- `C:/my/Faicad/faijs-openscad/tests/fixtures/openscad-examples/`（OpenSCAD 官方 `examples/`，CC0-1.0，已完整拷贝进本项目，验证语料）
- `C:/my/Faicad/faijs-openscad/tests/verify-examples.ts`（OpenSCAD 求值 → CSG → 解析器对账）
- `C:/my/Faicad/faijs-openscad/tests/gen-examples-fai.ts`（同目录生成 .fai.js，M2 发射器就绪后生效）
- `C:/my/Faicad/faijs-openscad/tests/examples-verify.test.ts`（examples 语料回归门禁）
- `C:/my/Faicad/faijs/packages/core/src/api/api-namespace.ts:61-127`
- `C:/my/Faicad/faijs/packages/core/src/api/generated/script-face.ts:9-62`
- `C:/my/Faicad/faijs/packages/core/src/api/primitives.ts:223-403`
- `C:/my/Faicad/faijs/packages/core/src/primitives/brep-primitives.ts:110-159`
- `C:/my/Faicad/faijs/packages/core/src/api/profile.ts:33-120`
- `C:/my/Faicad/faijs/packages/core/src/api/transform.ts:221-368`
- `C:/my/Faicad/faijs/packages/core/src/api/revolve.ts:123-143`
- `C:/my/Faicad/faijs/packages/core/src/api/brep-mirror/topologyFns.ts:70-129,213-285,320-345`
- `C:/my/Faicad/faijs/packages/core/src/lang/dimension-check.test.ts:45-87`

> 注：faijs 处于高频演进期，上列 faijs 行号仅记录撰写时的位置，落地实现以当前源码为准；
> 本文不引用 OpenSCAD 源码（其源码文件不在索引内）。
