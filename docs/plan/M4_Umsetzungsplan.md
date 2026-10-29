# Umsetzungsplan M4: Austausch und Export

Stand: 2026-10-29 · Grundlage: `PLAN.md` (M4), Stand des Werkzeugs: 0.8.0
(M0–M3, UI-Polish, D1–D4). Dieser Schritt öffnet das Werkzeug nach außen:
PNML in beide Richtungen, PNG und TikZ als Bild- und Druckformate, eine
Kommandozeile für Skripte und Experimente.

## 0. Ergebnis

- Netze lassen sich als **PNML** exportieren und importieren. Stellen/
  Transitions-Netze sind standardkonform (ISO/IEC 15909-2, PNML 2009,
  `ptnet`), alles Weitere (Typen, Inschriften, Wächter, Zeit, Rollen,
  Simulationseinstellungen, Domänenansicht) reist in `toolspecific`-Elementen
  mit und geht beim Import in andere Werkzeuge verloren, ohne sie zu stören.
  PNML aus anderen Werkzeugen (ProM, pm4py, WoPeD, das Mockup) wird robust
  gelesen.
- **PNG-Export** aus der App in 1×, 2×, 3×, hell, dunkel oder transparent.
- **TikZ-Export** als Fragment im Stil der Dissertation (Graustufen, Kreise und
  Rechtecke, Beschriftungen, Marken), einbindbar über `\inputtikz`, optional
  als eigenständiges Dokument.
- **Kommandozeile `pnm`** mit `validate`, `simulate`, `export`, `import`,
  `layout`, `domain check` und `domain generate`, als gebündelte Datei ohne
  Build-Schritt beim Nutzer.

## 1. PNML (`@pnm/io`)

### 1.1 Export (`src/pnml/write.ts`)

`toPnml(net: PetriNet, opts?: { toolspecific?: boolean /* true */; pretty?: boolean }): string`

- Wurzel `<pnml xmlns="http://www.pnml.org/version-2009/grammar/pnml">`,
  ein `<net id type="http://www.pnml.org/version-2009/grammar/ptnet">` mit
  `<name><text>`, eine `<page id="page1">`.
- Stellen: `<place id><name><text>`, `<graphics><position x y/>`,
  `<initialMarking><text>n</text>` (Anzahl der Marken; bei JSON-Netzen die
  Anzahl, die Werte gehen in `toolspecific`).
- Transitionen: `<transition id><name><text>`, `<graphics><position/>`.
- Kanten: `<arc id source target>`, `<inscription><text>weight</text>` nur
  bei Gewicht ≠ 1, `<graphics><position/>` je Stützpunkt.
- IDs: PNML verlangt XML-`ID` (Buchstabe oder `_` am Anfang, keine
  Leerzeichen). Unsere IDs werden präfixiert (`n_` + ID) und beim Import
  zurückgeführt; die Zuordnung steht in `toolspecific`.
- `toolspecific tool="pnm" version="1"`: auf Netzebene `profile`, `types`,
  `simulation`, `domainView`, `domainViewGeneration`, Originalname; je
  Stelle `type`, `capacity`, `role`, `tokens` (JSON-Werte); je Transition
  `guard`, `timing`, `priority`, `rate`; je Kante `inscription`. Inhalte als
  JSON in CDATA, damit kein XML-Escaping nötig ist.
- XML-Escaping für alle Texte, deterministische Reihenfolge, 2 Leerzeichen.

### 1.2 Import (`src/pnml/read.ts`)

`fromPnml(xml: string, opts?: { layout?: 'keep' | 'auto' }): { net: PetriNet; warnings: string[] }`

- Parser: im Browser `DOMParser`, in Node ein kleiner eigener XML-Parser
  (kein npm-Paket) oder `DOMParser` aus `jsdom`-freier Implementierung.
  Entscheidung: eigener, minimaler, aber robuster Parser für das PNML-
  Subset (Elemente, Attribute, Text, CDATA, Kommentare, Namensräume werden
  ignoriert), mit Tests. Er wird in beiden Umgebungen genutzt, damit das
  Verhalten identisch ist.
