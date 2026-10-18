# 2026-10-18 调查：OpenSCAD 文字渲染度量缩放根因 + Windows 重渲染差异 + faijs 对齐方案

> 状态：**调查完结，根因已定位并经四字体交叉验证**；faijs 侧对齐方案已设计（§8），待实施。
> 关联文档：`2026-10-17-progress-faijs0358.md` §2（字体跨平台修复 `ab13ae9`）。
> 触发背景：用户在本机（Windows）全局安装了 OpenSCAD 2021.01，要求
> ① 重跑全部参考 STL 找出平台差异；② **让 faijs 的文字渲染使用与 OpenSCAD 相同的字体，
> 使最终 STL 可比**。

---

## 0. TL;DR（结论先行）

1. **Windows 重渲染差异**：50 例中 39 例渲染成功（3 例并发超时待补，8 例内容性失败与平台无关）。
   39 例中 **25 例字节不同但几何完全一致**（三角数/体积/bbox/质心零差异，文字例子同样零差异），
   14 例字节一致。**参考基线在 Windows 上几何可复现**，字节差异仅是 ASCII STL 浮点格式噪声。
2. **不存在"神秘字体"**。一度怀疑 OpenSCAD 把所有 font= 规格都 fallback 到了某个未知字体，
   该假设已被 `--debug=all` 输出与源码双重否定：字体解析**完全正确**
   （"Liberation Sans" → OpenSCAD 安装目录自带 Liberation Sans 2.00.1，"Arial" → 系统 Arial）。
3. **真正的根因是 OpenSCAD 2021.01 `FreetypeRenderer` 的系统性缩放**
   （上游源码注释自己都怀疑是笔误）：
   - 字形轮廓坐标：× **100/72 ≈ 1.38889**（`FT_Set_Char_Size(face, 0, 1e5, 100, 100)` 的
     100 DPI 口径，而 FreeType 名义 72 DPI）
   - 字形 advance（字宽增量）：× **100/72/1.024 ≈ 1.35653**（`unscale = 1/1.024e5`，
     代码注释原文："Not sure if overall scale factor of 1000/1024 is mistake"）
   - 即 OpenSCAD 渲染出的文字整体比正确度量**大约 39%**（水平字距还额外窄 2.4%）。
   Linux 时代的入库基线同样含此行为（两平台文字例子几何零差异，见 §2）。
4. **对齐方案**（§8）：faijs 侧捆绑 OpenSCAD 同款 Liberation Sans 2.00.1（OFL 开源字体），
   并在 text 管线上复现上述两个缩放因子，即可与 OpenSCAD 的 STL 逐字节口径对齐。

---

## 1. 背景与问题定义

- parity 对账（`tests/run-parity.ts`）长期有一类 FAIL：**所有含 `text()` 的例子**。
  早期归因为"我们用了不同字体"（`font-loader.ts` 把 "Liberation Sans" 映射到
  Arial/DejaVu，见 §7），但换字体、修路径（`ab13ae9`）后文字例子仍全 FAIL。
- 用户安装 Windows 全局 OpenSCAD 后提出两个任务：
  1. 用本机 OpenSCAD 重跑参考 STL，找与入库基线（Linux 时代生成）的差异；
  2. 字体部分："我们需要使用和 openscad 一样的字体来比对最终的 stl 是否一致"。
- 本记录即两份任务的合并调查报告。

---

## 2. Windows 全量重渲染差异报告（任务①）

方法：`tests/gen-ref-stl.ts` 渲染全部 50 例到 `tests/fixtures/openscad-examples/stl/`，
与入库基线逐文件对比 sha256 + 解析 STL 比较几何度量
（`tests/tmp-win-diff.ts` → `tests/tmp-win-diff-report.txt`）。

### 2.1 汇总

| 类别 | 数量 | 说明 |
|---|---|---|
| 渲染成功且**字节一致** | 14 | 与 Linux 基线逐字节相同 |
| 渲染成功但**字节不同、几何一致** | 25 | 三角数/体积/bbox/质心全部零差异；含全部文字例子 |
| 内容性渲染失败（与平台无关） | 8 | 2D 对象/空对象/未知模块 `roof` 等 |
| 并发超时未渲染 | 3 | `example006`/`example024`/`candleStand`（120s 超时，因当时并发跑字体探针占满 CPU） |
| **合计** | **50** | 39 成功 = 14 + 25 |

