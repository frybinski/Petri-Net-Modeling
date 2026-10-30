# Analysis and verification

`@pnm/analysis` computes properties of a net and checks behavioural requirements. The web app shows them in the
**Analyze** tab of the right panel (key `Y`), the command line has `pnm analyze` and `pnm check`
([cli.md](cli.md)). Everything is deterministic, has limits and says when a limit cut a result short.

All behavioural analyses use the **atomic firing rule** of `@pnm/core`: one transition fires at a time (interleaving)
and time does not exist. Durations and arrival rates of the simulation are ignored. JSON nets go through the same
`findEnabled` as the simulation, so guards, inscriptions and types count and every enabled **binding** is a step of its
own.

## Structure

The structure is read from the graph and does not depend on the marking. The incidence matrix is `C = Post - Pre`
(rows are places, columns transitions, entries are arc weights; parallel arcs add up).

| Property             | Holds if                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| connected            | the graph has one weakly connected component                                                       |
| strongly connected   | every element reaches every other one (a live and bounded net has this, unless it uses capacities) |
| ordinary             | every arc has weight 1                                                                             |
| pure                 | no transition takes from and gives to the same place                                               |
| state machine        | every transition has exactly one input and one output place (and the net is ordinary)              |
| marked graph         | every place has exactly one input and one output transition (and the net is ordinary)              |
| free choice          | for every arc `p -> t`: `p` has only `t` as output, or `t` has only `p` as input (ordinary)        |
| extended free choice | transitions that share an input place have the same input places (ordinary)                        |

The result also lists source and sink places and transitions, isolated elements, conflicts (places with several output
transitions) and loops. A **siphon** is a set `S` of places with `•S ⊆ S•`: once empty it stays empty. A **trap** has
`S• ⊆ •S`: once marked it stays marked. The minimal ones are enumerated by a search that repairs violating transitions
(at most 200 sets, then the result says it was cut off). **Commoner's condition** (every minimal siphon contains a
marked trap) is equivalent to liveness for free-choice nets.

In a **JSON net** the structure is computed on the _skeleton_: an input arc with an inscription counts as many tokens as
the inscription has variables (`$l, $r` takes two), every other arc counts its weight, guards and output inscriptions
are ignored. The panel says so.

## Invariants

A **place invariant** is a vector `y >= 0`, `y != 0` with `y · C = 0`: the weighted token sum `y · m` is the same in
every reachable marking. A **transition invariant** is `x >= 0`, `x != 0` with `C · x = 0`: a firing sequence with these
counts brings the net back to its marking. The tool computes the **minimal-support** invariants (every semi-positive
invariant is a non-negative combination of them) with the elimination of Farkas in the form of Martínez and Silva, in
`bigint` arithmetic, with intermediate pruning of rows whose support contains another row's. Limits: 500 invariants,
20000 intermediate rows.

- A place with a positive coefficient in an invariant with value `v` holds at most `floor(v / coefficient)` tokens. If
  every place is covered, the net is **bounded**.
- A live and bounded net is covered by transition invariants; a transition outside every one is a warning sign.
- A **capacity** is not an arc, so no invariant sees it. The tool adds a **complement place** for every capacity
  (`m(p) + free(p) = capacity`; its row in `C` is the negative row of `p`, which models the weak capacity rule of the
  core exactly). `1·Buffer + 1·Buffer (free) = 3` is such an invariant.

Click a row in the panel to select its places or transitions in the net.

## State space

`buildStateSpace` explores the reachable markings breadth first from the initial marking.

- A state is identified by its marking: the token counts per place for P/T nets, the sorted token values per place for
  JSON nets (so markings that differ only in the order of equal tokens are one state).
- An edge is one firing: transition and, in JSON nets, binding. Several bindings that lead to the same marking are
  several edges.
- Limits: 20000 states and 10 s by default; the panel offers 1000 to 100000 states and 5 to 300 seconds (_Time limit_,
  used by the exploration and by the check of properties). A cut-off exploration is marked
  `truncated` with the reason, and its border states are _not expanded_: nothing is claimed about them.
- The exploration runs in a Web Worker with progress and a **Cancel** button; in Node and in tests it runs in-thread.

From a complete state space the tool derives:

- **Bounds** per place (the largest token count seen), **boundedness** (a finite state space is bounded).
- **Deadlocks**: states without enabled transition, each with a shortest firing sequence that leads there.
- **Liveness** per transition, from the strongly connected components (Tarjan):

  | Class | Meaning                                                                                        |
  | ----- | ---------------------------------------------------------------------------------------------- |
  | dead  | never enabled (L0)                                                                             |
  | L1    | enabled in some reachable marking                                                              |
  | L3    | lies on a cycle: some run fires it again and again (in a finite state space this is also L2)   |
  | L4    | **live**: it occurs in every terminal component, so from every marking it can fire again later |

  The net is live if every transition is L4.

