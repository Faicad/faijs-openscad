# AGENTS.md — faijs-openscad

## What this project is

`@faicad/faijs-openscad` — a standalone TypeScript converter that transpiles
OpenSCAD models into faijs code (`.fai.js`). It does NOT reimplement the
OpenSCAD language front-end; instead it reuses the output of the official
OpenSCAD frontend (normalized `.csg`), parses it with a hand-written
lexer/parser, lowers it into a Model IR, and emits deterministic `.fai.js`.

Pipeline: `.scad` → (OpenSCAD binary, external process) → `.csg` → CSG AST
(source ranges) → IR (lower/normalize/capability check) → `.fai.js` → (faijs) → STL/STEP/3MF.

## ⚠️ 用户全局铁律（最高优先级，优先于本文件一切其它规则）

1. **用户需求永远是第一位的，必须立刻响应。** 用户问进度时，必须**立刻停下手里的所有工作**、如实报告当前状态；永远不准以「让我再跑一个更准确的报告 / 再验证一轮 / 再查一下」为由继续跑任务而不先回应用户。
2. **如实汇报一切。** 未解决的 bug 永远不写成「已解决 / implemented」；用户叫停 / 禁跑后立即停手，不在未授权下继续跑任务。


开发本项目时，碰到的faijs项目本身的bug或者功能缺陷，必须优先解决。
碰到对faijs的特性和api使用产生误解的地方，要记录下来，并思考如何优化faijs项目的文案、项目组织、甚至api设计，以便别人首次开发faijs时少踩坑。

注意：OpenSCAD 的源码（其 `src/`）许可证是 GPL-2.0，本项目不能使用 / 复制 OpenSCAD 的任何源代码，且**项目文档与代码不得引用 OpenSCAD 源码**。但 OpenSCAD 官方 `examples/` 目录随仓库以 **CC0-1.0** 发布（含 `COPYING-CC0.txt`），属公共领域，**可完整拷贝进本项目**并作为验证语料——这不与 AGPL 冲突，也与 `src/` 的 GPL 无关。

- 验证功能正确性时，建模 `.scad` 测试用例统一使用 **OpenSCAD 官方 `examples/`**（CC0-1.0）：已完整拷贝到 `tests/fixtures/openscad-examples/`，并在同目录由 `tests/gen-examples-fai.ts` 生成对应的 `.fai.js`。
- 验证入口：`tests/verify-examples.ts`（OpenSCAD 二进制求值 → `.csg` → 解析器零诊断解析 + 双路直方图对账）与 `tests/examples-verify.test.ts`（Vitest 回归门禁）；语料为 `tests/fixtures/openscad-examples/` 下 50 个 `.scad`（CC0）。
- MCAD（LGPL-2.1）仅作**可选**传递依赖：仅 `Old/example023.scad` 通过 `use <MCAD/...>` 引用它；它**不是**验证语料。
- 分析 OpenSCAD 行为以对齐兼容性时，沿用「一个 agent 读源码整理规格、另一个 agent 按规格实现」的分工；但整理出的必须是**规格文档**，不得把上游源码复制进仓库，且本仓库文档不得出现 OpenSCAD 源码引用。