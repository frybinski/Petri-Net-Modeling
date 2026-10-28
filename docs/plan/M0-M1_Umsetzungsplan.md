# Umsetzungsplan M0 + M1: Projektgerüst und Editor für Stellen/Transitions-Netze

Stand: 2026-10-28 · Grundlage: `PLAN.md` (Gesamtplan). Dieses Dokument ist die
verbindliche Arbeitsanweisung für die erste Ausbaustufe. Entscheidungen E1–E6 aus
`PLAN.md` gelten in der empfohlenen Variante (JSON-Netze, JSONata, React Flow,
englische Oberfläche mit i18n-Vorbereitung, Local-first, MIT-Lizenz).

## 0. Ergebnis dieser Ausbaustufe

Eine lauffähige, deployte Web-App, in der man Stellen/Transitions-Netze zeichnen,
bearbeiten, speichern, laden und automatisch layouten kann, plus ein
UI-unabhängiges Kernpaket mit Schaltregel und Tests, plus CI. Das Datenformat ist
bereits auf höhere Netze (M2) vorbereitet, die Semantik ist in dieser Stufe auf
Stellen/Transitions-Netze beschränkt.

## 1. Rahmenbedingungen und Konventionen

- **Sprache:** TypeScript überall, `strict: true`, ESM (`"type": "module"`).
  TypeScript in Version **5.x** pinnen (keine 7.x), damit ESLint, Vite und Vitest
  zusammenpassen. Bei Unverträglichkeiten zwischen Werkzeugen jeweils eine
  Hauptversion zurückgehen und die Entscheidung in `docs/adr/` notieren.
- **Monorepo:** pnpm Workspaces. Turborepo nur, wenn es ohne Reibung läuft,
  sonst einfache `pnpm -r`-Skripte. Node 22.
- **Codequalität:** ESLint (flat config, typescript-eslint, react-hooks),
  Prettier, keine `any` außer begründet mit Kommentar.
- **Namen:** Paket-Scope `@pnm/*` (`@pnm/core`, `@pnm/layout`, `@pnm/web`).
  Dateinamen kebab-case, Typen PascalCase.
- **Oberflächentexte:** Englisch, zentral in `apps/web/src/i18n/en.ts` gesammelt
  (einfaches Schlüssel-Objekt, keine Bibliothek nötig).
- **Commits:** kleine, thematische Commits mit englischer Betreffzeile im
  Imperativ. Keine Pull Requests anlegen.
- **Schreibweise in Dokumentation:** „Petri-Netz" (deutsch), „Petri net" (englisch).

## 2. Repository-Struktur

```
Petri-Net-Modeling/
├── apps/
│   └── web/                         # @pnm/web  React + Vite
├── packages/
│   ├── core/                        # @pnm/core  Modell, Validierung, Schaltregel, Format
│   └── layout/                      # @pnm/layout  ELK-Anbindung
├── examples/                        # Beispielnetze *.pn.json
├── docs/
│   ├── adr/                         # Architekturentscheidungen
│   ├── format.md                    # Beschreibung des JSON-Formats
│   └── plan/                        # dieser Plan
├── .github/workflows/ci.yml
├── package.json  pnpm-workspace.yaml  tsconfig.base.json
├── eslint.config.js  .prettierrc  .gitignore  .nvmrc (22)
├── LICENSE (MIT)  README.md  PLAN.md
```

Wurzel-Skripte in `package.json`: `dev`, `build`, `test`, `lint`, `typecheck`,
`format`, `format:check`. Jedes muss am Ende fehlerfrei durchlaufen.

## 3. Paket `@pnm/core`

Keine Browser- oder React-Abhängigkeiten. Nur `zod` als Laufzeitabhängigkeit.

### 3.1 Modell (`src/model.ts`)

