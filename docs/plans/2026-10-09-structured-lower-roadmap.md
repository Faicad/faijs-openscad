# 结构化 lower 路径 — 后续工作路线图

> 日期：2026-10-09
> 状态：Phase 1-4 核心已完成，50/50 官方 examples 通过 `--structured` 转译
> 前置文档：`docs/plans/2026-10-09-structured-lower-from-scadast.md`（原始方案）

## 1. 已完成工作总结

### 1.1 提交历史

| Commit | 内容 |
|--------|------|
| `416e335` | Phase 1：基础 IR 类型 + lowerScad + emitter（for/if/let/module/function） |
| `e7b2379` | Phase 2：rands xorshift32 PRNG + cos/sin/tan 角度转换 + matMul + setColor |
| `2af675d` | Phase 3：intersection_for + children() + 列表推导式(lcfor/lcif/lclet/lceach) + $fn |
| `3195a39` | Phase 4.1：`transpile --structured` CLI 选项 |
| `12d3cbc` | linear_extrude/rotate_extrude/render + IrExprCall.child |
| `7241d86` | 颜色名 → RGB 映射（40+ X11/CSS 颜色名） |
| `bfe4d37` | polygon via `__polygon` helper + cad.profile |
| `c39adc4` | use/include 跨文件导入（递归解析 + 循环引用检测） |

### 1.2 验证结果

- **17 个单元测试**全部通过（`src/ir/lower-scad.test.ts`）
- **50/50 官方 examples** 通过 `--structured` 转译（零 error 诊断）
- `module_recursion.scad`：8189 条扁平语句 → 28 行结构化代码
- 完整测试套件 455 通过（3 个预存 probe 失败，无新回归）

### 1.3 已支持的 OpenSCAD 特性

| 类别 | 特性 | 实现方式 |
|------|------|----------|
| 控制流 | `for` / `intersection_for` | IrForLoop + JS for + cad.union/intersect |
| 控制流 | `if` / `else` | IrIf + JS if |
| 控制流 | `let` | IrLet + JS const |
| 模块 | 用户 module 定义/调用 | IrModuleDef + async function |
| 模块 | 递归 module | async function 递归 |
| 模块 | `children()` / `children(i)` | IrChildrenRef + `...__children` |
| 函数 | 用户 function 定义 | IrFunctionDef + JS function |
| 函数 | 递归 function | JS function 递归 |
| 表达式 | 列表推导式 | lcfor/lcif/lclet/lceach → IIFE 数组 |
| 表达式 | `rands(min,max,count,seed)` | xorshift32 PRNG helper |
| 表达式 | `sin`/`cos`/`tan`/`asin`/`acos`/`atan` | Math.* + 角度转弧度 |
| 表达式 | 矩阵乘法 `m * mt(...)` | matMul helper + 类型推断 |
| 几何 | cube/sphere/cylinder/cone | cad.box/sphere/cylinder/cone |
| 几何 | square/circle/polygon | __rect/__circle/__polygon + cad.profile |
| 几何 | linear_extrude | cad.extrude(profile, {length}) |
| 几何 | rotate_extrude | cad.revolve(profile, {axis, at, angle}) |
| 几何 | render | 透传 |
| 变换 | translate/rotate/scale/mirror/multmatrix | applyMatrix 方法链 |
| 变换 | color | setColor + setOpacity |
| 变换 | color("red") 颜色名 | COLOR_NAMES 映射表 → RGB |
| 特殊变量 | $fn | segments 参数提取 |
| 跨文件 | `use <file>` | 导入 module/function/variable 定义 |
| 跨文件 | `include <file>` | 导入所有语句 |

---

## 2. 剩余工作

### Phase 5：缺失内置模块

#### 5.1 faijs API 能力分析

