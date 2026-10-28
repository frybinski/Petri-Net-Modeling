# ADR 0002: React Flow (xyflow) as the canvas

Status: accepted · Date: 2026-10-28

## Context

The editor needs pan and zoom, node dragging, selection with a rubber band, a minimap and accessible keyboard
handling. Petri nets have two node kinds and directed arcs with weights, so some rendering must be custom anyway.
Options were React Flow, a custom SVG renderer, and Konva.

## Decision

Use **`@xyflow/react` 12** with fully **controlled nodes and edges** derived from the document in `@pnm/core`.

- The document is the single source of truth. `lib/flow-model.ts` converts a net into React Flow nodes and edges on
  every change; React Flow never owns state.
- Model positions are **node centers** (`nodeOrigin = [0.5, 0.5]`), notes use their top-left corner. This keeps
  arcs and layouts independent of node sizes.
- Arcs are a **custom edge type**. Their geometry (boundary intersection, arrow head, curved opposite arcs, label
  anchor) is computed in `lib/geometry.ts` from the model, not from DOM handles. The same code feeds the SVG export,
  so the export looks like the canvas.
- Handles are invisible and exist only to start and end a drag (0.3.0). Each node has a `ring` source handle, a band
  of a few pixels around its outline that is made hit-testable with a `clip-path` (dragging from it draws an arc,
  dragging the inside moves the node, and while Alt is held the whole node acts as the ring), and a `body` target
  handle over the whole node that only reacts while an arc is being dragged. `ConnectionMode.Loose` lets a drop on
  any part of a node finish an arc. `isValidConnection` and the custom connection line enforce place/transition
  alternation; a node that would refuse the arc is outlined in red. The arc tool offers the same rule with two clicks.
- Nodes are drawn in SVG inside the node element (exact stroke widths; CSS borders are rounded to whole pixels).
  React Flow snaps the top-left corner of a dragged node, which puts the center of a 44 px node between grid points,
  so snapping to the grid is done in the canvas on the node centers.
- Arc geometry takes the other nodes into account: an arc keeps its slight bulge unless a node is in the way, then it
  takes the other side or a larger bulge. Everything is derived from the model, so the SVG export matches the canvas.
- Dragging writes transient positions into the store and commits one undo step on drag end.

## Consequences

- Pan, zoom, minimap, selection and keyboard navigation come ready-made and tested.
- Pure geometry functions can be unit tested without a browser.
- Computing edges from the model means edges are recomputed while dragging; this is cheap for the intended net
  sizes (hundreds of elements). If nets get much larger, memoize per element.
- Replacing React Flow later only touches `components/canvas` and `lib/flow-model.ts`.