```ts
export type Id = string;                                  // nanoid-ähnlich, 10–12 Zeichen
export interface Position { x: number; y: number }
export interface Place {
  id: Id; name: string; position: Position;
  type?: string;                 // Verweis auf net.types (M2), in M1 undefined
  capacity?: number;             // optional, >= 1
}
export interface Transition {
  id: Id; name: string; position: Position;
  guard?: string;                // M2
}
export interface Arc {
  id: Id; source: Id; target: Id;
  weight: number;                // >= 1, Standard 1
  inscription?: string;          // M2
  points?: Position[];           // Stützpunkte, optional
}
export type Token = number | boolean | string | JsonObject | JsonArray;  // M1: nur Anzahl
export type Marking = Record<Id, Token[]>;   // M1: Marken sind `1`-Werte, Anzahl = Länge
export interface PetriNet {
  version: '1.0'; profile: 'pt-net' | 'json-net'; name: string;
  types: Record<string, unknown>;            // JSON-Schema-Objekte (M2)
  places: Place[]; transitions: Transition[]; arcs: Arc[];
  marking: Marking;                           // Anfangsmarkierung
  annotations?: Annotation[];                 // Freitextnotizen auf dem Canvas
}
```

Für P/T-Netze wird die Markierung intern als `Record<Id, number>` geführt.
Dafür gibt es Hilfsfunktionen `markingToCounts` / `countsToMarking`. Das ist
bewusst so, damit M2 ohne Formatbruch Marken als Werte speichern kann.

### 3.2 Hilfsmodule

- `src/id.ts`: `createId()` (kryptografisch zufällig, URL-sicher).
- `src/multiset.ts`: unveränderliche Multimenge über `Map<K, number>` mit
  `add`, `remove`, `contains`, `count`, `union`, `difference`, `equals`.
- `src/net-ops.ts`: reine Funktionen `addPlace`, `addTransition`, `addArc`,
  `removeNode` (entfernt anhängende Kanten), `updateNode`, `setWeight`,
  `setInitialTokens`. Alle liefern ein neues Netz (keine Mutation), geeignet
  für Immer.
- `src/queries.ts`: `preset(net, nodeId)`, `postset(net, nodeId)`, `nodeById`,
  `arcsOf(nodeId)`, `isPlace`, `isTransition`.

### 3.3 Validierung (`src/validate.ts`)

```ts
export interface Diagnostic { severity: 'error' | 'warning'; code: string; message: string; elementId?: Id }
export function validate(net: PetriNet): Diagnostic[]
```
Prüfungen: Schema (Zod), eindeutige IDs, Kanten nur Stelle→Transition oder
Transition→Stelle (Code `ARC_NOT_BIPARTITE`), Kantenenden existieren
(`ARC_DANGLING`), Gewicht ≥ 1, Kapazität ≥ 1, Markierung nur auf existierenden
Stellen und nicht über Kapazität, doppelte Namen als Warnung, isolierte Knoten
als Warnung, Mehrfachkanten gleicher Richtung zwischen denselben Knoten als
Warnung (Vorschlag: Gewicht erhöhen).

### 3.4 Schaltregel für P/T-Netze (`src/semantics/pt.ts`)

```ts
export function enabledTransitions(net: PetriNet, marking: Marking): Id[]
export function isEnabled(net: PetriNet, marking: Marking, transitionId: Id): boolean
export function fire(net: PetriNet, marking: Marking, transitionId: Id): Marking   // wirft bei nicht aktiviert
```
Kapazitäten beachten (schwache Schaltregel: Ergebnis darf Kapazität nicht
überschreiten). Schleifen (Stelle ist zugleich Vor- und Nachbereich) korrekt
behandeln.

### 3.5 Format (`src/format.ts`)

- `parseNet(json: unknown): PetriNet` (Zod, mit lesbaren Fehlern),
  `serializeNet(net): string` (stabile Schlüsselreihenfolge, 2 Leerzeichen).
- `createEmptyNet(name)`.
- `docs/format.md` beschreibt das Format mit Beispiel.

### 3.6 Tests (`packages/core/test/*.test.ts`, Vitest)

- Multimenge: Property-Based-Tests mit `fast-check` (Kommutativität der
  Vereinigung, `difference` nach `union` ergibt Ausgang).
