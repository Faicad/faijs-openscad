# 方案：从 ScadAST 直接 lower 到结构化 IR（保留循环/递归/函数）

**日期**：2026-10-09
**状态**：方案设计
**动机**：`module_recursion.scad` 经 CSG 展开后产生 8189 条扁平语句，需容器化绕过 faijs 5000 上限。根因是 pipeline 走 `.scad → CSG展开 → .csg → 扁平IR → 扁平.fai.js`，展开丢失了循环/递归结构。路径 B（`src/scad/`）已有完整 ScadAST（含 module/for/if/递归/函数），但 `module-evaluator.ts` 把它展开成 CSG 文本再走路径 A。本方案在路径 B 增加一条**不展开**的 lower 分支。

## 1. 当前架构 vs 目标架构

### 当前（展开路径）

```
.scad → parseScad → ScadAST → module-evaluator（展开求值）→ CSG树 → dumpCsgTree → .csg文本
      → parseCsg → CsgAST → lowerCsg → 几何IR（扁平）→ emitFaijs → 扁平.fai.js（8189条语句）
```

### 目标（结构化路径）

```
.scad → parseScad → ScadAST → lowerScad（新）→ 结构化IR（含循环/递归/函数节点）
      → emitFaijsStructured（新）→ 结构化.fai.js（~20行递归函数）
```

两条路径**共存**：展开路径用于对账验证和不支持结构化的场景；结构化路径是主路径。

## 2. IR 扩展

现有 `IrGeometry`（`src/ir/model.ts`）是纯几何节点树。需增加**控制流节点**，它们不是几何值，而是**生成几何的代码结构**。

### 2.1 新增 IR 节点

```typescript
// ── 控制流（新增到 src/ir/model.ts）──────────────────────────────────────

/** OpenSCAD `for(i=[0:n], j=expr) { ... }` → JS 嵌套 for 循环。 */
export interface IrForLoop extends IrCommon {
  readonly kind: 'forLoop'
  readonly dimension: IrDimension
  /** 每个循环变量：名 + 迭代源（范围 / 向量 / 标量）。 */
  readonly iterators: readonly IrIterator[]
  /** 循环体：一组 IR 节点，union 合并。 */
  readonly body: readonly IrGeometry[]
}

export interface IrIterator {
  readonly varName: string
  readonly source: IrRange | IrVectorExpr | IrExpr
}

export interface IrRange {
  readonly kind: 'range'
  readonly start: IrExpr
  readonly end: IrExpr
  readonly step?: IrExpr
}

/** OpenSCAD `if (cond) { ... } else { ... }` → JS if 语句。 */
export interface IrIf extends IrCommon {
  readonly kind: 'if'
  readonly dimension: IrDimension
  readonly cond: IrExpr
  readonly then: readonly IrGeometry[]
  readonly els?: readonly IrGeometry[]
}

/** OpenSCAD `let(x=1, y=x*2) { ... }` → JS const 声明 + 块。 */
export interface IrLet extends IrCommon {
  readonly kind: 'let'
  readonly dimension: IrDimension
  readonly bindings: readonly { name: string; value: IrExpr }[]
  readonly body: readonly IrGeometry[]
}

/** 用户自定义 module 调用 → JS 函数调用。 */
export interface IrModuleCall extends IrCommon {
  readonly kind: 'moduleCall'
  readonly dimension: IrDimension
  readonly functionName: string
  readonly args: readonly IrExpr[]
  /** module 调用的子语句（children），作为回调传入。 */
  readonly children?: readonly IrGeometry[]
}

// ── 表达式 IR（新增）────────────────────────────────────────────────────

/**
 * OpenSCAD 表达式的 IR 表示。
 * 与几何 IR 不同：表达式求值为标量/向量/矩阵，不是 Shape。
 * emitter 把 IrExpr 直接映射为 JS 表达式字符串。
 */
export type IrExpr =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'var'; name: string }
  | { kind: 'binary'; op: string; left: IrExpr; right: IrExpr }
  | { kind: 'unary'; op: string; operand: IrExpr }
  | { kind: 'ternary'; cond: IrExpr; then: IrExpr; els: IrExpr }
  | { kind: 'call'; callee: string; args: readonly IrExpr[] }
  | { kind: 'index'; array: IrExpr; index: IrExpr }
  | { kind: 'vector'; elements: readonly IrExpr[] }
  | { kind: 'range'; start: IrExpr; end: IrExpr; step?: IrExpr }
  | { kind: 'matrixMul'; matrices: readonly IrExpr[] }  // OpenSCAD 矩阵乘法 → helper
```

