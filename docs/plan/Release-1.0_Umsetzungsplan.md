# Umsetzungsplan Release 1.0.0: Einschränkungen, Konsolidierung, Veröffentlichung

Stand: 2026-10-29 · Stand des Werkzeugs: 1.0.0-rc.1 (M0–M5, UI-Polish, D1–D4).
Dieser Schritt bringt keine neuen Funktionen. Er arbeitet die in den Pull
Requests 1 bis 10 festgehaltenen bekannten Einschränkungen ab, konsolidiert
Dokumentation und Changelog und veröffentlicht 1.0.0 als Tag und GitHub-Release.

## 1. Einschränkungen: Entscheidung je Punkt

Jeder Punkt wird entweder **behoben** (B) oder **dokumentiert** (D) im neuen
Abschnitt „Known limitations" der README und in `docs/limitations.md`. Für
jede Behebung gilt: minimaler Eingriff, Test, kein Verhalten anderer Teile
ändern.

### Editor und Oberfläche

| Nr. | Punkt (Herkunft) | Entscheidung | Umsetzung |
|-----|------------------|--------------|-----------|
| 1 | Fit view begrenzt auf 125 %, kleine Netze füllen 1920 px nicht (UI-Polish) | B | `maxZoom` für Fit view 2.0; Zoomstufen-Klassen (`zoom-detail` ab 0,7) bleiben. Test: Fit auf 1920 px ergibt Zoom > 1,25 für Erzeuger/Verbraucher. |
| 2 | Kanten laufen hinter Wächter-Pillen (Token-Ring) (UI-Polish) | B | Pille bekommt 2 px Außenrand in Canvas-Farbe (bereits) **und** Kantenpfad meidet die Pillen-Box wie Knoten (Routing-Hindernis). Beispiel Token-Ring prüfen. |
| 3 | Tab wird bei einem ausgewählten Knoten abgefangen (UI-Polish) | D | Verhalten ist gewollt, Esc gibt Tab frei; in der README und im Kürzel-Dialog erklären. |
| 4 | Tooltip bleibt kurz stehen bei sprunghaftem Zeigerwechsel (UI-Polish) | D | Radix-Verhalten, nur unter Automatisierung sichtbar. |
| 5 | Namen bei 57 % Zoom etwas eng (UI-Polish) | D | |
| 6 | Kopieren zwischen Netzen nimmt Typdefinitionen nicht mit (M2) | B | Zwischenablage enthält die referenzierten Typen; beim Einfügen werden fehlende Typen angelegt, gleichnamige mit abweichendem Schema als `Name (2)` angelegt und zugeordnet. Test im Store. |
| 7 | Hauptbundle 270 kB gzip wegen JSONata und Ajv (M2) | B (teilweise) | Prüfen, ob `@pnm/analysis`, `@pnm/domain`-Painter, `@pnm/llm` und CodeMirror als eigene Chunks geladen werden (Vite `manualChunks` oder dynamische Imports). Ziel: Hauptbundle beim Start ohne Analyse/Domäne/LLM. Ergebnis in Zahlen im Changelog. JSONata und Ajv bleiben synchron für die Validierung. |
| 8 | JSONata-Zeitlimit greift nicht in `$match`-Regex (M2) | D | Steht im ADR 0005, Worker-Auswertung wäre ein eigener Schritt. |

### Simulation

| Nr. | Punkt | Entscheidung | Umsetzung |
|-----|-------|--------------|-----------|
| 9 | AND-Join fügt Marken verschiedener Fälle zusammen (M3) | D | In `docs/simulation.md` mit Beispiel; Hinweis auf JSON-Netze mit Fall-Feld. |
| 10 | Klick direkt nach dem Umschalten in den Simulationsmodus wird ignoriert (M3) | B | Klicks werden bis zur ersten Antwort des Workers gepuffert und dann ausgeführt (höchstens einer). Test im Store. |
| 11 | Aufwärmzeit blendet Kennzahlen lange aus (M3) | B | Kennzahlen-Panel zeigt während der Aufwärmzeit einen Fortschrittsbalken „Warm-up 4:12 of 20:00" statt nur Striche, mit Link zur Einstellung. |
| 12 | Ereignisprotokoll auf 200 000 Ereignisse begrenzt (M3) | D | Hinweis beim Erreichen (Toast einmalig) und in der Doku. |
| 13 | Schritt zurück und Reset springen statt rückwärts abzuspielen (D2) | D | |