- Akzeptiert `ptnet`, `pnmlcoremodel` und unbekannte Typen (mit Warnung),
  mehrere Seiten (werden zusammengeführt), fehlende `graphics` (dann Layout
  über `@pnm/layout`, Richtung RIGHT), `initialMarking` als Zahl oder
  Text mit Zahl, `inscription` als Zahl, Namen ohne `<text>`, Referenzstellen
  und -transitionen (`referencePlace`, `referenceTransition` werden
  aufgelöst), Inhibitor- und Reset-Kanten (Warnung, als normale Kante mit
  Hinweis in `annotations`).
- `toolspecific tool="pnm"` wird vollständig zurückgelesen, fremde
  `toolspecific` ignoriert. Ohne unsere Erweiterung entsteht ein `pt-net`.
- Ergebnis wird mit `validate()` geprüft, Diagnosen werden als Warnungen
  angehängt, der Import schlägt nur bei nicht parsbarem XML oder fehlendem
  `<net>` fehl.

### 1.3 Tests

- Roundtrip-Property-Test (fast-check): zufällige P/T-Netze → PNML → Netz
  strukturgleich (IDs, Namen, Markierung, Gewichte, Positionen).
- Roundtrip aller `examples/` einschließlich JSON-Netze, Zeit und
  Domänenansicht (über `toolspecific`), strukturgleich.
- Import-Fixtures unter `packages/io/test/fixtures/pnml/`: das
  `SAMPLE_PNML` aus dem Mockup, ein ProM-ähnliches Netz (mit `page`,
  `graphics`, `toolspecific` eines fremden Werkzeugs), ein pm4py-Export
  (ohne Graphics, mit `initialMarking`-Text), ein WoPeD-Export (mit
  `referencePlace`), eine Datei mit zwei Seiten, eine fehlerhafte Datei.
  Jeweils erwartete Stellen- und Transitionszahl, Warnungen und ob ein
  Layout nötig war.
- Export ist wohlgeformt (eigener Parser liest ihn), IDs sind gültige
  XML-IDs, und ein Export ohne `toolspecific` enthält keine `pnm`-Reste.

## 2. PNG-Export (`apps/web`)

- `exportPng(net, opts: { scale: 1|2|3; theme: 'light'|'dark'; background: 'theme'|'transparent'; padding })`: nutzt den vorhandenen SVG-Export, rastert
  ihn über `Image` und `canvas` (mit `devicePixelRatio` unabhängig vom
  Bildschirm), liefert `Blob`. Schriften: Inter und JetBrains Mono werden als
  `@font-face` mit Data-URL in das SVG eingebettet, damit die Rasterung die
  richtigen Schriften hat (Fonts liegen gebündelt vor).
- Dialog „Export image": Format SVG oder PNG, Maßstab, Thema, Hintergrund,
  Vorschau, Dateiname. Ersetzt den bisherigen direkten SVG-Export im Menü
  (Kürzel bleibt).
- Auch die Domänenansicht bekommt „Export image" (PNG direkt vom Canvas mit
  Maßstab, da sie kein SVG hat), im Kontextmenü der Ansicht und im Panel.
- Test: Vitest mit gemocktem Canvas prüft Parameter und Blob-Typ; Playwright
  lädt eine PNG herunter und prüft Signatur und Größe (Breite ≈ Maßstab ×
  SVG-Breite).

## 3. TikZ-Export (`@pnm/io`)

`toTikz(net: PetriNet, opts?: TikzOptions): string`

