# AGENTS.md — faijs-openscad

## What this project is

`@faicad/faijs-openscad` — a standalone TypeScript converter that transpiles
OpenSCAD models into faijs code (`.fai.js`). It does NOT reimplement the
OpenSCAD language front-end; instead it reuses the output of the official
OpenSCAD frontend (normalized `.csg`), parses it with a hand-written
lexer/parser, lowers it into a Model IR, and emits deterministic `.fai.js`.

Pipeline: `.scad` → (OpenSCAD binary, external process) → `.csg` → CSG AST
(source ranges) → IR (lower/normalize/capability check) → `.fai.js` → (faijs) → STL/STEP/3MF.

开发本项目时，碰到的faijs项目本身的bug或者功能缺陷，必须优先解决。
碰到对faijs的特性和api使用产生误解的地方，要记录下来，并思考如何优化faijs项目的文案、项目组织、甚至api设计，以便别人首次开发faijs时少踩坑。