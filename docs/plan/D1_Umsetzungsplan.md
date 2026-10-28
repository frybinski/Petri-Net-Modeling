# Umsetzungsplan D1: Domänenansicht ohne Simulation

Stand: 2026-10-28 · Grundlage: Feature-Auftrag „Domänenansicht",
`docs/plan/Domaenenansicht_Einordnung.md`, Mockup
`docs/mockups/domaenenansicht.html` (Referenz für Verhalten, Inspiration für
das Aussehen). Stand des Werkzeugs: 0.4.0 (M0–M3 plus UI-Polish).

## 0. Ergebnis

Ein Paket `@pnm/domain` definiert die Abbildung eines Netzes auf eine
Domänenansicht (Schema), prüft sie gegen das Netz (Regeln V1 bis V8) und
erzeugt deterministisch eine generische Abbildung für jedes Netz. Die Web-App
bekommt eine zweite Ansicht neben dem Netzeditor, die aus Netz, Abbildung und
Anfangsmarkierung eine statische Szene in Canvas 2D zeichnet: Halle oder
Grundriss mit Förderstrecken, Stationen, Plätzen, Toren, Räumen und Marken.
Hover verknüpft beide Ansichten. Die Abbildung wird im Netzdokument unter
`domainView` gespeichert. Die Abbildungen für Paketzentrum und Smart Office
aus dem Mockup sind in das Schema übertragen. Animation (D2), LLM-Erzeugung
(D3) und Bearbeiten durch Ziehen (D4) folgen.

Abnahme nach Auftrag: **A4** (generische Abbildung für 200 zufällige Netze
gültig) und **A5** (je Regel V1 bis V8 ein auslösendes Beispiel).

## 1. Paket `@pnm/domain`

Abhängigkeiten: `@pnm/core`, `@pnm/layout`, `zod`. Keine React-Abhängigkeit.
Der Renderer (Abschnitt 3) liegt ebenfalls hier, als reine Funktionen ohne
DOM-Zugriff, plus ein kleiner Canvas-Painter.

### 1.1 Schema (`src/schema.ts`)

TypeScript-Typen nach dem Auftrag, dazu ein Zod-Schema mit
`additionalProperties: false` auf allen Ebenen (`z.object(...).strict()`) und
eine Funktion `domainViewJsonSchema()`, die das JSON Schema (Draft 2020-12)
liefert, später für den LLM-Prompt (D3).

```ts
export type Point = [number, number];
export type Rect = [number, number, number, number];
export type Sprite = 'parcel' | 'person' | 'vehicle' | 'document' | 'dot';

export interface DomainView {
  schemaVersion: 1;
  netHash: string;                    // "fnv1a64:<16 hex>", siehe 1.3
  meta: {
    theme: string; viewName: string;
    entity: { singular: string; plural: string; sprite: Sprite };
    canvas: { width: number; height: number };
    metersPerPixel?: number;
  };
  places: Record<Id, PlaceView>;
  transitions: Record<Id, TransitionView>;
  arcs?: Record<string, { path: Point[] }>;     // Schlüssel "<sourceId>><targetId>"
  decor?: Decor[];
  provenance: Record<string, Provenance>;        // "places.<id>", "transitions.<id>", "arcs.<key>"
}
export type PlaceView =
  | { kind: 'queue' | 'conveyor' | 'buffer'; path: Point[]; label?: string }
  | { kind: 'slots'; of: Id; label?: string }
  | { kind: 'pool'; pos: Point; label?: string }
  | { kind: 'source' | 'sink'; box: Rect; label?: string }
  | { kind: 'hidden'; reason: string };
export type TransitionView =
  | { kind: 'station' | 'machine' | 'gate'; box: Rect; slots?: Point[]; label?: string; sensor?: string }
  | { kind: 'area' | 'rooms'; box: Rect; slots: Point[]; rooms?: Rect[]; label?: string; sensor?: string }
  | { kind: 'door' | 'dock' | 'waypoint'; pos: Point; pass?: boolean; label?: string; sensor?: string }
  | { kind: 'hidden'; reason: string };
export type Decor =
  | { kind: 'room' | 'zone'; rect: Rect; label?: string }
  | { kind: 'wall'; segs: Rect[]; width?: number }       // x1,y1,x2,y2 je Segment
  | { kind: 'label'; pos: Point; text: string }
  | { kind: 'furniture'; rect: Rect }
  | { kind: 'scale'; pos: Point; px: number; label: string };
export interface Provenance { source: 'llm' | 'user' | 'generic'; model?: string; at: string }
```

