# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 1.2.0: Server

Milestone M6. The tool can run on a server for a group: it serves the web app, passes language model requests on with a
key that only the server knows, offers the functions of the command line over HTTP, and stores projects with versions
and share links. The app on GitHub Pages and local use are unchanged; the server functions appear only when the app is
served by a server. The file format stays `1.0`. How it works is in [docs/server.md](docs/server.md), how to set it up in
[deploy/README.md](deploy/README.md), why it is built this way in [ADR 0016](docs/adr/0016-server.md), the plan in
[docs/plan/M6_Umsetzungsplan.md](docs/plan/M6_Umsetzungsplan.md).

### Added

- **Server (`apps/server`, `@pnm/server`).** A program on `node:http` with a small router and no runtime dependency,
  bundled with esbuild to `dist/server.js`. It is configured by `PNM_*` variables (checked at the start, all problems
  listed), logs one JSON line per request without content, stops gracefully on SIGTERM, and has the commands
  `check-config` and `hash-password`.
- **Web app delivery** with cache headers (immutable hashed assets, `no-cache` for `index.html`), gzip, a content security
  policy, `nosniff`, `Referrer-Policy`, `frame-ancestors 'none'`, and the SPA fallback. The page `/s/<token>` is the app.
- **Who may use it.** `PNM_ALLOWED_NETS` checks the client address (loopback always passes); `X-Forwarded-For` counts only
  from `PNM_TRUSTED_PROXIES`, read from the right. Optional passwords for the instance (`PNM_BASIC_AUTH`, scrypt), a check of
  the `Host` header against DNS rebinding, `application/json` and the `Origin` for every change.
- **LLM proxy.** `POST /llm/v1/chat/completions` and `GET /llm/v1/models` are passed to `PNM_LLM_BASE_URL` (Open WebUI at
  `…/api`, Ollama at `…/v1`) with the key added and never returned or logged, only the usual request fields, an optional
  list of models, streaming, two requests at a time with a queue of ten and 429 beyond it, a time limit of 180 s, and one
  log line per request with model, duration, token counts and status. Everything else below `/llm/` is 404.
- **Interface for tools.** `/api/v1/validate`, `simulate`, `replay`, `analyze`, `check`, `convert`, `layout`,
  `domain/check`, `domain/generic` and `domain/generate`, with the results of `pnm … --json` (compared with the command
  line in the tests), a pool of `worker_threads` with a hard time limit (the thread is ended), a memory limit, a queue
  and 504/503/422 answers, one error format, and `GET /api/v1/openapi.json` (checked against the routes).
- **Project store.** `GET/POST /api/v1/projects`, `GET/PUT/DELETE /api/v1/projects/<id>`, versions, share links (read, or
  read and write, renewable, removable), a trash for 30 days. Versions are immutable files; saves are atomic and need
  `If-Match` (409 with the current version, 428 without); old versions are thinned out beyond `PNM_MAX_VERSIONS`; a crash
  at any point leaves the project readable.
- **Web app in server mode.** Detection by `GET /api/health` on pages that the server marked with `<meta name="pnm-server">` (elsewhere the app asks nothing); _File > Open from server_, _Save to server_ (`Ctrl+S`; the
  file is `Ctrl+Shift+S`), _Versions_ (with the element counts compared with the editor), _Share_, the trash, a conflict
  dialog on 409, the status bar with the server and the project, share pages `/s/<token>` (read-only blocks saving to the
  project and offers a copy), and the LLM preset _Server (Ollama)_ with no key field and the models of the server.
- **Deployment.** `deploy/Dockerfile` (two stages, non-root, port 8080, health check), `deploy/compose.yaml` (image from the
  registry with a fixed version, no published port, external network of the ingress, read-only root, no capabilities),
  overlays for Traefik labels and for the network of Open WebUI, `deploy/compose.local.yaml` with a stand-in for the model
  server, `deploy/.env.example`, `deploy/smoke-test.sh`, and `deploy/README.md` (registry login, `.env`, ingress entries for
  Traefik and nginx, update and rollback, backup, the service account and key rotation, the GitLab mirror, troubleshooting).
