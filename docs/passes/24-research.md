# Pass 24: Vendor and Vulnerability Research (RESEARCH)

| Property | Value |
|---|---|
| Pass number | 24 |
| Key | Runs as the command `swao service research` (outside the `swao assess` pass loop) |
| Signal prefix | `RES` (signal codes `CVE.*`, `EOL.*`, `ADVISORY.*`, `BINARY.VT_DETECTION_RATIO`, `VENDOR.*`, `DATA.*`, `MDR.*`), written to `apps/<id>/wsp/signals/research-signals.json` alongside the research stubs |
| Type | External API lookups (public vulnerability and lifecycle sources) and, with a workspace LLM, LLM-augmented research |
| Default | Optional: run it explicitly before `swao assess` |
| Assessment types | `service` (Service Portfolio Assessment) |
| Tier | All tiers (`service-assessment` is a Community feature) |
| Source | `packages/@swao/module-service-assessment/src/research/` |

## What it is for

In a Service Portfolio Assessment there is no source code to scan; the applications are third-party, SaaS or off-the-shelf products described in an intake workbook. Pass 24 answers the question: "What do public sources say about this product and version: known vulnerabilities, active exploitation, end of support, and whether the installer is known to antivirus engines?"

For each service app it collects this information from public APIs and feeds, stores it as reviewable Markdown files with structured front-matter, labels every result with a confidence level and a provenance, and derives signals from the results. Later steps (Pass 04 CTX, Pass 11 COMP, the APM scoring, the HTML publication and the exports) use these files.

## What you need to provide