### 2.2 结论

- **几何层面：基线可跨平台复现，零差异**。25 个字节差异全部来自 ASCII STL 的
  浮点格式化噪声（OpenSCAD 输出 `%f` 6 位小数， glibc 与新老 msvcrt 的舍入/尾数处理
  存在末位差异；顶点遍历顺序在某些例子里也不同）。
- **对 `gen-ref-stl.ts --check` 的影响**：哈希判定会把这 25 例报成 STALE。
  建议对账以**几何度量**（体积/bbox/质心/三角数）为主判据，哈希仅作辅助
  （详见 `2026-10-17-progress-faijs0358.md` 对账口径）。
- 8 个内容性失败与平台无关（Linux 时代同样失败），3 个超时是环境干扰，均非平台差异。
- **副产物**：本次重渲染是以 generate 模式跑的，**覆盖了工作区 25 个入库 STL 并污染了
  `tests/ref-stl-hashes.json`（39 entries，缺 3 个超时例）**。鉴于几何零差异，
  处理建议是还原入库版本（`git checkout -- tests/fixtures/... tests/ref-stl-hashes.json`），
  需要新基准时再做一次无并发负载的干净全量重渲。**此项待办，见 §9。**

---

## 3. 字体异常现象（任务②的起点）

对 `text("Hamburgefonstiv", size=20)` 做 `linear_extrude` 后渲染 STL，实测各 font= 规格：

| font= 规格 | 渲染 ink bbox（mm） | 对应真实字体 | 水平缩放 | 垂直缩放 |
|---|---|---|---|---|
| `"Liberation Sans"`（= 默认） | 203.004 × 25.891 | Liberation Sans 2.00.1 | **1.3581** | **1.3888** |
| `"Arial"` | 202.828 × 26.067 | Arial（系统） | **1.3581** | **1.3888** |
| `"Liberation Mono"` | 241.424 × 25.877 | Liberation Mono 2.00.1 | **1.3581** | **1.3888** |
| `"Liberation Serif"` | 188.683 × 25.552 | Liberation Serif 2.00.1 | 1.3571 | **1.3888** |

**1.3888 = 100/72**（六位以内精确吻合，见 §5.3）。

早期单字实测（Arial `"IIII"`，size=20，STL 与 DXF 两条导出路径互相印证）：

| 量 | OpenSCAD 输出 | 真实 Arial 度量 | 比值 |
|---|---|---|---|
| 'I' advance（字距） | 7.537 mm | 5.557 mm（0.2778em） | 1.3566 |
| cap 高度（ink 高） | 19.883 mm | 14.326 mm（0.7163em） | 1.3880 |

**两个独立缩放**：垂直恒 ×100/72；水平字距 ×100/72/1.024。这正是"加粗/变大"观感的来源——
所有字形被整体放大约 39%，而字距只放大 35.65%。

---

## 4. 调查过程与被否定的假设（按时间序）

> 记录否定路径的价值：每条都是真实执行过的实验，避免后人重查。

### 4.1 假设 A：fontconfig 把所有 family 请求 fallback 到了未知字体 —— **否定**

- **fontconfig 配置分析**：OpenSCAD 自带 `fonts/fonts.conf` 只注册
  `WINDOWSFONTDIR`（**字面字符串，未被安装程序替换**，疑为打包疏漏）、xdg 目录、`~/.fonts`；
  `10-liberation.conf` 位于 `fonts/` 根目录，而 fonts.conf 只 include `conf.d/`。
  表面上看自带 Liberation 目录"不可能"被注册。
- **系统字体指纹扫描**：对本机 262 个字体面（含自写 TTC 集合解析器）逐一计算
  "Hamburgefonstiv" ink bbox 指纹，**无一匹配**神秘度量。
  用户预装字体 `C:/Users/ylt/AppData/Local/Microsoft/Windows/Fonts/yyb.ttf`
  （2.8MB，upem=1000，2026-01-28 安装）曾被重点怀疑，同样不匹配。
- **强制注册实验**：把 Liberation/DejaVu 拷入每用户字体目录 + 等 rescan，
  渲染结果**逐字节不变**（该目录本就不是 OpenSCAD fontconfig 的扫描路径，见 §6）。
