# Simulation

The editor simulates nets in two ways that share one engine (`@pnm/sim`). A third source for the same views, an event log
that is **replayed** on the net, is described in [replay.md](replay.md).

- **Untimed nets** (no durations, no arrival rates): click a green transition to fire it, take a random step, or let
  the simulation play at one firing per second. This is the behaviour of earlier versions.
- **Timed nets** (some transition has a duration or an arrival rate): a discrete-event simulation with a clock, parallel
  firings, resources, arrivals, key figures and an event log.

The firing rule is the same in both. The enabled transitions and their bindings come from `@pnm/core`; a net without
durations behaves exactly as the atomic firing rule (a test checks this for every example of the first milestones).

## Time and durations

Time is simulated seconds since the start. Every transition may have a duration (see [format.md](format.md)):

| Kind          | Meaning                                   |
| ------------- | ----------------------------------------- |
| none or fixed | a constant number of seconds (none is 0)  |
| uniform       | a random duration between `min` and `max` |
| exponential   | a random duration with the given mean     |

Firing is split in two phases. When a transition **starts**, the tokens of its binding are taken from the input
places. When it **completes**, after its duration, the output is put on the output places. In between the firing is
_running_: the transition shows a progress bar, and a badge counts parallel firings of the same transition. With
duration 0 both phases happen at the same instant, which is the ordinary atomic firing.

Several firings of one transition can run in parallel as long as there are tokens for them. To limit the parallelism
(two scanners, one sorter), model the machine as a **resource place** with that many tokens and a loop to the
transition: the tokens are taken at the start and given back at the end.

### What happens at an instant

The clock jumps from one instant to the next. At each instant the engine

1. completes all firings that end now,
2. lets the arrivals that are due enter,
3. starts transitions as long as any is enabled: it picks one enabled transition at random, weighted by `priority`,
   and one of its bindings uniformly, and repeats until nothing is enabled.

Transitions that are enabled therefore start at once; waiting happens in the places. A cycle of transitions without
duration would never end: after 10 000 starts at one instant the engine stops starting, reports `ZERO_TIME_CYCLE` in
the status bar, and goes on with the next event.

### Capacities

A running firing reserves room on the places it will fill. A transition starts only if the tokens now, plus the
tokens that running firings will add, plus the tokens it will add itself, stay within the capacity of every target
place. Without this a bounded buffer could be overfilled by firings that were all started while it was empty.

### Priorities

When several transitions are enabled for the same tokens, `priority` is the relative weight of the random choice: a
transition with priority 3 is chosen three times as often as one with priority 1. The default is 1. In the parcel
center the three switches have the weights 0.5, 0.35 and 0.15.

### Arrivals

