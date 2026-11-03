# Umsetzungsplan N3: Prompt ohne Lecks, Auswertung für Experimente

Stand: 2026-11-03 · Grundlage: Beobachtung, dass eine mit dem LLM erzeugte Ansicht des Fahrradbeispiels der Ansicht im
Repository auffällig ähnelt. Stand des Werkzeugs: 1.4.0. Zielversion: 1.4.1.

## 0. Befund

Der erste Prompt (`packages/llm/src/prompt.ts`) verrät Teile der Lösungen der Beispiele:

- Regel 10 (seit N2) beschreibt wörtlich die Stufen des Fahrradbeispiels: „an order as document, cut tubes as bars, a raw
  frame as frame with tint neutral, a coated one as frame with tint accent, the shipped item as parcel“.
- Regel 7 (seit D3) nennt als Beispiel für Thema und Ansichtsname „Parcel sorting center“ und „Hall 2“, also die Werte des
  Paketzentrums. Für das Paketzentrum wird nur die eigene Beispielansicht herausgefiltert, der Hinweis bleibt.
- Die Positionen des Netzeditors gehen als Layout-Hinweis mit, und die Ansichten im Repository folgen derselben Anordnung.
  Das ist gewollt, soll sich für Experimente aber abschalten lassen.

Für die Abnahme A6 ändert das wenig: Sie misst, ob die Prüfregeln bestanden werden, nicht wie ähnlich das Ergebnis ist. Für
die Experimente X1 bis X4 der Dissertation würde ein Leck aber verfälschen, was gemessen wird.

## 1. Prompt ohne Lecks (`@pnm/llm`)

- **Regeln 7 und 10** bekommen Beispiele aus einer Domäne, die in keinem Beispielnetz vorkommt, etwa eine Klinik:
  - Thema „Hospital outpatient clinic“, Ansicht „Ground floor“.
  - Ein Patient als `person`, wartend mit Tint `neutral`, nach der Behandlung `ok`.
  - Eine Laborprobe als `document`.
  - Füllstand für einen Vorrat mit bekannter Grenze, Bildstatistik für Mengen, die nur wachsen.

  Der Inhalt der Regeln bleibt gleich; nur die Beispiele wechseln.
- **`PROMPT_VERSION`**: eine exportierte Konstante, die bei jeder inhaltlichen Änderung der Texte erhöht wird. Sie beginnt
  mit 2; die Fassung von 1.4.0 und davor gilt als 1. Der Generierungsprotokolleintrag in der App und der Eval-Bericht
  nennen sie.
- **Leck-Test** (`packages/llm/test/prompt-leak.test.ts`):
  - **Was geprüft wird:** der Systemtext (erste Anfrage und Reparatur) sowie der feste Rahmentext des Nutzerteils. Das ist
    alles außer den Abschnitten „Net to map“ und „Worked examples“. Für jedes Beispielnetz mit Domänenansicht in
    `examples/` (heute Paketzentrum, Smart Office, Fahrradrahmen) darf dort nichts davon vorkommen:
    - `meta.theme` und `meta.viewName`,
    - `entity.singular` und `entity.plural`,
    - die Beschriftungen und Texte der Ansicht,
    - die Namen der Stellen und Transitionen.
  - **Englische Entsprechungen:** Zusätzlich gibt es eine gepflegte Liste je Beispiel im Test, etwa „parcel sorting“,
    „sorting center“, „hall 2“, „smart office“, „meeting room“, „bicycle frame“, „tube“, „coated“, „weld“ und „saw“.
  - **Ausnahmen:** Die Aufzählungen der Symbol-, Icon- und Tint-Namen (`parcel`, `frame` usw.) sind ausgenommen. Der Test
    entfernt sie vor dem Vergleich, indem er dieselben Konstanten nutzt, nicht durch Textsuche.
  - **Schreibweise:** Groß- und Kleinschreibung spielt keine Rolle. Es zählen nur ganze Wörter, ab vier Zeichen bei
    einzelnen Wörtern.
  - **Neue Beispiele:** Kommt ein neues Beispielnetz mit Ansicht hinzu, nimmt der Test es automatisch auf.
- **Prompt-Snapshot-Tests** werden angepasst; sonst ändert sich am Ablauf der Generierung nichts.

## 2. Auswertung für Experimente (`packages/llm/scripts/eval*.ts`)

Neue Optionen; die vorhandenen bleiben wie sie sind. `--examples` heißt weiter „die Netze, die ausgewertet werden“.

