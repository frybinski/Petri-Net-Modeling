# Umsetzungsplan M5: Analyse und Verifikation

Stand: 2026-10-29 · Grundlage: `PLAN.md` (M5), Dissertation Beitrag B3
(Verifikationskette LTLf/DECLARE und JSON-Netze). Stand des Werkzeugs: 0.9.0.

## 0. Ergebnis

Ein Paket `@pnm/analysis` berechnet strukturelle und verhaltensbezogene
Eigenschaften eines Netzes und prüft Verhaltensvorgaben in DECLARE und LTLf.
Die App bekommt einen Reiter „Analyze" mit Ergebniskarten, einer Ansicht des
Zustandsraums und einem Editor für Vorgaben. Gegenbeispiele lassen sich als
Ablauf in die Simulation laden. Die Analysen laufen im Web Worker. Die
Kommandozeile bekommt `analyze` und `check`. Alle formalen Aussagen werden
durch Tests an Netzen mit bekanntem Ergebnis belegt, nicht empirisch
plausibilisiert.

## 1. Paket `@pnm/analysis`

Abhängigkeiten: `@pnm/core`, `@pnm/expr` (über den Kern), `@pnm/io` (für
Logs). Keine React-Abhängigkeit. Alle Funktionen deterministisch, mit
Limits (Zustände, Zeit) und `truncated`-Flag.

### 1.1 Struktur (`src/structure.ts`)

Synchron, nur Graphstruktur:

- Inzidenzmatrix `C = Post − Pre` (Stellen × Transitionen, Gewichte).
- Eigenschaften: Quell- und Senkenstellen, Quell- und Senkentransitionen,
  isolierte Knoten, stark zusammenhängend, zusammenhängend, Free-Choice,
  Extended-Free-Choice, Zustandsmaschine (jede Transition genau eine Vor-
  und Nachstelle), Markierter Graph (jede Stelle genau eine Vor- und
  Nachtransition), Konflikte (Stellen mit mehreren Nachtransitionen),
  Schleifen (Stelle ist Vor- und Nachstelle derselben Transition).
- Siphons und Traps: minimale Siphons und Traps über Standardalgorithmus mit
  Limit (höchstens 200 Mengen, sonst `truncated`), Ergebnis mit „jeder
  Siphon enthält eine markierte Trap" (Commoner-Bedingung) für
  Free-Choice-Netze.

### 1.2 Invarianten (`src/invariants.ts`)

- P-Invarianten (`y·C = 0`) und T-Invarianten (`C·x = 0`) als minimale
  semi-positive Lösungen (Verfahren nach Martínez und Silva mit ganzzahliger
  Arithmetik über `bigint`, Limit 500 Invarianten).
- Ableitungen: Stellen, die von einer P-Invariante überdeckt sind, sind
  beschränkt (mit Schranke aus der Anfangsmarkierung); Netz „überdeckt von
  P-Invarianten" ⇒ beschränkt. T-Invarianten als Hinweis auf
  Reproduzierbarkeit.
- Darstellung: Invariante als Liste `{placeId, coefficient}` plus die
  Gleichung mit Stellennamen, zum Beispiel `1·Buffer + 1·Item ready + 1·Producer idle = 1`.

### 1.3 Zustandsraum (`src/state-space.ts`)

```ts
interface StateSpaceOptions { maxStates?: number /* 20000 */; maxTimeMs?: number /* 10000 */; final?: 'deadlock' | { markings: Marking[] } }
interface StateSpace { states: State[]; edges: Edge[]; initial: number; truncated: boolean; reason?: string }
interface State { id: number; marking: Marking; key: string; enabled: Id[]; deadlock: boolean; final: boolean }
interface Edge { from: number; to: number; transitionId: Id; binding?: Binding }
export function buildStateSpace(net, opts): Promise<StateSpace>     // P/T synchron intern, JSON-Netze über findEnabled
```
- Breitensuche von der Anfangsmarkierung, kanonischer Schlüssel je Markierung
  (`canonicalJson` der Markenlisten, für P/T-Netze die Zählvektoren).
  Verschränkungssemantik, atomare Schaltregel aus M1/M2 (ohne Zeit).
- Abgeleitet (`src/properties.ts`): Beschränktheit je Stelle (Maximum im
  Zustandsraum, nur gültig wenn nicht `truncated`), Verklemmungen (Zustände
  ohne aktivierte Transition, mit kürzestem Pfad als Zeugen), Lebendigkeit
  je Transition über starke Zusammenhangskomponenten (Tarjan): `dead` (nie
  aktiviert), `L1` (mindestens einmal), `L4`/live (in jeder terminalen SZK
  vorkommend), Reversibilität (Anfangszustand in jeder terminalen SZK),
  Home-Zustände, Zahl der Zustände und Kanten. Für `truncated` werden nur
  Aussagen geliefert, die unter Abschneiden gültig bleiben (Existenz einer
  Verklemmung, untere Schranken), der Rest als „unknown".
