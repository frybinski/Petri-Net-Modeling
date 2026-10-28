# Domänenansicht für die Simulation: Prüfung und Einordnung in den Plan

Stand: 2026-10-28 · Grundlage: Feature-Auftrag „Domänenansicht für die
Petri-Netz-Simulation" (Fabian, 28.10.2026) und der Stand des Werkzeugs nach
M2 (Version 0.2.0). Das Mockup liegt unter `docs/mockups/domaenenansicht.html` und ist Referenz für
das Verhalten und Inspiration für das Aussehen.

## 1. Kurzurteil

Der Auftrag passt gut zum Werkzeug und zur Leitidee der Dissertation
(LLM schlägt vor, Prüfung entscheidet, Netz bestimmt das Verhalten). Er lässt
sich ohne Bruch einbauen, verlangt aber drei Anpassungen an unserem Plan:

1. **Die Simulation wird zeitbehaftet.** Der Auftrag braucht Dauern, Gewichte,
   Raten, zweiphasiges Schalten, Fall-Identität und einen Ereignisstrom. Das
   ist eine Erweiterung unseres Meilensteins M3, keine zweite Semantik. Die
   atomare Schaltregel aus M1/M2 bleibt der Sonderfall Dauer 0.
2. **Die Domänenansicht wird ein eigener Meilenstein D** mit vier Stufen, der
   auf M3 aufsetzt. Die Meilensteinnamen M1 bis M5 aus dem Auftrag kollidieren
   mit unseren und werden zu D1 bis D5.
3. **Die LLM-Anbindung rückt vor.** Bisher in M6 vorgesehen, wird sie mit D3
   das erste Mal gebraucht. Sie läuft im Browser gegen eine OpenAI-kompatible
   Schnittstelle, ohne eigenen Server.

## 2. Abgleich mit dem Bestand

| Auftrag erwartet | Bestand in 0.2.0 | Folge |
|------------------|------------------|-------|
| Datenmodell mit Stellen, Transitionen, Kanten, Markierung, Positionen | vorhanden (`@pnm/core`, Format 1.0) | übernehmen |
| Dauer, Gewicht (Konfliktauflösung), Rate an Transitionen | fehlt | optionale Felder `timing`, `priority`, `rate` an `Transition`, Format bleibt 1.0 (nur optionale Felder) |
| Rolle einer Stelle überschreibbar (Ressource/Fall) | fehlt | optionales Feld `role?: 'case' \| 'resource'` an `Place` |
| Simulator ohne Oberflächenabhängigkeit | Schaltregel im Kern, Simulationszustand im Web-Store, schrittweise ohne Zeit | neues Paket `@pnm/sim` mit diskreter Ereignissimulation, nutzt die Kernschaltregel |
| Zweiphasiges Schalten (Start entnimmt, Ende legt ab) | `EnabledBinding` liefert bereits `consumes` und `produces` getrennt | Engine trennt die Anwendung in zwei Zeitpunkte, Kern unverändert |
| Fall-Identität an Marken | P/T-Marken sind Werte `1` ohne Identität | Engine führt Markenmetadaten `{id, caseId, enteredAt}` parallel zur Markierung |
| Ereignisstrom `SimEvent` | fehlt | Kernstück von `@pnm/sim`, auch Grundlage für Animation im Netzeditor und für den Trace-Export |
| Zufall mit Seed | fehlt (Math.random) | seedbarer Generator in `@pnm/sim`, auch für „Step (random)" im Editor |
| Speicherort der Abbildung | `.pn.json` mit optionalen Feldern | Schlüssel `domainView` im Netzdokument (Vorschlag des Auftrags), Format bleibt 1.0 |
| Prüfung V1 bis V8 mit Pfad und Regel | `Diagnostic` mit `code`, `message`, `elementId` | `Diagnostic` um optionales `path` erweitern, Codes `DV_V1` bis `DV_V8` |
| Generische Abbildung aus Positionen oder Schichtenlayout | Editorpositionen vorhanden, ELK-Layout in `@pnm/layout` | `@pnm/layout` wiederverwenden |
| 2D-Ansicht, 200 Marken flüssig | Netzeditor in React Flow (SVG/DOM) | Domänenansicht als Canvas-2D-Renderer in `apps/web`, eigene Komponente neben dem Editor |
| Verknüpfung Hover Netz ⟷ Domäne | Auswahl im Store vorhanden | Hover-Zustand in den UI-Store, beide Ansichten lesen ihn |
| LLM-Anbindung | fehlt | Konfiguration (Basis-URL, Modell, Schlüssel) im Browser gespeichert, Aufruf aus dem Browser |
| PNML-Import für Testnetz „Reklamation" | fehlt (geplant in M4) | Testnetz vorab als `.pn.json` anlegen, PNML-Import bleibt M4 |
| Export Event Log CSV (`case_id, activity, timestamp, lifecycle`) | fehlt (M3 sah CSV/JSON/XES vor) | ein Exporter in `@pnm/io`, CSV und XES aus demselben Ereignisstrom |
| Höhere Netze ausgeklammert | JSON-Netze vorhanden | Engine arbeitet auf beiden Profilen (Bindungen liefern `consumes`/`produces`), Ansicht ignoriert Markendaten zunächst |

