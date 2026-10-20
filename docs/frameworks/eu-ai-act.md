# EU Artificial Intelligence Act (EU_AI_ACT)

This page describes the community framework `EU_AI_ACT` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `EU_AI_ACT` |
| Authority / publisher | European Union (Regulation (EU) 2024/1689) |
| Version | 2024-08-01 |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 1.0.0 |
| Total controls | 37 |
| Scoring mode | `binary` (declared) |
| Assessment types (metadata) | `app`, `aud` |
| Licence and redistribution | The AI Act is an EU legislative act, reusable under the EUR-Lex terms. Control descriptions paraphrase the regulation and are not legal advice. |
| Last reviewed | 2026-09-22 |
| Folder | `eu-ai-act` |

## What it is

The AI Act (Regulation (EU) 2024/1689) is the EU's risk-based regulation for artificial intelligence systems placed on the market or put into service in the EU. It entered into force on 1 August 2024; its obligations apply in stages, and the prohibited practices of Article 5 apply from 2 February 2025. It distinguishes prohibited practices, high-risk systems, systems with transparency obligations, and general-purpose AI (GPAI) models.

The SWAO catalogue contains 37 controls in four parts. Part RC (risk classification) decides which other parts apply: Part HR applies when `AIACT_RC_02` identifies a high-risk system, Part TR applies to limited-risk systems or higher, and Part GP applies when `AIACT_RC_04` identifies a GPAI model.

## Who should use it in SWAO and when

- Providers and deployers of AI systems on the EU market (catalogue hints: `ai_system`, `high_risk_ai`, `gpai_provider`, `automated_decisioning`, `eu_market`).
- Any application assessment where the workload uses AI for decisions about people, chatbots, emotion recognition or generated content.
- Together with AI_10_PILLARS (technical security baseline) and GDPR (automated decision-making under Art. 22).

## What SWAO checks

Controls are evaluated in [Pass 11 (compliance evaluation)](/passes/11-comp). The pass reads the `assessment.regimes_active` list from the app's `.swao.yml`, loads the catalogue and sends the controls in batches of 20 to the configured LLM. For each control the LLM receives the ID, title, description and default severity, together with all signals that the earlier passes of the run produced. It returns one of five outcomes per control:

| Outcome | Meaning |
|---|---|
| `SATISFIED` | Signals confirm the control is met. |
| `PARTIAL` | Some elements are present, but gaps remain. |
| `GAP` | Signals show the control is not met. |
| `UNKNOWN` | No signal addresses the control either way. |
| `N_A` | The control does not apply to this workload (with justification). |

Cited signal IDs are checked against the signals that actually exist; invented IDs are dropped. Without a configured LLM provider every control is reported as `UNKNOWN`.

### What evidence the controls expect

Each control declares in its `evidence_basis` field what kind of evidence it relies on. This tells the reviewer what evidence is expected; the outcome itself is decided by the LLM from the signals. For this framework the split is:

| Evidence type | Controls |
|---|---|
| Code and configuration signals only (`signal_prefix`, `local_signal_regex`) | 1 |
| Signals and documents combined | 1 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 35 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 19 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 0 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `STATE_LOG_ENABLED` | 1 | evidence area logging enabled; no SWAO analysis pass emits signals with this prefix |
| `STATE_LOG_RETENTION_DAYS` | 1 | evidence area log retention; no SWAO analysis pass emits signals with this prefix |

### Examples

Controls with code or configuration evidence:

- `AIACT_HR_06` Automatic logging and audit trail (`STATE_LOG_ENABLED`)
- `AIACT_HR_07` Log retention period (`STATE_LOG_RETENTION_DAYS`)

Controls that need documents:

- `AIACT_RC_01` Prohibited AI practices check
- `AIACT_RC_02` High-risk AI system identification

Examples of audit-only controls: `AIACT_RC_05`, `AIACT_HR_04`, `AIACT_HR_05`.

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| Part RC: Risk Classification | 5 | `AIACT_RC_01` Prohibited AI practices check; `AIACT_RC_02` High-risk AI system identification |
| Part HR: High-Risk AI Requirements | 18 | `AIACT_HR_01` Risk management system establishment; `AIACT_HR_02` Training data governance: representativeness and bias |
| Part TR: Transparency Obligations | 5 | `AIACT_TR_01` Chatbot AI disclosure to users; `AIACT_TR_02` Emotion recognition system disclosure |
| Part GP: GPAI Model Obligations | 9 | `AIACT_GP_01` GPAI model technical documentation; `AIACT_GP_02` Training data copyright compliance |
| **Total** | **37** | |

Default severities: critical 1, high 24, medium 12.

## Cross-mapping to other frameworks

13 of 37 controls carry `maps_to` references to controls of other frameworks. The table counts the references per target framework. "Resolved" means the target ID exists as a control in a bundled SWAO catalogue; "unresolved" means the reference points at article or clause level, or uses an ID spelling that no catalogue contains.

| Target framework | Resolved references | Unresolved references |
|---|---|---|
| `NIS2` | 6 | 0 |
| `GDPR` | 5 | 0 |
| `ISO_27001` | 4 | 0 |
| `EU_CRA` | 2 | 0 |

In addition, the metadata (`cross_mapping_hints`) names these related frameworks: `GDPR`, `EU_CRA`, `NIS2`, `AI_10_PILLARS`. This list indicates thematic overlap; it is not a control-level mapping.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/community-frameworks/eu-ai-act](https://github.com/Accenture/SWAO/tree/main/community-frameworks/eu-ai-act)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

To customise the framework for one engagement, copy the `eu-ai-act` folder (with `framework-meta.yaml` and `controls.yaml`) into the workspace at `wsp/inputs/catalogs/community/eu-ai-act/` and edit the copy there. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Make sure the `eu-ai-act` folder is present under `wsp/inputs/catalogs/community/` in the workspace (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [EU_AI_ACT]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [EU_AI_ACT, GDPR]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "EU_AI_ACT"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

## Limitations and notes

- The risk classification itself is a legal assessment. SWAO can flag indicators from the solution architecture and the AI system description, but the final classification belongs to legal counsel.
- 19 of the 37 controls are marked `aud`, among them conformity declaration, CE marking, technical documentation and incident reporting.
- The evaluator does not enforce the RC gating automatically: all 37 controls are sent for evaluation, and the LLM is expected to return N_A for parts that do not apply. Check N_A justifications in the report.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The publisher's official source is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
