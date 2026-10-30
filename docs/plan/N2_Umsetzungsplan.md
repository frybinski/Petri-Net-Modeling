# Umsetzungsplan N2: Mengen grafisch, Gegenstände nach Fertigungsstand

Stand: 2026-10-30 · Grundlage: Rückmeldung zum Beispiel „Fahrradrahmen-Fertigung“ (N1, 1.3.0). Mengen sollen nicht nur
als Zahl erscheinen, und ein Rahmen soll nicht von Anfang an als fertiges Fahrzeug gezeichnet werden. Zielversion 1.4.0.

## 0. Ergebnis

Die Domänenansicht bekommt zwei allgemeine Darstellungsmittel:

1. **Mengen grafisch.** Zähler (`pool`, `source`, `sink`) können ihre Menge zusätzlich zur Zahl zeichnen:
   - als **Füllstand** mit Obergrenze,
   - als **Bildstatistik**, in der jedes Symbol für eine feste Menge steht (Isotype, mit Legende),
   - wahlweise mit einem **Verlauf** über die Zeit.

   Flüsse von und zu Mengenstellen zeigen das Symbol der Menge (eine Wolke für CO₂e) statt nur `+2`.
2. **Aussehen nach Zustand.** Ein Fall sieht so aus, wie es die Stelle festlegt, auf der er liegt. Am Beispiel:
   Auftrag (Dokument), Rohre, Rohrahmen grau, Rahmen beschichtet farbig, Paket. Das Aussehen wechselt am Ende der
   Schaltung, die den Fall weitergibt.

Neue Symbole: Fahrradrahmen, Fahrrad und Stangenmaterial für Gegenstände; CO₂-Wolke, Material, Schrott, Abfall, Energie
und Wasser für Mengen.

Beides folgt den Korrektheitseigenschaften der Methode:
- **Mengentreue (K3):** Die Grafik ist proportional zur Markenzahl, der Maßstab ist angegeben, und ein Überlauf wird
  gemeldet statt verschwiegen.
- **Rollentreue (K4):** Ein Aussehen gibt es nur für Fallstellen, ein Mengensymbol nur für Mengen- und Senkenzähler.

Nicht Teil von N2: Aussehen aus Markendaten höherer Netze (D6), frei hochladbare Symbole, 3D.

## 1. Schema (`@pnm/domain`, `schema.ts`)

### 1.1 Darstellung von Zählern

`pool`, `source` und `sink` bekommen ein optionales Feld `display`. Fehlt es, bleibt alles wie in 1.3.0 (nur die
Zahl).

```json
{ "kind": "pool", "pos": [190, 385], "label": "Rohrlager (kg)",
  "display": { "style": "fill", "max": 200, "low": 40, "icon": "material" } }

{ "kind": "sink", "box": [980, 150, 280, 80], "label": "CO₂e (kg)",
  "display": { "style": "pictogram", "icon": "co2", "per": 50, "history": true } }
```

- **`style: 'number'`:** wie bisher.
- **`style: 'fill'`:**
  - Ein Behälter mit Füllhöhe `min(count, max) / max`.
  - `max` (> 0) ist Pflicht.
  - `low` ist optional. Unterhalb davon wird der Füllstand gelb (Warnton der Palette).
  - Bei `pool` steht der Behälter an `pos`; eine sinnvolle Größe wählt das Werkzeug, optional `size: [w, h]`.
  - Bei `source` und `sink` füllt der Behälter die Box.
- **`style: 'pictogram'`:**
  - Jedes Symbol `icon` steht für `per` Marken (> 0). Der Rest erscheint als anteilig gefülltes Symbol.
  - Eine Legende steht im Zähler („1 ☁ = 50 kg“, die Einheit kommt aus der Beschriftung oder aus `unit`).
  - Passen nicht alle Symbole in die Box, wird eine sichtbare Kürzung gezeichnet (`… +12`). Die Symbole werden nie
    still verkleinert oder umskaliert.
