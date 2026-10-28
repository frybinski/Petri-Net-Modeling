# Umsetzungsplan M2: Höhere Netze mit Typen, Inschriften und Wächtern

Stand: 2026-10-28 · Grundlage: `PLAN.md`, aufbauend auf dem Stand nach M0/M1
(`docs/plan/M0-M1_Umsetzungsplan.md`). Dieses Dokument ist die verbindliche
Arbeitsanweisung für die zweite Ausbaustufe.

## 0. Ergebnis dieser Ausbaustufe

Das Werkzeug beherrscht das Profil **JSON-Netz**: Marken sind JSON-Werte,
Stellen tragen Typen als JSON Schema, Eingangskanten binden Variablen an Marken,
Wächter und Ausgangsinschriften sind JSONata-Ausdrücke. Der Kern berechnet alle
Bindungen einer Transition, prüft Typen beim Schalten und liefert aussagekräftige
Diagnosen. Die Oberfläche bietet Typverwaltung, Inschrifteneditor mit
Syntaxhervorhebung und Fehleranzeige, Markenansicht pro Stelle und Simulation mit
Bindungsauswahl. Stellen/Transitions-Netze bleiben als Sonderfall vollständig
erhalten.

## 1. Formalismus (verbindlich)

### 1.1 Grundidee

Ein JSON-Netz ist ein Netz nach Modell aus M1, bei dem zusätzlich gilt:

| Element      | Erweiterung |
|--------------|-------------|
| Stelle       | optionaler `type` (Name eines Eintrags in `net.types`, Wert ist ein JSON Schema). Ohne Typ: beliebige JSON-Werte. |
| Marke        | beliebiger JSON-Wert (`number`, `string`, `boolean`, `null`, Objekt, Array). |
| Eingangskante (Stelle → Transition) | `inscription`: Liste von Variablen `$a, $b` (siehe 1.2). Leer: verhält sich wie im P/T-Netz (konsumiert `weight` beliebige Marken, bindet nichts). |
| Ausgangskante (Transition → Stelle) | `inscription`: ein JSONata-Ausdruck (siehe 1.3). Leer: erzeugt `weight` Marken mit Wert `1`. |
| Transition   | optionaler `guard`: JSONata-Ausdruck, der unter einer Bindung `true` ergeben muss. Leer: immer erfüllt. |

Damit ist jedes P/T-Netz ein JSON-Netz ohne Typen, Inschriften und Wächter.
Das Profil `pt-net` blendet die höheren Felder in der Oberfläche nur aus.

### 1.2 Eingangsinschriften und Bindungen

- Syntax: eine oder mehrere Variablen, durch Kommas getrennt. Variablennamen
  beginnen mit `$`, danach Buchstabe, dann Buchstaben, Ziffern, `_`.
  Beispiele: `$o`, `$a, $b`. Leerraum ist erlaubt.
- Jede Variable bindet **genau eine Marke** der Stelle. Mehrere Variablen an
  einer Kante binden paarweise **verschiedene Markenexemplare** (bei gleichen
  Werten verschiedene Exemplare der Multimenge).
- Kommt dieselbe Variable an mehreren Eingangskanten oder mehrfach an einer
  Kante vor, müssen die gebundenen Marken **wertgleich** sein (strukturelle
  Gleichheit, Unifikation).
- Das Kantengewicht `weight` wird bei vorhandener Inschrift **ignoriert**
  (die Inschrift bestimmt die Anzahl). Validierung warnt, wenn `weight > 1`
  und eine Inschrift gesetzt ist (`WEIGHT_IGNORED`).
- Eine **Bindung** ist eine Abbildung Variablenname → Markenwert. Eine
  Transition ist unter einer Bindung aktiviert, wenn alle Eingangskanten
  bedient werden können, der Wächter `true` ergibt, alle Ausgangsinschriften
  auswertbar sind und die erzeugten Marken die Typen ihrer Stellen erfüllen
  und Kapazitäten einhalten.
