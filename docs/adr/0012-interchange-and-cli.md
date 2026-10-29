# ADR 0012: Interchange formats and the command line

Status: accepted · Date: 2026-10-29

## Context

Milestone M4 opens the tool to the outside: PNML in both directions, images and TikZ for papers and the thesis, and a
command line for scripts and experiments. The constraints: no new runtime dependencies, the same behavior in the
browser and in Node, and a command line that a user can run without a build step of their own.

## Decision

- **Own XML reader.** PNML needs elements, attributes, text, CDATA, comments and ignored namespace prefixes. The reader
  (`@pnm/io/xml`, about 300 lines, tested with malformed input, depth and size limits) is used in the browser and in
  Node, so a file reads identically everywhere; `DOMParser` does not exist in Node and a package would be a new
  dependency. It never expands entities beyond the predefined ones, so a hostile DOCTYPE cannot blow up.
- **PNML 2009 `ptnet` for the standard part, `toolspecific` for the rest.** Places, transitions, arcs, weights, markings
  and positions are standard, so other tools read the file. Types, guards, inscriptions, timing, roles, simulation
  settings, notes, token values, the domain view and the original ids are stored as JSON in a CDATA section of
  `toolspecific tool="pnm"`: no XML escaping, any JSON value, and a lossless round trip (property test over random nets
  and all examples). Other tools ignore them; the export can leave them out. A reader that finds no extension produces a
  P/T net.
- **Lenient import.** Files of ProM, pm4py, WoPeD and others differ in many small ways (pages, reference places,
  invisible transitions, missing graphics, markings as text). The reader takes what it understands, reports the rest as
  warnings and fails only if the file is not XML, not PNML or has no net. Missing positions trigger the automatic layout,
  loaded on demand so that ELK stays out of the main chunk of the app.
- **TikZ escapes instead of `\detokenize`.** Names, guards and inscriptions are escaped character by character
  (`& % $ # _ { } ~ ^ \`); `\detokenize` breaks on `%` and unbalanced braces. The style names `place`, `transition`,
  `arc` and `token` are those of the thesis, and `styles: 'external'` leaves their definition to the document.
- **PNG only in the browser.** The raster is the SVG (with Inter and JetBrains Mono as data URL `@font-face` rules, so
  the letters are right) drawn on a canvas of the chosen scale, independent of the screen's pixel ratio. A rasteriser for
  Node would need a new dependency (resvg, sharp, a browser), so `pnm export --format png` fails with a clear message and
  names the alternatives. The SVG renderer moved to `@pnm/io` (`netToSvg`) and the drawing geometry to
  `@pnm/layout/geometry`, so that app and command line draw the same picture.
- **One esbuild bundle.** `apps/cli` bundles the TypeScript sources of the workspace packages with esbuild (a dev
  dependency of the CLI only) into `dist/pnm.js`: ESM, shebang, Node 22, no `node_modules` needed. Version and examples
  are compile-time constants. Arguments are parsed with `node:util` `parseArgs`. The bundle contains no browser-only code
  at runtime (the packages touch `window` and `document` nowhere; the worker client of `@pnm/sim` is a separate entry
  that is not imported), and the CLI uses the in-thread engine `createSimulation`, which gives the same event stream as
  the app's worker for the same seed.
- **Exit codes.** 0 success, 1 the command failed, 2 wrong usage; messages on standard error, data on standard output or
  in files, so pipes (`pnm import x.pnml | pnm validate -`) work.

## Consequences

- PNML round trips are exact within this tool and degrade gracefully elsewhere; imports of foreign files may carry
  warnings that the person has to read (a dialog lists them).
- The CLI is a build artifact (about 5 MB, ELK included, 0.2 s start); the integration tests start it in child processes
  and the test setup rebuilds it.
- Moving `netToSvg` and the geometry changes import paths but no behavior; their tests moved with them.
