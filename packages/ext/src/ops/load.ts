/**
 * K03: load — external mesh asset loading (STL/DXF/OBJ).
 *
 * OpenSCAD's import() module loads an external geometry file.  This requires
 * file I/O (fs.readFile) and a format parser (STL → mesh, DXF → 2D profile).
 * Until those are wired in, this stub throws a clear error.
 */
export async function load(
  opts: { file: string },
): Promise<never> {
  throw new Error(
    `openscad.load({ file: "${opts.file}" }) is not yet implemented — requires file I/O and STL/DXF parser`,
  )
}
