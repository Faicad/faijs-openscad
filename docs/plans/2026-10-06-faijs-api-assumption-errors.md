# faijs 理解勘误记录 v2（面向 faijs 的文档与 API 设计改进）

> 记录人：faijs-openscad 转换器开发过程
> 日期：2026-10-06（v1 当日作废并重写）
> 被测对象：`@faicad/faijs` 0.29.5（npm 安装产物）
> 复核基准：`C:/my/Faicad/faijs` 源码（`packages/core/src`）＋ 本项目运行时探针
> 复现脚本：
> - `tests/probe-faijs-ts-face.mjs`（① TS 兼容面，含 Host 装配）
> - `tests/probe-faijs-host.mjs`（② 脚本面，经 `runtime.execute`）
> - `tests/probe-faijs-api.mjs`（v1 的错误做法，保留作为反面证据）
> - `src/__probe__/script-globals-scan.ts`（§5：`Math` 拦截的分层取证）
>
> 修订：2026-10-06 追加 §5（`Math` 拦截的分层取证），原 §5/§6 顺延为 §6/§7。

---

## ⛔ 0. v1 的根本错误：我用错了 API 面，且没有装配 Host

**v1 的 12 条里有 5 条（第 1、4、5、6、9 条）是错的，且错因是同一个：**

我按「**① TS 库层**」自居，却把「**② cad 脚本面**」当成了可用的库接口，
而且**从未装配 Host**（`initOcctWasm` / `registerBrepEngine` / createRuntime 都没有）。
两个错误叠加，导致我把「装配缺失」和「面选错」全部误判成「faijs 的能力缺口」。

faijs 有三个 API 面（`docs/ops-api-inventory.zh.md` §1），我当时完全没意识到：

| 面 | 消费者 | 形态 | 位置 |
|---|---|---|---|
| ① TS 兼容面 | **第三方库（TS 代码）——就是我该站的位置** | brepjs 原样：位置参数 + `Result`；同名同签名 | `@faicad/faijs` 主导出 / `@faicad/faijs/api/compat` |
| ② cad 脚本面 | `.fai.js`（UI / AI 生成代码） | `cad.*`；语句边界 unwrap Result | `cad` 命名空间（由 Host 注入） |
| ③ 库边界面 | `registerLib` 注册的库导出函数 | 库作者写纯 brepjs 代码 | `runtime.registerLib(binding, ns, { autoLift: true })` |

**正确做法写在 `docs/library-dev-guide.zh.md`**（第三方库开发手册）——
实现新 op 走 `defineOp`（`@faicad/faijs/sdk`），不碰脚本面的 `cad`。
faijs 生态里所有真实第三方库都这么做：`packages/faijs-gears`、`packages/sheetmetal`、
`packages/faijs-fasteners`、`packages/faijs-extra`、`packages/sketch`
（peerDependencies 一律是 `{"@faicad/faijs":"^0.29.0"}`）。

### 我实际用的那个 `mod.cad` 是什么

`import { cad } from '@faicad/faijs'` 拿到的 38 键对象，**既不是 ② 脚本面，也不是 ③ 库面**，
而是一个 **BREP-only 内部命名空间**：

```
bboxCenter boundingBox box boxBrep commonBrep cone coneBrep cutBrep cylinder cylinderBrep
drillBrep engrave extrudeBrep faceAt fuseBrep intersect knurl load loadBrep rotateBrep
rotate_euler scale scale3d scaleBrep screw sdf solidToShape sphere sphereBrep splitBrep
subtract transformMatrix translate translateBrep union volume wedge wedgeBrep
```

它和脚本面（`dist/lang/symbol-table.generated.js`，95 个 op）根本不是一套东西。
「TS 层没有 `mirror`/`profile`/`extrude`/`revolve`/`applyMatrix`/`offset`」这个观察本身是对的，
但结论完全错——**它们都在 ① TS 兼容面里，是 57 个我逐一验证过的自由函数**。

### 复核方式（结果见 §1–§3）

装配 Host 后实测：**布尔全通、体积全准、球是精确解析球**。
v1 的「布尔默认不可用」「球差 0.22%」「volume 静默 NaN」三条**全部撤回**。

---

## 1. 【已证实】① TS 兼容面的真实能力：57 个关键 op 中只有 `polyhedron` 缺失

装配 Host 后（`initOcctWasm` → `registerOcctBrepEngine` → `configureBackends`），
对 `@faicad/faijs` 主导出逐一探测 `typeof === 'function'`：

