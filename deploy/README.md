# Running Petri Net Modeling on a server

This folder sets up the server of Petri Net Modeling with Docker Compose, next to Ollama and Open WebUI on the GPU host
(`aifb-bis-gpu01`). The server serves the web app, passes language model requests on to Open WebUI with one key that only
the server knows, offers the functions of the command line over HTTP, and stores projects with versions and share links.
How it works and what the interface looks like is in [docs/server.md](../docs/server.md); this file is about setting it up
and running it.

```
 browser in the KIT network
        |  https://<PNM_HOST>
        v
 ingress of the host (TLS, Traefik or nginx)         <- you add an entry here
        |  http://pnm:8080  (Docker network PNM_INGRESS_NETWORK)
        v
 container "pnm"  ------------------------------->  Open WebUI  (https://ollama-webui.aifb-bis-gpu01.aifb.kit.edu/api)
   web app, /llm, /api/v1, projects in the volume        key of the service account, only in .env
```

The image is built in KIT GitLab from a mirror of the GitHub repository and pulled from the container registry there. The
host builds nothing. The server speaks plain HTTP on port 8080 inside the Docker network and publishes no port; TLS is the
job of the ingress.

## What you need to know first

These are the questions that only the people who run the host can answer. The code does not depend on them; only the
`.env` file, the entry in the ingress and the settings in GitLab do.