| OpenSCAD 模块 | faijs ② script face | faijs ① TS face | CSG 路径 | 使用 examples 数 | 分类 |
|---------------|---------------------|-----------------|----------|-----------------|------|
| `hull` | absent | `convexHull`（point-set） | blocked | 3 | **需 faijs 扩展** |
| `minkowski` | absent | absent | blocked | 0 | **需 faijs 扩展** |
| `offset` | present | `offset` | blocked | 3 | **可接入** |
| `projection` | absent | absent | blocked | 4 | **需 faijs 扩展** |
| `polyhedron` | absent | absent | blocked | 1 | **需 faijs 扩展** |
| `text` | absent（迁至 extra） | absent | 由 OpenSCAD 展开 | 11 | **需 faijs-extra** |
| `surface` | absent | absent | 由 OpenSCAD 展开 | 2 | **需 faijs 扩展** |

#### 5.2 任务分解

##### 5.2.1 `offset` — 可直接接入（优先级：中）

faijs ② face 已有 `offset` API。需要在 `lowerBuiltinModule` 的 `builtinChain` 中添加 case。

```
offset(r = delta, delta = d, chamfer = bool) { 2D profile }
→ cad.offset(profile, { delta, chamfer })
```

**实现步骤**：
1. `builtinChain` 添加 `case 'offset'`
2. 提取参数：`r`/`delta`（偏移量）、`chamfer`（布尔）
3. 返回 `[{ method: 'cad.offset', args: [childRef, { delta, chamfer }] }]`
4. 使用 `IrExprCall.child` 引用 2D profile
5. 测试：`Advanced/offset.scad`、`Advanced/GEB.scad`

**风险**：faijs `offset` 的参数签名需确认（`delta` vs `r`、chamfer 默认值）。

##### 5.2.2 `hull` — 需确认 faijs convexHull 语义（优先级：中）

faijs 有 `convexHull` 但是 **point-set hull**（`hullFromPoints`），不是 OpenSCAD 的 **shape hull**（对多个几何体求凸包）。

**实现步骤**：
1. 确认 faijs `convexHull` 是否支持 shape 输入（而非仅点集）
2. 若支持：`hull() { A; B; C; }` → `cad.convexHull(A, B, C)`
3. 若不支持：向 faijs 提 feature request，或用 tessellation + point-set hull 近似
4. 测试：`Basics/hull.scad`、`Old/example006.scad`

**风险**：point-set hull 与 shape hull 几何不等价（shape hull 保留曲面，point-set hull 离散化后求包络）。

##### 5.2.3 `polyhedron` — 需 faijs 扩展（优先级：低）

faijs ①/② face 都没有 `polyhedron`。CSG 路径也标记为 blocked。

**实现步骤**：
1. 向 faijs 提 feature request：`cad.polyhedron(points, faces)`
2. 或用 `cad.fromMesh(positions, indices)` 近似（如果 faijs 有此 API）
3. 在 `builtinChain` 添加 `case 'polyhedron'`
4. 测试：`Old/example011.scad`

##### 5.2.4 `text` — 需 faijs-extra（优先级：中）

`text` / `svgExtrude` 已迁到 `@faicad/faijs-extra`。

**实现步骤**：
1. 确认 `@faicad/faijs-extra` 是否已安装/可用
2. 若可用：`text(t, size, font, spacing)` → `extra.text(t, { size, font, spacing })`
3. 在 emitter 中注入 `extra` 导入语句
4. 若不可用：标记为 IrBlocked，报诊断 "text requires @faicad/faijs-extra"
5. 测试：`Basics/text_on_cube.scad`、`Parametric/sign.scad`

**影响范围**：11 个 examples 使用 text。这些 examples 在 CSG 路径中由 OpenSCAD 二进制将 text 展开为 polyhedron。结构化路径无法复制此行为，必须依赖 faijs-extra。

##### 5.2.5 `surface` — 需图像读取支持（优先级：低）

`surface(file)` 从图像文件生成高度图。

**实现步骤**：
1. 在 lower 时读取图像文件，提取像素高度
2. 生成点阵 → `cad.polyhedron` 或 `cad.fromMesh`
3. 或标记为 IrBlocked
4. 测试：`Old/example010.scad`、`Advanced/surface_image.scad`

##### 5.2.6 `projection` — 需 faijs 扩展（优先级：低）

`projection(cut = bool)` 将 3D 几何投影到 2D。

**实现步骤**：
1. 确认 faijs 是否有投影 API
2. 若有：`projection() { 3D solid }` → `cad.project(solid, { cut })`
3. 若无：标记为 IrBlocked
4. 测试：`Basics/projection.scad`、`Old/example021.scad`

