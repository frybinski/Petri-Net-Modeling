# Umsetzungsplan M6: Server am AIFB neben Ollama

Stand: 2026-10-29 · Grundlage: `PLAN.md` (M6), Gespräch mit Fabian am
29.10.2026. Stand des Werkzeugs: 1.1.0 (nach D5).

## 0. Ziel und Rahmen

Das Werkzeug läuft zusätzlich zu GitHub Pages auf dem GPU-Server des AIFB,
auf dem auch Ollama läuft, und ist **nur aus dem KIT-Netz** erreichbar. Ein
schlanker Node-Dienst liefert die Web-App aus, vermittelt LLM-Anfragen an das
lokale Ollama, bietet die Funktionen der Kommandozeile als HTTP-Schnittstelle
an und speichert Projekte mit Versionen und Freigabelinks. Die Einrichtung
erfolgt mit **Docker Compose**, Fabian hat Zugang zum Server.

Bekannte Umgebung:

| Punkt | Wert |
|-------|------|
| Server | `aifb-bis-gpu01.aifb.kit.edu` |
| Ollama | über Open WebUI unter `https://ollama-webui.aifb-bis-gpu01.aifb.kit.edu`, Zugriff mit API-Schlüssel |
| Erreichbarkeit | nur KIT-Netz (inklusive VPN) |
| Einrichtung | Docker Compose, Zugang durch Fabian |
| Veröffentlichung nach außen | Eintrag der URL im vorhandenen **Ingress** des Servers (TLS dort) |
| Image | aus der **KIT-GitLab-Container-Registry**, nicht auf dem Server gebaut |
| Repository | Entwicklung bleibt auf GitHub; `gitlab.kit.edu` **spiegelt** es (Pull-Mirror) und baut dort das Image |
| LLM-Zugang | **ein** API-Schlüssel eines eigenen Dienstkontos in Open WebUI für den Server; Nutzer brauchen keinen Schlüssel |

Grundsätze:

- **Local-first bleibt.** Die App funktioniert ohne Server unverändert (Pages,
  lokale Dateien, Browser-Worker). Erkennt sie unter der eigenen Adresse einen
  Server (`GET /api/health`), schaltet sie zusätzliche Funktionen frei.
- **Keine Geheimnisse im Browser.** LLM-Zugangsdaten liegen nur in der
  Server-Konfiguration.
- **Keine Datenbank.** Projekte liegen als Dateien in einem Volume.
- **Klein anfangen.** Echtzeit-Zusammenarbeit und Konten sind nicht Teil von M6.

## 1. Paket `apps/server` (`@pnm/server`)

### 1.1 Laufzeit

- Node 22, HTTP-Server mit dem eingebauten `node:http` und einem kleinen
  eigenen Router (keine Laufzeitabhängigkeit außer den Workspace-Paketen),
  gebündelt mit esbuild wie die CLI zu `dist/server.js`.
- Konfiguration nur über Umgebungsvariablen (Tabelle in 1.6), geprüft beim
  Start mit Zod, klare Fehlermeldung bei fehlenden Werten.
- Strukturierte Logs als JSON-Zeilen auf stdout (Zeit, Methode, Pfad, Status,
  Dauer, Größe), **ohne** Netzinhalte, Prompts oder Zugangsdaten.
- Graceful shutdown auf SIGTERM (laufende Anfragen beenden, höchstens 10 s).

### 1.2 Auslieferung der Web-App

- Statische Dateien aus `apps/web/dist` (gebaut mit `VITE_BASE=/`), mit
  korrekten MIME-Typen, `Cache-Control: immutable` für gehashte Assets,
  `no-cache` für `index.html`, SPA-Rückfall auf `index.html`.
- Sicherheitsheader: `Content-Security-Policy` (nur eigene Quelle, Worker
  erlaubt, `connect-src 'self'`), `X-Content-Type-Options`,
  `Referrer-Policy`, `frame-ancestors 'none'`.

### 1.3 LLM-Vermittler `/llm/v1/*`

- Reicht genau zwei Endpunkte durch: `POST /llm/v1/chat/completions` und
  `GET /llm/v1/models`. Alles andere wird mit 404 beantwortet (keine
  Administrations-Endpunkte von Ollama nach außen).
