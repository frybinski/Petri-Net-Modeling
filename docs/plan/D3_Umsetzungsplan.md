# Umsetzungsplan D3: Erzeugung der Abbildung durch ein LLM

Stand: 2026-10-28 · Grundlage: Feature-Auftrag „Domänenansicht" (Abschnitt
„Erzeugung der Abbildung durch das LLM"), `docs/plan/Domaenenansicht_Einordnung.md`,
D1 (`@pnm/domain`: Schema, JSON Schema, Prüfung, `fillMissing`) und D2.
Stand des Werkzeugs: 0.6.0.

## 0. Ergebnis

Aus dem Netz und einer kurzen Beschreibung der Domäne erzeugt ein LLM einmalig
vor der Simulation eine Abbildung nach dem Schema. Die Prüfung aus D1
entscheidet, ob sie verwendet wird; Befunde gehen bis zu dreimal als
Reparaturauftrag zurück, der Rest wird generisch aufgefüllt. Jeder Eintrag
trägt seine Herkunft. Während der Simulation ist kein LLM beteiligt. Der
Anbieter ist eine OpenAI-kompatible Schnittstelle (lokal über Ollama oder LM
Studio, oder ein Cloud-Dienst), konfiguriert im Browser. Das ist die
neuro-symbolische Arbeitsteilung der Dissertation in Reinform: Das LLM schlägt
vor, die formale Prüfung entscheidet, das Netz bestimmt das Verhalten.

Abnahme nach Auftrag: **A6** (für Paketzentrum und Smart Office besteht die
LLM-Abbildung die Prüfung nach höchstens drei Runden mit dem konfigurierten
Modell, sonst greift das Auffüllen, beides in der Herkunftsanzeige sichtbar).
Im Entwicklungscontainer steht kein Modell zur Verfügung. A6 wird deshalb
zweistufig erfüllt: automatisch mit einem simulierten Anbieter in Tests und
manuell durch Fabian mit einem echten Modell über das Prüfskript (Abschnitt 5).

## 1. Paket `@pnm/llm` (neu)

Keine React-Abhängigkeit, nur `fetch` (Browser und Node 22). Abhängigkeiten:
`@pnm/core`, `@pnm/domain`, `zod`.

### 1.1 Anbieter (`src/provider.ts`)

```ts
export interface ProviderConfig { baseUrl: string; model: string; apiKey?: string; temperature?: number /* 0.2 */; timeoutMs?: number /* 120000 */; jsonMode?: 'auto' | 'schema' | 'object' | 'none' }
export interface ChatRequest { system: string; user: string; schema?: unknown; signal?: AbortSignal }
export interface ChatResult { text: string; json?: unknown; model: string; usage?: { prompt: number; completion: number }; mode: 'schema' | 'object' | 'none' }
export function createProvider(config: ProviderConfig): { chat(req: ChatRequest): Promise<ChatResult>; listModels(): Promise<string[]>; test(): Promise<{ ok: boolean; message: string }> }
```
- Ruft `POST {baseUrl}/chat/completions` auf. `jsonMode: 'auto'` versucht
  zuerst `response_format: { type: 'json_schema', json_schema: {...strict} }`,
  bei Ablehnung (HTTP 400 oder Fehlermeldung zu `response_format`)
  `{ type: 'json_object' }`, dann ohne. Der gewählte Modus wird gemerkt
  (pro Sitzung) und im Ergebnis gemeldet.
- `parseJsonLoose(text)`: nimmt reines JSON, JSON in einem Codeblock oder
  das erste vollständige JSON-Objekt im Text. Fehler werden als
  `LlmError` mit Art (`network`, `auth`, `rate-limit`, `timeout`,
  `bad-response`, `parse`) geliefert.
- Keine Schlüssel im Code, keine Protokollierung des Schlüssels.

### 1.2 Prompt (`src/prompt.ts`)