| Question                                                                                                           | Where the answer goes                                                             |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Which ingress runs on the host: Traefik (with Docker labels, or with a configuration file), nginx, something else? | [Step 4](#4-make-the-entry-in-the-ingress)                                        |
| How is the Docker network called over which the ingress reaches its services?                                      | `PNM_INGRESS_NETWORK`                                                             |
| Which host name shall users type? It needs a DNS entry.                                                            | `PNM_HOST`, `PNM_PUBLIC_URL`                                                      |
| Is the restriction to the KIT network done in the ingress already?                                                 | the `allow` lines or the Traefik middleware; `PNM_ALLOWED_NETS` is a second fence |
| Which address range does the ingress have inside the Docker network?                                               | `PNM_TRUSTED_PROXIES`                                                             |
| Which group in KIT GitLab holds the mirror?                                                                        | `PNM_IMAGE`                                                                       |
| Does the container reach Open WebUI over the ingress (the default) or over its Docker network (faster)?            | `PNM_LLM_BASE_URL`, optionally `compose.ollama-network.yaml`                      |
| Is "KIT network" enough, or shall everyone log in as well?                                                         | `PNM_BASIC_AUTH`                                                                  |

## Overview of the steps

1. [Set up the mirror and the pipeline in KIT GitLab](#1-kit-gitlab-the-mirror-the-pipeline-and-the-image) (once).
2. [Create the service account and its key in Open WebUI](#2-open-webui-a-service-account-and-its-key) (once).
3. [Prepare the host](#3-prepare-the-host): files, registry login, `.env`.
4. [Make the entry in the ingress](#4-make-the-entry-in-the-ingress).
5. [Start and check](#5-start-and-check).

Later: [update and roll back](#update-and-roll-back), [back up](#back-up-and-restore),
[change the key](#change-the-key-of-the-language-model), [troubleshoot](#troubleshooting).

## 1. KIT GitLab: the mirror, the pipeline and the image

Development stays on GitHub. KIT GitLab keeps a copy and builds the image, so that no secret has to be stored in GitHub and
the registry can stay inside the KIT network. The pipeline is `.gitlab-ci.yml` in the root of the repository.

1. **Create a project** in the group you were given: _New project > Create blank project_, name for example
   `petri-net-modeling`, visibility _Private_ or _Internal_. Leave _Initialize repository_ off.
2. **Set up the pull mirror.** _Settings > Repository > Mirroring repositories_:
   - _Git repository URL_: `https://github.com/frybinski/Petri-Net-Modeling.git`
   - _Mirror direction_: **Pull**
   - _Authentication method_: none (the repository is public)
   - _Trigger pipelines for mirror updates_: **on**
   - press _Mirror repository_, then the update button once. Branches and tags appear.

   GitLab checks the source about once an hour; the update button fetches at once. _Pull_ mirroring is a feature of GitLab
   Premium. If the choice _Pull_ is missing on `gitlab.kit.edu`, use one of the two other ways: push from GitHub to GitLab
   with a GitHub Actions job (`git push --mirror` with a GitLab project access token that has `write_repository`; ask for
   this and it is a few lines), or build in GitHub and push the image to the registry with the workflow
   `.github/workflows/image.yml` (it needs the registry to be reachable from the internet, a deploy token with
   `write_registry` and the secrets and the variable that are named at the top of that file).

3. **Check that the registry is on:** _Settings > General > Visibility, project features, permissions > Container registry_.
   The address of the registry is shown under _Deploy > Container registry_; the image will be at
   `<registry address>/<group>/<project>`, for example `registry.gitlab.kit.edu/<group>/petri-net-modeling`.
4. **Runners.** The pipeline needs a runner with the Docker executor. It builds with kaniko and does not need a privileged
   runner. If the runners cannot reach Docker Hub or `gcr.io`, set the variables `NODE_IMAGE` and `KANIKO_IMAGE` under
   _Settings > CI/CD > Variables_ (for example `NODE_IMAGE=${CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX}/node:22-alpine`).
5. **A release builds an image.** When a tag `v1.2.0` arrives through the mirror, the pipeline runs lint, format check,
   typecheck, tests and build, builds the image from `deploy/Dockerfile` and pushes it as
   `<registry>/<group>/<project>:1.2.0`, `:1.2.0-<short commit>` and `:latest` (not for pre-releases). The job log and the
   artifact `image.txt` say which image it is. Branches and merge requests run the same checks and build the image without
   pushing it. The first run is also the test of the pipeline file itself: look at _Build > Pipelines_ and, if GitLab
   complains about the file, at _Build > Pipeline editor_.
6. **A deploy token for the host:** _Settings > Repository > Deploy tokens_, name `aifb-bis-gpu01`, scope **`read_registry`**,
   no expiry (or one you will remember). Write down the user name and the token that GitLab shows once.

## 2. Open WebUI: a service account and its key

The server uses one key for all users; users never see it. Give the key to an account of its own, so that it can be revoked
without touching a person and so that you decide which models it can use.

1. As administrator, make sure that API keys are allowed (_Admin Panel > Settings > General > Enable API Key_; the name of the
   setting depends on the version).
2. Create a user for it (_Admin Panel > Users > add_): name `petri-net-tool`, role _User_, a long random password that nobody
   needs to remember.
3. Limit what it sees: put the models that the tool may use into a group that only this user is in (_Admin Panel > Users >
   Groups_, and the access settings of the models). The server can also limit the models itself with `PNM_LLM_MODELS`, but
   the account is the stronger fence.
4. Sign in as that user once (a private window), _Settings > Account > API keys > Create new secret key_, and copy the key.
5. Test it from the host:

   ```sh
   curl -sS -H "Authorization: Bearer <the key>" https://ollama-webui.aifb-bis-gpu01.aifb.kit.edu/api/models | head -c 300
   ```

   A list of models means it works. The key goes into `.env` on the host as `PNM_LLM_API_KEY` and nowhere else: not into a
   repository, not into a chat, not into a ticket.

The server forwards only two paths, `POST /llm/v1/chat/completions` (to `<PNM_LLM_BASE_URL>/chat/completions`, for Open WebUI
`/api/chat/completions`) and `GET /llm/v1/models` (to `/api/models`), and only the usual request fields. Nothing else of
Open WebUI or Ollama is reachable through it.

## 3. Prepare the host

On `aifb-bis-gpu01`, as the user that runs Docker:

```sh
# 1. The deploy folder. Any way to get these files here is fine; the mirror needs a login, GitHub does not.
git clone --depth 1 --branch v1.2.0 https://github.com/frybinski/Petri-Net-Modeling.git
cd Petri-Net-Modeling/deploy
```

The files you need are only the ones in this folder (`compose.yaml`, the overlays, `.env.example`, `smoke-test.sh`). The
image does not come from the clone: it comes from the registry.

```sh
# 2. Log in to the registry with the deploy token of step 1 (user name and token).
docker login registry.gitlab.kit.edu        # use the address of your registry
```

Docker keeps the login in `~/.docker/config.json` of this user. `docker compose pull` uses it.

```sh
# 3. The settings.
cp .env.example .env
chmod 600 .env
$EDITOR .env
```

What to set in `.env` (every variable is explained in the file):

| Variable                                  | Value                                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PNM_IMAGE`                               | `<registry>/<group>/<project>` from step 1.3                                                                    |
| `PNM_VERSION`                             | a fixed version, for example `1.2.0`. Never `latest`                                                            |
| `PNM_INGRESS_NETWORK`                     | the Docker network of the ingress (see below)                                                                   |
| `PNM_PUBLIC_URL`                          | the address users type, `https://<host name>`                                                                   |
| `PNM_HOST`                                | the host name, if you use `compose.traefik.yaml`                                                                |
| `PNM_LLM_BASE_URL`                        | `https://ollama-webui.aifb-bis-gpu01.aifb.kit.edu/api`                                                          |
| `PNM_LLM_API_KEY`                         | the key of step 2                                                                                               |
| `PNM_LLM_MODELS`, `PNM_LLM_DEFAULT_MODEL` | optional: the models users may use and the one the app proposes                                                 |
| `PNM_TRUSTED_PROXIES`                     | the address range of the ingress in its network (see below)                                                     |
| `PNM_ALLOWED_NETS`                        | optional: the networks that may use the server. The default is the KIT range and the private ranges; confirm it |
| `PNM_BASIC_AUTH`                          | optional: a password for the whole instance (see below)                                                         |

Find the network and its address range:

```sh
docker ps --format '{{.Names}}'                                   # the name of the ingress container
docker inspect <ingress container> --format '{{json .NetworkSettings.Networks}}'     # its networks
docker network inspect <network> --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' # its address range, e.g. 172.20.0.0/16
```

`PNM_TRUSTED_PROXIES` is that address range. It matters: the server finds the address of a client in the header
`X-Forwarded-For`, but only believes the header when the request comes from one of these addresses. Without it the server
sees the address of the ingress for every request, and `PNM_ALLOWED_NETS` checks nothing useful.

If you want a password for the whole instance as well (share links keep working without it), make an entry and put it into
`PNM_BASIC_AUTH`:

```sh
printf '%s' 'the password' | docker run --rm -i registry.gitlab.kit.edu/<group>/petri-net-modeling:1.2.0 node server.js hash-password alice
# prints alice:scrypt:<salt>:<hash>
```

Which Compose files to use: `compose.yaml` alone, or with an overlay. Write the choice into `.env` so that you do not have to
type `-f` every time:

```sh
COMPOSE_FILE=compose.yaml:compose.traefik.yaml            # Traefik that reads Docker labels
COMPOSE_FILE=compose.yaml:compose.ollama-network.yaml     # also join the Docker network of Open WebUI (PNM_OLLAMA_NETWORK)
COMPOSE_FILE=compose.yaml:compose.traefik.yaml:compose.ollama-network.yaml
```

Check the result before you start:

```sh
docker compose config | less
```

## 4. Make the entry in the ingress

The ingress must reach `http://pnm:8080` over the network `PNM_INGRESS_NETWORK`, add the headers `X-Forwarded-For` and
`X-Forwarded-Proto`, allow request bodies of 10 MB (nets and event logs), and allow long answers for the language model:
`/llm/` and `POST /api/v1/domain/generate` can take minutes. Pick the variant that fits.

### Traefik with Docker labels

Use `compose.traefik.yaml` (`COMPOSE_FILE=compose.yaml:compose.traefik.yaml`, `PNM_HOST` in `.env`). It sets the router for
`Host(PNM_HOST)`, the entrypoint `websecure`, TLS, a source filter with the KIT networks and the port 8080. Check three
things against how the Traefik of the host is set up and change them in `.env` or in the file if they differ: the name of the
entrypoint (`PNM_TRAEFIK_ENTRYPOINT`), whether TLS needs a certificate resolver (`PNM_TRAEFIK_CERTRESOLVER`, then uncomment
the line), and whether the middleware is called `ipallowlist` (Traefik 3) or `ipwhitelist` (Traefik 2). The timeouts of
Traefik are those of its entrypoint (`respondingTimeouts` in the static configuration); the defaults let a long answer
through, but a `readTimeout` that someone set low would cut uploads.

### Traefik with a configuration file

Put this into the directory of the file provider (adjust the entrypoint, the resolver and the networks). The service name
`pnm` is the name of the container on the shared network:

```yaml
http:
  routers:
    pnm:
      rule: Host(`pnm.example.org`)
      entryPoints: [websecure]
      tls: {} # or: tls: { certResolver: letsencrypt }
      middlewares: [pnm-kit]
      service: pnm
  middlewares:
    pnm-kit:
      ipAllowList:
        sourceRange:
          - 129.13.0.0/16
          - 141.3.0.0/16
          - 141.52.0.0/16
          - 10.0.0.0/8
          - 172.16.0.0/12
          - 192.168.0.0/16
  services:
    pnm:
      loadBalancer:
        servers:
          - url: http://pnm:8080
```

### nginx

Inside the `server` block of the host name (the certificate lines are those of the other hosts):

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name pnm.example.org;
    # ssl_certificate ...; ssl_certificate_key ...;

    # Nets and event logs. The server itself allows PNM_MAX_BODY, 10 MB by default.
    client_max_body_size 10m;

    # Only the networks of the KIT; the server checks the address again (PNM_ALLOWED_NETS).
    allow 129.13.0.0/16;
    allow 141.3.0.0/16;
    allow 141.52.0.0/16;
    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    allow 192.168.0.0/16;
    deny all;

    # nginx in a container on the same Docker network finds the service by name. The variable makes
    # nginx look the name up when it is used, so it also starts while pnm is down.
    resolver 127.0.0.11 valid=10s;
    set $pnm http://pnm:8080;

    location / {
        proxy_pass $pnm;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Language model: answers take a while and may be streamed.
    location /llm/ {
        proxy_pass $pnm;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Generating a domain view asks the model up to three times.
    location = /api/v1/domain/generate {
        proxy_pass $pnm;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

If nginx runs on the host and not in a container, it cannot use the Docker name. Then give the service a fixed address in the
network, or let nginx join the network; the design is that the ingress is a member of `PNM_INGRESS_NETWORK`.

### Kubernetes ingress or something else

The requirements are the same as above: target `http://pnm:8080`, the two headers, a request body limit of at least 10 MB, a
read timeout of at least 300 s on `/llm/` and 600 s on `/api/v1/domain/generate`, no buffering of `/llm/` answers.

## 5. Start and check

```sh
docker compose pull
docker compose up -d
docker compose ps                 # "healthy" after a few seconds
docker compose logs --tail 20 pnm # one JSON line per request; "listening" at the start
```

Then, from your own machine (inside the KIT network or on the VPN):

```sh
curl -sS https://pnm.example.org/api/health
./smoke-test.sh https://pnm.example.org
```

`smoke-test.sh` goes through the web app, the API, the project store and the language model. A failed line names the check;
see [troubleshooting](#troubleshooting). Open the address in a browser: the status bar shows `Server: aifb-bis-gpu01` (or the
`PNM_SERVER_NAME`), _File > Open from server_ is in the menu, and _Settings_ offers the preset _Server (Ollama)_ without a key
field.

## Update and roll back

An update is a change of the version, not a build on the host:

```sh
# 1. Look at the changelog of the new version (CHANGELOG.md), then:
$EDITOR .env                      # PNM_VERSION=1.3.0
docker compose pull
docker compose up -d              # replaces the container; the data volume stays
docker compose ps && ./smoke-test.sh https://pnm.example.org
```

To go back, put the old version in `.env` and run `docker compose pull && docker compose up -d` again. The old image is still
in the registry. The projects are unchanged by an update: versions are plain files that are only ever added. If a later
version changes the format of the data, its changelog says so; take a [backup](#back-up-and-restore) before such an update.

Pushing a new tag to GitHub is what makes the next version: it arrives in GitLab by the mirror, the pipeline builds the
image, and then it can be pulled.

## Back up and restore

Everything the server keeps is in one Docker volume, `pnm_pnm-data` (the project name `pnm` and the volume `pnm-data`):
`projects/<id>/` with `meta.json` and the versions `v0001.pn.json`, ..., and `trash/`. There is no database. Files are
written to a temporary file and renamed, so a copy taken while the server runs is consistent per file; for a copy that is
consistent as a whole, stop the server first (`docker compose stop`).

```sh
docker volume ls | grep pnm-data                          # the exact name
docker run --rm -v pnm_pnm-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/pnm-data-$(date +%F).tgz -C / data

# restore into an empty volume (server stopped):
docker run --rm -v pnm_pnm-data:/data -v "$PWD":/backup alpine \
  sh -c 'cd / && tar xzf /backup/pnm-data-2026-10-29.tgz && chown -R 1000:1000 /data'
```

Run the backup from cron or a timer if the projects matter. The volume contains no key; the key is in `.env`, which belongs
to the backup of the host's configuration.

## Change the key of the language model

1. In Open WebUI, as `petri-net-tool`: create a **new** secret key (_Settings > Account > API keys_).
2. Put it into `.env` as `PNM_LLM_API_KEY`.
3. `docker compose up -d` (a changed variable recreates the container).
4. `./smoke-test.sh https://pnm.example.org`, or in the app _Settings > Test connection_.
5. Delete the old key in Open WebUI.

If a key may have leaked, delete it first and accept a short break. The server logs the line `llm upstream refused the key`
while the key is wrong, and users see "The language model server refused the key of this server. Tell the operator."

## Try it on your own machine

```sh
docker compose -f deploy/compose.local.yaml up --build
# http://localhost:8080
```

This builds the image from the source tree, listens on `localhost:8080` only and starts a stand-in for the language model
server (`fake-llm.js` from the same image), so no GPU is needed. The stand-in answers with a fixed text, so _Generate with
LLM_ ends with the generic view. `docker compose -f deploy/compose.local.yaml down -v` removes everything including the data.

## What the logs contain

One JSON line per request: time, method, path (share tokens are replaced by `:token`), status, duration, bytes. One line per
language model request: time, model, duration, the time it waited, token counts, status. No prompts, no nets, no answers,
no key, no user names, and no client addresses, except a `denied` line that names the address that the client filter refused,
so that you can see which range is missing from `PNM_ALLOWED_NETS`.

```sh
docker compose logs -f pnm
docker compose logs pnm | grep '"msg":"denied"'
docker compose logs pnm | grep '"msg":"llm"' | tail
```

## Troubleshooting

| What you see                                                                    | Likely cause and what to do                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose` says a variable "is missing a value"                           | `.env` lacks `PNM_IMAGE`, `PNM_VERSION`, `PNM_PUBLIC_URL` or `PNM_INGRESS_NETWORK`                                                                                                                                                                                                                                                                                              |
| `docker compose pull`: "unauthorized" or "denied"                               | the login is missing or wrong: `docker login <registry>` with the deploy token (`read_registry`); the image name must match the project path                                                                                                                                                                                                                                    |
| `docker compose pull`: "manifest unknown"                                       | that version has not been built: look at the pipeline for the tag in GitLab                                                                                                                                                                                                                                                                                                     |
| the container restarts, `docker compose logs pnm` shows "Invalid configuration" | a value in `.env` is wrong; the message names the variable. `docker compose run --rm pnm node server.js check-config` prints what the server understood (without secrets)                                                                                                                                                                                                       |
| "Cannot write to PNM_DATA_DIR"                                                  | the volume or folder is not writable for the user `node` (uid 1000). A named volume takes the right owner on first use; for a bind mount run `chown -R 1000:1000 <folder>`                                                                                                                                                                                                      |
| the ingress answers 502 or 504                                                  | the ingress does not reach `pnm:8080`: check that both are on `PNM_INGRESS_NETWORK` (`docker network inspect`), that the service name is `pnm`, and that the container is healthy                                                                                                                                                                                               |
| `403 forbidden` for everybody                                                   | the address range is not in `PNM_ALLOWED_NETS`, or `PNM_TRUSTED_PROXIES` does not contain the ingress, so the server sees the ingress address instead of the client. The log line `"msg":"denied"` names the address it saw                                                                                                                                                     |
| `403` only through the ingress                                                  | the filter of the ingress itself (`allow`/`deny`, `ipAllowList`) refuses; its log says which address it saw                                                                                                                                                                                                                                                                     |
| `401` in the browser                                                            | `PNM_BASIC_AUTH` is set; sign in with the user and password of the entry                                                                                                                                                                                                                                                                                                        |
| the app does not show server functions                                          | `GET /api/health` does not reach the server: the ingress sends `/api/` somewhere else, or a cached page is old (reload)                                                                                                                                                                                                                                                         |
| _Server (Ollama)_ is missing in the settings                                    | `PNM_LLM_BASE_URL` is empty, so `features.llm` is false: `curl .../api/health`                                                                                                                                                                                                                                                                                                  |
| "The language model server refused the key"                                     | the key is wrong or revoked: step 2, then [change the key](#change-the-key-of-the-language-model)                                                                                                                                                                                                                                                                               |
| "The language model server could not be reached"                                | `PNM_LLM_BASE_URL` is wrong or not reachable from the container. Test inside: `docker compose exec pnm wget -qO- https://ollama-webui.aifb-bis-gpu01.aifb.kit.edu/api/models` (401 means: reachable). If the certificate of the upstream is signed by a CA that Node does not know, add the CA file as a volume and set `NODE_EXTRA_CA_CERTS` in the environment of the service |
| the model list is empty                                                         | `PNM_LLM_MODELS` names models that the account cannot see, or the account sees none                                                                                                                                                                                                                                                                                             |
| answers are cut off after 60 s                                                  | the timeouts of the ingress (see step 4), not of the server (`PNM_LLM_TIMEOUT`, 180 s)                                                                                                                                                                                                                                                                                          |
| uploads of big nets fail with 413                                               | `client_max_body_size` of the ingress, or `PNM_MAX_BODY` of the server                                                                                                                                                                                                                                                                                                          |
| `429` from `/llm/`                                                              | two requests run at a time and ten wait; more are refused. Wait and retry                                                                                                                                                                                                                                                                                                       |
| `504 timeout` from the API                                                      | a job needed more than `PNM_JOB_TIMEOUT` (60 s) and was stopped; use a smaller net or lower limits                                                                                                                                                                                                                                                                              |
| `422 resource_limit`                                                            | a job needed more than `PNM_WORKER_MEMORY` (512 MB)                                                                                                                                                                                                                                                                                                                             |
| share links open the wrong address                                              | `PNM_PUBLIC_URL`                                                                                                                                                                                                                                                                                                                                                                |
| the ingress strips `X-Forwarded-For`                                            | the client filter then sees the ingress address; configure the ingress to add the header                                                                                                                                                                                                                                                                                        |

## Security notes

- The server is meant for the KIT network. Do not put it on the internet without the ingress filter and
  `PNM_BASIC_AUTH`; share links work without the password by design.
- Anyone in the allowed networks can read, change and delete every project: there are no accounts. A share link is a
  convenience, not a lock, once someone can reach the project list. If that is not enough, set `PNM_BASIC_AUTH`.
- The key of Open WebUI is in `.env` and in the environment of the container (`docker inspect` shows it to whoever can run
  Docker on the host). It is not in the image, the volume, the logs, the answers or the browser. Give the account only the
  models the tool needs.
- The container runs as an unprivileged user with a read-only root file system, without capabilities, and with memory and CPU
  limits (`PNM_MEMORY_LIMIT`, `PNM_CPUS`). The job threads that run the analyses have no copy of the environment, so they
  never see the key.
- Requests that change data must have the content type `application/json` and, if they carry an `Origin`, come from the
  server's own address. This keeps a web page from another site from acting with your rights.