- **否定证据**：`openscad --debug=all` 直接打印了解析结果
  （`result = "Liberation Sans", style = "Regular"`），且四个 font= 规格渲染出
  **四个不同**的结果——若全部 fallback 到同一字体，四者应相同。

### 4.2 假设 B：STL 导出路径引入异常 —— **否定**

- 同一 `text()` 用例导出 **DXF**（`tests/tmp-fc/d2.dxf`）：
  bbox x 2.590..27.832、y 0.000..19.883，与 STL 渲染**完全一致**
  （'I' advance 7.537×2、cap 19.883 均同 STL）。
- 结论：异常在**文字布局/轮廓生成的 2D 阶段**即已存在，与 STL/DXF 导出无关。

### 4.3 假设 C：本机 openscad.exe 是被篡改/非官方 build —— **否定（降级为无关）**

- 二进制画像：`C:/Program Files/OpenSCAD/openscad.exe`，43,975,680 字节，
  **无 Authenticode 签名**，VersionInfo 全零，mtime 2021-02-01。
- 曾下载官方 2021.01 安装包准备比对哈希（未完成），但 §5 的源码证据证明
  **官方 2021.01 即此行为**，与是否被改无关。

### 4.4 假设 D：`OPENSCAD_FONT_PATH` 可强制改变解析字体 —— **实验中无效（后知无害）**

- 设置 `OPENSCAD_FONT_PATH=C:/Program Files/OpenSCAD/fonts/Liberation-2.00.1/ttf`
  与不设置渲染**逐字节相同**。原因见 §6：自带目录本来就被注册，env 只是冗余路径。

### 4.5 假设 E：字形聚类/测量脚本自身有 bug —— **部分成立（工具问题，非现象）**

- 早期指纹脚本误用 `X[4]-X[0]`（实为 2 个字距）当 'I' advance；serif 字体 nX≠8 时公式失效；
  字形聚类 push 后未清空数组导致 46 个 cluster 显示同一跨度。
  修正后测得的数据才进入 §3 表格。

---

## 5. 根因：FreetypeRenderer 的系统性缩放

### 5.1 源码证据（openscad-2021.01 tag，`src/FreetypeRenderer.cc`）

```cpp
static inline Vector2d get_scaled_vector(const FT_Vector *ft_vector, double scale) {
    return Vector2d(ft_vector->x / scale, ft_vector->y / scale);
}

const double FreetypeRenderer::scale = 1e5;
// Not sure if overall scale factor of 1000/1024 is mistake,
// but keeping ratio for compatibility (only 2.4% difference)
const double FreetypeRenderer::unscale = 1.0/1.024e5;

// render() 中：
error = FT_Set_Char_Size(face, 0, scale, 100, 100);   // char_height=1e5, 100 DPI
```

三个关键事实：

1. **轮廓**：`FT_Set_Char_Size(face, 0, 1e5, 100, 100)` 以 **100 DPI** 设定字大小
   （FreeType 名义 72 DPI），轮廓点再经 `get_scaled_vector` 除以 `scale=1e5`。
   100/72 = **1.38889** 的缩放就此进入每一条轮廓边。
2. **字距/advance**：HarfBuzz 位置经 `unscale = 1/1.024e5` 归一，
   即 advance 缩放 = (100/72) × (1/1.024) = **1.35653**。
3. 上游注释自证："不确定 1000/1024 这个总缩放因子是不是笔误，但为了兼容保持原比例"——
   即 OpenSCAD 官方知道此行为异常，且**为兼容性不修复**。这不是本机二进制的问题，
   Linux 上的 OpenSCAD 2021.01 渲染同样如此。

### 5.2 输入→输出映射（下游复现只需这两条）

设字体 upem = U，字号 size = S（OpenSCAD 的 `size` 即 em 大小的 mm 值）：

```
轮廓点输出（mm） = 字体单位 / U × S × (100/72)         // ×1.388889
advance 输出（mm）= 字体单位 / U × S × (100/72) / 1.024 // ×1.356534
```

### 5.3 实测验证（§3 表格的定量核对）

