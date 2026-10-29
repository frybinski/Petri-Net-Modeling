# Server

The server turns the tool from a page that runs in one browser into an installation that a group can share. It is one
small Node program, `apps/server`, bundled to `server.js`. It does four things:

1. It **serves the web app** (the same build as on GitHub Pages, for the root path).
2. It **passes language model requests on** to an Ollama or Open WebUI server with a key that only the server knows.
3. It offers the functions of the **command line over HTTP**, computed by the same code, so a result is the same whether
   it comes from `pnm` or from the server.
4. It **stores projects** with versions, share links and a trash.

Local use stays as it is. The app on GitHub Pages and a local `pnpm dev` know nothing of the server; when the app finds one
at its own address, it switches on the extra functions (see [App](#the-app-on-a-server)). Setting the server up with
Docker Compose, the image and the ingress is described in [deploy/README.md](../deploy/README.md); the reasons for the
design are in [ADR 0016](adr/0016-server.md).

```
browser ──https──> ingress ──http──> server.js ──┬── static files   apps/web/dist (the built app)
                                                 ├── /llm/v1/*      ──> Open WebUI / Ollama (key added here)
                                                 ├── /api/v1/*      ──> pool of worker threads ──> the packages of the tool
                                                 └── /api/v1/projects, /shared   ──> files in PNM_DATA_DIR
```

There is no framework and no database: `node:http` with a small router, files for the projects, `worker_threads` for the
computations. The bundle needs Node 22 and nothing else; there is no runtime dependency.

## Running it

In the container (the normal way) see [deploy/README.md](../deploy/README.md). Directly, from a clone, for development:

```sh
pnpm install && pnpm build
PNM_PUBLIC_URL=http://localhost:8080 PNM_DATA_DIR=/tmp/pnm-data PNM_PORT=8080 \
  PNM_ALLOWED_NETS=0.0.0.0/0,::/0 node apps/server/dist/server.js
# http://localhost:8080
```

or with Docker, without a GPU or a registry (a stand-in answers for the language model):

```sh
docker compose -f deploy/compose.local.yaml up --build
```

`node server.js --help` lists three more commands: `check-config` reads the environment and prints what the server
understood without any secret, `hash-password <user>` makes an entry for `PNM_BASIC_AUTH` from a password on standard
input, and `--version`. The program exits with status 78 and a message that lists every problem if the configuration is
wrong, and logs one JSON object per line to standard output. SIGTERM stops it: running requests get ten seconds to finish.

## Configuration

Everything is set by environment variables. Variables that are empty count as not set (Docker Compose passes them that
way). `deploy/.env.example` has them all with comments.

| Variable                | Meaning                                                                                                                                            | Default                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PNM_PUBLIC_URL`        | The address that users open, `https://host` without a trailing slash. Share links are built from it. **Required.**                                 |                                                                                                                                |
| `PNM_PORT`              | Port inside the container.                                                                                                                         | `8080`                                                                                                                         |
| `PNM_BIND_ADDRESS`      | Address to listen on.                                                                                                                              | `0.0.0.0`                                                                                                                      |
| `PNM_SERVER_NAME`       | The name the app shows in its status bar.                                                                                                          | the host name of `PNM_PUBLIC_URL`                                                                                              |
| `PNM_WEB_DIR`           | The built web app.                                                                                                                                 | `apps/web/dist` next to the server; `/app/web` in the image                                                                    |
| `PNM_DATA_DIR`          | Where the projects live. Must be writable for the user that runs the server.                                                                       | `/data`                                                                                                                        |
| `PNM_MAX_BODY`          | Largest request (`10mb`, `512kb`).                                                                                                                 | `10mb`                                                                                                                         |
| `PNM_ALLOWED_NETS`      | Networks (CIDR, commas) that may use the server. Loopback always may. `0.0.0.0/0,::/0` allows everyone.                                            | the KIT ranges `129.13.0.0/16, 141.3.0.0/16, 141.52.0.0/16` and the private ranges `10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16` |
| `PNM_TRUSTED_PROXIES`   | Addresses (CIDR, commas) of the ingress. `X-Forwarded-For` counts only from these. `deploy/compose.yaml` requires it.                              | none                                                                                                                           |
| `PNM_ALLOWED_HOSTS`     | Host names besides `PNM_PUBLIC_URL` and `localhost` that requests may use.                                                                         | none                                                                                                                           |
| `PNM_BASIC_AUTH`        | Passwords for the whole instance: `user:scrypt:<salt>:<hash>`, commas between entries.                                                             | none                                                                                                                           |
| `PNM_LLM_BASE_URL`      | The language model server up to its OpenAI path: `https://host/api` (Open WebUI) or `http://host:11434/v1` (Ollama). Empty switches the proxy off. | none                                                                                                                           |
| `PNM_LLM_API_KEY`       | Bearer key for it. Never logged, never in an answer.                                                                                               | none                                                                                                                           |
| `PNM_LLM_MODELS`        | Models that users may use (commas); empty means all that the upstream lists.                                                                       | all                                                                                                                            |
| `PNM_LLM_DEFAULT_MODEL` | The model the app proposes; one of `PNM_LLM_MODELS` if that is set.                                                                                | the first allowed                                                                                                              |
| `PNM_LLM_TIMEOUT`       | Seconds one request to the model may take.                                                                                                         | `180`                                                                                                                          |
| `PNM_LLM_CONCURRENCY`   | Requests to the model at the same time.                                                                                                            | `2`                                                                                                                            |
| `PNM_LLM_QUEUE`         | Requests that wait for a free place; more get 429.                                                                                                 | `10`                                                                                                                           |
| `PNM_LLM_MAX_BODY`      | Largest request to the model.                                                                                                                      | `2mb`                                                                                                                          |
| `PNM_WORKERS`           | Threads for the computations.                                                                                                                      | `2`                                                                                                                            |
| `PNM_JOB_TIMEOUT`       | Seconds a computation may take before its thread is ended.                                                                                         | `60`                                                                                                                           |
| `PNM_WORKER_MEMORY`     | Heap of a thread in MB.                                                                                                                            | `512`                                                                                                                          |
| `PNM_JOB_QUEUE`         | Computations that may wait for a thread; more get 503.                                                                                             | `16`                                                                                                                           |
| `PNM_MAX_VERSIONS`      | Versions kept per project.                                                                                                                         | `200`                                                                                                                          |
| `PNM_TRASH_DAYS`        | Days a removed project stays in the trash; `0` removes at once.                                                                                    | `30`                                                                                                                           |

The defaults for `PNM_ALLOWED_NETS` are the ranges the plan named; confirm them with the network team before the first
start.

## Who may use it

Three layers, from the outside in:

1. **Firewall and ingress** (not part of this program): the server should only be reachable from the KIT network.
2. **`PNM_ALLOWED_NETS`**: the address of the client is checked again. The address is that of the socket, unless the socket
   is one of the `PNM_TRUSTED_PROXIES`; then the header `X-Forwarded-For` is read **from the right**, skipping trusted
   proxies, and the first address that is not one is the client (a client cannot forge entries to the right of its own).
   A request from outside gets 403, and the log has one `denied` line with the address it saw. Loopback always passes, for
   the health check of the container.

   Behind an ingress `PNM_TRUSTED_PROXIES` must name the ingress (`deploy/compose.yaml` requires it). Without it the server
   takes the address of the ingress for the client; a Docker address is in the private default ranges of
   `PNM_ALLOWED_NETS`, so **every request passes** and nothing is denied. The ingress must set `X-Forwarded-For` to the
   address of the client (append it or replace the header) and never pass on a value from the client. If a request carries
   `X-Forwarded-For` from a peer that is not trusted, the server logs one warning per start (`forwarded header ignored`,
   with the address of the peer and the hint, not the header) because that is what a missing `PNM_TRUSTED_PROXIES` looks like.

3. **`PNM_BASIC_AUTH`** (optional): a password for everything except the health check, the files of the app, and the share
   links (the page `/s/<token>` and `/api/v1/shared/<token>`).

There are no accounts. Everyone who passes these layers sees every project, may change it and may delete it (it goes to the
trash). A share link is a convenience, not a lock.

Against attacks through the browser of a visitor: every answer carries a content security policy (only the own origin,
workers allowed, no framing), `nosniff`, `Referrer-Policy: no-referrer` (a token in an address is not passed on) and
`Cross-Origin-Resource-Policy: same-origin`. Requests that change something must have the content type `application/json`
(a form or a simple cross-site request cannot send it) and, if they carry an `Origin`, come from the server's own address.
The `Host` header must name the server (`PNM_PUBLIC_URL`, `localhost`, `PNM_ALLOWED_HOSTS`), which stops DNS rebinding.
`'unsafe-eval'` is in the policy for scripts, because Ajv (JSON Schema for the token types) compiles its validators with
`new Function`; scripts from elsewhere and inline scripts (except the hash of the theme script in `index.html`) are not
allowed.

## The language model proxy

`POST /llm/v1/chat/completions` and `GET /llm/v1/models` are all that is passed on. Everything else below `/llm/` is 404.

| Request to the server           | Request to the model server                                                      |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `POST /llm/v1/chat/completions` | `POST <PNM_LLM_BASE_URL>/chat/completions` (Open WebUI: `/api/chat/completions`) |
| `GET /llm/v1/models`            | `GET <PNM_LLM_BASE_URL>/models` (Open WebUI: `/api/models`)                      |

- The server adds `Authorization: Bearer <PNM_LLM_API_KEY>`. What the client sends (its own `Authorization`, cookies,
  forwarding headers) is not passed on. The key is also removed from anything that comes back, and appears in no log.
- Only the usual fields of a chat request are passed on (`model`, `messages`, `temperature`, `top_p`, `max_tokens`,
  `max_completion_tokens`, `stream`, `stream_options`, `stop`, `seed`, `response_format`, the two penalties). Open WebUI
  reads more than the OpenAI interface has (tools, files, features); those fields are dropped.
- With `PNM_LLM_MODELS` the model list holds only those models (that the upstream also has), and a request for another
  model is answered with 403. The list is `{ "object": "list", "data": [{ "id", "object": "model", "owned_by" }] }`.
- `stream: true` is passed through as a stream of server-sent events.
- Two requests run at a time, ten wait, further requests get 429 with `Retry-After`. A client that goes away frees its
  place; the request to the model is cancelled. A request that takes longer than `PNM_LLM_TIMEOUT` ends with 504.
- Errors: a model that does not exist is 404 with the reason of the upstream, a wrong request 400; if the upstream refuses
  the key (401/403) the client gets **502** ("refused the key of this server, tell the operator") and the log has an error
  line, so that nobody is asked to log in for a problem of the server. 5xx of the upstream is 502; no connection is 502.
- The log has one line per request with the time, the model, the duration, the time it waited, the token counts and the
  status, and no prompt, no answer, no address.

A key goes to **one** account in Open WebUI ([deploy/README.md](../deploy/README.md#2-open-webui-a-service-account-and-its-key)).

## The interface for tools

Every call is `POST` with a JSON body (`Content-Type: application/json`) and answers JSON, apart from `convert`, which
answers the file. The net is `net`: the `.pn.json` as an object, its text, or PNML as a string. A body that is a net itself
(with `version`, `places`, `transitions`) counts as `{ "net": <body> }`, so a file can be sent as it is:

```sh
curl -s -X POST -H 'Content-Type: application/json' --data @examples/producer-consumer.pn.json \
  https://pnm.example.org/api/v1/validate
```

The full description is `GET /api/v1/openapi.json` (OpenAPI 3.1; a test compares it with the routes).

| Call                           | Body (besides `net`)                                                                                                                                                                           | Answer                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/validate`        |                                                                                                                                                                                                | the result of `pnm validate --json` without `file`                                                                 |
| `POST /api/v1/simulate`        | `seconds` (3600), `seed`, `warmup`, `rates` (`{ "<transition>": <per hour>\|"off" }`), `startTime`, `maxEvents`, `formats` (`csv`, `xes`, `stream`)                                            | the result of `pnm simulate --metrics`; with `formats` the event log too (at most 200 000 events)                  |
| `POST /api/v1/replay`          | `log` (CSV or XES text), `map`, `ignore`, `completeOnly`, `timeOrigin`, `columns`, `checkGuards`, `seed`, `warmup`, `formats` (`csv`, `xes`)                                                   | the result of `pnm replay --json` without `log`, and `logWarnings`                                                 |
| `POST /api/v1/analyze`         | `states`, `timeMs`, `coverability`, `structureOnly`                                                                                                                                            | the result of `pnm analyze --json` without `file`                                                                  |
| `POST /api/v1/check`           | `declare`, `ltlf` (lists), `final` (`deadlock`, `all` or a list of markings), `states`, `timeMs`, `log` (CSV text), `includeOpen`                                                              | the result of `pnm check --json` without `file` and `log`                                                          |
| `POST /api/v1/convert`         | `format` (`json`, `pnml`, `svg`, `tikz`) and the options of `pnm export` (`dark`, `padding`, `inscriptions`, `standalone`, `scale`, `labels`, `tokens`, `styles`, `grayscale`, `toolspecific`) | the file, with `Content-Disposition`; `?format=` works when the net is sent as it is                               |
| `POST /api/v1/layout`          | `direction` (`RIGHT`, `DOWN`), `spacing`                                                                                                                                                       | `{ "net": … }` with new positions                                                                                  |
| `POST /api/v1/domain/check`    | `view` (else the view in the net)                                                                                                                                                              | the result of `pnm domain check --json` without `file`                                                             |
| `POST /api/v1/domain/generic`  |                                                                                                                                                                                                | `{ "net": … }` with a generic domain view                                                                          |
| `POST /api/v1/domain/generate` | `description` (required), `model`, `rounds`, `temperature`, `jsonMode`, `width`, `height`                                                                                                      | `{ "net": …, "model", "fellBack", "rounds", "filled", "dropped", "notes" }`; uses the language model of the server |
| `GET /api/health`              |                                                                                                                                                                                                | version, name, features (`api`, `projects`, `llm`, `auth`), the allowed models                                     |

An unknown option is a 400 (a typo is not ignored). Examples (with the answers shortened):

```sh
$ curl -s https://pnm.example.org/api/health
{"ok":true,"app":"petri-net-modeling","version":"1.2.0","name":"aifb-bis-gpu01",
 "features":{"api":true,"projects":true,"llm":true,"auth":false},
 "llm":{"models":["llama3.1:8b"],"defaultModel":"llama3.1:8b"}}

$ curl -s -X POST -H 'Content-Type: application/json' \
    -d "{\"net\":$(cat examples/parcel-center.pn.json),\"seconds\":3600,\"seed\":1}" \
    https://pnm.example.org/api/v1/simulate
{"net":"Paketzentrum","seed":1,"seconds":3600,"events":3555,"warnings":[],
 "metrics":{"time":3600,"completedCases":206,"throughputPerHour":309,"meanCycleTime":164.7,…}}

$ curl -s -X POST -H 'Content-Type: application/json' \
    -d "{\"net\":$(cat examples/order-processing.pn.json),\"declare\":[\"response(Approve, Create invoice)\"]}" \
    https://pnm.example.org/api/v1/check
{"mode":"state-space","final":"deadlock","states":216,"edges":756,"complete":true,"ok":true,
 "properties":[{"id":"declare-1","property":"response(Approve, Create invoice)","verdict":"holds",…}]}

$ curl -s -X POST -H 'Content-Type: application/json' -d @broken-net-request.json https://pnm.example.org/api/v1/analyze
{"error":{"code":"net_invalid","message":"The net has errors; fix them first (POST /api/v1/validate lists them).",
 "details":{"diagnostics":[{"code":"ARC_DANGLING","message":"This arc refers to a node that does not exist.","elementId":"a"}]}}}

$ curl -s -X POST -H 'Content-Type: application/json' --data @examples/traffic-light.pn.json \
    'https://pnm.example.org/api/v1/convert?format=svg' -o traffic-light.svg
```

### Errors

Every error is `{ "error": { "code", "message", "details"? } }`:

| Status | `code`                                                         | When                                                                                                                                                                                                                    |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `bad_request`, `invalid_json`                                  | the body is not JSON, an option is unknown or wrong (`details.issues` names it), a rate or a mapping names nothing, `If-Match` cannot be read                                                                           |
| 401    | `unauthorized`                                                 | `PNM_BASIC_AUTH` is set and the password is missing or wrong                                                                                                                                                            |
| 403    | `forbidden`, `cross_origin`                                    | the address is not allowed; the model is not offered; a read-only link; a change that came from another site                                                                                                            |
| 404    | `not_found`                                                    | no such path, project, version or link                                                                                                                                                                                  |
| 409    | `conflict`                                                     | a save was based on an old version (`details.currentVersion`)                                                                                                                                                           |
| 413    | `payload_too_large`                                            | the request is larger than `PNM_MAX_BODY` (`PNM_LLM_MAX_BODY` for the model)                                                                                                                                            |
| 415    | `unsupported_media_type`                                       | the body was not sent as `application/json`                                                                                                                                                                             |
| 421    | `misdirected`                                                  | the `Host` header does not name the server                                                                                                                                                                              |
| 422    | `net_format`, `net_invalid`, `unprocessable`, `resource_limit` | the document is no net or PNML (`net_format`); it has errors (`net_invalid`, with the findings); the run was too large or there is no domain view (`unprocessable`); a computation needed more than `PNM_WORKER_MEMORY` |
| 428    | `precondition_required`                                        | a save without `If-Match`                                                                                                                                                                                               |
| 429    | `too_many_requests`                                            | the language model is busy (`Retry-After`)                                                                                                                                                                              |
| 502    | `bad_gateway`                                                  | the language model server could not be reached or refused the key                                                                                                                                                       |
| 503    | `busy`, `unavailable`                                          | every thread is busy and the queue is full (`Retry-After`); no language model is connected                                                                                                                              |
| 504    | `timeout`                                                      | a computation took more than `PNM_JOB_TIMEOUT` and was stopped; the language model did not answer in time                                                                                                               |

Anything unexpected is a 500 `internal` without details; the cause is in the log (the kind of error, never the content).

### Computations in threads

`simulate`, `replay`, `analyze`, `check`, `convert`, `layout` and the domain calls run in a pool of `worker_threads`
(`PNM_WORKERS`). A computation that takes longer than `PNM_JOB_TIMEOUT` is stopped by **ending its thread** and answers
504, then a fresh thread takes the next job. This is what the time limit of 1 s for a guard cannot do inside one thread
(a regular expression in `$match` runs to its end): a net with such a guard blocks one request for at most
`PNM_JOB_TIMEOUT` seconds and nothing else. A thread has a memory limit (`PNM_WORKER_MEMORY`, then 422
`resource_limit`), gets no copy of the environment (so it never sees the key), and ends when the client goes away. Idle
threads are ended after five minutes. When all threads are busy, `PNM_JOB_QUEUE` computations wait; more get 503.

The functions are those of the command line: `apps/cli/src/lib` holds them, `pnm` prints their results and the server
returns them. The tests of the server compare the answers with the output of the `pnm` bundle for the examples.

## Projects

Files in `PNM_DATA_DIR`:

```
projects/<id>/meta.json          name, times, share links, the list of versions with their element counts
projects/<id>/v0001.pn.json      version 1; versions never change
projects/<id>/v0002.pn.json
trash/<id>/…                     removed projects
```

A project is created with a net and then only grows by versions. Every write goes to a temporary file, is flushed and
renamed, and the index is written after the version it lists; a crash leaves either the old state or the new one, and the
next start removes temporary files, adopts a version file that the index did not list yet and rebuilds a damaged index
from the files. More than `PNM_MAX_VERSIONS` versions: the newest half stays, of the older ones every tenth, and no number
is ever used twice. IDs are random UUIDs, share tokens are 32 random bytes in Base64url (43 characters).

| Call                                                   | Meaning                                                                                                                                                                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/projects`                                 | the projects, most recently changed first                                                                                                                                                                                         |
| `POST /api/v1/projects`                                | `{ "net", "name"? }` makes version 1; answers 201 with `Location` and `ETag: "1"`                                                                                                                                                 |
| `GET /api/v1/projects/<id>`                            | `{ project, shares, net }` for the newest version; the `ETag` is the version number                                                                                                                                               |
| `PUT /api/v1/projects/<id>`                            | `{ "net", "name"?, "note"? }` makes the next version. **`If-Match: "<n>"` is required**: the version the changes are based on. If the newest is another: 409 and `details.currentVersion`; without the header 428; `*` overwrites |
| `GET /api/v1/projects/<id>/versions`                   | the versions, newest first: number, time, name, size, counts of places, transitions and arcs, note                                                                                                                                |
| `GET /api/v1/projects/<id>/versions/<n>`               | one version                                                                                                                                                                                                                       |
| `POST /api/v1/projects/<id>/share`                     | `{ "mode": "read" \| "write", "rotate"? }` makes the link (or gives the existing one; `rotate` makes a new one and the old one stops)                                                                                             |
| `DELETE /api/v1/projects/<id>/share?mode=read`         | removes one link, or both without `mode`                                                                                                                                                                                          |
| `DELETE /api/v1/projects/<id>`                         | moves the project to the trash; its links stop at once                                                                                                                                                                            |
| `GET /api/v1/trash`, `POST /api/v1/trash/<id>/restore` | the trash and taking a project out of it (without links)                                                                                                                                                                          |
| `GET /api/v1/shared/<token>`                           | `{ mode, project, net }` through a link; needs no password                                                                                                                                                                        |
| `PUT /api/v1/shared/<token>`                           | the same as saving, through a link with `mode: write`; 403 for a read-only link                                                                                                                                                   |

A saved net is checked against the file format (`net_format` otherwise) but not against the validation rules: a net with
errors is work in progress and may be saved. The page `/s/<token>` is the app itself; it reads the token from the address.

```sh
$ curl -s -i -X POST -H 'Content-Type: application/json' --data @examples/traffic-light.pn.json …/api/v1/projects
HTTP/1.1 201 Created
Location: /api/v1/projects/b0030651-b3d2-4618-b549-7d8c5209c7ce
ETag: "1"
{"project":{"id":"b0030651-…","name":"Traffic light","version":1,"places":8,"transitions":6,"arcs":16,
 "bytes":3677,"shared":{"read":false,"write":false},…},"shares":{}}

$ curl -s -X PUT -H 'Content-Type: application/json' -H 'If-Match: "1"' -d @save.json …/api/v1/projects/b0030651-…
{"project":{…,"version":2,…}}                                    # 200, ETag: "2"
$ curl -s -i -X PUT … -H 'If-Match: "1"' …                       # the same again
HTTP/1.1 409 Conflict
{"error":{"code":"conflict","message":"The project was changed in the meantime: it is at version 2, your changes are based on version 1.","details":{"currentVersion":2}}}

$ curl -s -X POST -H 'Content-Type: application/json' -d '{"mode":"read"}' …/api/v1/projects/b0030651-…/share
{"mode":"read","token":"A4Z_7ZTniHCN6U_Revs8yY7Fyuts2CxQmueRPSCsxTg",
 "url":"https://pnm.example.org/s/A4Z_7ZTniHCN6U_Revs8yY7Fyuts2CxQmueRPSCsxTg","createdAt":"2026-10-29T15:41:45.437Z"}
```

## The app on a server

The server adds `<meta name="pnm-server" content="<version>">` to the `index.html` it delivers. Only a page with this
marker asks `GET api/health` below its own base path (so that GitHub Pages, the dev server and a local file make no
request that ends in a 404 in the browser console). The answer must have the marker `"app":"petri-net-modeling"`; a 404,
a page that answers every path with HTML or a timeout means: no server, and nothing changes. With `PNM_DEV_SERVER` the
Vite dev server adds the marker itself.

With a server:

- **Status bar:** `Server: <name>` and, for a document that belongs to a project, `<name> · version <n>` (a `*` if there
  are unsaved changes).
- **File menu:** _Open from server…_ (list with search, open, move to the trash, the trash with restore), _Save to server_
  (`Ctrl+S`; a document that is no project yet asks for a name, otherwise the next version is saved at once; the file
  moves to `Ctrl+Shift+S`), _Versions…_ (every version with its counts of places, transitions and arcs compared with the
  net in the editor; opening an older version puts it in the editor, saving then makes a new version on top), _Share…_
  (a link to look, a link to edit; copy, new link, remove).
- **Conflict:** if the project was saved by someone else in between, a dialog says so and offers _Reload from server_ (your
  changes are discarded) or _Save as new project_.
- **Language model:** the preset _Server (Ollama)_ with the base URL `/llm/v1`, no key field, and the models of the server
  loaded when the dialog opens. It is the default when nothing was chosen before; a choice that a person made earlier is
  never overridden. A key typed for another provider is never sent to the server.
- **Share page:** `/s/<token>` loads the project and shows a note. A _read-only_ link lets people simulate, analyse and
  change the net in their browser, but saving to the project is blocked: _Save_ offers a copy as a project of its own. A
  link that can _edit_ saves versions, with the same protection against overwriting. A shared page does not touch the
  local autosave of the person.
- The simulation, the analysis and the domain view run in the browser as before; the server's computations are for tools.
- Autosave stays local and remembers which project the document belongs to, so a reload does not lose the link.

During development `PNM_DEV_SERVER=http://localhost:8080 pnpm dev` passes `/api` and `/llm` of the Vite server on to a
running server.

## Limits and what is not done

See [limitations](limitations.md#server). In short: no accounts and no real-time co-editing (a conflict is detected, not
merged), the project list is one folder scan in memory, saving a net parses it in the main thread (up to `PNM_MAX_BODY`),
"Run on server" for large analyses in the app is not built (the interface offers them to tools), and the image is built
from a mirror in KIT GitLab, which needs a GitLab tier that offers pull mirroring or the alternative in
[deploy/README.md](../deploy/README.md#1-kit-gitlab-the-mirror-the-pipeline-and-the-image).