- **Pipelines.** `.gitlab-ci.yml` for the mirror in KIT GitLab (checks, image with kaniko, push of `<version>`,
  `<version>-<sha>` and `latest` on tags), `.github/workflows/image.yml` as the alternative that pushes from GitHub (does
  nothing unless `KIT_REGISTRY_IMAGE` is set), and a job in `ci.yml` that builds the image on every push and pull request
  and runs `deploy/smoke-test.sh` against the container.
- **Tests.** 274 tests for the server (configuration, filter, static files, proxy against the fake model server, every
  endpoint against the command line, pool with timeout and memory limit, store with a failing disk, pipeline files), 67
  for the app (client, actions, dialogs, share page, language model preset), and a Playwright project that runs the real
  server process with the built app (11 tests: policy, saving, versions, two people and a conflict, links, trash, model).
  In all: 2086 unit and component tests (1745 before), 23 tests of the release scripts and 116 Playwright tests (105
  before). The web unit suite ran three times next to a full Playwright run without a failure.

### Changed

- The commands of `pnm` call the new library `apps/cli/src/lib` (exported as `@pnm/cli/lib`) and only read arguments and
  print. The output of about 190 command runs on the examples (stdout, stderr, exit status) is identical to 1.1.0.
- `buildCli` takes the output file as an argument.
- `Ctrl+S` saves to the server when the app has one (to the file otherwise); `Ctrl+Shift+S` always saves to the file.
- Limitations 8, 22 and 23 are fixed in server mode (see [docs/limitations.md](docs/limitations.md)).
- All packages are at version 1.2.0.

### Fixed

- Found by running the real app under the content security policy: the fonts that the build inlines as `data:` URIs
  needed `font-src data:`.
- Found in the review: behind the ingress an empty `PNM_TRUSTED_PROXIES` made the filter see the Docker address of the
  ingress for every request, and that address is in the private default ranges of `PNM_ALLOWED_NETS`, so everybody
  passed. `deploy/compose.yaml` now requires the variable (`compose.local.yaml` is standalone and does not), the server
  logs the warning `forwarded header ignored` once per start when `X-Forwarded-For` comes from a peer that is not a trusted
  proxy, and the guide says that the ingress must set the header itself.

## 1.1.0: Replay of event logs

Increment D5. The simulation gets a second source: an event log (CSV or XES, from this tool or from others) or a live
feed drives the net, the domain view, the trace and the key figures instead of the engine. The file format stays `1.0`;
nets of every earlier version work unchanged. The rules, formats and limits are in [docs/replay.md](docs/replay.md), the
decisions in [ADR 0015](docs/adr/0015-event-log-replay.md).

### Added

- **Replay engine (`@pnm/sim`).** `createReplay(net, events, options)` has the interface of the engine. Cases enter with
  their first event, activities take the tokens of their case and put tokens on the next places at the times of the log;
  resources are given back; joins of cases that overtook each other, logs with only ends (`zero` or `span`), tokens of the
  initial marking and JSON nets are handled. Where the log does not fit, tokens are created and **deviation events**
  (`missing`, `ignored`, `guard`) are emitted. The key figures get the **token replay fitness** of Rozinat and van der
  Aalst with tokens created, left behind, events skipped and cases open. The log of an engine run of the parcel center
  (2 h), the smart office (8 h) and the complaint handling replays to the same states, events and key figures.
- **Reading logs (`@pnm/io`).** `readLog` reads the CSV of this tool and other CSV files (any column names, comma,
  semicolon or tab, ISO or Unix times, optional lifecycle) and XES; `autoMapActivities` (`@pnm/sim`) proposes the
  transition of each activity by name, normalised name, id and unique beginning.
- **Live replay.** `createLiveReplay` takes events while it runs and waits for the next; `push`, `close`, events without
  a time happen now. The worker protocol has `initReplay`, `push` and `closeFeed`.
