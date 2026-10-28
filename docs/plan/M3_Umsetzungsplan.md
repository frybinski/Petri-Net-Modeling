# Umsetzungsplan M3: Zeitbehaftete Simulation mit Ereignisstrom

Stand: 2026-10-28 · Grundlage: `PLAN.md` (M3 erweitert),
`docs/plan/Domaenenansicht_Einordnung.md` (Anforderungen aus dem Feature-Auftrag),
`docs/mockups/domaenenansicht.html` (Referenz für Verhalten). Stand des Werkzeugs:
0.3.0 (M0–M2 plus UI-Polish).

## 0. Ergebnis

Ein eigenständiges Simulationspaket `@pnm/sim` führt Netze als diskrete
Ereignissimulation aus: mit Dauern, Prioritäten, Zugangsraten, zweiphasigem
Schalten, Fall-Identität, seedbarem Zufall und einem Ereignisstrom, auf dem
Ansicht, Kennzahlen und Export aufsetzen. Die atomare Schaltregel aus M1/M2
bleibt der Sonderfall Dauer 0, es entsteht keine zweite Semantik. Der Editor
bekommt Abspielen, Geschwindigkeit, Einzelschritt, Zurück, Haltepunkte,
Markenanimation, ein Trace-Panel und den Export als Event Log (CSV) und XES.
Drei zeitbehaftete Beispiele (Paketzentrum, Smart Office, Reklamation) kommen
aus dem Mockup und dienen später der Domänenansicht (D1).

## 1. Modellerweiterungen (`@pnm/core`)

Alle Felder optional, Format bleibt `1.0`. Zod-Schema, `docs/format.md` und
Validierung werden ergänzt.

```ts
export type Timing =
  | { kind: 'fixed'; value: number }               // Sekunden Simulationszeit, >= 0
  | { kind: 'uniform'; min: number; max: number }  // 0 <= min <= max
  | { kind: 'exponential'; mean: number };         // > 0

export interface Transition {
  // bestehend: id, name, position, guard
  timing?: Timing;      // fehlt: Dauer 0
  priority?: number;    // relatives Gewicht bei zufälliger Konfliktauflösung, > 0, Vorgabe 1
  rate?: number;        // Zugänge je Stunde, nur für Quell-Transitionen (ohne Eingangskanten)
}

export interface Place {
  // bestehend: id, name, position, type, capacity
  role?: 'case' | 'resource';   // überschreibt die berechnete Rolle
}

export interface SimulationSettings {
  seed?: number;          // Vorgabe 1
  warmup?: number;        // Sekunden, Vorgabe 0
  startTime?: string;     // ISO-Zeitpunkt für Zeitstempel im Export, Vorgabe 2026-01-05T08:00:00Z
  caseIdPrefix?: string;  // Vorgabe "C-"
}

export interface PetriNet {
  // bestehend …
  simulation?: SimulationSettings;
}
```

Zusätzlich im Kern (`src/roles.ts`):

```ts
export type PlaceRole = 'source' | 'sink' | 'resource' | 'case';
export function placeRole(net, placeId): PlaceRole;          // berechnet, `role` überschreibt resource/case
export function isSourceTransition(net, transitionId): boolean;  // keine Eingangskanten
```
Regeln wie im Auftrag: ohne Vortransition `source`, ohne Nachtransition `sink`,
mit Anfangsmarken und Vor- und Nachstelle derselben Transition `resource`,
sonst `case`.

Neue Diagnosecodes: `TIMING_INVALID` (Fehler), `PRIORITY_INVALID` (Fehler),
`RATE_ON_NON_SOURCE` (Warnung), `SOURCE_WITHOUT_RATE` (Hinweis als Warnung:
Quell-Transition wird in der zeitbehafteten Simulation nicht automatisch
geschaltet), `ROLE_OVERRIDE_UNUSUAL` (Warnung, wenn `role: 'resource'` an
einer Stelle ohne Schleife steht).

Netzoperationen: `setTiming`, `setPriority`, `setRate`, `setRole`,
`setSimulationSettings`.

## 2. Paket `@pnm/sim`

Keine Browser- und keine React-Abhängigkeit. Abhängigkeiten: `@pnm/core`.

### 2.1 Zufall (`src/random.ts`)

`createRng(seed)` mit mulberry32: `next()`, `uniform(min,max)`,
`exponential(mean)`, `pick(weights)`, `getState()`/`setState()` für Snapshots.

### 2.2 Zustand und Ereignisse (`src/types.ts`)