## 3. Anmerkungen und Risiken

- **Keine zweite Schaltsemantik.** Die Engine ruft für die Aktivierung die
  Kernfunktionen (`enabledTransitions` bzw. `findEnabled`) auf und wendet
  `consumes` beim Start und `produces` beim Ende an. Ein Test weist nach, dass
  ein Ablauf mit allen Dauern 0 dieselben Markierungen erzeugt wie die atomare
  Schaltregel.
- **Kapazitäten beim zweiphasigen Schalten.** Die schwache Kapazitätsregel
  wird beim Start gegen die Markierung nach Entnahme plus geplante Ablage
  geprüft. Laufende Schaltungen reservieren damit Platz. Das muss im Plan für
  `@pnm/sim` festgehalten werden, sonst entstehen Überbelegungen.
- **JSON-Netze und Zeit.** Die Bindungsberechnung ist asynchron. Die Engine
  muss deshalb asynchron laufen (Ereignisschleife mit `await`). Für P/T-Netze
  bleibt sie synchron schnell. Fall-ID kann bei JSON-Netzen später aus einem
  Markenfeld kommen (`caseIdField` in der Abbildung, nach D4).
- **LLM im Browser.** Die statisch gehostete App ruft den Anbieter direkt auf.
  Für Ollama muss der Nutzer `OLLAMA_ORIGINS` setzen, für Cloud-Anbieter liegt
  der Schlüssel im Browser (localStorage, mit Hinweis). Für die
  Dissertation ist das ausreichend, für Dritte ein späterer Server (M6).
