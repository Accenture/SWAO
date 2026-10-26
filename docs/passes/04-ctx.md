# Pass 04: Context Ingestion (CTX)

| Property | Value |
|---|---|
| Pass number | 04 |
| Key | `ctx` |
| Pass name in output | `context_ingestion` |
| Signal prefix | `CTX` |
| Type | LLM-assisted |
| Default | On (removed by `--skip-llm`) |
| Assessment types | `application`; `service` (always runs; the primary signal source in service mode); `llm` (inside each leg, compared across models). Not run for `landing-zone-catalog`. |
| Tier | Not tier-gated (Community and above) |

## What it is for

Source code shows how an application is built, but not why, who runs it, what the business expects of it or which constraints were agreed in workshops. Pass 04 answers: **"What do the engagement documents tell us about this workload, and where do they contradict each other or the code?"**

It reads everything you have placed under `wsp/inputs/` (architecture documents, workshop minutes, compliance requirements, CMDB and incident exports, runbooks, Terraform state as JSON, research stubs) and turns it into signals. It also points out data gaps and contradictions, for example a workshop note claiming EU-only hosting while a CMDB export lists a US region.

## What you need to provide

- Text context in `wsp/inputs/`. The simplest way is to drop files into `<app>/ingestion/` and let [Pass 00](/passes/00-ingest) route and extract them. Accepted file types for this pass: `.md`, `.txt`, `.yaml`, `.yml`, `.json`, `.csv` (Pass 00 creates `.txt`, `.md` and `.csv` companions for PDF, Word, PowerPoint and Excel files).
- A configured LLM provider (`providers.llm.primary`, `--llm <connector[:model]>` or `SWAO_LLM_PROVIDER`).
- Optional: budget and category tuning in the app `.swao.yml` (see Configuration).

Replace sample or template text before an assessment: files still containing placeholder text produce a warning, because the model may otherwise report findings based on invented data.

## How it works

1. **Collect files.** The pass walks `wsp/inputs/` and skips three top-level folders: `source/` (the cloned application, analysed by the static passes), `catalogs/` and `llm-gateway/`. It also skips CycloneDX exports (`*.cdx.json`), SBOM worksheet exports from Excel (`*sbom*.xlsx.*.csv`, `*bom*.xlsx.*.csv`), `package-lock.json` and `pnpm-lock.yaml`, because they consume budget without adding architecture context.
2. **Split into chunks.** Each file is cut into chunks of 3,000 characters, labelled `[part n/m]`.
3. **Classify by folder.** The first folder below `wsp/inputs/` determines the category:

   | Folder | Category | Default weight in Pass 04 |
   |---|---|---|
   | `architecture/`, `design/`, `adr/` | architecture | 1.0 |
   | `compliance/` | compliance | 1.0 |
   | `intake/`, `discovery/`, `kickoff/` | intake | 1.0 |
   | `workshops/`, `workshop/` | workshops | 0.9 |
   | any other folder, or files at the root | docs | 0.8 |
   | `terraform/`, `infra/` | terraform | 0.7 |
   | `operations/`, `ops/` | operations | 0.7 |
   | `structured/`, `data/`, `exports/` | structured | 0.6 |

   **Infrastructure roles: current vs target.** Infrastructure files also get a role, and the chunk label shows it (`--- [TARGET-LZ] terraform/lz-aws-snapshot.json ---`, `--- [CURRENT-INFRA] terraform/prod-state.json ---`). CURRENT means the platform the application runs on today; TARGET means a candidate landing zone it may move to. The role is decided in this order:

   1. `context.infra_roles` in the app `.swao.yml` (see Configuration); first matching entry wins.
   2. Folder: files under `wsp/inputs/infra/current/` are current, files under `wsp/inputs/infra/target/` are target.
   3. File name: `lz-*-snapshot.json` (the landing-zone snapshots the LZ fit reads) is target; `*.tfstate` and any other file under `terraform/` or `pulumi/` is current.
   4. All other files (documents, CSV exports) have no infrastructure role.

   Keep `lz-<provider>-snapshot.json` in `wsp/inputs/terraform/`: the landing-zone fit reads it there. The `infra/` folders are for other exports whose role you want to state explicitly.

4. **Fill the prompt budget.** Chunks are sorted by weight (highest first), then by size (smallest first, so that more distinct files fit), then by path. They are added until the character budget is used up. A weight of 0 excludes a category entirely. Excluded chunks are listed in a console warning naming the first excluded file and how to raise the budget.
5. **Check for placeholders.** Files matching `Sample / placeholder`, `replace-with-` or `Replace before the assessment` are reported and listed in `placeholder_inputs`.
6. **Call the LLM.** The prompt asks the model to ingest all inputs, detect contradictions between documents and code evidence, identify data gaps, and return signals with IDs `CTX-NN`, plus `context_inputs_found`, `contradictions_detected` and optional `context_overrides`. When infrastructure inputs are present, the prompt adds that contradictions are reported only against CURRENT infrastructure and that a capability the documentation needs but a TARGET landing zone lacks is a target-platform gap. The prompt passes through the SWAO pre-LLM redactor in the Anthropic, OpenAI, Amazon Bedrock and OpenAI-compatible drivers.
7. **Verify evidence.** Every evidence reference the model returns is resolved against `wsp/inputs/`:
   - A reference that escapes the workspace is flagged `false_positive_flag` (path traversal guard).
   - A file that exists but was cut by the budget is recorded under `context_gaps` instead of being treated as wrong.
   - A file that does not exist is flagged `false_positive_flag` with a note.
   - Statements of absence ("no ...", "missing ...") are accepted as observations without a file check.
