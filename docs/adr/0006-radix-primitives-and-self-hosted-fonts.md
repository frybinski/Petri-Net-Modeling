# ADR 0006: Radix primitives and self-hosted fonts

Status: accepted · Date: 2026-10-28

## Context

The UI polish step (0.3.0) adds tooltips with shortcuts and a right-click context menu with submenus, and replaces the
system font by a typeface with a clear hierarchy between interface, canvas and code. Tooltips and context menus are
hard to get right by hand: collision handling at the window edge, delays and skip-delay between neighbouring controls,
focus return, typeahead and arrow-key navigation in submenus, `aria` wiring and touch long-press. `PLAN.md` already
names Radix UI as the intended component base. Fonts that are loaded from a font service would leak every page view
to a third party, break offline use and the GitHub Pages deployment's independence, and cannot be audited.

## Decision

- Use the **unstyled Radix primitives** `@radix-ui/react-tooltip` and `@radix-ui/react-context-menu`, one package per
  primitive instead of the bundled `radix-ui`, so that only what is used is installed. They are styled with the
  existing design tokens and wrapped in `components/ui/tooltip.tsx` and `components/ui/context-menu.tsx`; no other
  component imports Radix directly. The existing `Menu`, `Dialog` and the binding list stay as they are.
  `@radix-ui/react-popover` was considered for the node hover card and not used: the card must never take focus or
  pointer events, and it is positioned from the screen rectangle of a React Flow node, which a few lines of code do
  better than an anchored popover.
- Use **Inter Variable** for the interface and **JetBrains Mono Variable** for expressions, tokens and code, installed
  as `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono`. Vite bundles the `woff2` files into
  `dist/assets`; the `@font-face` rules use `unicode-range`, so a browser downloads only the subsets (latin, latin-ext,
  and so on) that the text needs. The Latin subsets are 48 kB and 85 kB (Inter) and 40 kB and 15 kB (JetBrains Mono).
  **Nothing is loaded from an external host**; the CSS contains no absolute URLs.
- Both Radix packages (with the floating-ui positioning they build on) are part of the main chunk, which is about
  313 kB gzip after this change. The code editor and the layout engine stay in their own lazily loaded chunks.

## Consequences

- Keyboard and screen reader behaviour of tooltips and context menus follows a widely used implementation. The tooltip
  trigger keeps its own `aria-label`; the tooltip is an addition for pointer users and shows the shortcut.
- Tooltips open on pointer hover after 400 ms and on keyboard focus only when the focus is visible and not inside a
  dialog: a dialog focuses its first button when it opens, and an open tooltip would swallow the first Escape.
- Fonts add up to about 250 kB on disk for the Latin subsets and the rarer scripts that are only fetched on demand.
  A font swap (`font-display: swap`) may show the system font for a moment on a cold start.
- Replacing Radix later only touches the two wrapper files.