- **Reversibility**: the initial marking is in every terminal component, so it can be reached from every marking.
  Equivalently it is a **home state**; home states exist exactly when there is one terminal component.

If the exploration is cut off, only statements that stay true are made: a found deadlock, lower bounds on the bounds,
transitions seen to fire (L1). Everything else is "unknown".

### Coverability

For place/transition nets the coverability graph of **Karp and Miller** decides boundedness even when the state space
is infinite. A path from a marking `a` to a larger marking `m >= a` can be repeated, so the places that grew get the
value **ω** ("arbitrarily many"). The net is bounded exactly if no ω occurs. Places with a capacity never get ω, and only
count as grown if equal in `a` and `m`, which keeps the repetition argument valid under the capacity rule. Limit: 5000
nodes. The panel computes it with the exploration of every P/T net; JSON nets carry data, so the method does not apply.

## Verifying behaviour

A **property** is a requirement on runs. It talks about **activities**, which are the names of the transitions (if a
name is empty or used twice, the transition's id stands in). The list is stored in the net document under `properties`
(see [format.md](format.md#properties)).

### Traces and end states

A **trace** is the sequence of activities of a firing sequence from the initial marking to an **end state**. The
default end state is a **deadlock**; you can also choose **any marking** (the property must then hold for every prefix
of a run) or a list of **given markings**. A property **holds** if every trace satisfies it, and is **violated** if a
trace does not; the tool then gives a shortest counterexample (a breadth-first search in the product of the state space
and the property's automaton), which you can replay in the simulation.

Three things to read carefully:

- **Vacuous truth.** If no run ends in an end state (a net that never stops, such as the producer/consumer net), no trace
  exists and every property holds vacuously. The result says "Holds vacuously", and the card offers _Check every prefix
  of a run_, which switches the end states to _any marking_ and checks again.
- **Infinite runs.** If a cycle can be reached without passing an end state, runs go on forever and the property says
  nothing about them. The result carries the warning "contains infinite runs without a final state".
- **Incomplete state space.** If the exploration was cut off and no violation was found, the verdict is _unknown_, not
  "holds". A violation that was found is certain.

### DECLARE templates

Each template is an explicit finite automaton over finite traces; its meaning is defined by the LTLf formula in the
last column and tested against it (see below). `a` and `b` are different activities; `n` is a count (`existence`
needs at least 1, `absence` and `exactly` accept 0).

| Template             | Example                     | Meaning                                                      | LTLf                                       |
| -------------------- | --------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Existence            | `existence(a, 2)`           | a occurs at least 2 times                                    | `F (a & X F a)`                            |
| Absence              | `absence(a, 1)`             | a occurs at most once (`absence(a)`: never)                  | `!F (a & X F a)`                           |
| Exactly              | `exactly(a, 2)`             | a occurs exactly 2 times                                     | `F (a & X F a) & !F (a & X F (a & X F a))` |
| Init                 | `init(a)`                   | a is the first activity                                      | `a`                                        |
| End                  | `end(a)`                    | a is the last activity                                       | `F (a & Xw false)`                         |
| Responded existence  | `respondedExistence(a, b)`  | if a occurs, b occurs as well (before or after)              | `F a -> F b`                               |
| Co-existence         | `coExistence(a, b)`         | a and b occur together or not at all                         | `F a <-> F b`                              |
| Response             | `response(a, b)`            | every a is eventually followed by b                          | `G (a -> F b)`                             |
| Precedence           | `precedence(a, b)`          | b only occurs after a has occurred                           | `!b W a`                                   |
| Succession           | `succession(a, b)`          | response and precedence                                      | `G (a -> F b) & !b W a`                    |
| Alternate response   | `alternateResponse(a, b)`   | after every a comes a b before the next a                    | `G (a -> X (!a U b))`                      |
| Alternate precedence | `alternatePrecedence(a, b)` | every b is preceded by an a, and between two b there is an a | `!b W a & G (b -> Xw (!b W a))`            |
| Alternate succession | `alternateSuccession(a, b)` | alternate response and alternate precedence                  | both                                       |
| Chain response       | `chainResponse(a, b)`       | every a is immediately followed by b                         | `G (a -> X b)`                             |
| Chain precedence     | `chainPrecedence(a, b)`     | every b is immediately preceded by a                         | `!b & G (X b -> a)`                        |
| Chain succession     | `chainSuccession(a, b)`     | chain response and chain precedence                          | both                                       |
| Not co-existence     | `notCoExistence(a, b)`      | a and b never occur in the same run                          | `!(F a & F b)`                             |
| Not succession       | `notSuccession(a, b)`       | b never occurs after a                                       | `G (a -> !F b)`                            |
| Not chain succession | `notChainSuccession(a, b)`  | a is never immediately followed by b                         | `G (a -> Xw !b)`                           |
| Choice               | `choice(a, b)`              | at least one of a and b occurs                               | `F a \| F b`                               |
| Exclusive choice     | `exclusiveChoice(a, b)`     | exactly one of a and b occurs                                | `(F a \| F b) & !(F a & F b)`              |

On the command line the name ignores case, spaces and hyphens: `--declare "chain-succession(a, b)"`.

### LTLf

LTLf is linear temporal logic on finite traces. Syntax, from tight to loose binding:

| Operator                          | Meaning                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `a`, `"Create invoice"`           | the current activity is a (names with spaces or symbols go in quotation marks) |
| `true`, `false`                   | constants                                                                      |
| `!f`, `X f`, `Xw f`, `F f`, `G f` | not; next (strong); next (weak); eventually; always                            |
| `f U g`, `f W g`, `f R g`         | until; weak until; release (right associative)                                 |
| `f & g`, `f \| g`                 | and, or (`&&`, `\|\|` also work)                                               |
| `f -> g`, `f <-> g`               | implication (right associative), equivalence                                   |

At the last position of a trace `X f` is false (there is no next position) and `Xw f` is true. `F f = true U f`,
`G f = f W false`, `f W g = (f U g) | G f`, `f R g = !(!f U !g)`. The **empty trace** is evaluated like the empty suffix
behind the last position: atoms, `X`, `F` and `U` are false there, `Xw`, `G`, `W` and `R` are true. So `G (a -> F b)`
holds on the empty trace and `F a` does not; a net whose initial marking is a deadlock has the empty trace. The parser
reports the **position** of a syntax error.

`ltlfToDfa` translates a formula into a minimal automaton. The states are the formulas (in negation normal form) that
the rest of the trace still has to satisfy, kept as a canonical disjunctive normal form over the temporal subformulas
of the Fischer–Ladner closure: reading an event rewrites every temporal operator once (progression), which is the subset
construction over the closure. A trace is accepted if the formula left at its end holds on the empty rest. The limits are
**10 activities** and **4096 states** (2^12) before minimisation; beyond them the tool reports "formula too large". Such a
formula cannot be checked on the state space, but it can still be evaluated on a trace and on a log: `evaluateLtlf` is a
direct dynamic program (linear in formula and trace length).

## Event logs

`pnm check --log` and the button **Check on last simulation log** check the cases of an event log (CSV with `case_id`,
`activity`, `lifecycle`, as written by the simulation). Each case is a trace of its `complete` events. The result is the
**share of the cases that satisfy** each property, the violating cases and, for templates that react to an activity
(`response`, `precedence`, the alternate and chain variants, `respondedExistence`, `notSuccession`, ...), the number of
**activations and fulfilments**.

The log is the last run: the events of the simulation in progress, or of the last one that ended. For a **replay** of an
event log ([replay.md](replay.md)) these are the events replayed so far, so the button **Check properties on this log** in
the key figures of the replay checks the properties on the log you have just replayed, in one click.

A log of a running simulation ends with cases that are still on their way. Such an **open case** violates `response`
only because the log stopped, so cases whose last activity is not an **end activity** are left out by default (and counted
as open). The end activities of a net are the transitions that put a token on a sink place (a place nothing takes tokens
from; a quantity place such as CO₂e that nothing empties is no sink, its tokens belong to no case); "Count unfinished
cases" and `--include-open` turn this off.

## Limits and caveats

- **No time, interleaving.** Concurrency shows as all interleavings; durations, arrivals and breakpoints are ignored.
- **JSON nets.** Structure and invariants are computed on the skeleton; the state space is exact but its size depends on
  the data. A transition with more than 1000 bindings in one marking cuts the exploration off.
- **Finite traces.** Properties are about finite runs to an end state, not about infinite runs. Liveness is answered by
  the liveness classes, not by LTLf.
- **Capacities.** The weak rule of the core applies (the marking after firing must respect the capacity).
- **Numbers.** Invariant coefficients above 2^53 are dropped and the result is marked as cut off.
- A result is **out of date** after the net changed (not after moving elements); it is not recomputed automatically.

## How it is tested

The claims above are not left to plausibility: the tests in `packages/analysis/test` check hand-derived values for the
examples (state counts, bounds, deadlocks, liveness, invariants; each test states the derivation) and relate the pieces
to each other with property tests: the state space against a naive enumeration with the core's firing rule, the
invariants against an exact subset oracle (`y · C = 0` and minimal support), every DECLARE automaton against the
translation of its LTLf formula (language equivalence, all traces), the LTLf automaton against the direct evaluation on
random formulas and traces, and the product search against checking every run of random acyclic nets.