- **App.** A source switch (_Engine_, _Log_, _Live_) in the simulation panel; _File > Replay event log..._ and dropping a
  CSV or XES file open the **mapping dialog** (columns for foreign CSV, activity to transition with automatic matches,
  options for ends without a start, time zero, warm-up and guards, preview of events, cases and span). The controls,
  speeds, back, breakpoints, trace and key figures work as in a run; what belongs to the engine is hidden. Deviations
  are red rows in the trace, a red ring around the place for a second with a count in its hover card, a red flash in the
  domain view, and the card _Replay_ in the key figures with a one-click check of the properties on the replayed log.
  The live source takes pasted lines and, while it is active, `window.pnm.live.push([...])` and `close()` in the browser
  console.
- **Command line.** `pnm replay <net> <log>` prints fitness, deviations by kind and place and the key figures, with
  `--map`, `--ignore`, `--complete-only`, `--time-origin`, column options, `--check-guards`, `--csv`, `--xes`,
  `--metrics`, `--json` and `--strict`.
- **`scripts/live-demo.mjs`** lets cases walk through the smart office with random durations and prints their events as
  lines to paste, as a console call or as JSON.
- Documentation: [docs/replay.md](docs/replay.md) (with the example of a smart-office device log for chapter 9 of the
  thesis), ADR 0015, limitations R1 to R6.

### Changed

- `SimEvent` has the new type `deviation`, `spawn` can carry the `tokens` a replay created for a new case, and
  `MetricsSnapshot` has the optional field `replay`. Consumers of the stream that switch over the event type (the
  trace, the domain animation, the key figures) handle it; the engine's events are unchanged.
- The simulation panel shows the source first; the key figures and the trace know deviations.
- `docs/cli.md`, `docs/domain-view.md`, `docs/analysis.md`, `docs/simulation.md`, the README and `PLAN.md` mention the replay.
- All packages are at version 1.1.0.

## 1.0.0: Release

The first stable release. It adds no feature: it works through the limitations that the earlier increments recorded,
loads the parts that most sessions never open on demand, consolidates the documentation and prepares the release on
GitHub. The file format stays `1.0`; nets of every earlier version work unchanged. The numbers in brackets are those of
the [release plan](docs/plan/Release-1.0_Umsetzungsplan.md); what stays a limitation is listed with its reason in
[docs/limitations.md](docs/limitations.md).

### What 1.0.0 contains

- **Editor.** Places, transitions and arcs with weights, tokens and capacities; rubber-band selection, align and
  distribute, grid, minimap, undo and redo, copy and paste, automatic layout with ELK, keyboard-first drawing, hover
  cards and zoom levels that fade details out. Files as `.pn.json` (drag and drop, autosave to IndexedDB), live
  validation with click-to-select, light and dark theme, self-hosted fonts and accessible components.
- **Net classes.** Place/transition nets and **JSON nets**: tokens are JSON values, places carry JSON Schema types,
  input arcs bind variables and guards and output inscriptions are JSONata expressions, with code editors, completion,
  a type manager and computed bindings. A P/T net is the special case without them.
- **Simulation.** `@pnm/sim`, a seeded discrete-event engine in a Web Worker: durations, priorities, arrival rates,
  resources, cases, two-phase firing, speeds from 1x to max, step back, breakpoints, a trace, key figures (throughput,
  cycle time, queues, utilisation) and the event log as CSV and XES.
- **Domain view.** The net drawn as what it models (a hall, a floor plan, a generic process) from a declarative mapping
  that is stored with the net and checked by eight rules; animated from the event stream, editable by dragging in the
  picture, and generated on request by an LLM through any OpenAI-compatible server, with the net alone deciding the
  behaviour.
- **Interchange.** PNML in both directions (files of ProM, pm4py and WoPeD are read, with remarks), SVG, PNG and TikZ
  export, and the command line `pnm`.
- **Analysis.** `@pnm/analysis`: structure, invariants, state space with boundedness, deadlocks and liveness,
  coverability, and properties as DECLARE templates or LTLf checked on the state space with shortest counterexamples
  and on simulation logs, in a Web Worker.
