# ADR 0003: One document format with a JSON net profile

Status: accepted · Date: 2026-10-28

## Context

`PLAN.md` recommends JSON nets (tokens are JSON documents, place types are JSON Schemas, inscriptions use an
expression language) as the first higher net class, with place/transition nets as a special case. M1 only
implements place/transition semantics, but the file format must not break when M2 adds typed tokens.

## Decision

- The model has a `profile` field (`pt-net` or `json-net`) and reserved fields for higher nets: `types` on the net,
  `type` on places, `guard` on transitions, `inscription` on arcs.
- The **marking stores token values**, `Record<PlaceId, Token[]>`, not counts. In a P/T net every token is `1`
  and only the array length counts. `markingToCounts` and `countsToMarking` convert at the boundary of the P/T
  semantics. A P/T net becomes a JSON net by changing the profile and adding types; no migration is needed.
- **Reading is lenient about ranges, strict about structure.** `parseNet` checks types and required fields with Zod.
  Problems such as weight 0, an arc to a missing node or a capacity violation do not block opening a file; they are
  reported by `validate()` as diagnostics with stable codes, so a file can be repaired in the editor.
- `serializeNet` writes a fixed key order with two-space indentation so files diff well.
- The firing rule works on `Multiset`s of place ids and implements the weak capacity rule. Arcs next to an
  invalid weight make a transition unfireable instead of throwing.

## Consequences

- M2 can add JSON Schema types, expression evaluation and binding computation in the core without changing files
  that were written by this version.
- Fields reserved for M2 are preserved on load and save even though the editor ignores them for now.
- Because markings are arrays, very large token counts are more expensive than numbers. P/T nets in this tool are
  small, and a compact encoding can be introduced in a later format version if needed.