**present（56）**
`box sphere cylinder cone torus wedge ellipsoid`
`union subtract intersect fuse cut commonBrep`
`translate rotate rotate_euler scale scale3d mirror applyMatrix`
`profile extrude revolve loft sweep polygon`
`offset convexHull compound structCompound sew sewAndSolidify`
`shell thicken sectionByPlane split splitByPlane`
`volume measureVolume area measureArea length centerOfMass bounds3D bboxMin bboxMax`
`getFaces getEdges getSolids heal autoHeal fixShape ok err isOk isErr`

**absent（1）**：`polyhedron`

进一步的缺口清单（同样在 ① 面探测）：

| OpenSCAD 节点 | ① 面 | 说明 |
|---|---|---|
| `polyhedron` | ❌ 缺失 | CSG 语料 24 处 |
| `hull` | ❌ 缺失 | 85 处；`convexHull` **不是**同一个东西 |
| `minkowski` | ❌ 缺失 | 40 处 |
| `text` | ❌ 缺失 | 108 处（在 `@faicad/faijs-extra`） |
| `surface` | ❌ 缺失 | 19 处 |
| `import` | ❌ 缺失 | 56 处（`import_step` 存在但语义不同） |
| `projection` | ❌ 缺失 | 37 处 |
| `resize` | ❌ 缺失 | 65 处 |
| `render` | ❌ 缺失 | 20 处（OpenSCAD 侧是渲染指令） |
| `fill` / `roof` | ❌ 缺失 | 7 / 5 处 |
| `multmatrix` | ⚠️ 用 `applyMatrix` 覆盖 | 4783 处（最大单一节点） |
| `color` | ⚠️ 用 `Shape.setColor()` 覆盖 | 2431 处（实例方法，非 op） |
| `group` | ⚠️ 用 `compound` / `structCompound` 覆盖 | 4626 处 |
| `linear_extrude` | ⚠️ 用 `extrude(profile, [0,0,h])` 覆盖 | 250 处 |
| `rotate_extrude` | ⚠️ 用 `revolve(profile, angle)` 覆盖 | 40 处 |
| `circle` / `square` | ⚠️ 用 `polygon` 覆盖 | 261 / 2454 处 |

**关键澄清：`convexHull` ≠ OpenSCAD 的 `hull`。**
`convexHull` 接受**点集**（`points.map is not a function` 是喂 shape 时的报错），
底层是 occt 内核方法 `hullFromPoints`；OpenSCAD 的 `hull()` 接受**任意子节点**做凸包。
两者不可互相替代。

**语料覆盖率（按 CSG 节点计数，样本 = 169 dump + 56 dump-examples 的 17624 个节点）：**

| 分类 | 节点数 | 占比 |
|---|---|---|
| ① 面直接覆盖 | 14727 | 83.6% |
| 用实例方法/等价 op 覆盖（color/group/multmatrix/2D 原语） | 2431+ | ~13.8% |
| **真实缺口**（text/hull/resize/import/minkowski/projection/polyhedron/render/surface/fill/roof） | **466** | **2.6%** |

即：**97.4% 的 CSG 节点可直接落地，缺口集中在 2.6%。**

---

## 2. 【已撤回】v1 第 4、5、6、9 条

### 2.1 撤回「布尔运算默认不可用」

- **v1 断言**：`union/subtract/intersect` 全部抛 `ManifoldError: Not manifold`，
  BREP 路径抛 `no BREP engine registered`。
- **实测（装配后，`mode='brep'`）**：
  ```
  union      OK   verts=56 tris=28
  subtract   OK   verts=24 tris=12
  intersect  OK   verts=24 tris=12
  ```
- **真实原因**：我既没 `initOcctWasm()`，也没注册 BREP 引擎。
  `docs/library-dev-guide.zh.md` §3.1 写得很清楚：Host 必须先提供内核。
  手册 §2.8 也写明「库作者只写模块、**不负责注册**」——注册是 Host 的事，
  但**库自己的测试必须装配 Host**。
- **保留下来的有效部分**：`registerBrepEngine` 无默认引擎、错误信息 `R8` 偏晚，
  这个「上手指南缺失」的建议仍然成立（改到 §4 优先级表）。

### 2.2 撤回「`volume()` 静默返回 NaN」

- **v1 断言**：box / cylinder 体积是 `NaN`，只有 sphere 出数。
- **实测（装配后，① 面 `volume(shape)` 直接返回 number）**：
  ```
  box(10,10,10)     volume=999.9999999999998    exact=1000.000     delta=-0.0000%
  sphere(10)        volume=4188.790204786392    exact=4188.790     delta= 0.0000%
  cylinder(5,10)    volume=785.3981633974482    exact=785.398      delta=-0.0000%
  union(box, box+5x)volume=1499.9999999999993   exact=1500.000     delta= 0.0000%
  ```