```ts
export interface TokenMeta { id: string; caseId?: string; enteredAt: number }
export interface Firing { id: number; transitionId: Id; binding: EnabledBinding; caseIds: string[]; start: number; end: number; slot: number }
export interface SimState {
  time: number;                                  // Simulationssekunden seit Start
  marking: Marking;                              // wie im Kern
  meta: Record<Id, TokenMeta[]>;                 // parallel zu marking[placeId]
  running: Firing[];                             // laufende Schaltungen
  nextArrival: Record<Id, number>;               // je Quell-Transition mit Rate
  counters: { event: number; case: number; firing: number; token: number };
}
export type SimEvent =
  | { id; t; type: 'spawn';    transitionId; caseId; produced: TokenRef[] }
  | { id; t; type: 'start';    transitionId; firingId; slot; caseIds; binding: Binding; consumed: TokenRef[] }
  | { id; t; type: 'complete'; transitionId; firingId; slot; caseIds; produced: TokenRef[] }
  | { id; t; type: 'marking-edited'; placeId; delta: number; reason: 'user' }
  | { id; t; type: 'idle' }          // nichts mehr aktiviert und keine Ereignisse geplant
  | { id; t; type: 'warning'; code: string; message: string };
export interface TokenRef { placeId: Id; tokenId: string; caseId?: string }
```

### 2.3 Engine (`src/engine.ts`)

```ts
export interface SimOptions { seed?: number; warmup?: number; rates?: Record<Id, number>; maxBindings?: number; maxFiringsPerInstant?: number /* 10000 */ }
export function createSimulation(net: PetriNet, opts?: SimOptions): Simulation;
export interface Simulation {
  readonly state: Readonly<SimState>;
  readonly net: PetriNet;
  nextEventTime(): number | null;
  step(): Promise<SimEvent[]>;                    // verarbeitet den nächsten Zeitpunkt vollständig
  advance(seconds: number): Promise<SimEvent[]>;  // alle Ereignisse bis time + seconds
  fireManually(transitionId: Id, binding?: EnabledBinding): Promise<SimEvent[]>;  // Klick im Editor
  enabled(): Promise<Map<Id, BindingResult>>;     // aktuell aktivierte Transitionen (für die Anzeige)
  editMarking(placeId: Id, tokens: Token[]): SimEvent[];   // Ressourcen nachlegen oder entziehen
  setRate(transitionId: Id, perHour: number | null): void;
  snapshot(): SimSnapshot; restore(s: SimSnapshot): void;   // für Zurück
  reset(seed?: number): void;
}
```

Semantik, verbindlich:

1. **Aktivierung** über den Kern: `findEnabled(net, marking)` (profilabhängig,
   asynchron). Für P/T-Netze ist der Weg synchron schnell, die API bleibt
   dennoch asynchron.
2. **Kapazitäten.** Zusätzlich zur Kernprüfung lehnt die Engine eine Bindung
   ab, wenn `aktuelle Marken + reservierte Marken aus laufenden Schaltungen +
   produces` die Kapazität einer Zielstelle überschreiten. Laufende Schaltungen
   reservieren damit Platz.
3. **Zeitpunkt abarbeiten.** Zu einem Zeitpunkt `t` werden zuerst alle
   Abschlüsse (`complete`) mit `end = t` angewendet, dann die Zugänge
   (`spawn`) mit `nextArrival = t`, dann wiederholt: alle aktivierten
   Transitionen (ohne Quell-Transitionen mit Rate) bestimmen, eine zufällig
   nach `priority` wählen, darin eine Bindung zufällig gleichverteilt wählen,
   Start anwenden, bis nichts mehr aktiviert ist. Nach `maxFiringsPerInstant`
   Starts im selben Zeitpunkt bricht die Engine ab und meldet `warning`
   (`ZERO_TIME_CYCLE`).
4. **Start** (`start`): `consumes` anwenden (Marken samt Metadaten entnehmen),
   Dauer aus `timing` ziehen, `Firing` mit `end = t + Dauer` anlegen, `slot` ist
   der kleinste freie Index unter den laufenden Schaltungen derselben
   Transition. Dauer 0: `complete` folgt im selben Zeitpunkt vor weiteren
   Starts.
5. **Abschluss** (`complete`): `produces` anwenden. Fall-Vererbung: die erste
   erzeugte Marke erbt die Fall-ID der ersten konsumierten Marke mit Fall-ID,
   weitere erzeugte Marken erhalten dieselbe Fall-ID (AND-Split). Marken aus
   Ressourcenstellen (Rolle `resource`) tragen keine Fall-ID und geben keine
   weiter. `enteredAt = t`.
