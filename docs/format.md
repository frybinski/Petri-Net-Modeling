# File format (`.pn.json`)

A Petri net is stored as a single JSON document. The same structure is the
in-memory model of `@pnm/core`, the save format of the web editor, and the
planned input for the command line tool and API. Files use the extension
`.pn.json`. The current format version is `1.0`.

Two net classes are supported, selected by the `profile` field:

- `pt-net`: a place/transition net. Tokens are anonymous; types, guards and
  inscriptions are accepted, preserved and ignored.
- `json-net`: a higher net. Tokens are JSON values, places carry types (JSON
  Schema), input arcs bind variables to tokens, and guards and output
  inscriptions are JSONata expressions. A place/transition net is the special
  case of a JSON net without types, guards and inscriptions.

## Top level

| Field         | Type                       | Required | Description                                                  |
| ------------- | -------------------------- | -------- | ------------------------------------------------------------ |
| `version`     | `"1.0"`                    | yes      | Format version.                                              |
| `profile`     | `"pt-net"` or `"json-net"` | yes      | Net class: place/transition net or JSON net.                 |
| `name`        | string                     | yes      | Display name of the net.                                     |
| `types`       | object                     | yes      | JSON Schema objects keyed by type name. See [Types](#types). |
| `places`      | array of place             | yes      | See below.                                                   |
| `transitions` | array of transition        | yes      | See below.                                                   |
| `arcs`        | array of arc               | yes      | See below.                                                   |
| `marking`     | object                     | yes      | Initial marking: place id to an array of tokens.             |
| `annotations` | array of annotation        | no       | Free-text notes on the canvas.                               |

Unknown keys are ignored when reading and dropped when writing.

## Elements

All elements have a string `id`. Ids must be unique across places, transitions,
arcs and annotations. The editor generates 11-character URL-safe random ids;
hand-written files may use any non-empty string.

### Place

| Field      | Type    | Required | Description                                         |
| ---------- | ------- | -------- | --------------------------------------------------- |
| `id`       | string  | yes      |                                                     |
| `name`     | string  | yes      | Label shown below the place.                        |
| `position` | `{x,y}` | yes      | Center of the place in canvas coordinates (pixels). |
| `capacity` | number  | no       | Integer >= 1. Omitted means unbounded.              |
| `type`     | string  | no       | Name of an entry in `types`. Ignored by `pt-net`.   |

### Transition

| Field      | Type    | Required | Description                                     |
| ---------- | ------- | -------- | ----------------------------------------------- |
| `id`       | string  | yes      |                                                 |
| `name`     | string  | yes      | Label shown below the transition.               |
| `position` | `{x,y}` | yes      | Center of the transition in canvas coordinates. |
| `guard`    | string  | no       | JSONata guard. Ignored by `pt-net`.             |

### Arc

| Field         | Type      | Required | Description                                                 |
| ------------- | --------- | -------- | ----------------------------------------------------------- |
| `id`          | string    | yes      |                                                             |
| `source`      | string    | yes      | Id of a place or transition.                                |
| `target`      | string    | yes      | Id of a transition (if the source is a place) or a place.   |
| `weight`      | number    | yes      | Integer >= 1. Number of tokens consumed or produced.        |
| `inscription` | string    | no       | Variables (input arcs) or JSONata expression (output arcs). |
| `points`      | `{x,y}[]` | no       | Bend points between source and target.                      |

### Annotation

| Field      | Type    | Required | Description                  |
| ---------- | ------- | -------- | ---------------------------- |
| `id`       | string  | yes      |                              |
| `text`     | string  | yes      | Multi-line text.             |
| `position` | `{x,y}` | yes      | Top-left corner of the note. |

## Marking

`marking` maps place ids to arrays of tokens. Places without an entry are empty.
In a `pt-net` every token is the number `1` and only the length of the array
matters, so a place with three tokens is written `"p1": [1, 1, 1]`. Writers
should emit `1`; readers count the array length and ignore the values.

In a `json-net` tokens are arbitrary JSON values (numbers, strings, booleans,
objects and arrays; a token itself must not be `null`, though `null` may appear
inside objects and arrays). The marking stores values rather than counts, so a
P/T net can be turned into a JSON net without a format change. The order of the
array has no meaning for the firing rule, but is kept stable in files.

## Reading and validation

Reading checks the structure (types, required fields, finite numbers). Range and
consistency problems do not prevent a file from opening, so that they can be
repaired in the editor. They are reported as diagnostics instead:

| Code                       | Severity | Meaning                                                                    |
| -------------------------- | -------- | -------------------------------------------------------------------------- |
| `SCHEMA_INVALID`           | error    | The document does not match the format.                                    |
| `DUPLICATE_ID`             | error    | An id is used more than once.                                              |
| `ARC_DANGLING`             | error    | An arc end refers to a missing node.                                       |
| `ARC_NOT_BIPARTITE`        | error    | An arc connects two places or two transitions.                             |
| `ARC_WEIGHT_INVALID`       | error    | Weight is not an integer >= 1.                                             |
| `CAPACITY_INVALID`         | error    | Capacity is not an integer >= 1.                                           |
| `MARKING_UNKNOWN_PLACE`    | error    | The marking refers to a place that does not exist.                         |
| `MARKING_EXCEEDS_CAPACITY` | error    | The initial marking holds more tokens than the capacity allows.            |
| `DUPLICATE_NAME`           | warning  | Two places or two transitions share a name.                                |
| `ISOLATED_NODE`            | warning  | A place or transition has no arc.                                          |
| `MULTIPLE_ARCS`            | warning  | Parallel arcs in the same direction; raise the weight instead.             |
| `TYPE_UNKNOWN`             | error    | A place refers to a type that is not in `types`.                           |
| `TYPE_SCHEMA_INVALID`      | error    | The JSON Schema of a type does not compile.                                |
| `TYPE_NAME_INVALID`        | error    | A type name does not match `[A-Za-z][A-Za-z0-9_]*`.                        |
| `TYPE_UNUSED`              | warning  | No place uses the type.                                                    |
| `TOKEN_TYPE_MISMATCH`      | error    | Initial tokens violate the type of their place (or a produced token does). |
| `INSCRIPTION_SYNTAX`       | error    | An input or output inscription cannot be parsed.                           |
| `GUARD_SYNTAX`             | error    | A guard cannot be parsed.                                                  |
| `VARIABLE_UNBOUND`         | error    | A guard or output inscription uses a variable no input arc binds.          |
| `WEIGHT_IGNORED`           | warning  | The weight is greater than 1, but the arc has an inscription.              |
| `INSCRIPTION_ON_PT_NET`    | warning  | A type, guard or inscription is set, but the profile is `pt-net`.          |

The firing rule additionally reports `GUARD_ERROR` and `INSCRIPTION_ERROR` while
bindings are computed (an expression fails at run time, for example because of
a type error or a missing field), and `TOKEN_TYPE_MISMATCH` when a transition
would produce a token that violates the type of its target place.

## Types

`types` maps a type name to a [JSON Schema](https://json-schema.org/) (draft
2020-12, as far as [Ajv](https://ajv.js.org/) supports it; `format` keywords are
checked). A type name starts with a letter and continues with letters, digits or
`_`. A place refers to a type with its `type` field; places without a type accept
any JSON value.

```json
"types": {
  "Order": {
    "type": "object",
    "required": ["id", "amount"],
    "properties": { "id": { "type": "string" }, "amount": { "type": "number" } }
  }
}
```

A `$schema` keyword inside a type is ignored; schemas are always interpreted as
2020-12. The initial marking is checked against the types (`TOKEN_TYPE_MISMATCH`),
and a transition is only enabled under a binding if every token it would
produce satisfies the type of its target place.

## Inscriptions and guards

**Input arcs** (place to transition) carry a comma separated list of variables:
`$o` or `$a, $b`. A variable name is a `$` followed by a letter and then letters,
digits or `_`. Every variable binds exactly one token of the place.

- Several variables on one arc bind different token instances (two equal tokens
  are two instances).
- A variable that occurs more than once, on one or several input arcs, must be
  bound to equal tokens (structural equality; object key order does not matter).
- An input arc without inscription consumes `weight` arbitrary tokens and binds
  nothing, exactly as in a P/T net.
- With an inscription the `weight` is ignored (`WEIGHT_IGNORED`).

**Output arcs** (transition to place) carry a [JSONata](https://jsonata.org/)
expression that is evaluated under the binding.

- A result that is an array creates one token per element, any other value
  creates one token. A single token that is itself an array is written as a
  nested array: `[[1, 2]]`. The empty array `[]` creates no token.
- A result of `undefined` (for example a misspelled field) is an error and
  disables the binding.
- An output arc without inscription produces `weight` tokens with the value `1`.

**Guards** are JSONata expressions on a transition. The transition is only
enabled under a binding if the guard evaluates to exactly `true`; `false`,
`undefined` and any other value count as not satisfied, and runtime errors
disable the binding and are reported as diagnostics.

Inside an expression the bound variables are available as `$name`, and the
object of all bindings is the input document, so `$o.amount` and `o.amount` are
equivalent. `$o.amount` is the recommended spelling. See
[expressions.md](expressions.md) for a short guide to the language.

```json
{
  "id": "approve",
  "name": "Approve",
  "guard": "$o.amount > 0",
  "position": { "x": 210, "y": 40 }
}
```

## Evaluation rules

A transition is enabled under a **binding** (a map from variable name to token) if

1. every input arc can be served with distinct token instances and shared
   variables unify,
2. the guard evaluates to `true`,
3. every output inscription evaluates to tokens that satisfy the types of their
   places, and
4. the capacities hold after firing (weak capacity rule, as in P/T nets).

Bindings with equal variable values count once. They are ordered by variable
name and then by value (numbers numerically, everything else by canonical JSON
with sorted keys). At most 1000 bindings are computed per transition and at most
20000 token combinations are tried; if a limit is hit the result is flagged as
truncated. An expression is aborted after 1000 ms or at an evaluation depth of
500 calls. Expressions are free of side effects, but `$random()`, `$now()` and
`$millis()` are evaluated once when the bindings are computed.

Firing a binding removes the consumed tokens (the first token equal to each
bound value) and appends the produced tokens to their places.

## Firing rule (P/T nets)

A transition is enabled under a marking if every input place holds at least the
weight of its input arc in tokens, and the marking reached by firing respects
all place capacities (weak capacity rule). Parallel arcs add up. Firing removes
the input weights and adds the output weights; a place that is both input and
output (a loop) is handled by its net effect. A transition next to an arc with an
invalid weight is never enabled.

## Example

```json
{
  "version": "1.0",
  "profile": "pt-net",
  "name": "Producer/consumer",
  "types": {},
  "places": [
    { "id": "idle", "name": "Idle", "position": { "x": 0, "y": 0 } },
    { "id": "buffer", "name": "Buffer", "capacity": 3, "position": { "x": 200, "y": 0 } }
  ],
  "transitions": [{ "id": "produce", "name": "produce", "position": { "x": 100, "y": 0 } }],
  "arcs": [
    { "id": "a1", "source": "idle", "target": "produce", "weight": 1 },
    { "id": "a2", "source": "produce", "target": "idle", "weight": 1 },
    { "id": "a3", "source": "produce", "target": "buffer", "weight": 1 }
  ],
  "marking": { "idle": [1] }
}
```

More complete nets live in [`examples/`](../examples). The JSON nets
`order-processing`, `token-ring` and `dining-philosophers-json` show typed
tokens, guards that join two places, and array results:

```json
{
  "profile": "json-net",
  "types": { "Order": { "type": "object" }, "Invoice": { "type": "object" } },
  "transitions": [
    {
      "id": "invoice",
      "name": "Create invoice",
      "guard": "$o.customer = $c.id",
      "position": { "x": 680, "y": 40 }
    }
  ],
  "arcs": [
    { "id": "a5", "source": "approved", "target": "invoice", "weight": 1, "inscription": "$o" },
    { "id": "a6", "source": "customers", "target": "invoice", "weight": 1, "inscription": "$c" },
    {
      "id": "a8",
      "source": "invoice",
      "target": "invoices",
      "weight": 1,
      "inscription": "{ \"order\": $o.id, \"customer\": $c.name, \"total\": $o.amount }"
    }
  ]
}
```

## Serialization

`serializeNet` writes keys in a fixed order (`version`, `profile`, `name`,
`types`, `places`, `transitions`, `arcs`, `marking`, `annotations`), uses two
spaces of indentation and ends with a newline, so that files diff cleanly in
version control. Marking entries follow the order of the places; empty entries
are omitted.
