# ADR 0016: A small server next to the language model

Status: accepted · Date: 2026-10-29

## Context

Milestone M6 puts the tool on the GPU host of the institute, next to Ollama, for use inside the KIT network. Four needs
came up together: serve the web app, let the app use the language model without a key in every browser (limitations 22
and 23), offer the functions of the command line over HTTP for tools and LLM chains, and keep projects with versions and
share links. The constraints: the app must stay usable without a server (GitHub Pages, local files), the people who run the
host want a Docker Compose service behind the ingress that already exists (TLS there), an image from the registry of KIT
GitLab instead of a build on the host, a very small operating burden (no database, no accounts), and no secret in the
browser, in a repository, in a log or in an answer. The jobs must not be able to block the service: the 1 s limit for a
guard cannot interrupt a regular expression (limitation 8).

## Decision

- **`node:http` and a router of 140 lines, no framework.** The first plan said Fastify. The server has about 30 routes,
  needs no plugins, and runs as one esbuild bundle with no runtime dependency (the workspace packages and Zod are
  bundled, as for the command line). Less to update, nothing to audit, and the behaviour (limits, headers, streaming) is
  in the code that is read anyway.
- **The functions of the command line are a library.** The logic of `validate`, `simulate`, `replay`, `analyze`, `check`,
  `export`, `layout` and `domain` moved to `apps/cli/src/lib` (functions from a net and options to data); the commands only
  read arguments and print, the server returns the same data as JSON. The result of the server is the result of
  `pnm … --json` by construction, and the tests compare both, example by example. A package of its own for the library
  would be tidier, but the server would then import a package that only the command line and the server use; the app
  `@pnm/cli` exports `./lib` for it.
- **Computations run in `worker_threads` with hard limits.** A pool of two threads, each job with a time limit; the thread
  of a job that runs too long is **ended** and replaced (504). That is the only reliable way to stop a regular expression
  or a huge state space. A heap limit per thread (`resourceLimits`), a bounded queue (503), no copy of the environment
  for the threads (the key is not in their memory), and the job ends when the client goes away. Cheap things (projects,
  the proxy) stay in the main thread.
- **Projects are files, versions are immutable.** One folder per project with `meta.json` and `v0001.pn.json`, ... No
  database: nothing to set up, back up with `tar`, read with an editor, and the data is the file format that the tool
  already has. Writes are atomic (temporary file, flush, rename); a save is a new version file and then the index, and the
  start repairs what a crash left behind, so the index is a cache of the files, not the truth. Concurrent saves are
  protected by `If-Match` with the version number (409, 428) and by a lock per project inside the process, not by merging:
  a conflict is shown and the person decides (reload or save as a new project). Old versions are thinned out (the newest
  half stays, of the older ones every tenth) so that the folder cannot grow without bound.
- **Share links are random tokens, not accounts.** 32 random bytes, read or write, removable and renewable, working without
  the instance password. There are no users: whoever reaches the server sees the projects; the real fence is the network
  (firewall, ingress, `PNM_ALLOWED_NETS`), with an optional password for the instance (`scrypt`, no extra package).
- **The language model proxy is a positive list.** Exactly two paths, `POST /llm/v1/chat/completions` and
  `GET /llm/v1/models`, mapped to `<base URL>/chat/completions` and `/models` (so Open WebUI at `…/api` and Ollama at
  `…/v1` both work), only the usual request fields (Open WebUI would otherwise accept tools and files with the rights of
  the service account), an optional list of models, the key added and removed from every answer, two requests at a time
  with a queue and 429 beyond it, streams passed through, and a log line with model, duration and token counts but no
  content and no person. A refused key is a 502 for the client and an error line for the operator, never a 401 that would
  ask a user to log in.
- **The client address comes from `X-Forwarded-For` only from trusted proxies**, read from the right. A header from any
  other peer is ignored. The server's default for `PNM_TRUSTED_PROXIES` is empty (a header is never believed), and since behind an
  ingress an empty list makes the filter see only the ingress, `deploy/compose.yaml` requires the operator to name the
  network of the ingress; the server logs a warning once when a header from an untrusted peer shows up.