##### 5.2.7 `minkowski` — 需 faijs 扩展（优先级：最低）

0 个 examples 使用。可暂缓。

---

### Phase 6：Parity runner 改造

#### 6.1 目标

对结构化路径输出做几何对账，验证与 CSG 展开路径结果一致。

#### 6.2 现状

`tests/run-parity.ts` 已有 parity runner，走 CSG 路径：
1. 读取缓存 CSG
2. `parseCsg` → `lowerCsg` → `emitFaijs`
3. faijs runtime 执行 → candidate mesh
4. 与参考 STL 对比 → PASS/FAIL

#### 6.3 任务

##### 6.3.1 结构化 parity runner

**新增** `tests/run-parity-structured.ts`（或给 `run-parity.ts` 加 `--structured` 选项）：

```
对每个 example：
1. 读取 .scad 源文件
2. parseScad → lowerScad → emitFaijs（结构化路径）
3. faijs runtime 执行 → candidate mesh
4. 与参考 STL 对比 → PASS/FAIL
5. 输出报告：structured-parity-report.{json,md}
```

##### 6.3.2 双路对比报告

新增对比模式，同时跑 CSG 路径和结构化路径，对比两者输出：

```
对每个 example：
1. CSG 路径：parseCsg → lowerCsg → emitFaijs → mesh_csg
2. 结构化路径：parseScad → lowerScad → emitFaijs → mesh_struct
3. 对比 mesh_csg vs mesh_struct（体积、表面积、IoU）
4. 输出：dual-parity-report.{json,md}
```

**关键问题**：
- 缺失模块（hull/text/surface 等）在结构化路径被静默忽略，导致几何不完整
- 需要先完成 Phase 5（或至少标记缺失模块为 IrBlocked），否则 parity 对比无意义
- `rands` 的 seed 在两条路径中必须一致（已确保：xorshift32 PRNG 与 evaluator 一致）

##### 6.3.3 缺失模块诊断

当前缺失模块被**静默忽略**（返回空数组）。应改为报 warning 诊断：

```ts
// lowerBuiltinModule 中，对于不支持的模块：
this.bag.add({
  code: 'OSC3003',
  severity: 'warning',
  message: `Module "${stmt.name}" not supported in structured path, output may be incomplete`,
})
return []
```

这样用户能知道哪些几何被跳过了。

---

### Phase 7：默认路径决策与集成

#### 7.1 选项设计

```
faijs-openscad transpile input.scad              # 默认路径
faijs-openscad transpile input.scad --structured # 强制结构化路径
faijs-openscad transpile input.scad --no-structured  # 强制 CSG 展开路径
```

#### 7.2 默认路径选择策略

**方案 A：结构化路径为默认**
- 优点：输出体积小、可读性高、无需 OpenSCAD 二进制
- 缺点：缺失模块（hull/text/surface 等）输出不完整
- 适用：不含缺失模块的 .scad 文件

**方案 B：CSG 路径为默认（保持现状）**
- 优点：所有模块支持（由 OpenSCAD 二进制展开）
- 缺点：需要 OpenSCAD 二进制、输出体积大
- 适用：需要完整几何输出的场景

**方案 C：自动选择（推荐）**
- lower 前扫描 .scad 源码，检测是否使用缺失模块
- 不含缺失模块 → 结构化路径
- 含缺失模块 → CSG 路径（fallback）+ warning 诊断
- 用户可用 `--structured` / `--no-structured` 覆盖自动选择

**推荐方案 C**，实现步骤：
1. 在 `transpileFile` 中，当 ext === '.scad' 且未显式指定路径时：
2. 快速扫描源码文本，检测 `hull(`、`text(`、`surface(`、`projection(`、`polyhedron(` 等关键词
3. 若含缺失模块 → CSG 路径 + warning "falling back to CSG expansion for unsupported modules"
4. 若不含 → 结构化路径
5. `--structured` 强制结构化（缺失模块静默忽略 + warning）
6. `--no-structured` 强制 CSG

#### 7.3 manifest 集成