### Domänenansicht

| Nr. | Punkt | Entscheidung | Umsetzung |
|-----|-------|--------------|-----------|
| 14 | Platz wird bei `start` belegt, Marke kommt 300 ms später an (D2) | B | Platz zeigt bis zur Ankunft den Zustand „reserved" (schraffiert, ohne Fortschrittsring); der Ring beginnt mit der Ankunft. |
| 15 | „Blockiert" wird schon bei einer wartenden Marke rot (D2) | B | Zustand `busy-full` (alle Plätze belegt, Marken warten) in Bernstein; `blocked` (rot) erst, wenn die wartenden Marken die gelbe Engpassschwelle erreichen. Doku anpassen, Tests anpassen. |
| 16 | Klick in der Domänenansicht (Inspect) wählt das Netzelement aus, Entf löscht es (D1) | B | Entf in der Domänenansicht löscht nie ein Netzelement: im Inspect-Modus ohne Wirkung mit Hinweis, im Edit-Modus wie in D4 (verbergen). |
| 17 | Keine Tastaturnavigation im Bild (D1) | B (klein) | Tab/Shift+Tab wandern im Bearbeitungsmodus durch die Einträge (Auswahl plus Scroll-ins-Bild), Enter öffnet die Beschriftung. Vollständige Barrierefreiheit bleibt dokumentierte Grenze. |
| 18 | Netzansicht hinter der Domäne rendert bei jedem Bündel (D2) | B | Im Modus „Domain" den Netzeditor nicht mounten; im Modus „Both" bleibt es. Messung in der PR-Beschreibung. |
| 19 | Drag-Vorschau baut die statische Szene je Zeigerbewegung neu (D4) | B | Während eines Drags wird nur der gezogene Eintrag auf einer eigenen Ebene gezeichnet, die statische Ebene bleibt stehen. Messung vorher/nachher. |
| 20 | Ressourcenstelle mit Plätzen an einer Station: Panel bearbeitet die Station (D4) | D | Hinweistext im Panel. |
| 21 | Gestrichelte Wege im Büro kreuzen sich; Personen-Sprites wirken als Kapseln (D1) | B (klein) | Sprite `person` mit Kopf, Schulter und leichtem Schatten überarbeiten; Wegeführung im Smart-Office-Beispiel von Hand entzerren. |
| 22 | HTTPS-Seite kann `http://localhost`-Anbieter nicht aufrufen (D3) | D | In den Einstellungen Hinweis mit Lösung (App lokal starten oder Anbieter mit HTTPS). |
| 23 | API-Schlüssel im `localStorage` (D3) | D | Hinweis bleibt, Server-Proxy ist M6. |
| 24 | Zwei „Fill"-Aktionen mit unterschiedlichem Verhalten (D4) | B | Aktionsliste: „Fill missing entries" wird rein ergänzend (wie die Karte), „Remove stale entries" kommt in die Aktionsliste. Tests anpassen. |

### Austausch, CLI, Analyse

