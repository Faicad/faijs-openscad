# Parity Report

- **Timestamp**: 2026-10-10T05:36:13.257Z
- **Converter**: 0.29.5

## Summary

| Verdict | Count |
|---|---|
| PASS | 6 |
| PASS-ANALYTIC | 0 |
| PASS-NT | 4 |
| FAIL | 15 |
| ERROR | 25 |
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
| Advanced/children.scad | ERROR | — | — | — | — | — | default | n/a |
| Advanced/children_indexed.scad | ERROR | — | — | — | — | — | default | n/a |
| Advanced/module_recursion.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Advanced/offset.scad | ERROR | — | — | — | — | — | default | n/a |
| Advanced/surface_image.scad | ERROR | — | — | — | — | — | default | n/a |
| Basics/CSG-modules.scad | PASS | 2.011978 | 0.321899 | 0.999886 | 0.007674 | 0.000000 | seg=72 | exact |
| Basics/CSG.scad | FAIL | 37.444122 | 23.320668 | 0.990889 | 0.248794 | 0.000000 | seg=30 | exact |
| Basics/LetterBlock.scad | ERROR | — | — | — | — | — | default | n/a |
| Basics/hull.scad | FAIL | 95.064043 | 30.494296 | 0.983828 | 0.284257 | 0.000000 | seg=30 | exact |
| undefined | ERROR | — | — | — | — | — | default | undefined |
| Basics/logo.scad | FAIL | 20.247197 | 9.207518 | 0.999626 | 0.000010 | 0.000000 | seg=100 | exact |
| Basics/logo_and_text.scad | ERROR | — | — | — | — | — | default | n/a |
| Basics/projection.scad | ERROR | — | — | — | — | — | default | n/a |
| Basics/roof.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Basics/rotate_extrude.scad | ERROR | — | — | — | — | — | default | n/a |
| Basics/text_on_cube.scad | ERROR | — | — | — | — | — | default | n/a |
| Functions/echo.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Functions/functions.scad | FAIL | 72.029523 | 119.032665 | 0.998745 | 1.164802 | 0.000000 | seg=5 | exact |
| Functions/list_comprehensions.scad | PASS-NT | — | — | — | — | — | default | n/a |
| Functions/polygon_areas.scad | ERROR | — | — | — | — | — | default | n/a |
| Functions/recursion.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example001.scad | FAIL | 247.997806 | 84.408356 | 0.994639 | 0.000212 | 0.000000 | seg=30 | exact |
| Old/example002.scad | FAIL | 0.971810 | 13.417837 | 1.000000 | 0.006079 | 0.000000 | seg=30 | exact |
| Old/example003.scad | PASS | 0.000000 | 0.000000 | 1.000000 | 0.000000 | 0.000000 | default | exact |
| Old/example004.scad | FAIL | 102.464453 | 122.244319 | 1.000000 | 0.000378 | 0.000000 | seg=30 | exact |
| Old/example005.scad | FAIL | 15726.617601 | 1210.961514 | 0.994423 | 0.020421 | 0.000000 | seg=30 | exact |
| Old/example006.scad | FAIL | 305021.595829 | 14178.234865 | 0.640252 | 1.178158 | 0.000000 | seg=30 | exact |
| Old/example007.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example008.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example009.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example010.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example011.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example012.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example013.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example014.scad | PASS | 0.005398 | 0.001538 | 0.999998 | 0.000000 | 0.000000 | default | exact |
| Old/example015.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example016.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example017.scad | FAIL | 1350.966696 | 1214.770951 | 0.999999 | 0.339796 | 0.000000 | seg=30 | exact |
| Old/example018.scad | FAIL | 9244.043724 | 478.102387 | 0.999995 | 0.000124 | 0.000000 | seg=30 | exact |
| Old/example019.scad | FAIL | 744.270148 | 1999.702592 | 0.996424 | 2.240187 | 0.000000 | seg=19 | exact |
| Old/example020.scad | ERROR | — | — | — | — | — | default | n/a |
| Old/example021.scad | FAIL | 684.167473 | 2734.701006 | 0.951386 | 0.402285 | 0.000000 | seg=12 | exact |
| Old/example022.scad | FAIL | 216.421031 | 22.051482 | 1.000000 | 0.000679 | 0.000000 | seg=16 | exact |
| Old/example023.scad | PASS | 0.030364 | 0.023830 | 1.000000 | 0.000018 | 0.000000 | default | exact |
| Old/example024.scad | PASS | 0.459835 | 0.039655 | 0.999999 | 0.000007 | 0.000000 | default | exact |
| Parametric/candleStand.scad | FAIL | 3931.039746 | 6113.393165 | 0.035662 | 34.388745 | 0.000000 | seg=360 | exact |
| Parametric/sign.scad | ERROR | — | — | — | — | — | default | n/a |

## Blocked Examples

- **undefined**: 

## Failures & Errors

### Advanced/GEB.scad — ERROR

> [faijs/op] text: E_OP_FAILED: openscad.text("B") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles

### Advanced/animation.scad — ERROR

> [faijs/op] applyMatrix: APPLY_MATRIX_FAILED: applyMatrix: kernel transform failed: transform: 

### Advanced/children.scad — ERROR

> [faijs/op] text: E_OP_FAILED: openscad.text("SCAD") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles

### Advanced/children_indexed.scad — ERROR

> [faijs/op] text: E_OP_FAILED: openscad.text("Nothing...") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles

