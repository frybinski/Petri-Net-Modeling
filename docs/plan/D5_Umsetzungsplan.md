# Umsetzungsplan D5: Kopplung an echte Daten (Replay von Event Logs)

Stand: 2026-10-29 · Grundlage: Feature-Auftrag „Domänenansicht" (optionaler
Meilenstein M5 dort, bei uns D5), `docs/plan/Domaenenansicht_Einordnung.md`,
Dissertation Kapitel 9 (Instanziierung Smart Office). Stand des Werkzeugs: 1.0.0.

## 0. Ergebnis

Die Simulation bekommt eine zweite Quelle: statt der Engine liefert ein
**Event Log** (CSV aus `@pnm/io` oder XES, auch aus fremden Werkzeugen) den
Ereignisstrom. Das Log wird auf dem Netz **abgespielt** (Token-Replay): Fälle
entstehen beim ersten Ereignis, Transitionen starten und enden zu den
Zeitstempeln des Logs, Marken wandern entsprechend. Weicht das Log vom Netz
ab (Aktivität ohne passende Marken, unbekannte Aktivität), wird das sichtbar
und gezählt. Alles, was auf dem Ereignisstrom aufsetzt (Netzansicht,
Domänenansicht, Trace, Kennzahlen, Konformität), funktioniert unverändert,
nur mit anderer Quelle. Zusätzlich gibt es eine kleine programmatische
Schnittstelle, über die ein Live-Zufluss von Ereignissen eingespeist werden
kann, mit einem dokumentierten Beispiel.

## 1. Replay-Engine (`@pnm/sim`)

### 1.1 Eingabe und Zuordnung (`src/replay/mapping.ts`)

```ts
export interface LogEvent { caseId: string; activity: string; time: number /* s seit Start */; lifecycle: 'start' | 'complete'; attributes?: Record<string, string> }
export interface ActivityMapping { [activity: string]: Id | null }   // null = ignorieren
export function autoMapActivities(net: PetriNet, activities: string[]): { mapping: ActivityMapping; unmatched: string[] }  // Name gleich, Groß/Klein und Leerraum ignoriert, dann ID, dann Präfix
export function readLog(source: { csv?: string; xes?: string }, opts?: { timeOrigin?: 'first' | string }): { events: LogEvent[]; activities: string[]; cases: number; span: number; warnings: string[] }
```
- CSV: Spalten wie unser Export (`case_id, activity, timestamp, lifecycle`),
  tolerant gegenüber anderen Spaltennamen über eine Zuordnung
  (`columns: { case, activity, time, lifecycle? }`), Zeitstempel ISO oder
  Unix-Sekunden. Fehlt `lifecycle`, gilt jede Zeile als `complete`.
- XES: `concept:name`, `time:timestamp`, `lifecycle:transition` (Vorgabe
  `complete`), ein Trace je Fall. Eigener XML-Leser aus `@pnm/io`.
- Sortierung nach Zeit, bei Gleichheit nach Fall und Reihenfolge im Log.
  Zeitursprung: erstes Ereignis = 0 (Vorgabe) oder angegebener Zeitpunkt.

### 1.2 Replay (`src/replay/engine.ts`)

```ts
export interface ReplayOptions { mapping: ActivityMapping; completeOnly?: 'zero' | 'span' /* Dauer 0 oder vom vorigen complete des Falls */; strict?: boolean; seed?: number }
export function createReplay(net: PetriNet, events: LogEvent[], opts: ReplayOptions): Simulation   // dieselbe Schnittstelle wie createSimulation
```
Semantik, verbindlich:

1. Das Replay implementiert die `Simulation`-Schnittstelle aus M3 (`step`,
   `advance`, `enabled`, `snapshot`, `restore`, `reset`, `metrics`,
   `rates` leer, `fireManually` deaktiviert mit Fehler). Die Oberfläche
   braucht keinen zweiten Pfad.
