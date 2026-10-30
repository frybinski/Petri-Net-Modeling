# ADR 0017: Quantity places and indicators

Status: accepted · Date: 2026-10-30

## Context

Increment N1 adds an example about sustainability: a bicycle frame production that counts the CO₂e, the steel, the
recycled share and the waste. These amounts are naturally tokens of a timed net (1 token = 1 kg), because then the net,
the domain view and the analysis all mean the same thing by them, and the analysis can find that the tube store and the
free space always add up to the 200 kg of the store. But the engine treated every token that is not on a resource place as
part of a case, and a case is finished as soon as one of its tokens reaches a sink place. CO₂e that is put on a place that
nothing empties is on a sink place. Frames would count as finished with their first kilogram of CO₂e; throughput, cycle
time and the cases in the system would be wrong, and the domain view would draw the CO₂e as frames. The question: how do
amounts become tokens without becoming cases, and how are figures like "CO₂e per frame" defined without a new language?

## Decision

- **A role of its own, `quantity`, on the place.** `Place.role` gets a third value. The tokens of such a place carry no
  case (like those of a resource), it never starts or completes a case, and it overrides the structural roles `source`
  and `sink`, which the two other overrides (`case`, `resource`) never did. It is only ever set, never computed: nothing
  in the structure says that a token is a kilogram. `isCaselessRole` names the roles whose tokens carry no case, so that
  the places in the engine, the replay, the layout and the key figures that said "not a resource" say "has a case".
- **Not a sink with a flag, not token data.** Two other ways were considered. (1) Put the amounts on ordinary sink places
  and teach the engine that some sinks do not finish cases. That is the same decision with a worse name: the property
  belongs to the place and its tokens, and it has to hold for places that are not sinks (the tube store) as well. (2)
  Give tokens data (JSON nets) and sum the amounts. JSON nets are the higher net class; the amounts of this increment are
  counts, a P/T net is enough, and a sum over token data needs expressions in the key figures (D6). One token per
  kilogram keeps the analysis exact: invariants, boundedness and the state space are those of the skeleton.
- **A source transition that feeds only amounts brings in no case.** A delivery of steel is a transition without input
  places. It fires on its arrival rate (or by hand) like any other source transition but has no `spawn` and no case. The
  rule applies when the transition has at least one quantity output and nothing but quantity and resource outputs, so
  that no net of 1.2.0 changes its behaviour.
- **Same events, no new event type.** A firing without a case has empty `caseIds`, as a firing on resources only had. The
  event log (CSV, XES) holds only events with a case, so deliveries and recycling are not in it. That is a limit
  (documented) and the price of keeping one definition of a log row: a case and an activity.
- **The replay does not check amounts.** A log cannot say where an amount came from, because the firings that move amounts
  have no case. The replay takes quantities from the places by the arcs, makes up what is lacking without a deviation,
  keeps the stock at zero or above, and does not count them in the fitness. The exported log of the example replays with
  fitness 1.
- **Indicators are data in the net, computed by the key figures.** `simulation.indicators` is a list of figures: a measure
  (tokens now, flow into or out of a place, optionally over the arcs of one transition, firings of a transition), a
  reference (completed cases, hours, a second measure), a factor and the decimal places. It is a small closed language,
  not an expression: it can be validated field by field, shown in a form, and computed by counters that run next to the
  other key figures (and exist only if the net has indicators, so that nothing changes for other nets). One function
  (`indicatorValues` in `@pnm/sim`) serves the app, the command line and the server. A reference that is 0 gives no value,
  shown as a dash, not as 0 or infinity. An indicator that points to a deleted element is reported by the validation and
  not removed, because silent changes of a model are worse than an error you can see.
- **The domain view gets a rule, not a new kind.** V9: a quantity place is a counter (`pool`, `source`, `sink`) or hidden,
  never a belt, because it has no objects to draw. The generic view makes it a pool. The animation does not move an
  object for an amount; a flow marker with the number runs along the connector for each firing and place, and every
  marker belongs to an event, which the log of handled events (acceptance A2) now checks. The key figure strip shows the
  first four indicators and wraps instead of overflowing.
- **The format stays `1.0`.** Both additions are optional. A version before 1.3.0 refuses a file that uses the role with
  the message of its schema (`places[3].role: Invalid option: expected one of "case"|"resource"`), which names the field,
  and drops `indicators` when it reads a file; this is documented and was checked against the old schema, not changed.

## Consequences

- Amounts are tokens in the net view too: a counter place with 700 tokens is a number in a circle, and the net view shows
  the stock of the tube store like any other place. A quantity place is also an ordinary place for the analysis, so the
  invariant `Rohrlager + Lagerplatz frei = 200` is found by the existing code, and `endActivities` of the conformance
  check had to learn that a quantity place is no end of a case.
- Every place of the codebase that said "resource" for "carries no case" was found by a search for the role and changed
  to the helper: the engine, the replay, the metrics, the layout, the station status and the animation. The golden tests
  (event streams, key figures, final states, JSON, PNML, CSV and XES of the ten examples of 1.2.0, per seed) show that
  nets without quantity places behave byte for byte as before.
- The limits are the ones named in [limitations.md](../limitations.md): firings without a case are not in the log, a
  replay does not know them, indicators count tokens and not values, and older versions reject the role.
- Indicators over token data, costs, emission factors from databases and a time-dependent energy mix are not part of
  N1; the first belongs to the extension to higher nets (D6).