A transition without input places is a _source transition_. With an `arrival rate` (per hour) it fires by itself,
with exponentially distributed times between arrivals; a new case enters at every arrival. Without a rate it only
fires when you click it. The rate can be changed while the simulation runs, in the panel (a slider from off to twice
the rate of the net). If an arrival finds no room (a full place) it is lost and reported once. A source transition
that puts tokens only on quantity and resource places (see [below](#quantity-places)), a delivery of steel for
example, brings in no case.

## Cases

Every token that is not a resource or a quantity belongs to a **case**. A case enters with an arrival (`C-0001`,
`C-0002`, ...; the prefix is a simulation setting) or, for tokens of the initial marking, at the start. Cases stay with
their tokens: a completing transition gives the case of the first token it consumed to every token it produces, so an
AND split makes copies and an AND join keeps one. Tokens of resource and quantity places carry no case and pass none
on. A case is finished when one of its tokens reaches a _sink_ place.

The role of a place follows from the net: no incoming transition makes a `source`, no outgoing transition a `sink`, a
place with initial tokens that is input and output of one transition a `resource`, everything else a `case` place.
Resource and case can be forced per place in the properties panel, and so can `quantity`.

### Quantity places

A place with the role **quantity** counts an amount: kilograms of steel, litres of water, kilograms of CO₂e, euros.
One token is one unit (1 token = 1 kg). It exists so that such amounts can be modelled as tokens of a timed net and
still mean the same in the net, in the domain view and in the analysis. The rules:

- Tokens on a quantity place carry **no case**, like those of a resource, and a firing does not take its case from
  them. A firing that only takes or puts amounts (a delivery, recycling) has no case: its events have an empty
  `caseIds`.
- A quantity place **never starts or completes a case**, even if it is a source or a sink by its arcs. This is what
  makes the role necessary: if CO₂ were put on an ordinary sink place, every frame would count as finished when its
  first CO₂ arrived, and throughput, cycle time and the cases in the system would all be wrong. `quantity` is the one
  role that overrides `source` and `sink`.
- A **source transition** that puts tokens on quantity places and on nothing but quantity and resource places brings in
  no case (no `spawn` event). With another output place, or none, it brings in cases as before.
- Quantity places appear in the table of places of the key figures (now, mean, maximum) but have **no waiting time**
  and no utilisation, and they never get the colors of a queue.
- The validation hints (`QUANTITY_LOOKS_LIKE_RESOURCE`) when a quantity place with initial tokens forms a loop with a
  transition and so looks like a resource; the hint names both roles and leaves the choice to you.
- The event log (CSV, XES) holds only events with a case, so **firings without a case do not appear in it**: the
  delivery of steel and the recycling of the example are not in its log. The [replay](replay.md#quantity-places) takes
  this into account.
- The domain view draws a quantity place as a counter or not at all ([rule V9](domain-view.md#rules)), and a firing
  that moves an amount shows a flow marker along the connector instead of a moving object.

The example [`bike-frames.pn.json`](../examples/bike-frames.pn.json), _Fahrradrahmen-Fertigung_, uses them: the store of
tubes, the free space, scrap, waste and CO₂e are quantity places, the frames are the only cases. The tube store and the
free space always add up to 200 kg (a place invariant that the [analysis](analysis.md) finds), the store is refilled in
steps of 40 kg when 40 kg of space are free, and recycling turns 5 kg of scrap into 4 kg of tube.

## Key figures

The _Metrics_ tab computes from the event stream, after the warm-up (a setting that leaves the start-up phase out;
until it is over the tab shows a bar with the clock, _Warm-up 4:12 of 20:00_, and a link to the setting, which stops the
simulation because the warm-up is fixed when it starts):

- **Throughput** per hour: finished cases per hour of observed time.
- **Mean cycle time**: from the arrival of a case to its first token in a sink.
- **Cases in the system**, and per case place the tokens now, the time-weighted mean, the maximum and the mean wait
  (time on the place before the token was taken).
- **Utilisation** per resource: the share of its tokens that were in use.

Case places with many waiting tokens get a ring on the canvas: yellow from 6, red from 10 tokens (adjustable in the
Metrics tab). Quantity places are listed in the same table, after the case places, without a waiting time.

### Indicators

An **indicator** is a key figure that you define on the net (`simulation.indicators` in the file, section _Indicators_
of the net properties). It relates an amount that was counted in the run to the completed cases or to the observed
hours: _CO₂e per frame_, _recycled share_, _cuts per hour_.

```json
{
  "id": "co2-per-frame",
  "label": "CO₂e je Rahmen",
  "unit": "kg",
  "measure": { "kind": "inflow", "of": "p_co2" },
  "per": "case",
  "factor": 1,
  "digits": 1
}
```

- `measure` says what is counted. `kind` is `tokens` (the tokens on a place now, a momentary value), `inflow` (the tokens
  put on a place), `outflow` (the tokens taken from a place) or `firings` (the firings of a transition). `of` is the
  place, or the transition for `firings`. `via` (only for `inflow` and `outflow`) counts only the flow over the arcs
  of one transition: `{ "kind": "inflow", "of": "p_tubes", "via": "t_recycle" }` is the tubes that recycling made.
- `per` (optional) is what it is related to: `case` (the cases completed in the observation window), `hour` (the hours
  observed) or a second `measure`. Without `per` the value is absolute.
- The value is `factor` × measure ÷ reference. If the reference is 0 (no case completed yet, no hour observed, the second
  measure is 0) there is no value: it is `null` in the data and a dash in the displays. `factor` (default 1) must be
  finite; 100 turns a share into per cent. `digits` (0 to 6, default 1) is the number of decimal places shown; the
  data keeps the full value.
- The **observation window** is the one of the other key figures: after the warm-up. A flow counts when the firing
  that moves the tokens happens in the window (a firing counts when it starts, the tokens it takes when it starts, the
  tokens it puts when it ends). `tokens` is a momentary value and does not depend on the window.
- Indicators count **tokens, not values**: in a JSON net an indicator on a place counts its tokens, whatever they
  contain ([limitations](limitations.md)).
- The validation reports, with the path of the field, an unknown place or transition, an element of the wrong kind, a
  duplicate `id`, a `via` that has no arc to the place, a `factor` that is not finite and `digits` out of range. If you
  delete an element that an indicator points to, the indicator stays and is reported, it is not removed silently.

Where they appear: the _Metrics_ tab (section _Indicators_ with the live values), the key figure strip of the domain
view (the first four, then a hint to the Metrics tab), `pnm simulate` (a table before the tables of places and
resources) and the JSON of `pnm simulate --metrics` and `POST /api/v1/simulate` as `metrics.indicators`, a list of
`{ id, label, unit, value, digits }` (absent for a net without indicators). A replay computes them too. They are
computed by `@pnm/sim` (`indicatorValues`), the same function for the app, the command line and the server.

For a worked example see the four indicators of `examples/bike-frames.pn.json`. Seed 1, a warm-up of one hour and eight
simulated hours give 13.4 kg CO₂e and 3.1 kg of tube per frame, 29 % recycled steel and 0.21 kg of waste per frame.

## The event stream and the event log

Everything the engine does is an event with a time: `spawn` (a case enters), `start`, `complete`, `marking-edited`
(you added or withdrew tokens), `breakpoint`, `idle` and `warning`. A replay of an event log adds `deviation`
([replay.md](replay.md#fitness-and-deviations)). The animation, the trace table, the key figures and
the export are all computed from this stream.

The **Trace** tab lists the events (newest first, with filters by type and transition; a click selects the
transition). The buttons export the whole log:

- **CSV** with the columns `case_id, activity, timestamp, lifecycle`. The activity is the transition name, the
  lifecycle is `start` or `complete`, timestamps are ISO 8601 in UTC with milliseconds, counted from the `startTime`
  of the simulation settings. One row per event and case; events without a case are left out (so the firings of
  deliveries and recycling in the example, which have none, are not in the log).
- **XES 1.0** with `concept:name`, `lifecycle:transition` and `time:timestamp`, one trace per case.

Both load in process mining tools. With pm4py (`pip install pm4py pandas`):

```python
import pandas as pd
import pm4py

log = pd.read_csv("Paketzentrum-events.csv")
log = log[log["lifecycle"] == "complete"]  # one event per activity instance
log = pm4py.format_dataframe(
    log, case_id="case_id", activity_key="activity", timestamp_key="timestamp"
)
net, initial, final = pm4py.discover_petri_net_inductive(log)
```

The script `pnpm --filter @pnm/io check:pm4py` does exactly this for the parcel center and checks the result (acceptance A8,
see [eval/README.md](eval/README.md)).

Without the filter every activity occurs twice per case (start and complete), which the inductive miner may read as a
loop. XES files keep both lifecycle events and can be filtered the same way.

## Controls

| Control                 | Shortcut | Effect                                                                    |
| ----------------------- | -------- | ------------------------------------------------------------------------- |
| Play / Pause            | `Space`  | run the clock at the chosen speed                                         |
| Step                    | `.`      | process the next event (untimed nets: fire one random enabled transition) |
| Back                    | `,`      | restore the state before the last step or intervention (up to 500 steps)  |
| Reset                   | `R`      | start over from the initial marking                                       |
| Toggle breakpoint       | `B`      | pause when the selected transition starts (also in its context menu)      |
| Speed 1x to 60x and max |          | simulated seconds per second; `max` runs as fast as possible              |

While playing, the clock advances by the wall-clock time since the last tick times the speed, at most 100 ms times the
speed per tick, so a stalled page does not make the simulation jump. At `max` the engine works in bundles of 200
events. Without durations, 1x is one firing per second.

The engine runs in a Web Worker; the page never waits for it. Interventions (clicking a transition, withdrawing a
resource token, changing a rate) go through the same queue and are part of the history, so _Back_ undoes them too.

Further controls: arrival sliders, `+` / `-` for the free tokens of each resource, breakpoints on places ("pause when
a place holds at least n tokens"), and a status line for engine notices. Tokens animate along the arcs when a firing
starts or ends (250 ms, at most 60 at a time; not with `prefers-reduced-motion`).

## Determinism

The same net, seed, options and sequence of interventions give the same event stream and the same export. The seed is
a simulation setting (default 1); _Reset_ starts over with it. All random choices (durations, arrivals, conflicts)
come from one seeded generator (mulberry32), and every set is traversed in a stable order.

## Limits

- **Cases in P/T nets are matched by order.** Tokens of a place are taken first in, first out. At a join (AND join)
  the first token of each input place is taken, which can belong to different cases if the cases overtake each other
  on the way. The join then continues with the case of the first token. Typed tokens of JSON nets are matched by their
  value instead: bind the same variable on both input arcs of the join (say `$o` on each) and only tokens with equal
  values pair, so put a case field in the tokens and use it.
- **No capacity per transition.** A transition has no limit of parallel firings of its own; use a resource place.
- **No travel time.** Time passes only in transitions. A walk or a conveyor that takes time is a transition.
- **Arrivals that find no room are lost** (reported once per source).
- **Memory.** The event log keeps the newest 200 000 events; older ones are dropped (the Trace tab says so, and a toast
  does the first time) and are missing from the export, while the key figures are not affected. _Back_ keeps 500
  steps. Longer runs: `pnm simulate --csv` writes every event.
- **JSON nets with durations** work like P/T nets: the binding is chosen when the transition starts and its output
  inscriptions are evaluated then; the results are put on the places at the end. Evaluating many bindings per instant
  is slower than for P/T nets.
