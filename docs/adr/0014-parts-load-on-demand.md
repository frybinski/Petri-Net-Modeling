# ADR 0014: Parts that most sessions never open load on demand

Status: accepted · Date: 2026-10-29

## Context

The web app grew with every milestone. By 1.0.0-rc.1 the page fetched 4.3 MB of JavaScript (1.27 MB gzipped) before it
showed anything: the layout engine (ELK, 1.4 MB), the domain view and its painter, the analysis, the export formats
and the LLM client with its schema library were all reachable from the entry point by static imports, although most
sessions draw and simulate a net and never open them. The limitation was recorded in M2 for JSONata and Ajv (the
"270 kB gzip" main bundle) and had grown unnoticed since.

## Decision

- **Lazy boundaries at the components, not in the packages.** The domain canvas, the domain panel, the analysis panel
  (with the state space dialog inside it) and the dialogs for export, generation, its log and the provider settings are
  `React.lazy` components behind `Suspense` (`components/lazy-parts.tsx`). A dialog is mounted the first time it is
  opened and stays mounted, so that its closing behaves as before. The packages stay as they are (`sideEffects: false`, ES modules), so the bundler splits them along the components.
- **No static edge back into the start.** What the start still needs from a lazy part goes through a small registration
  (`lib/domain-edit-api.ts`, `lib/domain-view-api.ts`): the domain chunk registers its operations when it loads, and
  the keyboard commands call them only when they exist. Code that is only needed at the moment of an action
  (`@pnm/io` for PNML and event logs, the layout engine for a net without positions) is imported dynamically inside the
  function. `@pnm/domain` no longer imports `@pnm/layout` at the top.
- **A test guards it.** `src/startup-graph.test.ts` walks the static imports from `main.tsx` (type-only imports and
  `import()` do not count) and fails when the start reaches `@pnm/domain`, `@pnm/io`, `@pnm/llm`, the layout engine or
  the files of the lazy parts, apart from a short list of small files.
- **JSONata and Ajv stay in the start.** Validation, bindings and the type manager need them at once; making them lazy
  would turn every first keystroke into an asynchronous step.

## Consequences

- The JavaScript fetched at start falls from 4286 kB to 1189 kB (1269 kB to 351 kB gzipped); the entry chunk from 1390
  kB to 669 kB. Opening the domain view, the Analyze tab or an export dialog for the first time fetches its chunk (20 to
  90 kB gzipped) and shows _Loading…_ for a moment. Tests of those parts wait for the part (`findBy…`).
- The size of the parts grows without the start growing. The number to watch is the startup figure of `pnpm build`
  (the files that `index.html` loads), not the largest chunk.
- A new feature that needs a lazy part from the start must go through a registration like the existing ones, or the
  guard test says so.
