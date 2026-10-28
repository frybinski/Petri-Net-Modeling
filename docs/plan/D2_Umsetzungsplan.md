# Umsetzungsplan D2: Animation der Domänenansicht auf dem Ereignisstrom

Stand: 2026-10-28 · Grundlage: Feature-Auftrag „Domänenansicht",
`docs/plan/Domaenenansicht_Einordnung.md`, `docs/plan/D1_Umsetzungsplan.md`,
Mockup `docs/mockups/domaenenansicht.html` (Verhalten als Referenz, Aussehen
als Inspiration). Stand des Werkzeugs: 0.5.0 (M0–M3, UI-Polish, D1).

## 0. Ergebnis

Die Domänenansicht wird lebendig: Sie hört auf den Ereignisstrom der
Simulation (`SimEvent` aus `@pnm/sim`) und zeigt jede Zustandsänderung als
Bewegung oder sichtbare Änderung. Marken wandern von Warteschlangen zu
Stationsplätzen und weiter entlang der Kantenpfade, Stationen zeigen
Fortschritt und Zustand (frei, belegt, blockiert), Warteschlangen färben sich
bei Engpässen, Zähler an Senken laufen hoch. Die Ansicht hat eigene
Steuerelemente und Kennzahlen, ein Klick auf eine Marke folgt dem Fall. Der
Simulator wartet nie auf die Animation.

Abnahme nach Auftrag: **A1** (drei Netze laufen zwei Stunden Simulationszeit
ohne Fehler), **A2** (jede Animation gehört zu genau einem Ereignis, jedes
Ereignis an einem sichtbaren Element hat eine Animation oder
Zustandsänderung, geprüft über ein Protokoll der Ereignis-IDs im Renderer),
**A3** (gleicher Seed ergibt denselben Ereignisstrom und denselben Export,
auch über den Weg durch die Ansicht), **A9** (Hover in beide Richtungen
verknüpft, bereits in D1, hier erneut geprüft).

## 1. Architektur der Animation (`@pnm/domain`)

### 1.1 Markenlayout (`src/token-layout.ts`)

Reine Funktion `layoutTokens(net, view, state): TokenLayout`, die für jede
Marke (identifiziert über `TokenMeta.id` aus dem Simulationszustand) eine
Zielposition und einen Ort bestimmt:

- Warteschlange, Förderband, Puffer: Marken reihen sich vom **Ende** des
  Pfads (Richtung Nachtransition) rückwärts mit 16 px Abstand. Reihenfolge:
  älteste Marke (`enteredAt`) vorn. Passen nicht alle, stehen die übrigen
  gestapelt am Anfang des Pfads und ein Zähler „+n" erscheint.
- Plätze (`slots` einer Transition): belegte Plätze entsprechen den
  laufenden Schaltungen (`Firing.slot`), jede laufende Schaltung legt ihre
  Fall-Marken auf den Platz (mehrere Marken leicht versetzt). Freie
  Ressourcenmarken erscheinen als kleine Punkte am Rand der Station.
- Pool, Senke, Quelle: kein Einzelmarkenlayout, nur Zähler.
- `hidden`: keine Position.
- Marken mit `pass: true`-Transitionen: während der Schaltung bewegt sich
  die Marke gleichmäßig entlang des Kantenpfads von der Vorstelle zur
  Nachstelle (Fortschritt aus `start`, `end` und aktueller Zeit), nicht auf
  einem Platz.

### 1.2 Übergänge (`src/animation.ts`)

```ts
export interface Motion { tokenId: string; eventId: number; from: Point; to: Point; path?: Point[]; startedAt: number /* Wanduhr ms */; duration: number }
export interface AnimationState { motions: Motion[]; flashes: { elementId: Id; eventId: number; startedAt: number }[]; counters: Record<Id, { value: number; changedAt: number }> }
export function applyEvents(prev: AnimationState, events: SimEvent[], before: TokenLayout, after: TokenLayout, now: number, opts: AnimationOptions): AnimationState
export function sampleTokens(layout: TokenLayout, anim: AnimationState, now: number): Record<string, Point>  // interpolierte Positionen
```

- Zu jedem Ereignisbündel wird das Layout vorher und nachher berechnet.
  Für jede Marke, deren Ort sich geändert hat, entsteht eine `Motion` mit
  dem **Ereignis**, das sie bewegt hat (`start` konsumiert sie, `complete`
  erzeugt sie, `spawn` erzeugt sie). Der Weg folgt dem Kantenpfad aus
  `view.arcs` (Schlüssel `source>target`), sonst einer Geraden. Dauer 300 ms
  Wanduhrzeit, Easing ease-in-out.