```ts
export function compactNet(net: PetriNet): CompactNet   // Stellen {id, name, tokens, role}, Transitionen {id, name, role, timing?}, Kanten [source, target], Positionen (optional, auf 0..1 normiert)
export function buildPrompt(input: { net: PetriNet; description: string; canvas: { width: number; height: number }; examples: DomainView[]; schema: unknown }): { system: string; user: string }
export function buildRepairPrompt(input: { previous: DomainView; diagnostics: DomainDiagnostic[]; net: CompactNet }): { system: string; user: string }
```
- Systemtext: Rolle („Du bildest ein Petri-Netz auf eine Domänenansicht ab"),
  die Regeln in Kurzform (jede Stelle und Transition genau einmal, Ressourcen
  als `slots` oder `pool`, Quell-Transitionen als `door` oder `dock`, Senken als
  `sink`, nur Geometrie und Beschriftung, keine Zeiten, Gewichte oder
  Bedingungen, alle Koordinaten im Canvas, `netHash` und `provenance` nicht
  erzeugen), Ausgabe nur JSON.
- Nutzertext: Domänenbeschreibung, Canvas-Größe, das kompakte Netz, das
  JSON Schema (aus `domainViewJsonSchema()`, ohne `netHash` und `provenance`,
  die das Werkzeug setzt), zwei Beispiele (Paketzentrum und Smart Office aus
  den `examples/`, auf das Wesentliche gekürzt: ohne `provenance`, Dekor auf
  höchstens 8 Einträge).
- Reparaturtext: die Befunde als Liste (Regel, Pfad, Text), Aufforderung, nur
  die betroffenen Einträge als Teilobjekt zurückzugeben
  (`{ "places": {...}, "transitions": {...}, "arcs": {...}, "decor": [...] }`).
- Sprache der Prompts: Englisch (robuster über Modelle hinweg), die
  Beschriftungen (`label`) sollen die Sprache der Netznamen übernehmen.

### 1.3 Erzeugung mit Reparaturschleife (`src/generate.ts`)

```ts
export interface GenerateOptions { description: string; canvas?; maxRounds?: number /* 3 */; onProgress?: (p: GenerateProgress) => void; signal?: AbortSignal }
export interface GenerateProgress { round: number; phase: 'prompt' | 'waiting' | 'validating' | 'repairing' | 'filling' | 'done'; diagnostics?: DomainDiagnostic[] }
export interface GenerateResult { view: DomainView; rounds: RoundLog[]; filled: string[] /* Pfade, die generisch aufgefüllt wurden */; dropped: string[] /* ungültige Einträge, die verworfen wurden */; model: string; startedAt: string; finishedAt: string }
export interface RoundLog { round: number; mode; usage?; diagnostics: DomainDiagnostic[]; durationMs: number }
export async function generateDomainView(net, provider, options): Promise<GenerateResult>
```
Ablauf:
1. Prompt bauen, Anfrage mit Temperatur 0,2.
2. Antwort parsen, `netHash` und `provenance` vom Werkzeug setzen
   (Herkunft `llm` mit Modell und Zeitpunkt), prüfen.
3. Bei Fehlern (Stufe Fehler): Reparaturprompt mit den Befunden, Teilobjekt
   einmischen (Einträge ersetzen, Herkunft `llm`), erneut prüfen. Höchstens
   `maxRounds` Runden insgesamt.
4. Danach: gültige Einträge übernehmen, weiterhin ungültige Einträge
   verwerfen (`dropped`) und mit `fillMissing` generisch auffüllen
   (`filled`). Warnungen (V6, V8) blockieren nicht.
5. Ergebnis mit Rundenprotokoll zurückgeben. Die Funktion wirft nur bei
   Anbieterfehlern in Runde 1; spätere Anbieterfehler beenden die Schleife
   und führen zum Auffüllen mit Hinweis.

Der Aufruf verändert den Simulator nicht und wird nie während eines Laufs
ausgelöst (die Oberfläche sperrt die Aktion im Simulationsmodus).

### 1.4 Simulierter Anbieter für Tests (`src/testing/fake-provider.ts`)

`createFakeProvider(script)`: liefert vorgegebene Antworten je Runde
(gültig, mit Fehlern, mit Teilreparatur, kaputtes JSON, Zeitüberschreitung).
Damit laufen alle Tests ohne Netz.

### 1.5 Speicherung

Die Abbildung selbst bleibt strikt (keine Zusatzfelder). Prompt, Modell,
Zeitpunkt und Rundenprotokoll kommen in ein neues optionales Netzfeld
`domainViewGeneration?: { model; baseUrl; startedAt; finishedAt; description; prompt: { system; user }; rounds: RoundLog[]; filled: string[]; dropped: string[] }`
(Kern reicht es als `unknown` durch, `@pnm/llm` definiert das Schema). Der
API-Schlüssel wird nie gespeichert.

### 1.6 Tests

- Anbieter: `json_schema` akzeptiert; Ablehnung → `json_object` → ohne;
  Codeblock-Antwort; Text mit eingebettetem JSON; HTTP 401/429/500; Timeout;
  Abbruch. Alles mit gemocktem `fetch`.
- Prompt: kompaktes Netz für Paketzentrum (Rollen stimmen), Beispiele
  gekürzt, Schema ohne `netHash`/`provenance`, Snapshot-Test des Systemtexts.
- Erzeugung: gültig in Runde 1; V4-Fehler in Runde 1, Reparatur in Runde 2;
  drei Runden ohne Erfolg → Auffüllen mit `filled` und `dropped` belegt;
  Teilobjekt überschreibt nur genannte Einträge; Anbieterfehler in Runde 2
  → Auffüllen mit Hinweis; Herkunft `llm` mit Modell an jedem Eintrag;
  Determinismus des Ergebnisses bei gleichem Skript.
- A6 mit simuliertem Anbieter: Paketzentrum und Smart Office, der Fake
  liefert die Beispielabbildung mit zwei absichtlichen Fehlern, Reparatur in
  Runde 2 ergibt null Fehler.

## 2. App `@pnm/web`

### 2.1 Einstellungen „LLM provider"

Dialog (über Kopfzeile → Zahnrad oder im Domain-Panel): Voreinstellungen
„Ollama (local)" (`http://localhost:11434/v1`, Modell frei),
„LM Studio (local)" (`http://localhost:1234/v1`), „OpenAI-compatible (custom)";
Felder Base URL, Model (mit „Load models"), API key (Passwortfeld, Hinweis:
wird nur im Browser gespeichert), Temperature, JSON mode (auto/schema/object/
none), „Test connection". Speicherung in `localStorage`, Schlüssel getrennt
und mit Hinweis. Ollama-Hinweis zu `OLLAMA_ORIGINS` im Dialog.

### 2.2 Dialog „Generate domain view with LLM"

- Felder: Domänenbeschreibung (Textarea, vorbelegt mit Netzname, Beispiele
  als Platzhalter: „Paketzentrum, Halle 2, drei Verladetore"), Canvas-Größe,
  Anbieter (aus Einstellungen, Link zum Ändern).
- Fortschritt: Schrittliste (Prompt → Waiting (Runde 1/3) → Validating (n
  Fehler, m Warnungen) → Repairing → Filling → Done) mit Dauer, Abbrechen.
- Ergebnis: Vorschau der Abbildung (statisches Rendering aus D1 in klein),
  Zusammenfassung (Einträge je Herkunft, aufgefüllt, verworfen), Diagnosen,
  Rundenprotokoll aufklappbar, Prompt aufklappbar (System und Nutzer,
  Kopieren-Button). Buttons „Use this view" (undo-fähig, ersetzt
  `domainView` und setzt `domainViewGeneration`) und „Discard".
- Bestehende Abbildung mit Herkunft `user`: Hinweis, dass sie ersetzt wird.
- Im Simulationsmodus deaktiviert mit Tooltip.

### 2.3 Herkunft sichtbar

- Domain-Panel: Zähler je Herkunft (bereits), Zeile „Generated by
  <model> on <date>" mit Link auf das Protokoll, Badge am Eintrag in der
  Elementansicht. Hover-Karte zeigt `llm · <model>`.
- Statusleiste: während der Erzeugung ein Hinweis mit Runde.

### 2.4 Tests

- Unit: Einstellungen laden und speichern (Schlüssel getrennt), Dialogablauf
  mit simuliertem Anbieter (Fortschritt, Ergebnis, Übernehmen undo-fähig,
  Abbrechen), Sperre im Simulationsmodus.
- Playwright: Anbieter per `page.route` auf `/v1/chat/completions`
  simulieren (Antwort: Beispielabbildung mit einem V4-Fehler, zweite Antwort
  die Reparatur), Dialog öffnen, Beschreibung eingeben, Erzeugung starten,
  Protokoll zeigt zwei Runden, „Use this view", Panel zeigt Herkunft llm und
  null Fehler, Hover-Karte zeigt das Modell.

## 3. Prüfskript für A6 (manuell mit echtem Modell)

`apps/cli` existiert noch nicht (M4). Deshalb ein Node-Skript im Paket:
`pnpm --filter @pnm/llm eval -- --base-url http://localhost:11434/v1 --model qwen2.5:14b [--api-key …]`
Liest `examples/parcel-center.pn.json` und `examples/smart-office.pn.json`,
erzeugt je eine Abbildung mit der Beschreibung aus dem Netznamen plus einem
Satz, gibt je Runde die Befunde, am Ende Fehler, Warnungen, aufgefüllte und
verworfene Einträge und die Dauer aus, schreibt die Ergebnisse nach
`docs/eval/llm-<modell>-<datum>.md` (Tabelle) und die Abbildungen als JSON
daneben. Das Skript darf `console.log` verwenden (Lint-Ausnahme für das
Verzeichnis `scripts/`).

## 4. Dokumentation

- `docs/domain-view.md`: Abschnitt „Generating a view with an LLM" (Ablauf,
  Prompt, Reparatur, Auffüllen, Herkunft, Anbieter, Datenschutzhinweis,
  Ollama-CORS).
