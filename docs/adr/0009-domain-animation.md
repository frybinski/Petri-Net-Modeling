# ADR 0009: The domain view animates by the difference of layouts, linked through the events

Status: accepted · Date: 2026-10-28

## Context

The static domain view of 0.5.0 (ADR 0008) shows a state. Step D2 makes it show the run: cases that move along belts,
stations that are busy or blocked, queues that turn yellow and red, counters that count up. Three things must hold. The
simulator runs in a Web Worker and delivers bundles of events at its own pace; it must never wait for the picture. The
picture must not invent anything: what moves must be caused by an event, and an event at a visible element must show.
And hundreds of cases at 60 frames per second must stay cheap in a browser, with the same code usable in tests.

## Decision

- **Layout difference instead of choreography.** The picture does not script a sequence of moves per event type. A pure
  function, `layoutTokens`, places every token of a simulation state (on a belt from the head backwards, on the slot of
  its firing, on a route). `applyEvents` takes the layouts before and after a bundle and makes a motion for every token
  whose place changed. The events only _link_ the two: a `start` takes a token from its place onto a slot, a `complete`
  puts it on the next place, and chains inside one bundle become one route. Whatever the bundle size (0.1 s or 90 s) the
  picture ends in the layout of the state, and the motions only differ in how much is shown on the way.
- **Token identity from the simulation.** Tokens on places are known by `TokenMeta.id`. While a firing runs its cases
  are on no place, so the sprite continues under `f<firing>:<case>`. The view of the simulation (`SimView.meta`) carries
  the metadata of all tokens next to the marking; a state without metadata gets ids made from place and position.
- **A log of handled event ids.** The animation state records for every event at a visible element what became of it:
  `motion`, `flash`, `counter` or `hidden`, and every motion, flash and counter carries the id of its event. This is the
  proof of acceptance A2 and a unit test over 30 simulated minutes of the parcel center, in several bundle sizes: no
  event is lost, no animation is without an event. Elements that are `hidden` in the mapping create nothing, which the
  log states instead of staying silent.
- **Static and dynamic layer.** The part of the picture that depends on net and mapping only (sheet, scenery, belts,
  cards, connectors, labels, hit regions) is `buildStaticScene` and is rendered once into an offscreen canvas, again 80 ms
  after the last change of the zoom, the palette or the net. Everything that changes (queue colors, station states,
  cells, rings, counters, sprites, flashes, the followed case, hover) is `buildDynamicScene`, built every frame from the
  layout and the animation state. `buildScene` of D1 stays as it is for a picture of one state. Sprites are drawn from a
  cache of pre-rendered images; the painter takes the cache as a parameter and touches no DOM.
- **The loop rests.** `requestAnimationFrame` runs only while the simulation plays or something moves, flashes or counts
  up. Everything the frame reads is in refs and plain objects, so a frame never waits for React or the worker.
  Bundles are processed synchronously on arrival, in order; the work per bundle is small and bounded: at most 60
  simultaneous motions (further ones jump but are logged), one flash per element, a log cut to a fixed length.
- **Wall-clock time for moves, simulation time for progress.** A move lasts 300 ms of wall-clock time at every speed.
  Progress rings and cases on a route (`pass`) follow the simulation time, which the animator extrapolates between two
  bundles from the speed (never past the next event and never more than a quarter of a second ahead).
- **Less motion on request.** Speed _max_ and `prefers-reduced-motion` give every duration 0: tokens jump, nothing
  flashes, counters show the new number at once. Colors, cells and counters still follow the events.
- **Station state and queue colors from existing facts.** A station is blocked when all its slots are in use and cases
  wait in front of it; queues turn yellow and red at the limits of the key figure settings. Nothing is added to the net.
- **Following a case from the stream.** `caseTrail` filters the event stream for one case. The card, the ring around
  the sprite and the frames around the stations visited are built from it, so following needs no state in the engine.
- **The view reads, the net decides.** The animator only reads the simulation state and events. A test runs the same
  seed in different bundle sizes with layout, animation and frames after every bundle and compares the event stream and
  the CSV and XES exports with a run without the view (acceptance A3).

## Consequences

- A case that is taken again within one bundle (it leaves a station and enters the next at the same instant) moves
  once, and the move is attributed to the last event of the chain; the first one only lights up its station. The log
  still has an entry for both.
- Stepping back and resetting have no events to link, so the picture snaps to the state. Playing backwards would need
  the layouts of earlier states and was not worth it.
- A firing that holds no case (work on resources only) shows a busy slot and a ring but no sprite.
- A slot turns busy when the firing starts, the case arrives 300 ms later: for a moment the slot is busy and empty.
- The net editor behind the domain view still receives every state change. It stops its token flights while it is
  hidden, but a React Flow tree with hundreds of nodes would still cost time at 25 updates per second; the examples are
  far from that.
- Measured with 200 tokens (a ring of 20 stages): layout, animation and dynamic scene take about 1 ms per bundle in Node
  (budget 8 ms). In headless Chromium without a GPU the frame callback with 60 moving sprites takes about 1 ms, and the
  page draws about 60 frames per second at 10x and about 55 at 60x. Before the limit of one flash per element (at 60x
  hundreds of flashes were alive at once) the same callback took 5.5 ms and the page fell to 17 frames per second.