- **真实原因**：无 BREP 引擎时走了 mesh 路径，拿不到精确体积。
- **附带修正**：脚本面 `cad.volume(...)` 会把结果作为**新产物**注册，
  `outputs.get('out')` 在 `let out = cad.volume(s)` 下取不到——
  ① 面直接 `await volume(shape)` 才是测量该用的路。这不是 bug，是面语义差异。

### 2.3 撤回「faijs 的球不是精确球（差 0.22%）」

- **v1 断言**：r=10 球体积 `4179.545869819882`，精确 `4188.790204786391`，差 0.22%，
  因此「不能把 faijs 球当精确球」。
- **实测（BREP/occt 路径）**：`4188.790204786392` —— 与解析值误差 **0.0000%**。
- **真实原因**：v1 那个数字是 **mesh 路径**的离散多面体体积
  （`4179.5458…` 确实是 r=10 三角化球的体积），我误当成 BREP 结果。
- **对 OpenSCAD parity 的正确结论**：
  - faijs ① 面（BREP）= **解析精确**；
  - OpenSCAD 默认 `$fn=0`（由 `$fa=12` / `$fs=2` 推导分段数）产生**真实棱面几何**，
    其体积**小于**解析值；
  - 所以「faijs 比 OpenSCAD 更精确」是预期行为，**差异必须归因于 OpenSCAD 的离散化**，
    而不是 faijs 的误差。parity 判定要以「解析值」为基准，或把 OpenSCAD 的 `$fn`
    显式对齐后比较——这条要写进计划的保真度章节。
  - 若走 faijs **mesh 路径**，则两端都是离散多面体，但**分段算法不同**（OpenSCAD 用
    `CurveDiscretizer`，faijs 用 manifold 的三角化），仍不能逐位相等。

### 2.4 撤回「脚本面有的 TS 层也调不了」（v1 第 9 条）

- 观察本身对（38 键的 `mod.cad` 里确实没有），但**它不是我该用的面**。
- ① 面里 `applyMatrix` / `offset` / `convexHull` / `mirror` / `profile` / `extrude` /
  `revolve` / `compound` **全部存在且可用**（见 §1 实测）。

---

## 3. 【保留并强化】v1 中仍然成立的部分

### 3.1 三面边界不清（v1 第 1 条 → 升级为 P0）

- 仍然成立，而且比我 v1 描述的更严重：**存在三个「cad-like」表面**
  （① 面 205 个扁平函数 / ② 面 95 个脚本 op / `mod.cad` 38 键 BREP 内部命名空间），
  **外加主入口 480 个导出**。从包名与导出名上完全无法区分。
- v1 里「TS 层 `undefined`、脚本面存在」的清单，正确表述应是：
  **那是 `mod.cad` 与 ② 脚本面的差集，与 ① 面无关**。
- **建议**：README 顶部放三面对照表；`mod.cad` 这种内部命名空间不要以 `cad` 为名导出。

### 3.2 单位常量只在子路径（v1 第 2 条 → 降为 P2）

- 仍然成立：主入口 480 个导出无 `MM`/`DEGREE`/`RADIAN`，
  它们在 `@faicad/faijs/units`：`MM=1`、`DEGREE=1`、`RADIAN=57.29577951308232`。
- 但需要**追加澄清**：`docs/library-dev-guide.zh.md` §4.1 的示例
  `cad.box({ size: [30, 30, 5] })` **已经失效**——源码
  `packages/core/src/api/primitives.ts:37` 明确抛
  `E_ARGS_FORM: the `box({ size })` object form is removed`，
  正确形态是**位置参数** `cad.box(30, 30, 5)`（`slotMap` 装箱为 `{width,depth,height}`）。
  手册未随源码更新，这会误导所有读者。

### 3.3 脚本面参数契约无对外文档（v1 第 3 条 → 保留 P1）

- 仍然成立。补充两条实测：
  1. `cad.profile` 需要 `{ contours: [{ segments: [...] }] }`，不是点数组
     （点数组报 `E_PROFILE_NO_CONTOURS`）。
  2. `.fai.js` 语句是**换行分隔**，写在一行用 `;` 会在首条语句后静默停止
     （本探针 v2 的全部 `NOOUT` 即由此产生，`failedAt` 也是 `undefined`——
     这是**静默截断**，值得在语言契约里点名）。

