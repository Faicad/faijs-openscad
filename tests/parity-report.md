# Parity Report

- **Timestamp**: 2026-10-06T15:49:06.386Z
- **Converter**: 0.29.5

## Summary

| Verdict | Count |
|---|---|
| PASS | 5 |
| PASS-ANALYTIC | 0 |
| PASS-NT | 0 |
| FAIL | 12 |
| ERROR | 4 |
| **Total** | 21 |

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

| Example | Verdict | Volume Δ | Area Δ | Bbox IoU | Centroid dist | Hausdorff | STEP |
|---|---|---|---|---|---|---|---|
| Advanced/assert.scad | PASS | 0.014639 | 0.007103 | 1.000000 | 0.000007 | 0.000000 | exact |
| Basics/CSG-modules.scad | PASS | 2.252296 | 0.335655 | 0.999886 | 0.007546 | 0.000000 | exact |
| Basics/CSG.scad | FAIL | 42.395339 | 22.263225 | 0.990889 | 0.247451 | 0.000000 | exact |
| Basics/logo.scad | FAIL | 0.960414 | 10.306047 | 0.999188 | 0.000033 | 0.000000 | exact |
| Basics/roof.scad | ERROR | — | — | — | — | — | n/a |
| Functions/echo.scad | ERROR | — | — | — | — | — | n/a |
| Functions/functions.scad | FAIL | 72.029523 | 119.032665 | 0.998745 | 1.164802 | 0.000000 | exact |
| Functions/list_comprehensions.scad | ERROR | — | — | — | — | — | n/a |
| Old/example001.scad | FAIL | 431.043449 | 93.731276 | 0.994639 | 0.000029 | 0.000000 | exact |
| Old/example002.scad | FAIL | 59.347923 | 16.012854 | 1.000000 | 0.011399 | 0.000000 | exact |
| Old/example003.scad | PASS | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | exact |
| Old/example004.scad | FAIL | 142.074189 | 127.359782 | 1.000000 | 0.000022 | 0.000000 | exact |
| Old/example005.scad | FAIL | 15726.617601 | 1210.961514 | 0.994423 | 0.020421 | 0.000000 | exact |
| Old/example014.scad | PASS | 0.005226 | 0.001518 | 0.999998 | 0.000000 | 0.000000 | exact |
| Old/example017.scad | ERROR | — | — | — | — | — | n/a |
| Old/example018.scad | FAIL | 9243.972897 | 478.097491 | 0.999995 | 0.000124 | 0.000000 | exact |
| Old/example019.scad | FAIL | 893.799754 | 111.805297 | 0.996200 | 0.018778 | 0.000000 | exact |
| Old/example022.scad | FAIL | 216.421031 | 22.051482 | 1.000000 | 0.000679 | 0.000000 | exact |
| Old/example023.scad | FAIL | 1043.301762 | 0.023607 | 0.500000 | 0.324151 | 0.000000 | exact |
| Old/example024.scad | PASS | 0.462035 | 0.042650 | 0.999999 | 0.000027 | 0.000000 | exact |
| Parametric/candleStand.scad | FAIL | 37.366124 | 9.714998 | 0.999796 | 0.012953 | 0.000000 | exact |

## Failures & Errors

### Basics/CSG.scad — FAIL

> volume: Δ=42.395339 (rel 0.005424); surface area: Δ=22.263225 (rel 0.006422); bbox IoU: 0.990889 (need > 0.999000); centroid distance: 0.247451

### Basics/logo.scad — FAIL

> surface area: Δ=10.306047 (rel 0.001074)

### Basics/roof.scad — ERROR

> no result variable in script output

### Functions/echo.scad — ERROR

> no result variable in script output

### Functions/functions.scad — FAIL

> volume: Δ=72.029523 (rel 0.144485); surface area: Δ=119.032665 (rel 0.079497); bbox IoU: 0.998745 (need > 0.999000); centroid distance: 1.164802

### Functions/list_comprehensions.scad — ERROR

> [api/boolean] union: no solid input — wire/face/shell geometry cannot fuse (types: face, face, face, face, face, face, face, face, face)

### Old/example001.scad — FAIL

> volume: Δ=431.043449 (rel 0.023084); surface area: Δ=93.731276 (rel 0.009770); bbox IoU: 0.994639 (need > 0.999000)

### Old/example002.scad — FAIL

> volume: Δ=59.347923 (rel 0.004825); surface area: Δ=16.012854 (rel 0.002736); centroid distance: 0.011399

### Old/example004.scad — FAIL

> volume: Δ=142.074189 (rel 0.062194); surface area: Δ=127.359782 (rel 0.036529)

### Old/example005.scad — FAIL

> volume: Δ=15726.617601 (rel 0.006991); surface area: Δ=1210.961514 (rel 0.004541); bbox IoU: 0.994423 (need > 0.999000); centroid distance: 0.020421

### Old/example017.scad — ERROR

> [api/boolean] union: no solid input — wire/face/shell geometry cannot fuse (types: face, face, face)

### Old/example018.scad — FAIL

> volume: Δ=9243.972897 (rel 0.003579); surface area: Δ=478.097491 (rel 0.001728)

### Old/example019.scad — FAIL

> volume: Δ=893.799754 (rel 0.009790); surface area: Δ=111.805297 (rel 0.003492); bbox IoU: 0.996200 (need > 0.999000); centroid distance: 0.018778

### Old/example022.scad — FAIL

> volume: Δ=216.421031 (rel 0.004771); surface area: Δ=22.051482 (rel 0.002394)

### Old/example023.scad — FAIL

> volume: Δ=1043.301762 (rel 0.178852); bbox IoU: 0.500000 (need > 0.999000); centroid distance: 0.324151

### Parametric/candleStand.scad — FAIL

> volume: Δ=37.366124 (rel 0.007123); surface area: Δ=9.714998 (rel 0.001241); centroid distance: 0.012953
