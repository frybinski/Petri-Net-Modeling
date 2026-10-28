# Expressions: guards and arc inscriptions

JSON nets use two kinds of text fields: **input inscriptions** that bind variables, and
[JSONata](https://jsonata.org/) **expressions** for guards and output inscriptions. This page is a short guide for
modelers; the exact rules are in [format.md](format.md#evaluation-rules), and the full language is described in the
[JSONata documentation](https://docs.jsonata.org/).

## Variables

Input arcs (place to transition) list variables, separated by commas:

| Inscription | Meaning                                                                      |
| ----------- | ---------------------------------------------------------------------------- |
| `$o`        | Take one token of the place and call it `$o`.                                |
| `$a, $b`    | Take two different tokens of the place (two equal tokens are two instances). |
| (empty)     | Take `weight` arbitrary tokens, bind nothing. This is the P/T net behaviour. |

If the same variable appears more than once, on one arc or on several arcs of a transition, the tokens bound to it must
be equal. This is how two places are joined: `$c` on the arc from `Customers` and `$c` on the arc from `Orders` only
fire together for tokens with the same value. Often it is more readable to use two variables and say so in the guard:
`$o.customer = $c.id`.

Variable names start with `$`, then a letter, then letters, digits or `_`: `$o`, `$order_2`.

## Accessing values

Tokens are JSON values, so you reach into them with a path:

```
$o.amount              a field
$o.items[0].price      array index
$o.items[price > 10]   filter an array
$o."first name"        a field with a space (also `first name`)
```

A path that does not exist yields no value (`undefined`), not an error. See the pitfalls below.

## Operators

| Kind       | Operators                             |
| ---------- | ------------------------------------- |
| Comparison | `=`, `!=`, `<`, `<=`, `>`, `>=`, `in` |
| Boolean    | `and`, `or` (negate with `$not(...)`) |
| Arithmetic | `+`, `-`, `*`, `/`, `%`               |
| Strings    | `&` joins strings: `$o.id & "-paid"`  |
| Condition  | `condition ? then : else`             |
| Ranges     | `[1..5]` yields 1, 2, 3, 4, 5         |

Note that equality is `=` (not `==`) and inequality is `!=`.

## Common functions

`$count`, `$sum`, `$min`, `$max`, `$average`, `$length`, `$string`, `$number`, `$boolean`, `$not`, `$exists`,
`$uppercase`, `$lowercase`, `$substring`, `$contains`, `$split`, `$join`, `$map`, `$filter`, `$reduce`, `$sort`,
`$distinct`, `$keys`, `$merge`, `$append`, `$round`, `$floor`, `$ceil`, `$abs`, `$type`. In the editors, `Ctrl+Space`
lists them together with the variables bound by the input arcs. Calling `$random()`, `$now()` and `$millis()` is
possible, but the value is drawn once when the bindings are computed.

## Guards

A guard is an expression on a transition. The transition is enabled under a binding only if the guard yields exactly
`true`.

```
$o.amount > 0
$o.customer = $c.id
$o.amount > 0 and $o.country in ["DE", "AT", "CH"]
$count($o.items) > 0
```

- `false`, no value (`undefined`) and any other type (a number, a string, ...) all count as "not satisfied".
- An evaluation error (for example comparing a string with a number in arithmetic) also disables the binding and is
  reported in the status bar while the simulation runs.

## Output inscriptions

An output inscription is evaluated under the binding and produces the tokens for the target place.

```
$o                                      forward the token
$n + 1                                  a new number
{ "id": $o.id, "paid": true }           a new object
{ "order": $o.id, "to": $c.name, "total": $o.amount }
$o ~> | $ | { "approved": true } |      copy of $o with an extra field
```

- A result that is an **array creates one token per element**: `[$a, $b]` creates two tokens,
  `$o.items` creates one token per item, and `[]` creates none.
- Any other result creates **one token**. To create one token that is itself an array, wrap it: `[[1, 2]]`.
- The result must have a value. If a path does not exist, the binding is disabled and the status bar shows
  "The inscription has no value (undefined)".
- The result must satisfy the type of the target place, otherwise the binding is disabled and the type error is
  reported.
- A token must not be `null` (inside objects and arrays `null` is fine).
- An output arc without inscription creates `weight` tokens with the value `1`.

## Pitfalls

- **`undefined` instead of an error.** `$o.amout > 0` (misspelled) has no value, so the guard is not satisfied. If a
  transition never becomes enabled, check the spelling first; the type of the source place helps because tokens
  that do not match are flagged.
- **Variables must be bound.** A guard or output inscription may only use variables that an input arc of the same
  transition binds. The editors underline unbound variables and validation reports `VARIABLE_UNBOUND`.
- **Variable names and built-in functions.** `$count` is also a function. If you bind a variable of the same name, the
  variable wins inside expressions, so `$count(...)` can no longer be called. Prefer other names.
- **Single values and arrays.** JSONata treats a one-element array and its element alike in paths, for example
  `$o.items.price` yields a number for one item and an array for several. Use `$count`, `[...]` or `$append` when you
  need to be explicit.
- **Numbers.** All numbers are floating point. Compare money with care (`$round($x * 100) / 100`).
- **Time limit.** An expression is aborted after one second or at an evaluation depth of 500 calls and reported as a
  problem. Nothing in an expression can change the net or the outside world.

## Where the checks happen

| When              | What is checked                                                             |
| ----------------- | --------------------------------------------------------------------------- |
| While you type    | Syntax (red underline with message), unbound variables (amber underline).   |
| In the status bar | `INSCRIPTION_SYNTAX`, `GUARD_SYNTAX`, `VARIABLE_UNBOUND` for the whole net. |
| While simulating  | Evaluation errors, guards that are not boolean, tokens that violate a type. |
