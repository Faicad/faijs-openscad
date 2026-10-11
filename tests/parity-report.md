# Parity Report

- **Timestamp**: 2026-10-11T02:55:33.684Z
- **Converter**: 0.29.5

## Summary

| Verdict | Count |
|---|---|
| PASS | 6 |
| PASS-ANALYTIC | 0 |
| PASS-NT | 8 |
| FAIL | 22 |
| ERROR | 14 |
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
| Advanced/children.scad | FAIL | 25.902817 | 490.770012 | 0.926476 | 0.857441 | 0.000000 | seg=40 | exact |
| Advanced/children_indexed.scad | FAIL | 276.112890 | 288.932781 | 0.868861 | 7.104939 | 0.000000 | seg=13 | exact |
| Advanced/module_recursion.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Advanced/offset.scad | ERROR | — | — | — | — | — | default | n/a |
| Advanced/surface_image.scad | ERROR | — | — | — | — | — | default | n/a |
| Basics/CSG-modules.scad | PASS | 2.011978 | 0.321899 | 0.999886 | 0.007674 | 0.000000 | seg=72 | exact |
| Basics/CSG.scad | FAIL | 37.444122 | 23.320668 | 0.990889 | 0.248794 | 0.000000 | seg=30 | exact |
| Basics/LetterBlock.scad | FAIL | 913.886175 | 363.352077 | 1.000000 | 0.789790 | 0.000000 | default | exact |
| Basics/hull.scad | FAIL | 95.064043 | 30.494296 | 0.983828 | 0.284257 | 0.000000 | seg=30 | exact |
| undefined | ERROR | — | — | — | — | — | default | undefined |
| Basics/logo.scad | FAIL | 20.247197 | 9.207518 | 0.999626 | 0.000010 | 0.000000 | seg=100 | exact |
| Basics/logo_and_text.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Basics/projection.scad | ERROR | — | — | — | — | — | default | n/a |
| Basics/roof.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Basics/rotate_extrude.scad | FAIL | 911.433416 | 1386.344680 | 0.912925 | 5.816523 | 0.000000 | seg=80 | exact |
| Basics/text_on_cube.scad | FAIL | 2197.381207 | 953.813707 | 0.894063 | 2.341896 | 0.000000 | default | exact |
| Functions/echo.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Functions/functions.scad | FAIL | 72.029523 | 119.032665 | 0.998745 | 1.164802 | 0.000000 | seg=5 | exact |
| Functions/list_comprehensions.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Functions/polygon_areas.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Functions/recursion.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Old/example001.scad | FAIL | 247.997806 | 84.408356 | 0.994639 | 0.000212 | 0.000000 | seg=30 | exact |
| Old/example002.scad | FAIL | 0.971810 | 13.417837 | 1.000000 | 0.006079 | 0.000000 | seg=30 | exact |
| Old/example003.scad | PASS | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | default | exact |
| Old/example004.scad | FAIL | 102.464453 | 122.244319 | 1.000000 | 0.000378 | 0.000000 | seg=30 | exact |
| Old/example005.scad | FAIL | 15726.617601 | 1210.961514 | 0.994423 | 0.020421 | 0.000000 | seg=30 | exact |
| Old/example006.scad | FAIL | 305021.595829 | 14178.234865 | 0.640252 | 1.178158 | 0.000000 | seg=30 | exact |
| Old/example007.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example008.scad | FAIL | 6000.000000 | 2800.000000 | 1.000000 | 2.229808 | 0.000000 | default | exact |
| Old/example009.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example010.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example011.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example012.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example013.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example014.scad | PASS | 0.005398 | 0.001538 | 0.999998 | 0.000000 | 0.000000 | default | exact |
| Old/example015.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Old/example016.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example017.scad | FAIL | 1350.966761 | 1214.770967 | 0.999999 | 0.339796 | 0.000000 | seg=30 | exact |
| Old/example018.scad | FAIL | 9244.043693 | 478.102387 | 0.999995 | 0.000124 | 0.000000 | seg=30 | exact |
| Old/example019.scad | FAIL | 744.270134 | 1999.702592 | 0.996424 | 2.240187 | 0.000000 | seg=19 | exact |
| Old/example020.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example021.scad | FAIL | 684.167473 | 2734.701006 | 0.951386 | 0.402285 | 0.000000 | seg=12 | exact |
| Old/example022.scad | FAIL | 216.385070 | 22.047885 | 1.000000 | 0.000685 | 0.000000 | seg=16 | exact |
| Old/example023.scad | PASS | 0.030364 | 0.023830 | 1.000000 | 0.000018 | 0.000000 | default | exact |
| Old/example024.scad | PASS | 0.459849 | 0.039655 | 0.999999 | 0.000007 | 0.000000 | default | exact |
| Parametric/candleStand.scad | FAIL | 40.007288 | 12.229146 | 0.999796 | 0.016478 | 0.000000 | seg=360 | exact |
| Parametric/sign.scad | FAIL | 1537.587226 | 701.892138 | 0.859968 | 2.416771 | 0.000000 | seg=10 | exact |

