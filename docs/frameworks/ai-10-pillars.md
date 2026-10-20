# 10 Pillars of Secure AI Systems (AI_10_PILLARS)

This page describes the community framework `AI_10_PILLARS` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `AI_10_PILLARS` |
| Authority / publisher | Alok Sharan (framework concept); packaged for SWAO by the SWAO Development Team (Accenture) |
| Version | 2026-Q2 |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 1.0.0 |
| Total controls | 11 |
| Scoring mode | `binary` (schema default; not declared) |
| Assessment types (metadata) | `app`, `llm`, `aud` |
| Licence and redistribution | No redistribution note is declared in the catalogue. The demo variant states that it is based on the AI 10 Pillars framework by Alok Sharan. |
| Last reviewed | 2026-05-21 |
| Folder | `ai-10-pillars` |

## What it is

The 10 Pillars of Secure AI Systems is an architecture rulebook for securing applications that embed a large language model (LLM), a retrieval-augmented generation (RAG) pipeline, agents or foundation-model APIs. It is a community framework contributed by Alok Sharan, not a law or a certifiable standard. Its ten pillars cover input security, identity and access control, data protection, model security, prompt security, retrieval security, tool and API security, output guardrails, monitoring and detection, and governance and compliance.

The catalogue metadata describes it as a baseline overlay that can be used alongside regulatory regimes such as GDPR, PCI DSS or SOC 2 for any application that embeds an LLM or builds on RAG.

## Who should use it in SWAO and when

- Any engagement where the workload calls an LLM, runs a RAG pipeline or exposes agent tools (catalogue applicability hints: `ai_workload`, `llm_app`, `rag_pipeline`, `genai_application`).
- As a technical baseline next to EU_AI_ACT (legal obligations) and GDPR (personal data in prompts and outputs).
- Sector-neutral and region-neutral; it is especially relevant for sovereign deployments where prompts contain personal or regulated data.
- The framework metadata lists the assessment types `app`, `llm` and `aud`, in addition to the application assessment it declares `llm` (see [LLM assessment](/assessment/llm)).

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
| Code and configuration signals only (`signal_prefix`, `local_signal_regex`) | 5 |
| Signals and documents combined | 0 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 6 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 0 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 0 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `IAM` | 1 | evidence area identity and access; no SWAO analysis pass emits signals with this prefix |
| `CRYPTO` | 1 | [Pass 08 (CRYPTO)](/passes/08-crypto) |
| `DATA` | 1 | [Pass 03 (DATA)](/passes/03-data) |
| `EGR` | 1 | [Pass 07 (EGR)](/passes/07-egr) |
| `OBS` | 1 | evidence area observability, logging and monitoring; no SWAO analysis pass emits signals with this prefix |

### Examples

Controls with code or configuration evidence:

- `AI10P-IAM-01` AuthN/AuthZ across AI APIs (`IAM`)
- `AI10P-DAT-01` Encrypt and mask sensitive data (`CRYPTO`)
- `AI10P-DAT-02` Prevent data leakage in AI outputs (`DATA`)

Controls that need documents:

- `AI10P-INP-01` Validate and sanitise all incoming inputs
- `AI10P-MOD-01` Protect models from theft and adversarial manipulation

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| INP: Input Security | 1 | `AI10P-INP-01` Validate and sanitise all incoming inputs |
| IAM: Identity and Access Control | 1 | `AI10P-IAM-01` AuthN/AuthZ across AI APIs |
| DAT: Data Protection | 2 | `AI10P-DAT-01` Encrypt and mask sensitive data; `AI10P-DAT-02` Prevent data leakage in AI outputs |
| MOD: Model Security | 1 | `AI10P-MOD-01` Protect models from theft and adversarial manipulation |
| PRM: Prompt Security | 1 | `AI10P-PRM-01` Protect system-prompt integrity |
| RAG: Retrieval Security | 1 | `AI10P-RAG-01` Secure RAG pipeline and vector store |
| TAS: Tool and API Security | 1 | `AI10P-TAS-01` Secure tool and external-API integrations |
| OUT: Output Guardrails | 1 | `AI10P-OUT-01` Filter and constrain AI outputs |
| OBS: Monitoring and Detection | 1 | `AI10P-OBS-01` Continuously track usage and anomalies |
| GOV: Governance and Compliance | 1 | `AI10P-GOV-01` AI governance and regulatory alignment |
| **Total** | **11** | |

Default severities: high 10, medium 1.

## Cross-mapping to other frameworks

The controls of this framework carry no `maps_to` references.

In the other direction, controls of these frameworks reference AI_10_PILLARS controls: `GDPR` (12).

## Demo variant

| Property | Value |
|---|---|
| Framework ID | `AI_10_PILLARS_DEMO` |
| Folder | `ai-10-pillars-demo` |
| Controls | 11 |
| Catalogue version | 1.1.0 |
| Last reviewed | 2026-07-07 |
| Pre-installed in new workspaces | Yes (`swao init`) |

The demo variant contains the same 11 controls as the full framework, re-keyed with the prefix `AI10P_DEMO.` and labelled with pillar names. It is intended for live presentations with the Sovereign Health demo application and is designed to cross-reference the GDPR, HIPAA and BSI IT-Grundschutz demo frameworks. Its framework metadata restricts it to the `app` assessment type.

Use the demo variant for workshops, training and presentations where a short report matters more than full coverage. Enable it with its own ID, for example `regimes_active: [AI_10_PILLARS_DEMO]`.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/community-frameworks/ai-10-pillars](https://github.com/Accenture/SWAO/tree/main/community-frameworks/ai-10-pillars)
- Demo variant: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/ai-10-pillars-demo](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/ai-10-pillars-demo)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

To customise the framework for one engagement, copy the `ai-10-pillars` folder (with `framework-meta.yaml` and `controls.yaml`) into the workspace at `wsp/inputs/catalogs/community/ai-10-pillars/` and edit the copy there. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Make sure the `ai-10-pillars` folder is present under `wsp/inputs/catalogs/community/` in the workspace (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [AI_10_PILLARS]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [AI_10_PILLARS, GDPR]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "AI_10_PILLARS"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

## Limitations and notes

- The pillars are architecture guidance. A SATISFIED result means the evaluator found supporting signals; it is not a red-team result. Prompt-injection resistance, jailbreak resistance and model theft protection can only be proven by dedicated testing.
- Six of the eleven controls rely on documents (for example `ai_prompt_security`, `ai_retrieval_security`, `ai_governance`). Without those documents in the app context, expect UNKNOWN for these controls.
- The framework has no control-level `maps_to` entries, so SWAO shows no cross-mapping for it. Other frameworks (GDPR) do reference it; see the cross-mapping section.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The publisher's official source is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
