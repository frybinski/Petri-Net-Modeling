# Umsetzungsplan N4: Freie Symbole, Wünsche an die Darstellung, geführt oder frei

Stand: 2026-11-03 · Grundlage: Versuch, in der Beschreibung für das LLM Einhörner als Marken zu verlangen. Es änderte sich
nichts, weil das Werkzeug nur acht feste Symbole kennt, das Antwortschema sie erzwingt und das Modell nicht melden kann, was
es nicht umsetzen konnte. Stand des Werkzeugs: 1.4.1 (N3). Zielversion: 1.5.0.

## 0. Ergebnis

1. **Freies Symbolvokabular über Emoji.**
   - Ein Gegenstand (`meta.entity`), das Aussehen einer Stufe (`appearance`) und das Symbol eines Zählers
     (`display.icon`) dürfen statt eines eingebauten Symbols genau ein Emoji sein, zum Beispiel 🦄, 🍞, 🌳 oder 👩‍⚕️.
   - Die eingebauten Symbole bleiben Standard und Empfehlung: Sie sind im hellen und dunklen Thema gleich gut lesbar und
     lassen sich einfärben.
2. **Wünsche an die Darstellung werden befolgt und Lücken gemeldet.**
   - Der Prompt sagt ausdrücklich, dass die Beschreibung Wünsche zum Aussehen enthalten kann (Symbole, Farben, Anordnung)
     und dass sie im Rahmen des Formats umzusetzen sind.
   - Das Modell kann kurze Hinweise zurückgeben, was es nicht oder nur angenähert umsetzen konnte.
   - Die App zeigt diese Hinweise im Ergebnis und speichert sie im Generierungsprotokoll.

3. **Zwei Wege im Generierungsdialog.**
   - **Geführt:** Ein Formular mit konkreten Vorschlägen, aus denen der Nutzer wählt. Optional schlägt das LLM vorab drei
     fertige Konzepte vor, die das Formular füllen. Die Wahl ist verbindlich: Das Werkzeug setzt Symbole, Aussehen und
     Darstellung der Mengen selbst; das LLM liefert nur noch Geometrie, Beschriftungen und Ausstattung.
   - **Frei:** Freitext mit beliebigen persönlichen Wünschen, umgesetzt nach 2.

   Beide Wege erzeugen dasselbe Format und laufen durch dieselben Prüfregeln. Für die Methode sind es zwei Varianten der
   Erhebung von Nutzerwünschen, strukturiert und frei, die sich in Experimenten vergleichen lassen.

Nicht Teil von N4: hochgeladene Bilder oder SVG-Symbole, freie Farbwerte (es bleibt bei den Farbtokens), Anordnungswünsche,
die gegen die Regeln V1 bis V11 verstoßen.

## 1. Schema und Regeln (`@pnm/domain`)

### 1.1 Emoji im Schema

- `meta.entity`: genau eines von `sprite` (wie bisher) oder `emoji`.
- `appearance`: genau eines von `sprite` oder `emoji`. `tint` nur zusammen mit `sprite`, weil sich ein Emoji nicht
  einfärben lässt.
- `display`: genau eines von `icon` oder `emoji` (beides optional wie bisher).
- `emoji` ist eine Zeichenkette mit genau einem Graphem-Cluster (`Intl.Segmenter` mit `granularity: 'grapheme'`). Erlaubt
  sind:
  - Zeichen mit `\p{Extended_Pictographic}`, auch mit Variationsselektor, Hautton oder ZWJ-Sequenz (👩‍⚕️),
  - Flaggen (zwei Regional-Indicator-Zeichen),
  - Keycaps.
  - Nicht erlaubt sind Buchstaben, Ziffern allein und mehrere Emoji.
- Alle Felder sind optional, `schemaVersion` bleibt 1. Ältere Versionen lehnen Ansichten mit `emoji` ab (strenges
  Schema); das wird dokumentiert wie bei N1 und N2.

