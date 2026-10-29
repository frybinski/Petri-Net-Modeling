# Umsetzungsplan D4: Bearbeiten der Abbildung in der Ansicht

Stand: 2026-10-28 · Grundlage: Feature-Auftrag „Domänenansicht" (Meilenstein
„M4 Bearbeiten und Export", bei uns D4), `docs/plan/Domaenenansicht_Einordnung.md`,
D1 bis D3. Stand des Werkzeugs: 0.7.0.

## 0. Ergebnis

Die Abbildung lässt sich direkt in der Domänenansicht bearbeiten: Stationen,
Räume, Tore, Pools, Senken und Dekor verschieben und in der Größe ändern,
Pfadpunkte von Förderstrecken und Warteschlangen ziehen, hinzufügen und
entfernen, Plätze innerhalb einer Station verschieben, Kantenpfade anpassen,
die Art eines Eintrags wechseln. Jede Handänderung setzt die Herkunft auf
`user`, ist undo-fähig und wird sofort geprüft. Der JSON-Editor aus D1 bleibt
als zweiter Weg. Veraltete Abbildungen werden erkannt und gezielt ergänzt
(aus D1), der Export des Ablaufs ist aus M3 vorhanden. Beides wird hier mit
den Abnahmetests A7 und A8 abgeschlossen.

Abnahme nach Auftrag: **A7** (nach dem Hinzufügen einer Stelle meldet V7 eine
veraltete Abbildung und V3 die fehlende Stelle, „Ergänzen" füllt nur diesen
Eintrag) und **A8** (der Export `case_id, activity, timestamp, lifecycle` lässt
sich mit pm4py einlesen, Discovery liefert ein Netz mit denselben
Aktivitäten).

## 1. Bearbeitungsmodell (`@pnm/domain`)

### 1.1 Griffe (`src/handles.ts`)

```ts
export type HandleKind = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w' | 'point' | 'segment' | 'slot' | 'pos';
export interface Handle { id: string; kind: HandleKind; target: EntryRef; index?: number; at: Point; cursor: string }
export type EntryRef = { section: 'places' | 'transitions' | 'arcs' | 'decor'; key: string }
export function handlesFor(view: DomainView, ref: EntryRef): Handle[]
export function hitHandle(handles: Handle[], p: Point, tolerance: number): Handle | null
```
- `box`-Einträge (station, machine, gate, area, rooms, source, sink,
  furniture, room, zone): `move` auf der Fläche, acht `resize`-Griffe.
- `pos`-Einträge (door, dock, waypoint, pool, label, scale): ein `pos`-Griff.
- `path`-Einträge (queue, conveyor, buffer, arcs): ein `point`-Griff je
  Punkt, ein `segment`-Griff in der Mitte jedes Segments (Klick fügt dort
  einen Punkt ein), Doppelklick auf einen Punkt entfernt ihn (mindestens
  zwei Punkte bleiben).
- `slots`: ein `slot`-Griff je Platz, innerhalb der Box beschränkt.
- `rooms` (bei `kind: 'rooms'`): je Raum ein `move` und vier `resize`.
- `wall`: je Segment zwei Endpunkte.

### 1.2 Änderungen (`src/edit.ts`)

Reine Funktionen, jede liefert eine neue `DomainView`:

```ts
export function moveEntry(view, ref, delta: Point, opts: { snap?: number; canvas }): DomainView   // verschiebt Box, Pos, alle Pfadpunkte, Plätze und Räume gemeinsam
export function resizeEntry(view, ref, handle: HandleKind, delta, opts): DomainView                 // Mindestgröße 24 × 24, Plätze und Räume werden proportional mitgenommen
export function movePoint(view, ref, index, to, opts): DomainView
export function insertPoint(view, ref, segmentIndex, at): DomainView
export function removePoint(view, ref, index): DomainView
export function moveSlot(view, ref, index, to): DomainView                                          // innerhalb der Box
export function addSlot(view, ref, at): DomainView; export function removeSlot(view, ref, index): DomainView
export function setEntryKind(view, net, ref, kind): DomainView      // wandelt Geometrie sinnvoll um (box ↔ pos ↔ path), erlaubt nur Arten, die V4 für die Rolle zulässt
export function setLabel(view, ref, label: string | undefined): DomainView
export function markUser(view, refs: EntryRef[], at: string): DomainView                            // Herkunft user
```
- Raster 8 px (umschaltbar, gemeinsam mit dem Editor-Raster), Koordinaten
  ganzzahlig, innerhalb des Canvas geklemmt.
