# The image of the Petri Net Modeling server: the web app, the server and nothing else.
#
# Build it from the root of the repository:
#
#   docker build -f deploy/Dockerfile -t pnm:dev .
#
# Build arguments:
#   NODE_IMAGE   the base image for both stages (default node:22-alpine). Set it to a mirror or to
#                the dependency proxy of GitLab if Docker Hub cannot be reached.
#   VERSION      the version, for the labels (the pipelines pass the version of package.json)
#   REVISION     the git commit, for the labels
#
# The build runs on a plain Dockerfile (no BuildKit-only features), so that kaniko in GitLab CI can
# build it without a privileged runner. The image listens on HTTP port 8080 only; TLS belongs to
# the ingress in front of it. It runs as the user "node" and keeps its projects in /data.

ARG NODE_IMAGE=node:22-alpine

# ---------------------------------------------------------------------------------------------
# Stage 1: install, build the web app (served from /) and bundle the server.
FROM ${NODE_IMAGE} AS build
WORKDIR /src
ENV CI=true
# pnpm is the version pinned in package.json ("packageManager"); corepack fetches it.
RUN corepack enable

# The manifests first: the layer with the installed packages is reused as long as they stay.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cli/package.json apps/cli/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/analysis/package.json packages/analysis/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/expr/package.json packages/expr/package.json
COPY packages/io/package.json packages/io/package.json
COPY packages/layout/package.json packages/layout/package.json
COPY packages/llm/package.json packages/llm/package.json
COPY packages/sim/package.json packages/sim/package.json
RUN pnpm install --frozen-lockfile

COPY . .
# Typecheck and build. The web app is built for the root path, VITE_BASE is left at its default.
RUN pnpm --filter @pnm/web build && pnpm --filter @pnm/server build

# ---------------------------------------------------------------------------------------------
# Stage 2: the runtime. Node and three files; no node_modules, no sources.
FROM ${NODE_IMAGE} AS runtime
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Petri Net Modeling" \
      org.opencontainers.image.description="Web app, LLM proxy, HTTP API and project store for Petri nets" \
      org.opencontainers.image.source="https://github.com/frybinski/Petri-Net-Modeling" \
      org.opencontainers.image.url="https://github.com/frybinski/Petri-Net-Modeling" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV NODE_ENV=production \
    PNM_PORT=8080 \
    PNM_DATA_DIR=/data \
    PNM_WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /src/apps/server/dist/server.js /src/apps/server/dist/worker.js /src/apps/server/dist/fake-llm.js ./
COPY --from=build /src/apps/web/dist ./web
# A named volume that is mounted here the first time takes over this owner.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PNM_PORT:-8080}/api/health" || exit 1

CMD ["node", "server.js"]