### 1.2 Regel V12 (Fehler)

`emoji` ist kein einzelnes Emoji im Sinne von 1.1, oder es steht zusammen mit `sprite` bzw. `icon`, oder `tint` steht neben
`emoji`. Dazu kommt ein Beispiel im Test (A5). V12 erscheint in der Rückmeldung an das LLM und im Status der Ansicht.

V10 und V11 gelten unverändert auch für Emoji:
- Ein Emoji als `appearance` nur an Fallstellen.
- Ein Emoji als Zählersymbol nur an Zählern.

## 2. Zeichnen

- Emoji werden mit `fillText` gezeichnet, ohne Einfärbung. Die Schriftliste ist `"Apple Color Emoji", "Segoe UI Emoji",
  "Noto Color Emoji", sans-serif`.
- Die Größe entspricht dem eingebauten Symbol an derselben Stelle, zentriert auf denselben Punkt.
- Überall, wo heute ein Symbol erscheint, geht auch ein Emoji:
  - Gegenstände auf Bändern, in Slots, in Bewegung,
  - der Wechsel des Aussehens am Ende einer Schaltung,
  - Bildstatistik (mit anteilig abgeschnittenem letzten Symbol),
  - Legende,
  - Flusspunkte,
  - Hover-Karte,
  - Bildexport (PNG und SVG).
- Die Szene bleibt testbar: Ein Emoji ist ein eigener Szeneneintrag (`op: 'text'` mit Markierung `emoji: true`), dessen
  Inhalt und Lage Tests prüfen können, ohne Canvas.
- Leistung: Der Frame-Budget-Test bleibt grün. Ein zusätzlicher Test misst 200 Marken mit Emoji gegen dasselbe Budget.
- Grenze, dokumentiert in `docs/limitations.md`: Emoji sehen je nach Betriebssystem und Schrift anders aus. Fehlt eine
  Emoji-Schrift, zeigt der Browser ein Ersatzzeichen. Exportierte Bilder zeigen das Emoji des Rechners, auf dem exportiert
  wurde.

## 3. LLM (`@pnm/llm`)

- **Systemtext:**
  - Wer ein `sprite` oder `icon` nicht findet, das passt, darf `emoji` verwenden. Die eingebauten Symbole haben Vorrang,
    wenn sie passen.
  - Die Beschreibung der Domäne kann Wünsche an die Darstellung enthalten. Sie sind umzusetzen, soweit das Format es
    erlaubt. Farbwünsche werden mit den Tints angenähert.
  - Die Antwort darf ein Feld `"notes"` enthalten: höchstens fünf kurze Sätze in der Sprache der Beschreibung. Sie
    nennen, welche Wünsche nicht oder nur angenähert umgesetzt wurden und warum.
  - Die Beispiele im Text kommen aus einer Domäne, die kein Beispielnetz hat; der Leck-Test aus N3 bleibt grün.
- **Antwortschema:** `notes` (Array von Zeichenketten) ist optional erlaubt. Das Werkzeug nimmt es vor der Prüfung und vor
  dem Speichern aus der Ansicht heraus. Es gehört zum Ergebnis der Generierung, nicht zur Ansicht.
- **Reparaturrunden:** Hinweise aus allen Runden werden gesammelt, Doppelte entfernt.
- **`PROMPT_VERSION`** wird 3, und die Prompt-Snapshots werden angepasst.
- **Eval-Bericht:** Er listet die Hinweise je Lauf.

## 4. App (`@pnm/web`)

- **Ergebnisschritt des Generierungsdialogs:**
  - Ein Abschnitt „Notes from the model“ mit den Hinweisen, gut sichtbar über der Vorschau.
  - Gab es keine Hinweise, entfällt er.
  - Das Generierungsprotokoll speichert die Hinweise.
