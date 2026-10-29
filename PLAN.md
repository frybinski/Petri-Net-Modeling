# Projektplan: Werkzeug zur Modellierung höherer Petri-Netze

Stand: 2026-10-29 · Status: Version 1.1.0 (M0–M5 und D1–D5 fertig; M6 offen) · Ergänzt um die Domänenansicht (D1–D5)

## 1. Zielbild

Ein webbasiertes Werkzeug, mit dem sich höhere Petri-Netze grafisch modellieren,
typisieren, simulieren, analysieren und austauschen lassen. Die Oberfläche soll
sich wie ein modernes Diagrammwerkzeug anfühlen (flüssiges Canvas, Tastaturkürzel,
Undo/Redo, automatisches Layout), der Kern soll formal sauber und von der
Oberfläche unabhängig sein, damit er auch per Kommandozeile, API oder aus anderen
Programmen (z. B. einer LLM-Verarbeitungskette) genutzt werden kann.

Leitgedanken:

- **Kern vor Oberfläche.** Netzmodell, Typsystem, Schaltregel und Analysen leben
  in einem eigenständigen TypeScript-Paket ohne Browser-Abhängigkeiten.
- **Local-first.** Alles läuft zunächst vollständig im Browser, ohne Server.
  Ein Backend kommt erst, wenn Persistenz, Teilen oder rechenintensive Analysen
  es erfordern.
- **Offene Formate.** Interne Repräsentation als JSON, Austausch über PNML,
  Export nach SVG/PNG und TikZ.
- **Erweiterbar in der Netzklasse.** Der Kern modelliert eine allgemeine
  „gefärbte" Netzklasse, konkrete Varianten (Stellen/Transitions-Netze,
  JSON-Netze, Pr/T-Netze) sind Profile darauf.

## 2. Formalismus

### 2.1 Netzklasse

Grundlage ist ein Coloured-Petri-Net-artiger Kern:

| Element        | Bedeutung                                                         |
|----------------|-------------------------------------------------------------------|
| Stelle         | hat einen **Typ** (Farbmenge), Marken sind Werte dieses Typs      |
| Transition     | hat eine optionale **Wächterbedingung** (Guard) über Variablen    |
| Kante          | hat eine **Inschrift**: ein Ausdruck mit Variablen, der eine Multimenge von Marken liefert |
| Markierung     | Abbildung Stelle → Multimenge von Werten                          |
| Bindung        | Belegung der Variablen einer Transition, unter der sie aktiviert ist |

### 2.2 Typsystem und Ausdruckssprache

Empfehlung: **JSON-Netz-Profil als erste höhere Netzklasse.**

- Marken sind JSON-Dokumente.
- Stellentypen werden als **JSON Schema** beschrieben.
- Kanteninschriften und Wächter nutzen eine kleine, seiteneffektfreie
  Ausdruckssprache über JSON-Werten. Kandidaten: JSONata (ausdrucksstark,
  gute Bibliothek), JMESPath (einfacher, weniger mächtig) oder eine eigene
  kleine Sprache (volle Kontrolle, mehr Aufwand). Empfehlung: **JSONata**
  für den Start, gekapselt hinter einer Schnittstelle, damit ein Austausch
  möglich bleibt.
- Eingangskanten binden Variablen durch **Mustervergleich** (Filterschema plus
  Variablenbindung), Ausgangskanten erzeugen Marken durch **Konstruktion**.