- Bindungen werden **dedupliziert** (wertgleiche Bindungen zählen einmal) und
  deterministisch sortiert (nach Variablennamen, dann nach kanonischer
  JSON-Serialisierung der Werte).
- Begrenzung: höchstens `maxBindings` (Standard 1000) Bindungen pro
  Transition. Beim Überschreiten liefert der Kern die ersten 1000 und das
  Flag `truncated: true`.

### 1.3 Ausdrücke (JSONata)

- Bibliothek `jsonata` (Version 2.x). `evaluate` ist asynchron, deshalb sind
  alle Kernfunktionen, die Ausdrücke auswerten, **asynchron** (`Promise`).
- Auswertungskontext: Eingabe (`$`) ist ein Objekt mit allen gebundenen
  Variablen, zusätzlich werden die Variablen als JSONata-Bindings übergeben,
  sodass sowohl `$o.amount` als auch `o.amount` funktionieren. Empfohlene
  Schreibweise in Dokumentation und Beispielen: `$o.amount`.
- **Wächter:** Ergebnis muss exakt `true` sein. `undefined`, `false` oder ein
  anderer Typ gilt als nicht erfüllt. Fehler bei der Auswertung gelten als
  nicht erfüllt und werden als Diagnose gemeldet.
- **Ausgangsinschrift:** Ergebnis `undefined` ist ein Fehler. Ein Array
  erzeugt **eine Marke pro Element**, jeder andere Wert erzeugt **eine
  Marke**. Eine array-wertige Einzelmarke wird als `[[1,2]]` geschrieben.
  Das ist in `docs/format.md` zu dokumentieren.
- **Sicherheit:** Zeitlimit pro Auswertung (`timeout`, Standard 1000 ms,
  JSONata-Option) und Tiefenlimit (`maxDepth`). Keine Nutzerdefinierten
  Funktionen mit Seiteneffekten.
- Ausdrücke werden beim Parsen gecacht (Map Ausdruckstext → kompilierter
  Ausdruck), damit die Bindungsberechnung nicht bei jeder Markierung neu parst.

### 1.4 Typen (JSON Schema)

- `net.types` ist ein Objekt Typname → JSON Schema (Draft 2020-12, Teilmenge,
  wie von Ajv unterstützt). Typnamen: Buchstabe, dann Buchstaben, Ziffern, `_`.
- Prüfung mit `ajv` (Version 8) und `ajv-formats`, `strict: false`,
  `allErrors: true`. Validatoren werden pro Typ gecacht und bei Änderung des
  Schemas neu gebaut.
- Eingebaute Vorlagen für den Typeditor: `integer`, `number`, `string`,
  `boolean`, `unit` (`{"const": 1}`), `object` (leeres Objektschema),
  `enum` (Beispiel mit drei Werten).
- Beim Schalten werden erzeugte Marken gegen den Typ der Zielstelle geprüft.
  Verstöße machen die Bindung ungültig (die Transition ist unter dieser
  Bindung nicht aktiviert) und erzeugen eine Diagnose mit dem Ajv-Fehlertext.
- Die Anfangsmarkierung wird in `validate()` gegen die Typen geprüft
  (`TOKEN_TYPE_MISMATCH`).

## 2. Paket `@pnm/expr` (neu)

Kapselt JSONata hinter einer eigenen Schnittstelle, damit die Sprache später
austauschbar bleibt. Keine React-Abhängigkeiten.

```ts
export interface CompiledExpression {
  readonly source: string;
  readonly variables: string[];                      // referenzierte $-Variablen
  evaluate(bindings: Record<string, Token>, opts?: EvalOptions): Promise<Token | undefined>;
}
export interface ExpressionError { message: string; position?: number; }
export function compile(source: string): CompiledExpression;            // wirft ExpressionError bei Syntaxfehler
export function tryCompile(source: string): { ok: true; expr: CompiledExpression } | { ok: false; error: ExpressionError };
export function parseInputInscription(source: string): { ok: true; variables: string[] } | { ok: false; error: ExpressionError };
export function evaluateGuard(expr: CompiledExpression, bindings): Promise<{ ok: boolean; error?: string }>;
export function evaluateOutput(expr: CompiledExpression, bindings): Promise<{ tokens: Token[] } | { error: string }>;
export function referencedVariables(expr): string[];                     // für Vervollständigung und Prüfung
export function clearCache(): void;
```

