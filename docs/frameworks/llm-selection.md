# LLM Selection Framework for Sovereign Deployment (LLM_SELECTION)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `LLM_SELECTION` |
| Authority / publisher | SWAO Development Team (Accenture), community framework (Design 063) |
| Version | 1.0 |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `0.1.0` |
| Total controls | 34 |
| Scoring mode | `binary` (schema default). Each control also carries its own pass / partial / fail criteria, and the catalogue declares Sovereignty Readiness Score (SRS) domain weights. |
| Assessment scope (framework-meta) | `llm` |
| Signal prefix | `LLM` |
| Licence and redistribution | SWAO-authored framework shipped with the Apache-2.0 community catalogue; no third-party redistribution note is declared. |
| Last reviewed | 2026-06-30 |

## What it is

LLM_SELECTION is not a regulation. It is a SWAO-authored evaluation framework that rates a large language model (LLM) provider as a candidate for running sovereign workloads. It asks the questions a sovereignty-minded buyer needs answered before choosing a model: where data is processed and retained, how transparent the model and provider are, how the model performs in the target language and domain, how safe and robust it is, whether the team can operate it, and how well it supports agentic patterns such as tool calling and retrieval.

The catalogue references the EU AI Act obligations for general-purpose AI models (Articles 51 to 55), GDPR Articles 28 and 44 to 46, ISO/IEC 42001, the NIST AI RMF 1.0, NIST SP 800-218A, the OWASP LLM Top 10 and a published analyst model for LLM selection (`framework-meta.yaml` references). Five controls carry an explicit EU AI Act reference, two a GDPR reference and two an OWASP reference.

## Who should use it in SWAO and when

Use LLM_SELECTION in an [LLM assessment](/assessment/llm) when a client must choose, or justify, an LLM provider for a regulated or sovereignty-sensitive use case: for example a public-sector chatbot, a clinical documentation assistant in an example hospital, or an internal retrieval-augmented search over confidential documents. It is useful in every region; the data residency and transfer controls are written with EU requirements in mind.

Typical moments in an engagement:

- shortlisting providers before a proof of concept;
- documenting the selection rationale for an AI governance board;
- re-assessing a provider after contract, model or hosting changes.

## What SWAO checks

Controls are evaluated by the compliance pass ([Pass 11, COMP](/passes/11-comp)). For every framework listed in `assessment.regimes_active`, the pass sends each control's ID, title, description and default severity, together with all signals produced earlier in the run, to the configured LLM in batches of 20 controls. The LLM returns one outcome per control with a short rationale:

| Outcome | Meaning |
|---|---|
| `SATISFIED` | Signals positively confirm that the control is met. |
| `PARTIAL` | Some elements are present, but gaps remain. |
| `GAP` | Signals show that the control is not met. |
| `UNKNOWN` | No signal addresses the control either way. |
| `N_A` | The control does not apply to this workload (with justification). |

Signal references cited by the LLM are checked against the real signal set of the run, and evidence file paths are taken from the cited signals rather than from the LLM. Without a configured LLM provider every control is recorded as `UNKNOWN` and the framework status is `pending-llm`. A roll-up signal `COMP-NN` summarises the outcome counts per framework.

Each control in the catalogue also declares an `evidence_basis`: the signal family or document it is meant to be judged on. The evaluator does not filter on this field. It tells reviewers which evidence matters and is shown in the HTML publication as the scope of the automated check. Documents such as policies, runbooks and architecture descriptions reach the run through the [ingest](/passes/00-ingest) and [context](/passes/04-ctx) passes.

LLM_SELECTION is answered almost entirely from documents, not from code. The `evidence_basis` of the 34 controls points to three kinds of input:

| Evidence source (declared) | Controls |
|---|---|
| Provider documentation, declared as `imports/` (model cards, conformity assessments, pricing sheets, benchmark results) | 25 |
| LLM intake questionnaire `ingestion/llm-intake-questionnaire.docx` | 5 |
| People and skills material under `wsp/ingest/people/` | 4 |

When LLM_SELECTION is active and the application has no files in `apps/<app-id>/context/`, the compliance pass emits an informational `COMP` signal warning that the controls will appear unverified. Place the provider's model card, data processing agreement and conformity documentation there before the run.

Each control defines its own `scoring` criteria for pass, partial and fail. Example, `DSR-01` Data residency guarantee: pass requires a binding contractual guarantee for the target region and a verifiable endpoint. The framework README describes `DSR-01` and `DSR-02` as hard eligibility gates.

`DSR-02` Zero-retention endpoint verified is the only control whose evidence basis declares an automated SWAO check in addition to the questionnaire.

| Control | Title | Declared evidence basis |
|---|---|---|
| `DSR-02` | Zero-retention endpoint verified | context `ingestion/llm-intake-questionnaire.docx`, declared SWAO check |

## Control structure

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| DSR: Data sovereignty and residency | 5 | 1 | `DSR-01` Data residency guarantee; `DSR-02` Zero-retention endpoint verified |
| MT: Model transparency | 5 | 0 | `MT-01` Model card published; `MT-02` GPAI conformity assessment published |
| PR: Performance and reliability | 7 | 0 | `PR-01` Latency SLA for sovereign payloads; `PR-02` Hallucination rate within threshold |
| CLF: Cultural and language fit | 3 | 0 | `CLF-01` Target-language fluency; `CLF-02` Domain-vocabulary accuracy in target language |
| SB: Safety and bias | 5 | 0 | `SB-01` Bias benchmark within acceptable bounds; `SB-02` Red-team or adversarial evaluation results published |
| PEO: People and team readiness | 4 | 0 | `PEO-01` AI and LLM engineering skills present; `PEO-02` Data management skills for LLM pipelines |
| AC: Agentic capabilities | 5 | 0 | `AC-01` Tool and function calling reliability; `AC-02` Multi-step orchestration and chaining |
| **Total** | **34** | **1** |  |

The catalogue declares Sovereignty Readiness Score (SRS) weights per domain in `framework-meta.yaml` (`srs_weights`):

| Domain | DSR | MT | PR | CLF | SB | AC | PEO |
|---|---|---|---|---|---|---|---|
| SRS weight | 0.20 | 0.17 | 0.17 | 0.12 | 0.15 | 0.16 | 0.03 |

According to the framework README, the SRS is the weighted average of the domain scores (pass = 1.0, partial = 0.5, fail = 0.0, not assessed = excluded), and PEO drops out of the denominator when `wsp/ingest/people/` is empty.

## Cross-mapping to other frameworks


Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`GDPR`](/frameworks/gdpr), [`AI_10_PILLARS`](/frameworks/ai-10-pillars), [`ISO_27001`](/frameworks/iso-27001).

## How to enable

1. **Discovery.** Copy the folder `llm-selection` into the workspace at `wsp/inputs/catalogs/community/llm-selection/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. This framework declares `assessment_type_scope: [llm]`. The TUI lists it in the framework picker of the [LLM assessment](/assessment/llm); the application assessment picker does not show it.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes LLM_SELECTION`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [LLM_SELECTION]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/llm-selection>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `llm-selection` into your workspace at `wsp/inputs/catalogs/community/llm-selection/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info LLM_SELECTION` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- SWAO does not benchmark the model itself under this framework. Performance, hallucination and bias controls are judged on the evidence the provider or the client supplies.
- Provider documentation changes frequently. Record the document versions you used and re-run the assessment when they change.
- The SRS weights are declared in the catalogue; this release computes compliance outcomes per control through the compliance pass.