- **Beschreibungsfeld:**
  - Der Platzhalter wird neutral und zeigt, dass Wünsche möglich sind, etwa „A bakery with two ovens. Show the loaves as
    🍞.“
  - Der bisherige Platzhalter nennt das Paketzentrum.
- **Inspektor der Domänenansicht:**
  - Die Symbolauswahl für Gegenstand, Aussehen und Zählersymbol bekommt „Emoji…“ mit einem Eingabefeld.
  - Fehler aus V12 werden am Feld gezeigt.
  - Jede Änderung ist ein Undo-Schritt.

## 4a. Geführter Weg

Der Generierungsdialog hat zwei Reiter: „Guided“ (Standard beim ersten Öffnen; die App merkt sich die letzte Wahl) und
„Free“ (Abschnitt 3 und 4).

### 4a.1 Formular

Vorbelegt aus dem Netz und der vorhandenen Ansicht, falls es eine gibt:

| Feld                | Inhalt                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setting             | Thema und Name der Ansicht (Text, vorbelegt mit dem Netznamen)                                                                                                                 |
| Gegenstand          | Einzahl, Mehrzahl, Symbol (eingebaut oder Emoji)                                                                                                                               |
| Stufen              | je Fallstelle in Flussreihenfolge: Aussehen „wie Gegenstand“, ein Symbol mit Tint oder ein Emoji                                                                                |
| Mengen              | je Mengenstelle und je Senke von Fällen: Zahl, Füllstand (`max` vorbelegt aus der Kapazität oder, falls die Analyse eine Schranke kennt, aus ihr) oder Bildstatistik (`per` so, dass bei der erwarteten Menge etwa 10 bis 20 Symbole entstehen), Symbol, Verlauf |
| Anordnung           | Fluss von links nach rechts, von oben nach unten, oder wie im Netzeditor                                                                                                        |
| Ausstattung         | schlicht, mit Zonen und Beschriftungen, oder als Grundriss mit Räumen                                                                                                           |
| Ergänzungen         | optionaler Freitext                                                                                                                                                             |

Die Felder prüfen sofort gegen V10 bis V12; Fehler stehen am Feld.

### 4a.2 Vorschläge vom LLM

- Ein Knopf „Suggest concepts“ schickt eine kurze, eigene Anfrage. Sie enthält das kompakte Netz, die Liste der Symbole
  und Icons und gegebenenfalls die Ergänzungen.
- Die Antwort sind höchstens drei Konzepte nach einem eigenen kleinen Schema. Jedes hat einen Titel, einen Satz zur Idee,
  Setting, Gegenstand, Stufen, Mengen, Anordnung und Ausstattung.
- Die Konzepte erscheinen als Karten. Ein Klick füllt das Formular, danach lässt sich alles ändern.
- Ungültige Teile eines Konzepts werden vor der Anzeige verworfen und an der Karte vermerkt.
- Es gilt dieselbe Prompt-Hygiene wie in N3: keine Beispiele aus Beispielnetzen im festen Text; der Leck-Test deckt auch
  diesen Prompt ab.

### 4a.3 Generieren und Anwenden

- **Generieren:** Die Wahl geht als Abschnitt „Binding choices“ in den Prompt. Nach der Antwort setzt das Werkzeug
  Gegenstand, Aussehen und Darstellung der Mengen deterministisch auf die Wahl, egal was das Modell geschrieben hat.
  Jede Abweichung des Modells wird als Hinweis gemeldet („Choice applied: …“).
- **Was sich nicht erzwingen lässt:** Anordnung und Ausstattung wirken nur über den Prompt. Das wird im Dialog gesagt.
- **„Apply without LLM“:** Wendet die Wahl auf die vorhandene Ansicht an, oder auf die generische, wenn es keine gibt.
  Die Geometrie bleibt unverändert. Das funktioniert auch ganz ohne LLM-Anbieter, etwa auf GitHub Pages. Es ist ein
  Undo-Schritt, und die Herkunft wird `user`.
