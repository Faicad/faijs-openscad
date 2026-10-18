# 2026-10-18 进展：刻面退化圆锥丢失锥尖顶点导致 union 产出空模型（+1 PASS）

> 状态：**已修复并回归保护到位**。全量 parity `PASS 20 → 21`、`FAIL 12 → 11`、**零回归**。
> 触发：在上一步（字体绑定收尾，见
> `2026-10-18-openscad-font-rendering-investigation.md`）之后继续攻残余 FAIL；
> 从 `docs/plans/parity-2026-10-18-font.json` 里挑最刺眼的一条下手。

---

## 1. 现象

```
Old__example005.scad.csg
  candidate: 0 tris, vol=0.0000
  reference: 1042 tris, vol=2233949.5300
  verdict: FAIL (volΔ=2233949.530009, IoU=0.000000)
```

候选**完全为空**——不是尺寸差，是几何根本没生成。这是 12 个 FAIL 里唯一一个
IoU=0 的，优先级最高。

## 2. 定位

逐段跑（`tests/tmp-probe-example005.ts`，已清理）：

| 子结构 | 结果 |
|---|---|
| `openscad.cylinder(100,50)` | 120 tris ✓ |
| `openscad.cone(120,0,80)` | **30 tris ✗**（应为 60：N 侧面 + N 底盖） |
| `cad.subtract(...)` | 328 tris ✓ |
| 6 根小圆柱 union | 720 tris ✓ |
| `part21 = __union([part5, part18, part20])` | **0 tris ✗** |

`openscad.cone(r,0,h)` 只剩底盖 → 侧壁被丢掉 → 得到的非法壳参与 `boolean fuse`
→ 整个模型静默产出空壳。

## 3. 根因

`packages/ext/src/ops/faceted-primitives.ts` 的 `oscCylinderGeometry`：

```ts
let topStart = vertices.length       // ← 锥尖顶点从未被 push
if (hasTop) { vertices.push(顶心); ... }   // hasTop=false 时不 push
...
} else if (hasBottom && !hasTop) {
  const apex = topStart              // 越界：== vertices.length
  faces.push([b_i, b_ni, apex])      // 每个侧面引用一个不存在的顶点
}
```

`polyhedron()` 对 `pts[idx] === undefined` 的三角**静默跳过**（既不报错也不计数），
于是 N 个侧面全部消失，只剩 N 个底盖三角。`!hasBottom && hasTop` 分支同理
（`apex = bottomStart = 0`，指向的是顶心）。

**为何一直没被发现**：ext 包此前**没有任何单元测试**（`packages/ext` 下 0 个
`*.test.ts`），只有 parity 端到端指标；而这类"少了一半面”的缺陷在
`Old/example005` 这类"union 后整体为空”的例子上才暴露。

**附带发现（同一函数）**：常规圆柱分支的**两个封盖缠绕也是反的**（法向朝内）。
它之所以没出事，是因为
① 非居中圆柱的底心恰位于原点 → 底盖对 signed volume 的贡献恒为 0；
② OCCT 的 ShapeFix 会在 sewing 时纠正朝向。
但这是一个潜伏 bug：顶点不在原点时（居中体）就是错的。

## 4. 修复

重写 `oscCylinderGeometry`，三条分支统一为**真正闭合、外法向一致**的拓扑：

- 明确的三段式：底盖 → 顶盖 → 侧壁；缺失的一端**显式 push 锥尖顶点**；
- 封盖缠绕改为与侧壁配对正确（底盖 `[bc, b_ni, b_i]` = 外法向 −Z，
  顶盖 `[tc, t_i, t_ni]` = 外法向 +Z）；
- 两侧半径都为 0 的退化输入 → 返回空几何（由 `polyhedron` 产出 null shape）。

## 5. 回归保护（新增，此前为零）

`tests/parity/faceted-primitives.test.ts`（7 个用例，纯几何计算，无需 wasm）：

1. **所有面索引在范围内**（杜绝"静默丢面”）；
2. **闭合有向 2-流形**：每条有向边恰好用一次，且必有反向孪生边（杜绝"开口壳”）；
3. **signed volume 与解析公式吻合**（内接 n 边形柱/锥/棱台体积）。

覆盖：圆柱、上锥尖锥、下锥尖锥、棱台、居中体、完全退化、以及刻面球的
"平顶封盖 z=±r·cos(π/n)”性质。

## 6. 结果

| 项 | 修复前 | 修复后 |
|---|---|---|
| `openscad.cone(120,0,80)` | 30 tris（只有底盖） | **60 tris**，体积=解析值 |
| `Old/example005` union | 0 tris | **2152 tris** |
| `Old/example005` verdict | FAIL（IoU 0） | **PASS**（volΔ 1.36，IoU 0.999997，centroid 3.2e-5） |
| 全量 parity | PASS 20 / FAIL 12 / ERROR 10 | **PASS 21 / FAIL 11 / ERROR 10**（逐例对比零回归） |
| 新单测 | — | 7/7 通过 |

---

## 7. 残余 11 个 FAIL 的分类（下一步）

| 类别 | 例子 | 说明 |
|---|---|---|
| **已知 OpenSCAD 文字缩放**（不上游复现） | `Advanced/children`、`children_indexed`、`Basics/LetterBlock`、`Basics/text_on_cube`、`Basics/rotate_extrude`、`Parametric/sign` | 我们 149.5mm vs OpenSCAD 203.0mm，即 1/1.3581；差异可命名、可量化（见字体调查 §8.3）。若要消灾只能在**对账层**加兼容开关 |
| **hull/projection op 脆弱性** | `Basics/hull`、`Old/example006` | op 层 |
| **刻面密度 /  revolve** | `Functions/functions`、`Old/example017`、`Old/example021` | 多为 `$fn` 推定差异导致的三角密度与体积累积差 |

10 个 ERROR 全是 op 层内核失败（offset2d / applyMatrix / boolean / projectCut /
projectOutline / revolve / twistExtrude ×2 + 2 个已知 segfault 跳过项），
**已无任何字体相关错误**。

## 8. 顺带发现的小瑕疵（未修）

`tests/run-parity.ts` 里 CRASH_SKIP 分支 push 的 entry 没带 `name`
（日志里显示为 `undefined`），报告中这两行缺少来源文件名。属报告可读性问题。

## 9. 复现命令

```bash
# 三个 UE 都用到的辅助探测脚本（已完成使命，已清理）
npx tsx tests/tmp-probe-example005.ts      # 逐段/逐 part 打印三角数
npx tsx tests/tmp-emit.ts Old__example005.scad.csg   # 打印 emitted .fai.js

# 回归验证
npx vitest run tests/parity/faceted-primitives.test.ts
npx tsx tests/run-parity.ts --only example005
npx tsx tests/run-parity.ts --json docs/plans/parity-2026-10-18-conefix.json --md docs/plans/parity-2026-10-18-conefix.md
```
