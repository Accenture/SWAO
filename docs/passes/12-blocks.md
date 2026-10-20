# Pass 12: Block Assessments (BLOCKS)

| Property | Value |
|---|---|
| Pass number | 12 |
| Key (`--passes`) | `blocks` |
| Signal prefix | `BLOCKS` (declared; the pass emits no signals, see below) |
| Type | LLM-assisted (falls back to `UNKNOWN` per block without an LLM) |
| Default | On (part of the default `--passes` list) |
| Assessment types | `application`, `service` (always runs in the service profile) |
| Tier | All tiers (no licence gate) |
| Source | `packages/@swao/module-app-assessment/src/passes/pass-12-blocks.ts` |

## What it is for

Compliance frameworks (Pass 11) tell you whether controls are met. Pass 12 answers a more operational question: "How mature is this application in the eight areas that usually decide whether a migration goes smoothly?"

It produces a scorecard with one entry per block: an outcome, a score between 0 and 1, a risk status, a short rationale and the signals that support the rating. The eight blocks were previously planned as separate passes numbered 15 to 22; they are now evaluated together in this single pass.

## What you need to provide

| Input | Where | Notes |
|---|---|---|
| Signals from earlier passes | Written automatically in the same run | The scorecard can only be as good as the evidence |
| An LLM provider | `providers.llm` in `.swao.yml`, `--llm` or `--model` | Without an LLM every block is `UNKNOWN` |

There are no pass-specific configuration keys.

## How it works

1. **Collect signals.** The pass reads every pass file already written in the current run directory (excluding its own `12-*` file).
2. **Read the synthesis.** Pass 12 runs last in the canonical order, after [Pass 09 SYNTH](/passes/09-synth). It reads the 7R recommendation, coverage score and migration rationale from `09-synth.yaml` in the same run directory. If that file is missing (for example when `synth` was not selected), the prompt states that the synthesis output is unavailable.
3. **One LLM call.** A single prompt lists the eight block specifications with their thresholds and assessment axes, the outcome rules and a summary of every signal (ID, severity and the first 240 characters of the derivation). The LLM must return JSON only.
4. **Validate.** The answer is validated against a strict schema (outcome, rationale, score 0 to 1, status, key signals; a threshold in the answer is optional). Cited signal IDs that do not exist in the run are removed. The stored threshold always comes from SWAO's block specification in the table below; a threshold returned by the LLM is ignored and cannot override it.
5. **Fallback.** A block that is missing from the answer, or every block when no LLM is configured or the answer cannot be parsed, is recorded as `UNKNOWN` with score 0, status medium and `assessor: rule_engine`.
6. **Summary.** The pass sets `any_gap_found` to true when any block is `GAP` or `PARTIAL`.

## How it is measured

### The block scorecard

| Block (`assessment.blocks.<name>`) | Former pass number | Threshold | What the evaluator looks at |
|---|---|---|---|
| `observability` | 15 | 0.7 | Structured logs, exported metrics, distributed tracing, defined SLOs, alerting rules, on-call runbooks |
| `licence_compliance` | 16 | 0.8 | SBOM completeness, GPL/AGPL exposure, attribution coverage, commercially incompatible dependencies, end-of-life or abandoned packages |
| `testing_maturity` | 17 | 0.6 | Unit, integration and end-to-end tests, CI gating on merge, performance and load tests, mutation testing |
| `architecture_assessment` | 18 | 0.65 | Clear service boundaries, low coupling, acyclic dependencies, simple deployment topology, documented scalability path |
| `database_assessment` | 19 | 0.7 | Versioned schema, replication, verified backups, encryption at rest, retention policy, right-to-erasure support |
| `integration_assessment` | 20 | 0.65 | Retry with backoff, idempotency keys, contract tests, circuit breakers, documented egress allow-list, verified webhook signatures |
| `iam_assessment` | 21 | 0.8 | Strong authentication, MFA for administrators, enforced RBAC, secrets in a KMS or vault, access audit log, session expiry |
| `dr_assessment` | 22 | 0.6 | Defined RTO/RPO, verified backups, multi-zone or multi-region, current DR runbook, DR test within six months, automated failover |

### Outcome rules given to the evaluator

| Outcome | Rule |
|---|---|
| `SATISFIED` | The block is mature; score at or above the block threshold |
| `PARTIAL` | Some elements present, gaps remain; score from 0.4 up to the threshold |
| `GAP` | The block is largely absent; score below 0.4 |
| `N_A` | The block does not apply to this workload (rare, must be justified) |
| `UNKNOWN` | No signal addresses the block; score 0.0 |

Each block also carries a `status` of `low`, `medium`, `high` or `critical`, which is the migration risk from the operator's point of view. The same value is stored as `sovereign_migration_risk`.

### Pass-level fields

| Field | Meaning |
|---|---|
| `blocks_evaluated` | Always 8 |
| `evaluation_mode` | `llm` or `rule_engine` (no LLM) |
| `any_gap_found` | True when any block is `GAP` or `PARTIAL` |
| `evaluation_note` | Plain-language summary of the result |
| `skipped_reason` | `no_llm_provider` when no LLM was configured |

## Third-party modules, tools and external services

| Name | Purpose | Licence | Bundled or optional | When missing or offline |
|---|---|---|---|---|
| Configured LLM provider | Scores the eight blocks | Depends on the provider | Optional, but needed for meaningful results | All blocks `UNKNOWN` |
| `js-yaml`, `zod` | Read pass files and validate the LLM answer | MIT | Bundled | - |

## Outputs

| File | Content |
|---|---|
| `apps/<app>/wsp/runs/<ts>/passes/12-blocks.yaml` | Pass header, empty signal list and `assessment.blocks` scorecard |
| `apps/<app>/wsp/runs/<ts>/llm-traces/12-blocks-call-1.json` | Prompt (after redaction) and response |
| `wsp-plan.yaml` (via plan derivation) | The eight blocks surfaced for the report and the BI export |

## Configuration and limitations

| Setting | Effect |
|---|---|
| `--passes` without `blocks` | Skips the pass |
| `--skip-llm` (alias `--no-llm`) | Removes `ctx`, `comp` and `blocks` from the run |
| `--llm`, `--model`, `--no-cache` | Select the LLM and bypass the response cache |

Known limitations:

- **Score and outcome are not cross-checked.** The thresholds are fixed by SWAO, but SWAO does not check that the score the LLM returns matches the outcome it chose. Review the scorecard with this in mind.
- **No signals.** The pass declares its own prefix `BLOCKS` but emits no signals; the result lives only in `assessment.blocks`. Use `--fail-on` on other passes, not on block outcomes.

See also [Pass 11: Compliance evaluation](/passes/11-comp) and [Generate a report](/generate-report).