- Ziel konfigurierbar (`PNM_LLM_BASE_URL`). **Festgelegt:** Open WebUI,
  OpenAI-kompatibel unter `https://ollama-webui.aifb-bis-gpu01.aifb.kit.edu/api`
  (`/api/chat/completions`, `/api/models`) mit API-Schlüssel
  (`PNM_LLM_API_KEY`, in Open WebUI unter Settings ▸ Account ▸ API Keys
  erzeugt), den der Server als Bearer anhängt. Der Schlüssel steht nur in der
  `.env` auf dem Server. Ollama direkt (`http://…:11434/v1`) bleibt als
  Alternative konfigurierbar.
- **Ein Schlüssel für alle Nutzer.** Der Schlüssel gehört einem eigenen
  Dienstkonto in Open WebUI (etwa `petri-net-tool`), das nur die benötigten
  Modelle sehen darf. Die Nutzer der App brauchen und sehen keinen
  Schlüssel. Protokolliert werden je LLM-Anfrage nur Zeit, Modell, Dauer,
  Token-Zahlen und Status, nie Inhalte und keine Zuordnung zu Personen.
  `deploy/README.md` beschreibt Anlage des Dienstkontos und den Wechsel des
  Schlüssels (neuen erzeugen, `.env` ändern, `docker compose up -d`, alten
  löschen).
- Erlaubte Modelle optional als Liste (`PNM_LLM_MODELS`); `/models` liefert
  dann nur diese. Vorgabemodell `PNM_LLM_DEFAULT_MODEL`.
- Grenzen: Anfragegröße 2 MB, Zeitlimit 180 s, höchstens 2 gleichzeitige
  Erzeugungen (weitere warten, über 10 wartend: 429), Antwort wird gestreamt
  durchgereicht, falls der Client `stream: true` setzt (die App nutzt das
  nicht, aber die API soll es nicht brechen).

### 1.4 Werkzeug-API `/api/v1/*`

Dieselben Funktionen wie die Kommandozeile, auf denselben Paketen:

| Methode und Pfad | Eingabe | Ausgabe |
|------------------|---------|---------|
| `GET /api/health` | – | Version, Server-Funktionen (`llm`, `projects`, `api`), Modellliste |
| `POST /api/v1/validate` | Netz (`.pn.json` oder PNML) | Diagnosen (Kern und Domänenansicht) |
| `POST /api/v1/simulate` | Netz, `seconds`, `seed`, `rates`, Formate | Kennzahlen, optional CSV, XES, Ereignisse |
| `POST /api/v1/replay` | Netz, Log (CSV oder XES), Zuordnung | Fitness, Abweichungen, Kennzahlen (nach D5) |
| `POST /api/v1/analyze` | Netz, Limits | Ergebnis wie `pnm analyze --json` |
| `POST /api/v1/check` | Netz, Vorgaben, Endzustände, optional Log | Ergebnis wie `pnm check --json` |
| `POST /api/v1/convert` | Netz, Zielformat (`json`, `pnml`, `svg`, `tikz`) | Datei |
| `POST /api/v1/layout` | Netz, Richtung | Netz mit Positionen |
| `POST /api/v1/domain/check`, `/domain/generic` | Netz | Diagnosen bzw. Netz mit Abbildung |
| `POST /api/v1/domain/generate` | Netz, Beschreibung, Modell | Netz mit Abbildung und Protokoll (nutzt den Vermittler intern) |

- Rechenintensive Aufrufe laufen in einem Pool von `worker_threads`
  (Größe `PNM_WORKERS`, Vorgabe 2) mit hartem Zeitlimit je Aufruf
  (`PNM_JOB_TIMEOUT`, Vorgabe 60 s; der Worker wird bei Überschreitung
  beendet) und Speichergrenze (`resourceLimits`). Damit kann eine
  JSONata-Regex oder ein großer Zustandsraum den Dienst nicht blockieren
  (behebt die dokumentierte Einschränkung 8 serverseitig).
