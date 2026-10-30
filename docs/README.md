# Documentation

An index of everything in `docs/`. The README in the repository root is the first contact; this is the map behind it.

## Using the tool

| Document                                   | What it is                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| [format.md](format.md)                     | The `.pn.json` format, types, inscriptions, evaluation rules, validation codes, the P/T firing rule and PNML.           |
| [expressions.md](expressions.md)           | A short guide to guards and inscriptions (JSONata) for modelers.                                                        |
| [simulation.md](simulation.md)             | Durations, resources, arrivals, cases, quantity places, key figures and indicators, the event log, controls and limits. |
| [replay.md](replay.md)                     | Replay of event logs (CSV, XES) and live feeds on a net: formats, mapping, rules, fitness, deviations, live API.        |
| [domain-view.md](domain-view.md)           | The domain view: the mapping and its rules, drawing, animation, editing in place and generation by a language model.    |
| [analysis.md](analysis.md)                 | Structure, invariants, state space, coverability, DECLARE and LTLf properties, counterexamples, event logs and limits.  |
| [tikz.md](tikz.md)                         | The TikZ export for LaTeX: styles, options and what the output looks like.                                              |
| [cli.md](cli.md)                           | The command line `pnm`: install from a release or build, every command with its options and exit statuses.              |
| [server.md](server.md)                     | The server: web app, language model proxy, HTTP interface, project store, security, settings and what the app adds.     |
| [../deploy/README.md](../deploy/README.md) | Setting up the server with Docker Compose: registry, ingress, update, backup, key rotation, troubleshooting.            |
| [limitations.md](limitations.md)           | What 1.3.0 does not do, with the reason for each limitation and the way forward.                                        |

## Decisions

The [architecture decision records](adr) say why the tool is built as it is. Each has a context, the decision and its
consequences.

| Record                                                     | Decision                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [0001](adr/0001-monorepo-typescript.md)                    | A pnpm monorepo with strict TypeScript, and a UI-independent core.                        |
| [0002](adr/0002-react-flow-canvas.md)                      | React Flow (xyflow) as the canvas of the net editor.                                      |
| [0003](adr/0003-json-net-profile.md)                       | One document format with a JSON net profile; P/T nets are the special case.               |
| [0004](adr/0004-document-history.md)                       | Undo and redo as a snapshot stack over the immutable net.                                 |
| [0005](adr/0005-jsonata-expressions.md)                    | JSONata for guards and inscriptions behind `@pnm/expr`, and the limits of its safety net. |
| [0006](adr/0006-radix-primitives-and-self-hosted-fonts.md) | Radix primitives for accessible components and fonts bundled with the app.                |
| [0007](adr/0007-discrete-event-simulation.md)              | A discrete-event simulation in a Web Worker with two-phase firing and an event stream.    |
| [0008](adr/0008-domain-view-mapping.md)                    | The domain view is a checked, declarative mapping drawn on a canvas.                      |
| [0009](adr/0009-domain-animation.md)                       | The domain view animates by the difference of layouts, linked through the events.         |
| [0010](adr/0010-llm-mapping-generation.md)                 | A language model proposes the mapping, the rules decide.                                  |
| [0011](adr/0011-domain-view-editing.md)                    | Editing the domain view in place with pure edit functions.                                |
| [0012](adr/0012-interchange-and-cli.md)                    | PNML, image and TikZ export, and the command line as one bundled file.                    |
| [0013](adr/0013-analysis-and-verification.md)              | An explicit state space, Karp-Miller, exact invariants and DECLARE/LTLf by automata.      |
| [0014](adr/0014-parts-load-on-demand.md)                   | Parts that most sessions never open (analysis, domain view, exports, LLM) load on demand. |
| [0015](adr/0015-event-log-replay.md)                       | An event log is replayed as a simulation: token replay, deviations as events.             |
| [0016](adr/0016-server.md)                                 | A small server on node:http: files, threads with hard limits, a positive-list proxy.      |
| [0017](adr/0017-quantity-places-and-indicators.md)         | A role for amounts (tokens without a case) and indicators defined in the net.             |

## Plans

The plans of the increments, in German, written before the work and kept as the record of what was decided.
[PLAN.md](../PLAN.md) in the repository root is the overall plan and its status.

| Plan                                                               | Content                                                                                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [M0-M1](plan/M0-M1_Umsetzungsplan.md)                              | Project scaffold and the editor for place/transition nets.                                                             |
| [M2](plan/M2_Umsetzungsplan.md)                                    | Higher nets: types, inscriptions and guards.                                                                           |
| [UI-Polish](plan/UI-Polish_Umsetzungsplan.md)                      | Operation and appearance of the editor; the proposals before it are in [UI_Verbesserungen](plan/UI_Verbesserungen.md). |
| [M3](plan/M3_Umsetzungsplan.md)                                    | Timed simulation with an event stream.                                                                                 |
| [Domänenansicht](plan/Domaenenansicht_Einordnung.md)               | Assessment of the domain view and its place in the plan (D1 to D5).                                                    |
| [D1](plan/D1_Umsetzungsplan.md) to [D4](plan/D4_Umsetzungsplan.md) | The domain view: mapping, animation, LLM generation and editing.                                                       |
| [M4](plan/M4_Umsetzungsplan.md)                                    | Interchange and export: PNML, images, TikZ and the command line.                                                       |
| [M5](plan/M5_Umsetzungsplan.md)                                    | Analysis and verification.                                                                                             |
| [Release 1.0](plan/Release-1.0_Umsetzungsplan.md)                  | The limitations, the consolidation and the release workflow of 1.0.0.                                                  |
| [D5](plan/D5_Umsetzungsplan.md)                                    | Replay of event logs and live feeds: the simulation with a second source.                                              |
| [M6](plan/M6_Umsetzungsplan.md)                                    | The server next to Ollama: proxy, interface, project store, image, Compose and ingress.                                |
| [N1](plan/N1_Umsetzungsplan.md)                                    | The sustainability example: quantity places, indicators and the bicycle frame production.                              |

## Material

- [eval](eval): the evaluation of language models for the domain view (acceptance A6, to be run with a real model) and of
  the event log export with pm4py (acceptance A8, [report of 2026-10-28](eval/pm4py-2026-10-28.md)).
- [images](images): the screenshots of the README, made with `scripts/screenshots.mjs`, and [images/review](images/review),
  the eleven examples at three zoom levels and two window widths.
- [mockups](mockups/domaenenansicht.html): the HTML mockup of the domain view from which D1 started.
- [Changelog](../CHANGELOG.md) and [license](../LICENSE).
