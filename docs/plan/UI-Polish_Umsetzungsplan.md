# Umsetzungsplan UI-Polish: Bedienung und Erscheinungsbild

Stand: 2026-10-28 · Grundlage: `docs/plan/UI_Verbesserungen.md` (Befund und
Vorschläge). Dieser Schritt setzt **Phase A vollständig (A1 bis A10)** und
**Phase B teilweise (B1 bis B6)** um. B7 bis B12 und Phase C folgen später.
Der Schritt verändert keine Semantik im Kern und kein Dateiformat.

## 0. Ergebnis

Der Editor fühlt sich wie ein modernes Diagrammwerkzeug an: Kanten lassen sich
treffen, alles hat Tooltips mit Kürzeln, Umbenennen geht per Doppelklick,
Rechtsklick öffnet ein Kontextmenü, Werkzeuge lassen sich halten, Kanten lassen
sich direkt vom Knoten ziehen, Tab baut eine Sequenz weiter, Hinweise und Toasts
stören nicht mehr. Das Netz ist in jeder Zoomstufe lesbar, Knoten, Marken,
Kanten und Wächter sind klar und ruhig gestaltet, die Typografie ist einheitlich.

## 1. Rahmen

- Kein neues Framework. Bestehende Komponenten (`components/ui`) erweitern.
  Für Tooltip, Kontextmenü und Popover darf `@radix-ui/react-tooltip`,
  `@radix-ui/react-context-menu` und `@radix-ui/react-popover` (oder das
  gebündelte `radix-ui`) eingeführt werden, sonst nichts Neues.
- Webfonts selbst hosten (`@fontsource-variable/inter`,
  `@fontsource-variable/jetbrains-mono`), kein Laden von externen Hosts.
- Alle Animationen über CSS-Transitions, maximal 150 ms, und abgeschaltet
  bei `prefers-reduced-motion`.
- Die Playwright-Tests müssen weiter laufen. Wo sich Selektoren oder Abläufe
  ändern (Banner entfällt, Handles unsichtbar, Toasts anders), Tests anpassen,
  nicht löschen. Neue Interaktionen bekommen eigene Tests.
- Tastaturkürzel-Dialog und `docs/`-Beschreibungen aktualisieren.

## 2. Phase A: Bedienung

### A1 Kanten treffen
- `interactionWidth={20}` an allen Kanten. Hover: Strichstärke 2,5 px und
  Akzentfarbe, Cursor `pointer`. Auswahl wie bisher, aber mit derselben
  Hervorhebung.
- Test: Klick 6 px neben die Kantenlinie wählt die Kante aus.

### A2 Tooltips
- Komponente `Tooltip` (Radix) mit 400 ms Verzögerung, Pfeil, 12 px Schrift,
  Kürzel rechts in einer `kbd`-Pille. In Werkzeugleiste, Kopfzeile (Undo, Redo,
  Auto layout, Validate, Theme, Help, Edit/Simulate), Zoom-Controls, Icon-
  Buttons in Panels (Typen, Marken), Minimap-Umschalter.
- `aria-label` bleibt, Tooltip-Inhalt ist zusätzlich.

### A3 Inline-Umbenennen
- Doppelklick auf Stelle, Transition oder Notiz und Taste F2 (bei genau einem
  ausgewählten Knoten) öffnen ein Eingabefeld an der Stelle des Labels.
  Enter bestätigt, Esc verwirft, Klick außerhalb bestätigt. Undo-fähig.
- Doppelklick auf eine Kante: im P/T-Profil ein Zahlenfeld für das Gewicht,
  im JSON-Profil ein einzeiliges Inschriftenfeld (bestehende
  `InscriptionField`-Komponente), positioniert am Kantenlabel.
- Doppelklick auf eine Stelle im Simulationsmodus macht nichts.

### A4 Kontextmenü
- Radix ContextMenu. Einträge mit Icon und Kürzel.
- Knoten (Stelle): Rename, Add token, Remove token, Set type ▸ (Liste der
  Typen plus „None" und „New type…", nur JSON-Profil), Duplicate, Delete.
- Knoten (Transition): Rename, Edit guard (fokussiert Panel-Feld, JSON-Profil),
  Duplicate, Delete.
- Kante: Edit weight / Edit inscription (inline wie A3), Reverse direction,
  Delete.
- Canvas: Add place here, Add transition here, Add note here, Paste (wenn
  Zwischenablage gefüllt), Select all, Fit view, Auto layout ▸ (Right, Down).
- Bei Mehrfachauswahl: Align ▸, Distribute ▸, Duplicate, Delete.
- Rechtsklick wählt das Element aus, falls es nicht Teil der Auswahl ist.

