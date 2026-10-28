# ADR 0008: The domain view is a checked, declarative mapping drawn on a canvas

Status: accepted · Date: 2026-10-28

## Context

The simulation of 0.4.0 shows a net as circles and bars. For people who know the process but not Petri nets (and for
the later steps of the project: animation, a language model that proposes a drawing, editing by dragging) the net
should also be shown as what it models: a parcel hall, an office floor plan, a generic flow of belts and stations. The
picture must not become a second model. If a station is drawn with a belt next to it, that must not make anything
faster, and a wrong or invented picture must be detected instead of believed.

## Decision

- **A declarative mapping, no behaviour.** The domain view is a JSON document (`domainView`) that says where and as what
  every place and transition is drawn. Its schema is strict and has no fields for durations, weights, rates or
  conditions; the validation names such fields as errors. Behaviour stays in the net, which is the single source of
  truth for the simulation, the key figures and the later animation.
- **Check instead of trust.** Rules V1 to V8 (schema, keys exist, every element has an entry, kinds fit the roles,
  geometry, room for resources and queues, stale hash, hidden queues) run on every change. Errors and warnings are shown
  with a path and the element, and a mapping with errors can still be drawn as far as it parses, so that the person
  fixing it sees the result. The roles come from `placeRole` of the core, there is no second role logic.
- **Provenance per entry.** Every entry records whether it is `generic`, from a `user` or from an `llm` (with the model
  and a time). The panel counts them and the JSON editor marks changed entries as `user`, so a later step can improve
  the generated parts without overwriting the hand-made ones.
- **A generic mapping for every net.** `genericDomainView` is deterministic, works from the editor positions and passes
  V1 to V5 for any net (a property test checks 250 random nets). A view therefore never needs a language model or
  hand work to exist; those only make it better.
- **FNV-1a instead of SHA-256 for the net hash.** The first draft of the feature asked for SHA-256. The hash only
  detects that a mapping was made for a different structure. A cryptographic hash would make the validation (and with
  it every render and every keystroke in the JSON editor) asynchronous, because `crypto.subtle.digest` is. A 64-bit
  FNV-1a over the sorted ids and arcs is synchronous, ten lines of code, and collisions only cost a missed warning.
- **Stored in the net document, passed through by the core.** `domainView` is an optional top-level field; the format
  stays `1.0`. The core schema lets it through as `unknown` and `@pnm/domain` checks it, so the core stays free of the
  dependency and can still be used without the domain package. Editing the net never changes the mapping automatically:
  removing a place leaves a stale entry that rules V2 and V7 report, and the user decides (_Fill missing entries_).
- **Canvas 2D with a scene graph in between.** The net editor is SVG/DOM (React Flow), which suits tens of nodes and
  editing. The domain view must carry hundreds of moving cases later, so it is a canvas. To keep drawing testable and
  the painter thin, the work is split: `buildScene` is a pure function from net, mapping and marking to draw commands
  in layers with the id of the element on each command and hit regions, and `paintScene` only draws them with a palette
  passed in. Tests check the scene (counts, `+n`, busy slots, hit testing) and that the painter runs for all examples
  with a recording context; the look is checked by screenshots. Hover and selection are a cheap extra layer, so moving
  the pointer does not rebuild the scene. The component handles the device pixel ratio itself.
- **The view follows the app's design system.** Colors come from two palettes that mirror the app's tokens (neutral
  grays, indigo for selection and hover, green for activity), fonts are Inter and JetBrains Mono as everywhere. The
  mockup of the first sketch served as inspiration for what to draw, not for how it looks.
- **One shared hover and selection.** The pointer position is a state in the UI store (`hover`, with the view that set
  it). The net editor lights up the node by setting an attribute on its element instead of re-rendering all nodes.

## Consequences

- A mapping can be wrong in ways the rules do not catch (a station drawn in the wrong room); the rules guarantee only
  that it is consistent with the net.
- The canvas has no accessibility tree of its own. It carries a label with the numbers of places and transitions; the
  structure is available in the net editor and the panel lists every problem. Keyboard access to single elements in the
  picture is not solved.
- The hash does not notice a renamed element with the same id, or a changed marking. That is intended: neither changes
  what a mapping is for.
- The scene is rebuilt whenever the marking changes. That is cheap at the sizes of the examples (a few hundred
  commands); the animation step will need a different path for moving cases and can add one without changing the
  mapping.