### 2.2 Module/Function 定义表

module 和 function 定义不进 IR 树，而是作为**独立声明**收集在 `IrModel` 上：

```typescript
export interface IrModuleDef {
  readonly name: string
  readonly params: readonly { name: string; defaultValue?: IrExpr }[]
  readonly body: readonly IrGeometry[]  // module 体里的语句
}

export interface IrFunctionDef {
  readonly name: string
  readonly params: readonly { name: string; defaultValue?: IrExpr }[]
  readonly body: IrExpr  // function 体是单个表达式
}

export interface IrModel {
  readonly root: IrGeometry
  readonly nodes: readonly IrGeometry[]
  readonly source: { readonly path?: string; readonly openscadVersion?: string }
  readonly tessellation: TessellationParams
  // ── 新增 ──
  readonly moduleDefs: readonly IrModuleDef[]
  readonly functionDefs: readonly IrFunctionDef[]
  /** 顶层变量赋值（`x = 10;` 等），在 module/function 之前声明。 */
  readonly topBindings: readonly { name: string; value: IrExpr }[]
}
```

## 3. lowerScad：ScadAST → 结构化 IR

新建 `src/ir/lower-scad.ts`，核心函数：

```typescript
export function lowerScad(doc: ScadDocument, options?: LowerOptions): LowerResult
```

### 3.1 处理流程

```
ScadDocument.statements
  ├─ AssignmentStmt  → topBindings（表达式 lower 为 IrExpr）
  ├─ FunctionDefStmt → functionDefs（参数 + body → IrFunctionDef）
  ├─ ModuleDefStmt   → moduleDefs（参数 + body → IrModuleDef）
  ├─ ModuleInstStmt  → root（内置 module → 几何 IR；用户 module → IrModuleCall）
  ├─ IfStmt          → IrIf
  └─ UseStmt/IncludeStmt → 递归加载 + 合并
```

### 3.2 表达式 lower：ScadAST Expr → IrExpr

| ScadAST | IrExpr | emitter 输出 |
|---------|--------|-------------|
| `LiteralExpr(number)` | `{kind:'num', value}` | `1.5` |
| `LiteralExpr(string)` | `{kind:'str', value}` | `"hello"` |
| `LookupExpr(name)` | `{kind:'var', name}` | `x` |
| `BinaryExpr(op, l, r)` | `{kind:'binary', op, l, r}` | `l + r` |
| `UnaryExpr(op, e)` | `{kind:'unary', op, e}` | `-e` |
| `TernaryExpr(c,t,e)` | `{kind:'ternary', c, t, e}` | `c ? t : e` |
| `FunctionCallExpr(f, args)` | `{kind:'call', f, args}` | `f(args)` |
| `VectorExpr(elements)` | `{kind:'vector', elements}` | `[a, b, c]` |
| `RangeExpr(s,e,step)` | `{kind:'range', s, e, step}` | （不直接输出，用于 for） |
| `BinaryExpr('*', matrix...)` | `{kind:'matrixMul', [...]}` | `matMul(m1, m2)` |

### 3.3 内置 module 映射

内置 module（cube/sphere/cylinder/square/circle/union/difference/intersection/multmatrix/color/linear_extrude/rotate_extrude/translate/rotate/scale）直接复用现有 `lowerCsg` 的映射逻辑——参数从 ScadAST 表达式**求值**（常量折叠）后传入，与 CSG 路径一致。

用户自定义 module → `IrModuleCall`，emitter 发射函数调用。

### 3.4 for 循环 lower

```scad
for(i=[0:3], j=i*2) cube([i, j, 1]);
```
→
```typescript
IrForLoop {
  iterators: [
    { varName: 'i', source: IrRange(0, 3) },
    { varName: 'j', source: IrExpr(binary, '*', var('i'), num(2)) }
  ],
  body: [IrBox{...}]
}
```