### A5 Werkzeuge halten
- Doppelklick auf ein Werkzeug in der Leiste macht es klebrig (kleiner Punkt
  unten rechts am Icon, Tooltip „Sticky · double-click to toggle"). Es bleibt
  aktiv, bis Esc oder V gedrückt oder ein anderes Werkzeug gewählt wird.
- Shift-Verhalten aus M1 bleibt.

### A6 Kanten direkt ziehen
- React-Flow-Handles unsichtbar (0 px, `opacity: 0`), aber funktional über
  einen Ring: beim Hover erscheint ein 6 px breiter Ring um die Knotenform
  (Akzentfarbe, 40 % Deckung). Ziehen vom Ring startet eine Verbindung,
  Ziehen aus dem Inneren verschiebt den Knoten. Umsetzung: ein
  `source`-Handle als ringförmiges Element über dem Knotenrand, Knoten-Inneres
  bleibt Drag-Fläche.
- Alt+Ziehen von irgendwo auf dem Knoten startet ebenfalls eine Verbindung.
- Ziel-Handle: ganzer Knoten (`target`-Handle über die volle Fläche, nur
  während einer laufenden Verbindung aktiv). Ungültige Ziele (gleiche
  Knotenart) werden rot umrandet, Verbindung wird nicht angelegt.
- Das Kantenwerkzeug (A) bleibt erhalten.

### A7 Schnelles Weiterbauen
- Bei genau einem ausgewählten Knoten erzeugt Tab einen Folgeknoten der
  anderen Art 160 px rechts (bei Kollision darunter versetzt), verbindet ihn
  mit einer Kante, wählt ihn aus und öffnet das Inline-Umbenennen. Shift+Tab
  erzeugt den Vorgänger links mit Kante in Gegenrichtung.
- Enter im Inline-Feld bestätigt, erneutes Tab setzt die Kette fort. Alles
  ist ein Undo-Schritt pro Knoten.
- Im Simulationsmodus deaktiviert.

### A8 Hinweise und Toasts
- Banner über dem Canvas entfernen. Hinweis zum aktiven Werkzeug steht in der
  Statusleiste (links neben den Diagnosen), nur wenn ein Werkzeug außer
  Select aktiv ist oder eine Kante im Entstehen ist.
- Toasts: Position unten rechts, 2,5 s, höchstens einer sichtbar (neuer
  ersetzt alten). Nur für: Saved, SVG exported, Autosave restored, Fehler
  (bleiben 6 s). Keine Toasts für Example opened, New net, Layout applied.

### A9 Ansicht
- `fitView` nach Laden (bereits) und bei Fenstergröße-Änderung (debounced
  200 ms, nur wenn der Nutzer nicht manuell gezoomt hat seit dem letzten Fit).
- Scrollrad verschiebt den Canvas, Strg/Cmd+Scrollrad und Pinch zoomen
  (`panOnScroll`, `zoomOnScroll={false}`, `zoomActivationKeyCode`). Option in
  View-Menü „Scroll to zoom" für Mausnutzer, in `localStorage` gemerkt.
- Zoom-Prozentanzeige in der Statusleiste ist ein Button: Klick setzt 100 %,
  Tooltip „Reset zoom · Ctrl+0". Strg+0 ebenfalls. Doppelklick auf leeren
  Canvas: Fit view.
- `minZoom` 0,15, `maxZoom` 3.

### A10 Löschen
- Delete-Button aus dem Panel-Körper entfernen. Stattdessen Icon-Button
  (Papierkorb) im Abschnittskopf des Panels rechts neben der Überschrift mit
  Tooltip „Delete · Del". Bestätigungsdialog nur ab fünf ausgewählten
  Elementen.

## 3. Phase B: Erscheinungsbild (B1 bis B6)

### B1 Typografie
- Inter Variable für die Oberfläche, JetBrains Mono Variable für Ausdrücke,
  Marken und Code. `--font-sans`, `--font-mono` in `index.css`.
- Panels 13 px Basis, Beschriftungen 12 px, Abschnittsüberschriften 11 px
  Kapitälchen (bleibt). Eingabefelder 13 px, Monospace-Felder 12,5 px.
- Canvas: Namen 13 px, Detail-Labels 11 px, Wächter 11 px Monospace.

### B2 Semantischer Zoom
- Zoomstufe aus `useStore` von React Flow lesen (`s.transform[2]`) und als
  CSS-Klasse am Canvas setzen: `zoom-detail` (≥ 0,7), `zoom-mid` (0,4 bis
  0,7), `zoom-far` (< 0,4).
- `zoom-mid`: Typ-Badge, Markenchips, Inschriften und Wächter ausgeblendet,
  Namen bleiben. `zoom-far`: auch Namen ausgeblendet. Übergang mit 120 ms
  Opacity.
- Hover-Karte: beim Hover über einen Knoten (300 ms Verzögerung) erscheint
  ein Popover mit Name, Typ, allen Marken (bis 10, dann „+n"), bei
  Transitionen mit Wächter und gebundenen Variablen. Zoomunabhängig, im
  Simulationsmodus zusätzlich mit Bindungsanzahl.

### B3 Knoten
- Stelle Ø 44 px, Transition 44 × 64 px (hochkant), Strichstärke 1,75 px,
  Ecken 3 px. Rastermaß bleibt 20 px.
- Auswahl: Ring 3 px in `--accent-soft` plus 1,75 px Akzentkontur, keine
  sichtbaren Handles (siehe A6). Hover: Schatten `0 2px 8px rgb(0 0 0 / 0.12)`.
- Aktiviert (Simulation): Füllung `--ok-soft`, Kontur `--ok`, sanfter Puls
  der Kontur (1,2 s, nur bei `prefers-reduced-motion: no-preference`).
- Fehler aus Diagnosen: Kontur `--danger`, kleines Warn-Icon oben rechts.
- Neue Knoten erscheinen mit Skalierung 0,9 → 1 in 120 ms.
- Bestehende Beispiele prüfen: Positionen und Abstände müssen mit den neuen
  Größen weiterhin sauber aussehen, nötigenfalls Beispiele anpassen.

### B4 Marken
- P/T-Profil: bis sechs Marken als Punkte (Ø 6 px) in Kreisanordnung (1 mittig,
  2 horizontal, 3 Dreieck, 4 Quadrat, 5 und 6 Ring), ab sieben eine Zahl.
- JSON-Profil: Zahl zentriert im Kreis (14 px, halbfett). Markenchips nicht
  mehr dauerhaft unter dem Knoten. Stattdessen in der Hover-Karte (B2) und
  im Panel. Bei Auswahl einer Stelle erscheinen die Chips in einer Karte
  rechts neben dem Knoten (bis 5, dann „+n"), nur in `zoom-detail`.
- Typ als Badge: 10 px Kapitälchen in einer Pille am oberen rechten Rand der
  Stelle (`--surface-2`, `--border`), nicht als kursive Zeile unter dem Namen.
  Unter dem Knoten steht nur der Name.

### B5 Kanten
- Pfad: quadratische Kurve mit Kontrollpunkt senkrecht zur Verbindungslinie,
  Ausbuchtung 0 bei kurzen Kanten bis 24 px bei langen. Gegenläufige Kanten
  zwischen denselben Knoten werden automatisch nach links und rechts versetzt.
  Schleifen (Vor- und Nachbereich gleich) als Bogen.
- Pfeilspitze 8 px, gefüllt, endet exakt am Knotenrand (Kreis bzw. Rechteck,
  bereits vorhanden, auf neue Größen anpassen).
- Label (Gewicht ≠ 1 oder Inschrift) als Pille mittig auf der Kante:
  Hintergrund `--canvas` mit 1 px `--border`, 11 px, Monospace für
  Inschriften, bei Hover der Kante in Akzentfarbe. Inschriften auf 24 Zeichen
  kürzen, voller Text als Tooltip.
- SVG-Export muss die neuen Pfade und Pillen abbilden.

### B6 Wächter
- Pille über der Transition, Monospace 11 px, Hintergrund wie Kantenlabel,
  eckige Klammern bleiben. Über 28 Zeichen kürzen, voller Text als Tooltip.
  In der Hover-Karte vollständig.

## 4. Tests und Dokumentation

- Vitest: Inline-Umbenennen (Enter, Esc), Tab-Weiterbauen (Richtung,
  Verbindung, Undo), klebrige Werkzeuge, Toast-Ersetzung, Zoom-Klassen,
  Kantenpfad-Geometrie (Versatz bei Gegenrichtung).
- Playwright: Kante neben der Linie anklicken, Doppelklick umbenennen,
  Kontextmenü Delete, Kante vom Ring ziehen, Tab-Kette aus drei Knoten,
  Tooltip erscheint beim Hover, Zoom unter 0,7 blendet Details aus.
  Bestehende Tests anpassen.
- `docs/`: Tastaturkürzel-Dialog erweitern (F2, Tab, Shift+Tab, Strg+0,
  Alt+Ziehen, Doppelklick auf Werkzeug), README-Screenshots neu erzeugen
  (hell und dunkel, ein P/T-Netz und ein JSON-Netz), CHANGELOG 0.3.0.
- ADR 0006: Radix-Primitives und selbst gehostete Fonts.

## 5. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei.
2. Alle Playwright-Tests (alt und neu) laufen lokal.
3. Alle sieben Beispiele sehen in `zoom-detail`, `zoom-mid` und `zoom-far` sauber aus, in Hell- und Dunkelmodus, bei 1280 px und 1920 px Breite. Screenshots davon unter `docs/images/` ablegen.
4. Ein Netz aus fünf Knoten lässt sich ohne Maus nur mit P, Tab, Enter und Eingaben bauen.
5. Keine Regression in Simulation und Bindungsauswahl.
6. Thematische Commits, gepusht.

## 6. Reihenfolge

1. Fonts, Typografie, Design-Tokens (B1).
2. Knoten, Marken, Typ-Badge, Auswahlring, unsichtbare Handles mit Ring (B3, B4, A6).
3. Kanten: Pfade, Pillen, Trefferfläche, Hover (B5, B6, A1).
4. Semantischer Zoom und Hover-Karte (B2).
5. Tooltips, Kontextmenü, Inline-Umbenennen, F2 (A2, A3, A4).
6. Klebrige Werkzeuge, Tab-Weiterbauen (A5, A7).
7. Banner, Toasts, Statusleiste, Ansicht, Delete (A8, A9, A10).
8. Tests, Screenshots, Doku, ADR, CHANGELOG.
