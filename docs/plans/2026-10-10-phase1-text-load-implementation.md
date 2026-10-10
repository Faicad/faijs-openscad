# Phase 1 实现方案：text op + load op

> 日期：2026-10-10
> 目标：解锁 25 个 ERROR 中的 18 个（10 text + 8 load）
> 前置文档：`2026-10-10-progress-summary-and-roadmap.md`

---

## 1. 背景与现状

### 1.1 当前 parity 状态

```
PASS: 6 | PASS-NT: 4 | FAIL: 15 | ERROR: 25 | Total: 50
```

### 1.2 25 个 ERROR 根因分布

| 根因 | 数量 | 当前状态 |
|------|------|----------|
| `openscad.text()` stub 抛错 | 10 | ext 库 `ops/text.ts` 是 stub |
| `openscad.load()` stub 抛错 | 8 | ext 库 `ops/load.ts` 是 stub |
| surface 数据文件缺失 | 2 | fixture 缺 .png/.dat |
| twistExtrude sweepFull 崩溃 | 1 | OCCT sweep bug |
| polyhedron wire 构造失败 | 1 | BRep wire bug |
| applyMatrix 变换失败 | 1 | kernel transform bug |
| offset2d 零 delta 失败 | 1 | 近零 delta 处理缺陷 |

### 1.3 关键发现：faijs 已内置 text + import 能力

调研发现 `@faicad/faijs@0.31.1` 已包含完整的字体渲染管线和 STL 导入能力：

**字体渲染（`@faicad/faijs/brep/text/`）：**
- `fontRegistry.ts`：`loadFont(data: ArrayBuffer, fontFamily?)`、`setFontLoader(loader)`、`ensureFont(nameOrPath?)`
- `text-to-solid.ts`：`textBlueprints(kernel, text, { fontSize, fontFamily })` → `BrepHandle[]`（wire 数组）
- `opentype.js@1.3.5` 已作为传递依赖安装

**STL 导入（OCCT kernel）：**
- `kernel.importStl(data: string | ArrayBuffer)` → `ShapeHandle`（3D solid）

**系统字体：**
- `/usr/share/fonts/dejavu/DejaVuSans.ttf` 可用（替代 OpenSCAD 默认的 Liberation Sans）

---

## 2. 实现方案：text op（K02）

### 2.1 架构

```
OpenSCAD text("Hello", size=10, font="Liberation Sans")
  ↓ lower.ts (CSG path)
IR: exprCall { method: 'openscad.text', args: ['Hello', { size: 10, font: 'Liberation Sans' }] }
  ↓ emitter
faijs: await openscad.text('Hello', { size: 10, font: 'Liberation Sans' })
  ↓ parity runner wrapper
ext: text('Hello', { size: 10, font: 'Liberation Sans' })
  ↓ ops/text.ts (NEW)
  ├→ setFontLoader(nodeFontLoader)     // 注入 Node fs FontLoader
  ├→ ensureFont('Liberation Sans')     // 解析字体名 → 回退 DejaVu Sans
  ├→ textBlueprints(kernel, 'Hello', { fontSize: 10, fontFamily: 'default' })
  │    → BrepHandle[] (wires)          // 每个闭合轮廓一个 wire
  ├→ for each wire: kernel.makeFace(wire) → BrepHandle (face)
  └→ kernel.fuse(face1, face2, ...)    // 合并为单个 2D shape
     → ShapeHandle
```

### 2.2 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `packages/ext/src/ops/text.ts` | 重写：调用 faijs `textBlueprints` + `makeFace` + `fuse` |
| `packages/ext/src/namespace.ts` | `text` 返回类型 `Promise<never>` → `Promise<ShapeHandle>` |
| `packages/ext/src/ops/font-loader.ts` | 新建：Node 环境 FontLoader 实现 |

### 2.3 字体名映射策略

OpenSCAD 默认字体是 "Liberation Sans"，系统上没有 Liberation 字体。
策略：FontLoader 的 `resolveFont(name)` 方法做映射：

| OpenSCAD 字体名 | 映射到 | 系统路径 |
|----------------|--------|----------|
| `Liberation Sans` / `Liberation Sans:style=Regular` | DejaVu Sans | `/usr/share/fonts/dejavu/DejaVuSans.ttf` |
| `Liberation Serif` | DejaVu Serif | `/usr/share/fonts/dejavu/DejaVuSerif.ttf` |
| `Liberation Mono` | DejaVu Sans Mono | `/usr/share/fonts/dejavu/DejaVuSansMono.ttf` |
| 其它 | DejaVu Sans（回退） | `/usr/share/fonts/dejavu/DejaVuSans.ttf` |

### 2.4 textBlueprints 返回值处理

`textBlueprints(kernel, text, opts)` 返回 `BrepHandle[]`，每个是一个闭合 wire。
需要：
1. 对每个 wire 调用 `kernel.makeFace(wire)` 转为 face
2. 将所有 face 用 `kernel.fuse()` 合并为单个 compound
3. 如果只有一个 wire，直接 `makeFace` 返回

### 2.5 验收标准