- Jede Funktion ist deterministisch und verändert nur die genannten Einträge.
- `setEntryKind` nutzt die Rollenprüfung aus `validate.ts`, damit die
  Auswahlliste nur gültige Arten anbietet.

### 1.3 Tests

Für jede Funktion: Ergebnis, Klemmung, Raster, Mindestgröße, Plätze bleiben
in der Box, Pfad behält mindestens zwei Punkte, Herkunft `user`, keine
anderen Einträge verändert (Property-Test mit fast-check über zufällige
Abbildungen: nach jeder Änderung bleibt V1 gültig und V5 bleibt gültig, wenn
es vorher gültig war).

## 2. App `@pnm/web`

### 2.1 Bearbeitungsmodus der Domänenansicht

- Umschalter in der Steuerleiste der Domänenansicht: „Inspect | Edit layout"
  (Kürzel `E`), nur im Editiermodus des Netzes, im Simulationsmodus
  ausgeblendet. Im Bearbeitungsmodus werden Griffe des ausgewählten Eintrags
  gezeichnet (Akzentfarbe, 8 px Quadrate, Punkte als Kreise), Cursor
  entsprechend.
- Auswahl: Klick auf ein Element wählt es aus (gemeinsame Auswahl mit dem
  Netz bleibt), Rahmen in Akzentfarbe. Pfeiltasten verschieben um 1 px,
  mit Umschalt um 8 px. Entf im Bearbeitungsmodus **löscht nicht** das
  Netzelement, sondern setzt den Eintrag auf `hidden` mit Begründung
  „hidden by user" (undo-fähig, Hinweis-Toast). Das Netzelement bleibt.
- Ziehen: Griffe aus 1.1, Vorschau während des Ziehens, Übernahme beim
  Loslassen als **ein** Undo-Schritt. Alt beim Ziehen schaltet das Raster
  aus, Umschalt bei Resize hält das Seitenverhältnis.
- Doppelklick auf einen Eintrag öffnet die Beschriftung inline (wie beim
  Netz), Rechtsklick öffnet ein Kontextmenü: Kind wechseln ▸ (gültige
  Arten), Add point / Remove point (bei Pfaden), Add slot / Remove slot,
  Hide / Show, Reset entry to generic (nutzt `fillMissing` für diesen
  Eintrag), Edit JSON (springt im Panel zur Stelle).
- Dekor: Kontextmenü auf leerem Canvas: Add room, Add zone, Add wall, Add
  label, Add furniture, Add scale. Dekor ist auswählbar und löschbar
  (echtes Entfernen, da kein Netzelement dahintersteht).
- Verborgene Einträge: im Bearbeitungsmodus als gestrichelte Platzhalter
  an einer generischen Position sichtbar, mit „Show" im Kontextmenü.

### 2.2 Panel

- Elementansicht (D1) wird editierbar: Felder für Art (Auswahl der
  gültigen Arten), Beschriftung, Sensor, `pass`, Geometrie als Zahlenfelder
  (Box x, y, w, h; Pos x, y; Pfadpunkte als Liste), Plätze als Liste.
  Änderungen gehen durch dieselben Funktionen aus 1.2.
- Status zeigt die Zahl der Einträge mit Herkunft `user` (bereits) und einen
  Button „Reset all to generic" mit Bestätigung.
- Bei veralteter Abbildung (V7) erscheint oben im Panel eine Karte „The
  view is out of date" mit den konkreten Befunden (fehlende oder verwaiste
  Einträge) und den Buttons „Fill missing entries", „Remove stale
  entries", „Update hash". Jede Aktion ist einzeln undo-fähig.

