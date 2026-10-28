# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.2.0: M2, higher nets

### Added

- `@pnm/expr`: expression adapter around JSONata 2.x with compilation cache, variable extraction from the AST, guard
  and output evaluation, parsing of input inscriptions, timeout and depth limits.
- `@pnm/core`: JSON nets. Types as JSON Schema (Ajv), token helpers (`tokenEquals`, `canonicalJson`, `tokenLabel`),
  binding computation with unification, guards, output inscriptions, type and capacity checks (`computeBindings`,
  `findEnabled`, `fireBinding`), net operations for types, guards, inscriptions, tokens and the net class, and the
  diagnostic codes `TYPE_UNKNOWN`, `TYPE_SCHEMA_INVALID`, `TYPE_NAME_INVALID`, `TYPE_UNUSED`, `TOKEN_TYPE_MISMATCH`,
  `INSCRIPTION_SYNTAX`, `GUARD_SYNTAX`, `VARIABLE_UNBOUND`, `WEIGHT_IGNORED`, `INSCRIPTION_ON_PT_NET`, plus the runtime
  codes `GUARD_ERROR` and `INSCRIPTION_ERROR`.
- `@pnm/web`: net class switch, type management with a JSON Schema editor and value tester, CodeMirror editors for
  inscriptions and guards (JSONata highlighting, live errors, completion), token lists and token editor, canvas labels
  for guards, inscriptions, types and tokens (View > Show inscriptions), asynchronous simulation with binding
  selection, binding history and evaluation problems in the status bar, SVG export of JSON nets.
- Examples: order processing, token ring, dining philosophers (JSON).
- Documentation: types, inscriptions and evaluation rules in `docs/format.md`, `docs/expressions.md`, ADR 0005.
- Tests: expression, binding and type tests, a property test that the JSON net rule agrees with the P/T rule on P/T
  nets, store tests for the asynchronous simulation, and Playwright tests for the JSON net workflows.

### Changed

- The simulation state holds `enabled` (transitions with their bindings) and `computing`. P/T nets are still computed
  synchronously.
- Simulation history entries carry the fired binding.

## 0.1.0: M0 and M1

### Added

- Project scaffold: pnpm workspace, strict TypeScript 5.9, ESLint (flat config), Prettier, Vitest, GitHub Actions CI
  and GitHub Pages deployment.
- `@pnm/core`: net model with places, transitions, arcs, annotations and markings; immutable net operations;
  multiset; P/T firing rule with arc weights, capacities and loops; structural validation with diagnostic codes;
  Zod-backed `.pn.json` format with stable serialization; clipboard fragments; align and distribute.
- `@pnm/layout`: automatic layered layout with ELK.
- `@pnm/web`: editor for place/transition nets with tool palette, properties panel, undo/redo, copy/paste, multi
  selection, grid snapping, minimap, auto layout, file open/save/drag-and-drop, SVG export, autosave, live
  validation, simulation mode, light and dark theme, keyboard shortcut overview.
- Example nets: producer/consumer, traffic light, dining philosophers (3), mutual exclusion.
- Documentation: README, file format description, ADRs 0001 to 0004.
- Tests: unit and property-based tests for the core, layout test, component and store tests for the web app,
  Playwright smoke tests.
