# Parity Report

- **Timestamp**: 2026-10-18T04:17:26.296Z
- **Converter**: 0.29.5

## Summary

| Verdict | Count |
|---|---|
| PASS | 20 |
| PASS-ANALYTIC | 0 |
| PASS-NT | 8 |
| FAIL | 12 |
| ERROR | 10 |
| **Total** | 50 |

## Tolerance

| Parameter | Value |
|---|---|
| Volume (abs) | 0.01 |
| Volume (rel) | 0.001 |
| Surface area (abs) | 0.1 |
| Surface area (rel) | 0.001 |
| Bbox IoU | 0.001 |
| Centroid distance | 0.01 |
| Surface distance | 0.1 |
| Triangle count (rel) | 0.1 |

## Per-Example Results

| Example | Verdict | Volume Δ | Area Δ | Bbox IoU | Centroid dist | Hausdorff | Tessellation | STEP |
|---|---|---|---|---|---|---|---|---|
| Advanced/GEB.scad | ERROR | — | — | — | — | — | default | n/a |
| Advanced/animation.scad | ERROR | — | — | — | — | — | default | n/a |
| Advanced/assert.scad | PASS | 0.015972 | 0.007784 | 1.000000 | 0.000008 | 0.000000 | default | exact |
| Advanced/children.scad | FAIL | 129.573107 | 566.214305 | 0.921900 | 0.776209 | 0.000000 | seg=40 | exact |
| Advanced/children_indexed.scad | FAIL | 103.825576 | 446.249012 | 0.892385 | 7.224294 | 0.000000 | seg=13 | exact |
| Advanced/module_recursion.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Advanced/offset.scad | ERROR | — | — | — | — | — | default | n/a |
| Advanced/surface_image.scad | ERROR | — | — | — | — | — | default | n/a |
| Basics/CSG-modules.scad | PASS | 0.001812 | 0.001267 | 0.999999 | 0.000004 | 0.000000 | seg=72 | exact |
| Basics/CSG.scad | PASS | 0.001090 | 0.000618 | 1.000000 | 0.000004 | 0.000000 | seg=30 | exact |
| Basics/LetterBlock.scad | FAIL | 892.054815 | 338.380729 | 1.000000 | 0.897494 | 0.000000 | default | exact |
| Basics/hull.scad | FAIL | 95.064043 | 30.494296 | 0.983828 | 0.284257 | 0.000000 | seg=30 | exact |
| undefined | ERROR | — | — | — | — | — | default | undefined |
| Basics/logo.scad | PASS | 0.070411 | 0.003185 | 0.999997 | 0.000000 | 0.000000 | seg=100 | exact |
| Basics/logo_and_text.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Basics/projection.scad | ERROR | — | — | — | — | — | default | n/a |
| Basics/roof.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Basics/rotate_extrude.scad | FAIL | 867.028288 | 1237.901161 | 0.996875 | 5.069102 | 0.000000 | seg=80 | exact |
| Basics/text_on_cube.scad | FAIL | 2069.452613 | 961.304268 | 0.881479 | 2.630587 | 0.000000 | default | exact |
| Functions/echo.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Functions/functions.scad | FAIL | 18.079972 | 41.091159 | 0.999143 | 0.452042 | 0.000000 | seg=5 | exact |
| Functions/list_comprehensions.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Functions/polygon_areas.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Functions/recursion.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Old/example001.scad | PASS | 0.052839 | 0.012436 | 0.999996 | 0.000000 | 0.000000 | seg=30 | exact |
| Old/example002.scad | PASS | 0.002248 | 0.002309 | 1.000000 | 0.000002 | 0.000000 | seg=30 | exact |
| Old/example003.scad | PASS | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | default | exact |
| Old/example004.scad | PASS | 0.002244 | 0.008007 | 1.000000 | 0.000000 | 0.000000 | seg=30 | exact |
| Old/example005.scad | FAIL | 2233949.530009 | 265460.725758 | 0.000000 | 7.164434 | 0.000000 | seg=30 | exact |
| Old/example006.scad | FAIL | 305021.595829 | 14178.234865 | 0.640252 | 1.178158 | 0.000000 | seg=30 | exact |
| Old/example007.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example008.scad | PASS | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | default | exact |
| Old/example009.scad | ERROR | — | — | — | — | — | default | n/a |
| undefined | ERROR | — | — | — | — | — | default | undefined |
| Old/example011.scad | PASS | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | default | exact |
| Old/example012.scad | PASS | 0.009386 | 0.000202 | 0.999997 | 0.000003 | 0.000000 | seg=30 | exact |
| Old/example013.scad | PASS | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | default | exact |
| Old/example014.scad | PASS | 0.005398 | 0.001538 | 0.999998 | 0.000000 | 0.000000 | default | exact |
| Old/example015.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Old/example016.scad | PASS | 0.016018 | 0.003653 | 1.000000 | 0.000008 | 0.000000 | default | exact |
| Old/example017.scad | FAIL | 1350.966761 | 1214.770967 | 0.999999 | 0.339796 | 0.000000 | seg=30 | exact |
| Old/example018.scad | PASS | 5.552678 | 0.444971 | 0.999995 | 0.000084 | 0.000000 | seg=30 | exact |
| Old/example019.scad | PASS | 0.110672 | 0.039324 | 0.999999 | 0.000012 | 0.000000 | seg=19 | exact |
| Old/example020.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example021.scad | FAIL | 684.167473 | 2734.701006 | 0.951386 | 0.402285 | 0.000000 | seg=12 | exact |
| Old/example022.scad | PASS | 0.028488 | 0.008862 | 1.000000 | 0.000004 | 0.000000 | seg=16 | exact |
| Old/example023.scad | PASS | 0.030364 | 0.023830 | 1.000000 | 0.000018 | 0.000000 | default | exact |
| Old/example024.scad | PASS | 0.459849 | 0.039655 | 0.999999 | 0.000007 | 0.000000 | default | exact |
| Parametric/candleStand.scad | PASS | 0.004994 | 0.001906 | 1.000000 | 0.000007 | 0.000000 | seg=360 | exact |
| Parametric/sign.scad | FAIL | 268.913395 | 571.151649 | 0.958857 | 2.020883 | 0.000000 | seg=10 | exact |