- **Protokoll:** Das Generierungsprotokoll speichert Weg (geführt oder frei), Wahl, das gewählte Konzept und die
  Hinweise.
- **Eval-Skript:** Die neue Option `--choices <file>` lässt den geführten Weg aus einer JSON-Datei laufen, damit sich
  beide Wege vergleichen lassen.

## 5. Tests

- **domain:**
  - Schema und V12 mit gültigen Fällen: 🦄, 👩‍⚕️, 🇩🇪, ❤️, 1️⃣.
  - Schema und V12 mit ungültigen Fällen: `"ab"`, `"🦄🦄"`, `""`, `"a🦄"`, Emoji neben `sprite`, `tint` neben `emoji`.
  - Szene mit Emoji: Gegenstand, Aussehen und Wechsel, Bildstatistik mit Anteil, Flusspunkt.
  - Die alten Szenen bleiben unverändert (Golden-Tests aus N2).
  - Leistung mit Emoji.
- **llm:**
  - `notes` werden aus der Ansicht entfernt und gesammelt.
  - Ein Antwortbeispiel mit `emoji` besteht die Prüfung.
  - Prompt-Snapshot und Leck-Test.
- **web:**
  - Inspektor (Emoji eingeben, Fehler, Undo).
  - Ergebnisschritt mit Hinweisen.
  - Protokoll.
- **Playwright mit dem simulierten LLM:**
  - Im Generierungsdialog „Die Marken sollen als Einhörner dargestellt werden“ eingeben. Die Antwort des simulierten
    Modells enthält `meta.entity.emoji: "🦄"` und einen Hinweis.
  - Der Ergebnisschritt zeigt den Hinweis.
  - Nach „Use“ trägt die laufende Ansicht 🦄. Geprüft wird das über die Szene im Test-Hook oder ein `data-`-Attribut,
    nicht über Pixel.
- **Geführter Weg:**
  - Vorbelegung aus dem Netz: Fallstellen in Flussreihenfolge, Mengenstellen, `max` aus der Kapazität.
  - Konzepte vom simulierten LLM: gültige werden gezeigt, ungültige Teile verworfen und vermerkt.
  - Verbindliche Wahl: Weicht das Modell ab, wird überschrieben und ein Hinweis erzeugt.
  - „Apply without LLM“ auf eine vorhandene und auf die generische Ansicht.
  - `--choices` im Eval-Skript.
  - Playwright: Konzept wählen, generieren; die Ansicht trägt die gewählten Symbole und Darstellungen.
- **Simulationsausgaben und Ansichten aller Beispiele** bleiben unverändert.

## 6. Dokumentation

- `docs/domain-view.md`:
  - Emoji, V12.
  - Wünsche in der Beschreibung und Hinweise des Modells.
  - Wann ein eingebautes Symbol besser ist.
- `docs/limitations.md`: Darstellung von Emoji je System; Farbwünsche nur als Tints.
- `CHANGELOG.md` (1.5.0), alle Pakete auf 1.5.0, `PLAN.md` (N4 und Stand).

## 7. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei, ebenso
   `pnpm -r --workspace-concurrency=1 test`.
2. Playwright grün, mit dem neuen Einhorn-Test.
3. Golden-Tests (Simulation, Szenen) grün; Leck-Test grün; Frame-Budget grün.
4. Thematische Commits, gepusht.

## 8. Reihenfolge

1. Schema, V12, Tests.
2. Zeichnen mit Emoji, Szene, Leistung.
3. LLM: Systemtext, `notes`, Antwortschema, Reparatur, Bericht.
4. App, freier Weg: Ergebnis mit Hinweisen, Platzhalter, Inspektor.
5. Geführter Weg: Formular und Vorbelegung, „Apply without LLM“, verbindliche Wahl beim Generieren, Konzepte vom LLM,
   `--choices`.
6. Playwright, Doku, CHANGELOG, Versionen.
