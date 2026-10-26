# Pass 09: Migration Synthesis (SYNTH)

| Property | Value |
|---|---|
| Pass number | 09 |
| Key | `synth` |
| Pass name in output | `synthesis` |
| Signal prefix | `SYNTH` |
| Type | LLM-assisted, with a deterministic landing zone matching step and deterministic score adjustments |
| Default | On (not removed by `--skip-llm`) |
| Assessment types | `application`; `service` (always runs, synthesising the signals that service mode produced); `llm` (inside each leg, compared across models). Not run for `landing-zone-catalog`. |
| Tier | Not tier-gated (Community and above) |

## What it is for

The earlier passes produce many individual observations. Pass 09 answers the question a steering committee asks: **"So what should we do with this application?"**

It combines all signals of the run into a 7R migration verdict (Retire, Retain, Rehost, Replatform, Repurchase, Refactor, Re-architect) with a rationale, a strategic modernisation position, an optional comment on the computed portability score, the key blockers and enablers, recommended next steps and a recommended sovereign landing zone from the SWAO cloud provider catalogue.

## What you need to provide

- A configured LLM provider (`providers.llm.primary`, `--llm <connector[:model]>` or `SWAO_LLM_PROVIDER`). Without one the pass is skipped.
- The other passes of the same run. Pass 09 has no inputs of its own; the more passes have run, the better founded the verdict.
- Optional: a Pass 23 (LZR) result from the same run, produced when you pass `--lzr <landingZoneId>`.

## How it works

1. **Execution position.** Although numbered 09, the pass runs late in the canonical order: `inv, state, data, ctx, sbom, tf, egr, crypto, dynamic, scope, malware, lzr, comp, synth, blocks`. It therefore also sees the signals of Pass 10 (DYNAMIC), Pass 13 (SCOPE), Pass 14 (MALWARE, when requested), Pass 23 (LZR, with `--lzr`) and the per-framework summary signals of Pass 11 (COMP). Pass 12 (BLOCKS) runs after this pass and reads its result, so block verdicts are not part of the synthesis input.
2. **Load prior signals.** Every `.yaml` file in the current run's `passes/` folder except its own is read, and all signals are collected.
3. **Coverage score.** `coverage_score` = 1 minus the share of prior signals with low confidence, rounded to two decimals; 0.5 when there are no prior signals.
4. **Landing zone matching (deterministic).** The pass loads `controls/cloud-provider-catalogue.yaml` (16 providers) and derives constraints from the `implies` tags of the prior signals:
   - Hard constraints: `de_only_residency_confirmed`, `eu_only_residency_confirmed`, `bsi_c5_required`, `hipaa_required`, `low_vendor_lock_in_required`. A provider that does not meet one is disqualified with a reason (for example no DE-only guarantee, BSI C5 not attested, HIPAA not satisfied, high lock-in).
   - Required services: every `service_dep:<service>` tag, mainly from [Pass 01 (INV)](/passes/01-inv).
   - Fit score for each remaining provider: 0.50 × sovereign score + 0.35 × share of required services available + 0.10 × the provider's catalogue portability score (a property of the provider, not the application's `portability_score`) + 0.05 × (1 minus cost tier, where low = 0, medium = 0.5, high = 1), capped at 1.0.
   - Providers are ranked; the best non-disqualified provider becomes `recommended_landing_zone`. Required services that no passing provider offers are listed as `landing_zone_blockers`.
   - Recommendation confidence: high when coverage is at least 0.9 and a DE-only, BSI C5 or HIPAA constraint applies; medium when coverage is at least 0.7; otherwise low (also low when no provider passes).