`tests/manifest.json` 中每个 example 标注：
```json
{
  "name": "module_recursion",
  "status": "ported",
  "path": "structured",  // "csg" | "structured" | "auto"
  "structuredOk": true,
  "csgOk": true,
  "parityMatch": true
}
```

---

### Phase 8：表达式 lower 完善

#### 8.1 缺失的内置函数

需检查 `lowerBuiltinCall` 是否覆盖所有 OpenSCAD 内置函数：

| 函数 | 状态 | 备注 |
|------|------|------|
| `sin`/`cos`/`tan`/`asin`/`acos`/`atan`/`atan2` | ✅ | 角度转弧度 |
| `sqrt`/`pow`/`exp`/`log`/`ln`/`abs`/`sign` | ✅ | Math.* |
| `rands` | ✅ | xorshift32 PRNG |
| `min`/`max` | 需确认 | |
| `floor`/`ceil`/`round` | 需确认 | |
| `pow` | ✅ | Math.pow |
| `cross` | 需确认 | 向量叉积 |
| `norm`/`len` | 需确认 | 向量长度 |
| `str` | 需确认 | 字符串拼接 |
| `chr` | 需确认 | 字符转换 |
| `ord` | 需确认 | |
| `concat` | 需确认 | 数组拼接 |
| `search` | 需确认 | 数组搜索 |
| `version`/`version_num` | 需确认 | |
| `let` 表达式 | 需确认 | |

**实现步骤**：
1. 审计 `lowerBuiltinCall` 的 switch，列出已支持/未支持的函数
2. 为未支持函数添加 case
3. 测试：`Functions/functions.scad`、`Functions/recursion.scad`

#### 8.2 常量折叠优化

当前 lower 对常量表达式（如 `1 + 2`、`sin(30)`）保留为 IrExpr，emitter 输出 JS 表达式。可在 lower 阶段做常量折叠：

- 纯数字字面量的二元运算 → 求值为数字字面量
- 纯常量的函数调用（如 `sin(30)`）→ 求值为数字字面量
- 减小输出体积、提高运行时性能

**风险**：浮点精度差异。OpenSCAD 和 JS 的浮点运算可能有微小差异。需确认对账容忍度。

---

### Phase 9：边缘 case 与健壮性

#### 9.1 `mirror` 变换

需确认 `mirror` 在结构化路径中的实现。`mirror([x,y,z])` 应映射为反射矩阵。

#### 9.2 `scale` 非均匀缩放

`scale([sx, sy, sz])` 需确认在 IrExprCall 方法链中正确发射。

#### 9.3 `multmatrix` 与矩阵乘法链

`multmatrix(m1) multmatrix(m2) cube()` 应合并为 `multmatrix(m1 * m2) cube()` 或保留为两次 applyMatrix。需确认当前实现。

#### 9.4 空 for 循环 / 空 if

```
for (i = []) cube();     // 空迭代
if (false) cube();       // 恒假条件
```

应正确发射为空几何（`cad.union()` 或 `undefined`）。

#### 9.5 嵌套 module 的作用域

```
module outer() {
  x = 10;
  module inner() {
    cube([x, x, x]);  // 引用 outer 的 x
  }
  inner();
}
```

需确认嵌套 module 定义中引用外层变量的行为。当前 `userModules` 只存储 params 和 body，不携带闭包变量。

#### 9.6 `$children` 特殊变量

`children()` 的数量可通过 `$children` 获取。需确认是否支持。

#### 9.7 `assert` / `echo` 语句

当前 `assert` 和 `echo` 在 lower 中被忽略。应发射为 JS `console.assert` / `console.log` 或忽略。

---

## 3. 优先级排序