- Fehlerformat einheitlich: `{ error: { code, message, details? } }`, HTTP 400
  bei ungültiger Eingabe, 413 bei zu großer Eingabe, 422 bei fachlichem
  Fehler (Netz ungültig), 504 bei Zeitüberschreitung.
- OpenAPI-Beschreibung `GET /api/v1/openapi.json` (von Hand gepflegt, durch
  einen Test gegen die Routen geprüft), dazu `docs/server.md` mit
  `curl`-Beispielen.

### 1.5 Projektablage `/api/v1/projects/*`

- Speicherort `PNM_DATA_DIR` (Volume). Je Projekt ein Verzeichnis mit
  `meta.json` (ID, Name, angelegt, geändert, Freigabe) und Versionen
  `v0001.pn.json`, `v0002.pn.json`, … (unveränderlich, jede Speicherung eine
  neue Version, höchstens `PNM_MAX_VERSIONS`, Vorgabe 200, älteste werden
  zusammengefasst: jede zehnte bleibt).
- Endpunkte: `GET /projects` (Liste), `POST /projects` (anlegen mit Netz),
  `GET /projects/:id` (aktuelle Version), `GET /projects/:id/versions`,
  `GET /projects/:id/versions/:n`, `PUT /projects/:id` (neue Version, mit
  `If-Match`-Versionsnummer gegen gleichzeitiges Überschreiben, sonst 409),
  `POST /projects/:id/share` (Freigabelink mit zufälligem Token, nur lesen
  oder lesen und schreiben), `DELETE /projects/:id/share`,
  `DELETE /projects/:id` (in einen Papierkorb verschieben, 30 Tage).
- Freigabelinks: `/s/<token>` öffnet die App mit dem Projekt; nur-lesen
  zeigt das Netz und erlaubt Simulation und Analyse, aber kein Speichern.
- Schreiben atomar (temporäre Datei, `rename`), Projekt-IDs und Tokens aus
  `crypto.randomUUID` bzw. 32 Zufallsbytes in Base64url.
- Kein Konto: Wer im KIT-Netz die Adresse kennt, sieht die Projektliste.
  Optional `PNM_BASIC_AUTH` (Benutzer:Hash) für die gesamte Instanz, falls
  der Kreis enger sein soll. Freigabelinks funktionieren auch dann ohne
  Anmeldung.

### 1.6 Konfiguration

| Variable | Bedeutung | Vorgabe |
|----------|-----------|---------|
| `PNM_PORT` | Port im Container | `8080` |
| `PNM_PUBLIC_URL` | Adresse, unter der Nutzer das Werkzeug erreichen | Pflicht |
| `PNM_LLM_BASE_URL` | Ziel des Vermittlers | leer (LLM aus) |
| `PNM_LLM_API_KEY` | Schlüssel für Open WebUI | leer |
| `PNM_LLM_MODELS` | erlaubte Modelle, kommagetrennt | alle |
| `PNM_LLM_DEFAULT_MODEL` | Vorgabe in der App | erstes erlaubtes |
| `PNM_DATA_DIR` | Projektablage | `/data` |
| `PNM_WORKERS`, `PNM_JOB_TIMEOUT` | Rechenpool | `2`, `60` |
| `PNM_MAX_BODY` | größte Anfrage | `10mb` |
| `PNM_BASIC_AUTH` | optionaler Zugangsschutz | leer |
| `PNM_ALLOWED_NETS` | erlaubte Client-Netze (CIDR), zusätzliche Absicherung | `129.13.0.0/16,141.3.0.0/16,141.52.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` |

Die Netzliste ist eine zweite Sicherung hinter der Firewall. Die tatsächlich
genutzten KIT-Bereiche bestätigt Fabian vor der Einrichtung (siehe 4).

## 2. Image, Registry, Docker Compose und Ingress

Abgestimmt mit dem Betrieb am AIFB: Der Server baut nichts selbst. Ein
fertiges Image liegt in der KIT-GitLab-Container-Registry, Docker Compose
zieht es, und die URL wird im vorhandenen Ingress des Servers eingetragen,
der auch TLS übernimmt.

### 2.1 Image