Im Netzdokument: `PetriNet.domainView?: DomainView` (optionales Feld, Format
bleibt 1.0, Zod-Schema in `@pnm/core` referenziert das Schema aus
`@pnm/domain` **nicht**, sondern lässt `domainView` als `unknown` durch und
`@pnm/domain` prüft es. So bleibt der Kern frei von der Abhängigkeit).

### 1.2 Rollen

Wiederverwendung von `placeRole` und `isSourceTransition` aus `@pnm/core`
(M3). Keine zweite Rollenlogik.

### 1.3 Netz-Hash (`src/hash.ts`)

`netHash(net)`: FNV-1a 64 Bit über die sortierten IDs der Stellen, der
Transitionen und der Kanten (als `source>target`), getrennt durch
Trennzeichen, Ergebnis `"fnv1a64:" + 16 Hexziffern`. Synchron, damit die
Prüfung synchron bleibt. Namen, Positionen, Marken und Inschriften gehen
nicht ein. Abweichung zum Auftrag (sha256): Der Hash dient nur der
Erkennung veralteter Abbildungen, nicht der Sicherheit. Das ist in der
Doku und im ADR festzuhalten.

### 1.4 Prüfung (`src/validate.ts`)

```ts
export interface DomainDiagnostic { rule: 'V1'|…|'V8'; severity: 'error'|'warning'; path: string; message: string; elementId?: Id }
export function validateDomainView(net: PetriNet, view: unknown): { ok: boolean; view?: DomainView; diagnostics: DomainDiagnostic[] }
```

| Regel | Prüfung | Stufe |
|------|---------|-------|
| V1 | Zod-Schema gültig, keine Zusatzfelder (insbesondere keine Dauern, Gewichte, Raten, Bedingungen). Fehler mit Pfad aus Zod. | Fehler |
| V2 | Jeder Schlüssel in `places`, `transitions`, `arcs`, `provenance` existiert im Netz; `arcs` nur für bestehende Kanten (Richtung beachten). | Fehler |
| V3 | Jede Stelle und jede Transition hat genau einen Eintrag (`hidden` mit `reason` zählt). | Fehler |
| V4 | Art passt zur Rolle: `resource` → `slots`/`pool`/`hidden`; `sink` → `sink`/`hidden`; `source`-Stelle → `source`/`queue`/`conveyor`/`buffer`/`hidden`; Quell-Transition → `door`/`dock`/`hidden`; `slots.of` nennt eine Transition, mit der die Stelle eine Schleife bildet; `case`-Stelle nicht `slots`. | Fehler |
| V5 | Geometrie: alle Punkte und Rechtecke innerhalb `meta.canvas` (Toleranz 0), Pfade ≥ 2 Punkte und Länge > 0, Rechtecke mit positiver Fläche, `slots`-Punkte innerhalb der `box` der Transition. | Fehler |
| V6 | Platz: Zahl der `slots` einer Transition ≥ Anfangsmarken der zugehörigen Ressource; Pfadlänge einer Warteschlange ≥ 10 × Markenabstand (Konstante 16 px). | Warnung |
| V7 | `netHash` stimmt mit `netHash(net)` überein. | Warnung |
| V8 | `case`-Stellen sind nicht `hidden`. | Warnung |

Die Regel V4 darf eine Stelle mit `role`-Überschreibung aus dem Netz
berücksichtigen (die Rolle kommt aus `placeRole`).

### 1.5 Generische Abbildung (`src/generic.ts`)

```ts
export function genericDomainView(net: PetriNet, opts?: { canvas?: { width: number; height: number }; theme?: string }): DomainView
export function fillMissing(net: PetriNet, view: DomainView): DomainView   // ergänzt fehlende oder ungültige Einträge generisch, Herkunft "generic"
```

Deterministisch, ohne Zufall:

