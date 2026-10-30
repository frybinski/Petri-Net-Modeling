# Umsetzungsplan N1: Beispiel Nachhaltigkeit (Mengenstellen und Kennzahlen)

Stand: 2026-10-30 · Grundlage: Wunsch nach einem Beispielprozess, in dem Nachhaltigkeit sichtbar wird (CO₂,
Materialverbrauch). Stand des Werkzeugs: 1.2.0. Zielversion: 1.3.0.

## 0. Ergebnis

Ein neues Beispiel **„Fahrradrahmen-Fertigung“** zeigt in Simulation und Domänenansicht, wie viel CO₂e entsteht, wie viel
Material verbraucht wird, wie viel davon aus dem Recycling kommt und wie viel Restabfall bleibt. Die Mengen sind Marken
eines zeitbehafteten Stellen/Transitions-Netzes (1 Marke = 1 kg), damit sie in Netz, Domänenansicht und Analyse dieselbe
Bedeutung haben.

Dafür braucht das Werkzeug zwei kleine, allgemein nutzbare Erweiterungen:

1. **Mengenstellen** (`role: 'quantity'`). Heute bekommt jede Marke außerhalb einer Ressource die Fall-ID ihrer Schaltung,
   und ein Fall gilt als abgeschlossen, sobald eine seiner Marken eine Senke erreicht (`packages/sim/src/metrics.ts`).
   Legte man CO₂ einfach als Marken in eine Senke, wäre jeder Rahmen „fertig“, sobald sein erstes CO₂ ankommt:
   Durchlaufzeit, Durchsatz und Fälle im System wären falsch, und die Domänenansicht zeichnete CO₂ als Rahmen. Marken
   auf Mengenstellen tragen deshalb keinen Fall, beenden und beginnen keinen Fall und werden nicht als Objekte gezeichnet.
2. **Kennzahlen** (`simulation.indicators`). Frei definierbare Werte aus Markenzahlen, Zu- und Abflüssen und Schaltungen,
   bezogen auf abgeschlossene Fälle oder Stunden: etwa „CO₂e je Rahmen“ oder „Recyclinganteil“. Sie erscheinen im
   Metriken-Tab, in der Kennzahlenleiste der Domänenansicht und in `pnm simulate --json`.

Nicht Teil von N1: Kennzahlen aus Markendaten höherer Netze (gehört zu D6), Kostenrechnung, Emissionsfaktoren aus
Datenbanken, zeitabhängiger Strommix.

## 1. Mengenstellen (`@pnm/core`, `@pnm/sim`, `@pnm/io`)

### 1.1 Modell und Validierung

- `Place.role` erlaubt zusätzlich `'quantity'` (Schema, Modell, `PlaceRole`).
- `quantity` wird nie berechnet, nur gesetzt. Anders als `case` und `resource` **überschreibt `quantity` auch die
  strukturellen Rollen** `source` und `sink`: eine CO₂-Stelle ohne Ausgang bleibt eine Mengenstelle. `placeRoles`,
  `placeRole` und `computedPlaceRole` entsprechend anpassen und kommentieren.
- Erlaubt in beiden Profilen (`pt-net`, JSON-Netze). Bei JSON-Netzen gilt dieselbe Fallregel; Kennzahlen zählen Marken,
  keine Werte.
- Die Validierung meldet keine neuen Fehler. Ein Hinweis entsteht, wenn eine Mengenstelle mit einer Transition eine
  Schleife bildet und dadurch wie eine Ressource aussieht. Der Hinweis nennt beide Rollen und lässt die Wahl.

### 1.2 Simulation

- Marken auf Mengenstellen tragen keine Fall-ID (wie Ressourcen). Die Fall-IDs einer Schaltung kommen nur aus Marken von
  Fallstellen (`engine.ts`, Sammeln in `start` und Vererben in `complete`).
- Eine Mengenstelle beendet keinen Fall, auch wenn sie strukturell eine Senke ist (`metrics.ts`, Zeile mit
  `roles.get(ref.placeId) === 'sink'`).
- Eine Transition ohne Eingangsstelle, die nur auf Mengen- oder Ressourcenstellen legt, erzeugt keinen neuen Fall.
- Schaltungen ohne Fall erscheinen im Ereignisstrom ohne `caseId` (für Animation, Zähler, Trace). Prüfen, wie das heute
  bei Schaltungen nur auf Ressourcen geschieht, und dieselbe Lösung nehmen.
