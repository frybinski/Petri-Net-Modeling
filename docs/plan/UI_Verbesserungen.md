# Vorschläge zur Verbesserung der Oberfläche (vor M3)

Stand: 2026-10-28 · Grundlage: Durchsicht von Version 0.2.0 im Browser (leerer
Zustand, Zeichnen von Grund auf, Kantenwerkzeug, Panels, Beispiele, Simulation,
Dunkelmodus, schmales Fenster) und des Canvas-Codes.

## 1. Befund

Funktional ist der Editor vollständig, in der Bedienung hakt es an einigen
Stellen, und das Erscheinungsbild wirkt noch nach Baukasten. Die Ursachen lassen
sich klar benennen:

| Nr. | Beobachtung | Ursache im Code |
|-----|-------------|-----------------|
| B1 | Kanten sind schwer zu treffen, Klick daneben wählt nichts aus. | Kein `interactionWidth` an den Kanten, Trefferfläche ist die 1,5 px dünne Linie. |
| B2 | Werkzeugleiste und Kopfzeile haben keine Hover-Hinweise, Kürzel muss man im `?`-Dialog nachschlagen. | Keine Tooltip-Komponente, nur `aria-label`. |
| B3 | Umbenennen geht nur über das Panel. | Kein Doppelklick-Handler auf Knoten, kein F2. |
| B4 | Kein Rechtsklick-Menü. | Kein `onContextMenu`. |
| B5 | Nach jedem gesetzten Element springt das Werkzeug zurück auf Auswahl. Für drei Stellen braucht man sechs Klicks (Shift hilft, ist aber unbekannt). | Rücksprung ist fest verdrahtet. |
| B6 | Beim Hover erscheinen vier große blaue Punkte an jedem Knoten. Das wirkt technisch und verdeckt den Knoten. | React-Flow-Handles sichtbar gestylt. |
| B7 | Hinweisbanner „Select and move elements…" steht dauerhaft oben über dem Canvas. | Banner immer gerendert. |
| B8 | Toasts stapeln sich mitten über dem Canvas („Opened example …"), auch für Aktionen, deren Ergebnis ohnehin sichtbar ist. | Toast je Aktion, 4 s Dauer, Position unten-mitte. |
| B9 | Canvas-Beschriftungen sind bei Zoom unter 90 % unlesbar (Typ, Marken, Wächter, Inschriften mit 10 px). | Feste 10-px-Schriften, keine zoomabhängige Darstellung. |
| B10 | Unter einer Stelle stehen im JSON-Netz drei Zeilen (Name, Typ kursiv, Marken in lila Monospace). Das Netz wirkt unruhig. | Alle Informationen als Text unter dem Knoten. |
| B11 | Delete als roter, vollbreiter Button direkt unter den Feldern ist das auffälligste Element im Panel. | Danger-Button in Primärposition. |
| B12 | Netzname in der Kopfzeile sieht aus wie ein Suchfeld. | Mittiges Eingabefeld mit Rahmen. |
| B13 | Minimap groß, undurchsichtig, nicht einklappbar. | Standardgröße von React Flow. |
| B14 | Systemschrift, keine typografische Hierarchie zwischen Panel, Canvas und Code. | Kein Webfont, `--font-sans` auf Systemstapel. |
| B15 | Fenstergröße ändern verschiebt das Netz aus der Mitte. | Kein `fitView` bei Resize. |

## 2. Vorschläge

### Phase A: Bedienung (Quick Wins, ein Umsetzungsschritt)

A1. **Kanten treffsicher machen.** `interactionWidth` 20 px, Hover-Hervorhebung
    der Kante (dicker, Akzentfarbe), Cursor `pointer`.

A2. **Tooltips mit Kürzeln.** Eigene kleine Tooltip-Komponente (Radix Tooltip
    oder eigenes Popover, 400 ms Verzögerung, zugänglich). Überall in
    Werkzeugleiste, Kopfzeile, Zoom-Controls, Panel-Icons. Text: „Place tool · P".

A3. **Inline-Umbenennen.** Doppelklick auf Knoten oder F2 öffnet ein Eingabefeld
    direkt am Knoten. Enter bestätigt, Esc bricht ab. Doppelklick auf eine Kante
    öffnet die Inschrift bzw. das Gewicht inline.

A4. **Kontextmenü.** Rechtsklick auf Knoten: Rename, Add token, Remove token,
    Set type (Untermenü), Duplicate, Delete. Auf Kante: Edit inscription, Reverse
    direction, Delete. Auf Canvas: Add place here, Add transition here, Add note,
    Paste, Fit view, Auto layout.

A5. **Werkzeuge halten.** Doppelklick auf ein Werkzeug (oder Shift) macht es
    „klebrig", es bleibt aktiv bis Esc. Das Werkzeug zeigt den Zustand mit einem
    kleinen Punkt. Standard bleibt der Rücksprung.

A6. **Kanten direkt ziehen.** Handles unsichtbar, stattdessen erscheint beim
    Hover ein dünner Ring um den Knoten. Ziehen vom Ring startet eine Kante,
    Ziehen aus der Mitte verschiebt. Alternativ Alt+Ziehen. Das Kantenwerkzeug
    bleibt als zweiter Weg.

A7. **Schnelles Weiterbauen.** Bei ausgewähltem Knoten erzeugt Tab den passenden
    Folgeknoten (Stelle → Transition → Stelle) rechts daneben, verbunden und mit
    Fokus im Namensfeld. Enter bestätigt, Tab setzt fort. Damit lässt sich eine
    Sequenz in Sekunden tippen.

A8. **Hinweise und Toasts beruhigen.** Banner entfernen, Hinweis zum aktiven
    Werkzeug in die Statusleiste. Toasts nur für Ergebnisse, die sonst unsichtbar
    wären (gespeichert, Fehler, Autosave wiederhergestellt), 2,5 s, unten rechts,
    höchstens eine gleichzeitig. Kein Toast für „Beispiel geöffnet".

A9. **Ansicht.** `fitView` bei Resize (debounced) und nach dem Laden. Scrollen
    verschiebt, Strg/Cmd+Scrollen und Pinch zoomen (Trackpad-freundlich, wie
    Figma). Klick auf die Prozentanzeige setzt 100 %. Doppelklick auf leeren
    Canvas: Fit view.

A10. **Löschen zurücknehmen.** Delete aus dem Panel-Körper in den
    Abschnittskopf als Icon-Button (Papierkorb) verschieben, Entf-Taste ist der
    Hauptweg. Bestätigung nur bei Mehrfachauswahl ab fünf Elementen.

### Phase B: Erscheinungsbild

B1. **Typografie.** Inter (Variable Font, selbst gehostet) für die Oberfläche,
    JetBrains Mono für Ausdrücke und Marken. Panel-Basisgröße 13 px, Überschriften
    11 px Kapitälchen bleiben. Canvas-Namen 13 px, Detail-Labels 11 px.

B2. **Semantischer Zoom.** Unter 70 % Zoom werden Typ, Markenlabels, Inschriften
    und Wächter ausgeblendet, Namen bleiben. Unter 40 % werden auch Namen
    ausgeblendet, Knoten bleiben als Formen. Beim Hover eines Knotens erscheint
    unabhängig vom Zoom eine Karte mit allen Details.

B3. **Knoten.** Stelle Ø 44 px, Transition 44 × 64 px, Strichstärke 1,75 px,
    Ecken 3 px. Auswahl als weicher Ring (Akzent, 3 px Halo) statt vier Punkten.
    Hover: leichter Schatten. Aktivierte Transition: grüne Füllung mit sanftem
    Puls statt nur grünem Rahmen. Fehler: roter Ring plus kleines Warnsymbol.

B4. **Marken.** P/T-Netz: bis sechs Marken als Punkte in Kreisanordnung, darüber
    Zahl. JSON-Netz: Zahl im Kreis, Markenchips erst beim Hover oder bei Auswahl
    (Karte neben dem Knoten), nicht dauerhaft unter dem Knoten. Typ als kleines
    Badge am oberen rechten Rand der Stelle, nicht als kursive Zeile.

B5. **Kanten.** Leicht gebogene Pfade (ein Kontrollpunkt, Bogen abhängig vom
    Abstand), Gegenrichtungen automatisch versetzt. Inschrift und Gewicht als
    Pille mit Hintergrund mittig auf der Kante, damit sie über dem Raster lesbar
    sind. Pfeilspitze 8 px, gefüllt.

B6. **Wächter.** Pille über der Transition mit Monospace 11 px, eckige Klammern
    bleiben. Lange Ausdrücke auf 28 Zeichen kürzen, voller Text im Hover.

B7. **Panels.** Breite 300 px. Abschnitte als Karten mit 12 px Innenabstand,
    Felder 32 px hoch, Beschriftung links vom Feld bei kurzen Feldern (Weight,
    Capacity, Tokens) statt darüber. Aktionsleiste am Fuß des Panels. Inspector
    mit Reitern „Properties | Types | Simulation" statt gestapelter Abschnitte.

B8. **Kopfzeile.** Netzname links neben dem Logo als Titel (klickbar zum
    Umbenennen, Punkt bei ungespeichert, „Saved just now" darunter in 11 px),
    Menüs File und View daneben, Aktionen rechts. Kein mittiges Eingabefeld.

B9. **Minimap und Controls.** Minimap 160 × 100 px, halbtransparent, einklappbar
    über ein kleines Icon. Zoom-Controls mit Prozentanzeige in einer Leiste.

B10. **Leerer Zustand.** Beispiele als Kacheln mit Vorschaubild (SVG-Export
    beim Build erzeugt), darunter die drei Kernkürzel P, T, A. Kein Textblock.

B11. **Farben.** Palette beibehalten, Dunkelmodus: Knotenfüllung eine Stufe
    heller als der Canvas, Raster dezenter. Fokusringe und Auswahl mit derselben
    Akzentfarbe, Grün ausschließlich für „aktiviert", Rot ausschließlich für
    Fehler, Bernstein für Warnungen.

B12. **Mikrointeraktionen.** Neue Knoten erscheinen mit kurzer Skalierung
    (120 ms), Markenzahl wechselt mit Überblendung, Transition blitzt beim
    Schalten kurz auf (die volle Markenanimation kommt in M3). Alle Animationen
    respektieren `prefers-reduced-motion`.

### Phase C: Struktur (optional, kann mit M3 kombiniert werden)

C1. **Befehlspalette** (Strg+K) für alle Aktionen, Beispiele und Elemente nach
    Namen, mit Kürzelanzeige.

C2. **Panels ein- und ausblendbar** (Werkzeugleiste, Inspector, Minimap) mit
    Kürzeln, für Präsentationen und kleine Bildschirme.

C3. **Mehrere Netze als Reiter** im selben Fenster, Zustand in IndexedDB.

C4. **Tastaturnavigation im Canvas**: Tab wandert durch Knoten, Pfeiltasten
    verschieben, Enter öffnet Umbenennen.

## 3. Empfohlene Reihenfolge

1. Phase A komplett (A1 bis A10). Das beseitigt das „Hakelige" und ist in
   einem Umsetzungsschritt machbar.
2. Phase B als zweiter Schritt, beginnend mit B1 bis B6 (Typografie, Zoom,
   Knoten, Marken, Kanten, Wächter), da diese die Wahrnehmung des Netzes
   am stärksten prägen. B7 bis B12 danach.
3. Phase C nach Bedarf, C1 und C4 passen gut zu M3.

Jeder Schritt endet mit aktualisierten Playwright-Tests, Screenshots in der
README und einer Prüfung in Hell- und Dunkelmodus bei 1280 px und 1920 px.