- `deploy/Dockerfile`: mehrstufig (Build mit pnpm, Laufzeit `node:22-alpine`
  als Nicht-Root-Benutzer, nur `dist/server.js` und `apps/web/dist`),
  `HEALTHCHECK` auf `/api/health`, Port 8080, nur HTTP (TLS macht der
  Ingress). OCI-Labels (`org.opencontainers.image.source`, `.version`,
  `.revision`).
- Tags: `<version>` (zum Beispiel `1.2.0`), `<version>-<kurzer SHA>` und
  `latest` nur für Releases. Der Server verwendet eine feste Version, nicht
  `latest`.

### 2.2 Bau und Veröffentlichung in die Registry

Zwei Wege, beide im Repository vorbereitet. **Festgelegt ist Weg 2**
(Spiegel mit GitLab CI); Weg 1 bleibt als Alternative dokumentiert:

1. **GitHub Actions schiebt in die KIT-Registry** (`.github/workflows/image.yml`):
   bei Tags `v*` und von Hand, Anmeldung mit einem GitLab-Deploy-Token
   (Rechte `write_registry`) aus den GitHub-Secrets `KIT_REGISTRY_USER` und
   `KIT_REGISTRY_TOKEN`, Ziel aus der Repository-Variable `KIT_REGISTRY_IMAGE`
   (zum Beispiel `<registry-host>/<gruppe>/petri-net-modeling`). Setzt voraus,
   dass die Registry aus dem Internet erreichbar ist.
2. **Spiegel auf KIT-GitLab mit GitLab CI** (`.gitlab-ci.yml`): das
   Repository wird nach `gitlab.kit.edu` gespiegelt (Pull-Mirror), die
   Pipeline baut bei Tags und schiebt mit `$CI_REGISTRY_IMAGE` und
   `$CI_JOB_TOKEN`. Keine Secrets in GitHub nötig, funktioniert auch, wenn
   die Registry nur KIT-intern erreichbar ist.

Beide Wege bauen dasselbe `deploy/Dockerfile`, führen vorher Lint,
Typecheck und Tests aus und schreiben die Image-Referenz in die Release-Notes
bzw. den Job-Log. Der CI-Job im GitHub-Repository baut das Image bei jedem
Pull Request ohne Push, damit das Dockerfile nicht unbemerkt bricht.

### 2.3 Docker Compose auf dem Server

- `deploy/compose.yaml`:
  - Dienst `pnm` mit `image: ${PNM_IMAGE}:${PNM_VERSION}`, Volume
    `pnm-data:/data`, Neustart `unless-stopped`, Speicher- und CPU-Grenzen,
    **kein veröffentlichter Port nach außen**, nur im Netz des Ingress
    (externes Docker-Netz `${PNM_INGRESS_NETWORK}`).
  - Anbindung an Ollama: externes Docker-Netz des Ollama-Stacks
    (`${PNM_OLLAMA_NETWORK}`) oder `extra_hosts:
    host.docker.internal:host-gateway`, je nach Antwort auf 4.1.
  - Vorlage für **Traefik-Labels** (Host-Regel mit `${PNM_HOST}`, Entrypoint
    `websecure`, Middleware für IP-Filter auf die KIT-Netze), auskommentiert
    in einer Datei `compose.traefik.yaml`, die per `-f` hinzugenommen wird,
    falls der Ingress Traefik ist.
  - Für einen Ingress mit zentraler Konfiguration (nginx oder Traefik-Datei)
    enthält `deploy/README.md` einen fertigen Ausschnitt: Host
    `${PNM_HOST}` → `http://pnm:8080`, Upload-Grenze 10 MB, Zeitlimit 180 s
    für `/llm/`, Header `X-Forwarded-For` und `X-Forwarded-Proto`.
- `deploy/.env.example` mit allen Variablen und Kommentaren.
- `deploy/README.md` mit Schritten: Anmelden an der Registry
  (`docker login`, Deploy-Token mit `read_registry`), `.env` anlegen, URL im
  Ingress eintragen, `docker compose pull && docker compose up -d`, prüfen
  mit `curl https://${PNM_HOST}/api/health`, Update durch Ändern von
  `PNM_VERSION` und erneutes `pull` und `up -d`, Rückweg auf die vorige
  Version, Sicherung des Volumes (`docker run --rm -v pnm-data:/data
  -v $PWD:/backup alpine tar czf /backup/pnm-data.tgz /data`), Fehlersuche
  (`docker compose logs pnm`).