```ts
interface TikzOptions {
  standalone?: boolean;        // mit \documentclass{standalone} und Präambel, Vorgabe false (Fragment)
  scale?: number;              // Pixel → cm, Vorgabe 0.02 (50 px = 1 cm)
  labels?: 'names' | 'ids' | 'none';
  inscriptions?: boolean;      // Wächter, Inschriften, Gewichte, Vorgabe true
  tokens?: 'dots' | 'count' | 'none';   // bis 5 Punkte, sonst Zahl
  styles?: 'inline' | 'external';       // inline: \tikzset im Fragment; external: nutzt place/transition/arc-Styles aus grundlagen_styles.tex
  grayscale?: boolean;         // Vorgabe true
}
```
- Knoten als `\node[place] (id) at (x,y) {};` mit Label darunter
  (`label=below:{Name}`), Transitionen `\node[transition]`, Marken als
  Punkte in Kreisanordnung (wie im Editor) oder als Zahl, Kanten
  `\draw[arc] (a) -- (b)` bzw. `to[bend left=…]` für Gegenläufe, Stützpunkte
  als `-- (x,y) --`, Gewichte und Inschriften als `node[midway, above,
  font=\scriptsize]`. Wächter über der Transition in eckigen Klammern.
- LaTeX-Escaping für `& % $ # _ { } ~ ^ \`, Inschriften in `\texttt{}` mit
  `\detokenize`, Umlaute bleiben (UTF-8).
- Styles: `place/.style={circle,draw,minimum size=8mm,inner sep=0}`,
  `transition/.style={rectangle,draw,minimum width=4mm,minimum height=8mm}`,
  `arc/.style={->,>=stealth}`, `token/.style={circle,fill,inner sep=1.2pt}`,
  Graustufen. Im Modus `external` werden keine Styles ausgegeben, die
  Namen passen zu den Konventionen in `grundlagen_styles.tex` der
  Dissertation (`place`, `transition`, `arc`, `token`).
- y-Achse gespiegelt (Editor zählt nach unten, TikZ nach oben).
- Tests: Snapshot für Erzeuger/Verbraucher und Bestellbeispiel, Escaping,
  Optionen, keine unbalancierten Klammern (Zähltest). Im Container ist kein
  TeX installiert; das Standalone-Dokument wird mit einem strukturellen Test
  geprüft (Präambel, Umgebung, Ende). Hinweis in der Doku: `latexmk -pdf`
  zum Prüfen.
- App: im Export-Dialog Format TikZ mit den Optionen, Vorschau als Text,
  Kopieren und Herunterladen (`.tex`).

## 4. Kommandozeile (`apps/cli`)

- Paket `@pnm/cli`, Binary `pnm`, gebaut mit `esbuild` (bereits über Vite
  vorhanden, als devDependency) zu einer einzigen ESM-Datei `dist/pnm.js`
  mit Shebang, Node 22. Argumentparser: `node:util` `parseArgs`, keine
  Laufzeitabhängigkeit außer den Workspace-Paketen (gebündelt).
- Befehle (Exit-Code 0 bei Erfolg, 1 bei Fehlern, 2 bei Bedienfehlern):
  - `pnm validate <net.pn.json|net.pnml> [--json]`: Diagnosen (Kern und,
    wenn vorhanden, Domänenansicht), Tabelle oder JSON.
  - `pnm simulate <net> --seconds 7200 [--seed 1] [--rate t_id=300] [--csv out.csv] [--xes out.xes] [--metrics out.json] [--events out.jsonl] [--quiet]`:
    läuft die Engine, schreibt Exporte, gibt Kennzahlen aus.
  - `pnm export <net> --format svg|png|pnml|tikz|json [-o out] [Optionen je Format]`:
    PNG in Node über die SVG-Rasterung ist ohne Browser nicht möglich; `png`
    gibt deshalb eine klare Fehlermeldung mit Hinweis auf die App (oder wird
    weggelassen, wenn kein reiner Node-Weg ohne neue Abhängigkeit existiert;
    Entscheidung dokumentieren).
  - `pnm import <file.pnml> [-o net.pn.json] [--layout auto|keep]`.
  - `pnm layout <net> [-o out] [--direction RIGHT|DOWN]`.
  - `pnm domain check <net>`: Prüfung V1–V8; `pnm domain generic <net> [-o]`;
    `pnm domain generate <net> --description "…" [--base-url] [--model] [--api-key | PNM_LLM_API_KEY] [-o]` (nutzt `@pnm/llm`).
  - `pnm examples list|copy <name> [dir]`.
  - `pnm --help`, `pnm <cmd> --help`, `pnm --version`.
- Ausgabe: knappe Tabellen ohne Farben, wenn `stdout` kein TTY ist.
- Tests: Integrationstests, die das gebündelte Binary mit `node dist/pnm.js`
  auf den Beispielen ausführen (validate, simulate mit CSV, export svg/
  pnml/tikz/json, import des Mockup-PNML, layout, domain check, Fehlerfälle
  mit Exit-Codes). `pnpm --filter @pnm/cli build` läuft im Root-Build mit.

## 5. App-Menü

- File ▸ Import… (akzeptiert `.pn.json` und `.pnml`, Drag-and-drop ebenso),
  File ▸ Export ▸ Image (SVG/PNG), PNML, TikZ, JSON. Import-Warnungen
  erscheinen als Dialog mit Liste. Beim PNML-Import ohne Graphics wird das
  Layout automatisch berechnet und ein Hinweis gezeigt.

## 6. Dokumentation und Pflege

- `docs/format.md`: Abschnitt PNML (Abbildung, `toolspecific`, Grenzen).
- `docs/cli.md` (neu): alle Befehle mit Beispielen.
- `docs/tikz.md` (neu): Optionen, Einbindung mit `\inputtikz`, externe Styles.
- `docs/adr/0012-interchange-and-cli.md`: eigener XML-Parser, `toolspecific`
  als JSON in CDATA, esbuild-Bündel ohne Laufzeitabhängigkeiten, PNG nur im
  Browser.
- README: Status 0.9.0, Abschnitte Import/Export und CLI.
- CHANGELOG 0.9.0.
- **Pflege:** der End-to-End-Test „an unbound variable in an output
  inscription is reported" (`higher-nets.spec.ts`) ist unter Last
  zeitkritisch (Warnung erscheint nach Debounce der Inschriftenprüfung).
  Robust machen: nach dem Tippen auf die Warnung mit längerem Timeout
  warten oder das Feld verlassen, bevor geprüft wird.

## 7. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei (Build schließt das CLI-Bündel ein).
2. Playwright (alt und neu) läuft lokal; Web-Suite dreimal unter Last stabil.
3. Roundtrip-Property-Test und Roundtrip aller Beispiele über PNML bestehen.
4. Alle PNML-Fixtures importieren mit den erwarteten Zahlen und Warnungen.
5. `node apps/cli/dist/pnm.js simulate examples/parcel-center.pn.json --seconds 7200 --csv out.csv` erzeugt dieselbe CSV wie die App bei gleichem Seed (Test).
6. TikZ-Snapshots bestehen; Standalone-Dokument strukturell gültig.
7. PNG-Download in Playwright hat die erwartete Größe.
8. Dokumentation vollständig, keine Lint-Warnungen, kein `any` ohne Begründung, keine `console.log` außerhalb von `scripts/` und `apps/cli/src` (dort ist Ausgabe der Zweck; Lint-Ausnahme eng fassen).
9. Thematische Commits, gepusht.

## 8. Reihenfolge

1. XML-Parser, PNML-Export und -Import mit Tests und Fixtures.
2. TikZ-Export mit Tests.
3. CLI mit Build und Integrationstests.
4. App: Import, Export-Dialog mit SVG/PNG/PNML/TikZ/JSON, PNG-Rasterung, Domänen-PNG.
5. Pflege des zeitkritischen Tests, Playwright für Import und Exporte.
6. Doku, ADR, README, CHANGELOG.
