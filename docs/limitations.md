# Known limitations

What 1.4.0 does not do, and why. Each entry was found during development and decided in the release step: what could
be fixed cheaply was fixed (see the [changelog](../CHANGELOG.md)), what could not is listed here with the reason and,
where there is one, the way forward. The numbers are those of the [release plan](plan/Release-1.0_Umsetzungsplan.md)
(in German); the entries of the replay (R1 to R6) come from the [plan of the replay](plan/D5_Umsetzungsplan.md), those
of the server (S1 to S7) from the [plan of M6](plan/M6_Umsetzungsplan.md), those of the quantity places and indicators
(N1 to N4) from the [plan of N1](plan/N1_Umsetzungsplan.md), those of the graphics of quantities and the looks of cases (G1
to G6) from the [plan of N2](plan/N2_Umsetzungsplan.md). Entries 8, 22 and 23 are **fixed in server
mode**: they remain for the app on GitHub Pages and for local use, and say what the server changes.

## Editor and interface

**Tab belongs to the editor while a node is selected (3).** With one place or transition selected, `Tab` adds the next
node and connects it (`Shift+Tab` the previous one), so that a net can be built from the keyboard alone. The focus does
not move on with `Tab` then. `Esc` deselects, and from then on `Tab` moves the focus as usual. The shortcut help (`?`)
and the README say so. In the domain view in _Edit layout_, `Tab` walks through the entries instead and gives the key
back at the first and the last one.

**A tooltip may stay for a moment when the pointer jumps (4).** The tooltips are Radix tooltips; one that is open stays
until its close delay is over. It only shows with an automated pointer that jumps from one control to another, not with
a hand.

**Names are tight at 57 % zoom (5).** Names keep a readable size on the screen while zoomed out (the net gets
smaller, the text does not). Between about 40 % and 70 % the names of nodes that are close together can touch. Zoom in
a little or move the nodes apart; nothing is lost. Below 40 % the names fade out.

**JSONata expressions are not interrupted inside a native operation (8).** The time limit of 1 s for a guard or an
inscription is checked by JSONata between evaluation steps. A single long native operation, such as a pathological
regular expression in `$match` or `$replace`, runs to its end. Evaluating the expressions in a Worker would remove the
limit and is a candidate for a later release (see [ADR 0005](adr/0005-jsonata-expressions.md)).

_Fixed in server mode:_ the calls of the [server](server.md#computations-in-threads) (`simulate`, `replay`, `analyze`,
`check`) run in worker threads with a hard time limit (`PNM_JOB_TIMEOUT`); a thread that does not finish is ended and the
call answers 504, so a pathological expression cannot block the service. The editor in the browser is unchanged.

**An arc straight above its own guard pill still passes behind it (2, the part that stays).** Arcs keep clear of the
guard pills of other transitions and bend away from the pill of the transition they belong to when the angle allows it
(the token ring example). An arc that leaves a
transition exactly along its vertical axis would need a bulge of more than 100 px to clear a wide pill; it is drawn with
the best bulge it has, and the pill, which is opaque and has a ring in the color of the canvas, cuts it off cleanly.
Move the transition a little sideways or give the arc a bend point to route it by hand.

## Simulation

**An AND join can merge tokens of different cases (9).** In a P/T net the tokens of a place are matched by order (first
in, first out). A transition with two input places takes the first token of each, and the case of the first one goes on.
If the second place delivers its tokens in another order than the first, a join can pair the tokens of two different
cases: one of the cases is swallowed and does not finish on its own, and the key figures count one case too few. In a
net where cases can overtake each other between a split and a join, use a JSON net with a case field in its tokens and
bind the same variable on both input arcs of the join:

```
input arc from place A:   $o        input arc from place B:   $o        (only equal tokens pair)
```

