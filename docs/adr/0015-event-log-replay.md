# ADR 0015: Replay of event logs

Status: accepted · Date: 2026-10-29

## Context

Increment D5 couples the tool to real data: an event log (CSV or XES, from this tool or from others) and later a live
feed are to drive the net view, the domain view, the trace, the key figures and the check of properties, as the engine
does. The constraints: nothing above the event stream may need a second code path, the result must be exact for the logs
the tool writes itself (acceptance: the log of a run replays to the same states and key figures), logs of other tools have
their own column names, time formats and tie orders, no new runtime dependencies, and a log that does not fit the net must
be shown, not rejected.

## Decision

- **A replay is a `Simulation`.** `createReplay(net, events, options)` implements the interface of the engine (`step`,
  `advance`, `snapshot`, `restore`, `stepBack`, `reset`, `metrics`, breakpoints). `fireManually`, `editMarking` and
  `setRate` reject, `enabled()` is empty. The worker protocol gets `initReplay`, `push` and `closeFeed`; the handler
  chooses the implementation, and the store, the animation and the panels only see events and views. This is why the
  rest of the tool needed few changes: a source switch, a mapping dialog, and the display of the new event type.
- **Token replay, descriptive.** Cases enter with their first event; a start takes the tokens of its case from the input
  places (resources: any free token), and creates what is missing; a complete puts the output on the output places and
  gives resources back. The log decides what happens; the net is only asked for tokens. Guards are not evaluated unless
  `strict` is set (the tokens the activity took are tested with the guard only, through `computeBindings` on the net
  without the transition's output arcs, so that the types of the output places cannot veto it). Rozinat's and van der
  Aalst's fitness is computed from four counters that the replay keeps (consumed, produced, missing, remaining) and is
  part of the key figures; "remaining" counts tokens that finished cases (a token on a sink place) left behind, because
  a log of a running system ends with open cases that must not lower the fitness.
- **Optimal alignments were not chosen.** An alignment finds the cheapest explanation of a deviating trace, at the cost
  of a search per trace in the state space of the net. A replay that follows the log event by event is linear in the
  log, deterministic, animatable event by event and exact for logs that fit; for logs that do not, it creates tokens
  at the place and moment where the log departs, which is what the views need to point at. Alignments remain possible as
  an analysis on top of the same log.
- **Deviations are events.** `SimEvent` gets the type `deviation` (kind `missing`, `ignored` or `guard`, with case,
  transition, place and activity). Everything that listens to the stream can show it: the trace (red rows), the net view
  (a ring on the place, a count in its hover card from `ReplayStats.missingByPlace`), the domain animation (a red flash;
  `Flash.deviation`, handled-log entries of kind `flash`). A `missing` event counts the created token in the key figures
  before the start that takes it, so that no place count is ever negative. `spawn` may carry the tokens created for a new
  case. `MetricsSnapshot.replay` is optional, so the engine's snapshots are unchanged.
- **Order of events.** Events are sorted by time and, at one time, activities that end come before those that start (a
  resource that is given back is there for the next case), then the order of the file. XES is written trace by trace
  and CSV of other tools in any order; without the rule the replay of an XES export differed from the CSV replay.
  Start and complete are paired first in, first out per case and activity. A firing of several cases (an AND join of
  cases that overtook each other) is listed once per case at one time; the replay takes the oldest token of each input
  place among those cases, absorbs the other rows and, on the complete, picks the running firing whose cases are the next
  rows. With this the log of the complaint handling net (split, join, overtaking) replays to the engine's events exactly.
- **Where the code lives.** The types, the mapping and the replay are in `@pnm/sim`. `readLog` is in `@pnm/io`, not
  in `@pnm/sim` as the plan first drew it: the CSV parser and the XML reader are there, and `@pnm/io` already depends on
  `@pnm/sim` for the event type, so the other direction would be a cycle. The command line and the app import both.
- **Time zero is the first event** (the plan's default), or the start time of the net, or a time. The exported times are
  whole milliseconds, so the replay of an exported log has the engine's states and, with the start time as time 0, its
  key figures exactly when the engine's events are rounded the same way; the mean cycle time of the unrounded run differs
  by less than a millisecond.
- **The live replay caps the clock.** `advance` plays up to the latest event that has arrived and then reports `idle`
  once. Times are seconds since opening (wall clock); an event without a time is stamped now; a late event is taken at
  the present moment, so that the stream stays monotone. `autoMap` matches new activities by name as they arrive.
- **The console API is the interface of the live source**, `window.pnm.live.push` and `close`, installed while the source
  is active. A bridge from another process (WebSocket, `postMessage` of an embedded page) was not built: it needs a server
  or an agreement on origins, and the paste field plus `scripts/live-demo.mjs` (lines or a console call) cover the use.

## Consequences

- The fidelity is a test, not a hope: the log of the parcel center (2 h), the smart office (8 h) and the complaint handling
  net replays to the same states after every instant, the same events and the same key figures as the engine; the same for
  the CSV and XES export (with rounded times).
- A log that does not fit is replayable: the replay continues, the deviations are counted and shown, and the fitness
  puts a number on it.
- The rules about joins and ties are heuristics about what a log means; they are exact for the logs of the engine and
  plausible for others. They are written down in [replay.md](../replay.md) with the limits.
- Replays inherit the history of the engine (500 steps back) and its event log limit; very long logs are better replayed
  on the command line.
- Because a replay never evaluates output inscriptions, the data of a JSON net's tokens comes from the log and from the
  tokens the case already carries; a replay says nothing about whether the net's inscriptions would produce them.