8. **Separate target gaps from contradictions.** A signal whose evidence cites a TARGET input and no CURRENT input is a target-platform gap, whatever the model called it: SWAO adds `gap_type:target_capability` to its `implies` list, caps its severity at `medium` and starts its derivation with "Target platform gap". Example: documentation requires MariaDB and only the target snapshot shows PostgreSQL; this is a gap of the target, not a contradiction. The same mismatch against a current state file stays a contradiction.

## How it is measured

Signal IDs (`CTX-01`, `CTX-02` and so on), severities and outcomes are chosen by the model within the SWAO signal schema; there is no fixed signal list. SWAO adds or verifies the following:

| Item | Meaning |
|---|---|
| `false_positive_flag`, `false_positive_note` on a signal | Cited evidence could not be found or points outside the workspace; treat the signal with caution |
| `context_gaps` on a signal | Cited file exists but was not in the prompt because of the budget |
| `assessment.context_inputs_found` | Number of distinct input files found (before budget selection) |
| `assessment.chunks_included`, `chunks_excluded` | How much of the material reached the model |
| `assessment.files_excluded_by_pattern` | SBOM exports and lock files that were skipped |
| `assessment.placeholder_inputs` | Files still containing template text |
| `assessment.contradictions_detected`, `context_overrides` | As reported by the model |
| `implies: gap_type:target_capability` on a signal | Target-platform gap: the target landing zone lacks something the documentation needs |
| `assessment.infra_inputs` | Infrastructure files read, grouped as `current` and `target` |
| `assessment.target_capability_gaps` | Number of target-platform gap signals (computed by SWAO) |

Special outcomes:

| Situation | Result |
|---|---|
| No LLM configured | One `CTX-00` signal (informational, outcome `indeterminate`); status `not_applicable` |
| No input files | The model is asked to emit a CTX signal noting reduced context coverage |
| Answer is not valid JSON (for example cut off at the output token limit) | Logged as an error (with a truncation hint when the answer is long and unterminated); the pass returns one `CTX-00` signal with status `not_applicable` and `skipped_reason: invalid_llm_response`, and `invalid_response_detail` states whether the answer was truncated at the token ceiling or is not valid JSON. The run continues. |
| LLM unreachable after retries | Status `not_applicable`, no signals; a secondary connector is tried first if configured |

**How results feed later passes.** CTX signals are evidence for Pass 11 (COMP) and Pass 12 (BLOCKS), and for [Pass 09 (SYNTH)](/passes/09-synth), whose portability estimate explicitly lowers the score for CTX signals that indicate vendor lock-in. In a [Service Portfolio Assessment](/service-assessment/) without source code, CTX is the main source of signals.

## Third-party modules and tools

| Name | Purpose in this pass | Licence (package metadata) | Bundled or external | When missing |
|---|---|---|---|---|
| js-yaml | Reading `context.allocations`, `context.categories` and `context.infra_roles` | MIT | Bundled | Not applicable |
| LLM provider or LLM-Gateway connector | Context analysis | External service; licence not recorded in repo | External, configured by you | `CTX-00` skip signal |

Text extraction from PDF and Office files happens earlier, in [Pass 00](/passes/00-ingest).

## Outputs

- `wsp/runs/<ts>/passes/04-ctx.yaml`: header (`id: 4`, `name: context_ingestion`), signals, `assessment`, `data_source`.
- `wsp/runs/<ts>/llm-traces/04-ctx-call-1.json`: post-redaction prompt (with character and estimated token counts and the number of redaction markers) and the raw response.
- Cached responses under `wsp/cache/llm/<model>/` (up to 30 days; bypass with `--no-cache`).

## Configuration and limitations

**Prompt budget.** The character budget for the context chunks is chosen in this order:

1. `context.allocations.ctx` in the app `.swao.yml`
2. Otherwise a budget computed for the run: the `SWAO_CTX_PROMPT_MAX_CHARS` environment variable if set; otherwise derived from the active connector's context window (window in tokens times 4 characters, minus allowances for the system prompt and output, at least 10,000 characters); otherwise 110,000 characters
3. The pass caps every value at 110,000 characters.

```yaml
context:
  allocations:
    ctx: 80000          # characters for Pass 04
  categories:
    terraform: 0.5      # multiplier on the default weight (result clamped to 0.0..1.0)
    structured: 0       # exclude CSV and JSON exports from the prompt
  infra_roles:          # optional; path relative to wsp/inputs/ (file, folder, or glob with * and **)
    - path: terraform/ocp-export.json
      role: current     # current | target
    - path: terraform/candidate-*.json
      role: target
```

`infra_roles` also applies to [Pass 01](/passes/01-inv): a state file declared `target` produces no `service_dep` signal and only feeds the landing-zone readiness.

**Other settings**

- `SWAO_TOKEN_CEILING` (default 8192): when set below 8,000, SWAO logs a warning that the CTX answer may be truncated.
- `--skip-llm` removes `ctx` (together with `comp` and `blocks`) from the run.
- `--no-cache`, `--llm`, `--model` as for the other LLM passes.

**Limitations and known gaps**

- Only the six text extensions listed above are read; images and binary files contribute nothing unless Pass 00 extracted text from them or you add a `.description.txt`.
- Large inputs can exceed the budget; check the console warning and `chunks_excluded`.