### 2.3 Abschluss A7 und A8

- A7 als eigener Playwright-Test: Netz mit Abbildung öffnen, Stelle im Netz
  hinzufügen und verbinden, Domänen-Panel zeigt V3 für genau diese Stelle und
  V7, „Fill missing entries" ergänzt genau einen Eintrag mit Herkunft
  `generic`, alle anderen Einträge sind unverändert (Vergleich des JSON vor
  und nach), „Update hash" entfernt V7.
- A8 als Skript `packages/io/scripts/check-pm4py.py` plus Node-Treiber
  `pnpm --filter @pnm/io check:pm4py`: simuliert das Paketzentrum zwei
  Stunden (Seed 1), schreibt CSV und XES in den Scratch-Ordner, ruft Python
  in einem venv mit pm4py auf, prüft Einlesen, Spalten, Fallzahl, führt
  `discover_petri_net_inductive` auf den `complete`-Zeilen aus und
  vergleicht die Aktivitätsmenge mit den Transitionsnamen des Netzes, die
  Fälle tragen. Ergebnis als Tabelle nach `docs/eval/pm4py-<datum>.md`.
  Das Skript wird im Container einmal ausgeführt und das Ergebnis committet
  (A8 ist damit erstmals reproduzierbar dokumentiert, in M3 war es nur
  manuell). Ist pm4py nicht installierbar, bricht das Skript mit klarer
  Meldung ab und die Abnahme wird im CHANGELOG als ausstehend vermerkt.

### 2.4 Tests

- Unit: Store-Aktionen für Bearbeitungsmodus, Ziehen (Vorschau, Übernahme,
  ein Undo-Schritt), Pfeiltasten, Hide statt Delete, Kontextmenü-Aktionen,
  Panel-Felder, veraltete Karte.
- Playwright: Station ziehen und Position prüfen (über das JSON im Panel),
  Größe ändern, Pfadpunkt einfügen und ziehen, Platz verschieben, Art
  wechseln (station → machine), Eintrag verbergen und wieder zeigen, Dekor
  hinzufügen und löschen, Undo stellt alles her, Herkunft wechselt auf
  `user`, A7-Ablauf.

## 3. Dokumentation

- `docs/domain-view.md`: Abschnitt „Editing the view" (Griffe, Kürzel,
  Kontextmenü, Hide statt Delete, Dekor, veraltete Abbildungen).
- `docs/adr/0011-domain-view-editing.md`: reine Änderungsfunktionen, Ziehen
  als ein Undo-Schritt, Hide statt Delete, Dekor als einziges löschbares
  Element.
- README: Status 0.8.0, Absatz, Screenshot des Bearbeitungsmodus mit Griffen.
- CHANGELOG 0.8.0 mit A7 und A8 (Ergebnis oder ausstehend).
- Tastaturkürzel-Dialog ergänzen (`E`, Pfeiltasten, Alt, Umschalt, Entf).

## 4. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei.
2. Playwright (alt und neu) läuft lokal; Web-Suite dreimal unter Last stabil.
3. A7-Test besteht.
4. A8-Skript läuft im Container durch, Ergebnis unter `docs/eval/` committet.
5. Property-Test (1.3) besteht.
6. Alle Änderungen sind undo-fähig und setzen die Herkunft auf `user`; verborgene Netzelemente bleiben im Netz erhalten.
7. Dokumentation vollständig, keine Lint-Warnungen, kein `any` ohne Begründung, keine `console.log` außerhalb von `scripts/`.
8. Thematische Commits, gepusht.

## 5. Reihenfolge

1. Griffe und Änderungsfunktionen mit Tests und Property-Test.
2. Bearbeitungsmodus, Auswahl, Ziehen mit Vorschau, Pfeiltasten, Hide.
3. Kontextmenü, Dekor, Inline-Beschriftung, Panel-Felder, veraltete Karte.
4. A7-Test, A8-Skript mit Lauf und Ergebnis.
5. Tests, Playwright, Robustheitsläufe.
6. Doku, ADR, README, CHANGELOG, Kürzel.
