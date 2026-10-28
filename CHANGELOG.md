# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.0: M0 and M1

### Added

- Project scaffold: pnpm workspace, strict TypeScript 5.9, ESLint (flat config), Prettier, Vitest, GitHub Actions CI
  and GitHub Pages deployment.
- `@pnm/core`: net model with places, transitions, arcs, annotations and markings; immutable net operations;
  multiset; P/T firing rule with arc weights, capacities and loops; structural validation with diagnostic codes;
  Zod-backed `.pn.json` format with stable serialization; clipboard fragments; align and distribute.
- `@pnm/layout`: automatic layered layout with ELK.
- `@pnm/web`: editor for place/transition nets with tool palette, properties panel, undo/redo, copy/paste, multi
  selection, grid snapping, minimap, auto layout, file open/save/drag-and-drop, SVG export, autosave, live
  validation, simulation mode, light and dark theme, keyboard shortcut overview.
- Example nets: producer/consumer, traffic light, dining philosophers (3), mutual exclusion.
- Documentation: README, file format description, ADRs 0001 to 0004.
- Tests: unit and property-based tests for the core, layout test, component and store tests for the web app,
  Playwright smoke tests.