- Schaltregel: Erzeuger/Verbraucher, Schleife, Kapazitätsgrenze, Gewichte > 1,
  nicht aktivierte Transition wirft.
- Validierung: je Diagnosecode ein Testfall.
- Format: Roundtrip `parseNet(JSON.parse(serializeNet(net)))` ist strukturgleich,
  und alle Dateien in `examples/` parsen fehlerfrei und sind valide.
- Zielabdeckung für `@pnm/core`: über 90 % Zeilen.

## 4. Paket `@pnm/layout`

- Abhängigkeit `elkjs` (Bundle-Variante `elk.bundled.js`, ohne Web Worker, damit
  es in Vite und Node gleichermaßen läuft).
- `layoutNet(net, options?: { direction?: 'RIGHT' | 'DOWN'; spacing?: number }): Promise<Record<Id, Position>>`
  mit Algorithmus `layered`, Stellen als Kreise (Ø 40), Transitionen als Rechtecke
  (40 × 60 bzw. 60 × 40 je nach Richtung). Liefert nur Positionen, verändert das
  Netz nicht.
- Ein Test: Layout eines Beispielnetzes liefert für jeden Knoten endliche
  Koordinaten und keine zwei identischen Positionen.

## 5. App `@pnm/web`

### 5.1 Stack

React 19, Vite, Tailwind CSS 4 (`@tailwindcss/vite`), `@xyflow/react` 12,
`zustand` + `immer`, `zundo` für Undo/Redo (oder eigener Patch-Stack mit Immer,
falls zundo nicht passt), `idb-keyval` für Autosave, `lucide-react` für Icons.
Keine schwere Komponentenbibliothek. Kleine eigene Komponenten
(`Button`, `IconButton`, `Panel`, `NumberField`, `TextField`, `Dialog`) mit
Tailwind, Fokusringen und ARIA-Attributen.

### 5.2 Layout der Oberfläche

```
┌─────────────────────────────────────────────────────────────────┐
│ Kopfzeile: Logo · Netzname (editierbar) · Menü: New Open Save   │
│            Export · Auto layout · Undo Redo · Validate · Theme   │
├────────┬────────────────────────────────────────┬───────────────┤
│ Werk-  │                                        │ Eigenschaften │
│ zeug-  │           Canvas (React Flow)          │ des ausge-    │
│ leiste │   Minimap, Zoom-Controls, Raster       │ wählten       │
│ (links)│                                        │ Elements      │
├────────┴────────────────────────────────────────┴───────────────┤
│ Statusleiste: Diagnosen (Fehler/Warnungen anklickbar) · Zoom    │
└─────────────────────────────────────────────────────────────────┘
```

Werkzeuge: **Select** (V), **Place** (P), **Transition** (T), **Arc** (A),
**Annotation** (N). Mit Place/Transition setzt ein Klick auf den Canvas ein neues
Element an der Klickposition (am Raster ausgerichtet) und springt zurück zu
Select. Mit Arc: Klick auf Quelle, dann Ziel. Nicht erlaubte Verbindungen
(Stelle→Stelle, Transition→Transition) werden während des Ziehens rot
dargestellt und nicht angelegt. Zusätzlich sind Kanten durch Ziehen von den
Handles der React-Flow-Knoten möglich (im Select-Modus).

### 5.3 Darstellung

- **Stelle:** Kreis Ø 40 px, Name darunter, Marken innen: bis 5 als Punkte,
  darüber als Zahl. Kapazität optional klein am Rand (`k=3`).
- **Transition:** Rechteck 40 × 60 px (hochkant), Name darunter. Im
  Simulationsmodus (siehe 5.7) aktivierte Transitionen grün hervorgehoben.
- **Kante:** gerade oder leicht gebogene Linie mit Pfeilspitze, Gewicht als
  Label, nur wenn ≠ 1. Auswahl hebt Kante hervor.