- Überdeckbarkeitsgraph nach Karp und Miller (`src/coverability.ts`) für
  P/T-Netze mit ω-Markierungen: entscheidet Beschränktheit auch bei
  unbeschränkten Netzen (Limit 5000 Knoten). Ergebnis: beschränkt ja/nein,
  unbeschränkte Stellen.

### 1.4 Verhaltensvorgaben: DECLARE und LTLf (`src/declare.ts`, `src/ltlf.ts`)

Aktivitäten sind Transitionsnamen (eindeutig; bei Duplikaten die ID).

**DECLARE-Vorlagen** (jede mit endlichem Automaten über finiten Spuren):
`existence(a, n)`, `absence(a, n)`, `exactly(a, n)`, `init(a)`, `end(a)`,
`responded existence(a, b)`, `co-existence(a, b)`, `response(a, b)`,
`precedence(a, b)`, `succession(a, b)`, `alternate response/precedence/
succession`, `chain response/precedence/succession`, `not co-existence`,
`not succession`, `not chain succession`, `choice(a, b)`, `exclusive choice`.
Jede Vorlage als DFA (`states`, `initial`, `accepting`, `delta(state, activity)`),
getestet gegen die Standardsemantik mit positiven und negativen Spuren.

**LTLf**: Parser für `true false a !φ φ & ψ φ | ψ φ -> ψ φ <-> ψ X φ Xw φ F φ G φ φ U ψ φ W ψ φ R ψ`
und Atome aus Transitionsnamen in Anführungszeichen oder Bezeichnern,
mit Fehlerposition. Übersetzung in einen DFA über die Fischer–Ladner-
Abschlussmenge (Tableau/Teilmengenkonstruktion auf finiten Spuren mit
`last`-Behandlung, bis 10 Atome und 2^12 Zuständen, sonst Fehler „formula
too large"). Zusätzlich direkte Auswertung einer Formel auf einer
konkreten Spur (rekursiv), die auch für große Formeln funktioniert.

**Prüfung auf dem Zustandsraum** (`src/check.ts`): Produkt aus
Zustandsraum und DFA, Spuren sind alle Pfade vom Anfangszustand zu einem
Endzustand (Vorgabe: Verklemmungen; alternativ nutzerdefinierte
Endmarkierungen). Eine Vorgabe gilt, wenn jeder solche Pfad im DFA
akzeptiert wird. Verletzung liefert ein Gegenbeispiel als kürzeste
Schaltfolge (Breitensuche im Produkt). Zyklen ohne Endzustand (Pfade, die
nie enden) werden gemeldet: „contains infinite runs without a final state"
als Warnung, mit Option, jeden Zustand als möglichen Endzustand zu
behandeln (präfix-abgeschlossene Prüfung).

**Prüfung auf einem Ereignisprotokoll** (`src/conformance.ts`): aus einem
Event Log (CSV aus M3, `complete`-Ereignisse je Fall) je Vorgabe den
Anteil erfüllender Spuren, Liste der verletzenden Fälle, Aktivierungen
und Erfüllungen je Spur (für `response`-artige Vorlagen).

### 1.5 Worker (`src/worker.ts`, `src/client.ts`)

Wie in `@pnm/sim`: Befehle `structure`, `invariants`, `stateSpace`,
`coverability`, `check`, `conformance`, mit Fortschrittsmeldungen
(Zustände bisher) und Abbruch.

### 1.6 Tests (Belege, keine Plausibilisierung)

- Erzeuger/Verbraucher: beschränkt (Puffer ≤ 3), keine Verklemmung,
  alle Transitionen live, reversibel, 3 P-Invarianten mit erwarteten
  Gleichungen, Zahl der Zustände bekannt (von Hand nachgerechnet, im Test
  als Konstante).
- Philosophen (3): Verklemmung existiert, Zeuge hat Länge 3 (alle greifen
  links), nicht live.
- Wechselseitiger Ausschluss: P-Invariante über kritische Abschnitte und
  Semaphor, nie beide kritisch (Zustandsraum enthält keine Markierung mit
  beiden).
- Ampel: beschränkt, live, reversibel, Zustandsmaschine.
- Unbeschränktes Netz (Quelle → Stelle): Überdeckbarkeitsgraph mit ω,
  Zustandsraum `truncated`.
- Bestellbeispiel (JSON-Netz): Zustandsraum mit Bindungen, Verklemmung am
  Ende (alle Aufträge verarbeitet), DECLARE `response(Approve, Create invoice)`
  gilt, `precedence(Reject, Create invoice)` verletzt mit Gegenbeispiel.
- Property-Tests: Zustandsraum stimmt mit naiver Aufzählung überein (kleine
  Netze), P-Invarianten erfüllen `y·C = 0`, DFA-Semantik jeder DECLARE-
  Vorlage stimmt mit der Auswertung der zugehörigen LTLf-Formel auf
  zufälligen Spuren überein (Vorlage ↔ Formel), LTLf-DFA stimmt mit der
  rekursiven Auswertung auf zufälligen Spuren überein.
- Konformität: Log aus einer Simulation des Paketzentrums erfüllt
  `succession(Scannen, Sortieren)` zu 100 % und `init(Anlieferung)` zu 100 %.

## 2. App `@pnm/web`

### 2.1 Reiter „Analyze" im rechten Panel

- Karte „Structure": Eigenschaften als Liste mit Ja/Nein und kurzer
  Erklärung, Konfliktstellen, Siphons/Traps aufklappbar.
- Karte „Invariants": Tabellen P und T mit Gleichungen, Klick hebt die
  beteiligten Stellen im Netz hervor.
- Karte „State space": Button „Explore" mit Limit-Feld, Fortschritt,
  Ergebnis (Zustände, Kanten, beschränkt, Schranken je Stelle,
  Verklemmungen, Lebendigkeit je Transition mit Klassen, Reversibilität),
  „Show graph" öffnet die Zustandsraumansicht, Klick auf eine Verklemmung
  lädt den Zeugen als Ablauf in die Simulation (Schritt für Schritt
  abspielbar, Simulation im Modus ohne Zeit).
- Karte „Properties": Liste von Vorgaben, je Zeile Vorlage (Auswahl) mit
  Aktivitäten (Auswahl aus Transitionsnamen) oder freie LTLf-Formel
  (CodeMirror-Feld mit Syntaxprüfung), Status (holds, violated, unknown),
  Gegenbeispiel mit „Replay". Buttons „Check on state space" und „Check on
  last simulation log" (Konformität in Prozent, verletzende Fälle). Vorgaben
  werden im Netzdokument unter `properties` gespeichert (optionales Feld,
  durchgereicht).
- Analysen werden bei Netzänderung als veraltet markiert, nicht automatisch
  neu berechnet (Kosten).

### 2.2 Zustandsraumansicht

Eigener Dialog oder Vollbildansicht mit React Flow: Zustände als Knoten
(Beschriftung: Markierung kompakt, Verklemmung rot, Anfang markiert,
Endzustände doppelt umrandet), Kanten mit Transitionsname, Layout über ELK
(layered), bis 500 Zustände dargestellt, darüber Hinweis und Filter (nur
Pfad zum Gegenbeispiel). Klick auf einen Zustand zeigt die Markierung im
Netz (Simulationsmarkierung setzen).

### 2.3 Kommandozeile

`pnm analyze <net> [--states N] [--coverability] [--json]` und
`pnm check <net> (--declare "response(a,b)")* (--ltlf "G(a -> F b)")* [--log file.csv] [--final deadlock|markings.json] [--json]`
mit Exit-Code 1 bei verletzter Vorgabe.

### 2.4 Tests

- Unit: Store, Panel-Karten, Vorgabeneditor, Replay des Gegenbeispiels.
- Playwright: Erzeuger/Verbraucher analysieren (beschränkt, live),
  Philosophen: Verklemmung finden und Zeugen abspielen, Vorgabe
  `response(produce, deliver)` prüfen (gilt), Vorgabe mit Verletzung zeigt
  Gegenbeispiel, Konformität auf Simulationslog, Zustandsraumansicht öffnen,
  CLI-Integrationstests für `analyze` und `check`.

## 3. Dokumentation

- `docs/analysis.md` (neu): Definitionen (Beschränktheit, Lebendigkeitsklassen,
  Reversibilität, Invarianten, Siphons/Traps), Semantik der Prüfung (Spuren
  bis Endzustand, Umgang mit Zyklen), DECLARE-Vorlagen mit LTLf-Formeln,
  LTLf-Syntax, Grenzen (Limits, Verschränkung, keine Zeit).
- `docs/adr/0013-analysis-and-verification.md`: Zustandsraum statt
  symbolischer Verfahren, Produktautomat, Endzustände, bigint-Invarianten.
- README: Status 1.0.0-rc.1, Abschnitt Analyse mit Screenshot.
- CHANGELOG 1.0.0-rc.1.

## 4. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei.
2. Playwright (alt und neu) läuft lokal; Web-Suite dreimal unter Last stabil.
3. Alle Belegtests aus 1.6 bestehen mit den dort genannten, von Hand nachgerechneten Werten (im Test als Kommentar hergeleitet).
4. Property-Tests bestehen (Vorlage ↔ Formel, DFA ↔ Auswertung, Zustandsraum ↔ Aufzählung, Invarianten).
5. Gegenbeispiele sind im Editor abspielbar und führen in den gemeldeten Zustand.
6. CLI `analyze` und `check` laufen auf allen Beispielen.
7. Dokumentation vollständig, keine Lint-Warnungen, kein `any` ohne Begründung.
8. Thematische Commits, gepusht.

## 5. Reihenfolge

1. Struktur und Invarianten mit Tests.
2. Zustandsraum, Eigenschaften, Überdeckbarkeit mit Tests und Property-Tests.
3. DECLARE-DFAs, LTLf-Parser und -DFA, Auswertung, Produktprüfung, Konformität, Tests.
4. Worker und Client.
5. CLI `analyze` und `check`.
6. App: Reiter Analyze, Karten, Vorgabeneditor, Replay, Zustandsraumansicht.
7. Tests, Playwright, Robustheitsläufe.
8. Doku, ADR, README, CHANGELOG.
