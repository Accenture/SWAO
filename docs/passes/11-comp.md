# Pass 11: Compliance Evaluation (COMP)

| Property | Value |
|---|---|
| Pass number | 11 |
| Key (`--passes`) | `comp` |
| Signal prefix | `COMP` |
| Type | LLM-assisted (falls back to `UNKNOWN` per control without an LLM) |
| Default | On (part of the default `--passes` list) |
| Assessment types | `application`, `service` (always runs in the service profile) |
| Tier | All tiers (no licence gate) |
| Source | `packages/@swao/module-framework/src/compliance-evaluator.ts` |

## What it is for

Pass 11 answers the question: "Against the compliance frameworks we selected, which controls does this workload meet, partly meet or miss, and what is the evidence?"

It takes every signal produced by the earlier passes of the same run and asks an LLM, acting as an auditor, to rate each control of each active framework. The result is a control-by-control verdict with a rationale, the signal IDs that support it, and a one-sentence remediation for gaps. The verdicts feed the compliance section of the report, `wsp-plan.yaml` and the BI export.

## What you need to provide

| Input | Where | Notes |
|---|---|---|
| Active frameworks | `assessment.regimes_active` in the app `.swao.yml`, or in the workspace `.swao.yml` when the app has no list | Without a list the pass returns status `not_applicable` |
| Framework catalogues | `wsp/inputs/catalogs/` at workspace level (standard and community catalogues) | Installed by `swao init` and `swao framework install <id>` |
| An LLM provider | `providers.llm` in `.swao.yml`, `--llm` or `--model` | Without an LLM every control is `UNKNOWN` |
| Signals from earlier passes | Written automatically in the same run | The more passes run, the better the evidence |
| For the `LLM_SELECTION` framework | Provider documents (model card, DPA, conformity assessment) in `apps/<app>/context/` | Otherwise SWAO adds an informational warning signal |

```yaml
# apps/app-crm-01/.swao.yml
assessment:
  regimes_active: [DORA, NIS2, GDPR]
```

See [Frameworks](/frameworks/) for the available framework IDs.

## How it works

1. **Collect signals.** The pass reads every `*.yaml` pass file already written in the current run directory (excluding its own `11-*` file) and gathers all signals. It also reads the app-level signal files `wsp/signals/research-signals.json` ([Pass 24 RESEARCH](/passes/24-research)) and `wsp/signals/binary-signals.json` ([Pass 25 BINARY](/passes/25-binary)) when they exist.
2. **Read active frameworks.** It reads `assessment.regimes_active` from the app `.swao.yml`. When the app has no list, it uses the list in the workspace `.swao.yml`. If both are empty, the pass ends with status `not_applicable` and `skipped_reason: No regimes configured in .swao.yml`.
3. **Load catalogues.** For each framework ID it resolves the catalogue through the regime registry in `wsp/inputs/catalogs/`. A missing catalogue produces a medium-severity `COMP-NN` signal that tells you how to install it, and the framework is skipped.
4. **Batch the controls.** Controls are sent in batches of 20. Each prompt contains the framework name and version, the outcome definitions, a summary of every signal (ID, severity and the first 280 characters of the derivation), and the batch of controls (ID, title, description up to 400 characters, default severity).
5. **Validate the answer.** The LLM must answer with JSON only. The response is parsed and validated against a strict schema. Controls missing from the answer, or a batch whose answer cannot be parsed, fall back to `UNKNOWN`.
6. **Remove invented references.** Any cited signal ID that does not exist in the run is dropped and a warning is printed. The control's `evidence_ids` are taken from the evidence of the cited signals; when nothing is cited for a `SATISFIED`, `PARTIAL` or `GAP` verdict, the evidence is recorded as `llm-inference`.
7. **Summarise.** One `COMP-NN` summary signal is emitted per framework.

## How it is measured

### Control outcomes