- **Annotation:** gelber Notizkasten mit Mehrzeilentext.
- Hell- und Dunkelmodus (CSS-Variablen, Umschalter in Kopfzeile, Vorgabe aus
  `prefers-color-scheme`). Farben: neutrale Grautöne, eine Akzentfarbe für
  Auswahl, Grün für aktiviert, Rot für Fehler.

### 5.4 Zustand (`src/store/`)

```ts
interface EditorState {
  net: PetriNet;                      // Dokument (undo-fähig)
  selection: Id[];                    // nicht undo-fähig
  tool: Tool; mode: 'edit' | 'simulate';
  simMarking: Marking | null;         // aktuelle Markierung im Simulationsmodus
  diagnostics: Diagnostic[];          // abgeleitet, nach jeder Änderung neu berechnet
  dirty: boolean; fileName: string | null;
  // Aktionen (alle über @pnm/core net-ops):
  addPlace(pos), addTransition(pos), addArc(src, tgt), removeSelected(),
  updatePlace(id, patch), updateTransition(id, patch), updateArc(id, patch),
  moveNodes(moves), setTokens(placeId, n), renameNet(name),
  undo(), redo(), newNet(), loadNet(net, fileName?), applyLayout(positions),
  copy(), paste(), selectAll(), startSimulation(), stopSimulation(),
  fireTransition(id), resetSimulation()
}
```
Undo/Redo nur für `net`. Knotenverschiebungen werden pro Drag-Ende als ein
Undo-Schritt zusammengefasst.

### 5.5 Funktionen (Pflicht)

1. Elemente anlegen, benennen (Doppelklick oder Eigenschaftspanel), verschieben,
   löschen (Entf/Backspace), Mehrfachauswahl (Shift, Gummiband).
2. Kanten anlegen mit Gewicht, Gewicht im Panel ändern, Kantenrichtung umkehren.
3. Anfangsmarkierung pro Stelle setzen (Panel, plus `+`/`-` bei Auswahl).
4. Kapazität pro Stelle (optional, leer = unbeschränkt).
5. Undo/Redo (Strg+Z / Strg+Umschalt+Z bzw. Strg+Y), Kopieren/Einfügen
   (Strg+C/V, mit neuen IDs und Versatz), Alles auswählen (Strg+A).
6. Pan (Leertaste+Ziehen oder mittlere Maustaste), Zoom (Rad, Controls,
   „Fit view"), Raster mit Einrasten (umschaltbar), Minimap.
7. **New / Open (.pn.json, Datei-Dialog, Drag-and-drop auf den Canvas) /
   Save (Download .pn.json) / Export SVG** (React-Flow-Viewport als SVG über
   `html-to-image` oder eigenes SVG-Rendering aus dem Modell, letzteres
   bevorzugt, da sauberer).
8. **Autosave** in IndexedDB (debounced, 500 ms) und Wiederherstellen beim Start
   mit Hinweis. Beim Verlassen mit ungespeicherten Änderungen `beforeunload`-Warnung.
9. **Auto layout** über `@pnm/layout`, undo-fähig, Richtung wählbar.
10. **Validate**: Diagnosen in der Statusleiste, Klick selektiert das Element,
    Elemente mit Fehlern bekommen einen roten Rahmen.
11. **Beispiele** aus `examples/` im Menü „Open example" (werden beim Build
    eingebettet).
12. Tastaturkürzel-Übersicht per `?`.

### 5.6 Datei- und Beispielformat

`examples/` enthält mindestens:
- `producer-consumer.pn.json` (Erzeuger/Verbraucher mit Puffer, Kapazität 3)
- `traffic-light.pn.json` (Ampel)
- `dining-philosophers-3.pn.json` (drei Philosophen)
- `mutual-exclusion.pn.json`

Alle mit Positionen, valide, mit `profile: 'pt-net'`.

### 5.7 Simulationsmodus (klein, da der Kern es ohnehin liefert)

Umschalter „Simulate" in der Kopfzeile. Im Simulationsmodus: Bearbeiten
gesperrt, `simMarking` startet mit der Anfangsmarkierung, aktivierte
Transitionen grün, Klick schaltet eine Transition, „Reset" setzt zurück,
„Step (random)" schaltet eine zufällige aktivierte Transition. Ein Verlauf der
letzten Schritte wird im rechten Panel als Liste angezeigt. Mehr Simulation
(Abspielen, Animation, Trace-Export) kommt in M3.