6. **Zugänge.** Quell-Transition mit Rate `r > 0`: Zwischenankunftszeit
   exponentiell mit Mittel `3600 / r`. Beim Zugang wird die Transition genau
   einmal geschaltet (Start und Abschluss nach ihrer Dauer), die erzeugten
   Marken bekommen eine neue Fall-ID `prefix + laufende Nummer`. Ohne Rate
   wird eine Quell-Transition nur manuell geschaltet.
7. **Manuelles Schalten** (`fireManually`): verhält sich wie ein Start zum
   aktuellen Zeitpunkt, mit Dauer nach `timing`. Ohne angegebene Bindung wird
   bei mehreren Bindungen ein Fehler geliefert (der Editor zeigt die Auswahl).
8. **Markierung bearbeiten** (`editMarking`): ersetzt die Marken einer Stelle,
   neue Marken erhalten Metadaten ohne Fall-ID, Ereignis `marking-edited`.
9. **Aufwärmzeit.** Ereignisse mit `t < warmup` werden ausgegeben, aber in
   den Kennzahlen (2.4) nicht gezählt.
10. **Determinismus.** Gleiche Eingaben (Netz, Optionen, Reihenfolge manueller
    Eingriffe) ergeben denselben Ereignisstrom. Alle Mengen werden in
    stabiler Reihenfolge durchlaufen (Reihenfolge in `net.transitions`,
    sortierte Bindungen aus dem Kern).
11. **Sonderfall Dauer 0 überall.** Ein Lauf ohne `timing`, ohne Raten und mit
    manuellen Schaltungen erzeugt dieselben Markierungen wie die atomare
    Schaltregel. Ein Test weist das für alle Beispiele aus M1/M2 nach.

### 2.4 Kennzahlen (`src/metrics.ts`)

Aus dem Ereignisstrom, inkrementell: Bestand je Stelle (aktuell, Mittel,
Maximum), mittlere Wartezeit je Stelle (Eintritt bis Entnahme), Auslastung je
Ressource (belegte Marken / Anfangsmarken über die Zeit), Durchsatz je Stunde
(Fälle, die eine Senke erreichen), Durchlaufzeit je Fall (spawn bis Senke),
Zahl der Fälle im System. `createMetrics(net, warmup)`, `apply(event)`,
`snapshot()`.

### 2.5 Worker (`src/worker.ts`, `src/client.ts`)

