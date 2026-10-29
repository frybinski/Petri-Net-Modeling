# ADR 0013: Analysis and verification

Status: accepted · Date: 2026-10-29

## Context

Milestone M5 adds the analysis of nets (structure, invariants, state space, coverability) and the verification of
behavioural requirements (DECLARE, LTLf), the link to contribution B3 of the thesis (a verification chain for JSON nets).
The constraints: the same results in the browser and in Node, no new runtime dependencies, JSON nets with guards and
bindings as first-class citizens, results that can be proven correct by tests rather than made plausible, and an
interface that stays responsive for large state spaces.

## Decision

- **Explicit state space instead of symbolic methods.** The reachability graph is built breadth first with the atomic
  firing rule of `@pnm/core`. JSON nets use `findEnabled` and `fireBinding`, so guards, inscriptions and types count and
  every binding is an edge. A symbolic method (BDDs, unfolding) would not handle data-carrying tokens, and an explicit
  graph gives shortest counterexamples and the replay for free. The price is the state explosion, handled with limits
  (20000 states, 10 s), a `truncated` flag with the reason, border states that are not expanded, and statements that
  stay valid under truncation (found deadlocks, "unknown" for the rest). P/T nets run on count vectors in a compiled
  stepper that a property test compares with the core's firing rule.
- **Karp–Miller for P/T boundedness.** The coverability graph decides boundedness when the state space is infinite and
  names the unbounded places (ω). Capacity places never get ω and only count as grown when equal, which keeps the
  acceleration sound under the weak capacity rule.
- **Invariants in `bigint`.** The minimal-support semi-positive solutions come from the Farkas elimination with pruning
  of rows with non-minimal support, in exact integer arithmetic, so large weights cannot overflow silently. An independent
  oracle (exact null spaces of every subset) checks the result on random matrices. Capacities become complement places
  so that the invariants see them; JSON nets use the skeleton of the net, and the panel says so.
- **Verification by a product with an automaton.** Requirements are checked on _finite traces_: the firing sequences from
  the initial marking to an end state (default: deadlocks; or any marking, giving prefix-closed checks; or given
  markings). A breadth-first search in the product of the state space and the automaton finds a shortest counterexample
  and decides "holds" on a complete space. Vacuous truth (no end state is reachable) and infinite runs without an end
  state are reported instead of hidden, and an incomplete state space gives "unknown", never "holds".
- **DECLARE as explicit automata, tied to LTLf.** Each of the 21 templates is a hand-built DFA (readable, no dependency
  on the translator) _and_ has its LTLf formula. A test checks that both accept the same traces, for every template, by
  language equivalence of the automata and on random traces. The template list is data (`TEMPLATE_INFO`), so the editor,
  the command line and the documentation share it.
- **LTLf by progression with DNF states.** The translation rewrites a formula by one position at a time; the states are
  canonical disjunctive normal forms over the temporal subformulas of the closure (the subset construction over the
  Fischer–Ladner closure), then Moore minimisation. The limits (10 activities, 4096 states) make the translation fail
  with "formula too large" instead of exhausting memory; the direct evaluation of a formula on a concrete trace (a
  dynamic program) stays available for logs and as the test oracle. Plain boolean normalisation (flattening, absorption)
  was not enough: nested progressions of `a W F false` grew without bound until states were kept in canonical DNF.
- **Empty traces have a meaning.** A net whose initial marking is a deadlock has the empty trace, so LTLf is defined on the
  empty suffix (atoms, `X`, `F`, `U` false; `Xw`, `G`, `W`, `R` true) and the templates follow from their formulas.
- **One handler, worker and in-thread client.** The analyses run in a Web Worker (progress, cancellation, a cache of the
  last state space so that checking after exploring does not explore twice); a client with the same interface runs
  them in the calling thread for Node, the command line and the tests.
- **Replay through the simulation.** A counterexample is a list of steps (transition and binding). The editor replays it in
  the simulation with durations and rates switched off, matching each binding against the enabled ones, and compares the
  end with the marking the analysis reported. Clicking a state of the graph replays the shortest path to it.
- **Properties live in the net document** as an optional `properties` list that the core passes through as `unknown`;
  `@pnm/analysis` defines the schema and drops entries it cannot read. Edits are undoable and work during a simulation.

## Consequences

- Everything the panel says is also available as functions and from the command line (`pnm analyze`, `pnm check`).
- Results are exact on complete state spaces and honest about incomplete ones; users decide the limit.
- Liveness is answered by the liveness classes of the graph, not by LTLf: finite-trace LTLf cannot express it.
- The analysis ignores time and shows concurrency as interleavings; verifying timed behaviour would need a different
  model (timed automata) and is out of scope.
- The structure of JSON nets is an approximation; a sound structural analysis of data-carrying nets would need the types
  and guards and is left open.