5. **Build the prompt.** It contains the signal counts by prefix and by severity, up to ten high-severity signals, all EGR signals (each shortened to 120 characters), the deterministic cloud-native and portability scores with their components, and the recommended landing zone. The model must return `seven_r_label`, `migration_rationale`, `modernization_position`, `confidence`, `landing_zone`, `recommended_next_steps`, `migration_blockers` and `migration_enablers` (plus an optional `portability_comment` of up to 300 characters), and emit `SYNTH-01` (7R verdict), `SYNTH-02` (why other Rs were rejected) and `SYNTH-03` (key constraint).
6. **Validate the answer.**
   - The answer must be valid JSON.
   - `seven_r_label` is normalised (for example `refactor`, `re_architect` and `rearchitect` are accepted) and must be one of the seven Rs.
   - `modernization_position` must be a non-empty string. Canonical values are `invest_modernize_now`, `migrate_stabilize`, `tolerate_contain` and `retire_replace`; refinements such as `invest_modernize_with_remediation` are accepted.
   - A `portability_score` or `cloud_native_score` in the answer is discarded; the computed values are written instead (#3431).
7. **Apply the landing zone readiness adjustment.** If a Pass 23 (LZR) verdict is available in `23-lzr.yaml` of the current run:

   | LZR verdict | 7R from the model | Adjustment |
   |---|---|---|
   | `blocked` | Rehost or Replatform | Verdict changed to Retain; score delta minus 1.0 for the original R and plus 0.15 for Retain |
   | `blocked` | Retain | Retain plus 0.15 |
   | `blocked` | any other R | No change, note only |
   | `advisory` | Rehost or Replatform | Verdict kept; score delta minus 0.15; resolve warnings before migration |
   | `advisory` | any other R | No change, note only |
   | `ready` | any | No change |
   | none | any | `lzr_adjustment.verdict: not_assessed` |

## How it is measured

| Signal | Meaning |
|---|---|
| `SYNTH-01` | 7R verdict with rationale |
| `SYNTH-02` | Rationale for rejecting the other Rs |
| `SYNTH-03` | Key constraint driving the verdict |
| further `SYNTH-NN` | Any additional signals the model emits |
| `SYNTH-00` | Pass skipped or degraded (informational, outcome `indeterminate`, status `not_applicable`): no LLM configured or `--skip-llm` set (`skipped_reason: no_llm_provider`; with the flag also `skip_llm_flag: true`), or the answer failed validation (`skipped_reason: invalid_llm_response`, cause in `invalid_response_detail`) |

All SYNTH signals carry `synthesis: true`. Severities and outcomes are set by the model within the SWAO signal schema.

**Cloud-native and portability scores (#3431).** Both are computed in code, not by the model, so the same input always gives the same score; the pass records them even when no LLM is configured or the answer is unusable. The weights are in `controls/migration-scores-catalogue.yaml`.

- `cloud_native_score`: weighted mean over the twelve-factor checks of [Pass 06](/passes/06-tf) (factors II, III, VIII, IX, XI, equal weights) with pass 1, partial 0.5, fail 0 and unknown 0.5. `cloud_native` adds `factors_checked` (determinate checks), `factors_total` and `confidence` (high from 80% checked, medium from 50%, otherwise low).
- `portability_score`: weighted mean of service availability 0.35 (share of the required services offered by 2 or more sovereign providers in the landing-zone catalogues), vendor lock-in 0.25 (1 minus 0.5 per blocking, 0.25 per partial, 0.1 per manageable proprietary SDK), container 0.15 (Kubernetes 1, container 0.75, none 0), infrastructure as code 0.10 and egress 0.15 (sovereign service verdicts available 1, partial 0.5, unavailable 0; without verdicts, hard-coded production hosts private 0.5, public 0). A component without input data is dropped and the other weights are renormalised; `portability` lists every component with `used`, `value` and the reason. A sovereign provider has a catalogue region operated by an EU entity without US CLOUD Act or FISA 702 exposure.

The values in `wsp.yaml` `overall` are computed again by derive-plan from all pass outputs of the run and are the ones the report, publication and BI export show.

The `assessment` block contains the model's fields (`seven_r_label` after adjustment, `migration_rationale`, `modernization_position`, `portability_comment` when given, `confidence`, `landing_zone`, `recommended_next_steps`, `migration_blockers`, `migration_enablers`) plus `lzr_adjustment`, `coverage_score`, `prior_signals_analysed`, `landing_zone_candidates` (per provider: fit score, rationale, disqualification, service gaps, matched certifications, lock-in flags, meshStack integration), `recommended_landing_zone`, `landing_zone_recommendation_confidence`, `landing_zone_blockers` and the computed `cloud_native_score`, `cloud_native`, `portability_score`, `portability` and `migration_scores_catalogue`.

**How results are used.** The 7R label, coverage score and portability score appear in the [report](/generate-report), the [HTML publication](/publish-html), the [BI export](/export-bi) (application dimension) and the SWAO MCP server. In an [LLM assessment](/assessment/llm) each leg runs this pass with its own model, so the verdicts can be compared across models.

## Third-party modules and tools

| Name | Purpose in this pass | Licence (package metadata) | Bundled or external | When missing |
|---|---|---|---|---|
| js-yaml | Reading prior pass files, the provider catalogue and `23-lzr.yaml` | MIT | Bundled | Not applicable |
| LLM provider or LLM-Gateway connector | 7R synthesis | External service; licence not recorded in repo | External, configured by you | `SYNTH-00` skip signal |

## Outputs

- `wsp/runs/<ts>/passes/09-synth.yaml` with header (`id: 9`, `name: synthesis`), signals, `assessment` and `data_source`.
- `wsp/runs/<ts>/llm-traces/09-synth-call-1.json` with the post-redaction prompt and the raw response.
- Cached responses under `wsp/cache/llm/<model>/` (up to 30 days; bypass with `--no-cache`).

## Configuration and limitations

**Configuration**

- LLM selection: `providers.llm.primary`, `--llm`, `--model`, `SWAO_LLM_PROVIDER`, `SWAO_LLM_CONNECTOR`.
- `--passes` determines which signals are available; a run with only `synth` has nothing to synthesise.
- `--lzr <landingZoneId>` runs Pass 23 (LZR) before this pass, so its verdict adjusts the 7R result of the same run.
- `--skip-llm` keeps this pass in the run but makes no LLM call; the pass records the `SYNTH-00` skip marker.
- Frameworks in `assessment.regimes_active` influence the verdict indirectly through the COMP summary signals.

**Limitations and known gaps**

- **Unusable answers degrade the pass.** If the answer is not valid JSON, has no `assessment` object, has an invalid 7R label, or lacks `modernization_position`, the pass emits only `SYNTH-00` with `skipped_reason: invalid_llm_response` and the run continues without a 7R verdict. Re-run, or choose a model that follows JSON instructions reliably.
- If the cloud provider catalogue cannot be found or read, the landing zone matching step is skipped, the landing zone fields are missing and `landing_zone_match_skipped_reason` in the `assessment` block states why.
- Only up to ten high-severity signals and the EGR signals are quoted in the prompt; other signals are visible to the model only as counts.