1. **Layout.** Editorpositionen, falls alle Knoten welche haben (immer der
   Fall im Werkzeug). Sonst `layoutNet` aus `@pnm/layout` mit Richtung
   RIGHT. Die Positionen werden proportional in den Canvas (Vorgabe
   1200 × 700) mit 80 px Rand skaliert, Seitenverhältnis bleibt erhalten.
2. **Transitionen.** Quell-Transition → `door` (`pos`), sonst `station`
   (`box` 56 × 56 um die Position, `slots`: ein Punkt in der Mitte oder, bei
   einer Ressource mit n Anfangsmarken in Schleife, n Punkte in einem Raster
   innerhalb der Box, Box wächst bei Bedarf).
3. **Stellen.** `resource` → `slots` der Schleifen-Transition (gibt es
   mehrere, die erste in Netzreihenfolge; die übrigen Ressourcen werden
   `pool` neben der Stelle). `sink` → `sink` (`box` 56 × 40). `source`-Stelle
   (ohne Vortransition, kein Fall) → `queue` von der Position zur ersten
   Nachtransition. `case` → `conveyor` mit Pfad von der Mitte zwischen
   Vortransition und Stelle bis zur Mitte zwischen Stelle und
   Nachtransition (mehrere Vor- oder Nachtransitionen: Pfad durch die
   Stellenposition mit je einem Punkt). Pfadlänge mindestens 160 px (bei
   Bedarf Endpunkte verlängern), sonst Warnung V6 vermeiden.
4. **Kanten.** `arcs` mit Zwei-Punkt-Pfaden vom Ende des einen zum Anfang
   des anderen Elements (Ankerpunkte: Boxmitte bzw. Pfadende).
5. **Meta.** `theme` aus dem Netznamen, `viewName` „Generic view", `entity`
   { 'Case', 'Cases', 'dot' } bzw. aus `simulation.caseIdPrefix` abgeleitet
   (P- → Parcel, M- → Person, sonst Case), `canvas` wie oben.
