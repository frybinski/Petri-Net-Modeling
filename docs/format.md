# File format (`.pn.json`)

A Petri net is stored as a single JSON document. The same structure is the
in-memory model of `@pnm/core`, the save format of the web editor, and the
planned input for the command line tool and API. Files use the extension
`.pn.json`. The current format version is `1.0`.

The format is already prepared for higher Petri nets (typed places, guards and
arc inscriptions, planned for M2). In the current release only the
`pt-net` profile has semantics; fields reserved for higher nets are accepted,
preserved and ignored.

## Top level

| Field         | Type                       | Required | Description                                                            |
| ------------- | -------------------------- | -------- | ---------------------------------------------------------------------- |
| `version`     | `"1.0"`                    | yes      | Format version.                                                        |
| `profile`     | `"pt-net"` or `"json-net"` | yes      | Net class. `pt-net` is a place/transition net; `json-net` is reserved. |
| `name`        | string                     | yes      | Display name of the net.                                               |
| `types`       | object                     | yes      | JSON Schema objects keyed by type name (M2). Empty for `pt-net`.       |
| `places`      | array of place             | yes      | See below.                                                             |
| `transitions` | array of transition        | yes      | See below.                                                             |
| `arcs`        | array of arc               | yes      | See below.                                                             |
| `marking`     | object                     | yes      | Initial marking: place id to an array of tokens.                       |
| `annotations` | array of annotation        | no       | Free-text notes on the canvas.                                         |

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
| `type`     | string  | no       | Name of an entry in `types` (M2).                   |

### Transition

| Field      | Type    | Required | Description                                     |
| ---------- | ------- | -------- | ----------------------------------------------- |
| `id`       | string  | yes      |                                                 |
| `name`     | string  | yes      | Label shown below the transition.               |
| `position` | `{x,y}` | yes      | Center of the transition in canvas coordinates. |
| `guard`    | string  | no       | Guard expression (M2).                          |

### Arc

| Field         | Type      | Required | Description                                               |
| ------------- | --------- | -------- | --------------------------------------------------------- |
| `id`          | string    | yes      |                                                           |
| `source`      | string    | yes      | Id of a place or transition.                              |
| `target`      | string    | yes      | Id of a transition (if the source is a place) or a place. |
| `weight`      | number    | yes      | Integer >= 1. Number of tokens consumed or produced.      |
| `inscription` | string    | no       | Arc expression (M2).                                      |
| `points`      | `{x,y}[]` | no       | Bend points between source and target.                    |

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

For higher nets (M2) tokens are arbitrary JSON values except `null`, which is why
the marking stores values rather than counts. A P/T net can therefore be turned
into a JSON net without a format change.

## Reading and validation

Reading checks the structure (types, required fields, finite numbers). Range and
consistency problems do not prevent a file from opening, so that they can be
repaired in the editor. They are reported as diagnostics instead:

| Code                       | Severity | Meaning                                                         |
| -------------------------- | -------- | --------------------------------------------------------------- |
| `SCHEMA_INVALID`           | error    | The document does not match the format.                         |
| `DUPLICATE_ID`             | error    | An id is used more than once.                                   |
| `ARC_DANGLING`             | error    | An arc end refers to a missing node.                            |
| `ARC_NOT_BIPARTITE`        | error    | An arc connects two places or two transitions.                  |
| `ARC_WEIGHT_INVALID`       | error    | Weight is not an integer >= 1.                                  |
| `CAPACITY_INVALID`         | error    | Capacity is not an integer >= 1.                                |
| `MARKING_UNKNOWN_PLACE`    | error    | The marking refers to a place that does not exist.              |
| `MARKING_EXCEEDS_CAPACITY` | error    | The initial marking holds more tokens than the capacity allows. |
| `DUPLICATE_NAME`           | warning  | Two places or two transitions share a name.                     |
| `ISOLATED_NODE`            | warning  | A place or transition has no arc.                               |
| `MULTIPLE_ARCS`            | warning  | Parallel arcs in the same direction; raise the weight instead.  |

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

More complete nets live in [`examples/`](../examples).

## Serialization

`serializeNet` writes keys in a fixed order (`version`, `profile`, `name`,
`types`, `places`, `transitions`, `arcs`, `marking`, `annotations`), uses two
spaces of indentation and ends with a newline, so that files diff cleanly in
version control. Marking entries follow the order of the places; empty entries
are omitted.