- **The browser is protected from other sites, not only the network from the internet.** Because the server sits inside a
  network and has no accounts, a page on the internet that the visitor opens could make the browser talk to it. So: bodies
  must be `application/json` (no simple cross-site request), a foreign `Origin` on a change is refused, the `Host` header
  must name the server (DNS rebinding), and the content security policy allows only the own origin (plus `'unsafe-eval'`
  for the validators that Ajv compiles, and `data:` fonts that the build inlines; both found by running the real app under
  the policy).
- **Local-first stays.** The server marks the `index.html` it delivers with a `<meta name="pnm-server">`; only a marked
  page asks its own address for `api/health` (and checks the marker in the answer), so Pages, the dev server and a file
  make no request at all and show nothing. The server preset for the language model is a
  default for people who chose nothing; autosave stays local; saving to the server is an explicit act; a share page does not
  touch the local autosave.
- **Image and pipeline fit the host, not the other way round.** One `deploy/Dockerfile` (two stages, `node:22-alpine`,
  non-root, HTTP on 8080, health check), no BuildKit-only features so that kaniko builds it without a privileged runner,
  built in GitLab CI from a pull mirror (the registry stays inside the network, no secret in GitHub) and, as an alternative,
  pushed from GitHub Actions with a deploy token. Compose publishes no port and joins the network of the ingress; the
  things that the people of the host must answer (ingress software, network names, host name, group) are variables and
  documented overlays, not code.

## Consequences

- The tool works exactly as before without a server. With one, limitations 8 (JSONata regular expression), 22 (an `http://`
  model server from an HTTPS page) and 23 (a key in the browser) no longer apply: the server computes with a time limit, the
  page talks to its own origin, and the key lives in `.env` on the host.
- One process holds the projects: there is one writer, so a lock per project and the checks on `If-Match` are enough.
  Running two instances on one volume is not supported. A restart takes a second.
- No accounts means no audit trail of who saved a version, and no way to keep a project private inside the allowed
  network. If that is needed, the next step is a login in the ingress or `PNM_BASIC_AUTH` per person, not a user model in
  this server.
- The pool is sized for a group of a few dozen people (two threads, a queue of sixteen). A busy server answers 503 with
  `Retry-After` rather than slowing down for everybody; the numbers are variables.
- The result of the server and of the command line can drift only if someone writes logic outside `apps/cli/src/lib`; the
  comparison tests and the OpenAPI/route test make that visible.
- The content security policy has `'unsafe-eval'` for scripts. Removing it needs Ajv's standalone code generation or
  another validator for the type schemas.
- Co-editing in real time (Yjs) is not part of this: conflicts are detected and shown, not merged.

## Alternatives considered

- **Fastify, Express or Hono:** convenient, but a runtime dependency to keep current for 30 routes, and the bundle would
  have to carry it. Nothing the server does needs more than `node:http`.
- **SQLite or Postgres:** transactions and queries, but a second thing to back up, migrate and explain, and the data is
  documents that the tool reads and writes as files anyway.
- **Running the jobs in the main thread with the existing 1 s guard limit:** a regular expression or a large state space
  blocks everybody, and the limit can only be checked between JSONata steps. Child processes would also work and isolate
  better, but cost more per job; threads with a hard `terminate()` and a heap limit are enough here.
- **A reverse proxy in the image (Caddy, nginx) for TLS:** the host already has an ingress with TLS, and a second one would
  have to be configured and renewed. The container speaks HTTP only.
- **Building the image on the host:** needs the sources and a toolchain on the GPU host and makes the host a build server.
  A versioned image from a registry is what an update and a rollback are made of.
- **Passing the key from the user's browser:** the situation before M6 (limitation 23); with a shared key in one place the
  users need none and an operator can revoke it.
- **OAuth or an identity provider for accounts:** the right answer if projects must be private; too large for M6 and not
  needed for a closed network with a shared tool.