6. **Dekor.** Ein `label` oben links mit dem Netznamen, ein `scale` unten
   rechts (100 px, „10 m"), optional `zone` um zusammenhängende Gruppen
   (nicht in D1).
7. **Herkunft.** Jeder Eintrag `generic` mit Zeitpunkt.

Die generische Abbildung muss für jedes gültige Netz V1 bis V5 bestehen
(Fehlerfreiheit), Warnungen sind erlaubt. Property-Test mit fast-check über
mindestens 200 zufällige Netze (0 bis 30 Stellen, 0 bis 30 Transitionen,
zufällige bipartite Kanten, zufällige Anfangsmarken, mit und ohne
Positionen), Abnahme A4.

### 1.6 Übertragung aus dem Mockup (`src/convert-legacy.ts`, nur für Tests und Beispiele)

Funktion, die das Vorläuferformat des Mockups (`as`, `lane`, `turnstile`,
`diverter`+`motion`, `exit`, `trucks`, `token`, `object`) in das Schema
übersetzt. Damit werden `PAKET_MAP` und `OFFICE_MAP` einmalig konvertiert,
von Hand nachgeprüft und als `domainView` in `examples/parcel-center.pn.json`
und `examples/smart-office.pn.json` abgelegt (mit korrektem `netHash`,
Herkunft `user`). `complaint-handling` bekommt keine Abbildung (die
generische greift). Alle drei müssen ohne Fehlerdiagnosen sein, Warnungen
sind zu prüfen und möglichst zu beheben (Pfadlängen, Slots).

### 1.7 Szene und Renderer (`src/scene.ts`, `src/paint.ts`)

Zwei Schichten, damit das Zeichnen testbar bleibt:

- `buildScene(net, view, marking, opts): Scene` erzeugt eine Liste von
  Zeichenbefehlen (Rechteck, Pfad, Kreis, Text, Sprite mit Art und
  Position, Zähler) in Ebenen: `decor`, `places`, `transitions`, `tokens`,
  `labels`, `highlight`. Marken aus der Markierung: entlang eines Pfads vom
  Ende her mit 16 px Abstand (höchstens so viele, wie passen, Rest als
  Zähler „+n"), in `slots` je Platz eine Marke, in `pool`/`sink`/`source`
  als Zähler. Jeder Befehl trägt `elementId` für Treffertests.
- `paintScene(ctx: CanvasRenderingContext2D, scene, theme)` zeichnet die
  Szene. Theme-Farben kommen als Parameter (hell und dunkel), nicht aus dem
  DOM. HiDPI über `devicePixelRatio` im Aufrufer.
- `hitTest(scene, point): { elementId; kind } | null`.
- Sprites als kleine Vektorzeichnungen: parcel (Karton mit Band), person
  (Kopf und Schulter), vehicle (Wagen), document (Blatt), dot. Mit Schatten
  und zwei Farbtönen, Größe 14 bis 18 px.
- Darstellungen: conveyor (Band mit Rollenmuster), queue (gestrichelte Linie
  mit Richtungspfeil), buffer (gerahmte Fläche entlang des Pfads), station
  (Karte mit Titel, Statusleiste, Plätzen), machine (Karte mit Zahnrad-Icon),
  gate (schmale Karte mit Schranke), area (Fläche mit Raster aus Plätzen,
  Tischsymbol je Platz), rooms (Fläche mit Räumen als Rechtecke, Platz je
  Raum), door (Türbogen mit Pfeil), dock (Tor mit Laderampe), waypoint
  (Raute), source (Pfeil in die Szene), sink (Pfeil heraus mit Zähler),
  pool (Kreis mit Zähler), decor room/zone (Rahmen, Beschriftung in
  Kapitälchen), wall (dicke Linie), furniture (gefülltes Rechteck), label,
  scale. Alles im Designsystem des Werkzeugs: neutrale Grautöne, Indigo für
  Auswahl und Hover, Grün für aktiv (D2), Bernstein und Rot für Engpässe
  (D2). Hintergrund: feines Raster wie im Editor.

## 2. Format und Kern

- `PetriNet.domainView?: unknown` im Kern-Schema (durchgereicht, nicht
  geprüft), Serialisierung stabil. `docs/format.md` ergänzen und auf
  `docs/domain-view.md` verweisen.
- Netzoperationen: `setDomainView(net, view | undefined)`.
- Beim Entfernen von Stellen, Transitionen oder Kanten im Editor bleibt die
  Abbildung unverändert (V2/V3/V7 melden das), kein automatisches Löschen.

## 3. App `@pnm/web`

### 3.1 Ansichten

- Kopfzeile: Umschalter „Net | Domain | Both" (Segmented Control neben
  Edit/Simulate, Kürzel `1`, `2`, `3`). „Both" teilt den Arbeitsbereich
  vertikal (Netz oben, Domäne unten, Trenner ziehbar, Verhältnis in
  `localStorage`). Auswahl, Hover und Simulationszustand werden geteilt.
- Domänenansicht: `<canvas>` füllt den Bereich, Fit-to-view beim Öffnen und
  bei Resize, Pan (Ziehen oder Scrollrad), Zoom (Strg/Cmd+Rad, Pinch, Buttons
  wie im Editor), Zoom-Prozent in der Statusleiste. Dunkelmodus.
- Hover auf ein Element: Hervorhebung in Indigo, Hover-Karte wie im Editor
  mit Name, Netz-ID, Art der Darstellung, Rolle, Marken, Herkunft. Zugleich
  wird das Gegenstück im Netzeditor hervorgehoben (Hover-Zustand im
  UI-Store), und umgekehrt (Hover im Netz hebt in der Domäne hervor).
  Klick wählt das Element aus (gemeinsame Auswahl, Panel zeigt es).
- Leere Abbildung: Hinweiskarte „No domain view yet" mit Button
  „Generate generic view".

### 3.2 Panel „Domain view" (Reiter im rechten Panel, nur in Domain/Both)

- Kopf: Theme, View name, Entity (Singular, Plural, Sprite-Auswahl),
  Canvas-Größe, editierbar.
- Status: Zahl der Einträge je Herkunft (llm, user, generic), Hash-Status
  (passt / veraltet), Diagnosen V1 bis V8 mit Klick-Selektion des Elements
  (wie Diagnosen im Editor).
- Aktionen: „Generate generic view" (ersetzt alles nach Bestätigung, wenn
  Einträge mit Herkunft user oder llm existieren), „Fill missing entries"
  (`fillMissing`), „Update hash" (nur wenn V7 warnt und sonst alles gültig),
  „Remove domain view".