- **Command line.** `pnm` validates, simulates, analyzes, checks, exports, imports and lays out nets and works with
  domain views, as one file for Node 22 (`pnm-1.0.0.js`, attached to the release with its SHA-256 sum).

### Changed (the limitations that were fixed)

- **The start of the app is much smaller (7).** The layout engine, the domain view, the analysis, the export formats and
  the LLM dialogs are separate chunks that load when they are first used. The JavaScript that the page fetches at
  start drops from 4286 kB to 1189 kB (1269 kB to 351 kB gzipped), the entry chunk from 1390 kB to 669 kB (409 kB to
  190 kB gzipped). A test walks the static imports from the entry point and fails when one of the parts comes back.
  JSONata and Ajv stay in the start, as the validation needs them at once.
- **Fit view fills the canvas (1).** It zooms in to 200 % instead of 125 %, so small nets use a full-HD canvas. The zoom
  levels that fade out details are unchanged.
- **Arcs keep clear of guard pills (2).** The pills are obstacles for the routing in the editor and in the SVG export,
  like nodes, and have a ring in the color of the canvas. Arcs that leave a transition below its pill bend away from it
  (the token ring example).
- **Copy and paste between nets (6).** A copied fragment carries the types its places refer to. Pasting adds the missing
  ones, reuses the equal ones and stores a type whose name is taken by another schema as `Name_2` (type names allow only
  letters, digits and underscore), and a toast says what happened.
- **A click right after the start of the simulation counts (10).** It is kept until the engine has answered for the
  first time and then carried out (one click at most, the last).
- **The warm-up shows its progress (11).** Until it is over, the metrics tab shows a bar with the clock, for example
  _Warm-up 4:12 of 20:00_, and a link to the setting.
- **A slot is reserved until its case arrives (14).** In the domain view the slot of a starting firing is hatched and has
  no progress ring while the case still moves along the connector; the ring starts with the arrival.
- **Full is not blocked (15).** A station with every slot in use and a few cases waiting is _busy-full_ (amber). It is
  _blocked_ (red) when the waiting cases reach the yellow limit of the queues (6 by default, the limit of the key
  figure settings).
- **Delete never removes a net element from the domain view (16).** In Inspect mode it does nothing and says so; in
  Edit layout it hides the entry, as before. With only the domain view shown, `Tab` and `Enter` do not change the net.
- **Keyboard in the domain view (17).** In Edit layout `Tab` and `Shift+Tab` select the entries in turn and scroll them
  into view, `Enter` opens the label.
- **The net editor is not mounted behind the domain view (18).** In the Domain view during a timed simulation (parcel
  center, 10x, 6 s, Chromium without GPU) the main thread is busy for 2068 ms instead of 3296 ms, and the hidden editor
  no longer takes 681 DOM changes.
- **Dragging in Edit layout redraws only the dragged entry (19).** The entries that move leave the static layer once and
  are drawn on their own layer. Per pointer move the script time drops from 4.7 ms to 1.1 ms and the whole task from
  11.9 ms to 7.7 ms (median of three runs of 150 moves on the parcel center).
- **A person looks like a person (21).** Shoulders and a lighter head instead of a capsule with a dot, and the routes of
  the smart office no longer run through its waypoints.
- **Fill missing entries only adds (24).** The action list has the same two actions as the card: _Fill missing entries_
  (purely additive) and _Remove stale entries_, each its own undo step.
- **PNG with letters beyond Latin-1 (26).** The Latin Extended subset of Inter and JetBrains Mono is embedded when a
  text needs it (Łódź, Příliš, İstanbul); without such a letter the PNG stays as small as before.
- **Vacuous checks suggest a way out (29).** When no run ends in a deadlock, the properties card says so and switches the
  end states to _any marking_ with one click.
- **The analysis has a time limit (30).** A field next to the state limit (5 to 300 s, default 10) is used by the
  exploration and by the check.