## Blocked Examples

- **undefined**: 

## Failures & Errors

### Advanced/GEB.scad — ERROR

> [faijs/op] offset2d: E_OP_FAILED: offset2d failed even with near-zero delta

### Advanced/animation.scad — ERROR

> [faijs/op] applyMatrix: APPLY_MATRIX_FAILED: applyMatrix: kernel transform failed: transform: 

### Advanced/children.scad — FAIL

> volume: Δ=25.902817 (rel 0.002036); surface area: Δ=490.770012 (rel 0.041623); bbox IoU: 0.926476 (need > 0.999000); centroid distance: 0.857441

### Advanced/children_indexed.scad — FAIL

> volume: Δ=276.112890 (rel 0.038602); surface area: Δ=288.932781 (rel 0.051320); bbox IoU: 0.868861 (need > 0.999000); centroid distance: 7.104939

### Advanced/offset.scad — ERROR

> [faijs/op] offset2d: E_OP_FAILED: offset2d failed even with near-zero delta

### Advanced/surface_image.scad — ERROR

> [faijs/op] surface: ENOENT: ENOENT: no such file or directory, open 'surface_image.png'

### Basics/CSG.scad — FAIL

> volume: Δ=37.444122 (rel 0.004794); surface area: Δ=23.320668 (rel 0.006727); bbox IoU: 0.990889 (need > 0.999000); centroid distance: 0.248794

### Basics/LetterBlock.scad — FAIL

> volume: Δ=913.886175 (rel 0.070221); surface area: Δ=363.352077 (rel 0.082525); centroid distance: 0.789790

### Basics/hull.scad — FAIL

> volume: Δ=95.064043 (rel 0.011094); surface area: Δ=30.494296 (rel 0.009643); bbox IoU: 0.983828 (need > 0.999000); centroid distance: 0.284257

### undefined — ERROR

> CRASH SKIP: known segfault in twistExtrude/sweepFull — process would terminate

### Basics/logo.scad — FAIL

> volume: Δ=20.247197 (rel 0.001082)

### Basics/projection.scad — ERROR

> [faijs/op] projectOutline: CONSTRUCTION_FAILED: makeFace: construction failed

### Basics/rotate_extrude.scad — FAIL

> volume: Δ=911.433416 (rel 0.115641); surface area: Δ=1386.344680 (rel 0.193589); bbox IoU: 0.912925 (need > 0.999000); centroid distance: 5.816523

### Basics/text_on_cube.scad — FAIL

> volume: Δ=2197.381207 (rel 0.009914); surface area: Δ=953.813707 (rel 0.037010); bbox IoU: 0.894063 (need > 0.999000); centroid distance: 2.341896

### Functions/functions.scad — FAIL