- Ereignisse ohne Markenbewegung an sichtbaren Elementen erzeugen eine
  sichtbare Zustandsänderung: `complete` an einer Senke erhöht den Zähler
  mit kurzem Aufblitzen, `start` an einer Station färbt den Platz,
  `spawn` an einer Quelle blitzt die Quelle auf, `marking-edited` blitzt die
  Stelle auf. `hidden`-Elemente erzeugen nichts (Auftrag: „sichtbares
  Element").
- Grenzen: höchstens 60 gleichzeitige Bewegungen, darüber springen Marken
  (eine `Motion` mit Dauer 0 wird trotzdem protokolliert). Bei
  Geschwindigkeit „max" oder `prefers-reduced-motion` sind alle Dauern 0.
  Läuft die Simulation schneller, als Bewegungen enden, wird eine laufende
  Bewegung derselben Marke abgebrochen und ab ihrer aktuellen Position neu
  gestartet.
- **Protokoll für A2:** `AnimationState` führt eine Liste `handled:
  { eventId, kind: 'motion' | 'flash' | 'counter' | 'hidden' }`. Ein Test
  lässt das Paketzentrum 30 Minuten laufen und prüft: jede ID eines
  `spawn`/`start`/`complete`-Ereignisses an einem sichtbaren Element kommt
  mit `motion`, `flash` oder `counter` vor, und jede `Motion` trägt eine
  Ereignis-ID aus dem Strom.

### 1.3 Stationszustand und Engpässe (`src/status.ts`)

- Station: `free` (kein Platz belegt), `busy` (mindestens ein Platz belegt),
  `blocked` (alle Plätze belegt **und** in einer Vorstelle warten Marken),
  `starved` (Plätze frei, aber keine Marke wartet; wird neutral gezeichnet).
  Belegte Plätze zeigen einen Fortschrittsring (Anteil der Dauer, aus
  `Firing.start/end` und aktueller Simulationszeit).
- Warteschlangen: Schwellen aus den Kennzahlen-Einstellungen (M3, Vorgabe
  gelb ab 6, rot ab 10), gemeinsame Quelle im Store.

### 1.4 Szene in Ebenen (`src/scene.ts`, Erweiterung)

`buildScene` wird in eine **statische** Szene (Dekor, Stellen, Stationen,
Beschriftungen, hängt nur von Netz und Abbildung ab) und eine **dynamische**
Szene (Marken, Plätze-Zustand, Fortschrittsringe, Zähler, Engpassfarben,
Hervorhebungen, Fallverfolgung) getrennt. Der Painter zeichnet die statische
Szene in ein Offscreen-Canvas, das nur bei Änderung von Netz, Abbildung,
Zoom oder Theme neu entsteht, und die dynamische Szene je Frame darüber.

### 1.5 Fallverfolgung

`caseTrail(events, caseId)`: Liste der Aktivitäten eines Falls (Zeit,
Transition, Ereignistyp). Zum Hervorheben: alle Marken mit dieser Fall-ID
bekommen einen Ring, die zuletzt besuchten Stationen einen schwachen
Rahmen.

### 1.6 Tests im Paket

- Markenlayout: Reihenfolge, Abstand, Überlauf „+n", Plätze aus laufenden
  Schaltungen, `pass`-Bewegung.
- Übergänge: Bewegung entlang des Kantenpfads, Grenze 60, Abbruch und
  Neustart bei schneller Folge, Dauer 0 bei reduzierter Bewegung,
  Ereignis-ID an jeder Bewegung.
- A2-Protokolltest (1.2), A1-Dauerlauf: alle drei Netze zwei Stunden mit
  Layout und Animation pro Bündel ohne Ausnahme, mit Zeitlimit 20 s im Test.
- Zustand: `blocked` nur bei vollen Plätzen und wartenden Marken.
- Leistung: synthetisches Netz mit 200 Marken, `layoutTokens` plus
  `applyEvents` plus dynamische Szene unter 8 ms im Mittel (Vitest, grob).

## 2. App `@pnm/web`

### 2.1 Zeichenschleife

- `requestAnimationFrame`-Schleife nur aktiv, solange Bewegungen laufen,
  die Simulation spielt oder sich der Zustand geändert hat. Sonst ruht sie.
- Ereignisbündel aus dem Worker (M3) werden im Store gesammelt; die
  Domänenansicht verarbeitet sie in der Reihenfolge ihrer Ankunft über
  `applyEvents`. Der Simulator läuft unabhängig weiter.
- Zoom und Pan bleiben während der Animation flüssig (statische Ebene wird
  nur bei Zoomänderung neu gezeichnet, dafür mit kurzer Verzögerung von 80 ms
  nach der letzten Zoomänderung, zwischendurch skaliert).

### 2.2 Steuerleiste in der Domänenansicht

Schwebende Leiste oben im Domänenbereich (in Domain und Both), im
Editiermodus mit Button „Simulate", im Simulationsmodus mit Play/Pause,
Step, Back, Reset, Geschwindigkeit (1× bis 60×, max), Simulationsuhr, Fälle
im System, Ausstieg „Edit". Dieselben Store-Aktionen wie das
Simulations-Panel, dieselben Kürzel. Ausblendbar über ein kleines Icon.

### 2.3 Kennzahlen und Inspektor

- Kennzahlenstreifen unten rechts im Domänenbereich: Durchsatz je Stunde,
  mittlere Durchlaufzeit, Fälle im System, aus den Kennzahlen aus M3.
  Während der Aufwärmzeit mit Hinweis.
- Hover-Karte (D1) erweitert: Warteschlange mit wartenden Fällen und
  mittlerer Wartezeit, Station mit belegten Plätzen, Zustand und
  Auslastung, Herkunft des Eintrags.
- Klick auf eine Marke: Fallverfolgung an. Karte unten links „Case P-0123":
  bisherige Aktivitäten mit Zeiten, Button „Stop following". Die Marke
  bleibt hervorgehoben, während sie sich bewegt. Esc beendet.
- Klick auf Station oder Stelle wählt wie in D1 aus; im Simulationsmodus
  löscht Entf nichts (Bearbeiten ist gesperrt).

### 2.4 Verknüpfung mit dem Netz

Hover-Verknüpfung aus D1 bleibt. Zusätzlich: Klick auf eine Transition in
der Domänenansicht im Simulationsmodus schaltet sie manuell (wie im Netz,
mit Bindungsauswahl bei mehreren Bindungen), Fortschritt erscheint in
beiden Ansichten.

### 2.5 Tests

- Unit: Zeichenschleife startet und ruht, Ereignisbündel werden in
  Reihenfolge verarbeitet, Fallverfolgung an und aus, Steuerleiste löst
  Store-Aktionen aus.
- Playwright: Paketzentrum, Domänenansicht, Play bei 10×, nach 3 s zeigt die
  Uhr > 0 und der Canvas hat sich verändert (Pixelvergleich zweier
  Screenshots), Pause friert ein; Klick auf eine Marke zeigt die Fallkarte;
  Smart Office läuft 30 s bei 60× ohne Fehler in der Konsole; reduzierte
  Bewegung (Playwright-Konfiguration) lässt Marken springen, Uhr läuft
  trotzdem; Klick auf eine Station in der Domäne schaltet die Transition.

## 3. Dokumentation

- `docs/domain-view.md`: Abschnitt „Animation" (Ereignis → Bewegung,
  Grenzen, Zustände, Engpässe, Fallverfolgung).