### 3.5 递归 module lower

```scad
module tree(length, thickness, count, m, r) {
  color([0, 1-count/10, 0]) multmatrix(m) square([thickness, length]);
  if (count > 0) {
    tree(rnd(0.6,0.8,r)*length, 0.8*thickness, count-1, ...);
    tree(...);
  }
}
```
→
```typescript
IrModuleDef {
  name: 'tree',
  params: [{name:'length'}, {name:'thickness'}, {name:'count'}, {name:'m'}, {name:'r'}],
  body: [
    IrColor { child: IrTransform { child: IrRect2D{...} } },
    IrIf {
      cond: IrExpr(binary, '>', var('count'), num(0)),
      then: [
        IrModuleCall { functionName: 'tree', args: [...] },
        IrModuleCall { functionName: 'tree', args: [...] }
      ]
    }
  ]
}
```

## 4. emitter 扩展

### 4.1 module/function 声明发射

```javascript
// IrFunctionDef → JS function
function rnd(s, e, r) { return random[r % rcnt] * (e - s) + s; }
function mt(x, y) { return [[1,0,0,x],[0,1,0,y],[0,0,1,0],[0,0,0,1]]; }
function mr(a) { return [[Math.cos(a),-Math.sin(a),0,0],[Math.sin(a),Math.cos(a),0,0],[0,0,1,0],[0,0,0,1]]; }

// IrModuleDef → JS async function（返回 Shape）
async function tree(cad, length, thickness, count, m, r) {
  const part0 = cad.rect2d(thickness * MM, length * MM).applyMatrix(m).setColor([0, 1-count/10, 0]);
  let parts = [part0];
  if (count > 0) {
    parts.push(await tree(cad, rnd(0.6,0.8,r)*length, 0.8*thickness, count-1, matMul(m, mt(0,length), mr(rnd(20,35,r+1))), 8*r));
    parts.push(await tree(cad, rnd(0.6,0.8,r+1)*length, 0.8*thickness, count-1, matMul(m, mt(0,length), mr(-rnd(20,35,r+3))), 8*r+4));
  }
  return cad.union(...parts);
}
```

### 4.2 for 循环发射

```javascript
// IrForLoop → JS for + 数组收集
const parts = [];
for (let i = 0; i <= 3; i++) {
  const j = i * 2;
  parts.push(cad.box(i * MM, j * MM, 1 * MM));
}
const result = cad.union(...parts);
```

### 4.3 if 发射

```javascript
// IrIf → JS if
let parts = [];
if (count > 0) {
  parts.push(await tree(cad, ...));
}
```

### 4.4 表达式发射

大部分 OpenSCAD 表达式与 JS 语法一致，直接映射：

| OpenSCAD | JS | 备注 |
|----------|-----|------|
| `a + b` | `a + b` | 直接 |
| `a * b`（标量） | `a * b` | 直接 |
| `m * n`（矩阵） | `matMul(m, n)` | 需 helper |
| `sin(x)` | `Math.sin(x)` | 内置函数映射 |
| `rands(0,1,n,seed)` | `rands(0,1,n,seed)` | 需 helper（确定性随机） |
| `len(v)` | `v.length` | |
| `concat(a,b)` | `[...a, ...b]` | |
| `v[i]` | `v[i]` | 直接 |

### 4.5 helper 函数

emitter 在生成物头部注入需要的 helper：

- `matMul(...matrices)` — 4×4 矩阵连乘
- `rands(min, max, count, seed)` — 确定性伪随机（与 OpenSCAD `rands` 一致）
- `MM` / `RADIAN` — 已有

## 5. 分阶段实施

### Phase 1：基础控制流 + 表达式（覆盖 ~60% examples）

- [ ] `IrExpr` 类型定义 + `lowerExpr`（ScadAST Expr → IrExpr）
- [ ] `IrForLoop` / `IrIf` / `IrLet` 节点
- [ ] `lowerScad` 处理 AssignmentStmt / IfStmt / for 循环 / 内置 module
- [ ] emitter 发射 for / if / let + 表达式
- [ ] helper 注入（matMul、内置函数映射）
- [ ] 测试：简单 for 循环 example（如 `example004.scad`）

