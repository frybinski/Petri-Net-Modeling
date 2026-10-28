# Domain view

A domain view draws a Petri net in the terms of its domain: a hall with conveyor belts, stations and loading gates, a
floor plan with rooms, desks and doors, or, when nothing better is known, a generic picture of belts and stations. It
is a second view next to the net editor, drawn on a Canvas 2D from the net, a **mapping** and a marking.

The principle, which every part of the design follows: **the view shows, the net decides.** A mapping says _where_ and
_as what_ an element is drawn. It contains no durations, weights, rates or conditions (the net has them), and nothing
in it changes how the net behaves. The mapping is data that a person, a tool or a language model can write; it is
checked against the net instead of trusted (rules V1 to V8 below).

The code lives in `packages/domain` (`@pnm/domain`). It depends on `@pnm/core` and `@pnm/layout` and has no React
dependency; the core does not depend on it.

## Where the mapping is stored

In the net document under `domainView` (see [format.md](format.md)). The format version stays `1.0`; files without the
field are valid as before. The core stores the value as it is (`unknown`) and `@pnm/domain` validates it:

```ts
import { validateDomainView } from '@pnm/domain';

const { ok, view, diagnostics } = validateDomainView(net, net.domainView);
```

Editing the net does not touch the mapping. A mapping that no longer fits (a place was deleted, an element was added)
is reported by the rules V2, V3 and V7 and repaired with _Fill missing entries_ and _Update hash_.

## Schema

All objects are strict: unknown keys are errors (rule V1). `domainViewJsonSchema()` returns the JSON Schema (draft
2020-12) for prompts and external tools. Coordinates are pixels of the canvas (`meta.canvas`), the origin is the top
left corner. `Point` is `[x, y]`, `Rect` is `[x, y, width, height]`.

```jsonc
{
  "schemaVersion": 1,
  "netHash": "fnv1a64:c2edca7dd6f2bd35",
  "meta": {
    "theme": "Paketzentrum",
    "viewName": "Halle",
    "entity": { "singular": "Paket", "plural": "Pakete", "sprite": "parcel" },
    "canvas": { "width": 1200, "height": 640 },
    "metersPerPixel": 0.0625, // optional
  },
  "places": {
    "<placeId>": {
      "kind": "conveyor",
      "path": [
        [96, 320],
        [256, 320],
      ],
      "label": "Eingangspuffer",
    },
  },
  "transitions": {
    "<transitionId>": { "kind": "station", "box": [256, 248, 96, 144], "slots": [[304, 304]] },
  },
  "arcs": {
    "<sourceId>><targetId>": {
      "path": [
        [790, 320],
        [810, 320],
      ],
    },
  }, // optional
  "decor": [{ "kind": "wall", "segs": [[16, 16, 1184, 16]], "width": 5 }], // optional
  "provenance": { "places.<id>": { "source": "user", "at": "2026-10-28T09:00:00.000Z" } },
}
```

`entity.sprite` is the picture of a case: `parcel`, `person`, `vehicle`, `document` or `dot`.

### Places

| Kind             | Fields           | Picture                                                                                                     |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `conveyor`       | `path`, `label?` | A belt with rollers and direction chevrons. Cases stand along the path from its end backwards, 16 px apart. |
| `queue`          | `path`, `label?` | A dashed lane with a bar and an arrow at the head. The same placement of cases.                             |
| `buffer`         | `path`, `label?` | A framed band with a mark for every case. The same placement of cases.                                      |
| `slots`          | `of`, `label?`   | The resource places of a transition: one cell per slot of the transition (see below).                       |
| `pool`           | `pos`, `label?`  | A circle with the number of tokens.                                                                         |
| `source`, `sink` | `box`, `label?`  | A box with an arrow in or out and the number of tokens (a truck for parcels, a door for people).            |
| `hidden`         | `reason`         | Not drawn.                                                                                                  |

When more cases wait on a path than fit, the last place shows a counter `+n`.

