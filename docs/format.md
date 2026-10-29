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

| Field                  | Type                       | Required | Description                                                                      |
| ---------------------- | -------------------------- | -------- | -------------------------------------------------------------------------------- |
| `version`              | `"1.0"`                    | yes      | Format version.                                                                  |
| `profile`              | `"pt-net"` or `"json-net"` | yes      | Net class: place/transition net or JSON net.                                     |
| `name`                 | string                     | yes      | Display name of the net.                                                         |
| `types`                | object                     | yes      | JSON Schema objects keyed by type name. See [Types](#types).                     |
| `places`               | array of place             | yes      | See below.                                                                       |
| `transitions`          | array of transition        | yes      | See below.                                                                       |
| `arcs`                 | array of arc               | yes      | See below.                                                                       |
| `marking`              | object                     | yes      | Initial marking: place id to an array of tokens.                                 |
| `annotations`          | array of annotation        | no       | Free-text notes on the canvas.                                                   |
| `simulation`           | object                     | no       | Settings of the timed simulation. See [Timed simulation](#timed-simulation).     |
| `domainView`           | object                     | no       | How the net is drawn in the domain view. See [Domain view](#domain-view).        |
| `domainViewGeneration` | object                     | no       | How a language model generated the domain view. See [Domain view](#domain-view). |

Unknown keys are ignored when reading and dropped when writing.

## Elements

All elements have a string `id`. Ids must be unique across places, transitions,
arcs and annotations. The editor generates 11-character URL-safe random ids;
hand-written files may use any non-empty string.

### Place

| Field      | Type                     | Required | Description                                                                                |
| ---------- | ------------------------ | -------- | ------------------------------------------------------------------------------------------ |
| `id`       | string                   | yes      |                                                                                            |
| `name`     | string                   | yes      | Label shown below the place.                                                               |
| `position` | `{x,y}`                  | yes      | Center of the place in canvas coordinates (pixels).                                        |
| `capacity` | number                   | no       | Integer >= 1. Omitted means unbounded.                                                     |
| `type`     | string                   | no       | Name of an entry in `types`. Ignored by `pt-net`.                                          |
| `role`     | `"case"` or `"resource"` | no       | Overrides the role computed from the structure. See [Timed simulation](#timed-simulation). |

### Transition

| Field      | Type    | Required | Description                                           |
| ---------- | ------- | -------- | ----------------------------------------------------- |
| `id`       | string  | yes      |                                                       |
| `name`     | string  | yes      | Label shown below the transition.                     |
| `position` | `{x,y}` | yes      | Center of the transition in canvas coordinates.       |
| `guard`    | string  | no       | JSONata guard. Ignored by `pt-net`.                   |
| `timing`   | object  | no       | Duration of a firing. Missing means 0.                |
| `priority` | number  | no       | Weight in random conflict resolution, > 0, default 1. |
| `rate`     | number  | no       | Arrivals per hour; only for source transitions.       |

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

## Timed simulation

All of these fields are optional and ignored by the editing and by the atomic firing
rule. They are used by the discrete-event simulation, see [simulation.md](simulation.md).

`timing` is one of

| Kind          | Fields       | Meaning                                        |
| ------------- | ------------ | ---------------------------------------------- |
| `fixed`       | `value`      | A constant number of seconds, `value` >= 0.    |
| `uniform`     | `min`, `max` | Uniform between the two, 0 <= `min` <= `max`.  |
| `exponential` | `mean`       | Exponentially distributed, `mean` > 0 seconds. |

`priority` is the relative weight of a transition when several transitions compete
for the same tokens (a transition with weight 3 wins three times as often as one
with weight 1). `rate` is the mean number of arrivals per hour of a _source
transition_ (a transition without input places); the time between arrivals is
exponentially distributed.

The role of a place is computed from the structure: a place no transition puts tokens
on is a `source`, a place no transition takes tokens from is a `sink`, a place with
initial tokens that is input and output of one transition is a `resource`, everything
else is a `case` place. The `role` field overrides the choice between `resource` and
`case`; source and sink follow from the structure alone.

`simulation` holds settings stored with the net:

| Field          | Type   | Default                | Description                                                |
| -------------- | ------ | ---------------------- | ---------------------------------------------------------- |
| `seed`         | number | 1                      | Integer seed of the random number generator.               |
| `warmup`       | number | 0                      | Seconds at the start that are left out of the key figures. |
| `startTime`    | string | `2026-01-05T08:00:00Z` | ISO timestamp that simulation time 0 maps to in exports.   |
| `caseIdPrefix` | string | `C-`                   | Prefix of generated case ids.                              |

```json
{
  "id": "scan",
  "name": "Scan",
  "timing": { "kind": "uniform", "min": 4, "max": 9 },
  "priority": 2,
  "position": { "x": 300, "y": 40 }
}
```

## Domain view

`domainView` is an optional mapping that says how the net is drawn as a hall, a floor plan or a generic process picture:
where each place and transition is, as what it is drawn, and some scenery. It contains no behaviour (no durations,
weights, rates or conditions). `@pnm/core` reads, keeps and writes the value without looking at it (`setDomainView`
changes it); the package `@pnm/domain` defines the schema, checks it against the net (rules V1 to V8) and draws it. The
file format version stays `1.0`; files without the field are valid.

`domainViewGeneration` is an optional record next to the view that says how a language model generated it: model, server
(without credentials), time, the description of the domain, the first prompt, the log of the rounds (rule findings per
round) and the lists of entries that were filled in generically or dropped. It is never part of the view itself, so the
view stays strict, and it never contains an API key. `@pnm/core` passes it through like `domainView`; `@pnm/llm`
defines and reads it. Removing the view removes the record.

The full description, the schema, the rules and the generic mapping are in [domain-view.md](domain-view.md).

## Reading and validation

Reading checks the structure (types, required fields, finite numbers). Range and
consistency problems do not prevent a file from opening, so that they can be
repaired in the editor. They are reported as diagnostics instead:

| Code                       | Severity | Meaning                                                                                        |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `SCHEMA_INVALID`           | error    | The document does not match the format.                                                        |
| `DUPLICATE_ID`             | error    | An id is used more than once.                                                                  |
| `ARC_DANGLING`             | error    | An arc end refers to a missing node.                                                           |
| `ARC_NOT_BIPARTITE`        | error    | An arc connects two places or two transitions.                                                 |
| `ARC_WEIGHT_INVALID`       | error    | Weight is not an integer >= 1.                                                                 |
| `CAPACITY_INVALID`         | error    | Capacity is not an integer >= 1.                                                               |
| `MARKING_UNKNOWN_PLACE`    | error    | The marking refers to a place that does not exist.                                             |
| `MARKING_EXCEEDS_CAPACITY` | error    | The initial marking holds more tokens than the capacity allows.                                |
| `DUPLICATE_NAME`           | warning  | Two places or two transitions share a name.                                                    |
| `ISOLATED_NODE`            | warning  | A place or transition has no arc.                                                              |
| `MULTIPLE_ARCS`            | warning  | Parallel arcs in the same direction; raise the weight instead.                                 |
| `TIMING_INVALID`           | error    | A duration is negative, `min` > `max`, or an exponential mean is not > 0.                      |
| `PRIORITY_INVALID`         | error    | The priority is not a number greater than 0.                                                   |
| `RATE_INVALID`             | error    | The arrival rate is negative.                                                                  |
| `RATE_ON_NON_SOURCE`       | warning  | A rate on a transition that has input places; it is ignored.                                   |
| `SOURCE_WITHOUT_RATE`      | warning  | In a net that uses time, a source transition has no rate and never fires by itself.            |
| `ROLE_OVERRIDE_UNUSUAL`    | warning  | A place marked `resource` has no transition that takes from and gives back to it.              |
| `SIMULATION_INVALID`       | error    | The seed is not an integer, the warm-up is negative or the start time is not an ISO timestamp. |
| `TYPE_UNKNOWN`             | error    | A place refers to a type that is not in `types`.                                               |
| `TYPE_SCHEMA_INVALID`      | error    | The JSON Schema of a type does not compile.                                                    |
| `TYPE_NAME_INVALID`        | error    | A type name does not match `[A-Za-z][A-Za-z0-9_]*`.                                            |
| `TYPE_UNUSED`              | warning  | No place uses the type.                                                                        |
| `TOKEN_TYPE_MISMATCH`      | error    | Initial tokens violate the type of their place (or a produced token does).                     |
| `INSCRIPTION_SYNTAX`       | error    | An input or output inscription cannot be parsed.                                               |
| `GUARD_SYNTAX`             | error    | A guard cannot be parsed.                                                                      |
| `VARIABLE_UNBOUND`         | error    | A guard or output inscription uses a variable no input arc binds.                              |
| `WEIGHT_IGNORED`           | warning  | The weight is greater than 1, but the arc has an inscription.                                  |
| `INSCRIPTION_ON_PT_NET`    | warning  | A type, guard or inscription is set, but the profile is `pt-net`.                              |

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
`types`, `places`, `transitions`, `arcs`, `marking`, `simulation`, `domainView`, `domainViewGeneration`, `annotations`), uses two
spaces of indentation and ends with a newline, so that files diff cleanly in
version control. Marking entries follow the order of the places; empty entries
are omitted.

## PNML

PNML is the interchange format for Petri nets. `@pnm/io` writes (`toPnml`) and reads (`fromPnml`) it; the app does so in
_File > Import_ and _File > Export > PNML_, the command line with `pnm import` and `pnm export --format pnml`.

### Mapping

The structure follows PNML 2009 (ISO/IEC 15909-2) with the net type `ptnet`, so ProM, pm4py, WoPeD and other tools can
read the file:

| Model                 | PNML                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- |
| net name              | `<net><name><text>`                                                                    |
| place, transition     | `<place>`, `<transition>` with `<name><text>` and `<graphics><position x y/>` (center) |
| initial marking       | `<initialMarking><text>n</text>`, the number of tokens                                 |
| arc, weight           | `<arc source target>`, `<inscription><text>w</text>` only if the weight is not 1       |
| bend points of an arc | `<graphics><position/>` elements of the arc                                            |

There is one `<page id="page1">`. Element ids become XML ids: `n_` plus the id, characters outside `A-Z a-z 0-9 . - _`
as `_x<hex>_`. The output is deterministic and indented with two spaces.

### The `pnm` extension

Everything that PNML has no place for travels in `<toolspecific tool="pnm" version="1">` elements as JSON in a CDATA
section (so no XML escaping is needed). Other tools skip them; `fromPnml` reads them back completely, so a net survives
export and import unchanged.

| Where      | Fields                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| net        | `profile`, `version`, `name` (if it does not survive as text), `types`, `simulation`, `annotations`, `domainView`, `domainViewGeneration`, `strayMarking` |
| place      | `id` (the original), `type`, `capacity`, `role`, `tokens` (the values; JSON nets, or values other than `1`)                                               |
| transition | `id`, `guard`, `timing`, `priority`, `rate`                                                                                                               |
| arc        | `id`, `inscription`                                                                                                                                       |

With the option `toolspecific: false` (_Include data that only this tool understands_ in the dialog,
`--no-toolspecific` on the command line) none of this is written; the file then holds the structure, names, markings,
weights and positions only. A file without the extension is read as a P/T net (`pt-net`).

### Reading other tools' files

The reader is lenient. It accepts `ptnet`, `pnmlcoremodel`, `ptNetb` and `epnml` types and, with a warning, others;
several pages (merged and placed side by side); nodes directly under `<net>`; `referencePlace` and
`referenceTransition` (arcs are redirected to the referenced node); names without `<text>`; initial markings and
inscriptions as numbers or as text that contains one ("Default,2"); invisible transitions of ProM (`$invisible$`, named
`τ` if unnamed); inhibitor, reset and read arcs (read as normal arcs, with a note on the canvas and a warning). Not
understood: high-level markings, final markings (warning). Fractions or numbers below 1 as arc weights give the
weight 1 and a warning; arcs to missing nodes are skipped with a warning; duplicate ids get a suffix.

If positions are missing (or all equal) the net is laid out automatically (ELK, left to right) and the result says so;
`layout: 'auto'` always lays out. The import fails only for text that is not well-formed XML, is not PNML or contains no
`<net>`. The findings of `validate` on the result are appended to the warnings.

The XML reader is part of `@pnm/io` (elements, attributes, text, CDATA, comments, namespace prefixes ignored; a DOCTYPE
is skipped, entities are never expanded beyond the five predefined ones and character references) and is the same in
the browser and in Node.

### Limits

Capacities, types, guards, inscriptions, timing, roles, simulation settings, notes and the domain view are not part of
PNML `ptnet`; other tools lose them. Arcs of other kinds than normal arcs are not modeled. Token values of JSON nets
are exported as counts in the standard part.
