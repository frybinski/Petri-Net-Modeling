# Replay of event logs

The simulation has a second source. Instead of the engine, an **event log** (CSV or XES, written by this tool or by any
other) drives the net: cases enter with their first event, activities take the tokens of their case and put tokens on the
next places, at the times of the log. Where the log does not fit the net, a token is created and the deviation is counted
and shown. A **live feed** does the same for events that arrive while the replay runs.

Everything that works on the event stream works on a replay as well: the net view, the domain view, the trace, the key
figures, the export of the event log and the check of properties on a log. They do not know where the events come from.

Three uses:

- **Does the log fit the model?** The fitness (token replay, below) and the list of deviations say where it does not.
- **Show real data.** Replay a recorded day of the smart office or the parcel center in the domain view.
- **Watch it live.** Feed a running replay from a script or the browser console.

## Event logs

`readLog` (in `@pnm/io`) reads a log into events with a case, an activity, a time in seconds and a lifecycle.

### CSV

The export of this tool has the columns `case_id, activity, timestamp, lifecycle`. Other files work if they have a case, an
activity and a time column; the separator (comma, semicolon or tab) is taken from the header line.

| Column    | Found by the names (case does not matter)                                                   | Notes                                                                                           |
| --------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| case      | `case_id`, `caseid`, `case id`, `case`, `case:concept:name`, `trace`, `trace_id`            | Required. Rows without a case are skipped, with a remark.                                       |
| activity  | `activity`, `concept:name`, `event`, `event_name`, `activity_name`, `task`, `name`          | Required.                                                                                       |
| time      | `timestamp`, `time:timestamp`, `time`, `datetime`, `date`, `complete_timestamp`, `end_time` | ISO 8601 or Unix seconds. Without it the events are one second apart, in the order of the file. |
| lifecycle | `lifecycle`, `lifecycle:transition`, `lifecycle_transition`, `transition`                   | `start` or `complete`. Without it every row is the end of an activity.                          |

Where the names are different, say which column is which (the dialog has a select for each, `pnm replay` has
`--case-column`, `--activity-column`, `--time-column`, `--lifecycle-column`). All other columns become attributes of the
events; JSON nets put them into the tokens.

Times: ISO 8601 (`2026-01-05T08:00:00.250Z`; a time without a zone is read as UTC, a space instead of the `T` is
accepted) or Unix seconds (`1767600000.5`). A number of 1e11 or more is read as milliseconds, with a remark. A value that
is neither makes the file unusable and the message names the line. Lifecycle values `start`, `started`, `begin` mean
start; `complete`, `completed`, `end`, `finish`, `finished` and an empty cell mean complete; others (`schedule`, `assign`,
...) are skipped with a remark that counts them.

### XES

`concept:name` of the event is the activity, `concept:name` of the trace the case, `time:timestamp` the time and
`lifecycle:transition` the lifecycle (default `complete`). Other attributes of the event and the trace become attributes.
The XML is read by the tool's own reader, so the same code runs in the browser and in Node.

### Order and time zero

Events are sorted by time. Events at the same time keep the order of the file, with one exception: at one time the
activities that **end** come before those that **start**, so that a resource that is given back is there for the next
case, whatever order the tool that wrote the log used for events of different cases (XES is written trace by trace, for
example). Apart from that the order within a case is the order of the file.

Time 0 is the first event. Choose another moment if the clock of the log is to match the net: _the start time of the
net_ gives exactly the times of the run that wrote the log (`startTime` in the simulation settings), or give a time of
your own (the dialog, `--time-origin`).

## Mapping activities to transitions

A replay needs to know which transition an activity belongs to. `autoMapActivities` proposes it: the same name; the same
name when case, spaces, `_` and `-` are ignored (`check_credit` for `Check Credit`); the id of the transition; a name that
is the beginning of the other (`Scannen (Paket)` for `Scannen`), at least three letters. A rule counts only if it finds
exactly one transition, so `Verladen` stays unmatched when there are `Verladen Tor 1` and `Verladen Tor 2`.

An activity with no transition is **skipped**: its events do nothing to the net, each is reported as a deviation of kind
`ignored`, and the dialog lists the activities. Several activities may belong to one transition.

## The rules of the replay

The replay is descriptive: the log says what happened, and the net is made to follow, with the deviations counted.

1. **A case begins with its first event** (the first one whose activity is mapped). The case is created at the input
   places of the transition of that event. If a source transition (one without input places) feeds such a place, the case
   enters through it: its `spawn` is that transition's, and its firing is shown. Otherwise the tokens are created
   where they are needed. Neither is a deviation: a log may start a case anywhere. The tokens of the initial marking
   that are on resource places stay where they are; those on other places wait without a case, and the first cases take
   them over before any token is created.