### Phase 2：递归 module + 用户函数（覆盖 ~85% examples）

- [ ] `IrModuleDef` / `IrFunctionDef` / `IrModuleCall` 节点
- [ ] `lowerScad` 处理 ModuleDefStmt / FunctionDefStmt / 用户 module 调用
- [ ] emitter 发射 async function 声明 + 递归调用
- [ ] `rands` helper（确定性随机）
- [ ] 测试：`module_recursion.scad`（8189 → ~20 行）

### Phase 3：高级特性（覆盖 ~95% examples）

- [ ] `children()` 映射（回调函数）
- [ ] `intersection_for` → for + intersection
- [ ] 列表推导式（lcfor/lclet/lcif/lceach）→ JS 数组方法
- [ ] `use` / `include` 跨文件
- [ ] 特殊变量 `$fn` / `$fa` / `$fs` / `$t`
- [ ] 测试：全部 50 个官方 examples

### Phase 4：接入主 pipeline + 对账

- [ ] `transpile` 命令增加 `--structured` 选项走 `lowerScad` 路径
- [ ] parity runner 对结构化输出做几何对账（与展开路径结果一致）
- [ ] 决定默认路径（结构化 vs 展开）

## 6. 关键设计决策

### 6.1 为什么不直接在 emitter 里做 AST → JS？

`lowerScad` 保留 IR 中间层，原因：
1. **诊断**：lower 阶段做维度推断、能力分类、参数校验，产出诊断（与 `lowerCsg` 一致）
2. **对账**：结构化 IR 可与展开 IR 做语义等价验证
3. **emitter 纯净**：emitter 只做 IR → 字符串，不做语义判断

### 6.2 为什么 module 发射为 async function？

faijs 的 `cad.union` / `cad.box` 等返回 Promise（async runtime）。递归 module 调用需要 `await`，因此函数声明为 `async`。

### 6.3 常量折叠 vs 保留表达式

- **常量表达式**（如 `1 + 2`、`sin(30)`）：lower 时直接求值，emitter 输出数字字面量
- **变量依赖表达式**（如 `i * 2`、`rnd(0.6, 0.8, r) * length`）：保留为 `IrExpr`，emitter 输出 JS 表达式
- 判定标准：表达式内是否引用了循环变量 / module 参数 / 顶层变量

### 6.4 for 循环体合并

OpenSCAD `for` 的语义是"每次迭代产出的几何 union 合并"。emitter 发射为数组收集 + `cad.union(...parts)`。空迭代 → 空数组 → `cad.union()` → 空几何（与 OpenSCAD 一致）。

### 6.5 与展开路径的关系

- 展开路径（`lowerCsg`）**保留**：作为对账 golden、fallback、和 `--no-structured` 选项
- 结构化路径（`lowerScad`）是**新增**，不修改现有 CSG 路径任何代码
- 两条路径共享 IR 几何节点类型（`IrBox` / `IrSphere` / ... ），只是控制流节点是结构化路径独有

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `rands()` 确定性随机与 OpenSCAD 不一致 | 复用 `src/scad/evaluator.ts` 已有的 rands 实现，提取为共享 helper |
| 矩阵乘法精度差异 | `matMul` helper 用与 OpenSCAD 相同的行主序连乘 |
| 递归深度过大导致 JS 栈溢出 | faijs async runtime 本身有深度限制；OpenSCAD 也有递归深度限制 |
| 某些 OpenSCAD 特性无 JS 等价（如 `children()` 带 `$children`） | Phase 3 处理；不支持时 fallback 到展开路径 |
| 结构化输出与展开输出几何不等价 | Phase 4 对账验证；不等价时报诊断 |

## 8. 预期收益

- `module_recursion.scad`：8189 条语句 → ~20 行递归函数，无需容器化
- 所有含 for/递归的 example：输出体积大幅缩小，可读性提升
- faijs 5000 语句上限不再是瓶颈
- 为未来直接解析 `.scad`（去掉外部 OpenSCAD 二进制依赖）铺路