- **`history: true`** (bei allen Stilen):
  - Ein kleiner Verlauf der Markenzahl über die simulierte Zeit unter oder neben dem Zähler.
  - Höchstens die letzten 8 simulierten Stunden, Abtastung an den Ereignissen.
  - Sprünge bleiben sichtbar, etwa +80 kg CO₂e je Lieferung.
- **`icon`:**
  - Mengensymbole: `co2`, `material`, `scrap`, `waste`, `energy`, `water`, `dot`.
  - Bei Senken für Fälle sind auch die Gegenstandssymbole erlaubt („Ausgeliefert“ als Pakete, 1 Symbol = 5 Rahmen).
- **Die Zahl bleibt in jedem Stil sichtbar.**

### 1.2 Aussehen von Fällen

- **Fallstellen** (`queue`, `conveyor`, `buffer`, und `source`/`sink`, wenn es Fallstellen sind) bekommen ein optionales
  Feld `appearance: { sprite, tint? }`.
- **`meta.entity.sprite`** bleibt das Standardaussehen für Stellen ohne `appearance`.
- **`tint`:** ein Farbtoken der Palette (`accent`, `ok`, `warn`, `info`, `neutral` oder vorhandene Tokens). Nie freie
  Farbwerte, damit helles und dunkles Thema stimmen.
- **Neue Gegenstandssymbole** neben `parcel`, `person`, `vehicle`, `document`, `dot`:
  - `frame`: Fahrradrahmen, Diamantform ohne Räder.
  - `bicycle`: Fahrrad.
  - `bars`: gebündeltes Stangenmaterial oder Rohre.

  Sie werden im Stil der vorhandenen gezeichnet: Canvas-Pfade, gut lesbar bei 16 bis 24 px, in beiden Themen.

### 1.3 Kompatibilität

- Alle neuen Felder sind optional, `schemaVersion` bleibt 1.
- Ansichten von 1.3.0 laufen unverändert. Die Szenen von Paketzentrum und Smart Office bleiben gleich; ein
  Snapshot-Test sichert das.
- Ältere Versionen lehnen eine Ansicht mit `display` oder `appearance` ab (`strictObject`). Das wird dokumentiert wie
  bei N1.

## 2. Regeln

- **V10 Mengendarstellung (Fehler):**
  - `fill` braucht `max > 0`, `pictogram` braucht `per > 0`.
  - `icon` muss zur Rolle passen: Mengensymbole nur bei Mengenstellen oder Senken, Gegenstandssymbole nur bei Senken und
    Quellen von Fällen.
  - `display` nur an Zählern.
- **V10 Mengendarstellung (Hinweis):**
  - Hat die Stelle eine Kapazität (`capacity`) und ist `max` kleiner, ist das ein Hinweis.
  - Die Analyse ist keine Abhängigkeit von `@pnm/domain`. Deshalb prüft V10 nur die Kapazität. Der Abgleich mit
    Invarianten bleibt dokumentiert, aber außen vor.
- **V11 Aussehen (Fehler):** `appearance` nur an Fallstellen (nicht an Ressourcen-, Mengen- oder verborgenen Stellen).
- **Laufzeit (K3):**
  - Übersteigt die Markenzahl `max` eines Füllstands, zeichnet der Behälter einen sichtbaren Überlauf (voll, mit
    Markierung).
  - Der Status der Domänenansicht meldet „Füllstand überschritten: Rohrlager 213 > 200“.
  - Nichts wird abgeschnitten, ohne dass es zu sehen ist.
- Beide Regeln erscheinen in der Rückmeldung an das LLM und im Status der Ansicht wie V1 bis V9; je Regel gibt es ein
  Beispiel im Test (A5).

## 3. Zeichnen und Animation

- **Szene (`scene.ts`, `dynamic.ts`, `paint.ts`):**
  - Füllstand, Bildstatistik, Legende, Verlauf und Überlauf sind Teil der Szene.
  - Die Szene ist deterministisch und testbar: Höhen und Symbolzahlen lassen sich ohne Canvas prüfen.
- **Verlauf:**
  - Er steht im Animationszustand (Zeitreihe je Zähler mit `history`).
  - Er wird beim Zurücksetzen geleert und beim Zurückspulen (Back) gekürzt, wie die übrigen Zähler.
  - Höchstens 500 Stützpunkte je Zähler; ältere werden zusammengefasst, ohne Sprünge zu verlieren (Min und Max je
    Fenster).