### 3.4 执行 `.fai.js` 没有一等 API（v1 第 8 条 → 保留 P1）

- 仍然成立：主入口只有 `analyzeCode`（静态分析）；
  执行入口在 `@faicad/faijs/node`（`cliMain` / `createApiNamespace`），
  且**发布 tarball 不含 `scripts/`**，下游（如 faijs-cadquery）只能自带 CLI 包装器。
- **本项目已按此把 CLI 包装器固化**：`tests/probe-faijs-host.mjs`
  与 `tests/probe-faijs-ts-face.mjs` 展示了两种装配路径，可作下游参考。

### 3.5 生成物命名误导（v1 第 7 条 → 保留 P2）

- `dist/lang/symbol-table.generated.js` = 脚本面**全集**（95 键）；
  `script-face-manifest.js` = **新增 op 增量清单**（40 项，不含 `box/sphere/union`）。
  按后者当全集用会得出「`cad.box` 不存在」的错误结论。

---

## 4. 【新增】装配一个可用 Host 的三个坑（实测踩出）

按 `docs/library-dev-guide.zh.md` 写库、或按 `packages/sketch/src/faces-plane.test.ts:29`
抄装配时，有三个必踩的坑：

1. **只 `createRuntime` 不 `registerOcctBrepEngine`** →
   `[faijs/bridge] BREP engine API not available: BREP operations require an initialized engine`。
   （脚本面走 `runtime.execute` 时 brepChain 自带 kernel，裸调 ① 面不会。）
2. **`configureBackends` 漏 `config.brepCapabilities`** → 布尔报
   `E_BREP_UNSUPPORTED: current engine lacks capability 'fuseWithHistory' (brepEngineId=<none>)`。
   `packages/core/src/cad-runtime/runtime.ts:577` 那里是 **getter**；
   照抄 `packages/sketch/src/faces-plane.test.ts:35` 的 `config: { mode: 'brep' }`
   会漏掉它——因为 sketch 只用 `directEdit`，不需要 `fuse` 能力。
3. **`defineOp` 包装的函数直接返回 `Promise<Shape>`，不是 `Result`**。
   我用 `isErr(shape)` 判定拿到的 `Shape`，得到假阳性（`isErr` 判据是 `ok === false`，
   而 `Shape` 上没有 `ok` 字段）。Result 只出现在**库作者自己返回的值**上。

**建议**：手册 §3.1 的 Host 装配小节应给出**完整可复制的装配函数**，
并显式说明「capabilities 必须一并传入」。

---

## 5. 【新增】`Math` 这类安全全局：三处放行，一处缺失（被误读成「语言不支持」）

**现象**：在 op 实参里写 `cad.box(Math.PI, 1, 1)` 失败——
`ParseError: [parser] line 2: unknown identifier "Math" in expression`。
我最初把它记成「脚本的表达式**求值器**不认 Math」，**这个措辞是错的**：
拦下它的不是求值器，而是**执行前的静态元数据提取器**。

**分层取证**（结论：不是缺 import，不是求值器不支持，是校验器白名单漏了一项）

| 层 | 位置 | 对 `Math` 的态度 | 证据 |
|---|---|---|---|
| L1 静态安全门禁 | `lang/security-scanner.ts` | **放行** | `S4_SAFE_GLOBALS`（0.29.5 实测 34 项）含 `Math`/`JSON`/`console`/… 以及单位常量 `MM`/`INCH`/`DEGREE` |
| L2a 执行后端（默认） | `cad-runtime/exec-backends/vm-backend.ts` | **支持** | `new Function('__ctx','__ns','__isGeom', src)` —— 函数体在**真实全局作用域**求值，`Math` 天然可见 |
| L2b 执行后端（禁 eval） | `cad-runtime/interp/env.ts` | **支持** | `S4_SAFE_GLOBALS.has(name)` → `globalThis[name]` |
| L3 前置静态校验 | `lang/metadata-extractor.ts` | **拒绝** | `collectExprIdentifiers` 的已知标识符集合只有 `paramNames` / `declared` / `SCRIPT_UNIT_NAMES` —— **没有 `S4_SAFE_GLOBALS`**，裸 `Math` 落进 `else` 抛 `E_REFERENCE` |

`runtime.execute` 的**第一步**就是 `extractMetadata`（`cad-runtime/runtime.ts:790`），
所以链路在真正执行前就断了 —— 而**执行器本身完全支持**：把源码直接交给 vm 后端的
同款包装，`__ctx.x = Math.PI * 2` 得到 `6.283185307179586`。

