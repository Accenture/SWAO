# Pass 03: Data Classification (DATA)

| Property | Value |
|---|---|
| Pass number | 03 |
| Key | `data` |
| Pass name in output | `data_classification` |
| Signal prefix | `DATA` |
| Type | LLM-assisted in application mode; deterministic service variant in service mode |
| Default | On |
| Assessment types | `application` (LLM); `llm` (inside each leg, compared across models); `service` (conditional, deterministic service variant). Not run for `landing-zone-catalog`. |
| Tier | Not tier-gated (Community and above) |

## What it is for

Where data may be hosted, and under which controls, depends on what kind of data it is. Pass 03 answers: **"Which personal, sensitive or special-category data does this application process, and does the code implement the obligations that come with it?"**

It classifies the data classes the application handles (for example contact data, health records, financial data), looks for implemented GDPR controls such as erasure (Article 17), consent and retention, and checks whether secrets appear in environment templates. When Saudi NCA Cloud Cybersecurity Controls are active, it also proposes the Saudi data tier.

## What you need to provide

**Application mode**

- The application source tree.
- A configured LLM provider: `providers.llm.primary` in `.swao.yml`, a connector via `--llm <connector[:model]>`, or the `SWAO_LLM_PROVIDER` environment variable. Without one the pass is skipped (see below).
- Optional: `assessment.regimes_active` containing `NCA_CCC_CST` or `NCA_CCC_CSP` in the app `.swao.yml` to request the Saudi data tier.

```yaml
assessment:
  regimes_active: [GDPR, NCA_CCC_CST]
```

**Service mode** (see [Service Portfolio Assessment](/service-assessment/))

- Data-flow documents (ERD, data-flow diagrams exported as text, screen mask descriptions) in `ingestion/data-flow/` or `wsp/inputs/data-flow/`, or any document dropped into `ingestion/` (PDF, Word, Excel, and text files, read through the text that Pass 00 extracts into `wsp/inputs/`), and/or
- A `data:` block in the app `.swao.yml` with any of `health_data`, `pii`, `gdpr_art9`, `classification` or `categories`.

The pass is skipped in service mode when neither is present.

## How it works

### Application mode (LLM)

1. **Collect up to 16 relevant files**, in this priority order:
   - `prisma/schema.prisma` (first 4,000 characters)
   - `.env.example`, `.env.sample`, `config.toml`, `config.yaml`, `config.yml` at the root (first 1,500 characters each)
   - Up to four further schema files (`.prisma`, `.sql`, `.graphql`; 2,500 characters each), found up to seven directory levels deep
   - Source files (`.ts`, `.js`, `.rs`, `.go`, `.py`, `.java`, `.kt`, `.cs`, `.rb`) whose **name** contains a privacy keyword such as `gdpr`, `erasure`, `consent`, `retention`, `pii`, `patient`, `medical`, `redact` (3,000 characters each)
   - If fewer than three such files were found: handler files whose name contains `auth`, `user`, `account`, `profile`, `settings`, `delete`, `export` or `consent` and whose content contains a privacy keyword (2,500 characters each)
   - `node_modules`, `target`, `.git` and hidden folders are skipped.
2. **Build the prompt.** The model is instructed to classify data types and PII classes, to base every signal only on evidence it can see in the supplied files, not to treat absence of evidence as evidence of absence, and to emit positive signals for implemented GDPR controls with file and function references. Signal IDs must use `DATA-NN`. When `NCA_CCC_CST` or `NCA_CCC_CSP` is active, the prompt adds the Saudi tier instructions.
3. **Redact and send.** The prompt passes through the SWAO pre-LLM redactor (e-mail addresses, IP addresses, credentials in URLs, secret and token shapes, user paths, VAT, SSN, passport and UK NI numbers; person names only when `SWAO_SCRUB_PERSON_NAME=1`) in the Anthropic, OpenAI, Amazon Bedrock and OpenAI-compatible drivers.
4. **Parse the answer.** Code fences and stray characters are removed and the JSON object is extracted. A truncated answer is repaired once by closing the brackets. Each signal is normalised to the SWAO signal schema.

### Service mode (deterministic)

1. Reads the `data:` block of the app `.swao.yml`.
2. Scans text documents (`.md`, `.txt`, `.csv`, `.sql`, `.xml`, `.json`, `.yaml`, `.yml`, `.html`, `.htm`, up to 2 MB each) in the data-flow folder line by line for personal data field names (for example `patient`, `name`, `birth`, `address`, `phone`, `email`, `insurance`, `ssn`, `diagnos`, `medication`, with German equivalents such as `geburt`, `adresse`, `versicher`, `befund`, `medikament`) and health data field names (for example `patient`, `diagnos`, `icd`, `dicom`, `modality`, `lab_result`, `vital`).
3. Emits signals from the declarations and matches; evidence cites file and line only, never the matched value.

