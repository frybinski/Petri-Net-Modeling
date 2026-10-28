# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.3.0: UI polish

Interaction and appearance only: no change to the net semantics or the file format.

### Added

- Tooltips with keyboard shortcuts on the toolbar, header, zoom buttons and panel icons (400 ms delay).
- Right-click context menus for places, transitions, notes, arcs, groups of elements and the empty canvas.
- Inline editing: double click or `F2` renames places, transitions and notes in place; a double click on an arc edits
  its weight (P/T nets) or its inscription (JSON nets) at the label.
- Sticky tools: double click a tool to keep it active until `Esc` or `V`; a dot marks it.
- Drawing arcs by dragging from an invisible ring around a node; `Alt` + drag works from anywhere on the node. Targets
  that cannot be connected are outlined in red.
- Keyboard building: `Tab` adds the next node of the other kind, connects it and starts naming it, `Shift+Tab` adds the
  previous node, `Enter` adds a node of the active tool in the middle of the view. A net can be built with the
  keyboard alone, one undo step per node.
- Hover card on nodes (300 ms): name, type, up to ten tokens, guard, bound variables and, while simulating, the
  number of bindings.
- Semantic zoom: below 70 % types, token chips, inscriptions, guards and capacities fade out, below 40 % the names
  too; names keep a readable size on screen.
- Zoom button in the status bar (click or `Ctrl+0` resets to 100 %), double click on the empty canvas fits the view,
  the net is refitted when the window changes size until the user zooms, wheel pans and `Ctrl`/`Cmd` + wheel or pinch
  zooms (View > Scroll to zoom switches the wheel to zoom).
- Confirmation before deleting five or more elements; the delete button is an icon in the panel heading.
- Documentation: ADR 0006 (Radix primitives, self-hosted fonts), mouse gestures in the shortcut dialog.

### Changed

- Typography: Inter Variable for the interface and JetBrains Mono Variable for expressions and tokens, both bundled
  (nothing is loaded from external hosts). The panel base size is 13 px.
- Nodes are 44 px circles and 44 x 64 px transitions drawn with a 1.75 px outline, a soft selection halo, a hover
  shadow, a pulsing outline for enabled transitions and a warning sign for errors. New nodes pop in.
- Tokens are up to six dots in a fixed arrangement, JSON nets show a count in the circle and the type as a badge;
  token chips appear next to a selected place and in the hover card instead of permanently under the node.
- Arcs are gently curved (more for long arcs), opposite arcs separate on their own, arrow heads end exactly on the node
  outline, weights and inscriptions sit in pills on the arc, guards in a pill above the transition. The hit area of an
  arc is 20 px wide and arcs highlight on hover. The SVG export follows the new geometry.
- The tool hint moved from a banner over the canvas into the status bar. Toasts appear in the lower right, last
  2.5 s (errors 6 s), replace each other and are only shown for results that would otherwise stay invisible.
- Node dragging snaps the node center to the grid (the top-left corner before), the right mouse button no longer pans.
- Examples: positions of two nets were adjusted so that arcs do not run through names.

### Fixed

- Escape on a focused node selected it again.
- Destroying a focused code editor counted as leaving the field.

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