- `docs/adr/0009-domain-animation.md`: Layoutdifferenz statt Choreografie,
  Protokoll der Ereignis-IDs, statische und dynamische Ebene.
- README: Status 0.6.0, kurzer Absatz, Screenshot der laufenden Halle.
- CHANGELOG 0.6.0.

## 4. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei.
2. Playwright (alt und neu) läuft lokal.
3. **A1**: Test, der alle drei Netze zwei Stunden Simulationszeit mit Layout und Animation ohne Fehler durchläuft.
4. **A2**: Protokolltest (1.2) besteht.
5. **A3**: Test, dass der Ereignisstrom und der CSV-Export mit gleichem Seed identisch bleiben, wenn die Ansicht mitläuft (die Ansicht verändert den Simulator nicht).
6. **A9**: Hover-Verknüpfung in beide Richtungen (bestehender Test läuft).
7. Leistungstest (1.6) besteht; in Chromium bleibt die Halle bei 60× mit 200 Marken flüssig (manuell prüfen, Screenshot-Serie).
8. Dokumentation vollständig, keine Lint-Warnungen, kein `any` ohne Begründung, keine `console.log`.
9. Thematische Commits, gepusht.

## 5. Reihenfolge

1. Markenlayout mit Tests.
2. Übergänge, Protokoll, A2-Test, A1-Dauerlauf.
3. Stationszustand, Engpässe, Fortschrittsringe, statische und dynamische Szene.
4. Zeichenschleife und Ereignisverarbeitung in der App.
5. Steuerleiste, Kennzahlenstreifen, erweiterte Hover-Karte.
6. Fallverfolgung, manuelles Schalten aus der Domäne.
7. Tests, Playwright, Leistungsmessung.
8. Doku, ADR, README, CHANGELOG.
