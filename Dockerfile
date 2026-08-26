# =======================================================================
#
#                           S  W  A  O
#
#     Sovereign Workload Assessment and Onboarding
#     Docker image
#
#     Community Edition  -  Apache 2.0
#
#     Website       :  https://steady-echo-yp4z.here.now/
#     Technical Docs:  https://accenture.github.io/SWAO/en/
#     Source Code   :  https://github.com/Accenture/SWAO
#
# =======================================================================
#
# SWAO -- Sovereign Workload Assessment and Onboarding
#
# Multi-stage build (#0123; rewritten #0610 for the modular monorepo).
# Build context is the `swao/` subtree; the release.yml `publish-container`
# job sets `context: ./swao`.
#
# Why the rewrite (#0610): after the modular-architecture refactor the host
# `packages/swao` depends on the `@swao/*` workspace packages (workspace:*),
# pnpm-workspace.yaml moved to the workspace ROOT (swao/), and the runtime
# entry is the esbuild bundle `dist/bundle.cjs`. The old Dockerfile copied
# only `packages/swao/` + expected pnpm-workspace.yaml there, so it failed at
# `COPY packages/swao/pnpm-workspace.yaml` and could not have resolved the
# workspace deps. This build now installs the whole workspace, builds + bundles,
# and runs the bundle.
#
# Note: `dist/bundle.cjs` is NOT fully standalone -- esbuild keeps `fsevents`
# (optional) + `react-devtools-core` external and a few dynamic requires resolve
# from node_modules at runtime. So the runtime stage carries the built workspace
# (node_modules + dist) rather than only dist/. The standalone, asset-embedded
# distribution is the `pkg` binary (release.yml build job), not this image.

# Stage 1: install the workspace, build TypeScript, emit the bundle + staged assets.
FROM node:22-alpine AS builder
WORKDIR /repo
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install -g pnpm@10
# node-pty requires python3 + build tools (make, g++) to compile its native
# binding via node-gyp. alpine ships none of these by default.
RUN apk add --no-cache python3 make g++
# Copy the whole swao/ build context (node_modules + dist excluded via
# .dockerignore; pnpm install + the build regenerate them).
COPY . .
RUN pnpm install --frozen-lockfile
# build = tsc -b across the workspace; build:bundle (build-lib.mjs) stages the
# runtime assets (controls -> dist/_controls, community frameworks ->
# dist/_community-frameworks, powerbi templates, pdfkit data, publish assets,
# pass fixtures) into packages/swao/dist/ and emits dist/bundle.cjs.
RUN pnpm --filter @swao/swao run build \
 && pnpm --filter @swao/swao run build:bundle

# Stage 2: runtime. Carry the built workspace (node_modules + dist) so the
# bundle's externals + dynamic requires resolve; add the git/ssh prerequisites.
FROM node:22-alpine AS runtime
WORKDIR /workspace
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Runtime prerequisites (#0326 Part B):
#   git             -- `swao assess` shells out to `git clone` for source ingestion
#   openssh-client  -- the SSH-key clone path alongside HTTPS+PAT
#   ca-certificates -- HTTPS clone trust store (alpine ships it bare)
RUN apk add --no-cache git openssh-client ca-certificates
COPY --from=builder /repo /repo

# OCI labels (#0321) -- consumed by ghcr.io UI, image inspectors, and
# `docker/metadata-action` for tag derivation. The release.yml workflow also
# injects labels via the action; these are the always-present floor.
LABEL org.opencontainers.image.title="SWAO" \
      org.opencontainers.image.description="Sovereign Workload Assessment and Onboarding CLI" \
      org.opencontainers.image.vendor="Accenture x meshcloud" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/Accenture/SWAO"

# /workspace is the operator's bind-mounted portfolio; SWAO reads + writes it.
ENTRYPOINT ["node", "/repo/packages/swao/dist/bundle.cjs"]
