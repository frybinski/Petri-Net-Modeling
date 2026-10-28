# Simulation

The editor simulates nets in two ways that share one engine (`@pnm/sim`):

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
the rate of the net). If an arrival finds no room (a full place) it is lost and reported once.

## Cases

Every token that is not a resource belongs to a **case**. A case enters with an arrival (`C-0001`, `C-0002`, ...; the
prefix is a simulation setting) or, for tokens of the initial marking, at the start. Cases stay with their tokens: a
completing transition gives the case of the first token it consumed to every token it produces, so an AND split makes
copies and an AND join keeps one. Tokens of resource places carry no case and pass none on. A case is finished when
one of its tokens reaches a _sink_ place.

The role of a place follows from the net: no incoming transition makes a `source`, no outgoing transition a `sink`, a
place with initial tokens that is input and output of one transition a `resource`, everything else a `case` place.
Resource and case can be forced per place in the properties panel.

## Key figures

The _Metrics_ tab computes from the event stream, after the warm-up (a setting that leaves the start-up phase out):

- **Throughput** per hour: finished cases per hour of observed time.
- **Mean cycle time**: from the arrival of a case to its first token in a sink.
- **Cases in the system**, and per case place the tokens now, the time-weighted mean, the maximum and the mean wait
  (time on the place before the token was taken).
- **Utilisation** per resource: the share of its tokens that were in use.

Case places with many waiting tokens get a ring on the canvas: yellow from 6, red from 10 tokens (adjustable in the
Metrics tab).

## The event stream and the event log

Everything the engine does is an event with a time: `spawn` (a case enters), `start`, `complete`, `marking-edited`
(you added or withdrew tokens), `breakpoint`, `idle` and `warning`. The animation, the trace table, the key figures and
the export are all computed from this stream.

The **Trace** tab lists the events (newest first, with filters by type and transition; a click selects the
transition). The buttons export the whole log:

- **CSV** with the columns `case_id, activity, timestamp, lifecycle`. The activity is the transition name, the
  lifecycle is `start` or `complete`, timestamps are ISO 8601 in UTC with milliseconds, counted from the `startTime`
  of the simulation settings. One row per event and case; events without a case are left out.
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
  value instead.
- **No capacity per transition.** A transition has no limit of parallel firings of its own; use a resource place.
- **No travel time.** Time passes only in transitions. A walk or a conveyor that takes time is a transition.
- **Arrivals that find no room are lost** (reported once per source).
- **Memory.** The event log keeps the newest 200 000 events; older ones are dropped (the Trace tab says so) and are
  missing from the export. _Back_ keeps 500 steps.
- **JSON nets with durations** work like P/T nets: the binding is chosen when the transition starts and its output
  inscriptions are evaluated then; the results are put on the places at the end. Evaluating many bindings per instant
  is slower than for P/T nets.
