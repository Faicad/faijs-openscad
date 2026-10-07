# Parity Report

- **Timestamp**: 2026-10-07T18:34:03.384Z
- **Converter**: 0.29.5

## Summary

| Verdict | Count |
|---|---|
| PASS | 7 |
| PASS-ANALYTIC | 0 |
| PASS-NT | 1 |
| FAIL | 11 |
| ERROR | 3 |
| **Total** | 22 |

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
| Advanced/assert.scad | PASS | 0.015972 | 0.007784 | 1.000000 | 0.000008 | 0.000000 | default | exact |
| Advanced/module_recursion.scad | ERROR | — | — | — | — | — | default | n/a |
| Basics/CSG-modules.scad | PASS | 2.259331 | 0.345511 | 0.999886 | 0.007555 | 0.000000 | seg=72 | exact |
| Basics/CSG.scad | FAIL | 42.395339 | 22.263225 | 0.990889 | 0.247451 | 0.000000 | seg=30 | exact |
| Basics/logo.scad | PASS | 13.602304 | 7.372897 | 0.999626 | 0.000029 | 0.000000 | seg=100 | exact |
| Basics/roof.scad | ERROR | — | — | — | — | — | default | n/a |
| Functions/echo.scad | ERROR | — | — | — | — | — | default | n/a |
| Functions/functions.scad | FAIL | 72.029523 | 119.032665 | 0.998745 | 1.164802 | 0.000000 | seg=5 | exact |
| Functions/list_comprehensions.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Old/example001.scad | FAIL | 431.043449 | 93.731276 | 0.994639 | 0.000029 | 0.000000 | seg=30 | exact |
| Old/example002.scad | FAIL | 59.347923 | 16.012854 | 1.000000 | 0.011399 | 0.000000 | seg=30 | exact |
| Old/example003.scad | PASS | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | default | exact |
| Old/example004.scad | FAIL | 142.074189 | 127.359782 | 1.000000 | 0.000022 | 0.000000 | seg=30 | exact |
| Old/example005.scad | FAIL | 15726.617601 | 1210.961514 | 0.994423 | 0.020421 | 0.000000 | seg=30 | exact |
| Old/example014.scad | PASS | 0.005398 | 0.001538 | 0.999998 | 0.000000 | 0.000000 | default | exact |
| Old/example017.scad | FAIL | 476.817343 | 920.976165 | 0.997260 | 0.330638 | 0.000000 | seg=30 | exact |
| Old/example018.scad | FAIL | 9244.043724 | 478.102387 | 0.999995 | 0.000124 | 0.000000 | seg=30 | exact |
| Old/example019.scad | FAIL | 893.799754 | 111.805297 | 0.996200 | 0.018778 | 0.000000 | seg=19 | exact |
| Old/example022.scad | FAIL | 216.421031 | 22.051482 | 1.000000 | 0.000679 | 0.000000 | seg=16 | exact |
| Old/example023.scad | PASS | 0.030364 | 0.023830 | 1.000000 | 0.000018 | 0.000000 | default | exact |
| Old/example024.scad | PASS | 0.459835 | 0.039655 | 0.999999 | 0.000007 | 0.000000 | default | exact |
| Parametric/candleStand.scad | FAIL | 3931.039746 | 6113.392828 | 0.035662 | 34.388745 | 0.000000 | seg=360 | exact |

## Failures & Errors

### Advanced/module_recursion.scad — ERROR

> [parser] line 1: too many top-level statements (8189 > 5000)

### Basics/CSG.scad — FAIL

> volume: Δ=42.395339 (rel 0.005424); surface area: Δ=22.263225 (rel 0.006422); bbox IoU: 0.990889 (need > 0.999000); centroid distance: 0.247451

### Basics/roof.scad — ERROR

> no result variable in script output

### Functions/echo.scad — ERROR

> no result variable in script output

### Functions/functions.scad — FAIL

> volume: Δ=72.029523 (rel 0.144485); surface area: Δ=119.032665 (rel 0.079497); bbox IoU: 0.998745 (need > 0.999000); centroid distance: 1.164802

### Old/example001.scad — FAIL

> volume: Δ=431.043449 (rel 0.023084); surface area: Δ=93.731276 (rel 0.009770); bbox IoU: 0.994639 (need > 0.999000)

### Old/example002.scad — FAIL

> volume: Δ=59.347923 (rel 0.004825); surface area: Δ=16.012854 (rel 0.002736); centroid distance: 0.011399

### Old/example004.scad — FAIL

> volume: Δ=142.074189 (rel 0.062194); surface area: Δ=127.359782 (rel 0.036529)

### Old/example005.scad — FAIL

> volume: Δ=15726.617601 (rel 0.006991); surface area: Δ=1210.961514 (rel 0.004541); bbox IoU: 0.994423 (need > 0.999000); centroid distance: 0.020421

### Old/example017.scad — FAIL

> volume: Δ=476.817343 (rel 0.002845); surface area: Δ=920.976165 (rel 0.013144); bbox IoU: 0.997260 (need > 0.999000); centroid distance: 0.330638

### Old/example018.scad — FAIL

> volume: Δ=9244.043724 (rel 0.003579); surface area: Δ=478.102387 (rel 0.001728)

### Old/example019.scad — FAIL

> volume: Δ=893.799754 (rel 0.009790); surface area: Δ=111.805297 (rel 0.003492); bbox IoU: 0.996200 (need > 0.999000); centroid distance: 0.018778

### Old/example022.scad — FAIL

> volume: Δ=216.421031 (rel 0.004771); surface area: Δ=22.051482 (rel 0.002394)

### Parametric/candleStand.scad — FAIL

> volume: Δ=3931.039746 (rel 0.754761); surface area: Δ=6113.392828 (rel 0.782049); bbox IoU: 0.035662 (need > 0.999000); centroid distance: 34.388745
