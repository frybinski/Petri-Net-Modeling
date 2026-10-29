# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.9.0: Interchange and export

Milestone M4. The file format stays `1.0`; nets of 0.8.0 work unchanged.

### Added

- **PNML** in both directions (`toPnml`, `fromPnml`, `parsePnml` in `@pnm/io`): PNML 2009 `ptnet` for places,
  transitions, arcs, weights, markings and positions; types, guards, inscriptions, timing, roles, simulation settings,
  notes, token values and the domain view in `toolspecific tool="pnm"` (JSON in CDATA), so a net survives a round trip
  unchanged. The reader takes files of ProM, pm4py and WoPeD (pages, reference places, invisible transitions, markings
  as text, inhibitor and reset arcs as notes), lays the net out when positions are missing and reports what it did not
  understand. Own XML reader without dependencies, identical in browser and Node. See [format.md](docs/format.md#pnml).
- **TikZ export** (`toTikz`): `tikzpicture` or standalone document, inline or external styles (`place`, `transition`,
  `arc`, `token`), labels, tokens as dots or numbers, guards, inscriptions, weights, grayscale. See
  [docs/tikz.md](docs/tikz.md).
- **Command line `pnm`** (`apps/cli`, one bundled file): `validate`, `simulate` (CSV, XES, metrics, events), `export`
  (svg, pnml, tikz, json), `import`, `layout`, `domain check|generic|generate`, `examples list|copy`. See
  [docs/cli.md](docs/cli.md). The CSV equals that of the app for the same seed.
- Web app: _File > Import_ and drag and drop accept `.pnml` (remarks in a dialog, the import is an unsaved document);
  _File > Export_ has _Image_ (SVG or PNG at 1x, 2x, 3x, light or dark, solid or transparent, with preview and file
  name), _PNML_, _TikZ_ (options, preview, copy, download) and _JSON_. The domain view exports as PNG from its panel and
  its context menu. Fonts are embedded in the raster. `Ctrl+Shift+E` opens the image export.
- [ADR 0012](docs/adr/0012-interchange-and-cli.md).

### Changed

- `netToSvg` moved to `@pnm/io` (new options `transparent`, `fontCss`, and `renderNetSvg` with the size); the drawing
  geometry moved to `@pnm/layout/geometry`. The direct SVG export became the _Export image_ dialog.
- The Playwright port can be set with `PNM_E2E_PORT`.

### Fixed

- The end-to-end test of unbound variables in output inscriptions no longer depends on timing under load.

## 0.8.0: Editing the domain view in place

Milestone D4. The file format stays `1.0`; nets of 0.7.0 work unchanged.

### Added

- `@pnm/domain`: handles and pure edit functions (`handlesFor`, `hitHandle`, `moveEntry`, `resizeEntry`, `setBox`,
  `movePoint`, `insertPoint`, `removePoint`, `moveSlot`, `addSlot`, `removeSlot`, `moveRoom`, `setEntryKind`,
  `setLabel`, `setSensor`, `setPass`, `hideEntry`, `showEntry`, `addDecor`, `removeDecor`, `markUser`, `resetEntry`,
  `removeStale`, `staleEntries`, `missingEntries`, `allowedPlaceKinds`, `allowedTransitionKinds`); `fillMissing` can keep
  stale entries (`dropStale: false`). A property test checks that edits keep V1, V4 and V5 satisfied and change only the
  addressed entry.
- Web app: the mode _Edit layout_ of the domain view (key `E`): selection, handles that stay crisp at any zoom, drags
  with a live preview and one undo step per drag, grid (Alt: off), Shift keeps proportions, arrow keys (Shift: 8 px),
  `Esc` cancels a drag, `Delete` hides the entry (the net keeps the element; only decor is removed), inline label
  editing, a context menu (change kind, points, slots, hide and show, reset to generic, edit JSON, add decor), dashed
  placeholders for hidden entries. Every hand change sets the origin `user`.
- The entry section of the domain panel has fields for kind, label, sensor, `pass`, geometry, points and slots; the card
  _The view is out of date_ offers _Fill missing entries_, _Remove stale entries_ and _Update hash_ as separate undo
  steps; _Reset all to generic_ and _Edit JSON_ (selects the entry in the JSON editor).
- Acceptance A8 as a script: `pnpm --filter @pnm/io check:pm4py` simulates the parcel center for two hours, exports CSV
  and XES, reads them with pm4py and checks columns, time stamps, the number of cases, the activities of the discovered
  net and the XES file. It uses the Python in `PNM_PYTHON` (a venv with `pip install pm4py pandas`). The first run is
  [docs/eval/pm4py-2026-10-28.md](docs/eval/pm4py-2026-10-28.md): all checks pass (653 cases, 9 of 9 activities).
- [ADR 0011](docs/adr/0011-domain-view-editing.md).

### Acceptance

- A7 (a new place: V3 names exactly it and V7 reports the stale view, _Fill missing entries_ adds only its entry with the
  origin `generic`, _Update hash_ clears V7) is a Playwright test.
- A8: passed with pm4py 2.7.23.11, see above.

## 0.7.0: LLM generation of the domain view

Milestone D3. The file format stays `1.0`; `domainViewGeneration` is a new optional field next to `domainView`, and nets
of 0.6.0 work unchanged.

### Added

- `@pnm/llm` (new package, no React dependency): an OpenAI-compatible provider over `fetch` (`chat`, `listModels`,
  `test`) with JSON mode negotiation (`json_schema`, then `json_object`, then plain), lenient parsing of the answer and
  classified errors (`network`, `auth`, `rate-limit`, `timeout`, `bad-response`, `parse`, `aborted`); the prompts
  (`compactNet`, `buildPrompt`, `buildRepairPrompt`) with the schema of the answer and two worked examples; and
  `generateDomainView`, which checks the answer with the rules V1 to V8, sends the findings back as a repair request (at
  most three rounds), drops what stays invalid, fills the gaps generically and keeps a log of the rounds. Every entry
  carries its provenance. A scripted provider (`@pnm/llm/testing`) drives the tests.
- `@pnm/core`: the optional net field `domainViewGeneration` (the record of how a model generated the view), passed
  through like `domainView`, written right after it and removed together with it.
- Web app: the dialog _LLM provider_ (presets for Ollama and LM Studio, custom server, model list, API key kept apart in
  `localStorage`, temperature, JSON mode, connection test, hint on `OLLAMA_ORIGINS`, notice on what is sent) and the
  dialog _Generate domain view with LLM_ (description, canvas size, progress per round, cancel or continue in the
  background, preview, origin summary, findings, log of the rounds, prompt with a copy button, _Use this view_ as one undo
  step). The domain panel shows who generated the view and opens the log, entries from a model get a badge, the hover
  card names the model, and the status bar shows a running generation. A simulation stops a running generation and the
  action is locked while simulating.
- Evaluation script for acceptance A6: `pnpm --filter @pnm/llm eval -- --base-url <url> --model <name>` generates the
  views of the parcel center and the smart office with a real model, prints the findings per round and writes a report
  and the views to `docs/eval/` ([docs/eval/README.md](docs/eval/README.md)).
- Tests: provider, prompts, repair loop (acceptance A6 with a scripted provider for both examples, repair in round 2),
  the evaluation script against a local HTTP server, settings and dialogs, and Playwright tests with a routed provider
  (V4 error in round 1, repair in round 2, log, use, origin, hover card, key kept out of saved nets, refused request,
  settings dialog).
- Documentation: the section _Generating a view with an LLM_ in [docs/domain-view.md](docs/domain-view.md), the record in
  [docs/format.md](docs/format.md) and ADR 0010.

### Pending

- Acceptance A6 with a real model: the container for development has none. Run the evaluation script against a model
  (see [docs/eval/README.md](docs/eval/README.md)) and keep the report in `docs/eval/`. Until then A6 is met by the tests
  with the scripted provider only.

### Changed

- Nothing in the behaviour of the simulation or of the strict mapping; the generation never runs during a simulation.

## 0.6.0: Animated domain view

Milestone D2. The file format stays `1.0`; nets and mappings of 0.5.0 work unchanged.

### Added

- `@pnm/domain`: `layoutTokens` (where every token stands), `applyEvents` (motions along the connectors, flashes and
  counters from the events of a bundle, with a log of handled event ids), `sampleSprites` and `sampleTokens`,
  `buildStaticScene` and `buildDynamicScene` (the picture in two layers), `stationStatus`, `queueLevel` and
  `stationInfos` (free, busy, blocked, starved; yellow and red queues), `caseTrail` and `caseActivities`, a sprite cache
  for the painter, and the new draw commands `ring` and `progress` with a tone.
- `@pnm/sim`: the view of the simulation carries the metadata of every token (`SimView.meta`), so that the animation can
  follow tokens by their id.
- Web app: the domain view runs the simulation. Tokens move along belts and connectors, stations show free, busy and
  blocked, slots show a progress ring, queues turn yellow and red with the thresholds of the key figure settings, the
  counters of sinks count up when a case arrives, and elements flash for events that move nothing. Speed _max_ and
  `prefers-reduced-motion` make tokens jump. The static layer is rendered offscreen and the loop rests when nothing moves.
- A floating bar in the domain view (_Simulate_, play and pause, step, back, reset, speed, clock, cases, _Edit_, hide), a
  strip with throughput, cycle time and cases in the system, richer hover cards (state, slots, waiting cases, mean wait,
  use of resources), following a case by a click (ring, card with its steps, `Esc` lets go), and firing an enabled
  transition by a click on it, with a list of bindings where there are several.
- Tests: the A2 log against the event stream, two hours of three nets with layout and animation (A1), the same event
  stream and exports with the view running (A3), a frame budget for 200 tokens, component tests for the bar, the loop,
  the order of bundles, following and firing, and Playwright tests for the whole run.
- Documentation: the section _Animation_ in [docs/domain-view.md](docs/domain-view.md) and ADR 0009.

### Changed

- The fit of the domain view keeps clear of the floating controls (`fitAround`).
- The net editor stops its token flights while it is hidden behind the domain view.
- `buildScene` is unchanged and still draws one state; the running view uses the two layers.

## 0.5.0: Domain view without simulation

Milestone D1. The file format stays `1.0`: `domainView` is an optional field, and nets without it behave as before.

### Added

- `@pnm/domain`: the schema of a domain view (places as conveyors, queues, buffers, resource slots, pools, sources and
  sinks; transitions as stations, machines, gates, areas, rooms, doors, docks and waypoints; scenery; provenance per
  entry; a JSON Schema export), the validation rules V1 to V8 with paths and elements, the net hash (`netHash`, FNV-1a
  64 bit), the generic mapping for any net (`genericDomainView`, `fillMissing`), a converter for the mapping format of the
  mockup, and the renderer: a pure scene builder (`buildScene`, `hitTest`, `withHighlight`) and a Canvas 2D painter
  (`paintScene`) with sprites for parcels, people, vehicles, documents and dots, belts, cards, desks, tables, doors and
  docks, in a light and a dark palette.
- `@pnm/core`: `PetriNet.domainView` (passed through as `unknown`, written after `simulation`) and `setDomainView`.
- Web app: a switch _Net | Domain | Both_ in the header (keys `1`, `2`, `3`) with a draggable divider in the split view.
  The domain view fits itself into the area, pans, zooms (wheel, `Ctrl`/`Cmd` + wheel, pinch, buttons), handles the
  device pixel ratio and follows the theme. Hovering an element shows a card and lights up its counterpart in the net,
  and the other way round; a click selects. In the simulation it shows the current marking and the firings under way.
  A net without a view offers _Generate generic view_.
- Domain panel (tab in the right panel): status with the rule results V1 to V8 (click selects the element), the origin
  of the entries (generic, user, LLM), the state of the hash, _Generate generic view_, _Fill missing entries_,
  _Update hash_, _Remove domain view_, theme, view name, entity and canvas size, the entry of the selected element and
  the whole mapping as JSON with live checks and markers in the text; _Apply_ replaces the view in one undo step and
  marks changed entries as user work.
- Examples: the parcel center is drawn as a hall and the smart office as a floor plan, both without diagnostics; the
  complaint handling has no view of its own (the generic one applies).
- Documentation: [docs/domain-view.md](docs/domain-view.md), ADR 0008, the field in [docs/format.md](docs/format.md).

### Changed

- The workspace and the right panel are components of their own; the net editor stays mounted while hidden, so its view
  and selection survive switching.

## 0.4.0: Timed simulation with an event stream

Milestone M3. The file format stays `1.0`: all new fields are optional, and nets without them behave as before.

### Added

- Model: `timing` (fixed, uniform or exponential duration), `priority` and `rate` on transitions, `role` on places and
  `simulation` settings (seed, warm-up, start time, case id prefix) on the net, with schema, validation codes
  (`TIMING_INVALID`, `PRIORITY_INVALID`, `RATE_INVALID`, `RATE_ON_NON_SOURCE`, `SOURCE_WITHOUT_RATE`,
  `ROLE_OVERRIDE_UNUSUAL`, `SIMULATION_INVALID`), net operations (`setTiming`, `setPriority`, `setRate`, `setRole`,
  `setSimulationSettings`) and the roles of places (`placeRole`, `isSourceTransition`) in `@pnm/core`.
- `@pnm/sim`: a discrete-event simulation on top of the core firing rule. Two-phase firing, durations, conflict
  resolution by priority, arrival rates, capacity reservation by running firings, case identity, seedable randomness,
  breakpoints, step back, key figures and a typed event stream. It runs in a Web Worker (`createSimulationClient`) or in
  the same thread (`createLocalClient`). A net without durations behaves exactly as the atomic firing rule.
- `@pnm/io`: the event log as CSV (`case_id, activity, timestamp, lifecycle`) and XES 1.0.
- Editor: fields for duration, priority, arrival rate, role and the simulation settings in the properties panel; a
  clock icon on transitions with a duration, a progress bar and a badge for firings under way, queue rings (yellow from 6,
  red from 10 tokens), breakpoint markers.
- Simulation panel: play and pause, step, step back, reset, speeds 1x to 60x and max, simulated clock and cases in the
  system, tabs for enabled transitions (with arrival sliders, resource buttons and breakpoints), the event trace with
  filters and export, and key figures. Tokens animate along the arcs (not with reduced motion).
- Shortcuts: `Space` play or pause, `.` step, `,` step back, `R` reset, `B` breakpoint on the selected transition.
- Examples from the domain view mockup: parcel center, smart office, complaint handling.
- Documentation: [docs/simulation.md](docs/simulation.md), ADR 0007, the new fields in [docs/format.md](docs/format.md).

### Changed

- The simulation runs in the engine instead of the editor store: clicks, random steps and resets are answered
  asynchronously. "Step (random)" now uses the seed of the net. Untimed nets still fire on a click and play at one
  firing per second.
- The simulation panel is split into the controls and three tabs; the list of fired steps keeps the latest 200.

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
- Arcs are gently curved (more for long arcs), go around nodes that are in their way, opposite arcs separate on
  their own, arrow heads end exactly on the node outline, weights and inscriptions sit in pills on the arc, guards in
  a pill above the transition. The hit area of an arc is 20 px wide and arcs highlight on hover. The SVG export follows
  the new geometry.
- The minimap (smaller and translucent) only appears while part of the net is out of view, so it no longer covers
  nodes after "fit view". Fit view keeps pixel margins for guards and names.
- The tool hint moved from a banner over the canvas into the status bar. Toasts appear in the lower right, last
  2.5 s (errors 6 s), replace each other and are only shown for results that would otherwise stay invisible.
- Node dragging snaps the node center to the grid (the top-left corner before), the right mouse button no longer pans.
- Examples: positions of the order processing and the JSON dining philosophers nets were adjusted so that arcs do not
  run through names or inscriptions.

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