2. **Start eines Ereignisses `start(a)` für Fall `c`:** Transition
   `t = mapping[a]`. Aus jeder Vorstelle von `t` wird eine Marke des Falls
   `c` entnommen; ist keine da, wird aus einer Ressourcenstelle eine freie
   Marke genommen (Ressourcen tragen keinen Fall), sonst wird eine Marke
   **erzeugt** („missing token", Abweichung) und das Ereignis trägt
   `deviation: 'missing'`. Danach `start` wie in der Engine (`slot`,
   `firingId`), Ende zum Zeitpunkt des zugehörigen `complete`.
3. **`complete(a)` für Fall `c`:** beendet die laufende Schaltung dieses
   Falls an `t`; fehlt sie (kein `start` im Log), wird sie mit Dauer 0 (oder
   `span`) nachgeholt. Marken werden in die Nachstellen gelegt, Ressourcen
   zurückgegeben. Bei JSON-Netzen werden die Marken des Falls als
   `{ caseId, ...attributes }` erzeugt, Wächter werden nicht geprüft
   (Replay ist deskriptiv, nicht normativ) und als Hinweis einmalig gemeldet.
4. **Erstes Ereignis eines Falls:** erzeugt den Fall (`spawn`) an der
   Vorstelle der Transition; gibt es eine Quell-Transition, deren Nachstelle
   das ist, zählt das als deren Schalten.
5. **Unbekannte Aktivität** (`mapping[a] === null` oder fehlend): wird
   übersprungen und gezählt (`ignored`).
6. **Fall ohne Abschluss** am Ende des Logs: bleibt im Netz, zählt als offen.
7. **Marken, die übrig bleiben** (`remaining`) und erzeugte Marken
   (`missing`) ergeben die Token-Replay-Fitness
   `1 − ½·(missing/consumed) − ½·(remaining/produced)` nach Rozinat/van der
   Aalst, als Kennzahl des Laufs.
8. Jede Abweichung ist ein eigenes `SimEvent` (`type: 'deviation'`, mit
   `kind: 'missing' | 'ignored' | 'guard'`, Fall, Transition, Stelle), damit
   Ansicht und Trace sie zeigen können.
9. Determinismus: gleiche Eingabe ergibt denselben Strom; `seed` nur für die
   Wahl unter mehreren Ressourcenmarken.

### 1.3 Live-Zufluss (`src/replay/live.ts`)

```ts
export function createLiveReplay(net, opts): Simulation & { push(events: LogEvent[]): void; close(): void }
```
Wie das Replay, aber die Ereignisse kommen nachträglich; `advance` spielt
bis zur Simulationszeit ab, die den Zeitstempeln der eingetroffenen
Ereignisse entspricht, und wartet sonst (`idle`). Zeitbasis: Wanduhr seit
`open`, Ereigniszeiten relativ dazu. Für die App als `window.pnm.live`
freigegeben (nur wenn der Modus „Live" aktiv ist), dokumentiert mit einem
Beispiel in der Browser-Konsole und einem kleinen Node-Skript
`scripts/live-demo.mjs`, das Ereignisse des Smart-Office-Netzes mit
Zufallszeiten an eine lokale Seite sendet (über `postMessage` einer
eingebetteten Seite oder, einfacher, als CSV-Zeilen, die in der App über
„Paste events" eingefügt werden). Entscheidung dokumentieren, die
Konsolen-API ist Pflicht, das Skript optional.

### 1.4 Tests

- `readLog`: unser CSV, CSV ohne `lifecycle`, CSV mit anderen Spalten,
  XES aus unserem Export, XES mit fehlendem Lifecycle, ungültige Dateien.
- `autoMapActivities`: Treffer nach Name, Groß/Klein, Leerraum, ID, Präfix;
  Unzugeordnete.
- **Wiedergabetreue:** Log aus einer Simulation des Paketzentrums (Seed 1,
  2 h) abgespielt ergibt Fitness 1,0, null Abweichungen, dieselbe Folge
  von Markierungen je Ereigniszeit wie die Engine (Vergleich der
  Markierungen nach jedem `complete`), dieselbe Fallzahl und dieselben
  Kennzahlen Durchsatz und Durchlaufzeit (Toleranz 0).
- Abweichungen: Log mit gelöschter Aktivität (`Scannen` fehlt) ergibt
  `missing` an `Gescannt`, Fitness < 1; unbekannte Aktivität wird gezählt;
  `complete`-only-Log mit `zero` und `span`.
- Smart Office: Log aus der Simulation abgespielt, Fitness 1,0.
- Live: Ereignisse nachschieben, `advance` wartet, Idle-Ereignis, Schließen.
- Domänenansicht (A2 erneut): Replay-Ereignisse erzeugen Bewegungen oder
  Zustandsänderungen, Abweichungen erzeugen ein rotes Aufblitzen.

## 2. App `@pnm/web`

### 2.1 Quelle wählen

- Im Simulations-Panel oben ein Umschalter „Source: Engine | Log | Live".
- **Log:** Datei öffnen (CSV, XES, auch per Drag-and-drop auf das Panel),
  Zuordnungsdialog: Tabelle Aktivität → Transition (automatisch
  vorbelegt, Auswahlfeld je Zeile, „ignore"), Hinweise zu unzugeordneten
  Aktivitäten, Optionen (`completeOnly`, Zeitursprung), Vorschau (Fälle,
  Zeitspanne, Ereignisse). Übernehmen startet das Replay im
  Simulationsmodus.
- **Live:** Modus mit leerem Strom, Textfeld „Paste events" (CSV-Zeilen),
  Hinweis auf `window.pnm.live.push(...)`.
- Steuerleiste, Geschwindigkeit, Step, Back, Trace, Kennzahlen,
  Domänenansicht: unverändert. Engine-spezifische Elemente (Zugangsraten,
  Ressourcen ändern, Schalten per Klick) sind im Replay ausgeblendet.

### 2.2 Abweichungen sichtbar

- Trace: Abweichungen als eigene Zeilen in Rot mit Art und Ort.
- Kennzahlen: Karte „Replay" mit Fitness, erzeugten Marken, übrigen
  Marken, ignorierten Ereignissen, offenen Fällen.
- Netz: Stellen mit erzeugten Marken bekommen einen roten Ring für 1 s,
  Zähler im Hover; Domänenansicht: rotes Aufblitzen am Element.
- Konformitätsprüfung (M5) auf dem Replay-Log mit einem Klick.

### 2.3 Kommandozeile

`pnm replay <net> <log.csv|log.xes> [--map "Aktivität=t_id"]* [--complete-only zero|span] [--csv out] [--metrics out.json] [--json]`
gibt Fitness, Abweichungen, Kennzahlen aus, Exit 1 bei Fitness < 1 mit
`--strict`.

### 2.4 Tests

- Unit: Store-Umschaltung der Quelle, Zuordnungsdialog, Replay-Start,
  Abweichungsanzeige, Live-Push.
- Playwright: Paketzentrum simulieren und exportieren, dann als Log laden,
  Zuordnung übernehmen, Replay abspielen, Fitness 100 %, Domänenansicht
  zeigt Bewegung; Log mit entfernter Aktivität zeigt Abweichungen; Live:
  Ereignisse einfügen, Marken erscheinen.

## 3. Dokumentation

- `docs/replay.md` (neu): Logformate, Zuordnung, Semantik des Replays,
  Fitness, Abweichungen, Live-API mit Beispiel, Grenzen (keine
  Wächterprüfung, keine Zeitinterpolation).
- `docs/adr/0015-event-log-replay.md`: Replay als `Simulation`, Token-
  Replay-Semantik, Abweichungen als Ereignisse.
- README: Feature-Tabelle und Known limitations ergänzen, Status 1.1.0.
- CHANGELOG 1.1.0.
- Hinweis für Kapitel 9: Beispiel, wie ein Smart-Office-Log (Spalten
  `device, event, time`) über die Spaltenzuordnung und die
  Aktivitätszuordnung abgespielt wird, als Abschnitt in `docs/replay.md`.

## 4. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei.
2. Playwright (alt und neu) läuft lokal; Web-Suite dreimal unter Last stabil.
3. Wiedergabetreue-Test (1.4) besteht für Paketzentrum und Smart Office.
4. Abweichungstests bestehen; A2 für Replay-Ereignisse besteht.
5. CLI `replay` läuft auf dem exportierten Log des Paketzentrums mit Fitness 1,0.
6. Dokumentation vollständig, keine Lint-Warnungen, kein `any` ohne Begründung.
7. Thematische Commits, gepusht.

## 5. Reihenfolge

1. `readLog`, `autoMapActivities` mit Tests.
2. Replay-Engine mit Wiedergabetreue- und Abweichungstests.
3. Live-Replay mit Tests.
4. CLI `replay`.
5. App: Quelle, Zuordnungsdialog, Abweichungen, Live-Modus.
6. Tests, Playwright, Robustheit.
7. Doku, ADR, README, CHANGELOG.