- Kennzahlen der Stellen: Mengenstellen erscheinen in `PlaceStats` (aktuell, Mittel, Maximum), aber nicht in Wartezeiten,
  Durchlaufzeiten oder Auslastung.
- Seed-Determinismus bleibt (A3): gleicher Seed, gleicher Strom, gleicher Export.

### 1.3 Event Log und Replay

- CSV und XES enthalten nur Ereignisse mit Fall. Schaltungen ohne Fall (Anlieferung, Recycling) stehen nicht im Log; das
  wird in `docs/simulation.md` dokumentiert.
- Replay (`packages/sim/src/replay`): Mengenstellen werden wie Ressourcen nicht gegen das Log geprüft. Sie zählen weder als
  fehlende noch als übrige Marken, und ihr Bestand darf nicht negativ werden (fehlende Mengen ergänzen, ohne Abweichung
  zu melden). Das exportierte Log des neuen Beispiels spielt mit Fitness 1,0 ab.

### 1.4 Austausch

- PNML: `role` `'quantity'` schreiben und lesen (`packages/io/src/pnml/read.ts`, heute nur `case` und `resource`).
- JSON-Format bleibt `1.0`, das Feld ist optional; ältere Dateien bleiben gültig. Ältere Versionen des Werkzeugs, die
  `quantity` nicht kennen, sollen die Datei mit einer verständlichen Meldung ablehnen. Prüfen, wie das Schema heute auf
  einen unbekannten Wert reagiert, und das Verhalten dokumentieren.

## 2. Kennzahlen (`simulation.indicators`)

### 2.1 Format

```json
{
  "id": "co2-per-frame",
  "label": "CO₂e je Rahmen",
  "unit": "kg",
  "measure": { "kind": "inflow", "of": "p_co2" },
  "per": "case",
  "factor": 1,
  "digits": 1
}
```

- `measure.kind`:
  - `tokens`: aktuelle Markenzahl einer Stelle.
  - `inflow`: Marken, die im Beobachtungsfenster auf eine Stelle gelegt wurden.
  - `outflow`: Marken, die im Beobachtungsfenster von einer Stelle genommen wurden.
  - `firings`: Schaltungen einer Transition im Beobachtungsfenster.
- `measure.via` (optional, nur bei `inflow` und `outflow`): zählt nur den Fluss über die Bögen dieser Transition.
- `per` (optional):
  - `case`: abgeschlossene Fälle im Beobachtungsfenster.
  - `hour`: beobachtete Stunden.
  - ein zweites `measure`.
  - fehlt `per`, ist es ein Absolutwert.
- Wert = `factor` × Messgröße ÷ Bezug. Ist der Bezug 0, ist der Wert `null` (Anzeige „–“). `factor` hat den Standardwert 1,
  `digits` den Standardwert 1.
- Das Beobachtungsfenster ist dasselbe wie bei den anderen Kennzahlen (nach der Aufwärmzeit). `tokens` ist ein
  Momentanwert.
- Validierung: unbekannte Stellen- und Transitions-IDs, doppelte `id`, `via` ohne Bogen zur Stelle, `factor` nicht
  endlich. Alle Fehler werden mit Pfad gemeldet. Löscht man im Editor ein Element, auf das eine Kennzahl zeigt, meldet die
  Validierung die Kennzahl, statt sie still zu entfernen.

### 2.2 Berechnung

- In `@pnm/sim` neben `metrics.ts`. Die Zähler für Zu- und Abfluss je Stelle (und je Stelle und Transition für `via`)
  laufen im selben Fenster wie die übrigen Metriken mit.
- `MetricsSnapshot` bekommt `indicators: { id, label, unit, value }[]`. Dieselbe Funktion nutzen App, Kommandozeile und
  Server.
- Auch beim Replay berechnet; Mengenstellen folgen dort der Regel aus 1.3.

## 3. Domänenansicht (`@pnm/domain`)

- **Neue Regel V9 (Fehler):** Eine Mengenstelle wird als Zähler (`pool`, `source`, `sink`) gezeigt oder verborgen
  (`hidden` mit Begründung), nie als `queue`, `conveyor`, `buffer` oder `slots`. Grund: sie hat keine Objekte, die man
  zeichnen könnte (Rollentreue). Ein Beispiel im Test wie bei V1 bis V8 (A5). Die Rückmeldung an das LLM enthält V9
  automatisch.