| Outcome | Rule given to the evaluator |
|---|---|
| `SATISFIED` | The signals positively confirm the control is met |
| `PARTIAL` | Some elements are present but gaps remain; a remediation sentence is required |
| `GAP` | The signals show the control is not met; a remediation sentence is required |
| `N_A` | The control does not apply to this workload (with justification) |
| `UNKNOWN` | No signal addresses the control either way, or no LLM evaluation was available |

The LLM is instructed to decide only on the evidence in the signal list and not to invent facts. Each evaluated control records `outcome`, `rationale`, `signal_refs`, `evidence_ids`, `remediation`, `severity` (the catalogue's `severity_default`, default medium), `assessor` (`llm` or `rule_engine` for fallbacks) and `assessed_at`.

### Framework status

| Status | Condition |
|---|---|
| `evaluated` | An LLM was available and at least one control is `SATISFIED`, `PARTIAL` or `GAP` |
| `insufficient_evidence` | An LLM was available but every control ended as `UNKNOWN` or `N_A` |
| `pending-llm` | No LLM was configured |

### Summary signals

| Signal | Meaning | Severity |
|---|---|---|
| `COMP-NN` per framework | Counts of `SATISFIED`, `PARTIAL`, `GAP`, `UNKNOWN` and `N/A` out of all controls | high if any `GAP`; medium if any `PARTIAL`; otherwise informational |
| `COMP-NN` missing catalogue | A framework is listed but its catalogue is not installed | medium |
| `COMP-NN` LLM selection context | `LLM_SELECTION` is active but `apps/<app>/context/` is empty | informational |

`NN` is a running number in the order the frameworks are processed, so the same framework can have a different number in another run.

## Third-party modules, tools and external services

| Name | Purpose | Licence | Bundled or optional | When missing or offline |
|---|---|---|---|---|
| Configured LLM provider (cloud or local, for example Ollama) | Evaluates controls | Depends on the provider | Optional, but needed for meaningful results | Every control `UNKNOWN`, framework status `pending-llm` |
| Framework catalogues (community frameworks) | Control definitions | See each framework page | Bundled and installed into the workspace | Medium `COMP` signal; framework skipped |
| `js-yaml`, `zod` | Parse catalogues and validate LLM output | MIT | Bundled | - |

## Outputs

| File | Content |
|---|---|
| `apps/<app>/wsp/runs/<ts>/passes/11-comp.yaml` | Pass header, summary signals and `assessment.regimes[]` with every evaluated control |
| `apps/<app>/wsp/runs/<ts>/llm-traces/11-comp-call-1.json` | The first prompt (after redaction) and response, for review |
| `wsp-plan.yaml` (via plan derivation) | `compliance.regimes[]` copied from the pass output; if Pass 11 did not run, a fallback block with all controls `UNKNOWN` and `assessor: auto-derived` |

## Configuration and limitations

| Setting | Effect |
|---|---|
| `assessment.regimes_active` | Frameworks to evaluate (per app) |
| `--passes` without `comp` | Skips the pass |
| `--skip-llm` (alias `--no-llm`) | Removes `ctx`, `comp` and `blocks` from the run |
| `--llm <connector[:model]>`, `--model <id>` | Selects the LLM for this run |
| `--no-cache` | Forces fresh LLM calls instead of cached responses |
| `--fail-on severity=high` | Exits with code 6 if any signal, including a `COMP` summary, matches |

Known limitations:

- Pass 11 runs in the order `... dynamic, scope, malware, lzr, comp, synth, blocks`. It sees the signals of Pass 10 DYNAMIC, Pass 13 SCOPE, Pass 14 MALWARE and Pass 23 LZR from the same run, but not those of Pass 09 SYNTH, which runs after it.
- The verdict is an LLM judgement on signal summaries, not a formal audit. Each signal derivation is shortened to 280 characters in the prompt.
- Pass 11 reads `assessment.regimes_active` only. The plan derivation also accepts a legacy top-level `regimes:` list, which Pass 11 ignores.
- Large frameworks need one LLM call per 20 controls, which affects run time and cost.

See also [Pass 12: Block assessments](/passes/12-blocks) and [Assessment dimension catalogue](/assessment-dimension-catalogue).