- `docs/adr/0010-llm-mapping-generation.md`: OpenAI-kompatible
  Schnittstelle, Aufruf aus dem Browser, Reparaturschleife mit Prüfung als
  Entscheider, Speicherung des Protokolls außerhalb der strikten Abbildung.
- README: Status 0.7.0, Absatz, Screenshot des Dialogs mit Ergebnis.
- CHANGELOG 0.7.0.

## 5. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei.
2. Playwright (alt und neu) läuft lokal.
3. A6 mit simuliertem Anbieter besteht (1.6).
4. Das Prüfskript (3.) läuft gegen einen simulierten Server (ein kleiner lokaler HTTP-Server im Test, der die Beispielabbildung liefert) fehlerfrei durch und schreibt die Dateien. Der Lauf mit echtem Modell bleibt Fabian vorbehalten und wird im CHANGELOG als „pending" vermerkt.
5. Kein API-Schlüssel erscheint in Logs, Exporten, `domainViewGeneration` oder Tests.
6. Dokumentation vollständig, keine Lint-Warnungen, kein `any` ohne Begründung, keine `console.log` außerhalb von `scripts/`.
7. Thematische Commits, gepusht.

## 6. Reihenfolge

1. `@pnm/llm`: Anbieter mit Tests.
2. Prompt und kompaktes Netz mit Tests.
3. Erzeugung mit Reparaturschleife, Fake-Anbieter, A6-Test.
4. Kern: `domainViewGeneration` durchreichen, Operation, Format-Doku.
5. Web: Einstellungen, Dialog, Fortschritt, Ergebnis, Herkunft.
6. Prüfskript und Lint-Ausnahme.
7. Tests, Playwright mit `page.route`.
8. Doku, ADR, README, CHANGELOG.
