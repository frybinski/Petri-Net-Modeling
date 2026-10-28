# ADR 0007: Discrete-event simulation in a worker, with two-phase firing

Status: accepted · Date: 2026-10-28

## Context

Until 0.3.0 the simulation fired transitions atomically in the editor store: the marking changed in one step, there was
no time, and the random step used `Math.random`. The planned domain view needs a clock, durations, parallel firings,
resources, arrival rates, the identity of cases and a stream of events to animate, to measure and to export as an event
log. It must keep the atomic rule as the special case, run without blocking the page, and be reproducible.

## Decision

A new package `@pnm/sim` (depends on `@pnm/core` only) runs nets as a discrete-event simulation.

- **Two-phase firing on the core rule.** The enabled transitions and their bindings come from `findEnabled`; the engine
  does not evaluate guards or inscriptions itself and has no second firing rule. A binding already separates `consumes`
  and `produces`: `consumes` is applied when the firing starts, `produces` when its duration has passed. With every
  duration 0 both happen at one instant, which equals `fireBinding`. A test runs random walks over every example of
  the earlier milestones with both and compares enabled bindings and markings.
- **Capacity reservation.** The core checks capacities on the marking after the firing. With a delay between start and
  end that is not enough: three firings started while a buffer is empty would overfill it. The engine therefore also
  counts the output of running firings per place and refuses a binding that would exceed a capacity with it.
- **Events instead of a state that is polled.** The engine returns events (`spawn`, `start`, `complete`,
  `marking-edited`, `breakpoint`, `idle`, `warning`). The trace, the animation, the key figures (`createMetrics`) and
  the CSV and XES export (`@pnm/io`) are all computed from that stream. The later domain view listens to the same
  stream.
- **Case identity as metadata.** Tokens stay plain values (`1` in P/T nets); the engine keeps `{id, caseId, enteredAt}`
  parallel to the marking. Cases are inherited from the first consumed token with a case; resource tokens have none.
  The structure of the net decides the roles (source, sink, resource, case); a place can override resource and case.
- **Determinism.** One seeded generator (mulberry32) drives durations, arrivals and conflict resolution; all sets are
  traversed in the order of the net and of the core's sorted bindings. The same seed gives the same stream and the same
  export, and stepping back restores the generator.
- **History as cheap snapshots.** State is immutable by convention (arrays are replaced, never changed), so a snapshot
  copies a few records. The engine keeps 500 of them for _Back_; metrics store only counts and lengths (cases are an
  append-only list), so rewinding costs the same however many cases there are.
- **Worker and a small typed protocol.** The engine runs in a Web Worker started with
  `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`, which Vite bundles as its own chunk. The
  protocol has one request type with a command name and one result type with the events and a view of the state. The
  same handler also runs in the page (`createLocalClient`) for tests, Node, and browsers that refuse workers. The
  client serialises requests, so answers arrive in the order of the calls.
- **Time advances by wall-clock ticks.** The editor asks the worker to advance by `dt * speed` simulated seconds per
  tick (`dt` at most 100 ms) and never sends a new request while one is open. `max` uses bundles of 200 events.
  Breakpoints are checked in the worker, so a run stops exactly where it should.

## Consequences

- The editor store no longer computes bindings itself; every simulation action is asynchronous and answered by a view
  of the state. Tests of the store wait for the answers.
- The simulation costs a worker and about 260 kB of bundle (the core, with Ajv and JSONata, is needed in the worker for
  JSON nets). The parcel center runs two simulated hours in well under a second.
- Cases in P/T nets are matched by order, so an AND join can combine tokens of different cases when they overtake each
  other. Solving that needs coloured tokens and is left to JSON nets (the case could then come from a token field).
- A transition has no capacity of its own. Parallelism is limited by resource places, which keeps the net the single
  source of behaviour.
- The event log grows with the run; the editor keeps the newest 200 000 events.