- **Unused string removed (31).** `en.llm.badgeLlm`.

### Documented

Kept as limitations, with reasons and the way forward in [docs/limitations.md](docs/limitations.md): Tab with a selected
node (3), the tooltip after a jumping pointer (4), tight names at 57 % (5), the time limit of JSONata in a native regular
expression (8), AND joins of different cases in P/T nets (9), the event log of 200 000 events, now with a toast (12),
back and reset that jump (13), a resource place that edits its station, now with a note (20), a local provider from an
HTTPS page, now with a warning (22), the API key in the browser (23), the command line of 5 MB (25), PNML page offsets
from nodes only (27) and the skeleton of JSON nets in structure and invariants (28).

### Release

- `.github/workflows/release.yml` runs on tags `v*`: install, lint, typecheck, tests, build, then it attaches
  `pnm-<version>.js` with its SHA-256 sum to a GitHub release whose notes are the matching section of this file
  (`scripts/release-notes.mjs`, `scripts/release-assets.mjs`, tested with `pnpm test:scripts`). Started by hand it takes
  `dry_run` (the default) and `version`, does everything except creating the release and keeps the files as an artifact.
  The web app is still deployed from `main`.
- [docs/cli.md](docs/cli.md) has an install section for the downloaded file.
- Documentation consolidated: the README starts with what the tool is, a table of the features and the quick start;
  [docs/README.md](docs/README.md) indexes every document, decision record and plan; the screenshots are made again
  (`scripts/screenshots.mjs`). `pnpm audit --prod` reports no known vulnerabilities.
- Verification: 1613 unit and component tests (1547 before), 13 tests of the release scripts and 100 Playwright tests
  (98 before). The Playwright suite ran three times in a row and the web unit suite three times next to a Playwright
  run, without a failure; one drag test that failed once in the first series (it assumed 100 % zoom) now sets the zoom
  itself.

## 1.0.0-rc.1: Analysis and verification

Milestone M5. The file format stays `1.0` and gains the optional field `properties`; nets of 0.9.0 work unchanged.

### Added

- **`@pnm/analysis`**: structure (incidence matrix, state machine, marked graph, free choice, siphons and traps,
  Commoner's condition), place and transition invariants (minimal semi-positive, `bigint`, capacities as complement
  places), the state space with boundedness, deadlocks and shortest witnesses, liveness classes, reversibility and home
  states (P/T nets on count vectors, JSON nets through `findEnabled`, one edge per binding), the Karp-Miller coverability
  graph with ω, 21 DECLARE templates as explicit automata, an LTLf parser, direct evaluation and translation to minimal
  automata, the check on the state space (product search, shortest counterexamples, deadlock, marking or prefix end
  states, vacuous truth and infinite runs reported), conformance on event logs (share of satisfying cases, activations),
  and a worker with progress and cancellation. See [docs/analysis.md](docs/analysis.md) and
  [ADR 0013](docs/adr/0013-analysis-and-verification.md).
- Web app: the **Analyze** tab (key `Y`) with cards for structure, invariants, state space and properties; a property
  editor for templates and LTLf formulas (CodeMirror with syntax check and completion); results marked out of date after
  edits; counterexamples and deadlock witnesses as clickable traces and a **Replay** that plays them in the untimed
  simulation and checks the end; the state space as a graph dialog (ELK layered layout with routed edges).
  The right panel has a tab strip in every view.
- Command line: `pnm analyze` and `pnm check` (DECLARE, LTLf, end states, event logs, JSON output, exit status 1 for a
  violated property).
- `@pnm/core`: the optional net field `properties` (passed through; `setProperties`); PNML keeps it. `@pnm/io`:
  `parseEventLogCsv` reads what `toEventLogCsv` writes. `@pnm/layout`: `layoutGraph` for any directed graph.
- Examples: order processing, dining philosophers and parcel center carry stored properties.

### Changed

- The simulation can start without time (`startSimulation({ untimed: true })`) to replay analysis traces.

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