2. **A start** (`start` of the log) takes tokens from every input place of the transition, as many as the arc says. On a
   case place it takes the tokens of the case, the oldest first; on a resource place the oldest free token (with a
   seed: a free token chosen at random). If there are not enough, the missing tokens are **created** and each is a
   deviation of kind `missing` that names the place. The firing then runs until the matching `complete`.
3. **A complete** ends the oldest running firing of that case at that transition and puts the output on the output places.
   A resource is given back as it was taken. The tokens of the case go to the places of the output arcs.
   A complete without a start is started first: with `zero` (default) at the same instant, so the activity takes no time;
   with `span` at the end of the previous activity of the case (or at its own time, if there is none), so that the
   activity is under way for the time since the last event of the case.
4. **Joins.** An activity that takes tokens from two or more case places takes the oldest of each, whichever case they
   belong to, if the log lists the activity for those cases at the same time (a firing of several cases appears once per
   case). One firing then carries all of them. Cases that overtake each other between a split and a join therefore replay
   like the engine ran them.
5. **Cases without an end** stay in the net when the log ends. They count as open.
6. **Determinism.** The same log, mapping and options give the same events. The seed only chooses among free tokens of a
   resource.
7. **Quantity places** (role `quantity`, [simulation.md](simulation.md#quantity-places)) are not checked against the log.
   An activity takes the amount its arcs say from a quantity place, whichever case it belongs to, the oldest tokens
   first, and puts the amount on the places it feeds. Tokens on them carry no case. If there are fewer tokens than the
   arc asks for, the rest is **made up without a word**: no deviation of kind `missing` and nothing in `missing`, so the
   stock never goes below zero. The reason is that the log does not mention the firings without a case (the delivery of
   steel that fills the store up), so the replay cannot know where the amount came from. A quantity place is never an
   input that starts a case, and a case that is waiting is never waiting for one.

### JSON nets

Tokens are made of the case and its data: `{ "caseId": "C-1", ...attributes }`, where the attributes of the log become
fields (numbers and `true`/`false` are converted) and the data that the case already carries is kept. A resource is
given back with the value it had. The number of tokens an arc moves is its weight, or the number of variables of an input
inscription. Output inscriptions are **not evaluated**, and guards are **not checked**: a replay does not decide what may
happen. When a net has guards, the first start of a guarded transition adds one warning to the trace (code
`REPLAY_GUARDS_NOT_CHECKED`). With the option _Check the guards_ (`strict`; `--check-guards` on the command line) the
guard of every transition is evaluated with the tokens the activity took, and a guard that is not satisfied is a
deviation of kind `guard`. The activity is replayed anyway.

## Fitness and deviations

The fitness is the **token replay fitness** of Rozinat and van der Aalst:

```
fitness = 1 - 1/2 * missing / consumed - 1/2 * remaining / produced
```

- **consumed**: tokens taken by started activities (the created ones included),
- **produced**: tokens put by completed activities, plus the tokens that start a case,
- **missing**: tokens that had to be created because an activity found none,
- **remaining**: tokens that cases which reached a **sink place** left behind on other places (resource places do not
  count). A case that has not reached a sink is open, and its tokens are still on their way.

Tokens on quantity places count in none of the four: they are neither consumed nor produced, missing or left behind. The
fitness is 1 for the exported log of the bicycle frame example (`examples/bike-frames.pn.json`), CSV and XES, although the
log knows nothing of deliveries and recycling.

The fitness is 1 when the log fits the net, and `null` until something was consumed or produced. A net without a sink
place never finishes a case, so nothing remains and only the missing tokens lower the fitness. Skipped events and
guards do not change the fitness; they are counted on their own.

Every deviation is an event of the stream, type `deviation`, with its kind (`missing`, `ignored`, `guard`), the case, the
transition and the place if there is one, and a message. Deviations are shown:

- in the **trace** as red rows with the kind and the place (filter: _Deviation_),
- in the **net view** as a red ring around the place that got a created token, for one second; the hover card of the
  place says how many tokens were created there,
- in the **domain view** as a red flash around the station and the place, like the green flash of an ordinary event,
- in the **key figures**, in the card _Replay_: fitness, tokens created, left behind, events skipped, cases open and the
  progress through the log.

## In the app

1. Open the log: _File > Replay event log..._, the button _Log_ of the source switch in the simulation panel, or drop
   the file on the panel (a `.csv`, `.tsv`, `.txt` or `.xes` file dropped anywhere opens this dialog instead of a net).
2. The dialog **maps the activities**. It shows what the log holds (events, cases, time span, remarks), a table of the
   activities with the number of their events and a select for the transition (automatic matches are filled in; _Skip_
   leaves an activity out), and the options: how to treat an end without a start, where time 0 is, the warm-up (default:
   that of the net) and, for JSON nets, whether to check the guards. For a CSV file it also has a select per column.
3. _Replay_ starts the simulation with the source _Log_. The controls are the controls of the simulation: play, step, back,
   reset, speed (60x at the start, a log is long), breakpoints, the trace and the key figures. What belongs to the engine
   is hidden: arrival rates, adding or withdrawing resource tokens and firing a transition by hand. The panel says where
   in the log the replay is (_Event 120 of 6,394_); at the end it stops.
4. _Change mapping..._ reopens the dialog for the log in use, _Open another log..._ chooses another file. The source switch
   _Engine_ goes back to the engine, _Log_ replays the log again.
5. _Check properties on this log_ in the key figures opens the analysis and checks the properties of the net on the
   events replayed so far ([analysis.md](analysis.md#event-logs)).

## Live feed

The source _Live_ starts a replay with no events. It plays what arrives and waits for the rest (the status says
_Waiting_); the clock never runs ahead of the latest event. Times of events are seconds since the feed was opened (wall
clock time). An event without a time happens now; an event whose time has passed is taken at the present
moment. Activities are matched to transitions by name when their first event arrives (the rules of the mapping above); an
activity that matches none is skipped and reported.

**Paste events.** One event per line: `case, activity`, then optionally `start` or `complete` and the time in seconds, in
any order, separated by comma, semicolon or tab:

```
C-1,Anlieferung
C-1,Scannen,start
C-2,Anlieferung,complete,12.5
```

**From the browser console.** `window.pnm.live` exists only while the source is _Live_:

```js
// Two parcels arrive; the first is scanned. `lifecycle` and `time` are optional.
await window.pnm.live.push([
  { case: 'P-1', activity: 'Anlieferung' },
  { case: 'P-2', activity: 'Anlieferung', time: 3.5 },
  { case: 'P-1', activity: 'Scannen', lifecycle: 'start' },
]);
await window.pnm.live.close(); // the feed is over; what has arrived is still played
```

`push` rejects with the reason if an event has no case or activity or the feed is closed. `window.pnm.live.help` has the
short form.

**A feed from outside.** The script `scripts/live-demo.mjs` lets cases walk through the smart office (or another net,
`--net`) with random durations and respects the resources. It needs only Node:

```sh
node scripts/live-demo.mjs --cases 6 > events.txt        # lines to paste
node scripts/live-demo.mjs --format console              # a window.pnm.live.push([...]) call
node scripts/live-demo.mjs --format json                 # the events as JSON
```

`--gap` (seconds between arrivals), `--seed` and `--scale` (divides all times, default 10, so that the demo is over in a
couple of minutes) steer it. The decision: the console API is the interface; the script hands over text that the paste
field and the console take. A bridge from a process to the page (a WebSocket or a `postMessage` from an embedded page)
would need a server or an agreement on origins and is not part of 1.1.

## Command line

```
pnm replay <net> <log.csv|log.xes> [--map "activity=transition"]... [--ignore activity]... [options]
```

It prints the fitness, the deviations by kind and place and the key figures of the replay, and can write the replayed
events as an event log (`--csv`, `--xes`), the figures (`--metrics`) or everything as JSON (`--json`). `--strict` exits
with status 1 if the fitness is below 1. See [cli.md](cli.md#pnm-replay-net-log-options).

```
$ pnm simulate examples/parcel-center.pn.json --seconds 7200 --csv events.csv --quiet
$ pnm replay examples/parcel-center.pn.json events.csv --time-origin net
Paketzentrum: replayed events.csv (6394 events, 653 cases, 2 h 00 min)
  fitness            1.0000  (0 of 4455 tokens had to be created, 0 of 5100 were left behind)
  deviations         none
  cases completed    529  (317.41 per hour)
  cases open         22
  cycle time         mean 2 min 46 s, max 8 min 09 s
...
```

The figures are those of the run that wrote the log: the exported times are whole milliseconds, so the mean cycle
time agrees to a millisecond, and with time 0 at the start time of the net the throughput is the same, too.

## In code

```ts
import { readLog } from '@pnm/io';
import { autoMapActivities, createReplay, createLiveReplay } from '@pnm/sim';

const log = readLog({ csv: text }, { timeOrigin: net.simulation?.startTime ?? 'first' });
const { mapping, unmatched } = autoMapActivities(net, log.activities);
const replay = createReplay(net, log.events, { mapping, completeOnly: 'zero' }); // a Simulation
const events = await replay.advance(Infinity, { maxEvents: 100_000 });
replay.metrics().replay; // { fitness, consumed, produced, missing, remaining, ignored, guard, openCases, ... }

const live = createLiveReplay(net, { mapping: {}, autoMap: true });
live.push([{ caseId: 'C-1', activity: 'Scannen', lifecycle: 'complete' }]); // time: now
await live.advance(1);
```

A replay has the interface of the engine (`Simulation`), so the worker, the store and the views run unchanged. The
differences: `fireManually`, `editMarking` and `setRate` reject, `enabled()` is empty, `stepRandom` is `step`, and
`metrics()` has the extra field `replay`. The worker protocol has `initReplay`, `push` and `closeFeed` for it.

## Example: a log of a device in the smart office

A log from outside has its own column and activity names. The sensors of the smart office write `device, event, time`.
The file `devices.csv`:

```
device,event,time
badge-17,arrival,2026-03-02T08:03:00Z
badge-17,entry,2026-03-02T08:03:04Z
badge-17,walk_to_desk,2026-03-02T08:03:24Z
badge-17,work,2026-03-02T08:12:30Z
badge-17,coffee,2026-03-02T08:13:40Z
badge-17,leave,2026-03-02T08:13:50Z
badge-23,arrival,2026-03-02T08:05:10Z
badge-23,entry,2026-03-02T08:05:14Z
badge-23,walk_to_room,2026-03-02T08:05:42Z
badge-23,meeting,2026-03-02T08:20:50Z
badge-23,coffee,2026-03-02T08:21:55Z
badge-23,leave,2026-03-02T08:22:05Z
badge-31,arrival,2026-03-02T08:07:00Z
badge-31,entry,2026-03-02T08:07:05Z
badge-31,walk_to_desk,2026-03-02T08:07:30Z
badge-31,work,2026-03-02T08:16:00Z
badge-31,leave,2026-03-02T08:16:10Z
```

There is no lifecycle column, so each row is the end of an activity (`completeOnly: zero`), and no name matches a
transition. In the app the dialog offers the columns `device`, `event` and `time` in the selects _Case_, _Activity_ and
_Time_, and the table of activities gets its transitions from the selects. On the command line:

```sh
pnm replay examples/smart-office.pn.json devices.csv --warmup 0 \
  --case-column device --activity-column event --time-column time \
  --map arrival=Ankunft --map entry=Zutritt --map walk_to_desk="Weg Arbeitsplatz" \
  --map walk_to_room="Weg Meeting" --map work=Arbeiten --map meeting=Meeting \
  --map coffee="Kaffee holen" --map leave=Verlassen
```

```
  fitness            0.9621  (1 of 25 tokens had to be created, 1 of 28 were left behind)
  deviations         1  (missing 1, ignored 0, guard 0)
  DEVIATION  WHAT                                     COUNT
  missing    Verlassen found no token on Zum Ausgang      1
```

`badge-31` left without getting coffee, but in the model the way out leads through the coffee machine: the activity
_Verlassen_ found no token on _Zum Ausgang_. The replay created it, the place flashes red, and the fitness falls from 1
to 0.9621. (`--warmup 0` because the smart office leaves the first 45 minutes out of its key figures, and this log is
shorter.) A log of a real day is replayed the same way; with a start and an end per activity the durations of the log
decide how long the stations are busy.

## Limits

- **Descriptive, not normative.** A replay does not check that the net would allow what the log says, except for the
  tokens it needs: guards are only checked on request, output inscriptions are never evaluated, capacities are not
  checked (a created token can exceed the capacity of a place). Typed places can hold tokens that do not match their
  type.
- **No interpolation of time.** An activity takes the time between its start and its complete in the log; a missing start
  is `zero` or `span`, there is nothing in between. The durations of the net are not used.
- **Start and complete are paired by case and activity**, first in, first out. Two firings of one activity for one case
  that overlap and end in the other order are paired the wrong way round.
- **Joins are recognised by the log.** Several cases that start the same activity at the same time, where one lacks a token
  that another has, are taken as one firing, and only for activities with two or more case places. A log that lists the
  cases of a join at different times shows a deviation.
- **The tokens of the initial marking on case places** wait without a case and are taken over by the first cases; a token
  that nobody takes over stays.
- **Fitness depends on the sink places.** `remaining` counts only tokens of cases that reached a sink place.
- **Quantities are only as complete as the log.** A replay knows the amounts that the cases in the log take and make.
  What happens without a case (deliveries, recycling) is not in an exported log, so the stock of a quantity place and
  the indicators that depend on such firings differ from the run that wrote the log (CO₂e per frame is lower in the
  replay of the example, because the CO₂e of the deliveries is missing).
- **Resource tokens get new ids** each time they are returned, as in the engine; which token a resource gave is visible
  only through the seed.
- **Memory.** The log is held in the page and sent to the worker once. A log of 150 000 events replays in a few seconds on
  the command line (a run of 48 hours of the parcel center); the app keeps the newest 200 000 events of the replay for the trace and the export like it does for a
  run.
- **Back** keeps 500 steps. A live feed can be stepped back and replayed again; events that arrive late are placed at the
  present moment and stay there.
