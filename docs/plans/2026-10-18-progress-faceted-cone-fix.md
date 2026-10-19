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

## 7. 残余 10 个 FAIL 的分类（下一步）

| 类别 | 例子 | 说明 |
|---|---|---|
| **已知 OpenSCAD 文字缩放**（不上游复现） | `Advanced/children`、`children_indexed`、`Basics/LetterBlock`、`Basics/text_on_cube`、`Basics/rotate_extrude`、`Parametric/sign` | 我们 149.5mm vs OpenSCAD 203.0mm，即 1/1.3581；差异可命名、可量化（见字体调查 §8.3）。若要消灾只能在**对账层**加兼容开关 |
| **hull/projection op 脆弱性** | `Basics/hull`（**已修 → PASS**）、`Old/example006`（仍 FAIL，见下） | hull 凸包算法已重写（见 §8.5）；`projection` 两例仍为内核 ERROR |
| **刻面密度 /  revolve** | `Functions/functions`、`Old/example017`、`Old/example021` | 多为 `$fn` 推定差异导致的三角密度与体积累积差 |

> 注：上方"已知 OpenSCAD 文字缩放"6 例已在 parity 报告层加 `knownDifference`
> 标注（FAIL ⚠ + 独立 "Known Differences" 章节），严格判定仍为 FAIL，仅作
> 标注、不动库。详见字体调查 §9 第 6 项（2026-10-18 完成）。

10 个 ERROR 全是 op 层内核失败（offset2d / applyMatrix / boolean / projectCut /
projectOutline / revolve / twistExtrude ×2 + 2 个已知 segfault 跳过项），
**已无任何字体相关错误**。

### 7.1 hull 进展（2026-10-18）

重写 `convexHull3D` 后（见 §8.5）：

| 例 | 修复前 | 修复后 |
|---|---|---|
| `Basics/hull` | FAIL | **PASS**（volΔ 1.7285，IoU 0.999948） |
| `Old/example006` | vol 2124，IoU 0.000067（几何完全错） | vol 927 407，IoU 0.998507（**仍 FAIL**，差 0.33%） |

全量 parity：FAIL 11 → **FAIL 10**（PASS 21 → 22），逐例对比**零回归**。
`example006` 剩下的 0.33% 来自"内接多面体 vs OpenSCAD 粗刻面"的系统差
（我们的圆角立方 970 564 vs 解析值 975 587；被减去的 21 个球同样偏小），
与"刻面密度"类同源，非 hull 算法问题。

### 7.2 圆角 idiom 改 BREP fillet（2026-10-19）

用户目检候选 STL 发现 `example006` 的圆角是"点采样凸包"模拟出来的：多边形边过大、
明显三角面片、圆角平行线发歪。按用户建议，`hull.ts` 识别经典 `rounded_cube` idiom——
**8 个等半径球的球心正好是轴对齐立方体的 8 个角**——改用真正的 BREP 倒圆角
（`makeBoxFromCorners` + `fillet` 全部 12 条边，半径 = 球半径）生成圆角立方体；
不匹配该 idiom 时回退到原来的点采样凸包路径。

**效果**：圆角变形/巨三角形彻底消除（候选 maxEdge 113 → 80，曲面细分规整）。

**但用户随后目检发现新 bug：骰子 6 面中第 5 面（-X 面）的 5 个凹坑整体丢失**
（12346 面正常）。最终定位为 idiom 的**几何不精确**，而非网格伪影：

| 量 | 修复前（runtime idiom 产出） | 修复后 |
|---|---|---|
| 圆角立方体积 | 976 223.663（解析 975 587.0，偏 +636） | **975 587.0747**（精确到 1e-4） |
| 各面位置 | x[-49.999973, +50.023285]、y/z=±50.011629 | **严格 ±50**（1e-6） |
| fillet 半径 | 10.0116 | **10** |
| 骰子 OCCT 实体 | 942 618.6（-X 面 5 坑被静默丢弃） | **931 604.7167**（21 坑齐全，仅高参照 0.12%） |

**根因**：运行时创建的球，其 `getBoundingBox(s, true)`（**三角化** bbox，注意
`true` = use triangulation）是不对称的——球在 (10,10,10) r=10，三角化 bbox 中心
x=10.0117（偏 +0.0117），而 `getBoundingBox(s, false)`（精确 BREP bbox）给出精确
[0,20]³。idiom 用三角化 bbox 中心当球心 → 圆角立方整体偏移 0.0116、fillet 半径
涨到 10.0116；而 21 个坑球是**精确**的（r=10.000000、球心精确）→ -X 面位于
-49.999973 而球心在 -50，错配 2.7e-5 → OCCT 的 cut 对那 5 个球**静默空操作**
（链式裁剪逐步 trace：第 10–14 步 Δ≈0）。

**排除的假因**（均有对照实验）：fuzzyValue 状态泄漏（无 fuzzy 仍错）、进程内首个
cut 的 warm-up（干净隔离下首切即错）、compound 工具特有（链式单工具同样错）、
union 侧问题（union 完整 21 solids）。对照组：手工精确几何（box [-50,50]³ +
fillet r=10 + `makeSphere(10)+translate`）→ 21 个 cut 全部成功、零空操作。

