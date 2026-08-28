<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     LLM Selection Framework for Sovereign Deployment -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# LLM Selection Framework for Sovereign Deployment -- SWAO Community Framework

**Framework ID:** `LLM_SELECTION`
**Version:** 1.0
**Authority:** Accenture SWAO team -- internal community framework (Design 063)
**SWAO tier:** Community (install via `swao framework install LLM_SELECTION`)
**Controls:** 34 controls across 7 domains

## What this framework evaluates

LLM_SELECTION evaluates a large language model provider as a candidate
for sovereign-workload deployment. It is the Mode B component of the LLM
Assessment Benchmark (Design 063), complementing the observable-quality
application benchmark (Mode A) with a structured provider sovereignty
evaluation.

Controls cover seven domains aligned with the Gartner G00794364 five-dimension
LLM selection framework: data sovereignty and residency (DSR), model
transparency (MT), performance and reliability (PR), cultural and language
fit (CLF), safety and bias against EU AI Act obligations (SB), people and
team readiness (PEO), and agentic capabilities (AC). Scores combine into a
Sovereignty Readiness Score (SRS) weighted by domain criticality.

DSR-01 (data residency guarantee) and DSR-02 (zero-retention endpoint) are
hard gates: a provider that fails either is excluded from benchmark runs until
resolved. All other controls produce weighted SRS contributions.

**Note:** Controls in this framework cannot be satisfied by static source
analysis alone. Pass 11 will report controls as `unverified` unless LLM
provider context files are present in `apps/{app}/context/` or audit evidence
is uploaded via Hybrid Assessment. This is expected behaviour, not an error.

## How to activate in SWAO

Install the framework into your workspace:

```bash
swao framework install LLM_SELECTION
```

Or add to your workspace `.swao.yml` after installation:

```yaml
compliance:
  frameworks: [LLM_SELECTION]
```

For Mode B LLM benchmark use, configure the provider list and mode selector
in `.swao.yml` under `llm_assessment.providers` (see Design 063 §11.3 for
the full configuration shape).

## Control domains

| Domain | Prefix | Controls | Publication subtitle |
|---|---|---|---|
| Data sovereignty and residency | DSR | DSR-01 to DSR-05 | Ecosystem affinity and environment dependency |
| Model transparency | MT | MT-01 to MT-05 | Transparency through architecture and licensing |
| Performance and reliability | PR | PR-01 to PR-07 | Technical performance, cost and throughput |
| Cultural and language fit | CLF | CLF-01 to CLF-03 | General purpose vs domain specific |
| Safety and bias | SB | SB-01 to SB-05 | Safety, bias and adversarial robustness |
| People and team readiness | PEO | PEO-01 to PEO-04 | Team skills |
| Agentic capabilities | AC | AC-01 to AC-05 | Orchestration, RAG and agent tooling |

SRS weights: DSR=0.20, MT=0.17, PR=0.17, CLF=0.12, SB=0.15, AC=0.16, PEO=0.03.
PEO is excluded from the denominator when `wsp/ingest/people/` is empty.

## Sovereignty Readiness Score

```
SRS = sum(weight[d] * domain_score[d]) / sum(weight[d]) * 100
```

Per-control scores: pass = 1.0, partial = 0.5, fail = 0.0, not-assessed = excluded.
Weights are configurable via `mode_b.srs_weights` in `.swao.yml`.

## Evidence sources

Controls are evaluated from:

- DSR controls: intake questionnaire at `ingestion/llm-intake-questionnaire.docx`
  (Section 9.6 covers DSR-01 through DSR-05). Fill guide and provider scoring reference
  at `swao/docs/templates/llm-intake-questionnaire-guide.md`.
- MT, PR, CLF, SB, AC controls: provider documentation placed in `apps/{app}/context/`
  (model card, conformity assessment, pricing sheets, benchmark results).
- PEO controls: organigrams, role descriptions, and skill matrices in
  `wsp/ingest/people/`. If the folder is empty, all PEO controls score as `not-assessed`
  and are excluded from the SRS denominator.
- DSR-02 (zero-retention): automatically verified per run by the SWAO provider client
  (SPEC.md §10.10 check).

## Customising this framework

Install a local copy to override specific controls for your engagement:

```bash
swao framework install LLM_SELECTION
```

The installed copy at `catalogs/community/llm-selection/controls.yaml` overrides the
bundled version for all assessments in that workspace. Edit the YAML to adjust severity
weights, threshold defaults, or add jurisdiction-specific controls. See `CONTRIBUTING.md`
at the repository root for the full authoring guide.

## Contributor

Helmut Schindlwick (Accenture SWAO team) -- https://github.com/Accenture/SWAO
https://github.com/Accenture/SWAO

**Authoritative source:** Design 063 Appendix A -- LLM Assessment Framework Draft
at `docs/design/063-llm-assessment-framework-and-multi-provider-configuration.md`
