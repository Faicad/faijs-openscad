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

## 当前状态：M0（骨架与事实探针）已完成

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 包骨架、五阶段 CI、基线锁、OpenSCAD 发现与 doctor、三态 manifest、能力探针（含 ① 面 Host 装配测量） | ✅ 完成 |
| M1 | CSG lexer/parser（目标：225 个 CSG golden 全部解析） | ⬜ 未开始 |
| M2 | Model IR + P0 emitter（faijs check / 执行） | ⬜ 未开始 |
| M3 | `.scad` CLI 与 examples 流水线 | ⬜ 未开始 |
| M4 | 几何 parity 与 analytic/faceted 裁决 | ⬜ 未开始 |
| M5/M6 | P1 精确扩展、P2 高风险项与发布 | ⬜ 未开始 |

CLI 目前只实现 `doctor` / `explain` / `version` / `help`；
`transpile` / `dump` / `check` / `run` / `corpus` / `report` 会明确返回退出码 1 而不是假装成功。

许可证（LICENSE）**尚未落盘**：计划中的 T007 要求项目所有者确认后再写入，建议与 faijs-cadquery 对齐为 `AGPL-3.0-only`。

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
| `OPENSCAD_SRC` | OpenSCAD 源码检出根目录（语料与 examples 基线） |
| `OPENSCAD_BIN` | 指定 OpenSCAD 可执行文件路径 |
| `FAIJS_PROBE_RUNTIME=1` | 启用需要加载 faijs wasm 运行时的探针（较慢，默认关闭） |

脚本：

```bash
npm run corpus:gen       # 生成 tests/corpus-manifest.json（三态清单）
npm run baseline:check   # 校验 src/baseline.ts 与 tests/baseline.json 及语料数量
npm run coverage         # 语料加权覆盖率报告（需 OPENSCAD_SRC）
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
  ir/capability.ts    节点能力分级（direct / helper / approximate / unsupported）
  emit/units.ts       单位与字面量策略（唯一允许决定数字怎么渲染的地方）
  diagnostics/        诊断模型、错误码表、格式化
  cli/                CLI 入口与命令
  __probe__/          探针共用的环境门控与 faijs 静态契约扫描
tests/
  baseline.json       由 src/baseline.ts 派生的基线产物
  corpus-manifest.json 275 个语料条目的三态清单
  gen-manifest.ts / check-baseline.ts / coverage.ts
  probe-faijs-ts-face.mjs   ① TS 兼容面探针（含 Host 装配）
  probe-faijs-host.mjs      ② 脚本面探针（经 runtime.execute）
  probe-faijs-api.mjs       早期错误做法，留作反面证据
```

---

## 关键约束与已确认事实

1. **OpenSCAD 只作为外部进程调用**。其源码是 GPL-2.0-or-later；本项目不链接、不复制其源码，npm 产物不含任何 OpenSCAD 二进制或上游源码。
2. **CSG 不是稳定 API**：词表与方言以 `src/baseline.ts` 锁定的 commit 为准；语料里出现新节点名时词表探针会失败，要求人工复核而不是静默忽略。
3. **语料基线**：225 个 CSG golden（169 dump + 56 dump-examples）、50 个 examples、579 个测试 `.scad`、28 个 AST golden。
4. **faijs 有三个 API 面，我们站在「库作者」这一面**（实测 2026-10-06）：

   | 面 | 消费者 | 形态 | 位置 |
   |---|---|---|---|
   | ① TS 兼容面 | **第三方 TS 库（本项目）** | 扁平函数 + 位置参数 + `Result`；57 个候选 op 里只有 `polyhedron` 缺失 | `@faicad/faijs` 主导出 |
   | ② cad 脚本面 | `.fai.js` | `cad.*`；语句边界 unwrap `Result` | Host 注入的 `cad` 命名空间（95 op） |
   | ③ 库边界面 | 库导出函数 | `defineOp` 声明，`registerLib` 接纳 | `@faicad/faijs/sdk` |

   实现新 op（填补 `polyhedron` / `hull` / `minkowski` 等缺口）应走**库开发指南**
   （`faijs/docs/library-dev-guide.zh.md`）的 `defineOp` 路线，而不是去扩展脚本面。

5. **`import { cad }` 拿到的 38 键对象不是任何一面**。它是一个内部 BREP 命名空间
   （`boxBrep`/`fuseBrep`/`*Brep`）。早期基于它得出的结论（布尔不可用 / `volume` 返回
   NaN / 球差 0.22%）**已全部撤回**——那是在**没有装配 Host** 的情况下测的假象。
6. **装配 Host 是硬前提**：`initOcctWasm()` → `registerOcctBrepEngine()` →
   `configureBackends({ config: { mode, brepEngineId, brepCapabilities }, kernel: { brep } })`。
   `brepCapabilities` 最容易被漏（`runtime.ts:577` 是 getter），漏了布尔会报
   `E_BREP_UNSUPPORTED (brepEngineId=<none>)`。
7. **装配后 ① 面是精确的**：`volume(sphere(10)) = 4188.790204786392`，与解析值误差 0.0000%。
   几何 parity 的差异应归因于 OpenSCAD 的 `$fn` 离散化，而不是 faijs 的误差。
8. **`convexHull` ≠ OpenSCAD 的 `hull`**：前者接受**点集**（内核方法 `hullFromPoints`），
   喂 shape 会抛 `points.map is not a function`。`offset` 同理——faijs 的 `offset` 是
   **3D 全表面**偏移（10mm box +2 → 2610.5 mm³），对 2D 轮廓是 **no-op**。
9. **`color` 走实例方法**：`Shape.setColor / setOpacity / setAppearance / getAppearance`
   实测可用（`setColor('#e53935')` + `setOpacity(0.5)` 经 `getAppearance()` 往返成功）。
10. **单位常量在 `@faicad/faijs/units`**（`MM=1`、`DEGREE=1`、`RADIAN=180/π`），主入口不导出。
11. **`.fai.js` 语句是换行分隔**，不是 `;` 分隔；写在一行会在首条语句后**静默截断**。
12. 详细勘误与对 faijs 的文档/设计建议见 `outputs/2026-10-06-faijs-api-assumption-errors.md`。

---

## 语料加权覆盖率（2026-10-06 实测）

`npm run coverage`（需 `OPENSCAD_SRC`）：

```text
corpus: 225 CSG goldens, 26 node kinds, 17624 nodes
  direct       kinds=14  nodes= 17097  share=97.01%
  helper       kinds= 2  nodes=   105  share= 0.60%
  approximate  kinds= 0  nodes=     0  share= 0.00%
  unsupported  kinds=10  nodes=   422  share= 2.39%
  blocked      fill hull import minkowski offset polyhedron projection roof surface text
```

按节点**质量**而非节点**种类**衡量：97.01% 可直接落地（`multmatrix` 一个就是 4783 个节点，
而 `roof` 只有 5 个）。剩余 2.39% 分布在 10 个被 BLOCKED 的节点上。

---

## 测试分层

- **常规 CI（无需 OpenSCAD）**：单元测试 + 静态契约探针 + 词表/方言/清单不变量。
- **语料层**：设置 `OPENSCAD_SRC` 后运行 225 个 CSG 的解析与清单校验。
- **运行时层**：`FAIJS_PROBE_RUNTIME=1` 时加载 faijs wasm，验证 TS 层可用子集与几何事实。
- 所有探测性代码都以 `*.probe.test.ts` / `tests/probe-faijs-api.mjs` 形式**长期保留**，不允许用后即删。