- 10 个 text ERROR 变为 PASS 或 FAIL（不再 ERROR）
- `openscad.text("Hello")` 能返回有效的 2D ShapeHandle
- 后续 `linear_extrude(text("Hello"))` 能正常工作

---

## 3. 实现方案：load op（K03）

### 3.1 架构

```
OpenSCAD import("example.stl")
  ↓ lower.ts (CSG path)
IR: exprCall { method: 'openscad.load', args: [{ file: 'example.stl' }] }
  ↓ emitter
faijs: await openscad.load({ file: 'example.stl' })
  ↓ parity runner wrapper
ext: load({ file: 'example.stl' })
  ↓ ops/load.ts (NEW)
  ├→ resolveFilePath(file)             // 相对于 CSG 文件目录解析
  ├→ fs.readFileSync(path)             // 读取文件
  ├→ if .stl: kernel.importStl(data)   // → 3D ShapeHandle
  └→ if .dxf: parseDXF(data)           // → 2D wires → makeFace
     → ShapeHandle
```

### 3.2 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `packages/ext/src/ops/load.ts` | 重写：STL 用 `kernel.importStl`，DXF 用解析器 |
| `packages/ext/src/namespace.ts` | `load` 返回类型 `Promise<never>` → `Promise<ShapeHandle>` |
| `packages/ext/src/ops/dxf-parser.ts` | 新建：简易 DXF 解析器（提取 LINE/POLYLINE/CIRCLE/ARC 实体） |

### 3.3 文件路径解析

OpenSCAD 的 `import()` 文件路径相对于 `.scad` 源文件目录。
在 parity runner 中，CSG 文件位于 `tests/fixtures/openscad-examples/csg/`，
对应的 STL/DXF 文件位于 `tests/fixtures/openscad-examples/` 根目录或子目录。

策略：
- 设置一个全局的 `baseDir` 变量，由 parity runner 在执行前设置
- `load()` 用 `path.resolve(baseDir, file)` 解析完整路径
- 如果文件不存在，尝试在 fixture 根目录下递归查找

### 3.4 STL 导入

直接使用 OCCT kernel 的 `importStl(data)` 方法：
```typescript
const data = fs.readFileSync(filePath)
const shape = kernel.importStl(data)
return shape
```

### 3.5 DXF 解析

DXF 是文本格式，包含 2D 几何实体。OpenSCAD 的 `import()` 对 DXF 提取 2D 轮廓。
需要解析的 DXF 实体类型：
- `LINE`：两点 → `kernel.makeLineEdge(p1, p2)`
- `POLYLINE` / `LWPOLYLINE`：多段线 → 逐段 `makeLineEdge` → `makeWire`
- `CIRCLE`：圆 → `kernel.makeCircleEdge(center, radius)` 或近似多段线
- `ARC`：圆弧 → `kernel.makeArcEdge(center, radius, startAngle, endAngle)`

解析后：
1. 将所有实体转为 wire
2. 对每个 wire 调用 `makeFace` 转 face
3. `fuse` 合并为单个 2D shape

### 3.6 验收标准

- 8 个 load ERROR 变为 PASS 或 FAIL（不再 ERROR）
- STL 导入返回有效 3D ShapeHandle
- DXF 导入返回有效 2D ShapeHandle

---

## 4. 实施步骤

### Step 1: 提交本方案文档
- `git add docs/plans/2026-10-10-phase1-text-load-implementation.md`
- `git commit -m "docs: Phase 1 implementation plan — text op + load op"`
- `git push origin main`

### Step 2: 实现 text op
- 创建 `packages/ext/src/ops/font-loader.ts`（Node FontLoader）
- 重写 `packages/ext/src/ops/text.ts`（调用 faijs textBlueprints）
- 更新 `packages/ext/src/namespace.ts`（类型签名）
- 运行 parity 测试验证 10 个 text ERROR 是否消除
- `git commit + push`

### Step 3: 实现 load op（STL）
- 重写 `packages/ext/src/ops/load.ts`（STL 导入）
- 更新 `packages/ext/src/namespace.ts`（类型签名）
- 运行 parity 测试验证 STL 导入
- `git commit + push`

### Step 4: 实现 load op（DXF）
- 创建 `packages/ext/src/ops/dxf-parser.ts`（DXF 解析器）
- 更新 `packages/ext/src/ops/load.ts`（集成 DXF 路径）
- 运行 parity 测试验证 DXF 导入
- `git commit + push`

### Step 5: 全量 parity 重跑
- 运行完整 parity 测试
- 记录新的 ERROR/FAIL/PASS 分布
- 更新进度文档
- `git commit + push`

---

## 5. 预期结果

| 指标 | 当前 | 预期（Phase 1 完成后） |
|------|------|----------------------|
| ERROR | 25 | 7（去除 10 text + 8 load） |
| FAIL | 15 | 15~33（新解锁的例子可能因密度问题 FAIL） |
| PASS + PASS-NT | 10 | 10~28 |

> 注：解锁的 18 个例子中，部分可能直接 PASS，部分可能因三角化密度问题转为 FAIL。
> FAIL 的修复属于 Phase 2（三角化密度对齐）。