- JSON-Ansicht: CodeMirror (JSON-Modus, wie Typeditor) mit der Abbildung,
  Live-Prüfung, Übernehmen mit Button „Apply" (nur bei fehlerfreiem JSON,
  V1-Fehler werden im Editor markiert). Jede Übernahme setzt die Herkunft
  geänderter Einträge auf `user`. Undo-fähig. (Ziehen in der Ansicht kommt
  in D4.)
- Elementansicht: bei ausgewähltem Element dessen Eintrag als JSON-Ausschnitt
  mit Herkunft und Zeitpunkt.

### 3.3 Statische Darstellung

In D1 zeigt die Domänenansicht die **Anfangsmarkierung** im Editiermodus und
im Simulationsmodus die **aktuelle Markierung** aus dem Store (ohne
Bewegung). Laufende Schaltungen werden als belegte Plätze gezeichnet
(Marke auf dem Slot), Transition erhält einen aktiven Rahmen. Keine Animation
(D2). Damit ist die Verbindung zum Ereignisstrom bereits sichtbar.

### 3.4 Tests

- Unit: Store für Ansichtsumschaltung und Hover-Zustand, Panel-Aktionen
  (generate, fill, update hash, remove, apply JSON mit Fehler und ohne),
  Szenenaufbau (Marken entlang Pfad: Anzahl und „+n", Slots belegt),
  Treffertest.
- Playwright: Paketzentrum öffnen, auf „Domain" schalten, Canvas sichtbar,
  Panel zeigt „0 problems", Hover über eine Station hebt im „Both"-Modus die
  Transition im Netz hervor; Reklamation öffnen, Hinweiskarte, „Generate
  generic view", Panel zeigt Herkunft generic und 0 Fehler; eine Stelle im
  Netz löschen, Panel zeigt V3 und V7, „Fill missing entries" und „Update
  hash" bereinigen; Simulation starten, Marken erscheinen in der Domäne.

## 4. Dokumentation

- `docs/domain-view.md` (neu): Schema mit allen Arten, Rollen und Regeln
  V1 bis V8, generische Abbildung, Hash, Beispiele, Grenzen.
- `docs/adr/0008-domain-view-mapping.md`: deklarative Abbildung ohne
  Verhalten, Prüfung statt Vertrauen, FNV-Hash statt sha256, Canvas 2D mit
  Szenengraph, Speicherung im Netzdokument.
- README: Feature und Screenshot (Paketzentrum als Halle, Smart Office als
  Grundriss, hell und dunkel), Status 0.5.0, CHANGELOG 0.5.0.
- Tastaturkürzel: `1`, `2`, `3` für die Ansichten.

## 5. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei.
2. Playwright (alt und neu) läuft lokal.
3. **A4**: Property-Test mit 200 zufälligen Netzen, generische Abbildung ohne Fehler (V1 bis V5).
4. **A5**: je Regel V1 bis V8 ein Test, der genau diese Regel auslöst.
5. Paketzentrum und Smart Office zeigen die übertragenen Abbildungen ohne Fehler und ohne Warnungen, Reklamation die generische Abbildung ohne Fehler. Screenshots hell und dunkel unter `docs/images/`.
6. Hover-Verknüpfung in beide Richtungen funktioniert (Test).
7. Dokumentation vollständig, keine Lint-Warnungen, kein `any` ohne Begründung, keine `console.log`.
8. Thematische Commits, gepusht.

## 6. Reihenfolge

1. `@pnm/domain`: Schema, Hash, Rollen-Anbindung, Prüfung mit Tests (A5).
2. Generische Abbildung mit Property-Test (A4), `fillMissing`.
3. Konverter für das Mockup-Format, Abbildungen in die Beispiele, Nachprüfung.
4. Szene und Painter mit Sprites und Darstellungen, Treffertest, Tests.
5. Kern: `domainView`-Feld, Operation, Format-Doku.
6. Web: Ansichtsumschalter, Canvas-Komponente, Pan/Zoom, Hover-Verknüpfung.
7. Web: Panel mit Status, Diagnosen, Aktionen, JSON-Editor.
8. Simulationsmarkierung in der Domäne, Tests, Playwright.
9. Doku, ADR, README, Screenshots, CHANGELOG.

Nach jedem Schritt committen, `pnpm typecheck && pnpm test` regelmäßig.