- **Leistung.** 200 bewegte Marken bei 60× Geschwindigkeit sind in Canvas 2D
  unkritisch, die Ereignisschleife muss aber von der Zeichenschleife entkoppelt
  sein (Auftrag: „der Simulator wartet nie"). Web Worker für die Engine ist
  die saubere Lösung und deckt zugleich das in M2 notierte Thema
  (JSONata-Auswertung im Worker) ab.
- **Umfang.** D1 bis D4 sind zusammen etwa so groß wie M1 plus M2. Das ist
  der größte Block im Plan und sollte in vier Umsetzungsschritten mit je
  eigener Abnahme laufen.

## 3a. Befund aus dem Mockup

Das Mockup (eine HTML-Datei, Canvas 2D, ohne Abhängigkeiten) läuft fehlerfrei
und zeigt alle drei Beispiele. Für die Umsetzung sind diese Punkte wichtig:

- **Testnetze und Abbildungen** liegen als Konstanten vor (`PAKET_NET`,
  `PAKET_MAP`, `OFFICE_NET`, `OFFICE_MAP`, `SAMPLE_PNML`) und werden in D1 in
  unser Format (`.pn.json` mit `timing`, `priority`, `rate`, `domainView`)
  übertragen. Das Vorläuferformat (`as`, `lane`, `turnstile`, `diverter`,
  `exit`, `trucks`) wird dabei auf das Schema des Auftrags abgebildet.
- **Dauern** stehen im Mockup als Intervall `dur: [min, max]` an der
  Transition, **Gewichte** als `w` und die Zugangsrate als `defaultRate` am
  Netz. Das bestätigt den Vorschlag, diese Felder optional an Transitionen zu
  führen. Zusätzlich hat das Mockup eine `warmup`-Zeit je Netz, die als
  Simulationseinstellung (nicht als Modellfeld) übernommen wird.
- **Kapazitäten zur Laufzeit.** Das Mockup erlaubt, Ressourcenmarken während
  der Simulation zu ändern („Änderungen wirken sofort"). Für das Netz ohne
  Ressourcenstellen (Reklamation) bietet es stattdessen eine Kapazität
  „gleichzeitige Bearbeitungen je Transition". Letzteres widerspricht der Regel
  des Auftrags, dass Ressourcen nur über Marken wirken. Vorschlag: Die Engine
  erlaubt Markierungsänderungen zur Laufzeit (Ressourcen nachlegen oder
  entziehen, als eigenes `SimEvent`), aber keine Transitionskapazität. Wer
  Nebenläufigkeit begrenzen will, modelliert eine Ressourcenstelle. Das ist
  eine offene Entscheidung für M3 (siehe Abschnitt 5).
- **Laufzeit aus Geometrie** (Weg zwischen Station und Puffer dauert so lange,
  wie die Marke braucht) übernimmt der Prototyp nicht, wie im Auftrag
  festgelegt. Wege mit Zeit sind Transitionen.
- **Oberfläche.** Das Erscheinungsbild des Mockups ist Inspiration, nicht
  Vorgabe. Die Darstellungsideen (Förderbänder, Plätze, Tore, Grundriss,
  Engpassfarben, Kennzahlenkarten, Ereignisstrom, Netz darunter) werden
  übernommen und im Designsystem des Werkzeugs weiterentwickelt. Spielraum
  nach oben besteht bei Illustrationen (Sprites je Domäne, Schatten, Tiefe),
  Zoom und Verschieben in der Ansicht, Themen je Domäne (Halle, Büro, Klinik,
  Lager) und einer ruhigeren Typografie. Das Mockup ist bewusst einfach
  gehalten und markiert die Untergrenze.
- **Seitenleiste** mit Lage (Uhr, Fälle im System, Durchsatz, Durchlaufzeit),
  Warteschlangen mit Engpass-Kennzeichnung, Kapazitäten und Ereignisstrom ist
  eine gute Vorlage für den Inspektor in D2.

## 4. Angepasster Gesamtplan (Reihenfolge)

| Schritt | Inhalt | Status |
|---------|--------|--------|
| M0, M1, M2 | Gerüst, P/T-Editor, JSON-Netze | fertig (0.2.0) |
| UI-Polish | Bedienung und Erscheinungsbild (Phase A, B1 bis B6) | fertig (0.3.0) |
| **M3 Simulation (erweitert)** | Paket `@pnm/sim`: diskrete Ereignissimulation mit Dauern, Prioritäten, Raten, zweiphasigem Schalten, Fall-IDs, Seed, `SimEvent`-Strom, Web Worker. Editor: Abspielen mit Geschwindigkeit, Pause, Einzelschritt, Zurück, Haltepunkte, Animation des Markenflusses im Netz, Trace-Panel. Export CSV (Event Log) und XES. Modellfelder `timing`, `priority`, `rate`, `role` mit Panel-Feldern. | fertig (0.4.0) |
| **D1 Abbildung ohne Simulation** | Schema `DomainView`, Prüfung V1 bis V8, generische Abbildung, statische Canvas-Ansicht, drei Testnetze als `.pn.json`, Speicherung unter `domainView`. Abnahme A4, A5. | nächster Schritt |
| **D2 Animation** | Ansicht hört auf `SimEvent`, Bewegungen, Engpassfarben, Steuerung, Kennzahlen, Inspektor, Hover-Verknüpfung mit dem Netz, Nebeneinander-Modus. Abnahme A1, A2, A3, A9. | neu |
| **D3 LLM-Erzeugung** | Anbieterkonfiguration, Prompt mit Netz, Domänenbeschreibung, Schema und Beispielen, Reparaturschleife (max. 3), Auffüllen, Herkunft je Eintrag. Abnahme A6. | neu |
| **D4 Bearbeiten** | JSON-Editor mit Live-Prüfung, Ziehen von Punkten, Rechtecken und Pfaden, Erkennen veralteter Abbildungen (V7) mit „Ergänzen". Abnahme A7, A8 (Export kommt aus M3). | neu |
| M4 Austausch | PNML, PNG, TikZ, CLI | verschoben nach D4 |
| M5 Analyse | Erreichbarkeit, Invarianten, LTLf/DECLARE | unverändert |
| D5 optional | Replay eines Event Logs, externe Ereignisquelle | nach M5 |
| M6 Backend | Server, Teilen, API, LLM-Proxy | unverändert |

## 5. Offene Entscheidungen des Auftrags, Vorschlag

| Frage | Vorschlag |
|-------|-----------|
| Speicherort der Abbildung | `domainView` im Netzdokument. Ein Netz, eine Datei. |
| Dauer, Gewicht, Rate im Netzmodell | optionale Transitionsfelder, Vorgabe Dauer 0, Priorität 1, keine Rate |
| Canvas 2D oder SVG | Canvas 2D für die Domänenansicht, SVG bleibt im Netzeditor |
| Rolle überschreibbar | ja, `role` an der Stelle, berechnete Rolle als Vorgabe im Panel sichtbar |
| Vorgabemodell | lokal über Ollama, Cloud als Option. Modellname und Basis-URL frei. |
| Marken mit Daten anzeigen | nach D4 als Beschriftung oder Farbe über ein Feld `labelField` |
| Ressourcen zur Laufzeit ändern, Transitionskapazität | Markierung zur Laufzeit änderbar (eigenes Ereignis), keine Transitionskapazität (Ressourcenstelle modellieren) |

## 6. Nächste Schritte

1. Nach Abschluss des UI-Polish den Umsetzungsplan für M3 (erweitert) schreiben.
   Darin die Modellfelder, `@pnm/sim` und der Ereignisstrom so festlegen, dass
   D1 bis D4 direkt anschließen.
2. `PLAN.md` entsprechend Abschnitt 4 fortschreiben (erledigt mit diesem
   Dokument).