- Der Server wertet `X-Forwarded-For` nur aus, wenn die Anfrage aus dem
  Ingress-Netz kommt (`PNM_TRUSTED_PROXIES`), damit der Netzfilter
  (`PNM_ALLOWED_NETS`) die echte Client-Adresse prüft.
- Lokal testbar: `deploy/compose.local.yaml` baut das Image aus dem
  Quellcode, veröffentlicht Port 8080 auf `localhost` und startet einen
  kleinen Ollama-Ersatz (Fake-Server aus den Tests von `@pnm/llm`), damit die
  LLM-Funktionen ohne GPU ausprobiert werden können.

## 3. App `@pnm/web` im Server-Modus

- Beim Start `GET /api/health` auf derselben Adresse. Antwortet der Server,
  ist der Server-Modus aktiv (Statusleiste zeigt „Server: aifb-bis-gpu01").
- **LLM:** Voreinstellung „Server (Ollama)" ohne Schlüsselfeld,
  Basis-URL `/llm/v1`, Modellliste vom Server. Die übrigen Voreinstellungen
  bleiben für Pages und lokale Nutzung.
- **Projekte:** Menü File ▸ Open from server, Save to server (Strg+S speichert
  dann auf dem Server, Strg+Shift+S lokal), Versions-Dialog (Liste, Öffnen,
  Vergleich der Elementzahlen), Share (Link kopieren, nur lesen oder
  bearbeiten), Konflikt-Dialog bei 409 (neu laden oder als neues Projekt
  speichern). Autosave lokal bleibt, Speichern auf dem Server ist explizit.
- **Freigabelinks:** `/s/<token>` lädt das Projekt, nur-lesen zeigt einen
  Hinweis und sperrt Speichern.
- Analyse und Simulation bleiben im Browser-Worker (schnell und ohne
  Serverlast). Optional „Run on server" für Analysen mit großem Limit.

## 4. Vor der Einrichtung zu klären (Fabian und Kollege)

1. **Ollama:** geklärt, Open WebUI mit API-Schlüssel unter
   `https://ollama-webui.aifb-bis-gpu01.aifb.kit.edu/api`. Offen nur, ob der
   Container die Adresse über den Ingress erreicht (Standard) oder intern über
   das Docker-Netz von Open WebUI (schneller, optional).
2. **Ingress:** Welche Software (Traefik mit Docker-Labels, Traefik mit
   Datei-Konfiguration, nginx, oder ein Kubernetes-Ingress), Name des
   Docker-Netzes, über das der Ingress Dienste erreicht, und der gewünschte
   Hostname (`PNM_HOST`, braucht ggf. DNS-Eintrag). Ist die Einschränkung auf
   das KIT-Netz schon im Ingress umgesetzt?
3. **Registry:** Projekt bzw. Gruppe auf `gitlab.kit.edu` für den Spiegel
   (Weg 2, festgelegt) und ein Deploy-Token mit `read_registry` für den
   Server. Der Spiegel wird in GitLab unter Settings ▸ Repository ▸ Mirroring
   repositories als Pull-Mirror von
   `https://github.com/frybinski/Petri-Net-Modeling.git` eingerichtet.
4. **Netzbereiche** für `PNM_ALLOWED_NETS` und die Adressen des Ingress für
   `PNM_TRUSTED_PROXIES`.
5. **Kreis der Nutzer:** reicht „KIT-Netz", oder zusätzlich Basic Auth?

Der Code hängt von diesen Antworten nicht ab, nur die `.env`, die Secrets
bzw. Variablen der Pipeline und der Ingress-Eintrag.

## 5. Tests

- Unit: Router, Konfiguration, statische Auslieferung (MIME, Cache, SPA),
  Sicherheitsheader, Netzfilter, Basic Auth.
- Vermittler gegen den Fake-LLM-Server: Durchreichen, Schlüssel wird
  angehängt und nie zurückgegeben, gesperrte Pfade 404, Modellfilter,
  Zeitlimit, Warteschlange und 429, Streaming wird durchgereicht.
- API: jeder Endpunkt mit Beispielnetz, Fehlerfälle (400, 413, 422, 504 mit
  einer absichtlich langsamen Analyse), Ergebnisse gleich der CLI
  (Vergleich der JSON-Ausgabe für `analyze`, `check`, `simulate`).
- Projekte: Anlegen, Versionen, `If-Match` und 409, Freigabe nur-lesen und
  schreiben, Papierkorb, atomares Schreiben (Abbruch mitten im Schreiben
  hinterlässt keine kaputte Version), Versionsbegrenzung.
- OpenAPI-Beschreibung deckt alle Routen ab.
- Container: Build im CI bei jedem Pull Request ohne Push, Start mit
  Healthcheck, Rauchtest per `curl` gegen den laufenden Container (im
  CI-Job; im Entwicklungscontainer ersatzweise der Server direkt mit Node).
  `.gitlab-ci.yml` wird mit `gitlab-ci-lint`-äquivalenter Strukturprüfung
  (YAML-Schema-Test) abgesichert, da GitLab hier nicht verfügbar ist.
- Weiterleitungs-Header: Netzfilter wertet `X-Forwarded-For` nur von
  vertrauenswürdigen Proxys aus.
- Web: Server-Modus-Erkennung, LLM-Voreinstellung, Projektdialoge,
  Konflikt, Freigabelink (Vitest mit gemocktem Server, Playwright gegen den
  echten Server-Prozess mit Fake-LLM).

## 6. Dokumentation

- `docs/server.md`: Architektur, API mit `curl`-Beispielen, Projektablage,
  Sicherheit, Grenzen.
- `deploy/README.md`: Einrichtung und Betrieb auf `aifb-bis-gpu01` mit Image
  aus der KIT-GitLab-Registry, Ingress-Eintrag (Traefik-Labels oder
  Ausschnitt für zentrale Konfiguration), Update und Rückweg, Sicherung,
  Fehlersuche.
- `docs/adr/0016-server.md`: eingebauter HTTP-Server ohne Framework,
  Dateiablage statt Datenbank, Worker-Pool mit harten Grenzen, Vermittler
  mit Positivliste, Local-first bleibt.
- README: Abschnitt „Running on a server", Status 1.2.0; CHANGELOG 1.2.0.
- `docs/limitations.md`: Einschränkungen 8, 22 und 23 als „behoben im
  Server-Modus" markieren.

## 7. Abnahme

1. `pnpm install && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` fehlerfrei, Build enthält `apps/server/dist/server.js`.
2. Playwright (alt und neu) läuft; Web-Suite dreimal unter Last stabil.
3. Server startet lokal mit `node apps/server/dist/server.js` und der gebauten App, alle API-Tests grün, Ergebnisse gleich der CLI.
4. `docker build` gelingt im CI-Job; beide Pipelines (GitHub Actions mit Deploy-Token, GitLab CI im Spiegel) sind vorbereitet und strukturell geprüft; `deploy/README.md` beschreibt Registry-Anmeldung, Ingress-Eintrag und Compose so, dass Fabian die Einrichtung ohne weitere Hilfe ausführen kann.
5. Keine Zugangsdaten in Logs, Antworten, Netzen oder Tests.
6. Thematische Commits, gepusht.

## 8. Reihenfolge

1. Gerüst `apps/server`: Konfiguration, Router, statische Auslieferung, Sicherheitsheader, Netzfilter, Logs, Bundle.
2. LLM-Vermittler mit Tests.
3. Werkzeug-API mit Worker-Pool, Grenzen und OpenAPI.
4. Projektablage mit Versionen und Freigaben.
5. Dockerfile, Image-Pipelines für die KIT-Registry (GitHub Actions und GitLab CI), Compose mit Ingress-Anbindung, `.env.example`, `deploy/README.md`, CI-Job für den Container-Build.
6. Web-App im Server-Modus.
7. Tests, Playwright, Robustheit.
8. Doku, ADR, README, CHANGELOG.
