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
  provider: anthropic         # anthropic | ollama | openai
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
| `static` | Inventory scan: file types, dependency lists, framework detection |
| `dynamic` | Browser-driven probe (requires Playwright + Chromium) |
| `context` | Ingests CSV/JSON context files (CMDB exports, FinOps data) |
| `compliance` | Maps inventory against selected control frameworks |
| `security` | SAST analysis + container image scanning (where configured) |
| `llm` | LLM-driven analysis pass: generates narrative findings and migration recommendations |

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

## MCP tool profile

The workspace `.swao.yml` can set which tools `swao mcp` offers to external AI clients (#3474):

```yaml
mcp:
  profile: starter        # starter | assess | full (default full)
  # tools: [swao, swao_health_check]   # alternative to profile: exact tool names
```

`profile` and `tools` are mutually exclusive. The `swao mcp --profile` / `--tools` flag and the
environment variables `SWAO_MCP_PROFILE` / `SWAO_MCP_TOOLS` win over this block. See the MCP integration
runbook for what each profile contains.

---

## Code health (Pass 26)

The optional `assessment.code_health` block tunes the code health pass (#3487). Every key is optional;
without the block a run is unchanged.

```yaml
assessment:
  code_health:
    top_n: 25                     # worklist length, 1 to 500 (default 25)
    endpoint_allowlist:           # hosts Pass 26 does not count as hard-coded
      - api.partner.example       # exact host
      - .corp.example             # the domain and every subdomain
      - 10.20.30.40               # IPv4 or IPv6 literal
    tools: [lizard, jscpd]        # opt-in tool enrichment (default: none)
    tool_timeout_seconds: 300     # ceiling per tool run, 10 to 3600 (default 300)
```

- **Precedence:** each key is read from the app `.swao.yml` first, then from the workspace `.swao.yml`.
  A list is taken whole from the file that declares it; an app `tools: []` switches the tools off.
- **Allowlist:** entries are host names, `.suffix` entries, IPv4 or IPv6 literals; a scheme, port, path
  or wildcard is refused when the file is read. The allowlist applies to Pass 26 only: Pass 07 (egress)
  and the TF-01 configuration evidence still report allowlisted hosts. The run records the list and the
  number of allowlisted literals under `assessment.code_health.endpoint_allowlist`.
- **Tools:** lizard (per-function cyclomatic complexity, supported 1.17.x) and jscpd (clone detection,
  supported 4.x) run only when listed. Install them with `pip install "lizard>=1.17,<1.18"` and
  `npm install -g jscpd@4`. Their results are stored under `assessment.code_health.tools` and summarised
  in signal `QUAL-08`; the built-in scores, KPIs and worklist never change. A missing tool, an unsupported
  version, a failure or a timeout is reported in `QUAL-08` (informational) and the run continues.
  `swao health-check` lists both tools under Prerequisites with their version or "not found".

---

## Validating your configuration

```bash
# Validate .swao.yml without running an assessment
swao health-check

# Check with verbose output to see parsed config
swao health-check --verbose
```

`swao health-check` parses and validates `.swao.yml` as part of its workspace probe. Any schema errors or unrecognised keys are reported before the assessment runs.