| Input | Where | Notes |
|---|---|---|
| Service apps | `apps/<id>/.swao.yml` with `assessment.type: service` | Created by `swao service init` from the intake workbook |
| Vendor name, product name, version | `vendor.name`, `app_name`, `vendor.version` in the app `.swao.yml` | NVD is queried only when a real vendor name is known. If the intake has no vendor column, fill `vendor.name` and remove `vendor` from `generated_fields` (see [Editing safely](/service-assessment/configuration#editing-safely)) |
| Operating system | `platform.os` and `os_class` | `os_class` selects the endoflife.date product via the INFRA-CAT entry |
| Infrastructure category | `infra_category` | Selects an optional open-source package for OSV.dev |
| Installer files (for VirusTotal) | Anywhere in `apps/<id>/ingestion/`, or `apps/<id>/wsp/inputs/binary/` | Hashed by [Pass 25 BINARY](/passes/25-binary) (PE and MSI files only) |
| `NVD_API_KEY` (optional) | SWAO credential vault or environment variable | Raises the NVD rate limit |
| `VT_API_KEY` (optional) | SWAO credential vault or environment variable | Without it no VirusTotal request is made |
| Workspace LLM (optional) | `providers.llm` in the workspace `.swao.yml`, or `SWAO_LLM_CONNECTOR` / `SWAO_LLM_PROVIDER` | Same configuration as `swao assess`. Without it the four LLM topics are skipped (`no_llm_configured`); `--skip-llm` skips them on purpose (`skipped_by_user`). Available in every licence tier |

A key in the credential vault takes precedence over the environment variable. See [API keys](/service-assessment/api-keys).

## How it works

1. **Find service apps.** All `apps/*/.swao.yml` with `assessment.type: service`, or one app with `--app`.
2. **Load INFRA-CAT.** The infrastructure catalogue provides the endoflife.date product IDs per OS class and optional OSV packages per category. See [INFRA-CAT](/service-assessment/infra-cat).
3. **Per app and topic,** decide whether to query:
   - a stub reviewed by an analyst (front-matter `reviewed_by`, or provenance `user-provided`) is never rewritten (`protected`);
   - otherwise a source block is re-queried when it is missing, has an error, is older than its cache period, or was built from different vendor, product or version values;
   - `--refresh` re-queries every non-protected block; `--dry-run` only reports the plan, with no requests and no writes;
   - a topic with nothing to look up is not queried. CVE research without a vendor name, a product name and an OSV package, and end-of-life research without an operating system, write the stub with `status: skipped`, `skipped_reason: no_input`, the list `missing_inputs` (`[vendor_name, product_name]` or `[os]`) and no confidence, instead of a low-confidence result.
4. **CVE summary.**
   - **NVD:** one keyword search per vendor and product (the keyword is the vendor name followed by the product name, or the product name alone when it already contains the vendor name). Without a vendor name NVD is not queried (`note: no_vendor_name`, confidence `low`). The results are read page by page (up to 5 pages of 2000 results; every page goes through the NVD rate limit). When NVD reports more results than were read, or a later page fails, the block is marked `truncated: true` and the counts are a lower bound. Counts by CVSS severity (v4.0, then v3.1, v3.0, v2), the top 10 by score, and patch availability for critical and high CVEs from NVD reference tags.
   - **CISA KEV:** the known-exploited catalogue is downloaded as a whole and matched locally against the NVD CVE IDs.
   - **BSI CERT-Bund:** the advisory RSS feed is downloaded as a whole and matched locally: the product part of each advisory title is compared with the vendor name or the product name (each at least four characters). A match found from the product name alone, because no vendor name is known, gets confidence `low`.
   - **OSV.dev:** queried only when the INFRA-CAT entry declares an open-source package.
5. **End-of-life status.** endoflife.date is queried for the product slug; the release cycle is matched from the OS string (Windows names such as 2012 R2, service packs such as 12 SP5, then numeric versions). Result: end-of-life date, whether it has passed, months remaining, support and extended-support dates.
6. **VirusTotal.** Pass 25 BINARY is run first (offline) to obtain the installer hash. The first SHA256 is looked up on VirusTotal.
7. **LLM-augmented research.** With a workspace LLM, one prompt per topic (`vendor-profile`, `certifications`, `data-residency`, `breach-history`) asks the model for findings with source URLs and a confidence per finding, as a JSON object. Since prompt version `1.1-2026-10-18` the answers for `vendor-profile`, `certifications` and `data-residency` also carry a small `facts` block (EU legal entity, patch cadence in days, EU MDR class, BfArM listing, GDPR data processing agreement; each `yes`, `no` or `unknown`, or a class or number) with its own source URLs. The block is optional: an answer without it, or with values SWAO cannot read, is still recorded and those values count as `unknown`. The answer is validated; each source URL is recorded as cited by the model and not verified (SWAO does not open it). The provider applies the same request handling as `swao assess`: retries, log events, the `max_concurrency` limit, and PII redaction before the prompt leaves your network. A researched topic is kept for 30 days. A failed call (`llm_error`) or an answer in the wrong format (`llm_malformed_response`) is recorded as `skipped` and retried on the next run. Without a vendor and product name the topic is `skipped` with `no_input`. With `--skip-llm` (or "Skip LLM research for this run" in the TUI service assessment screen) no LLM call is made and the provider is not built: topics without earlier findings are written as `skipped` with `skipped_by_user`, and stubs with earlier LLM findings for the same vendor, product and version are kept unchanged (also with `--refresh`).
8. **Write results.** One stub per topic and a `confidence.json` per app. On a rewrite only the front-matter and the text between the markers `<!-- swao:generated:start -->` and `<!-- swao:generated:end -->` change; analyst notes outside the markers are kept.
9. **Derive signals.** The `RES-NN` signals are derived from the final stubs (freshly researched, unchanged or protected) and written to `apps/<id>/wsp/signals/research-signals.json`, so a run without `--refresh` does not empty the file. Nothing is written with `--dry-run`.

Only vendor name, product name, version, the OS product slug and installer hashes leave your network; the LLM prompts carry vendor name, product name, version and the INFRA-CAT category. App IDs, sites and other intake data are never sent.

## How it is measured

### Research topics

| Topic file | Sources | Status in this build |
|---|---|---|
| `cve-summary.md` | NVD, CISA KEV, BSI CERT-Bund, OSV.dev | Researched, or `skipped` (`no_input`) when there is nothing to look up |
| `eol-status.md` | endoflife.date | Researched, or `skipped` (`no_input`) without an operating system |
| `virustotal.md` | VirusTotal | Researched, or `skipped` without key or hash |
| `vendor-profile.md`, `certifications.md`, `data-residency.md`, `breach-history.md` | Workspace LLM (LLM-augmented research, all tiers) | Researched (provenance `LLM-researched`), or `skipped` with `no_llm_configured`, `llm_unavailable`, `llm_error`, `llm_malformed_response`, `skipped_by_user` or `no_input` |

### Confidence

| Level | Meaning |
|---|---|
| `high` | Direct API match including the version (for example NVD with vendor, product and version; an endoflife.date cycle match; a VirusTotal hit; KEV matching) |
| `medium` | Product match without a version, a BSI match (the feed covers recent advisories only), or a hash unknown to VirusTotal |
| `low` | API error, no vendor name (including a BSI match on the product name alone), no slug for the category, no cycle match, or extrapolation |

For the LLM topics, each finding carries the confidence the model gave it (a finding without a source URL is `low`). The topic confidence is the weakest finding, and never higher than `medium`: LLM results are unverified until an analyst reviews them. A topic with no findings is `low`.

A topic's confidence is the lowest confidence of its source blocks that ran (skipped blocks do not count). For `cve-summary` this is the minimum of the NVD and OSV blocks. The app's **composite** confidence in `confidence.json` is the minimum over the topics that produced a confidence (the weakest topic); it is `null` when no topic produced one. The command prints the composite distribution across apps (high, medium, low, and "nothing to look up" for apps without any confidence) and one line per topic (`cve-summary`, `eol-status`, `virustotal`) with the same counts, so that a weak CVE match does not hide a strong end-of-life result. In the `virustotal` line, apps skipped without an API key or an installer hash count as "nothing to look up".

### Provenance

Each stub carries one of `API-verified`, `catalogue`, `LLM-researched` or `user-provided`. In this build provenance is recorded per source block as well: each block (`cve`, `kev`, `bsi`, `osv`, `eol`, `vt`) is marked `API-verified` when that source answered, and left empty when it was skipped, failed or had nothing to query. The stub itself is `API-verified` when at least one of its sources answered. An analyst marks a stub as `user-provided` (or sets `reviewed_by`) to protect it from being overwritten.

### Signals

| Signal | Code | Rule | Severity |
|---|---|---|---|
| `RES-01` | `CVE.CISA_KEV_MATCH` | At least one CVE found for the product is in the CISA Known Exploited Vulnerabilities catalogue | critical |
| `RES-02` | `CVE.CRITICAL_OPEN` | NVD reports critical CVEs and patch availability is not confirmed for every critical and high CVE | critical |
| `RES-03` | `CVE.CRITICAL_PATCH_AVAILABLE` | NVD reports critical CVEs and every critical and high CVE has a patch reference | high |
| `RES-04` | `CVE.HIGH_SEVERITY_OPEN` | NVD reports high-severity CVEs without a confirmed patch for every severe finding | high |
| `RES-05` | `EOL.OS_PAST_EOS` | The operating system release has passed its end-of-life date (endoflife.date) | high |
| `RES-06` | `EOL.OS_WITHIN_18_MONTHS` | The operating system release reaches end of life within 18 months | high |
| `RES-07` | `ADVISORY.BSI_CERT_BUND` | Recent BSI CERT-Bund advisories match the vendor or product name | follows the highest advisory severity (`kritisch` critical, `hoch` high, `mittel` medium, `niedrig` low); medium when unknown |
| `RES-08` | `BINARY.VT_DETECTION_RATIO` | VirusTotal reports at least one malicious engine verdict for the installer hash | critical |
| `RES-09` | `VENDOR.BREACH_HISTORY` | `breach-history.md` is researched by the workspace LLM and has at least one finding that reports a security incident, data breach or enforcement action (a finding that only states that nothing is documented does not count) | medium (never higher) |
| `RES-10` | `VENDOR.PATCH_CADENCE_SLOW` | The `vendor-profile.md` facts give a patch cadence of more than 90 days for a critical vulnerability | medium (never higher) |
| `RES-11` | `DATA.NO_EU_ENTITY` | The `vendor-profile.md` facts state that the vendor has no EU legal entity (`eu_entity: no`), and the app has `GDPR_ART9` in `data.regulatory` or `data.gdpr_art9: true` | medium (never higher) |
| `RES-12` | `DATA.GDPR_ART9_NO_DPA` | The `data-residency.md` facts state that no GDPR data processing agreement is offered (`gdpr_dpa_available: no`), and the app has `data.health_data: true` or `data.gdpr_art9: true` | medium (never higher) |
| `RES-13` | `MDR.CLASS_UNCLEAR` | The `certifications.md` facts state that the product is a medical device under EU MDR 2017/745 but no class is published (`mdr_class: class_not_published`) | medium (never higher) |
| `RES-14` | `MDR.NOT_REGISTERED_BFARM` | The `certifications.md` facts state that the product is not listed in the BfArM medical device database (`bfarm_listed: no`), the product is not stated to be outside MDR, and the app has `MDR` in `data.regulatory` | medium (never higher) |

The API signals `RES-01` to `RES-08` carry `outcome: negative`, `assessor: rule_engine` and the confidence of the underlying source block (for the KEV match, that of the NVD block). Blocks with an error, a skip reason or (for NVD) no query produce no signal. The evidence contains the stub path and public URLs (NVD CVE pages, advisory links, the VirusTotal permalink), never intake data. When the CVE block is `truncated`, the derivation states that the counts are a lower bound.

`RES-09` comes from LLM findings and is labelled as such: `source: llm_inference`, `assessor: llm`, `outcome: negative`. Its severity and confidence are capped at `medium` (the confidence is the weakest of the topic and the counted findings, so a finding without a source URL makes it `low`); it is never `critical` and never a migration blocker. The derivation names the provider, model and prompt version and states that the findings are model-cited and unverified until an analyst reviews the stub (`reviewed_by`). The evidence is the stub path plus each model-cited URL, marked "cited by the model, not verified". Because signals are derived from the stubs, `RES-09` stays in place after a `--skip-llm` run.

`RES-10` to `RES-14` come from the structured `facts` of prompt version 1.1 and carry the same labels and caps: `source: llm_inference`, `assessor: llm`, severity `medium` (the design rates some of them higher; as model claims they are capped), never a migration blocker. Their confidence is `medium` when the facts cite a source URL and `low` otherwise. Only an explicit answer emits: `unknown`, a missing number, a missing `facts` block (stubs written with prompt version 1.0) or an unreadable value never produces a signal. The regulatory conditions come from the `data` block of the app `.swao.yml` (`data.regulatory`, `data.health_data`, `data.gdpr_art9`); these values are used only for the signal rules and are never sent to the LLM. A stub researched with prompt version 1.0 is not re-queried while it is fresh (30 days), so these signals appear after `--refresh` or once the stub has expired.

### Cache periods

| Source | Cache period |
|---|---|
| NVD | 7 days |
| CISA KEV | 1 day |
| OSV.dev | 7 days |
| BSI CERT-Bund | 1 day |
| endoflife.date | 30 days |
| VirusTotal | 7 days |

The KEV and BSI feeds are also cached as files for one day in `wsp/cache/research/`.

### Rate limits and retries

| Source | Limit |
|---|---|
| NVD | 5 requests per 30 s without a key, 10 per 30 s with `NVD_API_KEY` |
| VirusTotal | 4 lookups per minute (public API free tier) |

HTTP 429 responses are retried up to three times with back-off (honouring `Retry-After`). Server errors and timeouts (20 s per request, 60 s for feed downloads) fail fast and are recorded in the block as `error`, with confidence `low`.

### How the results are used

The `RES-NN` signals in `research-signals.json` are read by Pass 11 COMP as evidence alongside the signals of the run. The stubs are read by Pass 04 CTX as context, and the APM scoring rules use them directly: end-of-life status and horizon, critical and high CVE counts, KEV match, patch availability, BSI advisory severity and VirusTotal detections. See [Service portfolio framework](/service-assessment/framework).

## Third-party modules, tools and external services

| Service | Purpose | Data sent | Key | When missing or offline |
|---|---|---|---|---|
| NVD CVE API 2.0 (NIST) | CVE counts and severities | Vendor and product keyword | `NVD_API_KEY` optional | Block `error` or `note`, confidence low |
| CISA Known Exploited Vulnerabilities feed | Active exploitation | None (whole feed downloaded) | - | KEV block `error`, or skipped without NVD CVE IDs |
| BSI CERT-Bund advisory RSS (WID) | German advisories | None (whole feed downloaded) | - | BSI block `error` |
| OSV.dev | Open-source package vulnerabilities | Package name, ecosystem and version | - | Skipped (`no_oss_package`) or `error` |
| endoflife.date | End-of-life dates | Product slug | - | Block `error` or `note` |
| VirusTotal API v3 | Installer reputation | SHA256 hash only | `VT_API_KEY` required | Skipped (`no_api_key` or `no_binary_hash`) |

All HTTP calls use the Node.js built-in `fetch`; no extra client library is used. API keys travel only in request headers and are never written to stubs or error messages.

## Outputs

| File | Content |
|---|---|
| `apps/<id>/wsp/inputs/research/<topic>.md` | YAML front-matter (source blocks, confidence, provenance, timestamps) and a readable Markdown summary |
| `apps/<id>/wsp/inputs/research/confidence.json` | `app_id`, `generated_at`, `composite` and per-topic confidence |
| `apps/<id>/wsp/signals/research-signals.json` | `generated_at`, `app_id` and the `RES-NN` signals |
| `wsp/cache/research/cisa-kev.json`, `wsp/cache/research/bsi-cert-bund.rss` | Workspace-level feed cache |
| `apps/<id>/wsp/inputs/binary/binary-analysis.json` | Written by Pass 25, which research runs first |

## Configuration and limitations

```bash
swao service research                       # all service apps
swao service research --app hosapp200       # one app
swao service research --dry-run             # show what would be queried
swao service research --refresh --json      # re-query everything, JSON output
```

| Setting | Effect |
|---|---|
| `--app <id>`, `--workspace <dir>` | Scope |
| `--refresh` | Ignore cache periods (protected stubs are still kept) |
| `--dry-run` | Plan only; no requests, no writes |
| `--json` | Machine-readable result |
| `NVD_API_KEY`, `VT_API_KEY` | API keys (vault entry wins over environment variable) |
| `SWAO_NVD_BASE_URL`, `SWAO_EOL_BASE_URL`, `SWAO_KEV_URL`, `SWAO_BSI_RSS_URL`, `SWAO_OSV_BASE_URL`, `SWAO_VT_BASE_URL` | Alternative endpoints, for example internal mirrors in air-gapped environments |

Known limitations:

- NVD keyword search can match unrelated products with similar names; review the CVE list before relying on counts. At most 10,000 CVEs (5 pages) are read; beyond that the block is marked `truncated`.
- BSI matching compares names only (at least four characters) and covers only the advisories currently in the feed.
- OSV.dev is consulted only for INFRA-CAT entries that declare an open-source package.
- VirusTotal uses only the first hash in `binary-analysis.json`.
- The LLM topics depend on the model: a model without web search answers from its training data. Source URLs are the model's claims and are not checked; review them before relying on a finding, then set `reviewed_by` to promote the stub to `user-provided`. LLM research produces the RESEARCH signals `RES-09` to `RES-14`, each at most medium. The prompts (version `1.0-2026-10-18`) were approved by the product owner on 2026-10-18; version `1.1-2026-10-18` adds the structured `facts` block, pre-approved by the product owner on 2026-10-18 and assessed in UAT.

See also [Service Portfolio Assessment](/service-assessment/) and [Commands](/service-assessment/commands).