> volume: Δ=72.029523 (rel 0.144485); surface area: Δ=119.032665 (rel 0.079497); bbox IoU: 0.998745 (need > 0.999000); centroid distance: 1.164802

### Old/example001.scad — FAIL

> volume: Δ=247.997806 (rel 0.013413); surface area: Δ=84.408356 (rel 0.008807); bbox IoU: 0.994639 (need > 0.999000)

### Old/example002.scad — FAIL

> surface area: Δ=13.417837 (rel 0.002293)

### Old/example004.scad — FAIL

> volume: Δ=102.464453 (rel 0.044854); surface area: Δ=122.244319 (rel 0.035061)

### Old/example005.scad — FAIL

> volume: Δ=15726.617601 (rel 0.006991); surface area: Δ=1210.961514 (rel 0.004541); bbox IoU: 0.994423 (need > 0.999000); centroid distance: 0.020421

### Old/example006.scad — FAIL

> volume: Δ=305021.595829 (rel 0.327812); surface area: Δ=14178.234865 (rel 0.231807); bbox IoU: 0.640252 (need > 0.999000); centroid distance: 1.178158

### Old/example007.scad — ERROR

> [faijs/op] <anon>: CONSTRUCTION_FAILED: revolve: construction failed

### Old/example008.scad — FAIL

> volume: Δ=6000.000000 (rel 0.122086); surface area: Δ=2800.000000 (rel 0.135947); centroid distance: 2.229808

### Old/example009.scad — ERROR

> [faijs/op] twistExtrude: KERNEL_ERROR: sweepFull: BRepFill_Section: bad shape type of section

### Old/example010.scad — ERROR

> [faijs/op] surface: ENOENT: ENOENT: no such file or directory, open 'example010.dat'

### Old/example011.scad — ERROR

> [faijs/op] polyhedron: CONSTRUCTION_FAILED: buildTriFace: wire construction failed

### Old/example012.scad — ERROR

> [api/boolean] subtract: kernel cut failed for inputs part0 × part3 — cutWithHistory: operation failed

### Old/example013.scad — ERROR

> [faijs/op] load: E_OP_FAILED: openscad.load({ file: "/root/faijs-openscad/tests/fixtures/openscad-examples/Old/example013.dxf" }) — DXF parsing produced no wires

### Old/example016.scad — ERROR

> [api/boolean] subtract: kernel cut failed for inputs part4 × part6 — cutWithHistory: operation failed

### Old/example017.scad — FAIL

> volume: Δ=1350.966761 (rel 0.008062); surface area: Δ=1214.770967 (rel 0.017337); centroid distance: 0.339796

### Old/example018.scad — FAIL

> volume: Δ=9244.043693 (rel 0.003579); surface area: Δ=478.102387 (rel 0.001728)

### Old/example019.scad — FAIL

> volume: Δ=744.270134 (rel 0.008165); surface area: Δ=1999.702592 (rel 0.058778); bbox IoU: 0.996424 (need > 0.999000); centroid distance: 2.240187

### Old/example020.scad — ERROR

> [faijs/op] twistExtrude: KERNEL_ERROR: sweepFull: BRepFill_Section: bad shape type of section

### Old/example021.scad — FAIL

> volume: Δ=684.167473 (rel 0.154075); surface area: Δ=2734.701006 (rel 0.146584); bbox IoU: 0.951386 (need > 0.999000); centroid distance: 0.402285

### Old/example022.scad — FAIL

> volume: Δ=216.385070 (rel 0.004770); surface area: Δ=22.047885 (rel 0.002394)

### Parametric/candleStand.scad — FAIL

> volume: Δ=40.007288 (rel 0.007623); surface area: Δ=12.229146 (rel 0.001562); centroid distance: 0.016478

### Parametric/sign.scad — FAIL

> volume: Δ=1537.587226 (rel 0.052674); surface area: Δ=701.892138 (rel 0.030322); bbox IoU: 0.859968 (need > 0.999000); centroid distance: 2.416771
