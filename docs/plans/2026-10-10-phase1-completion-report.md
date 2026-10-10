# Phase 1 完成报告：text op + load op

> 日期：2026-10-10
> 状态：**已完成**
> 提交：`354df07` (方案) → `38cba2b` (text op) → `7021a93` (load op)

---

## 1. 结果总览

| 指标 | Phase 1 前 | Phase 1 后 | 变化 |
|------|-----------|-----------|------|
| PASS | 6 | 6 | — |
| PASS-NT | 4 | 8 | +4 |
| FAIL | 15 | 23 | +8 |
| ERROR | 25 | 13 | **−12** |
| 总计 | 50 | 50 | — |

**ERROR 从 25 降至 13，减少 12 个。** 其中 4 个转为 PASS-NT（2D 文本无 3D 输出），8 个转为 FAIL（执行成功但度量不匹配，留待 Phase 2 三角化密度对齐）。

---

## 2. text op 实现总结

### 2.1 做了什么

1. **创建 `packages/ext/src/ops/font-loader.ts`**：Node 环境 FontLoader，将 OpenSCAD 的 "Liberation Sans" 映射到系统 DejaVu Sans 字体
2. **重写 `packages/ext/src/ops/text.ts`**：调用 faijs 的 `textBlueprints(kernel, text, opts)` 获取 OCCT wire 数组，再 `makeFace` + `fuseAll` 合并为 2D shape
3. **修复 opentype.js GSUB 兼容性**：opentype.js 1.x 不支持 lookupType 6 format 2（chaining contextual extension substitution），通过 override `font.stringToGlyphIndexes` 跳过 GSUB 特性应用（OpenSCAD 本身也不应用 OpenType 特性）
4. **更新 `packages/ext/src/namespace.ts`**：`text` 返回类型从 `Promise<never>` 改为 `Promise<ShapeHandle>`

### 2.2 影响的 10 个例子

| 例子 | Phase 1 前 | Phase 1 后 | 说明 |
|------|-----------|-----------|------|
| Advanced/children.scad | ERROR | PASS-NT | 2D 文本，无 3D 输出 |
| Advanced/children_indexed.scad | ERROR | PASS-NT | 2D 文本 |
| Basics/logo_and_text.scad | ERROR | FAIL | 执行成功，度量不匹配 |
| Basics/rotate_extrude.scad | ERROR | FAIL | 执行成功，度量不匹配 |
| Functions/polygon_areas.scad | ERROR | PASS-NT | 2D 文本 |
| Functions/recursion.scad | ERROR | FAIL | 执行成功，度量不匹配 |
| Parametric/sign.scad | ERROR | FAIL | 执行成功，度量不匹配 |
| Basics/LetterBlock.scad | ERROR | FAIL | 执行成功，度量不匹配 |
| Basics/text_on_cube.scad | ERROR | FAIL | 执行成功，度量不匹配 |
| Advanced/GEB.scad | ERROR (text) | ERROR (offset2d) | text 已修复，但遇到 offset2d bug |

---

## 3. load op 实现总结

### 3.1 做了什么

1. **重写 `packages/ext/src/ops/load.ts`**：
   - STL：`fs.readFileSync` → `kernel.importStl(data)` → 3D ShapeHandle
   - DXF：解析 LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE 实体 → OCCT wires → makeFace → 2D ShapeHandle
   - STEP：`kernel.importStep(data)` → 3D ShapeHandle
2. **LINE 段连接**：DXF 文件中闭合轮廓由独立 LINE 实体组成，通过端点匹配将它们连接为闭合 wire
3. **文件路径解析**：`setLoadBaseDir()` 设置基础目录，parity runner 在执行每个脚本前调用
4. **更新 `tests/run-parity.ts`**：导入 `setLoadBaseDir`，在执行前设置路径

### 3.2 影响的 8 个例子

| 例子 | Phase 1 前 | Phase 1 后 | 说明 |
|------|-----------|-----------|------|
| Old/example007.scad | ERROR (load) | FAIL | DXF 加载成功，度量不匹配 |
| Old/example008.scad | ERROR (load) | FAIL | DXF 加载成功，度量不匹配 |
| Old/example015.scad | ERROR (load) | FAIL | DXF 加载成功，度量不匹配 |
| Old/example009.scad | ERROR (load) | ERROR (twistExtrude) | load 已修复，遇到 twistExtrude bug |
| Old/example012.scad | ERROR (load) | ERROR (subtract) | load 已修复，遇到 boolean subtract bug |
| Old/example016.scad | ERROR (load) | ERROR (subtract) | load 已修复，遇到 boolean subtract bug |
| Basics/projection.scad | ERROR (load) | ERROR (projectOutline) | load 已修复，遇到 projection bug |
| Old/example013.scad | ERROR (load) | ERROR (load) | INSERT/block-reference 实体未支持 |

---

## 4. 剩余 13 个 ERROR

| # | 例子 | 错误 | 根因 | 修复方 |
|---|------|------|------|--------|
| 1 | Advanced/GEB.scad | offset2d | 近零 delta 处理缺陷 | ext 库 |
| 2 | Advanced/offset.scad | offset2d | 近零 delta 处理缺陷 | ext 库 |
| 3 | Advanced/animation.scad | applyMatrix | kernel transform 失败 | ext 库 |
| 4 | Advanced/surface_image.scad | surface ENOENT | surface_image.png 缺失 | fixture |
| 5 | Old/example010.scad | surface ENOENT | example010.dat 缺失 | fixture |
| 6 | Old/example009.scad | twistExtrude | OCCT sweepFull bug | ext 库 |
| 7 | Old/example020.scad | twistExtrude | OCCT sweepFull bug | ext 库 |
| 8 | Old/example011.scad | polyhedron | BRep wire 构造失败 | ext 库 |
| 9 | Old/example012.scad | subtract | boolean cut 失败 | ext 库 |
| 10 | Old/example013.scad | load (DXF) | INSERT/block-reference 未支持 | ext 库 |
| 11 | Old/example016.scad | subtract | boolean cut 失败 | ext 库 |
| 12 | Basics/projection.scad | projectOutline | makeFace 构造失败 | ext 库 |
| 13 | Basics/linear_extrude.scad | CRASH SKIP | twistExtrude segfault | ext 库 |

---

## 5. Phase 2 展望

Phase 1 解锁了 12 个 ERROR，其中 8 个转为 FAIL（执行成功但三角化密度不匹配）。
Phase 2 的核心任务是三角化密度对齐，将 FAIL 转为 PASS。

当前 FAIL=23 中：
- 15 个是 Phase 1 之前就存在的 FAIL（三角化密度问题）
- 8 个是 Phase 1 新增的 FAIL（text/load 解锁后发现的密度问题）

Phase 2 需要实现 per-primitive deflection 自适应，使 faijs 的三角化密度与 OpenSCAD 的 $fa/$fs/$fn 语义对齐。