Die Engine läuft im Browser in einem Web Worker. Protokoll per `postMessage`
mit Befehlen (`init`, `step`, `advance`, `fire`, `edit`, `setRate`,
`snapshot`, `restore`, `reset`, `enabled`) und Antworten (`events`, `state`,
`enabled`, `error`). `createSimulationClient(worker)` liefert dieselbe
Schnittstelle wie `Simulation`, asynchron. In Node und in Tests läuft die
Engine direkt (`createSimulation`). Vite bündelt den Worker über
`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.

### 2.6 Tests

- Zufall: Reproduzierbarkeit, Verteilungsmittel (grob) für uniform und
  exponential.
- Engine: Dauer fest/uniform/exponential, zweiphasiges Schalten mit
  Ressourcenstelle (Scanner mit 2 Marken begrenzt auf 2 gleichzeitige
  Schaltungen), Kapazitätsreservierung, Konfliktauflösung nach Priorität
  (Häufigkeiten bei 10 000 Läufen ≈ Gewichte), Zugangsrate (Zahl der Zugänge
  in einer Stunde ≈ Rate), Fall-Vererbung bei Sequenz, AND-Split und AND-Join,
  Nullzeit-Zyklus bricht ab, `editMarking` zur Laufzeit, Snapshot/Restore,
  Determinismus (zwei Läufe gleicher Seed identisch, anderer Seed verschieden),
  JSON-Netz mit Bindungen und Dauern (Bestellbeispiel).
- Sonderfall-Test (2.3 Punkt 11) für alle bestehenden Beispiele.
- Property-Test (fast-check): für zufällige P/T-Netze bleibt die Gesamtzahl
  der Marken plus laufende Schaltungen konsistent mit Kantengewichten.
- Kennzahlen: Durchsatz und Durchlaufzeit an einem Netz mit bekannter Lösung
  (Sequenz mit fester Dauer).

## 3. Export (`@pnm/io`)

- `toEventLogCsv(events, net, settings)`: Spalten `case_id, activity,
  timestamp, lifecycle` (`start`/`complete`), Aktivität ist der
  Transitionsname, Zeitstempel ISO ab `startTime`, nur Ereignisse mit Fall-ID.
- `toXes(events, net, settings)`: XES 1.0 mit `concept:name`,
  `lifecycle:transition`, `time:timestamp`, ein Trace je Fall.
- Tests: CSV-Spalten und Reihenfolge, XES wohlgeformt und ein Trace je Fall,
  Roundtrip-Zählung (Zahl der Zeilen = Zahl der Start- und Abschlussereignisse
  mit Fall-ID).

## 4. Beispiele (`examples/`)

Aus dem Mockup übertragen, mit Positionen, `timing`, `priority`, `rate`,
`simulation` und ohne Fehlerdiagnosen:

- `parcel-center.pn.json` (Paketzentrum): 12 Stellen, 9 Transitionen, Scanner
  2, Sorter 1, drei Torteams, Weichen mit Prioritäten 0,5 / 0,35 / 0,15,
  Anlieferung 300/h.
- `smart-office.pn.json`: 12 Stellen, 8 Transitionen, 8 Arbeitsplätze, 3
  Besprechungsräume, Wege als Transitionen mit Dauer, Ankünfte 40/h.
- `complaint-handling.pn.json` (Reklamation, aus `SAMPLE_PNML`): 8 Stellen, 7
  Transitionen, AND-Split und -Join, XOR mit zwei Transitionen, Zugang 300/h.

Die Netze werden im Mockup (`PAKET_NET`, `OFFICE_NET`, `SAMPLE_PNML`) gelesen
und manuell in unser Format übersetzt. Die Abbildungen (`PAKET_MAP`,
`OFFICE_MAP`) werden noch nicht übernommen (D1).

## 5. Editor (`apps/web`)

### 5.1 Eigenschaftspanel

- Transition: Abschnitt „Timing" mit Auswahl None / Fixed / Uniform /
  Exponential und passenden Zahlenfeldern (Sekunden, mit Einheitenhinweis),
  Feld „Priority" (Vorgabe 1), für Quell-Transitionen Feld „Arrival rate
  (per hour)". Canvas: Transition mit Dauer zeigt ein kleines Uhr-Symbol
  unten rechts, Hover-Karte nennt Dauer, Priorität, Rate.
- Stelle: Zeile „Role" mit berechneter Rolle (source, sink, resource, case)
  und Überschreiben für resource/case.
- Netz: Abschnitt „Simulation" mit Seed, Warmup, Start time, Case ID prefix.

### 5.2 Simulationsmodus

- Steuerleiste oben im Simulations-Panel: Play/Pause, Step (nächstes
  Ereignis), Step back, Reset, Geschwindigkeit (1×, 2×, 5×, 10×, 30×, 60×,
  „max"), Simulationsuhr (hh:mm:ss ab Start), Fälle im System.
- Zeitfortschritt: ein Timer im Hauptthread ruft `advance(dt · speed)` im
  Worker auf (dt = Wanduhr seit letztem Tick, höchstens 100 ms Simulationszeit
  pro Tick bei 1×, skaliert mit speed). Bei „max" läuft die Engine so schnell
  wie möglich mit Ereignisbündeln von 200 Ereignissen pro Tick.
- Klick auf eine Transition: manuelles Schalten, mit Bindungsauswahl wie
  bisher. Bei laufendem Abspielen ebenfalls möglich.
- Laufende Schaltungen: Transition zeigt einen Fortschrittsbalken (Anteil der
  Dauer) und die Zahl paralleler Schaltungen als Badge.
- Zugangsrate je Quell-Transition im Panel als Schieberegler (0 bis 2 × Rate
  des Netzes), wirkt sofort.
- Ressourcen nachlegen oder entziehen: im Panel „Resources" je
  Ressourcenstelle Plus/Minus, wirkt sofort (`editMarking`).
- **Animation.** Bei `start` wandert eine Marke von der Vorstelle zur
  Transition, bei `complete` von der Transition zur Nachstelle, entlang des
  Kantenpfads, in 250 ms Wanduhrzeit (unabhängig von der Geschwindigkeit),
  höchstens 60 Bewegungen gleichzeitig, danach springen Marken.
  `prefers-reduced-motion` schaltet Bewegungen ab.
- **Haltepunkte.** Kontextmenü an Transition „Toggle breakpoint" (rotes
  Dreieck am Knoten), im Panel „Pause when place ≥ n" je Stelle. Erreichen
  pausiert das Abspielen und selektiert das Element.
- **Zurück.** Snapshot nach jedem Zeitpunkt (bis 500), „Step back" stellt den
  vorigen Zeitpunkt wieder her. Manuelle Eingriffe (Schalten, Markierung,
  Rate) sind Teil des Verlaufs.
- **Trace-Panel.** Reiter neben „Enabled transitions": Tabelle der
  Ereignisse (Zeit, Typ, Transition, Fall, Bindung gekürzt), neueste oben,
  Filter nach Typ und Transition, Klick selektiert die Transition. Buttons
  „Export CSV" und „Export XES".
- **Kennzahlen.** Reiter „Metrics": Karten für Durchsatz/h, mittlere
  Durchlaufzeit, Fälle im System, darunter Tabelle je Stelle (Bestand,
  Mittel, Max, Wartezeit) und je Ressource (Auslastung). Engpass-Markierung
  (gelb ab 6, rot ab 10 wartenden Marken, einstellbar) auch am Knoten im
  Canvas als Ring.
- Diagnosen der Engine (`warning`) erscheinen in der Statusleiste.

### 5.3 Untimed Netze

Netze ohne Zeit verhalten sich wie bisher: Klick schaltet sofort, „Step
(random)" bleibt (jetzt über die Engine mit Seed), Play schaltet zufällig im
Takt der Geschwindigkeit (1× = eine Schaltung je Sekunde).

### 5.4 Tests

- Store/Komponenten: Steuerleiste, Zeitfortschritt mit gemocktem Timer,
  Zurück, Haltepunkt pausiert, Trace-Filter, Export löst Download aus.
- Playwright: Paketzentrum öffnen, Play, nach 2 s Simulationszeit > 0 und
  Fälle > 0, Pause, Step, Step back stellt Uhr zurück, Haltepunkt an
  „Scannen" pausiert, CSV-Export lädt Datei mit vier Spalten; Bestellbeispiel
  (JSON-Netz) mit Dauer an „Approve" zeigt Fortschrittsbalken; bestehende
  Tests laufen weiter.

## 6. Dokumentation

- `docs/format.md`: Felder `timing`, `priority`, `rate`, `role`, `simulation`.
- `docs/simulation.md` (neu): Semantik aus Abschnitt 2.3 für Anwender,
  Fall-Identität, Kennzahlen, Export, Grenzen.
- `docs/adr/0007-discrete-event-simulation.md`: Entscheidung für DES im
  Worker, zweiphasiges Schalten, Kapazitätsreservierung, Determinismus.
- README: Feature-Liste, Status 0.4.0, Screenshot der Simulation mit Trace.
- `CHANGELOG.md`: 0.4.0.
- Tastaturkürzel: Space (Play/Pause im Simulationsmodus), `.` Step, `,` Step
  back, `R` Reset, `B` Haltepunkt an ausgewählter Transition.

## 7. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei.
2. Playwright (alt und neu) läuft lokal.
3. Paketzentrum läuft zwei Stunden Simulationszeit bei „max" ohne Fehler in unter 10 s Wanduhrzeit (Test in `@pnm/sim`).
4. Gleicher Seed ergibt denselben Ereignisstrom und denselben CSV-Export (Test).
5. Sonderfall-Test: alle M1/M2-Beispiele verhalten sich mit Dauer 0 wie die atomare Schaltregel.
6. Die CSV-Datei hat die Spalten `case_id, activity, timestamp, lifecycle` und lässt sich mit pm4py einlesen (im Container prüfen: `pip install pm4py` in einem venv, `pm4py.format_dataframe` + `pm4py.discover_petri_net_inductive`; wenn pm4py nicht installierbar ist, stattdessen mit pandas Spalten und Zeitstempel prüfen und das in der Abnahme vermerken).
7. Dokumentation vollständig, keine Lint-Warnungen, kein `any` ohne Begründung, keine `console.log`.
8. Thematische Commits, gepusht.

## 8. Reihenfolge

1. Modellfelder, Rollen, Diagnosen, Operationen, Format-Doku (Kern).
2. `@pnm/sim`: Zufall, Zustand, Engine, Tests.
3. Kennzahlen, Export CSV/XES, Tests.
4. Beispiele aus dem Mockup übertragen.
5. Worker und Client, Anbindung im Store.
6. Editor: Panel-Felder, Steuerleiste, Zeitfortschritt, Zurück, Haltepunkte.
7. Animation, Trace-Panel, Kennzahlen-Panel, Engpassringe.
8. Tests, Playwright, Doku, ADR, README, CHANGELOG.
