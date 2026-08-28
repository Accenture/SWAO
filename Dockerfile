# =======================================================================
#
#                           S  W  A  O
#
#     Sovereign Workload Assessment and Onboarding
#     Docker image -- Community Edition
#
#     Community Edition  -  Apache 2.0
#
#     Website       :  https://steady-echo-yp4z.here.now/
#     Technical Docs:  https://accenture.github.io/SWAO/en/
#     Source Code   :  https://github.com/Accenture/SWAO
#
# =======================================================================
#
# SWAO -- Sovereign Workload Assessment and Onboarding (Community Edition)
#
# Multi-stage build. Build context is the `swao/` subtree; the release.yml
# `publish-container` job sets `context: ./swao`.
#
# This file builds the Community-tier image (bundle-community.cjs). It is the
# default Dockerfile used by the public Accenture/SWAO CI. For Consultant and
# Enterprise images, see Dockerfile.consultant and Dockerfile.enterprise
# respectively (built exclusively by the private CI).
#
# Fixed sprint-128 #2128: the previous Dockerfile used the Enterprise bundle
# entry (dist/bundle.cjs, src/index.ts full wiring) while being labelled
# Community. This file now correctly targets dist/bundle-community.cjs.
#
# Note: `dist/bundle-community.cjs` is NOT fully standalone -- a few dynamic
# requires resolve from node_modules at runtime. The runtime stage carries the
# built workspace (node_modules + dist) rather than only dist/.

# Stage 1: install the workspace, build TypeScript, emit the community bundle.
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
# Remove swao-premium workspace glob -- premium packages are not present in the
# Community build context (public Accenture/SWAO checkout, ADR-0058 isolation).
RUN sed -i '/swao-premium/d' pnpm-workspace.yaml
RUN pnpm install
# Build TypeScript then run the community-tier bundle (esbuild, no pkg).
# build-community.mjs --no-pkg copies runtime assets (controls, community-
# frameworks, powerbi templates, publication assets, pass fixtures) and
# emits dist/bundle-community.cjs. Premium module code is excluded by esbuild
# tree-shaking at the community.ts entry point.
RUN pnpm --filter @swao/swao run build \
 && cd packages/swao \
 && node scripts/build-community.mjs --no-pkg

# Stage 2: runtime. Carry the built workspace (node_modules + dist) so the
# bundle's externals + dynamic requires resolve; add the git/ssh prerequisites.
FROM node:22-alpine AS runtime
WORKDIR /workspace
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV SWAO_BINARY_TIER=community
# Runtime prerequisites:
#   git             -- `swao assess` shells out to `git clone` for source ingestion
#   openssh-client  -- the SSH-key clone path alongside HTTPS+PAT
#   ca-certificates -- HTTPS clone trust store (alpine ships it bare)
RUN apk add --no-cache git openssh-client ca-certificates
COPY --from=builder /repo /repo

# OCI labels -- consumed by ghcr.io UI, image inspectors.
LABEL org.opencontainers.image.title="SWAO Community" \
      org.opencontainers.image.description="SWAO -- Sovereign Workload Assessment and Onboarding (Community Edition, Apache-2.0)" \
      org.opencontainers.image.vendor="Accenture" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/Accenture/SWAO"

# /workspace is the operator's bind-mounted portfolio; SWAO reads + writes it.
ENTRYPOINT ["node", "/repo/packages/swao/dist/bundle-community.cjs"]
