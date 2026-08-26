# Application Assessment

Application Assessment is the core SWAO workflow. Given an application's source code,
it runs up to 14 analysis passes and produces an audit-grade evidence chain covering
compliance, migration readiness, security posture, and data handling.

All other assessment types depend on a completed Application Assessment for their
baseline context.

---

## How it works

SWAO reads the application source tree and runs analysis passes sequentially. Each pass
is independent and writes its output to a named YAML file under `wsp/runs/<timestamp>/passes/`.
The outputs of earlier passes feed into later ones -- for example, the data classification
pass informs both the compliance evaluation and the migration synthesis.

Three categories of passes exist:

- **Deterministic passes** -- no LLM required. Run from pattern matching, AST analysis,
  and SBOM tooling. Examples: inventory, SBOM, cryptography, malware scan.
- **LLM-assisted passes** -- call the configured LLM provider to produce rationale for
  each signal and compliance verdict. Passes: context ingestion (ctx), compliance
  evaluation (comp), compliance blocks (blocks), migration synthesis (synth).
- **Dynamic passes** -- launch a headless Chromium browser (Playwright) to crawl the
  running application and capture screenshots. The vision pass sends those screenshots
  to the LLM for multimodal analysis.

---

## Analysis passes

| # | Pass key | Name | Type | Description |
|---|---|---|---|---|
| 1 | `inv` | Inventory | Deterministic | Maps languages, frameworks, and dependencies |
| 2 | `state` | State analysis | Deterministic | Identifies stateful components: databases, session storage, caches |
| 3 | `data` | Data classification | Deterministic | Finds personal data fields, PII columns, and residency markers |
| 4 | `ctx` | Context ingestion | LLM-assisted | Reads CMDB exports, workshop transcripts, and architecture documents |
| 5 | `sbom` | SBOM | Deterministic | Produces a Software Bill of Materials with licence classification |
| 6 | `tf` | Twelve-factor | Deterministic | Checks cloud-readiness against the 12-factor application standard |
| 7 | `egr` | Egress analysis | Deterministic | Maps outbound calls and third-party data transfers |
| 8 | `crypto` | Cryptography | Deterministic | Reviews hashing, TLS configuration, and secrets handling |
| 9 | `dynamic` | Dynamic analysis | Dynamic | Browser crawl for UI surface mapping and screenshot capture |
| 10 | `comp` | Compliance evaluation | LLM-assisted | Maps signals to the active compliance frameworks with rationale |
| 11 | `blocks` | Compliance blocks | LLM-assisted | Identifies blocking compliance gaps and their remediation paths |
| 12 | `synth` | Migration synthesis | LLM-assisted | Produces a 7R verdict (Retire, Retain, Rehost, Replatform, Refactor, Re-architect, Repurchase) |
| 13 | `scope` | LZ catalogue fit | Deterministic | Checks fit against the configured cloud landing zone catalogue (alias: `lzr`) |
| 14 | `malware` | Malware scan | Deterministic | Identifies malware patterns and suspicious binary artefacts in source (alias: `mal`) |

Running all 14 passes is the default. Use `--passes` to run a subset.

---

## Output artefacts

After a completed assessment run:

```
wsp/
+-- runs/<timestamp>/
|   +-- passes/
|   |   +-- 01-inv.yaml           inventory signals
|   |   +-- 02-state.yaml         state analysis
|   |   +-- ...                   one YAML file per pass, in canonical order
|   |   +-- 14-malware.yaml       malware scan results
|   +-- run-manifest.json         LLM provider, cost, schema version
+-- exports/<timestamp>/
|   +-- star/                     17 CSV files (star schema, UTF-8 BOM)
|   +-- ndjson/                   17 mirror files for ETL pipelines
|   +-- xlsx/swao-export.xlsx     18-sheet Excel workbook
|   +-- manifest.yaml             SHA-256 and row counts per file
+-- publications/latest/
|   +-- index.html                self-contained HTML publication
+-- reports/auditor.md            Markdown audit report
```