Begründung: JSON-Netze knüpfen an die XML-Netze der Gruppe Oberweis an,
passen zur Verifikationskette der Dissertation (Beitrag B3) und machen Marken
für Menschen und LLMs gleichermaßen lesbar. Stellen/Transitions-Netze ergeben
sich als Sonderfall (Typ „Einheit", Inschriften sind Zahlen).

### 2.3 Schaltregel

- Aktivierung: Berechnung aller gültigen Bindungen einer Transition unter der
  aktuellen Markierung (Unifikation über Eingangskanten, danach Wächter).
- Schalten: Entfernen der gebundenen Eingangsmarken, Auswertung der
  Ausgangsinschriften, Hinzufügen der erzeugten Marken, Typprüfung gegen das
  Stellenschema.
- Konfliktauflösung in der Simulation: manuell (Nutzer wählt Bindung) oder
  zufällig (gleichverteilt, später gewichtet).

## 3. Architektur

```
┌──────────────────────────────────────────────────────────────┐
│  apps/web           React-Oberfläche (Editor, Simulator, UI)  │
├──────────────────────────────────────────────────────────────┤
│  packages/core      Netzmodell · Typen · Schaltregel · Analyse│
│  packages/expr      Ausdruckssprache (Adapter: JSONata)       │
│  packages/sim       Ereignissimulation · Kennzahlen · Worker  │
│  packages/io        Event Log (CSV, XES) · PNML · SVG · TikZ  │
│  packages/layout    Automatisches Layout (ELK)                │
├──────────────────────────────────────────────────────────────┤
│  apps/cli           Kommandozeile (validate, simulate, export)│
│  apps/server (M6)   Persistenz · Teilen · schwere Analysen    │
└──────────────────────────────────────────────────────────────┘
```

Alle Pakete in einem **Monorepo** (pnpm Workspaces), Sprache durchgängig
**TypeScript**, damit Kernlogik zwischen Browser, CLI und Server geteilt wird.

### 3.1 Technologieauswahl

| Bereich            | Empfehlung                      | Alternative              | Begründung |
|--------------------|---------------------------------|--------------------------|------------|
| Sprache            | TypeScript (strict)             | –                        | geteilter Kern, Typsicherheit |
| Paketverwaltung    | pnpm Workspaces + Turborepo     | npm Workspaces           | schnelle Builds, Caching |
| Frontend           | React 19 + Vite                 | Svelte, SolidJS          | Ökosystem, Canvas-Bibliotheken |
| Canvas             | React Flow (xyflow)             | eigenes SVG, Konva       | Pan/Zoom, Knoten/Kanten, Selektion, Minimap fertig |
| Zustand (State)    | Zustand + Immer                 | Redux Toolkit            | schlank, Undo/Redo über Patches |
| Layout             | elkjs (layered)                 | dagre                    | Qualität bei gemischten Graphen |
| Formulare/Editoren | CodeMirror 6 für Inschriften    | Monaco                   | leichtgewichtig, Syntaxhervorhebung |
| UI-Komponenten     | Radix UI + Tailwind CSS         | MUI, shadcn/ui           | zugänglich, anpassbar |
| Validierung        | Zod (Modell), Ajv (JSON Schema) | –                        | Laufzeitprüfung des Formats |
| Tests              | Vitest, Playwright              | Jest, Cypress            | schnell, Browser-Tests |
| CI                 | GitHub Actions                  | –                        | Lint, Typen, Tests, Build, Preview-Deploy |
| Hosting (Web)      | GitHub Pages / Vercel           | –                        | statische App, kein Server nötig |

### 3.2 Datenmodell (Skizze)

```jsonc
{
  "version": "1.0",
  "profile": "json-net",            // "pt-net" | "json-net"
  "name": "Bestellabwicklung",
  "types": {
    "Order": { "type": "object", "properties": { "id": {"type":"string"}, "amount": {"type":"number"} } }
  },
  "places":      [{ "id": "p1", "name": "Eingang", "type": "Order", "position": {"x":0,"y":0} }],
  "transitions": [{ "id": "t1", "name": "Prüfen", "guard": "$o.amount > 0", "position": {"x":200,"y":0} }],
  "arcs": [
    { "id": "a1", "source": "p1", "target": "t1", "inscription": "$o" },
    { "id": "a2", "source": "t1", "target": "p2", "inscription": "{ \"id\": $o.id, \"ok\": true }" }
  ],
  "marking": { "p1": [ { "id": "A-1", "amount": 12.5 } ] },
  "annotations": [ /* Kommentare, Gruppen, Farben */ ]
}
```

Das Format ist gleichzeitig Speicherformat, API-Vertrag und Eingabe für die CLI.

## 4. Meilensteine

Jeder Meilenstein endet mit einem lauffähigen, getesteten Stand.

### M0 · Projektgerüst (1 Woche) · fertig (0.1.0)
- Monorepo, Linting (ESLint, Prettier), TypeScript-Konfiguration, Vitest, CI.
- Leere Web-App mit Canvas, die startet und deployt wird.
- README mit Zielbild und Entwicklungsanleitung.

### M1 · Editor für Stellen/Transitions-Netze (2–3 Wochen) · fertig (0.1.0)
- Stellen, Transitionen, Kanten anlegen, verschieben, löschen, benennen.
- Kantengewichte, Anfangsmarkierung, Kapazitäten.
- Pan/Zoom, Mehrfachauswahl, Ausrichten, Raster, Minimap.
- Undo/Redo, Kopieren/Einfügen, Tastaturkürzel.
- Automatisches Layout (ELK), Speichern/Laden als JSON (Datei + IndexedDB).
- Strukturvalidierung (Bipartitheit, verwaiste Kanten, doppelte Namen).

### M2 · Höhere Netze: Typen, Inschriften, Wächter (3 Wochen) · fertig (0.2.0)
- Typverwaltung (JSON Schema) mit Editor und Vorschau.
- Inschriften- und Wächtereditor mit Syntaxhervorhebung, Fehlern und
  Variablenvervollständigung.
- Bindungsberechnung und Typprüfung im Kern, Anzeige aktivierter Transitionen.
- Markenansicht pro Stelle (Tabelle/JSON), Marken anlegen und bearbeiten.
- Profilumschaltung Stellen/Transitions-Netz ⟷ JSON-Netz.

### M3 · Simulation (erweitert, 3–4 Wochen) · fertig (0.4.0)
- Paket `@pnm/sim`: diskrete Ereignissimulation mit Dauern (fest, gleichverteilt,
  exponentiell), Prioritäten zur Konfliktauflösung, Raten für Quell-Transitionen,
  zweiphasigem Schalten, Fall-Identität, seedbarem Zufall und einem
  Ereignisstrom (`SimEvent`). Läuft im Web Worker. Die atomare Schaltregel aus
  M1/M2 bleibt der Sonderfall Dauer 0.
- Optionale Modellfelder `timing`, `priority`, `rate` an Transitionen und `role`
  an Stellen, mit Feldern im Eigenschaftspanel.
- Editor: Abspielen mit Geschwindigkeit, Pause, Einzelschritt, Zurück (Verlauf),
  Haltepunkte (Transition, Markierungsbedingung), Animation des Markenflusses.
- Trace-Panel und Export als Event Log (CSV: `case_id, activity, timestamp,
  lifecycle`) und XES, aus demselben Ereignisstrom.

### D1–D4 · Domänenansicht (siehe `docs/plan/Domaenenansicht_Einordnung.md`)
- D1 Abbildung ohne Simulation (fertig, 0.5.0; siehe `docs/domain-view.md`): Schema `DomainView`, Prüfung V1–V8, generische
  Abbildung, statische Canvas-Ansicht, Speicherung unter `domainView`.
- D2 Animation (fertig, 0.6.0; siehe `docs/domain-view.md`): Ansicht hört auf den Ereignisstrom, Steuerung, Kennzahlen,
  Inspektor, Hover-Verknüpfung mit dem Netz, Nebeneinander-Modus.
- D3 LLM-Erzeugung der Abbildung (fertig, 0.7.0; siehe `docs/domain-view.md`, Lauf mit echtem Modell für A6 steht aus):
  OpenAI-kompatibler Anbieter, Prompt mit Netz,
  Domänenbeschreibung, Schema und Beispielen, Reparaturschleife, Auffüllen,
  Herkunft je Eintrag. Das Netz bestimmt das Verhalten, die Abbildung nur das
  Aussehen (neuro-symbolische Arbeitsteilung).
- D4 Bearbeiten (fertig, 0.8.0; siehe `docs/domain-view.md`): JSON-Editor mit Live-Prüfung, Ziehen in der Ansicht, Erkennen
  veralteter Abbildungen mit „Ergänzen".

### M4 · Austausch und Export (1–2 Wochen, nach D4) · fertig (0.9.0)
- PNML-Import/-Export (P/T-Netze standardkonform, höhere Netze über
  Toolspecific-Erweiterung).
- SVG- und PNG-Export, TikZ-Export passend zu den Dissertationsstilen.
- CLI: `pnm validate`, `pnm simulate --steps`, `pnm export --format`.

### M5 · Analyse (3 Wochen) · fertig (1.0.0)
- Erreichbarkeitsgraph (beschränkt, mit Abbruchkriterium), Anzeige als Graph.
- Für die Skelett-P/T-Struktur: Stellen- und Transitionsinvarianten,
  Beschränktheit, Lebendigkeit, Verklemmungen.
- Prüfung von Eigenschaften über Abläufen (LTLf/DECLARE) auf dem
  Erreichbarkeitsgraphen. Anschluss an Beitrag B3 der Dissertation.
- Web Worker für rechenintensive Analysen, damit die Oberfläche flüssig bleibt.

### D5 · Kopplung an echte Daten · fertig (1.1.0)
- Replay eines Event Logs (CSV, XES) oder einer Live-Quelle auf demselben Ereignisstrom: `docs/replay.md`,
  `docs/adr/0015-event-log-replay.md`, Plan `docs/plan/D5_Umsetzungsplan.md`.

### M6 · Backend, Teilen, Schnittstellen (optional, 3 Wochen) · offen
- Server (Node, Fastify) mit Projektablage, Versionen, Freigabelinks.
- REST/JSON-API für Lesen, Validieren, Simulieren und Analysieren.
- Echtzeit-Zusammenarbeit (Yjs) als Erweiterung.
- Schnittstelle für LLM-Verarbeitungsketten: Netz als JSON hinein,
  Validierungs- und Analyseergebnis heraus (neuro-symbolische Arbeitsteilung).

## 5. Projektstruktur

```
Petri-Net-Modeling/
├── apps/
│   ├── web/                 # React-App
│   └── cli/                 # Kommandozeile
├── packages/
│   ├── core/                # Modell, Schaltregel, Analyse (keine UI)
│   ├── expr/                # Ausdruckssprache (JSONata-Adapter)
│   ├── io/                  # JSON, PNML, SVG, TikZ
│   └── layout/              # ELK-Anbindung
├── docs/                    # Architektur, Formatbeschreibung, ADRs
├── examples/                # Beispielnetze (.pn.json)
├── .github/workflows/       # CI
├── package.json, pnpm-workspace.yaml, turbo.json
└── PLAN.md
```

## 6. Qualitätssicherung

- **Kern:** Unit-Tests für Schaltregel, Bindungsberechnung, Multimengen,
  Serialisierung (Roundtrip JSON ⟷ PNML). Property-Based-Tests
  (fast-check) für Multimengen und Schaltregel.
- **Oberfläche:** Komponententests (Vitest + Testing Library), End-to-End-Tests
  (Playwright) für Kernabläufe: Netz zeichnen, speichern, laden, simulieren.
- **Beispielnetze** als Regressionssuite (klassische Beispiele: Erzeuger/Verbraucher,
  Philosophen, Ampel, ein JSON-Netz-Geschäftsprozess).
- **CI:** Lint, Typprüfung, Tests, Build, Preview-Deployment pro Pull Request.
- **Architekturentscheidungen** als kurze ADRs unter `docs/adr/`.

## 7. Offene Entscheidungen

| Nr. | Frage | Empfehlung |
|-----|-------|------------|
| E1 | Erste höhere Netzklasse: JSON-Netze, Pr/T-Netze oder CPN mit ML-ähnlicher Sprache? | JSON-Netze |
| E2 | Ausdruckssprache: JSONata, JMESPath oder eigene Sprache? | JSONata, gekapselt |
| E3 | Canvas: React Flow oder eigenes SVG-Rendering? | React Flow, Wechsel später möglich |
| E4 | Sprache der Oberfläche: Deutsch, Englisch, beides (i18n)? | Englisch mit i18n-Vorbereitung |
| E5 | Backend von Anfang an oder erst ab M6? | erst ab M6, Local-first |
| E6 | Lizenz | MIT oder Apache-2.0 |

## 8. Stand und nächste Schritte

Version 1.1.0 schließt M0 bis M5 und D1 bis D5 ab. Die Einschränkungen, die bis dahin bekannt waren, sind behoben oder
stehen mit Begründung in `docs/limitations.md`; das Vorgehen steht in `docs/plan/Release-1.0_Umsetzungsplan.md`.

D5 ist mit 1.1.0 fertig: Event Logs und Live-Zuflüsse laufen als zweite Quelle der Simulation durch Netzansicht,
Domänenansicht, Trace, Kennzahlen und Konformitätsprüfung (`docs/replay.md`). Eine Brücke von einem fremden Prozess in die
Seite (WebSocket, `postMessage`) bleibt offen.

Offen ist der optionale Baustein:

1. **M6 · Backend, Teilen, Schnittstellen:** Server für Projektablage und Freigabelinks, REST-API, Schlüsselverwaltung
   für den LLM-Anbieter (löst die Einschränkung zum Schlüssel im Browser) und Zusammenarbeit in Echtzeit.