### Transitions

| Kind                         | Fields                                        | Picture                                                                      |
| ---------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `station`, `machine`, `gate` | `box`, `slots?`, `label?`, `sensor?`          | A card with a status bar; a machine has a gear, a gate a barrier.            |
| `area`, `rooms`              | `box`, `slots`, `rooms?`, `label?`, `sensor?` | A floor area with desks, or rooms (`rooms`) with tables.                     |
| `door`, `dock`, `waypoint`   | `pos`, `pass?`, `label?`, `sensor?`           | A door with its swing, a loading dock, a marker on a route (`pass`: a ring). |
| `hidden`                     | `reason`                                      | Not drawn.                                                                   |

`slots` are the points where the firings of a transition are shown. If a resource place of kind `slots` refers to the
transition, its tokens are the free cells; a firing under way occupies the cell with its index and shows the case
there. `sensor` is free text for the hover card (which sensor would detect the firing in reality).

### Decor and arcs

`decor` is scenery: `room` and `zone` (areas with a label), `wall` (segments `[x1, y1, x2, y2]`), `label`, `furniture`
and `scale` (a scale bar with a label). `arcs` are optional connectors drawn as dashed lines with an arrowhead; keys
are `<sourceId>><targetId>` and the direction of the net arc counts.

### Provenance

Every entry has a provenance (`generic`, `user` or `llm` with an optional model name, plus a timestamp) under the key
`places.<id>`, `transitions.<id>` or `arcs.<key>`. The domain panel counts them; the JSON editor marks every entry that
the user changed as `user`.

## Roles and kinds

The kind of a place must fit its role, computed by `placeRole` of `@pnm/core` (respecting the `role` override of the
place):

| Role       | Allowed kinds                                     |
| ---------- | ------------------------------------------------- |
| `resource` | `slots`, `pool`, `hidden`                         |
| `sink`     | `sink`, `hidden`                                  |
| `source`   | `source`, `queue`, `conveyor`, `buffer`, `hidden` |
| `case`     | everything except `slots`                         |

A transition without input places (an arrival) must be a `door`, a `dock` or `hidden`. A place of kind `slots`
names a transition (`of`) that it forms a loop with: arcs in both directions between them.

## Rules

`validateDomainView(net, view)` returns diagnostics with the rule, severity, path (`places.p1.path[0]`), message and,
where there is one, the element of the net. The view is `ok` when there is no error. The view is returned as soon as
V1 passes, so it can still be drawn if other rules fail.

| Rule | Check                                                                                                                                                              | Severity |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| V1   | The schema holds and there are no extra fields. Fields that describe behaviour (duration, weight, rate, condition, ...) get a message that says so.                | error    |
| V2   | Every key of `places`, `transitions`, `arcs` and `provenance` names an element of the net; arcs only for existing arcs, in the direction of the net.               | error    |
| V3   | Every place and every transition has an entry (`hidden` counts).                                                                                                   | error    |
| V4   | The kind fits the role (table above), a transition without input is a door, a dock or hidden, and `slots.of` is a transition that the place loops with.            | error    |
| V5   | Geometry: points and rectangles inside the canvas, paths with at least two points and a length, rectangles with an area, slots inside the box of their transition. | error    |
| V6   | Room: a transition has at least as many slots as its resource place has initial tokens; a queue, conveyor or buffer is at least 160 px (ten tokens) long.          | warning  |
| V7   | `netHash` matches the net, so the view is not out of date.                                                                                                         | warning  |
| V8   | A place that holds cases (role `case`) is not `hidden`.                                                                                                            | warning  |

The tests contain for every rule an example that triggers exactly this rule (`packages/domain/test/validate.test.ts`).

## The net hash