- **Flusspunkte** zu und von Mengenstellen tragen das `icon` der Mengenstelle und die Zahl. Bei CO₂e steigt eine kleine
  Wolke auf. A2 gilt weiter: Jeder Flusspunkt gehört zu einem Ereignis.
- **Aussehen:**
  - Ein Fall wird mit dem Aussehen der Stelle gezeichnet, auf der er liegt.
  - Während einer Schaltung behält er das Aussehen der Eingangsstelle.
  - Am Ende der Schaltung wechselt er zum Aussehen der Ausgangsstelle. Der Übergang dauert höchstens 250 ms; bei
    reduzierter Bewegung wechselt er sofort.
  - Beim Replay gilt dasselbe.
- **Leistung:** Das Frame-Budget-Test (Median unter 8 ms bei 200 Marken) bleibt grün, auch mit Bildstatistik und
  Verlauf. Ein neuer Test misst eine Ansicht mit allen neuen Darstellungen.
- **Bildexport:** PNG und SVG der Domänenansicht enthalten die neuen Darstellungen. Das geht über den vorhandenen
  Painter, eigens dafür ist nichts nötig.

## 4. Generische Ansicht und LLM

- **Generische Ansicht:** bleibt bei der Zahl (`display` fehlt) und beim Standardaussehen. Sie soll immer gültig sein
  (A4), und für eine gute Grafik fehlt ihr das Wissen über die Domäne.
- **Prompt:**
  - Ein kurzer Absatz zu `display` (wann `fill`, wann `pictogram`, `per` so wählen, dass etwa 5 bis 30 Symbole
    entstehen) und zu `appearance` (Aussehen je Fertigungsstand).
  - Die Liste der Symbole.
  - Die Beispiele im Prompt bleiben unverändert. Ein Snapshot-Test des Prompts wird angepasst.
- **Fehlerhafte Angaben des LLM** zu V10 und V11 gehen wie andere Regelverstöße in die Reparaturrunde.

## 5. Bearbeiten in der App (`@pnm/web`)

- **Inspektor der Domänenansicht** bei einem gewählten Zähler: „Darstellung: Zahl · Füllstand · Bildstatistik“, dazu die
  passenden Felder:
  - `max` und `low`, bzw. `per`,
  - Symbol (Auswahl mit Vorschau),
  - Schalter „Verlauf“.
- **Bei einer Fallstelle:** „Aussehen: Symbol, Farbe“ (Auswahl mit Vorschau; „wie Standard“ entfernt das Feld).
- **Allgemein:**
  - Jede Änderung ist ein Undo-Schritt und setzt die Herkunft auf `user`.
  - Fehler aus V10 und V11 stehen am Feld.
- **Hover-Karte:** Bei Zählern mit Grafik nennt sie Maßstab bzw. Obergrenze.

## 6. Beispiel `bike-frames` anpassen

| Stelle         | Darstellung                                                                   |
| -------------- | ----------------------------------------------------------------------------- |
| Aufträge       | Aussehen `document`                                                           |
| Zugeschnitten  | Aussehen `bars`                                                               |
| Geschweißt     | Aussehen `frame`, `tint` neutral (Rohrahmen)                                  |
| Beschichtet, Geprüft, Nacharbeit | Aussehen `frame`, `tint` accent (beschichtet)               |
| Versandbereit  | Aussehen `parcel`                                                             |
| Ausgeliefert   | `pictogram` mit `parcel`, `per` 5                                             |
| Rohrlager      | `fill`, `max` 200 (passt zur Invariante), `low` 40, Symbol `material`         |
| Schrott        | `fill`, `max` 10, Symbol `scrap`                                              |
| CO₂e           | `pictogram`, Symbol `co2`, `per` 50, `history`                                |
| Restabfall     | `pictogram`, Symbol `waste`, `per` 1                                          |

