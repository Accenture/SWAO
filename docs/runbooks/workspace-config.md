=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Runbook: Workspace Configuration

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Workspace Configuration

The `.swao.yml` file is the primary configuration surface for a SWAO workspace. This runbook covers the full set of available options, including custom pass configuration, exclusions, multi-repo layouts, and environment variable overrides.

---

## Annotated .swao.yml reference

```yaml
# .swao.yml -- full annotated example

workspace:
  name: my-portfolio          # display name used in reports
  schema_version: "1.3"       # must match the version expected by the installed binary

llm:
  provider: anthropic         # anthropic | ollama | openai | stub
  model: claude-3-5-sonnet-20241022   # provider-specific model id (optional; defaults apply)
  base_url: ~                 # override endpoint (used for ollama; ~ = default)

passes:
  enabled:                    # list the passes you want to run
    - static
    - context
    - compliance
    - security
    - llm
    - dynamic                 # requires Playwright; omit if browser not available
  config:
    compliance:
      frameworks:
        - GDPR
        - NIST_SP_800_66R2    # built-in framework slugs from swao/controls/
        - custom/my-framework # path to a custom framework relative to workspace root
    security:
      sast_enabled: true      # run SAST analysis on source references
    llm:
      temperature: 0          # deterministic output; recommended for assessments

apps:
  - id: app-one
    display_name: Application One
    source_path: ./apps/app-one/src   # optional; used by static and SAST passes
    exclusions:
      paths:
        - "vendor/**"
        - "node_modules/**"
        - "dist/**"
      pass_ids:               # skip specific passes for this app
        - dynamic

  - id: app-two
    display_name: Application Two
    source_path: ./apps/app-two/src

output:
  path: ./wsp                 # root for all run directories
  formats:
    - json                    # always emitted
    - pdf                     # requires report pass; Consultant+ for gallery
    - csv                     # star-schema bundle for Power BI
```

---

## Pass keys

| Pass key | What it does |
|---|---|
| `static` | Inventory scan -- file types, dependency lists, framework detection |
| `dynamic` | Browser-driven probe (requires Playwright + Chromium) |
| `context` | Ingests CSV/JSON context files (CMDB exports, FinOps data) |
| `compliance` | Maps inventory against selected control frameworks |
| `security` | SAST analysis + container image scanning (where configured) |
| `llm` | LLM-driven analysis pass -- generates narrative findings and migration recommendations |

Disable a pass globally by removing it from `passes.enabled`, or per-app via `exclusions.pass_ids`.

---

## Multi-repo layout

When the portfolio spans multiple git repositories, use a nested apps layout with per-app `source_path` values pointing to the relevant checkout location:

```yaml
apps:
  - id: frontend
    display_name: Frontend Service
    source_path: ../frontend-repo/src

  - id: backend
    display_name: Backend API
    source_path: ../backend-repo/api

  - id: infra
    display_name: Infrastructure
    source_path: ../infra-repo/terraform
```

Paths are resolved relative to the directory containing `.swao.yml`. Absolute paths are also accepted.

---

## Environment variable overrides

Any `.swao.yml` scalar value can be overridden at runtime with an environment variable. The naming convention is `SWAO_` followed by the YAML path in uppercase with underscores:

| YAML path | Environment variable |
|---|---|
| `llm.provider` | `SWAO_LLM_PROVIDER` |
| `llm.model` | `SWAO_LLM_MODEL` |
| `output.path` | `SWAO_OUTPUT_PATH` |

Environment variable overrides are applied after the `.swao.yml` is parsed, so they always win.

---

## Exclusions

Exclusions prevent specific paths or passes from being included in the analysis without removing them from the source tree:

```yaml
apps:
  - id: my-app
    exclusions:
      paths:
        - "test/**"           # glob patterns relative to source_path
        - "**/*.generated.ts"
      pass_ids:
        - dynamic             # skip the dynamic pass for this app only
```

Global exclusions (applying to all apps) are not currently supported. Use per-app exclusion blocks.

---

## Validating your configuration

```bash
# Validate .swao.yml without running an assessment
swao health-check

# Check with verbose output to see parsed config
swao health-check --verbose
```

`swao health-check` parses and validates `.swao.yml` as part of its workspace probe. Any schema errors or unrecognised keys are reported before the assessment runs.
