# ADR 0011: Editing the domain view in place with pure edit functions

Status: accepted · Date: 2026-10-28

## Context

The generic view (ADR 0008), the JSON editor (D1) and a language model (ADR 0010) produce a mapping, but a person who
wants a hall to look right needs to move a station, pull a belt around a corner or enlarge a room, and see the result
at once. The edits must not weaken the principle of the domain view (it shows, the net decides), must be undoable, and
must keep the view valid.

## Decision

- **Pure functions in `@pnm/domain`.** Every edit is a function `(view, ref, ...) => view` that returns a new view and
  changes only the addressed entry and its provenance. They know nothing about React, the canvas or the store, so they
  are tested alone and with a property test (random nets, random sequences of edits: V1, V4 and V5 stay satisfied, only
  one entry changes). The app calls them and writes the result with the existing `setDomainView`.
- **One drag is one undo step.** While the pointer is down, the app computes a preview view from the view at the start
  of the drag and the pointer position (`previewDrag` is a pure function of both), draws it, and writes nothing to the
  document. On release the final view is committed once. Escape or a lost pointer discards the preview. An edit that
  does not change the view leaves no undo step.
- **Handles describe the grips, the app draws them.** `handlesFor` gives the grips of an entry (surface, corners, points,
  segment middles, slots, rooms, wall ends) in sheet pixels; `hitHandle` picks one. They are painted on the canvas in
  screen space after the scene, so they keep their size and stay crisp at any zoom and device pixel ratio.
- **Hide instead of delete.** In the mode _Edit layout_ `Delete` sets the entry to `hidden` with a reason. A net element
  is never removed from the picture by deleting in the picture, because the picture is not the model. Hidden entries
  stay reachable as dashed placeholders. **Decor is the only thing that is really removed**, because nothing in the net
  stands behind it.
- **Provenance `user` for hand changes.** Each edit marks its entry as user-made; showing or resetting an entry marks it
  `generic`, which is what it then is. This keeps the origin counts in the panel honest.
- **Kinds follow the roles.** `setEntryKind` offers and accepts only the kinds that rule V4 allows for the role of the
  element and converts the geometry (box, position, path), so the view stays valid.
- **Coordinates are whole numbers, on an 8 px grid on request, inside the canvas.** The grid is the one of the net
  editor; Alt switches it off for one drag.
- **Arcs follow the element they touch.** Moving an element or the end of a belt moves the end of the connected arcs, so
  that the picture does not fall apart. Resizing does not re-route arcs.
- **Out-of-date views are repaired in small steps.** _Fill missing entries_ adds entries only, _Remove stale entries_
  drops only, _Update hash_ only records the new structure. Each is its own undo step, so the person decides.
- **Own selection for decor.** Decor is not an element of the net and has no id, so the domain view keeps its selection
  in a small store; net elements keep sharing the selection with the net editor.

## Consequences

- The preview rebuilds the static scene per pointer move. With a software renderer this costs a few milliseconds at a
  device pixel ratio of 2; with a GPU it is negligible. If hall-sized scenes with thousands of elements need more, the
  dragged entry can be drawn on its own layer over a cached scene.
- Hiding drops the arcs of the hidden element from the view; showing draws generic ones. A hand-made route is lost
  unless the person undoes the hiding.
- Arcs are independent paths. Resizing a station can leave an arc ending inside or outside of it; the arc handles fix
  that by hand.
- The mode needs a valid view (V1). With a view that does not follow the schema the JSON editor remains the way to
  repair it.