## Blocked Examples

- **undefined**: 
- **undefined**: 

## Failures & Errors

### Advanced/GEB.scad — ERROR

> [faijs/op] offset2d: E_OP_FAILED: offset2d failed even with near-zero delta

### Advanced/animation.scad — ERROR

> [faijs/op] applyMatrix: APPLY_MATRIX_FAILED: applyMatrix: kernel transform failed: transform: 

### Advanced/children.scad — FAIL

> volume: Δ=129.573107 (rel 0.010204); surface area: Δ=566.214305 (rel 0.048021); bbox IoU: 0.921900 (need > 0.999000); centroid distance: 0.776209

### Advanced/children_indexed.scad — FAIL

> volume: Δ=103.825576 (rel 0.015098); surface area: Δ=446.249012 (rel 0.079263); bbox IoU: 0.892385 (need > 0.999000); centroid distance: 7.224294

### Advanced/offset.scad — ERROR

> [faijs/op] boolean: CONSTRUCTION_FAILED: booleanOp: operation failed

### Advanced/surface_image.scad — ERROR

> [faijs/op] projectCut: CONSTRUCTION_FAILED: makeFace: construction failed

### Basics/LetterBlock.scad — FAIL

> volume: Δ=892.054815 (rel 0.068659); surface area: Δ=338.380729 (rel 0.076853); centroid distance: 0.897494

### Basics/hull.scad — FAIL

> volume: Δ=95.064043 (rel 0.011094); surface area: Δ=30.494296 (rel 0.009643); bbox IoU: 0.983828 (need > 0.999000); centroid distance: 0.284257

### undefined — ERROR

> CRASH SKIP: known segfault in twistExtrude/sweepFull — process would terminate

### Basics/projection.scad — ERROR

> [faijs/op] projectOutline: CONSTRUCTION_FAILED: makeFace: construction failed

### Basics/rotate_extrude.scad — FAIL

> volume: Δ=867.028288 (rel 0.110007); surface area: Δ=1237.901161 (rel 0.172860); bbox IoU: 0.996875 (need > 0.999000); centroid distance: 5.069102

### Basics/text_on_cube.scad — FAIL

> volume: Δ=2069.452613 (rel 0.009337); surface area: Δ=961.304268 (rel 0.037300); bbox IoU: 0.881479 (need > 0.999000); centroid distance: 2.630587

### Functions/functions.scad — FAIL

> volume: Δ=18.079972 (rel 0.042392); surface area: Δ=41.091159 (rel 0.029813); centroid distance: 0.452042

### Old/example005.scad — FAIL

> volume: Δ=2233949.530009 (rel 1.000000); surface area: Δ=265460.725758 (rel 1.000000); bbox IoU: 0.000000 (need > 0.999000); centroid distance: 7.164434

### Old/example006.scad — FAIL

> volume: Δ=305021.595829 (rel 0.327812); surface area: Δ=14178.234865 (rel 0.231807); bbox IoU: 0.640252 (need > 0.999000); centroid distance: 1.178158

### Old/example007.scad — ERROR

> [faijs/op] <anon>: CONSTRUCTION_FAILED: revolve: construction failed

### Old/example009.scad — ERROR

> [faijs/op] twistExtrude: KERNEL_ERROR: sweepFull: BRepFill_Section: bad shape type of section

### undefined — ERROR

> CRASH SKIP: known segfault in twistExtrude/sweepFull — process would terminate

### Old/example017.scad — FAIL

> volume: Δ=1350.966761 (rel 0.008062); surface area: Δ=1214.770967 (rel 0.017337); centroid distance: 0.339796

### Old/example020.scad — ERROR

> [faijs/op] twistExtrude: KERNEL_ERROR: sweepFull: BRepFill_Section: bad shape type of section

### Old/example021.scad — FAIL

> volume: Δ=684.167473 (rel 0.154075); surface area: Δ=2734.701006 (rel 0.146584); bbox IoU: 0.951386 (need > 0.999000); centroid distance: 0.402285

### Parametric/sign.scad — FAIL

> volume: Δ=268.913395 (rel 0.009724); surface area: Δ=571.151649 (rel 0.025445); bbox IoU: 0.958857 (need > 0.999000); centroid distance: 2.020883