**★ 决定性对照（同一函数、同一位置，只换实参）**

```
cad.box(10 * MM, 1, 1)   → 放行    （MM 在 SCRIPT_UNIT_NAMES 里）
cad.box(Math.PI, 1, 1)   → 抛错    （Math 只在 S4_SAFE_GLOBALS 里）
```

`MM` 与 `Math` 在 `S4_SAFE_GLOBALS` 里**同级**，差别仅在于 metadata-extractor
额外内联了一份单位常量表。**两份等效的白名单，只搬了一份。**

**触发条件是「位置」，不是「标识符」**

- op 实参表达式 → 走 `parseValueExpr` 的**非 lenient** 路径 → 拦；
- 顶层常量行 RHS → 走 `recordArgSource` 的 `lenient: true` 路径 → 放行。

实测：`let x = Math.PI` 通过；`cad.box(Math.PI,1,1)` 抛错；嵌套对象属性值
（`{ startAngle: Math.PI }`，即本项目 M2 踩到的形态）同样抛错。

**影响面**：任何在 op 实参里用 `Math.*` / `JSON.*` / `Date.*` 的脚本都会在执行前被拒，
而报错文案是「unknown identifier」——读者会合理地推断成「这个语言没有 Math」。
「`Math` 需要 import 吗」这类问题也会因此没有正确答案。

**建议（faijs 侧）**：

1. `collectExprIdentifiers` 的已知标识符判定应并入 `S4_SAFE_GLOBALS`（或直接复用
   同一份常量表），消除「三处放行、一处缺失」；
2. `E_REFERENCE` 文案应区分「未声明的用户变量」与「已知安全全局被白名单漏掉」——
   后者不该叫 `unknown identifier`。

**对本项目的处置**：emitter 输出**预先算好的数值字面量**（`emit/units.ts`），
天然绕开该问题，**不需要 import**；若要输出人读友好的 `Math.PI`，可行做法是先在
顶层常量行绑定（`let pi = Math.PI`）再在实参里引用 —— 已由
`src/emit/faijs-script-globals.probe.test.ts` §C 钉住。

---

## 6. 给 faijs 的优先级建议（v2 修订版）

| 优先级 | 问题 | 变化 | 理由 |
|---|---|---|---|
| P0 | 三/四个 cad-like 表面边界不清（§3.1） | v1 保留 | 每个下游都会踩，我也是 |
| P0 | 手册 §4.1 `cad.box({size})` 示例已失效（§3.2） | **新增** | 手册未随源码更新，读者照抄即报错 |
| P0 | Host 装配缺完整示例与 capabilities 说明（§4） | **新增** | 装配缺失会被误读成「能力缺口」 |
| P1 | 执行 `.fai.js` 无一等 API，下游各自内联 CLI（§3.4） | v1 保留 | 每个下游重复造轮子 |
| P1 | 脚本面参数契约无对外文档（§3.3） | v1 保留 | 写错参数静默出错几何 |
| P1 | `convexHull` 与 OpenSCAD 语义的 `hull` 同名近义易混（§1） | **新增** | 选型时会误以为 hull 已有 |
| P1 | 安全全局白名单「三处放行、一处缺失」，`Math` 被报成 unknown identifier（§5） | **新增** | 报错文案与真实原因相反，下游会误判成语言不支持 |
| P2 | 单位常量仅子路径导出（§3.2） | v1 降级 | 一行 re-export 可解决 |
| P2 | 生成物命名误导（§3.5） | v1 保留 | 改命名/注释即可 |
| — | ~~布尔默认不可用~~ | **撤回** | 装配后全通 |
| — | ~~volume 静默 NaN~~ | **撤回** | 装配后精确 |
| — | ~~球差 0.22%~~ | **撤回** | BREP 下误差 0.0000% |

---

## 7. 复现方式

```bash
cd C:/my/Faicad/faijs-openscad

# ① TS 兼容面（含 Host 装配）—— 库作者视角，结论以它为准
node tests/probe-faijs-ts-face.mjs

# ② cad 脚本面（经 runtime.execute）
node tests/probe-faijs-host.mjs

# §5 分层取证：Math 四层态度 + 真机位置矩阵
npx tsx src/__probe__/script-globals-scan.ts

# v1 的错误做法，保留作为反面证据
FAIJS_PROBE_RUNTIME=1 node tests/probe-faijs-api.mjs
```

三个探针已固化为长期测试（见 `src/**/*.probe.test.ts` 与 `probe-inventory.test.ts`），
按「探测代码必须保留为测试」的要求不得删除。
