# ADR 0005: JSONata for guards and inscriptions, behind `@pnm/expr`

Status: accepted · Date: 2026-10-28

## Context

JSON nets need an expression language over JSON values for guards and output inscriptions, and a way to bind
variables on input arcs. `PLAN.md` names JSONata, JMESPath and an own small language as candidates. The language
must be free of side effects, readable for modelers, and replaceable later.

## Decision

- **JSONata 2.x** is the expression language. It is expressive (paths, filters, object and array construction,
  functions), has a mature implementation and its syntax is close to JSON, which suits JSON tokens.
- All use of the library lives in a new package **`@pnm/expr`** with its own small interface: `compile`,
  `tryCompile`, `evaluateGuard`, `evaluateOutput`, `parseInputInscription`, `referencedVariables`. The core and the
  web app never import `jsonata`. Replacing the language means re-implementing this package.
- **Evaluation is asynchronous** because `expression.evaluate()` of JSONata 2.x returns a promise. The core API
  that evaluates expressions (`computeBindings`, `findEnabled`) is therefore asynchronous too, while parsing and
  `validate()` stay synchronous. The editor store keeps `enabled` and `computing` in its state and discards results
  of outdated computations through a sequence number. P/T nets use a synchronous path and are not affected.
- **Input inscriptions are not JSONata.** They are a comma separated list of variables (`$a, $b`) parsed by a few lines
  of code. Variables are bound by the engine (unification over the input arcs), not by pattern matching in an
  expression; this keeps enablement computable without evaluating arbitrary expressions per token combination.
- **Variables** of an expression are read from the JSONata AST (`expression.ast()`): variable nodes that are neither
  the callee of a function call nor declared by `:=` or a lambda, minus the names of built-in functions. This drives
  the `VARIABLE_UNBOUND` check and the editor completion.
- **Bindings** are passed both as JSONata bindings (`$o.amount`) and as the input document (`o.amount`).
- **Results** are converted to plain JSON (no sequences, no null prototypes). A functional result or `null` is an
  error; an array yields one token per element.
- **Safety:** JSONata supports `timeout` and `stack` options when an expression is created. `@pnm/expr` creates the
  expression with a timeout of 1000 ms and a depth limit of 500 and builds a further instance when other limits are
  requested. No functions are registered, so expressions cannot reach outside.
- **Cache:** compiled expressions are cached by source text (500 entries, oldest dropped first).
- **Types** use **Ajv 8** (JSON Schema draft 2020-12, `ajv-formats`, `strict: false`, `allErrors: true`). Validators
  are cached per schema object and per schema text, so an edited schema is rebuilt automatically.
- **Editors** use CodeMirror 6 with a small `StreamLanguage` for JSONata highlighting. The editor component and its
  roughly 380 kB (123 kB gzipped) are loaded on demand; Ajv and JSONata are part of the main bundle because
  `validate()` is synchronous and runs on every change.

## Consequences

- Limits of the safety net: the time limit is checked by JSONata between evaluation steps. A single long running
  native operation, such as a pathological regular expression passed to `$match` or `$replace`, is not interrupted.
  A guard that never terminates through such a regular expression would block the page. Running evaluation in a Web
  Worker would remove this limit and is a candidate for a later milestone. A time limit of `0` disables the check and
  must not be used for untrusted expressions.
- Tail-recursive functions are evaluated in a loop by JSONata and never reach the depth limit; only the timeout
  stops them.
- `$random()`, `$now()` and `$millis()` are not deterministic. The binding computation evaluates them once per
  candidate binding, and firing uses the produced tokens computed at that time, so a fired step always matches what
  the user chose.
- Equality, ordering and the display order of bindings are defined on canonical JSON (sorted keys), independent of
  how an expression builds an object.

## Alternatives considered

- **JMESPath:** simpler, but cannot construct objects from variables in the way output inscriptions need, and has no
  arithmetic.
- **An own expression language:** full control and synchronous evaluation, but a large amount of work for parser,
  evaluator, error messages and documentation. The `@pnm/expr` boundary keeps this option open.
- **JavaScript (`new Function`):** powerful but unsafe and not portable to other runtimes.
- **Pattern matching on input arcs** (filter schema plus variable binding): more declarative, but a larger design;
  the guard covers the same cases with less machinery.