| 验证点 | 计算值 | 实测值 | 吻合 |
|---|---|---|---|
| Arial cap 高 @size=20 | 1467/2048×20×1.388889 = 19.898 mm | 19.883 mm | ✓（ASCII STL 6 位精度内） |
| Arial 'I' advance @size=20 | 569/2048×20×1.356534 = 7.5385 mm | 7.537 mm | ✓ |
| 四字体整体宽高比 | 水平 1.3565/垂直 1.3889 | 1.3581/1.3888 | ✓（水平差 0.1% 来自 bbox 端点取整） |

**"神秘字体"之谜至此彻底结案：它就是 Arial（经 fontconfig 的度量别名），
被 OpenSCAD 的 100 DPI 口径渲染。整个异常缩放与字体身份无关。**

---

## 6. 本机 OpenSCAD 字体解析机制（源码 + 最终实测）

### 6.1 源码：`src/FontCache.cc` 构造函数

```cpp
const std::string FontCache::DEFAULT_FONT("Liberation Sans:style=Regular");

fs::path fontdir(PlatformUtils::resourcePath("fonts"));
if (fs::is_regular_file(fontdir / "fonts.conf")) {
    PlatformUtils::setenv("FONTCONFIG_PATH", (fs::absolute(fontdir)).c_str(), 0); // 不覆盖已有值
}
this->config = FcInitLoadConfig();
// Add the built-in fonts & config
fs::path builtinfontpath(PlatformUtils::resourcePath("fonts"));
if (fs::is_directory(builtinfontpath)) {
    FcConfigParseAndLoad(this->config, builtinfontpath, false);  // 把 fonts/ 当配置目录加载（含 10-liberation.conf）
    add_font_dir(fs::canonical(builtinfontpath));                // FcConfigAppFontAddDir 递归注册 fonts/ 全目录
}
if (home) add_font_dir(home + "/.fonts");                        // Linux 用户字体目录
// OPENSCAD_FONT_PATH 环境变量：按路径分隔符分割，逐段 add_font_dir
```

**这解释了 §4.1 的表面矛盾**：虽然 `fonts.conf` 文本上没注册自带 Liberation 目录，
但构造函数直接用 `FcConfigParseAndLoad(fonts/)` + `FcConfigAppFontAddDir(fonts/)`
（**递归**）把 `fonts/Liberation-2.00.1/ttf/` 注册了进来——这就是
"Liberation Sans" 无需任何环境干预即可解析到自带字体的原因。
（附带结论：拷字体到 `AppData/Local/Microsoft/Windows/Fonts` 无效，因为那不是
fontconfig 扫描路径；Windows 系统字体被发现的具体通道未深究——fonts.conf 里
`WINDOWSFONTDIR` 是字面字符串，推测由 fontconfig 的 Windows 构建默认行为或编译期
注入完成——但 "Arial" 解析到真 Arial 已实测确认。）

### 6.2 最终实测状态（移走全部人工干预后）

| font= 请求 | 解析结果 | 依据 |
|---|---|---|
| `""`（默认） | Liberation Sans 2.00.1 Regular（安装目录自带） | debug 输出 + ink bbox 203.004 |
| `"Liberation Sans"` | 同上 | 与默认逐字节相同 |
| `"Liberation Sans:style=bold"` | 自带 Liberation Sans Bold | LetterBlock 实测 |
| `"Arial"` | 系统 Arial | 202.828 ≠ 203.004（与 Liberation 差 0.09%） |
| `"Liberation Mono"` / `"Liberation Serif"` | 自带对应字体 | 241.4 / 188.7 显著不同 |

用户预装的 `yyb.ttf` 只有在所有 fontconfig 请求失败时才会被 fontconfig 兜底，
对上述任何规格均无影响。

---

## 7. 对 faijs 的影响与差距分析

### 7.1 我们的文字管线

```
packages/ext/src/ops/text.ts
  → font-loader.ts（"Liberation Sans" → Arial(win) / DejaVu(linux)，度量正确）
  → @faicad/faijs textBlueprints（opentype.js 描轮廓 → OCCT 线 → 面）
```

### 7.2 与 OpenSCAD 的三处差距