Die referenzierten Variablen werden aus dem JSONata-AST gewonnen
(`expression.ast()`), Namen ohne `$`-Präfix, nur Variablen, keine eingebauten
Funktionen (`$sum`, `$string`, …).

Tests: Syntaxfehler mit Position, Variablenextraktion, Wächter mit
`true`/`false`/`undefined`/Fehler, Ausgang mit Einzelwert, Array, `undefined`,
Zeitlimit (Endlosrekursion wird abgebrochen), Cache-Verhalten.

## 3. Paket `@pnm/core`: Erweiterungen

### 3.1 Typen (`src/types.ts`)

```ts
export function validateTypeName(name: string): boolean;
export function compileType(schema: unknown): { ok: true; check: (token: Token) => TokenCheck } | { ok: false; error: string };
export function checkToken(net: PetriNet, placeId: Id, token: Token): TokenCheck;   // { ok: true } | { ok: false; errors: string[] }
export const TYPE_TEMPLATES: Record<string, unknown>;
```
Cache pro Netz-Typ-Schema (WeakMap auf `net.types`-Objekt oder Schlüssel aus
JSON-Serialisierung).

### 3.2 Bindungen und Schaltregel für JSON-Netze (`src/semantics/json-net.ts`)

```ts
export type Binding = Record<string, Token>;
export interface EnabledBinding { transitionId: Id; binding: Binding; consumes: Record<Id, Token[]>; produces: Record<Id, Token[]>; }
export interface BindingResult { bindings: EnabledBinding[]; truncated: boolean; diagnostics: Diagnostic[]; }
export function computeBindings(net, marking, transitionId, opts?: { maxBindings?: number }): Promise<BindingResult>;
export function enabledTransitionsHigher(net, marking, opts?): Promise<{ enabled: Map<Id, BindingResult> }>;
export function fireBinding(net, marking, enabledBinding: EnabledBinding): Marking;     // synchron, nutzt consumes/produces
```

Algorithmus `computeBindings`:
1. Eingangskanten der Transition sammeln. Kanten ohne Inschrift: `weight`
   beliebige Marken reservieren (bevorzugt deterministisch: die ersten in
   Reihenfolge der Markierung).
2. Für jede Kante mit Inschrift: Variablenliste parsen. Kandidaten sind die
   Markenexemplare der Stelle (Index in `marking[placeId]`).
3. Rückwärtssuche (Backtracking) über Kanten und Variablen mit Unifikation:
   bereits gebundene Variable → nur wertgleiche Exemplare erlaubt; je Stelle
   dürfen Exemplare nur einmal konsumiert werden. Abbruch bei `maxBindings`.
4. Für jede Kandidatenbindung: Wächter auswerten, dann alle Ausgangsinschriften
   auswerten, Typen und Kapazitäten prüfen. Nur vollständig gültige Bindungen
   werden geliefert. Auswertungsfehler werden einmal pro Ausdruck als
   Diagnose gesammelt (nicht pro Bindung).
5. Deduplizieren und sortieren (1.2).

Die bestehende P/T-Schaltregel (`semantics/pt.ts`) bleibt unverändert und wird
für `profile: 'pt-net'` weiter verwendet. Eine Fassade
`src/semantics/index.ts` wählt anhand des Profils:
`enabledTransitions(net, marking)` liefert für beide Profile ein einheitliches
asynchrones Ergebnis `Map<Id, BindingResult>` (bei P/T-Netzen eine Bindung mit
leerer Variablenmenge).

### 3.3 Markierungen

- `marking[placeId]` ist eine Liste von Markenwerten (bereits so). Für
  P/T-Netze bleiben es `1`-Werte.
- Hilfsfunktionen: `tokenEquals(a, b)` (strukturell, Schlüsselreihenfolge
  egal), `canonicalJson(token)` (sortierte Schlüssel), `tokenLabel(token,
  maxLength)` für Kurzdarstellung im Canvas (`"A-1"`, `{id:"A-1",…}`, `3`).

