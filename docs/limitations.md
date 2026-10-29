# Known limitations

What 1.0.0 does not do, and why. Each entry was found during development and decided in the release step: what could
be fixed cheaply was fixed (see the [changelog](../CHANGELOG.md)), what could not is listed here with the reason and,
where there is one, the way forward. The numbers are those of the [release plan](plan/Release-1.0_Umsetzungsplan.md)
(in German).

## Editor and interface

**Tab belongs to the editor while a node is selected (3).** With one place or transition selected, `Tab` adds the next
node and connects it (`Shift+Tab` the previous one), so that a net can be built from the keyboard alone. The focus does
not move on with `Tab` then. `Esc` deselects, and from then on `Tab` moves the focus as usual. The shortcut help (`?`)
and the README say so. In the domain view in _Edit layout_, `Tab` walks through the entries instead and gives the key
back at the first and the last one.

**A tooltip may stay for a moment when the pointer jumps (4).** The tooltips are Radix tooltips; one that is open stays
until its close delay is over. It only shows with an automated pointer that jumps from one control to another, not with
a hand.

**Names are tight at 57 % zoom (5).** Names stay at a readable size on the screen while zoomed out (the net grows
smaller, the text does not). Between about 40 % and 70 % the names of nodes that are close together can touch. Zoom in
a little or move the nodes apart; nothing is lost.

**JSONata expressions are not interrupted inside a native operation (8).** The time limit of 1 s for a guard or an
inscription is checked by JSONata between evaluation steps. A single long native operation, such as a pathological
regular expression in `$match` or `$replace`, runs to its end. Evaluating the expressions in a Worker would remove the
limit and is a candidate for a later release (see [ADR 0005](adr/0005-jsonata-expressions.md)).

**An arc straight above its own guard pill still passes behind it (2).** Arcs keep clear of the guard pills of other
transitions and bend away from the pill of the transition they belong to when the angle allows it. An arc that leaves a
transition exactly along its vertical axis would need a bulge of more than 100 px to clear a wide pill; it is drawn with
the best bulge it has, and the pill, which is opaque and has a ring in the color of the canvas, cuts it off cleanly.
Move the transition a little sideways or give the arc a bend point to route it by hand.

## Simulation

**An AND join can merge tokens of different cases (9).** In a P/T net the tokens of a place are matched by order (first
in, first out). A transition with two input places takes the first token of each, and the case of the first one goes on.
If the second place delivers tokens in another order than the first, a join can pair the tokens of two different cases:
the paired case disappears from the key figures as a case of its own. A net in which cases overtake each other between
a split and a join should be a JSON net with a case field in its tokens, where the join binds both tokens to the same
value:

```
input arcs:    a: {case: $c, ...}    b: {case: $c, ...}
```

The example _Order processing_ does this. See [Simulation](simulation.md#limits).

**The event log keeps the latest 200 000 events (12).** Older ones are dropped and the trace says how many. The first
time it happens in a run a toast says so. The key figures are computed by the engine and are not affected; the trace,
the CSV and XES export and the check on the log use what is left. For longer runs, simulate on the command line
(`pnm simulate --csv`), which writes every event.

**Stepping back and reset jump (13).** In the domain view _Back_ and _Reset_ snap the picture to the earlier state
instead of playing the events backwards. The engine rewinds by restoring a snapshot, which has no events to play. Going
backwards slowly would need a second, inverse animation and has little value for what the view is for.

## Domain view

**A resource place with cells edits its station (20).** The cells of a resource (desks, rooms, machines) sit on the card
of their station and move and resize with it. Selecting the resource place therefore selects the station in the
_Domain view_ tab, and the panel says so. The cells themselves are moved one by one with the slot handles of the
station.

**Keyboard access to the picture is partial (17).** In _Edit layout_ `Tab` and `Shift+Tab` select the entries in turn,
the arrow keys move the selection and `Enter` opens its label. Reading the picture with a screen reader (the canvas has
a text summary only), pointing at cases and drawing paths still need a pointer. Full accessibility of a freely drawn
picture is an open topic.

**The LLM provider on `http://localhost` and the deployed page (22).** A page served over HTTPS may be forbidden by the
browser to call an `http://` address, such as a local Ollama or LM Studio server. The provider settings warn when this
is the case. Run the app locally (`pnpm dev`, then `http://localhost:5173`) or use a provider with an `https://`
address.

**API keys are stored in the browser (23).** The key of the LLM provider is kept in `localStorage`, apart from the other
settings, and never in a net, an export or a log. Anyone who can use the browser profile can read it. The settings say
so. A small server that keeps the key and forwards the requests is the plan for the next milestone (M6).

## Interchange, command line and analysis

**The command line is one file of 5 MB (25).** It contains every package, including the layout engine. It starts in
about 0.2 s, which is fine for a command line; it is not worth the complexity of lazy parts.

**Multi-page PNML offsets come from the nodes only (27).** A PNML page has no size of its own in the files that ProM,
pm4py and WoPeD write. When a net with several pages is read, the pages are laid side by side by the positions of their
nodes, not by a page offset; pages whose nodes overlap are moved apart (the import report says so). Nets with a single
page, the common case, keep their positions.

**Structure and invariants of JSON nets use the skeleton (28).** An input arc with an inscription counts as one token
per binding in the incidence matrix, guards are ignored, and the panel says so. The state space is exact (it explores
with the bindings), so deadlocks, boundedness and properties are exact; siphons, traps and invariants hold for the
skeleton and say something about the JSON net only where the skeleton is a faithful picture of it.

## Not in 1.0.0

- A server for the LLM key and for sharing nets (M6).
- Co-editing and a second user in the same net.
- Colored nets with their own inscription language beyond JSON nets and JSONata.
- A `pnm` package on a registry: the command line comes as a file with each release.