| Option                         | Wirkung                                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--shots <ids>` / `--shots none` | Welche Beispiele mit ihrer Ansicht in den Prompt kommen (Standard wie bisher: Paketzentrum und Smart Office). Das ausgewertete Netz selbst wird immer herausgefiltert (über den `netHash`). `none` ist Zero-Shot. |
| `--no-positions`               | Ohne Editorpositionen im Netz; der Satz zu den Positionen im Systemtext entfällt dann auch.                                                                                              |
| `--description <id>=<text>`    | Beschreibung der Domäne je Netz, wiederholbar. Ohne Angabe gelten die eingebauten Sätze; für `bike-frames` kommt einer dazu. Fehlt einer, bleibt es bei „A process called …“.          |
| `--descriptions <file>`        | Dasselbe als JSON-Datei `{ "<id>": "<text>" }`.                                                                                                                                          |
| `--repeat <n>`                 | Jedes Netz n-mal unabhängig erzeugen. Der Bericht nennt jeden Lauf und eine Zusammenfassung: Anteil bestanden, Runden je Lauf als Verteilung, Zeit, Tokens.                               |
| `--save-prompts`               | Schreibt die erste Anfrage je Netz (System und Nutzer) neben den Bericht, zum Archivieren.                                                                                               |

Der Bericht (Markdown und JSON) enthält zusätzlich:

- **Prompt-Angaben:** `PROMPT_VERSION` und einen SHA-256 der ersten Anfrage je Netz, getrennt nach System- und Nutzerteil.
- **Bedingungen:** die gewählten Optionen (Shots, Positionen, Beschreibung, Temperatur, Runden, JSON-Modus), damit ein Lauf
  in der Dissertation eindeutig beschrieben werden kann.
- **Ähnlichkeit zur Referenzansicht**, falls das Netz eine im Repository hat:
  - Übereinstimmung der Art (`kind`) je Element in Prozent.
  - Mittlerer Abstand der Elementmittelpunkte, normiert auf die Diagonale der Leinwand.
  - Übereinstimmung von `appearance` und `display` in Prozent.

  Diese Werte zeigen, wie nah ein Ergebnis an der Referenz liegt. Mit `--no-positions` und `--shots none` lässt sich
  trennen, was das Modell selbst beiträgt und was es aus dem Prompt übernimmt. Die Berechnung liegt in einer kleinen,
  getesteten Funktion in `@pnm/llm` (nicht im Skript), mit dokumentierten Grenzen. Beispiel: Ein verborgenes Element hat
  keinen Mittelpunkt und zählt nur bei der Art.

## 3. App

- Das Generierungsprotokoll (Dialog und gespeicherter Eintrag) nennt `PROMPT_VERSION`.
- Sonst keine Änderung: Die App schickt weiter die Positionen und die zwei Standardbeispiele.

## 4. Tests

- **Leck-Test** wie in 1. Er muss auf dem Stand von 1.4.0 rot sein; das wird einmal gezeigt und im CHANGELOG erwähnt. Auf
  dem neuen Stand ist er grün.
- **Optionen des Skripts:** Einlesen, Fehler bei unbekannter Netz-ID oder doppelter Beschreibung.
  - `--shots`: Auswahl stimmt, das eigene Netz wird nie gezeigt.
  - `--no-positions`: keine Positionen, Satz entfällt.
  - `--repeat`: Zusammenfassung stimmt.
  - Der Bericht enthält Version, Hashes und Bedingungen.
- **Ähnlichkeit:** Handrechnung auf kleinen Ansichten; die Referenz mit sich selbst ergibt 100 % und Abstand 0.
- **Ablauf der Auswertung** gegen das vorhandene Fake-LLM (keine echte Verbindung).

## 5. Dokumentation

- `docs/domain-view.md`, Abschnitt zum LLM:
  - was der Prompt enthält und was nicht,
  - die Positionen,
  - die Beispiele,
  - die Regel, dass die festen Texte keine Lösungen von Beispielen enthalten dürfen (mit Verweis auf den Test).
- `docs/eval/README.md`: die neuen Optionen, ein Beispiel für eine Ablation (mit und ohne Positionen, mit und ohne
  Beispiele, mehrere Wiederholungen) und wie Prompt-Version und Hash in einer Arbeit angegeben werden.
- `CHANGELOG.md` (1.4.1):
  - Befund und Korrektur.
  - Hinweis: Frühere Läufe (Prompt-Version 1) enthielten den Hinweis „Parcel sorting center / Hall 2“, und seit 1.4.0 die
    Stufen des Fahrradbeispiels.
- Alle Pakete auf 1.4.1, `PLAN.md` (N3 und Stand).

## 6. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei, ebenso
   `pnpm -r --workspace-concurrency=1 test`.
2. Playwright grün; die bestehenden LLM-Tests der App (mit Fake-LLM) unverändert grün.
3. Leck-Test grün; einmal gezeigt, dass er auf 1.4.0 anschlägt.
4. `pnpm --filter @pnm/llm eval` läuft gegen das Fake-LLM mit `--shots none --no-positions --repeat 2 --save-prompts` und
   schreibt einen Bericht mit Version, Hashes, Bedingungen und Ähnlichkeit.
5. Simulation und Ansichten aller Beispiele unverändert (Golden-Tests).
6. Thematische Commits, gepusht.