### 5.8 Tests

- Vitest + Testing Library: Store-Aktionen (anlegen, verbinden, löschen,
  undo/redo, copy/paste erzeugt neue IDs), Dateiladen mit ungültigem JSON zeigt
  Fehlermeldung.
- Playwright (Chromium ist vorinstalliert, **kein** `playwright install`
  ausführen, bei Bedarf `executablePath: '/opt/pw-browsers/chromium'`):
  ein Smoke-Test: App öffnen, Stelle und Transition setzen, verbinden,
  speichern löst Download aus, Beispiel öffnen, Simulation schaltet.

## 6. CI und Deployment

`.github/workflows/ci.yml`: bei Push und Pull Request auf allen Branches:
pnpm (über `corepack`/`pnpm/action-setup`), Node 22, Cache, dann
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Playwright-Test als
eigener Job mit `npx playwright install --with-deps chromium` (nur in CI).

`.github/workflows/deploy.yml`: bei Push auf `main` Build der Web-App mit
`base: '/Petri-Net-Modeling/'` und Deployment auf GitHub Pages
(`actions/deploy-pages`). Die Vite-Basis per Umgebungsvariable `VITE_BASE`
steuerbar, Standard `/`.

## 7. Dokumentation

- `README.md`: Zweck, Screenshot-Platzhalter, Schnellstart
  (`pnpm install`, `pnpm dev`), Skripte, Struktur, Verweis auf `PLAN.md` und
  `docs/format.md`, Lizenz.
- `docs/format.md`: Datenformat mit allen Feldern und einem Beispiel.
- `docs/adr/0001-monorepo-typescript.md`, `0002-react-flow-canvas.md`,
  `0003-json-net-profile.md`: je eine Seite (Kontext, Entscheidung, Folgen).
- `CHANGELOG.md` mit Eintrag „0.1.0: M0 + M1".

## 8. Abnahmekriterien (Definition of Done)

Alle Punkte müssen erfüllt sein, bevor die Arbeit als abgeschlossen gilt:

1. `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
   laufen in einem frischen Checkout fehlerfrei durch.
2. `pnpm dev` startet die App, alle Pflichtfunktionen aus 5.5 sind bedienbar.
3. Alle Beispielnetze öffnen, lassen sich layouten und simulieren.
4. Kerntests decken Schaltregel, Validierung, Format und Multimenge ab.
5. Der Playwright-Smoke-Test läuft lokal gegen den Vite-Dev-Server durch.
6. README, format.md, ADRs und CHANGELOG sind vorhanden und aktuell.
7. Keine ESLint-Warnungen, kein `any` ohne Begründung, keine `console.log`.
8. Die Arbeit ist in thematischen Commits auf dem vorgegebenen Branch gepusht.

## 9. Reihenfolge der Umsetzung (empfohlen)

1. Wurzel: pnpm-Workspace, tsconfig.base, ESLint, Prettier, .gitignore, LICENSE.
2. `@pnm/core` vollständig mit Tests (zuerst, weil alles darauf aufbaut).
3. `examples/` und Formatdokumentation.
4. `@pnm/layout` mit Test.
5. `@pnm/web`: Vite-Gerüst, Tailwind, Store, Canvas mit Knoten und Kanten.
6. Werkzeuge, Panel, Tastaturkürzel, Undo/Redo, Copy/Paste.
7. Datei-Operationen, Autosave, Beispiele, SVG-Export, Auto layout.
8. Validierung in der Statusleiste, Simulationsmodus.
9. Dunkelmodus, Feinschliff, Tests der Oberfläche, Playwright.
10. CI, Deployment, README, ADRs, CHANGELOG.

Nach jedem Schritt committen. Zwischendurch regelmäßig `pnpm typecheck` und
`pnpm test` ausführen, nicht erst am Ende.