### Advanced/offset.scad — ERROR

> [faijs/op] offset2d: E_OP_FAILED: offset2d failed even with near-zero delta

### Advanced/surface_image.scad — ERROR

> [faijs/op] surface: ENOENT: ENOENT: no such file or directory, open 'surface_image.png'

### Basics/CSG.scad — FAIL

> volume: Δ=37.444122 (rel 0.004794); surface area: Δ=23.320668 (rel 0.006727); bbox IoU: 0.990889 (need > 0.999000); centroid distance: 0.248794

### Basics/LetterBlock.scad — ERROR

> [faijs/op] text: E_OP_FAILED: openscad.text("Y") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles

### Basics/hull.scad — FAIL

> volume: Δ=95.064043 (rel 0.011094); surface area: Δ=30.494296 (rel 0.009643); bbox IoU: 0.983828 (need > 0.999000); centroid distance: 0.284257

### undefined — ERROR

> CRASH SKIP: known segfault in twistExtrude/sweepFull — process would terminate

### Basics/logo.scad — FAIL

> volume: Δ=20.247197 (rel 0.001082)

### Basics/logo_and_text.scad — ERROR

> [faijs/op] text: E_OP_FAILED: openscad.text("Open") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles

### Basics/projection.scad — ERROR

> [faijs/op] load: E_OP_FAILED: openscad.load({ file: "projection.stl" }) is not yet implemented — requires file I/O and STL/DXF parser

### Basics/rotate_extrude.scad — ERROR

> [faijs/op] text: E_OP_FAILED: openscad.text("  J") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles

### Basics/text_on_cube.scad — ERROR

> [faijs/op] text: E_OP_FAILED: openscad.text("C") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles

### Functions/functions.scad — FAIL

> volume: Δ=72.029523 (rel 0.144485); surface area: Δ=119.032665 (rel 0.079497); bbox IoU: 0.998745 (need > 0.999000); centroid distance: 1.164802

### Functions/polygon_areas.scad — ERROR

> [faijs/op] text: E_OP_FAILED: openscad.text("Areas:") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles

### Functions/recursion.scad — ERROR

> [faijs/op] text: E_OP_FAILED: openscad.text("6! = 720") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles

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

> [faijs/op] load: E_OP_FAILED: openscad.load({ file: "example007.dxf" }) is not yet implemented — requires file I/O and STL/DXF parser

### Old/example008.scad — ERROR

> [faijs/op] load: E_OP_FAILED: openscad.load({ file: "example008.dxf" }) is not yet implemented — requires file I/O and STL/DXF parser

### Old/example009.scad — ERROR

> [faijs/op] load: E_OP_FAILED: openscad.load({ file: "example009.dxf" }) is not yet implemented — requires file I/O and STL/DXF parser

### Old/example010.scad — ERROR

> [faijs/op] surface: ENOENT: ENOENT: no such file or directory, open 'example010.dat'

### Old/example011.scad — ERROR

> [faijs/op] polyhedron: CONSTRUCTION_FAILED: buildTriFace: wire construction failed

### Old/example012.scad — ERROR

> [faijs/op] load: E_OP_FAILED: openscad.load({ file: "example012.stl" }) is not yet implemented — requires file I/O and STL/DXF parser

### Old/example013.scad — ERROR

> [faijs/op] load: E_OP_FAILED: openscad.load({ file: "example013.dxf" }) is not yet implemented — requires file I/O and STL/DXF parser

### Old/example015.scad — ERROR

> [faijs/op] load: E_OP_FAILED: openscad.load({ file: "example009.dxf" }) is not yet implemented — requires file I/O and STL/DXF parser

### Old/example016.scad — ERROR

> [faijs/op] load: E_OP_FAILED: openscad.load({ file: "example016.stl" }) is not yet implemented — requires file I/O and STL/DXF parser

### Old/example017.scad — FAIL

> volume: Δ=1350.966696 (rel 0.008062); surface area: Δ=1214.770951 (rel 0.017337); centroid distance: 0.339796

### Old/example018.scad — FAIL

> volume: Δ=9244.043724 (rel 0.003579); surface area: Δ=478.102387 (rel 0.001728)

### Old/example019.scad — FAIL

> volume: Δ=744.270148 (rel 0.008165); surface area: Δ=1999.702592 (rel 0.058778); bbox IoU: 0.996424 (need > 0.999000); centroid distance: 2.240187

### Old/example020.scad — ERROR

> [faijs/op] twistExtrude: KERNEL_ERROR: sweepFull: BRepFill_Section: bad shape type of section

### Old/example021.scad — FAIL

> volume: Δ=684.167473 (rel 0.154075); surface area: Δ=2734.701006 (rel 0.146584); bbox IoU: 0.951386 (need > 0.999000); centroid distance: 0.402285

### Old/example022.scad — FAIL

> volume: Δ=216.421031 (rel 0.004771); surface area: Δ=22.051482 (rel 0.002394)

### Parametric/candleStand.scad — FAIL

> volume: Δ=3931.039746 (rel 0.754761); surface area: Δ=6113.393165 (rel 0.782049); bbox IoU: 0.035662 (need > 0.999000); centroid distance: 34.388745

### Parametric/sign.scad — ERROR

> [faijs/op] text: E_OP_FAILED: openscad.text("Welcome to...") is not yet implemented — requires font rendering (opentype.js) to convert glyph outlines to 2D profiles