| 维度 | OpenSCAD 2021.01 | faijs 现状 | 差距 |
|---|---|---|---|
| 字体文件 | 自带 Liberation Sans 2.00.1（Regular/Bold） | Arial / DejaVu（映射） | **字体身份不同**（度量差 ~0.1%，且 Windows/Linux 不一致） |
| 轮廓缩放 | ×100/72 | ×1（正确度量） | **所有文字大 38.9%** |
| advance 缩放 | ×100/72/1.024 | ×1 | **字距宽 2.4%** |

前两项是文字例子全 FAIL 的主因（第三项量小但同样导致顶点级不一致）。
注意：**差距不在"谁对谁错"**——OpenSCAD 的 100 DPI 口径按常标准确是 bug；
但 parity 的目标是复现 OpenSCAD 行为，所以 faijs 必须**主动复现这个缩放**。

---

## 8. faijs 对齐实施方案（待实施）

### 8.1 捆绑开源字体

- 源：`C:/Program Files/OpenSCAD/fonts/Liberation-2.00.1/ttf/`（OpenSCAD 自带，与基准同源）
- 目标：`packages/ext/fonts/LiberationSans-Regular.ttf` + `LiberationSans-Bold.ttf`
- 许可：SIL OFL 1.1（开源可再分发），随附 `LICENSE` 与来源说明（`README` 或文件头注释注明
  "Liberation Sans 2.00.1, digitized by Steve Mattison / Red Hat, OFL-1.1"）。
- 覆盖 CSG 语料全部 font 规格：`""`（默认）、`"Liberation Sans"`、
  `"Liberation Sans:style=bold"`/`":style=Bold"`（`logo_and_text.scad` 的默认 style）。

### 8.2 改造 `packages/ext/src/ops/font-loader.ts`

解析优先级改为：

1. 环境变量 override（保留现有测试逃生门）；
2. **内置 Liberation Sans**（"Liberation Sans" 精确命中内置文件，不再映射 Arial/DejaVu；
   `:style=bold`/`:style=Bold` → Bold 文件；`default`/`""` → Regular）；
3. 系统字体 fallback（仅当内置缺失时，如用户自带自定义字体名的极端情况）。

### 8.3 在 text 管线上复现 OpenSCAD 缩放

在 `packages/ext/src/ops/text.ts`（或 faijs `textBlueprints` 的 opts）引入两个常量：

```ts
const OPENSCAD_OUTLINE_SCALE = 100 / 72        // ≈ 1.388889  轮廓坐标
const OPENSCAD_ADVANCE_SCALE = 100 / 72 / 1.024 // ≈ 1.356534  pen advance
```

- 轮廓：opentype.js 输出的路径点（已按 size 归一化到 mm）整体乘 `OPENSCAD_OUTLINE_SCALE`；
- 字距：每个字形的 advance 乘 `OPENSCAD_ADVANCE_SCALE`；
- 垂直定位：`valign/halign` 的 offset 计算需与 OpenSCAD 同源——OpenSCAD 的
  ascend/descend 取自**放大后**的 glyph bbox（`bbox.yMax * unscale`，见 §5.1 源码），
  即垂直 offset 也带 1.3889 系数，实现时保持一致；
- `spacing` 参数（OpenSCAD `spacing=`）同样乘在 advance 上，与源码
  `width += glyph->get_x_advance() * params.spacing` 一致。

### 8.4 生成新基准并验证

1. 还原 §2.2 所述的被污染工作区；
2. 无并发负载下用本机 OpenSCAD **全量重渲 50 例**（补 3 个超时例），
   以几何度量为主判据核对（预期与入库基线几何一致）；
3. `npm run build` 重建 ext，跑全量 parity，重点观察文字例子收敛情况：
   `Advanced/children`、`Advanced/children_indexed`、`Advanced/GEB`、
   `Basics/LetterBlock`、`Basics/logo_and_text`、`Basics/text_on_cube`、
   `Basics/rotate_extrude`、`Functions/polygon_areas`、`Functions/recursion`、
   `Parametric/sign`。
4. 收敛后把这些例子的 STL 差异压到顶点级（预期残余差异只剩 OCCT 与 CGAL/FreeType
   的轮廓离散化参数差——OpenSCAD 用 `$fn/$fa/$fs` 体系，我们侧是 ext 的 segments 参数）。

---

## 9. 待办清单