## How it is measured

### Application mode

Signal IDs, severities and counts are chosen by the model within the SWAO signal schema (`DATA-01`, `DATA-02` and so on; severity `critical`, `high`, `medium`, `low`, `informational` or `positive`; outcome `positive`, `negative`, `neutral` or `indeterminate`). The prompt requests an `assessment` block with:

| Field | Meaning |
|---|---|
| `data_classes` | List of data classes observed |
| `gdpr_art17_implemented` | Whether erasure is implemented |
| `secrets_in_env` | Whether secrets appear in environment files |
| `saudi_data_tier` | Only with NCA CCC active: `level` (`public`, `internal`, `confidential`, `restricted`), `label`, `cst_class_required` (`class_c` for public and internal, `class_b` for confidential, `class_a` for restricted, or `null`) |

If no files were found, the model is told to emit a single `DATA-01` noting limited coverage and not to invent gaps.

Special outcomes:

| Situation | Result |
|---|---|
| No LLM configured | One `DATA-00` signal (informational, outcome `indeterminate`); pass status `not_applicable`; `skipped_reason: no_llm_provider` |
| LLM unreachable after retries | Status `not_applicable`, no signals, `skipped_reason: connectivity_failure`; a secondary connector is tried first if configured |
| Answer not parseable even after repair | One `DATA-00` signal (informational, outcome `indeterminate`); status `not_applicable`; `skipped_reason: invalid_llm_response` with the cause in `invalid_response_detail`; a note recommending a re-run |
| `--skip-llm` set | No LLM call; the same `DATA-00` skip marker as without an LLM (`skipped_reason: no_llm_provider`), with `skip_llm_flag: true` and a derivation naming the flag |

### Service mode

| Signal | Emitted when | Severity |
|---|---|---|
| `DATA-NN` (first) | `data.health_data` or `data.gdpr_art9` is `true`, or health field names appear in the documents | high, outcome negative: special-category health data (GDPR Article 9) |
| `DATA-NN` (next) | `data.pii` is `true`, or personal field names appear | medium, outcome negative: personal data obligations apply |
| `DATA-01` | Neither of the above | informational, outcome indeterminate: confirm with the business owner |

The service `assessment` block records `mode: service`, the declared values, and the number of documents and field references.

**How results feed later passes.** DATA signals are the main input for data-protection controls (for example GDPR, the Saudi NCA controls or healthcare frameworks) evaluated by Pass 11 (COMP), and for [Pass 09 (SYNTH)](/passes/09-synth). High-severity signals are turned into derived security findings and risks.

## Third-party modules and tools

| Name | Purpose in this pass | Licence (package metadata) | Bundled or external | When missing |
|---|---|---|---|---|
| js-yaml | Reading `assessment.regimes_active` and the service `data:` block | MIT | Bundled | Not applicable |
| LLM provider (Anthropic, OpenAI, Amazon Bedrock, Ollama, OpenAI-compatible endpoint or LLM-Gateway connector) | Classification in application mode | External service; licence not recorded in repo | External, configured by you | Pass emits `DATA-00` and is marked skipped |

## Outputs

- `wsp/runs/<ts>/passes/03-data.yaml`: header (`id: 3`, `name: data_classification`), signals, `assessment` and, for LLM runs, a `data_source` block (provider, model, temperature, seed, cache hit, placeholder inputs, false-positive flag count).
- `wsp/runs/<ts>/llm-traces/03-data-call-1.json`: the post-redaction prompt and the raw response (application mode with an LLM).
- LLM responses are cached under `wsp/cache/llm/<model>/` for up to 30 days unless `--no-cache` is used.

## Configuration and limitations

**Configuration**

- `providers.llm.primary` in `.swao.yml`, `--llm <connector[:model]>`, `--model <id>`, `SWAO_LLM_PROVIDER`, `SWAO_LLM_CONNECTOR`.
- `assessment.regimes_active` with `NCA_CCC_CST` or `NCA_CCC_CSP` for the Saudi tier.
- `--no-cache` forces a fresh LLM call.
- `.swao-pii-allowlist.txt` at the workspace root lists strings the redactor must leave untouched; `SWAO_SCRUB_PERSON_NAME=1` enables person name redaction.
- Service mode: `data:` block (`health_data`, `pii`, `gdpr_art9`, `classification`, `categories`) in the app `.swao.yml`.

**Limitations and known gaps**

- The file selection is name-based. Privacy logic in files with neutral names is only seen when the handler fallback picks it up.
- At most 16 files and fixed character limits per file are sent; large schemas are cut.
- The service variant uses keyword matching and cannot tell a field definition from a mention in prose.