### 3.4 Validierung (neue Diagnosecodes)

| Code | Schwere | Bedeutung |
|------|---------|-----------|
| `TYPE_UNKNOWN` | error | Stelle verweist auf nicht vorhandenen Typ |
| `TYPE_SCHEMA_INVALID` | error | JSON Schema eines Typs ist ungültig (Ajv-Compile-Fehler) |
| `TYPE_NAME_INVALID` | error | Typname entspricht nicht der Namensregel |
| `TOKEN_TYPE_MISMATCH` | error | Marke der Anfangsmarkierung verletzt Stellentyp |
| `INSCRIPTION_SYNTAX` | error | Eingangs-/Ausgangsinschrift nicht parsbar (mit Position) |
| `GUARD_SYNTAX` | error | Wächter nicht parsbar |
| `VARIABLE_UNBOUND` | error | Wächter oder Ausgangsinschrift verwendet Variable, die an keiner Eingangskante gebunden wird |
| `WEIGHT_IGNORED` | warning | Gewicht > 1 an Kante mit Inschrift |
| `INSCRIPTION_ON_PT_NET` | warning | Inschrift/Wächter/Typ gesetzt, Profil ist `pt-net` (wird ignoriert) |
| `TYPE_UNUSED` | warning | Typ wird von keiner Stelle verwendet |

`validate()` bleibt synchron (Parsen ist synchron, nur Auswerten ist asynchron).

### 3.5 Netzoperationen

`addType`, `renameType` (aktualisiert Verweise der Stellen), `updateType`,
`removeType` (löst Verweise), `setPlaceType`, `setGuard`, `setInscription`,
`setTokens(placeId, tokens: Token[])`, `addToken`, `updateToken(placeId,
index, token)`, `removeToken(placeId, index)`, `setProfile(net, profile)`.

Profilwechsel `pt-net → json-net`: keine Datenänderung. `json-net → pt-net`:
Typen, Inschriften und Wächter bleiben im Dokument erhalten, werden aber
ignoriert (Warnung `INSCRIPTION_ON_PT_NET`). Marken, die nicht `1` sind,
bleiben erhalten und zählen als eine Marke.

### 3.6 Format

- `docs/format.md` um Typen, Inschriften, Wächter, Auswertungsregeln (1.2, 1.3)
  und Beispiele ergänzen. Version bleibt `1.0`, da nur optionale Felder
  gefüllt werden.
- Beispiele (neu, `profile: 'json-net'`, alle valide, mit Positionen):
  - `order-processing.pn.json`: Bestellungen (`{id, amount, customer}`) werden
    geprüft (Wächter `$o.amount > 0`), freigegeben oder abgelehnt (zwei
    Transitionen mit komplementären Wächtern), Rechnung wird aus Bestellung
    und Kunde erzeugt (zwei Eingangskanten, Unifikation über `$o.customer =
    $c.id` im Wächter).
  - `token-ring.pn.json`: ganzzahlige Marken, Ausgang `$n + 1`, Wächter
    `$n < 10`.
  - `dining-philosophers-json.pn.json`: Philosophen als Marken `{id}`, Gabeln
    als `{id}`, Wächter verknüpft Philosoph mit linker und rechter Gabel.

### 3.7 Tests

- Bindungsberechnung: eine Variable, zwei Variablen an einer Kante
  (verschiedene Exemplare), Unifikation über zwei Kanten, Wächter filtert,
  Ausgang erzeugt Array (mehrere Marken), Typverletzung macht Bindung ungültig,
  Kapazität, Deduplizierung, `maxBindings`/`truncated`, Kanten ohne Inschrift
  gemischt mit Inschriften, leere Markierung.
- Property-Based-Test: Für zufällige P/T-Netze liefert die JSON-Netz-Fassade
  dieselben aktivierten Transitionen wie `semantics/pt.ts`.
- Typen: Templates kompilieren, ungültiges Schema, Cache-Invalidierung bei
  Schemaänderung.