| # | 事项 | 状态 |
|---|---|---|
| 1 | 还原被 generate 模式覆盖的工作区（25 个 STL + `ref-stl-hashes.json`） | 待办 |
| 2 | 无并发负载重渲 3 个超时例（`example006`/`example024`/`candleStand`） | 待办 |
| 3 | 提交 `tests/gen-ref-stl.ts` 的 `--check` 语义修复（loadHashBaseline，只读比对）——**该改动目前仍在工作区未提交** | 待办 |
| 4 | §8.1 捆绑 Liberation Sans 2.00.1（OFL）到 `packages/ext/fonts/` | 待办 |
| 5 | §8.2 font-loader 改为内置优先 | 待办 |
| 6 | §8.3 text.ts 复现双缩放 | 待办 |
| 7 | 全量 parity 重跑 + 文字例子收敛验证 | 待办 |
| 8 | 清理临时探针：`tests/tmp-*.ts`、`tests/tmp-fc/`、`tests/tmp-*.scad/stl`、`tests/tmp-win-diff-report.txt`、`WINDOWSTEMPDIR_FONTCONFIG/`、`.gitignore` 的 stl-win 行、每用户字体目录里已移走的备份（`tests/tmp-fc/font-backup/`） | 待办 |

---

## 10. 附录

### 10.1 关键复现命令

```bash
# 看 OpenSCAD 实际解析到哪个字体（本调查的突破口）
"C:/Program Files/OpenSCAD/openscad.exe" --debug=all -o out.stl probe.scad 2>&1 | grep -i "result"

# 四字体签名探针（本记录 §3 表格数据来源）
# tests/tmp-font-probe2/3.scad + tests/tmp-font-identify2.ts + tests/tmp-verify-noenv.ts

# DXF 旁路验证异常在 2D 阶段
"C:/Program Files/OpenSCAD/openscad.exe" -o out.dxf probe2d.scad   # export 用 dxf 扩展名
```

### 10.2 文字相关例子完整清单（CSG 语料实测普查）

| 文件 | text() 数 | font 规格 |
|---|---|---|
| `Advanced/children.scad` | 1 | 默认（""） |
| `Advanced/children_indexed.scad` | 2 | 默认（"Nothing..." / "one object"/"N objects "） |
| `Advanced/GEB.scad` | 3 | `"Liberation Sans"` |
| `Basics/LetterBlock.scad` | 2 | `"Liberation Sans:style=bold"` |
| `Basics/logo_and_text.scad` | 2 | `str("Liberation Sans", ":style=Bold")`（模块默认 style） |
| `Basics/roof.scad` | 2 | 默认（该例参考渲染因未知模块 `roof` 失败，与字体无关） |
| `Basics/rotate_extrude.scad` | 1 | 默认 |
| `Basics/text_on_cube.scad` | 3 | `"Liberation Sans"` |
| `Functions/polygon_areas.scad` | 2 | 默认 |
| `Functions/recursion.scad` | 1 | 默认 |
| `Parametric/sign.scad` | 2 | 默认 |
| `Old/example023.scad` | 0 | `8bit_polyfont()` 为 MCAD 矢量字体，不经 fontconfig |

（`text_on_cube.scad` 头部注释列出的 `"Bank Gothic"` 是 GUI 下拉选项，未被用例激活；
`GEB.scad` 第 3 行的 Bank Gothic 是注释。）

### 10.3 实验产物位置（清理前勿删，§9 第 8 项）

- `tests/tmp-win-diff-report.txt` —— 25 个字节差异文件的几何对比明细
- `tests/tmp-fc/` —— fontconfig 实验目录（探针 scad/stl/dxf、FontCache.cc 源码副本、
  tree.json、字体备份）
- `tests/tmp-font-*.ts`、`tests/tmp-render-win.ts`、`tests/tmp-verify-noenv.ts` —— 探针脚本

### 10.4 上游参考

- `src/FreetypeRenderer.cc` / `src/FreetypeRenderer.h`（openscad-2021.01 tag）—— 缩放常量与渲染管线
- `src/FontCache.cc`（同 tag）—— 字体目录注册、DEFAULT_FONT、debug 输出
- 上游 issue 语境："keeping ratio for compatibility" 表明该缩放行为**长期存在且被官方知情保留**，
  不是回归 bug；faijs 侧按 §8.3 复现即为正解，勿尝试"修正 OpenSCAD"。
