# ADR 0001: Monorepo with pnpm workspaces and strict TypeScript

Status: accepted · Date: 2026-10-28

## Context

The tool should share its net logic between a browser editor, a future command line tool and a future server. The
logic must not depend on the UI. The first increment contains one app and two packages; more packages (expression
language, import/export, CLI) follow in later milestones.

## Decision

- One repository with **pnpm workspaces** (`apps/*`, `packages/*`) and the scope `@pnm/*`.
- **TypeScript everywhere**, `strict` plus `noUncheckedIndexedAccess`, ES modules only, Node 22.
- **TypeScript is pinned to 5.9.x.** TypeScript 7 (the native rewrite) is available on npm, but the tool chain
  (typescript-eslint declares `typescript <6.1`) does not support it yet.
- **No Turborepo for now.** Plain `pnpm -r` scripts run every task in topological order; the repository is small and
  the extra layer would only add configuration. Turborepo can be added later without changing package scripts.
- **Packages are consumed as source.** `@pnm/core` and `@pnm/layout` export their `src/index.ts`; Vite and Vitest
  compile them together with the app. Their `build` script is a type check. This avoids a separate build step and
  stale output during development. A package that must run in plain Node (the CLI) will get a real build then.
- Current major versions for the rest of the stack: React 19, Vite 8, Vitest 5, ESLint 10 with typescript-eslint 8,
  Tailwind CSS 4, `@xyflow/react` 12, zustand 5, Zod 4, elkjs 0.12. All combinations worked without stepping down a
  major version.

## Consequences

- One `pnpm install` and one set of scripts for everything; the core is testable without a browser.
- Because packages are consumed as source, every consumer needs a TypeScript-aware bundler or runner.
- Moving to TypeScript 7 later is a mechanical change once ESLint support exists; record it in a new ADR then.