Every signal in the WSP carries:

- `outcome` -- PASS, FAIL, WARNING, or INFO
- `derivation` -- the evidence chain that produced the signal
- `false_positive_considered` -- boolean; true when the assessor explicitly considered a false positive
- `assessor` -- `rule_engine` for deterministic passes, `llm` for LLM-assisted passes
- `assessed_at` -- ISO 8601 timestamp

The HTML publication at `wsp/publications/latest/index.html` is self-contained. It includes
executive, technical, compliance, and auditor views. No server or internet connection is
needed to open it.

---

## Example commands

### Run a full assessment

```bash
swao assess --app my-app
```

SWAO discovers the workspace from the current directory. All 14 passes run. The LLM is
called for the ctx, comp, blocks, and synth passes. Playwright runs for the dynamic pass.

### Run selected passes only

```bash
# Inventory and SBOM only -- no LLM, no Playwright
swao assess --app my-app --passes inv,sbom

# All passes except dynamic analysis
swao assess --app my-app --no-crawl
```

### Skip LLM-dependent passes

```bash
swao assess --app my-app --skip-llm
```

Equivalent to omitting passes `comp` and `blocks`. Useful for quick offline analysis.

### Specify a workspace directory

```bash
swao assess --app my-app --workspace /engagements/my-project
```

### Use a specific LLM connector

```bash
# Use the Ollama connector with the llama3.3 model
swao assess --app my-app --llm ollama:llama3.3

# Override the model only (keep the provider from .swao.yml)
swao assess --app my-app --model claude-opus-4-7
```

### Include an inline landing zone fit

```bash
# Single CSP/region pair
swao assess --app my-app --lz-cat-provider stackit --lz-cat-region eu-de-1

# Multiple CSP/region pairs
swao assess --app my-app --lz-cat-targets "stackit:eu-de-1,aws-esc:eusc-de-east-1"
```

This adds an LZ catalogue fit report alongside the standard Application Assessment run.

### Generate the HTML publication and BI export

```bash
swao publish --app my-app
swao export --app my-app --formats csv,ndjson,xlsx
```

---

## .swao.yml configuration

The application assessment reads its primary configuration from `.swao.yml` at the
workspace or app level:

```yaml
app_id: my-app
source:
  path: ./source

providers:
  llm:
    primary:
      connector: anthropic
      model: claude-sonnet-4-6

assessment:
  frameworks:
    - GDPR
    - BSI_C5
  landing_zone:
    provider: stackit
    region: eu-de-1
```

---

## Performance and cost

| Workload size | Duration (Anthropic) | Token cost (approx.) |
|---|---|---|
| Small (< 100 files) | approx. 30 seconds | approx. $0.02 |
| Medium (approx. 1,000 files) | 3 to 5 minutes | approx. $0.10 |
| Large (approx. 10,000 files) | 10 to 15 minutes | approx. $0.50 |

Anthropic prompt-caching applies automatically on repeated runs. Re-running the same
assessment typically costs a fraction of the initial run.

---

## Live example report

See a real Application Assessment output for the Sovereign Health demo workspace:

[Open live report](https://htmlpreview.github.io/?https://github.com/Accenture/SWAO/blob/main/examples/publications/2026-08-23T17-29-27-sovereign-health.html)

This report covers GDPR and BSI C5 signal findings, risk register, and 7R migration strategy for a fictitious patient-management application.

---

## Further reading

- [Landing Zone Assessment](./landing-zone) -- for CSP infrastructure fit/gap analysis
- [LLM Assessment](./llm) -- for multi-provider LLM sovereignty benchmarking
- [Adapting LZ Catalogues](/runbooks/adapting-lz-catalogues) -- customise the provider catalogue
- [LLM provider swap](/runbooks/llm-provider-swap) -- change or test LLM connectors
