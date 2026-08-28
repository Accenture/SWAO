<p align="center">
  <img src="docs/brand/assets/logo-horizontal-dark.png" alt="SWAO -- Sovereign Workload Assessment and Onboarding" width="700" />
</p>


# SWAO -- Sovereign Workload Assessment and Onboarding

**Accenture** &nbsp;|&nbsp; Enterprise Cloud Migration

[![Docs](https://github.com/Accenture/SWAO/actions/workflows/pages.yml/badge.svg)](https://github.com/Accenture/SWAO/actions/workflows/pages.yml)
[![Licence](https://img.shields.io/badge/licence-Apache--2.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/github/v/release/Accenture/SWAO)](https://github.com/Accenture/SWAO/releases/latest)
[![Community Edition](https://img.shields.io/badge/Community-free--no%20registration-green.svg)](https://github.com/Accenture/SWAO/releases/latest)

**Website:** https://steady-echo-yp4z.here.now/ &nbsp;|&nbsp; **Docs:** https://accenture.github.io/SWAO/en/

SWAO is an AI-accelerated cloud migration assessment CLI. Given a client's source code and
operational context, it produces a **Workload Sovereignty Profile (WSP)** -- a machine-readable
YAML artefact covering cloud readiness, compliance posture, security findings, and a migration
plan -- then hands off to meshStack for automated tenant provisioning.

---

## What it does

```
# Workspace + assessment
swao init --name my-app     # scaffold a new assessment workspace
swao assess --app my-app    # run multi-pass analysis, emit WSP under wsp/runs/<ts>/
swao report --app my-app    # render auditor / business / WSP-summary reports
swao generate-tf --app X    # emit Terraform HCL for the target landing zone
swao health-check                 # 10-probe pre-flight (licence, Playwright, MCP,
                            # compliance catalogues, imports, traceability,
                            # BI export, scope, prerequisites, vcs-auth)

# Observability + feedback
swao log tail               # stream the WSP-scoped event log (warn+ default)
swao log export --for-feedback --out feedback.tar.gz
                            # PII-redacted bundle ready to email back

# Compliance frameworks
swao framework list         # enumerate bundled + installed community frameworks
swao framework install <id> # copy bundled framework into the workspace
swao framework info <id>    # print classification, contributor, applicability

# LLM provider configuration
swao credential set anthropic-api-key sk-ant-...
swao credential set openai-api-key sk-...
SWAO_LLM_PROVIDER=anthropic|openai|ollama|stub  # rotate at run time
```

Static + dynamic analysis passes -- Inventory (Pass 01), Statefulness (02),
Data Classification (03), Context Ingestion (04), SBOM CVE (05), 12-Factor (06),
Egress (07), Cryptography Posture (08), Synthesis (09), Dynamic Analysis /
Playwright crawl (10), Compliance Evaluation (11), Block Assessments (12),
Scope Coverage (13) -- produce namespaced signals (`INV-01`, `EGR-03`,
`CRYPTO-07`, ...) that feed the WSP. The Context Ingestion Layer reads
consultant-supplied context files (`imports/`) and records any contradictions
with source-code evidence. Dynamic analysis is opt-in via `--passes dynamic`
or runs by default in full sweeps (skip with `--no-crawl`).

**LLM providers:** Anthropic (default, recommended per ADR-0034), OpenAI
(`gpt-4o-mini` default; `gpt-5-mini` / `gpt-5` configurable), Ollama
(air-gapped, local models), stub (CI / offline).

**Compliance frameworks:** 11 community frameworks ship bundled and free (GDPR,
AI 10 Pillars, BSI C5, BSI IT-Grundschutz 2023, HIPAA / NIST SP 800-66r2, LLM
Selection, NCA CCC 2024 CSP, NCA CCC 2024 CST, NCA ECC 2024, PCI-DSS v4, SAMA
CSF v1). Install into a workspace via `swao framework install <id>`.

> **Operator references**
> - **CLI command reference:** [`docs/runbooks/cli-reference.md`](docs/runbooks/cli-reference.md)
>   -- when to reach for each subcommand and how they chain across an engagement.
> - **Batch samples:** [`ops/batch-samples/`](ops/batch-samples/) -- ready-to-edit Windows
>   `.cmd` and POSIX `.sh` scripts for "assess N apps + emit portfolio BI bundle" in one run.
> - **In-binary help:** `swao --help`, `swao <subcommand> --help` -- auto-generated and
>   always the source of truth for flag details.

---

## Repository layout

```
swao/
+-- packages/
|   +-- swao/          # CLI binary (Commander.js, TypeScript strict)
|   +-- providers/     # Pluggable provider drivers
+-- examples/
|   +-- publications/  # Sample HTML assessment publications
+-- docs/
|   +-- runbooks/      # Setup guides
+-- controls/          # Compliance control catalogue
+-- landing-page/      # Marketing landing page (standalone HTML)
```

---

## Installation

Download the latest binary from **https://github.com/Accenture/SWAO/releases/latest**
and add it to your PATH. See [docs/runbooks/install.md](docs/runbooks/install.md) for
platform-specific steps (Windows, macOS Gatekeeper, Linux), checksum verification, and
the Docker alternative.

---

## Quick start

```bash
# 1. Scaffold a new workspace (creates apps/, wsp/, .swao.yml)
swao init my-workspace

# 2. Verify prerequisites (licence, credentials, catalogues, BI templates)
swao health-check

# 3. Add an LLM API key (Anthropic recommended; or use OpenAI / Ollama)
swao credential set anthropic-api-key sk-ant-...

# 4. Run a full assessment against your application
swao assess --app my-app

# 5. Render reports (auditor, business value, WSP summary)
swao report --app my-app
```

Static passes complete in ~30 seconds; LLM passes (synthesis, compliance evaluation,
block assessments) take 3-8 minutes depending on codebase size and LLM provider latency.
The `swao assess` TUI shows per-pass progress and a live output window.

---

## Interfaces

### CLI

The primary interface for scripted + batch assessments. Every capability is reachable
via `swao <subcommand> [flags]`. Use `swao --help` or `swao <subcommand> --help` for
flag details.

Key subcommands: `init`, `assess`, `report`, `doctor`, `framework`, `credential`,
`log`, `generate-tf`, `export`, `mcp`.

Reference: [`docs/runbooks/cli-reference.md`](docs/runbooks/cli-reference.md)

### TUI

The interactive terminal UI guides operators through assessment setup: choose an app,
select passes to run, toggle the LLM provider, monitor live output, and launch the BI
export bundle -- all from a single keyboard-driven session. Launch with `swao assess`
(no flags) and navigate with arrow keys + Enter.

Key screens: Assessment Type picker, App selector, Pass selector, Live output (bounded
viewport, Ctrl+G for guidance), BI export panel with hot-keys for PowerBI Desktop.

### MCP

SWAO exposes an MCP server that Claude Desktop and Claude Code connect to over
`http://localhost:3737`. Start it with `swao mcp --http` then point your Claude client
at the local endpoint. The server exposes tools for assessment orchestration, signal
inspection, and report generation -- enabling conversational "run the assessment on my
app and tell me what the sovereign risk factors are" workflows.

Architecture: ADR-0045 (`docs/adr/0045-mcp-dual-transport-http-localhost-for-claude-code.md`)

### PowerBI

SWAO ships `.pbit` template files for four report surfaces:

- **App Report** -- per-application sovereignty profile, migration recommendation, compliance
  heatmap, egress map, and risk scores.
- **Portfolio Overview** -- multi-app roll-up view for programme leads and client executives.
- **Auditor View** -- control-level evidence table and gap analysis for auditor sign-off.
- **Compliance Matrix** -- cross-framework overlap view (GDPR / HIPAA / PCI DSS / ISO 27001 / ...).

After `swao assess` completes, run `swao export` (or press Enter in the TUI) to emit the
CSV + NDJSON + XLSX bundle, then open the template and point `SWAOExportPath` at the bundle
directory.

Authoring guide: available to licensed Consultant and Enterprise users on request.

---

## Getting started

**Prerequisites:** Node.js 20+ LTS, pnpm 10+

```bash
git clone https://github.com/Accenture/SWAO.git
cd SWAO/swao
pnpm install          # install workspace dependencies
pnpm build            # compile TypeScript
pnpm test             # run test suite
node dist/swao.js --help
```

### Docker quick-start

```bash
# Build the image (from repo root)
bash scripts/build-image.sh

# Run an assessment -- mount your portfolio directory at /workspace
docker run --rm \
  -v "$(pwd)/my-portfolio":/workspace \
  -e SWAO_CREDENTIAL_ANTHROPIC_API_KEY="sk-ant-..." \
  accenture/swao:dev assess --app my-app

# Other commands work the same way
docker run --rm accenture/swao:dev --help
docker run --rm accenture/swao:dev --version
docker run --rm -v "$(pwd)/my-portfolio":/workspace accenture/swao:dev doctor
```

The image is built from a multi-stage Dockerfile: TypeScript is compiled in a build
stage, then only production dependencies and compiled output are included in the runtime
image. Playwright browser binaries are excluded to keep the image lean (target: under 400 MB).

Inspect the image size after `scripts/build-image.sh` completes:

```bash
docker images accenture/swao:dev --format "{{.Repository}}:{{.Tag}} {{.Size}}"
```

The published ghcr.io multi-arch image (`ghcr.io/accenture/swao:latest`) is
cross-compiled for `linux/amd64` and `linux/arm64`; pull either via
`docker pull ghcr.io/accenture/swao:latest` and inspect with `docker inspect`.

---

---

## Compliance frameworks

SWAO ships 11 bundled community frameworks (Apache-2.0, free to use):

| ID | Framework | Sector |
|---|---|---|
| `GDPR` | General Data Protection Regulation 2016/679 | Cross-sector, EU |
| `AI_10_PILLARS` | AI 10 Pillars -- Accenture responsible AI framework | AI/ML, cross-sector |
| `BSI_C5` | BSI Cloud Computing Compliance Criteria Catalogue 2020 | Cloud, Germany |
| `BSI_IT_GRUNDSCHUTZ_2023` | BSI IT-Grundschutz 2023 | IT security, Germany |
| `NIST_SP_800_66R2` | NIST SP 800-66r2 / HIPAA Security Rule guidance | Healthcare, US |
| `LLM_SELECTION` | LLM Selection -- sovereignty benchmarking for AI providers | AI/ML, cross-sector |
| `NCA_CCC_2_2024_CSP` | NCA Cloud Cybersecurity Controls 2.0 (Cloud Service Provider) | Cloud, Saudi Arabia |
| `NCA_CCC_2_2024_CST` | NCA Cloud Cybersecurity Controls 2.0 (Cloud Service Tenant) | Cloud, Saudi Arabia |
| `NCA_ECC_2_2024` | NCA Essential Cybersecurity Controls 2.0 | Cybersecurity, Saudi Arabia |
| `PCI_DSS` | PCI DSS 4.0.1 -- Payment Card Industry Data Security Standard | Financial, global |
| `SAMA_CSF_V1` | SAMA Cyber Security Framework v1.0 | Financial, Saudi Arabia |

Install a framework into the active workspace:

```bash
swao framework list                 # enumerate bundled + installed frameworks
swao framework install GDPR         # copy bundled framework into workspace
swao framework info NIST_SP_800_66R2  # print authority, controls count, contributor
```

Organisations can author custom frameworks by providing a `framework-meta.yaml` +
`controls.yaml` pair and placing them in `catalogs/community/<slug>/`. See ADR-0035
(`docs/adr/0035-community-frameworks-scope.md`) for the schema specification.

---

## Release model

SWAO follows semantic versioning (MAJOR.MINOR.PATCH). Community, Consultant, and Enterprise
tier binaries are built from the same source at each tagged release; tier boundaries are
enforced at runtime via `requireTier` guards (ADR-0049).

Release procedure: [`docs/runbooks/RELEASE.md`](docs/runbooks/RELEASE.md) -- covers
version bump, binary build (4 platforms), VirusTotal gate, SBOM + checksum publication,
Docker multi-arch push, and the macOS ARM smoke-test checklist.

New releases are tagged on `main` via `v*` tags (e.g. `v0.4.3`) which trigger the
`release.yml` GitHub Actions workflow automatically.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on
submitting issues, pull requests, compliance frameworks, and provider drivers.
Questions and discussion: [GitHub Discussions](https://github.com/Accenture/SWAO/discussions).

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

**Maintainer:** Accenture

---

## Licence

Community edition: Apache-2.0, free and unlimited. Consultant and Enterprise tiers: commercial
licence, machine-bound, signed offline keys, issued by Accenture. See `SPEC.md §4.4` for the
three-tier feature boundary.

Third-party software notices are listed in [NOTICES](NOTICES).