- **Generische Ansicht:** Mengenstellen werden zu `pool`. Der Property-Test aus A4 erzeugt zufällig auch Mengenstellen und
  bleibt grün.
- **Animation:**
  - Marken von und zu Mengenstellen werden nicht als Objekte gezeichnet.
  - Je Schaltung und Bogen läuft stattdessen ein kleiner Flusspunkt mit der Zahl (`+3`, `−3`) entlang des Verbinders. Der
    Zähler pulsiert wie heute.
  - Der Protokolltest (A2) deckt die Flusspunkte ab: jeder gehört zu einem Ereignis.
- **Prompt für das LLM:** Ein Satz zur Rolle `quantity` (als Zähler zeigen, Beschriftung mit Einheit). Die Beispiele im
  Prompt bleiben unverändert.
- **Kennzahlenleiste** (`domain-kpis.tsx`):
  - Nach den festen Kennzahlen kommen die ersten vier Einträge aus `simulation.indicators`.
  - Bei mehr als vier steht ein Hinweis auf den Metriken-Tab.
  - Die Leiste darf bei 1360 px Breite nicht überlaufen und umbricht sonst sauber.

## 4. Das Beispiel `examples/bike-frames.pn.json`

Profil `pt-net`, Name „Fahrradrahmen-Fertigung“. Zeiten hier in Minuten, im Netz in der Einheit der anderen Beispiele.
Die Zahlen sind ein Vorschlag. Bei Überlast oder Leerlauf dürfen sie angepasst werden, wenn die Kennzahlen danach
plausibel bleiben (etwa 10 bis 20 kg CO₂e je Rahmen, Recyclinganteil 15 bis 40 %).

**Stellen** (1 Marke = 1 kg bei Mengenstellen):

| Id            | Name                 | Rolle     | Anfangsmarkierung | Ansicht                                       |
| ------------- | -------------------- | --------- | ----------------- | --------------------------------------------- |
| `p_orders`    | Aufträge             | Fall      | 0                 | `queue`                                       |
| `p_tubes`     | Rohrlager (kg)       | Menge     | 120               | `pool`                                        |
| `p_space`     | Lagerplatz frei (kg) | Menge     | 80                | `hidden` („Hilfsstelle für die Lagergrenze“)  |
| `p_saw`       | Säge                 | Ressource | 1                 | `slots` von `t_cut`                           |
| `p_cut`       | Zugeschnitten        | Fall      | 0                 | `conveyor`                                    |
| `p_welder`    | Schweißroboter       | Ressource | 2                 | `slots` von `t_weld`                          |
| `p_welded`    | Geschweißt           | Fall      | 0                 | `conveyor`                                    |
| `p_booth`     | Beschichtungskabine  | Ressource | 1                 | `slots` von `t_coat`                          |
| `p_coated`    | Beschichtet          | Fall      | 0                 | `conveyor`                                    |
| `p_inspector` | Prüferin             | Ressource | 1                 | `slots` von `t_check`                         |
| `p_checked`   | Geprüft              | Fall      | 0                 | `buffer`                                      |
| `p_rework`    | Nacharbeit           | Fall      | 0                 | `queue`                                       |
| `p_ready`     | Versandbereit        | Fall      | 0                 | `buffer`                                      |
| `p_shipped`   | Ausgeliefert         | Fall      | 0                 | `sink`                                        |
| `p_scrap`     | Schrott (kg)         | Menge     | 0                 | `pool`                                        |
| `p_waste`     | Restabfall (kg)      | Menge     | 0                 | `sink`                                        |
| `p_co2`       | CO₂e (kg)            | Menge     | 0                 | `sink`, groß und gut sichtbar                 |

**Transitionen** (Bögen mit Gewicht, Ressourcen werden zurückgegeben):

