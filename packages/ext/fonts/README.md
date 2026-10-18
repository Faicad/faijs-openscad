# Bundled Fonts — Liberation Sans 2.00.1

## Source

`LiberationSans-{Regular,Bold,Italic,BoldItalic}.ttf` are copied verbatim from the
OpenSCAD 2021.01 installation (`C:/Program Files/OpenSCAD/fonts/Liberation-2.00.1/ttf/`),
which is where the reference STL baselines in `tests/fixtures/openscad-examples/stl/`
were rendered from.

OpenSCAD's `FontCache.cc` defines `DEFAULT_FONT = "Liberation Sans:style=Regular"`,
and every `font=` spec in the CSG corpus (`tests/fixtures/openscad-examples/**/*.scad`)
resolves to Liberation Sans (regular or bold). Bundling the same font files here means
text rendering uses the **same font binaries as the OpenSCAD reference renders**,
on every machine, with no per-platform guessing.

## License

SIL Open Font License, Version 1.1 — see `LICENSE` in this directory.
Copyright (c) 2010 Google Corporation (Reserved Font Name Arimo), (c) 2012 Red Hat, Inc.
(Reserved Font Name Liberation). The OFL permits bundling and redistribution; the
Reserved Font Name clause does not apply because the files are unmodified and the
original names are retained.

## Resolution order (see `../src/ops/font-loader.ts`)

1. `FAJS_FONT_PATH` / `OPENSCAD_FONT_PATH` env override (debugging / testing escape hatch)
2. **Bundled Liberation Sans** (this directory) — for `Liberation Sans` and any
   `Liberation Sans:style=...` spec, including the default (empty) font
3. System fonts (DejaVu on Linux, Arial/Times/Consolas on Windows) — only reached
   if the bundle is missing

Only the Sans family is bundled: the corpus uses no other Liberation family
(`text_on_cube.scad`'s GUI dropdown lists Mono/Serif options, but none of them are
active in the rendered examples). Add more faces here if that changes.