- Validierung: ein Test je neuem Diagnosecode.
- Alle Beispiele parsen, sind valide, und im `order-processing`-Beispiel hat
  „Rechnung erstellen" unter der Anfangsmarkierung genau die erwarteten
  Bindungen.

## 4. App `@pnm/web`: Erweiterungen

### 4.1 Profil

- Im Netz-Panel wird „Profile" zu einem Umschalter (Place/transition net ⟷
  JSON net) mit kurzer Erklärung. Umschalten ist undo-fähig.
- Im Profil `pt-net` bleibt die Oberfläche wie in M1. Alle folgenden Punkte
  gelten für `json-net`.

### 4.2 Typverwaltung

- Neuer Abschnitt „Types" im Netz-Panel (links unten oder als Reiter im rechten
  Panel): Liste der Typen mit Name, Verwendungszähler, Buttons für Neu,
  Umbenennen, Duplizieren, Löschen (mit Bestätigung, falls verwendet).
- Typeditor als Dialog: Name, Vorlagenauswahl (1.4), JSON-Schema-Editor
  (CodeMirror mit JSON-Modus, Zeilennummern, Fehlerunterstreichung bei
  ungültigem JSON oder ungültigem Schema), Vorschaubereich „Test a value":
  Eingabe eines JSON-Werts, sofortige Anzeige, ob er dem Schema entspricht.
- Stellen-Panel: Auswahlfeld „Type" (none oder Typname) mit Link „Edit type".

### 4.3 Inschriften und Wächter

- Kanten-Panel: Feld „Inscription" mit CodeMirror (einzeilig, wächst bei
  Bedarf), Platzhalter je nach Richtung (`$x` bzw. `{ "id": $x.id }`),
  Syntaxfehler als rote Unterstreichung und Fehlertext darunter.
  Für Eingangskanten zusätzlich Hinweis, welche Variablen gebunden werden.
- Transitions-Panel: Feld „Guard" (CodeMirror), darunter Liste der an den
  Eingangskanten gebundenen Variablen. Vervollständigung (Strg+Leertaste)
  bietet diese Variablen und die gängigsten JSONata-Funktionen an.
- Syntaxhervorhebung: eigene kleine `StreamLanguage`-Definition für JSONata
  (Strings, Zahlen, `$variablen`, `$funktionen()`, Operatoren, Schlüsselwörter
  `and or in true false null`). Kein vollständiger Parser nötig.
- Canvas: Inschriften werden als Kantenlabel angezeigt (gekürzt auf 24
  Zeichen, voller Text als `title`), Wächter als kleines Label über der
  Transition in eckigen Klammern `[ $o.amount > 0 ]`. Umschaltbar über
  „View → Show inscriptions" (Standard an).

### 4.4 Marken

- Canvas: Stellen im JSON-Netz zeigen die Markenanzahl als Zahl und, wenn
  ≤ 3 Marken, deren Kurzlabel darunter (`tokenLabel`). Bei Hover Tooltip mit
  allen Marken (bis 10).
- Stellen-Panel: Abschnitt „Tokens" mit Tabelle (Index, Kurzlabel, Buttons
  Bearbeiten, Duplizieren, Löschen) und „Add token". Bearbeiten öffnet einen
  JSON-Editor (CodeMirror) mit Typprüfung gegen den Stellentyp (Fehler werden
  angezeigt, Speichern trotzdem möglich, Diagnose erscheint dann in der
  Statusleiste). Bei Typ `integer`/`number`/`string`/`boolean` statt Editor
  ein passendes Eingabefeld.
- Im P/T-Profil bleibt das Zahlenfeld aus M1.

### 4.5 Simulation

- Die Berechnung der aktivierten Transitionen ist asynchron: Store hält
  `enabled: Map<Id, BindingResult>` und `computing: boolean`. Neu berechnen
  nach jedem Schritt und beim Betreten des Simulationsmodus. Ergebnisse
  älterer Berechnungen werden verworfen (Sequenznummer).