- `meta.entity.sprite` wird `frame`.
- Die Ansicht besteht V1 bis V11 ohne Fehler, ihr `netHash` passt.
- Das Netz selbst bleibt unverändert; Simulationsausgaben sind byte-gleich zu 1.3.0.

## 7. Tests

- **domain:**
  - Schema der neuen Felder (gültig und ungültig).
  - V10 und V11 je mit Beispiel.
  - Szene:
    - Füllhöhe proportional, auch an der Grenze 0, `max` und Überlauf.
    - Anzahl und Anteil der Symbole der Bildstatistik.
    - Kürzung mit `+N`.
    - Legende.
  - Verlauf: Zusammenfassung erhält Sprünge; Zurückspulen kürzt.
  - Aussehen:
    - Wechsel genau am Ende der Schaltung.
    - Eingangsaussehen während der Schaltung.
    - Replay.
  - A2-Protokolltest mit Symbol-Flusspunkten, A3 Determinismus, A4 Property-Test unverändert grün.
  - Snapshot: Szenen von Paketzentrum und Smart Office unverändert.
- **web:** Inspektor-Felder (Darstellung, Aussehen, Undo, Fehler am Feld), Status mit Überlaufmeldung.
- **llm:** Prompt-Snapshot; Reparaturrunde mit einem V10-Fehler.
- **Playwright:**
  - Fahrradrahmen-Beispiel öffnen und die Simulation laufen lassen.
  - Der Füllstand des Rohrlagers ändert sich; die CO₂-Bildstatistik wächst.
  - Ein Fall auf `Geschweißt` trägt das Aussehen `frame` (über ein `data-`-Attribut oder die Szene im Test-Hook).
  - Keine Seitenfehler.
- **Bilder zur Durchsicht:** `scripts/screenshots.mjs --review --only bike-frames` mit laufender Domänenansicht in hell
  und dunkel, 1280 und 1920 px.

## 8. Dokumentation

- `docs/domain-view.md`: `display`, `appearance`, Symbole, V10, V11, Überlauf, Verlauf; Bezug zu Mengen- und Rollentreue.
- `docs/limitations.md`: Aussehen nur nach Stelle, nicht nach Markendaten (D6); Abgleich von `max` mit Invarianten nur
  dokumentiert.
- ADR `docs/adr/0018-quantity-graphics-and-appearance.md`: Warum Isotype und Füllstand statt freier Skalierung; warum
  Aussehen an der Stelle hängt.
- `CHANGELOG.md` (1.4.0), alle Pakete auf 1.4.0, `PLAN.md` (Abschnitt N2 und Stand), README-Bild des Beispiels
  aktualisieren, falls eines eingebunden ist.

## 9. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei, ebenso
   `pnpm -r --workspace-concurrency=1 test` wie im GitLab-Job.
2. Playwright (alle Projekte) grün; die Web-Suite dreimal unter Last stabil.
3. Ansichten und Simulationsausgaben aller vorhandenen Beispiele unverändert (Golden-Tests aus N1, Szenen-Snapshots).
4. Im Beispiel sind Füllstände, CO₂-Bildstatistik mit Verlauf, Symbol-Flusspunkte und der Wechsel Auftrag → Rohre →
   Rohrahmen → Rahmen → Paket in der laufenden Ansicht zu sehen (Bilder zur Durchsicht).
5. Frame-Budget-Test grün; neuer Leistungstest mit allen Darstellungen grün.
6. Kein `any` ohne Begründung, keine Lint-Warnungen, Dokumentation vollständig. Thematische Commits, gepusht.

## 10. Reihenfolge

1. Schema, Symbole (Gegenstand und Menge), V10, V11 mit Tests.
2. Szene: Füllstand, Bildstatistik, Legende, Überlauf; Snapshot alter Ansichten.
3. Verlauf im Animationszustand; Symbol-Flusspunkte; Aussehen nach Stelle mit Übergang.
4. Beispiel anpassen; Bilder zur Durchsicht ansehen und nachbessern.
5. App: Inspektor, Hover-Karte, Status.
6. Prompt und Reparaturrunde.
7. Playwright, Leistung, Robustheit.
8. Doku, ADR, CHANGELOG, Versionen.