| Id          | Name                    | Dauer          | Nimmt                                | Gibt                                                  |
| ----------- | ----------------------- | -------------- | ------------------------------------ | ----------------------------------------------------- |
| `t_order`   | Auftrag                 | Rate 6 je h    | –                                    | `p_orders`                                            |
| `t_cut`     | Zuschneiden             | 4–6 min        | `p_orders`, 3 `p_tubes`, `p_saw`     | `p_cut`, 3 `p_space`, 1 `p_scrap`, 1 `p_co2`, `p_saw` |
| `t_weld`    | Schweißen               | 8–12 min       | `p_cut`, `p_welder`                  | `p_welded`, 2 `p_co2`, `p_welder`                     |
| `t_coat`    | Pulverbeschichten       | 6–8 min        | `p_welded`, `p_booth`                | `p_coated`, 3 `p_co2`, `p_booth`                      |
| `t_check`   | Prüfen                  | 2–4 min        | `p_coated`, `p_inspector`            | `p_checked`, `p_inspector`                            |
| `t_release` | Freigeben               | kurz, Prio 9   | `p_checked`                          | `p_ready`                                             |
| `t_reject`  | Zur Nacharbeit          | kurz, Prio 1   | `p_checked`                          | `p_rework`                                            |
| `t_rework`  | Nacharbeiten            | 10–15 min      | `p_rework`, 1 `p_tubes`              | `p_welded`, 1 `p_space`, 2 `p_co2`                    |
| `t_ship`    | Versenden               | 1–2 min        | `p_ready`                            | `p_shipped`, 2 `p_co2`                                |
| `t_recycle` | Schrott aufbereiten     | 20 min         | 5 `p_scrap`, 4 `p_space`             | 4 `p_tubes`, 1 `p_waste`, 2 `p_co2`                   |
| `t_deliver` | Primärstahl anliefern   | 30–60 min      | 40 `p_space`                         | 40 `p_tubes`, 80 `p_co2`                              |

Absicht der Zahlen:
- Primärstahl kostet 2 kg CO₂e je kg, aufbereiteter Schrott 0,5 kg. Damit lohnt Recycling sichtbar.
- `p_tubes` + `p_space` = 200 ist eine P-Invariante (Lagergrenze). Die Analyse soll sie finden; das zeigt Mengentreue
  am Beispiel.

**Simulation:** Seed 1, Aufwärmzeit 1 h, Fallpräfix `R-`, Start an einem Werktag 06:00.

**Kennzahlen:**

| Id               | Bezeichnung          | Einheit | Messgröße                         | Bezug                 | Faktor |
| ---------------- | -------------------- | ------- | --------------------------------- | --------------------- | ------ |
| `co2-per-frame`  | CO₂e je Rahmen       | kg      | `inflow` `p_co2`                  | `case`                | 1      |
| `material`       | Material je Rahmen   | kg      | `outflow` `p_tubes`               | `case`                | 1      |
| `recycled-share` | Recyclinganteil      | %       | `inflow` `p_tubes` via `t_recycle` | `inflow` `p_tubes`    | 100    |
| `waste`          | Restabfall je Rahmen | kg      | `inflow` `p_waste`                | `case`                | 1      |

**Domänenansicht** (Leinwand wie bei den anderen Beispielen, Stil wie Paketzentrum):
- Eine Halle mit drei Zonen: „Lager“ links, „Fertigung“ in der Mitte (Säge, Schweißroboter, Kabine, Prüfplatz,
  Nacharbeit), „Recycling“ unten.
- Anlieferung (`dock`) am Rohrlager, Versand (`dock`) rechts zu „Ausgeliefert“.
- „CO₂e (kg)“ als großer Zähler oben rechts.
- Gegenstand „Rahmen“ mit einem vorhandenen Sprite.
- Die Ansicht besteht V1 bis V9 ohne Fehler, ihr `netHash` passt.

**Eigenschaften** (DECLARE, wie beim Paketzentrum): `precedence(Prüfen, Versenden)` und
`response(Zuschneiden, Versenden)`. Beide gelten auf einem Simulationslog.

## 5. App (`@pnm/web`)

- **Inspektor der Stelle:** Rolle „Automatisch · Fall · Ressource · Menge“ mit einem Satz Erklärung. Die Hover-Karte
  zeigt die Rolle.
- **Simulationseinstellungen:** Abschnitt „Kennzahlen“ mit Liste, Hinzufügen, Bearbeiten, Entfernen. Die Felder sind
  Bezeichnung, Einheit, Messgröße, Element (Auswahl aus dem Netz), über (optional), Bezug, Faktor, Stellen. Fehler stehen
  am Feld. Jede Änderung ist ein Undo-Schritt.
- **Metriken-Tab:** Abschnitt „Kennzahlen“ mit den Live-Werten. Mengenstellen erscheinen in der Stellentabelle ohne
  Wartezeit.
- **Domänenansicht:** Flusspunkte und Kennzahlenleiste nach Abschnitt 3.
- Texte der Oberfläche englisch wie bisher; das Beispiel ist deutsch wie Paketzentrum und Smart Office.

## 6. Kommandozeile und Server