| 优先级 | Phase | 任务 | 理由 |
|--------|-------|------|------|
| **P0** | 6.3.3 | 缺失模块 warning 诊断 | 用户需知道哪些几何被跳过 |
| **P0** | 7.2 | 默认路径自动选择（方案 C） | 用户体验：自动选最优路径 |
| **P1** | 5.2.1 | `offset` 接入 | faijs 已有 API，3 个 examples |
| **P1** | 6.3.1 | 结构化 parity runner | 验证几何正确性 |
| **P1** | 8.1 | 内置函数审计与补全 | 影响表达式正确性 |
| **P2** | 5.2.4 | `text` 接入（via faijs-extra） | 11 个 examples |
| **P2** | 5.2.2 | `hull` 接入 | 3 个 examples，需确认 convexHull 语义 |
| **P2** | 9.* | 边缘 case 健壮性 | 影响特定场景 |
| **P3** | 5.2.3 | `polyhedron` 接入 | 1 个 example，需 faijs 扩展 |
| **P3** | 5.2.5 | `surface` 接入 | 2 个 examples，需图像读取 |
| **P3** | 5.2.6 | `projection` 接入 | 4 个 examples，需 faijs 扩展 |
| **P3** | 8.2 | 常量折叠优化 | 性能优化，非功能需求 |
| **P4** | 5.2.7 | `minkowski` 接入 | 0 个 examples |

---

## 4. 依赖关系

```
Phase 5 (缺失模块) ─┬─→ Phase 6 (parity runner)
                     │
Phase 8 (表达式)   ──┘

Phase 6 (parity) ──→ Phase 7 (默认路径决策)
                     │
Phase 9 (边缘 case) ─┘
```

- Phase 5 和 Phase 8 可并行开发
- Phase 6 依赖 Phase 5（缺失模块补全后 parity 才有意义）
- Phase 7 依赖 Phase 6（需要 parity 数据决定默认路径）
- Phase 9 可随时穿插

---

## 5. faijs 扩展需求清单

以下功能需要 faijs 项目侧实现（非本项目可独立完成）：

| 功能 | 优先级 | 提案状态 | 备注 |
|------|--------|----------|------|
| `cad.polyhedron(points, faces)` | P3 | 未提交 | ①/② face 都 absent |
| Shape hull（非 point-set hull） | P2 | 未提交 | `convexHull` 是 point-set，不等价 |
| `cad.project(shape, { cut })` | P3 | 未提交 | 投影到 2D |
| `@faicad/faijs-extra` 的 `text` | P2 | 已迁至 extra | 需确认安装方式 |
| 全局三角化密度控制 API | P1 | 已提交提案 | `docs/plans/2026-10-07-faijs-tessellation-density-proposal.md` |

---

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 结构化路径与 CSG 路径几何不等价 | Phase 6 parity runner 对账；不等价时报诊断 |
| 缺失模块静默忽略导致输出不完整 | Phase 6.3.3 添加 warning 诊断 |
| `rands` 确定性随机不一致 | 已确保：xorshift32 PRNG 与 evaluator 一致 |
| 嵌套 module 闭包变量丢失 | Phase 9.5 审计；必要时在 IrModuleDef 中携带闭包 |
| faijs API 缺失（polyhedron/hull/projection） | Phase 5 标记 blocked + 向 faijs 提 feature request |
| `text` 依赖 faijs-extra | Phase 5.2.4 确认安装方式；不可用时标记 blocked |
| 浮点精度差异（常量折叠） | Phase 8.2 谨慎实施；对账容忍度内可接受 |

---

## 7. 验收标准

### 7.1 Phase 5 验收

- 每个已接入模块有对应的单元测试
- 缺失模块报 warning 诊断（非静默忽略）
- 50/50 examples 仍通过 `--structured` 转译

### 7.2 Phase 6 验收

- 结构化 parity runner 能对 50 个 examples 产出报告
- 不含缺失模块的 examples：结构化路径与 CSG 路径几何一致（体积差 < 1%，IoU > 0.99）
- 含缺失模块的 examples：报告中标注 "incomplete due to unsupported modules"

### 7.3 Phase 7 验收

- `transpile` 无选项时自动选择最优路径
- `--structured` / `--no-structured` 能覆盖自动选择
- 自动选择时有诊断信息说明选择ECSG fallback 原因

### 7.4 Phase 8 验收

- 所有 OpenSCAD 内置函数都有对应的 JS 映射
- `Functions/functions.scad` 和 `Functions/recursion.scad` 输出正确

### 7.5 Phase 9 验收

- 边缘 case（空循环、嵌套 module、mirror 等）有单元测试
- 不产生运行时错误