JSON nets match tokens by value; P/T nets have no values to match. See [Simulation](simulation.md#limits).

**The event log keeps the latest 200 000 events (12).** Older ones are dropped and the trace says how many. The first
time it happens in a run a toast says so. The key figures are computed by the engine and are not affected; the trace,
the CSV and XES export and the check on the log use what is left. For longer runs, simulate on the command line
(`pnm simulate --csv`), which writes every event (up to 10 million).

**Stepping back and reset jump (13).** In the domain view _Back_ and _Reset_ snap the picture to the earlier state
instead of playing the events backwards. The engine rewinds by restoring a snapshot, which has no events to play. Going
backwards slowly would need a second, inverse animation and has little value for what the view is for.

## Replay of event logs

The rules and the details are in [replay.md](replay.md#limits).

**A replay describes, it does not check (R1).** The log says what happened and the net follows; the only thing the net
can refuse is a token that is not there, and then the replay creates it and counts the deviation. Guards are checked only
with the option _Check the guards_, output inscriptions of JSON nets are never evaluated (the tokens are made of the
case and its data), capacities are not checked, and the types of places are not applied to the tokens that a replay makes.
A replay that fits is evidence that the log is one of the net's behaviours as far as places and tokens go, not that the
net would have permitted it with its data.

**No interpolation of time (R2).** An activity takes the time between its start and its end in the log; the durations of
the net are not used. A log with only ends has activities of no duration (`zero`) or ones that last from the previous event
of the case (`span`); the second holds resources while a case waits, so resources run short and the replay shows
deviations. There is nothing in between.

**Start and end are paired first in, first out (R3).** For one case and one activity the first start belongs to the first
end. Two overlapping firings of an activity for the same case that end in the other order are paired the wrong way
round. A firing of several cases (a join) is recognised by its rows at one time and only for transitions with two or more
case places; a log that lists the cases of a join at different times shows a deviation. The engine's own logs replay
exactly, including cases that overtake each other at a join.

**Fitness counts a case as finished at a sink place (R4).** Tokens that remain are those a finished case left behind. A net
without a sink place never finishes a case, so only the created tokens lower its fitness. Tokens of the initial marking
on case places wait without a case and are taken over by the first cases; one that nobody takes over stays.

**The live source has no connection to the outside (R5).** Events come from the paste field and from
`window.pnm.live.push` in the browser console, which exists only while the source is _Live_. A bridge from another
process (a WebSocket, or a `postMessage` from an embedded page) would need a server or an agreement on origins and is not
part of 1.1; `scripts/live-demo.mjs` writes lines and console calls to paste. Late events are taken at the present
moment.

**Time 0 is the first event unless told otherwise (R6).** The key figures of a replay start at that moment and use the
warm-up of the net (changeable in the dialog and with `--warmup`). To get the times and the figures of the run that wrote
the log, choose _the start time of the net_ as time 0. The exported times are whole milliseconds, so mean times agree to a
millisecond, not to the last digit.

## Quantity places and indicators

The rules are in [simulation.md](simulation.md#quantity-places) and [simulation.md](simulation.md#indicators).

**Firings without a case are not in the event log (N1).** CSV and XES hold only events that belong to a case. A firing that
only moves amounts (the delivery of steel, recycling) has none and is missing from an exported log, so the log of the
bicycle frame example shows what happens to the frames and nothing of the deliveries. Process mining tools see the
frames only. The key figures and the event stream of the engine have these firings; the export does not.

**A replay cannot know what happens without a case (N2).** A replay is driven by the log, so it does not see the
deliveries that fill a quantity place. It makes up what the log takes from a quantity place and the net lacks (no
deviation, the stock never below zero), and indicators that depend on such firings (CO₂e per frame includes the CO₂e of
the deliveries) differ from those of the run that wrote the log. See [replay.md](replay.md#limits).

**Indicators count tokens, not values (N3, D6).** An indicator on a place of a JSON net counts its tokens whatever they
contain; a figure over the data of the tokens (the sum of an amount field, say) is not possible yet. For the amounts of
this increment, tokens are the right unit (1 token = 1 kg). A figure over token data belongs to the extension of the
indicators to higher nets (D6).

**Older versions reject a net with quantity places (N4).** The role `quantity` is a new value of `role`. A version before
1.3.0 reads the file with `Invalid net file: places[3].role: Invalid option: expected one of "case"|"resource"` and does
not open it; nothing is lost, the file stays as it is. The format stays `1.0`. A net that only has indicators opens in
an older version, which drops the indicators when it reads the file (the unknown key of the simulation settings is
ignored), so saving it there loses them.

## Quantities as graphics and looks of cases

The rules are in [domain-view.md](domain-view.md#quantities-as-graphics) and [ADR 0018](adr/0018-quantity-graphics-and-appearance.md).

**A look belongs to a place, not to the data of a token (G1, D6).** A case is drawn with the `appearance` of the place it
lies on, so all cases of one place look alike, and what a case is made of (a frame in red or in blue by an order field,
say) cannot show in the picture. A look from token data belongs to the extension to higher nets (D6).

**`max` is not compared with the invariants of the net (G2).** V10 checks `max` against the `capacity` of the place and
nothing else, because `@pnm/domain` does not depend on `@pnm/analysis` and the check of a rule must not need a state
space. That the limit of a container fits the net (the tube store and the free space always add up to 200 kg, so `max`
200 is right) is for the author to keep in mind. A count above `max` is not an error but is drawn and reported as an
overflow.

**A pictogram holds as many symbols as its box.** The symbols are never made smaller to fit more; if the box is full the
last cell says `+N`. Choose `per` so that 5 to 30 symbols appear, or make the box larger (G3).

**The curve over time is not in an exported image, and it starts when the view starts (G4).** The history of a counter is a
property of a run: a PNG export has a marking, not a run, so it shows the container or the symbols but no curve. The curve
starts at the state in which the animation was last set (a reset, a new view, a jump), and a step back cuts it at the
time of the state; it does not remember times it has not seen.

**The look of a case in a firing with several case inputs is matched by order (G5).** The cases of a firing are in the
order of its input places, and the look of the case with index _i_ is that of the _i_-th case input place. For the usual
transition with one case input this is exact. A transition that joins cases from places with different looks and
consumes several tokens from one of them can show a case in the look of another input place until the firing completes.

**Older versions reject a view with `display` or `appearance` (G6).** The schema of the view is strict, so a version before
1.4.0 does not draw such a view: the panel _Domain view_ lists the problem with the name of the field (`Unknown field
"display"`, rule V1) and offers the generic view. The net and the file stay as they are, and the format stays `1.0`. Views without the fields, such
as those of the parcel center and the smart office, open everywhere. The same holds for the new sprites (`frame`,
`bicycle`, `bars`) in `meta.entity.sprite`.

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

_Fixed in server mode:_ the preset _Server (Ollama)_ uses the address of the server that serves the page (`/llm/v1`), so
the browser calls its own origin and the server calls the model server.

**API keys are stored in the browser (23).** The key of the LLM provider is kept in `localStorage`, apart from the other
settings, and never in a net, an export or a log. Anyone who can use the browser profile can read it. The settings say
so.

_Fixed in server mode:_ the key is in the configuration of the server (`PNM_LLM_API_KEY`), the preset _Server (Ollama)_ has
no key field, and the browser never sends a key to the server. A key that someone typed for another provider stays in that
browser as before.

## Interchange, command line and analysis

**The command line is one file of 5 MB (25).** It contains every package, including the layout engine. It starts in
about 0.2 s, which is fine for a command line; it is not worth the complexity of lazy parts.

**Multi-page PNML offsets come from the nodes only (27).** A PNML file with several pages is read as one net, and the
pages are laid out next to each other from the horizontal extent of their nodes and arc points plus a fixed gap (the
import report says that the pages were merged). The files that ProM, pm4py and WoPeD write have no page size or page
offset to use, and the vertical position is never shifted. Pages whose coordinates were meant to overlap are therefore
separated sideways. A file with one page, the common case, keeps its positions.

**Structure and invariants of JSON nets use the skeleton (28).** In the incidence matrix an input arc with an inscription
counts as many tokens as the inscription has variables (`$l, $r` takes two), every other arc counts its weight, and
guards and output inscriptions are ignored; the panel says so. The state space is exact, because it explores with the
bindings, so deadlocks, boundedness, liveness and properties are exact. Siphons, traps, Commoner's condition and the
invariants hold for the skeleton and say something about the JSON net only where the skeleton is a faithful picture of
it.

## Server

The [server](server.md) (M6) has its own limits. The numbers are those of the [plan of M6](plan/M6_Umsetzungsplan.md).

**There are no accounts (S1).** Whoever reaches the server sees, changes and deletes every project; deleted projects
stay in the trash for 30 days. The protection is the network (firewall, ingress, `PNM_ALLOWED_NETS`) and, if wanted, one
password for the whole instance (`PNM_BASIC_AUTH`). A share link works without that password and is not a lock once someone
can list the projects. Nothing records who saved a version. A login per person would be a user model; it was left out on
purpose ([ADR 0016](adr/0016-server.md)).

**No real-time co-editing, and conflicts are not merged (S2).** A save based on an old version is refused (409) and the
person reloads or saves a copy. Two people who edit at the same time do not see each other. Merging or co-editing (Yjs)
would need a document model for it.

**One instance per data folder (S3).** The server keeps the index of the projects in memory and locks per project inside the
process; two instances on one volume would overwrite each other's versions. A restart takes about a second.

**The size of one project is one request (S4).** A net travels as one JSON body (up to `PNM_MAX_BODY`, 10 MB), and saving
or opening parses it in the main thread of the server. A very large net, or very many people saving at once, delays other
requests for the duration of the parse. The computations of the interface (not the saves) run in threads.

**The thresholds are fixed numbers (S5).** Two threads, a queue of 16 jobs, 60 s and 512 MB per job, two language model
requests at a time with ten waiting: sized for a group of a few dozen. They are variables; there is no adaptive scaling.

**The interface for the app's own analyses is not built (S6).** The plan mentions an optional _Run on server_ in the app
for analyses with a large limit. The analysis in the browser runs in a worker as before; the interface is for tools
(`POST /api/v1/analyze` with a higher `states`).

**The content security policy has `'unsafe-eval'` (S7).** Ajv, which checks the token types of JSON nets, compiles its
validators with `new Function`. The policy allows only scripts of the own origin, so this is no way for foreign code to run,
but it is weaker than a policy without it. Removing it needs standalone validators or another library for JSON Schema.

## Not in 1.4.0

- Accounts, private projects, and an audit trail on the server.
- Co-editing and a second user in the same net.
- Colored nets with their own inscription language beyond JSON nets and JSONata.
- A `pnm` package on a registry: the command line comes as a file with each release.