- Transition mit genau einer Bindung: Klick schaltet direkt. Mit mehreren
  Bindungen: Klick öffnet ein Popover an der Transition mit der Liste der
  Bindungen (`$o = {id:"A-1", amount:12.5}`, mehrere Variablen untereinander),
  Klick auf eine Bindung schaltet. Tastatur: Pfeiltasten und Enter.
- Panel „Enabled transitions" zeigt je Transition die Anzahl der Bindungen und
  bei `truncated` einen Hinweis.
- „Step (random)" wählt zufällig eine Transition und darin zufällig eine
  Bindung.
- Verlauf zeigt Transition und Bindung (gekürzt). Klick auf einen
  Verlaufseintrag zeigt die vollständige Bindung in einem Tooltip oder
  Dialog.
- Diagnosen aus der Bindungsberechnung (Auswertungsfehler) erscheinen in der
  Statusleiste, solange der Simulationsmodus aktiv ist.

### 4.6 Validierung

Die neuen Diagnosecodes erscheinen in der Statusleiste, Klick selektiert das
Element. Für Typfehler selektiert der Klick die Stelle und öffnet den
Typ-Abschnitt.

### 4.7 Tests

- Unit: Store-Aktionen für Typen, Inschriften, Marken, Profilwechsel;
  asynchrone Aktivierungsberechnung verwirft veraltete Ergebnisse.
- Playwright: Beispiel `order-processing` öffnen, Simulation starten,
  Transition mit mehreren Bindungen anklicken, Bindung wählen, Markierung
  prüft; Typ anlegen und einer Stelle zuweisen; ungültige Inschrift zeigt
  Fehler; Profil umschalten.

## 5. Dokumentation

- `docs/format.md`: Abschnitte „Types", „Inscriptions and guards",
  „Evaluation rules" mit Beispielen.
- `docs/expressions.md` (neu): Kurzreferenz der Ausdruckssprache für
  Anwender: Variablen, Zugriff, Operatoren, häufige Funktionen, Wächter,
  Ausgangsinschriften, Mehrfachmarken, Fallstricke (`undefined`).
- `docs/adr/0005-jsonata-expressions.md`: Entscheidung für JSONata, Asynchronität,
  Kapselung in `@pnm/expr`, Alternativen.
- README: Feature-Liste und Status auf 0.2.0, Screenshot eines JSON-Netzes.
- `CHANGELOG.md`: Eintrag 0.2.0.

## 6. Abnahmekriterien (Definition of Done)

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei in frischem Checkout.
2. Playwright-Tests (bestehende und neue) laufen lokal durch.
3. Alle drei JSON-Netz-Beispiele öffnen, sind ohne Fehlerdiagnosen, lassen sich simulieren. Im Beispiel `order-processing` lässt sich eine Bindung auswählen und das Ergebnis stimmt mit der Rechnung von Hand überein.
4. P/T-Netz-Beispiele aus M1 verhalten sich unverändert (Regression).
5. Typeditor, Inschrifteneditor und Markeneditor sind bedienbar, zeigen Fehler an und sind undo-fähig.
6. Dokumentation (5.) vollständig, keine ESLint-Warnungen, kein `any` ohne Begründung, keine `console.log`.
7. Thematische Commits auf dem vorgegebenen Branch, gepusht.

## 7. Reihenfolge der Umsetzung (empfohlen)

1. `@pnm/expr` mit Tests.
2. `@pnm/core`: Typen, Markenhilfen, Bindungsberechnung, Fassade, Validierung, Operationen, Tests.
3. Beispiele und Formatdokumentation.
4. Web: Profilumschalter, Typverwaltung, Stellen-Typ.
5. Web: Inschriften- und Wächtereditor mit CodeMirror, Canvas-Labels.
6. Web: Markenansicht und -editor.
7. Web: asynchrone Simulation mit Bindungsauswahl.
8. Validierung in der Oberfläche, Feinschliff, Tests, Playwright.
9. Dokumentation, ADR, README, CHANGELOG.

Nach jedem Schritt committen und `pnpm typecheck && pnpm test` ausführen.