| Nr. | Punkt | Entscheidung | Umsetzung |
|-----|-------|--------------|-----------|
| 25 | CLI-Bündel 5 MB (M4) | D | Startzeit 0,2 s, akzeptabel. |
| 26 | Schriften im PNG nur Latin (M4) | B | Latin-Extended-Subset zusätzlich einbetten, wenn ein Zeichen außerhalb Latin vorkommt (Umlaute sind Latin-1 und bereits abgedeckt; prüfen mit „Łódź"). |
| 27 | Mehrseitige PNML-Versätze nur aus Knotenpositionen (M4) | D | |
| 28 | JSON-Netze in Struktur und Invarianten nur als Skelett (M5) | D | |
| 29 | Vakuitäts-Hinweis bei Netzen ohne Verklemmung (M5) | B (klein) | Wenn der Zustandsraum keine Endzustände unter „deadlock" hat, schlägt die Oberfläche automatisch „any marking" vor (Hinweis mit Ein-Klick-Umschaltung). |
| 30 | Zeitlimit der Analyse nicht in der Oberfläche (M5) | B | Feld neben dem Zustandslimit. |
| 31 | Unbenutzte Zeichenkette `en.llm.badgeLlm` (D3) | B | entfernen. |

## 2. Konsolidierung

- `CHANGELOG.md`: Abschnitt **1.0.0** mit Zusammenfassung aller Stufen (je
  ein Absatz pro Bereich) und der Liste der Behebungen aus Abschnitt 1; die
  rc-Einträge bleiben darunter.
- `README.md`: Durchsicht als Erstkontakt. Reihenfolge: Was ist das (zwei
  Sätze), Screenshot, Hauptfunktionen als Tabelle (Editor, Netzklassen,
  Simulation, Domänenansicht, LLM, Austausch, Analyse, CLI), Schnellstart,
  Dokumentation (Links auf alle `docs/*.md`), Known limitations, Lizenz.
  Alle Screenshots auf dem Stand 1.0.0 neu erzeugen (hell), die dunklen nur
  dort, wo sie im Text verlinkt sind.
- `docs/README.md` (neu): Index aller Dokumente mit einem Satz je Datei,
  inklusive der ADRs und der Pläne.
- `docs/limitations.md` (neu): alle D-Punkte mit Begründung und Ausblick.
- `PLAN.md`: Status aktualisieren (M0–M5, D1–D4 fertig, D5 und M6 offen).
- Versionen auf `1.0.0` in allen `package.json`.
- `pnpm audit --prod` ausführen; Befunde mit Schwere high oder critical
  beheben (Update) oder begründet dokumentieren.

## 3. Veröffentlichung

- Workflow `.github/workflows/release.yml`: bei Tag `v*` Build, Tests
  (Lint, Typecheck, Unit), CLI-Bündel als `pnm-<version>.js` mit SHA-256-
  Summe, GitHub-Release mit den Release-Notes aus dem Changelog-Abschnitt
  (Skript extrahiert den Abschnitt der Tag-Version). Pages-Deployment
  bleibt an `main` gebunden.
- `docs/cli.md`: Abschnitt „Install" mit Download des Bündels von der
  Release-Seite und `node pnm-1.0.0.js --help`, plus lokaler Build.
- Tag `v1.0.0` wird **nach** dem Merge dieses Pull Requests auf `main`
  gesetzt (durch Fabian oder auf sein Zeichen), damit der Workflow greift.

## 4. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei.
2. Playwright (alt und neu) läuft lokal; die gesamte Suite dreimal hintereinander ohne Fehlschlag (Flake-Suche), Web-Unit-Suite dreimal unter Last.
3. Jeder B-Punkt hat einen Test oder eine dokumentierte Messung; jeder D-Punkt steht in `docs/limitations.md`.
4. Bundle-Größen vorher/nachher im Changelog (Hauptbundle, Chunks).
5. Release-Workflow in einem Probelauf mit `workflow_dispatch` auf dem Branch geprüft, ohne Release zu erzeugen (Dry-Run-Eingabe), oder lokal die Schritte ausgeführt.
6. Thematische Commits, gepusht.

## 5. Reihenfolge

1. B-Punkte Editor und Simulation (1, 2, 6, 7, 10, 11).
2. B-Punkte Domänenansicht (14–19, 21, 24).
3. B-Punkte Austausch und Analyse (26, 29, 30, 31).
4. Flake-Suche über die gesamte Playwright-Suite, Robustheit.
5. Konsolidierung: Changelog, README, docs/README, limitations, PLAN, Versionen, Audit.
6. Release-Workflow und CLI-Installationsdoku.