**修复**（`hull.ts` 两处，均有代码注释）：
- 球心改取 `getBoundingBox(s, false)`（**精确** BREP bbox，三角化 bbox 仅作兜底）；
- 半径改取**精确 bbox 半宽**（先用"采样点到该球心的最大距离"做 1e-3 相对校验，
  防止把非球体误判成球），替代原先无校验的"采样最大距离"（float32 下偏 1.1e-6，
  同样足以击穿 cut）。

**残余 FAIL 的性质**：修复后候选网格 vol 931 803.67（参照 930 475.79，Δ=0.143%）、
IoU 0.997809。偏差全部来自参照本身——OpenSCAD 用 8 球 hull 出的是**内接刻面**
圆角立方（bbox 100×99.8904²，比候选的精确 100³ 小 0.11%），这是"光滑 BREP vs
刻面 hull"的结构性偏差，与 §7 的刻面密度类同源。已按既有惯例为
`Old/example006.scad` 加 `knownDifference` 标注（不改判定，其余 9 条同类同样处理）。
用户目检确认："其实我们的圆角实现质量更好"。

**回归保护**：新增 `tests/hull-rounded-box.test.ts`——8 角球 hull 后断言圆角立方
bbox 严格 ±50、体积 = 解析 975 587.0、fillet 半径 10、以及**减 21 个坑球后 21 坑
齐全**（探针实测实体 vs 坑球相交体积）。已反向验证：把两处修复分别还原，测试立即
失败（半径偏差 1.24e-6 即被捕获）。

**idiom 检测踩过的坑**（都很隐蔽，均已在代码注释记录）：
- 球面细分点的**质心**偏离真实球心 ~3%（OCCT 球面细分不对称）→ 等距判断全挂；
- `getBoundingBox(shape, true)` 是**三角化** bbox，对光滑面会膨胀/不对称
  （实测 +0.0117 偏移）→ 球心必须用 `false`（精确几何 bbox）；
- bbox 半宽与真实采样半径可能相差一个细分 gap → 半径取精确半宽，但要用
  "采样点到精确球心的最大距离"做 1e-3 相对校验；
- 绝对容差被 float32 + 球心亚百分比偏移击穿 → 改**相对散布度**判据
  （球 ~0.2%，盒 ~42%，圆柱跨轴向；scale-free 且能区分球/盒/圆柱）。

## 8. 顺带发现的小瑕疵（已修，2026-10-18）

`tests/run-parity.ts` 里 `CRASH_SKIP` 分支 push 的 entry 没带 `name`
（日志里显示为 `undefined`），报告中这两行缺少来源文件名。属报告可读性问题。

**修复**：`CRASH_SKIP` 分支改为与同文件其它 ERROR 分支一致的显式字段
`name: entry.source` + `hasFacetedPrimitives: false` + `stepExport: 'n/a'`
（原 `...entry` 展开不含 `name`）。报告里两行 `undefined` 已消失，正确显示
`Basics/linear_extrude.scad` / `Old/example010.scad`。

## 8.5 hull 凸包算法重写（2026-10-18）

`packages/ext/src/ops/convex-hull-3d.ts` 与 `.../hull.ts`。occt-wasm 不暴露
convexHull，只能自己实现。定位过程中挖出 **5 个各自独立的缺陷**，每个都静默
产生错误结果而非报错：

| # | 缺陷 | 症状 | 修复 |
|---|---|---|---|
| 1 | 返回的三角面索引指向**内部去重后**的数组 | 调用方拿自己传入的数组去索引，第一个重复点之后**全部错位**；`hull.ts` 用错误的点建面 → 1109 点只得到体积 151（应 8568） | `keepIdx` 把索引映射回调用方数组 |
| 2 | `faceDist` 用**未归一化**法线 | 平面函数值随三角形面积缩放，同一个容差对大面和小面含义不同，相邻面对"该点是否在外面"判断不一致 | 除以 \|n\|，变成真正的带符号距离 |
| 3 | 容差硬编码 `1e-6` | 点来自 float32 网格，绝对噪声 ~diag·2⁻²³；模型坐标几十时噪声 ~2e-6 **高于**阈值 | 容差按包围盒对角线缩放（diag·1e-6） |
| 4 | 近共面采样点撕裂可见面片 | 球面的"纬度圈"点几乎共面，可见区域不再是单连通片 → 壳破洞，随后**级联爆炸**（697 面期望值变成 167 613） | ① 方向极值播种 ② 剩余点按突出量降序插入 ③ **插入后必须仍是闭合二维流形，否则回滚跳过该点** |
| 5 | `sew`+`makeSolid` 得到**内翻实体**（体积极性为负） | 下游 `difference()` 对该实体失效：`example006` 只剩 2124（应 ~930 476） | 体积为负时 `reverseShape` 转正 |

另在 `hull.ts` 加了采样上限（SAMPLE_CAP=2000）：拓扑顶点全留，只按步长稀释
光滑面采样点。实测该算法在 ~2000 点以内精确可靠，超过则退化；稀释到 1/8 仍得
967 799（解析值 975 587，损失 <1%），且无点落在壳外。

**回归保护**：新增 `tests/convex-hull-3d.test.ts`（7 个用例，含上面 1/2/3/4
的专门断言：索引归属、立方体精确体积、共面纬度圈、远离原点的 float32 球面、
"玩具帆船"复合云、输入顺序无关性）。

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