`netHash(net)` is FNV-1a (64 bit) over the sorted ids of the places, the sorted ids of the transitions and the sorted
arcs as `source>target`, written `fnv1a64:` plus 16 hex digits. Names, positions, markings and inscriptions do not
enter, so renaming or moving elements keeps a view up to date and adding, removing or reconnecting elements does not.
The hash only detects stale views, it is not a security feature, which is why a short synchronous hash is enough (the
first draft of the feature asked for SHA-256, which would make the validation asynchronous). See
[ADR 0008](adr/0008-domain-view-mapping.md).

## The generic view

`genericDomainView(net)` makes a mapping for any net, deterministically:

- The editor positions are scaled into the canvas (1200 px wide, as high as needed between 420 and 900 px, 80 px margin,
  aspect ratio kept). Nodes without a position go on a grid; `genericDomainViewWithLayout` lays out nodes that all sit
  at one spot with ELK first.
- An arrival becomes a `door`, every other transition a `station` (56 px square; a resource with n initial tokens makes
  n slots in a grid and the box grows).
- A resource place that loops with a transition becomes its `slots` (the first one per transition); other resources are
  `pool`s. A sink is a `sink` box, a source place a `queue` towards its first transition, every other place a
  `conveyor` from the middle between the transition before it and the place to the middle between the place and the
  transition behind it, at least 160 px long.
- Arcs get a two-point path from border to border; the arcs of resource slots, which sit inside their transition, get
  none.
- The scenery is a title label and a scale bar. Every entry has the provenance `generic`.

It passes V1 to V5 for every net (a property test over 250 random nets with and without positions checks this) and
may warn under V6 for crowded nets. `fillMissing(net, view)` completes a mapping for the current net: entries of
elements that are gone are dropped, missing entries and entries that break V2 to V5 get generic ones.

## Drawing

`buildScene(net, view, marking, options)` turns the mapping into a `Scene`: draw commands in the layers `decor`, `arcs`,
`places`, `transitions`, `tokens`, `labels` and `highlight`, each with the id of the net element it belongs to, plus
hit regions. `paintScene(ctx, scene, palette)` draws a scene on a `CanvasRenderingContext2D`; the colors come as a
parameter (`LIGHT_PALETTE`, `DARK_PALETTE`), nothing is read from the page. `hitTest(scene, point)` finds the element
under a point (resource cells before stations before belts before arcs), `withHighlight` adds the outline for hover and
selection without rebuilding the scene.

Marking: tokens of places with a path are drawn as sprites along it, `pool`, `source` and `sink` show a number, resource
cells show free (a green dot), busy (a green frame with the case) or not available (crossed). In the editor the view
shows the initial marking; while simulating it shows the current marking and the firings under way as busy cells, and
the card of a transition with a firing gets a green frame. There is no animation yet.

## In the app

- The header has a switch _Net | Domain | Both_ (keys `1`, `2`, `3`). In _Both_ the net is above and the view below, the
  divider can be dragged (or moved with the arrow keys) and is remembered. Selection, hover and the simulation are
  shared.
- The view fits itself into the area and refits on resize until you zoom. The wheel pans, `Ctrl`/`Cmd` + wheel and a
  pinch zoom, dragging pans, `F` fits, `Ctrl+0` resets the zoom; the zoom is in the status bar.
- Hovering an element shows a card (name, id, kind of drawing, role, tokens, origin, sensor) and lights up its
  counterpart in the net, and the other way round. A click selects it.
- The tab _Domain view_ in the right panel shows the problems, the origin of the entries and the state of the hash, the
  actions _Generate generic view_, _Fill missing entries_, _Update hash_ and _Remove domain view_, the appearance
  (theme, name, entity, canvas size), the entry of the selected element and the whole mapping as JSON with live checks.
  Applying the JSON replaces the view in one undo step.

## Limits

This is the first step (D1): the view is static. Missing so far are the animation of firings and cases (D2), the
generation of a mapping by a language model (D3) and editing by dragging in the view (D4). Cases are not tracked
individually in the picture, tokens of JSON nets show as plain cases, and a transition's `slots` have no order
beyond their index.
