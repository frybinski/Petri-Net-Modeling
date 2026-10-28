# ADR 0004: Undo and redo as a snapshot stack over the immutable net

Status: accepted · Date: 2026-10-28

## Context

The implementation plan suggests zustand with Immer and `zundo` for undo and redo, or a custom stack. All net
operations in `@pnm/core` are pure functions that return a new net and share unchanged parts structurally. Undo must
cover the document only, not selection, tool or simulation state, and a node drag must be one step.

## Decision

Keep the history in the editor store as two arrays of net snapshots (`past`, `future`) with a limit of 200 steps. Every
document change goes through one `commit` function that pushes the previous net, clears `future` and recomputes the
diagnostics. Because nets are immutable and share structure, a snapshot costs little memory.

- Neither `zundo` nor Immer is used. Immer would only wrap operations that are already immutable, and `zundo` would
  add a second store for state that is trivial to hold here.
- A document is **dirty** exactly when `net !== savedNet`, so undoing back to the saved state clears the flag.
- Loading or creating a net clears the history.
- Text fields commit on blur or Enter, and drags commit on release, so one user gesture is one undo step.
- Undo, redo and editing are disabled while the simulation runs; the simulation marking is separate state.

## Consequences

- No extra dependencies, simple tests (`store/editor-store.test.ts` covers the history behaviour).
- Every step stores a reference to a full net rather than a patch. For nets far larger than the intended size, a patch
  based history (Immer patches) could replace the snapshots behind the same `commit` function.