- `pnm simulate`:
  - Die Textausgabe listet die Kennzahlen.
  - `--json` enthält `indicators`.
  - `pnm validate` meldet Fehler in Kennzahlen.
- `/api/v1/simulate` liefert dasselbe über `@pnm/cli/lib`. `openapi.json` wird ergänzt, der Abgleich mit den Routen bleibt
  grün.

## 7. Tests

- **core:** Rolle `quantity` (überschreibt Quelle und Senke), Schema, Hinweis zur Schleife, PNML hin und zurück.
- **sim:**
  - Mengenmarken ohne Fall.
  - Fallabschluss nur über Fallstellen: Durchlaufzeiten des Beispiels unabhängig davon, ob CO₂ früher ankommt.
  - Quelle nur auf Mengenstellen erzeugt keinen Fall.
  - Kennzahlen gegen eine Handrechnung auf einem kleinen Netz.
  - `via`, `per` mit `null`.
  - Determinismus.
  - Replay des exportierten Logs des Beispiels mit Fitness 1,0.
- **domain:** V9 mit Beispiel, generische Ansicht (Property-Test mit Mengenstellen), Flusspunkte im Protokolltest (A2),
  Ansicht des Beispiels gültig.
- **analysis:** Die Invariante `p_tubes + p_space = 200` wird gefunden; Struktur- und DECLARE-Prüfung des Beispiels.
- **examples:** Das neue Beispiel wird von den vorhandenen Beispieltests erfasst (parsen, validieren, simulieren).
- **web:** Rollenauswahl, Kennzahlen-Editor (Hinzufügen, Fehler, Undo), Metriken-Tab, Kennzahlenleiste.
- **cli und server:** `simulate --json` mit Kennzahlen, Abgleich API gegen Kommandozeile.
- **Playwright:**
  - Beispiel öffnen und die Simulation laufen lassen.
  - Der CO₂-Zähler steigt, das Rohrlager sinkt und wird wieder aufgefüllt.
  - Die Kennzahlen zeigen Werte, die Analyse zeigt die Lagerinvariante.

## 8. Dokumentation

- `docs/simulation.md`: Mengenstellen (Fallregel, Log, Replay) und Kennzahlen (Format, Fenster, Beispiele).
- `docs/domain-view.md`: V9, Flusspunkte, Kennzahlenleiste.
- `docs/replay.md`: Mengenstellen.
- `docs/limitations.md`: Schaltungen ohne Fall fehlen im Log; Kennzahlen zählen bei JSON-Netzen Marken, nicht Werte (D6).
- `README.md`: Beispiel in der Liste, ein Satz zum Nutzen.
- ADR `docs/adr/0017-quantity-places-and-indicators.md`: Warum eine eigene Rolle statt Senken oder Markendaten.
- `CHANGELOG.md` (1.3.0), alle Pakete auf 1.3.0, `PLAN.md` (Abschnitt N1 und Stand).

## 9. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei.
2. Playwright (alle Projekte, auch `server`) grün; die Web-Suite dreimal unter Last stabil.
3. Alle vorhandenen Beispiele verhalten sich unverändert: Simulationsausgaben mit gleichem Seed sind byte-gleich zu
   1.2.0, solange sie keine Mengenstelle haben. Ein Test vergleicht das.
4. Das neue Beispiel:
   - Es läuft 8 simulierte Stunden ohne Stau.
   - Die Kennzahlen liegen im Zielbereich aus Abschnitt 4.
   - Die Ansicht ist gültig, die Invariante wird gefunden, die DECLARE-Eigenschaften gelten.
   - Das exportierte Log spielt mit Fitness 1,0 ab.
5. Kein `any` ohne Begründung, keine Lint-Warnungen, Dokumentation vollständig.
6. Thematische Commits, gepusht.

## 10. Reihenfolge

1. Rolle `quantity` in core und sim mit Tests; Byte-Vergleich der alten Beispiele.
2. Replay und PNML.
3. Kennzahlen (Format, Validierung, Berechnung) mit Tests.
4. Domänenansicht: V9, generische Ansicht, Flusspunkte, Kennzahlenleiste.
5. Beispiel mit Ansicht und Eigenschaften; Zahlen kalibrieren.
6. App: Rolle, Kennzahlen-Editor, Metriken-Tab.
7. Kommandozeile, Server, OpenAPI.
8. Playwright, Robustheit.
9. Doku, ADR, README, CHANGELOG, Versionen.
