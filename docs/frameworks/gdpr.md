# General Data Protection Regulation (GDPR)

This page describes the community framework `GDPR` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `GDPR` |
| Authority / publisher | European Parliament and Council of the European Union (Regulation (EU) 2016/679) |
| Version | Regulation (EU) 2016/679, in force since 2018-05-25 |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 0.1.0 |
| Total controls | 53 |
| Scoring mode | `binary` (schema default; not declared) |
| Assessment types (metadata) | `app`, `aud` |
| Licence and redistribution | GDPR is EU legislation, published by the EUR-Lex Publications Office. Control descriptions paraphrase the article text; the authoritative source is the EUR-Lex text. No legal advice. |
| Last reviewed | 2026-05-22 |
| Folder | `gdpr` |

## What it is

The General Data Protection Regulation (Regulation (EU) 2016/679) is the binding EU-wide framework for processing personal data of natural persons. It applies since 25 May 2018 and has 99 articles in 11 chapters. Its territorial scope (Article 3) extends to organisations outside the EU that offer goods or services to, or monitor, people in the EU.

The SWAO catalogue covers the workload-applicable scope, Chapters II to V (principles, data subject rights, controller and processor, third-country transfers), as 53 controls. Articles on supervisory authorities, the European Data Protection Board and final provisions are excluded. Some articles are split into sub-controls, for example `GDPR_Art_32_a` to `GDPR_Art_32_d` for Article 32(1)(a) to (d).

## Who should use it in SWAO and when

- Practically every engagement in which the workload processes personal data of people in the EU (catalogue hints: `eu_data`, `personal_data`, `consumer_app`, `health_data`, `employee_data`, `cross_border_transfer`, `automated_decisioning`, `profiling`).
- Cloud migrations that move personal data to providers outside the EU (Chapter V).
- Together with sector frameworks such as DORA, NIST_SP_800_66R2 (HIPAA) or BSI_C5.

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
| Code and configuration signals only (`signal_prefix`, `local_signal_regex`) | 4 |
| Signals and documents combined | 0 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 49 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 0 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 0 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `CRYPTO` | 2 | [Pass 08 (CRYPTO)](/passes/08-crypto) |
| `IAM` | 1 | evidence area identity and access; no SWAO analysis pass emits signals with this prefix |
| `OBS` | 1 | evidence area observability, logging and monitoring; no SWAO analysis pass emits signals with this prefix |

### Examples

Controls with code or configuration evidence:

- `GDPR_Art_5_1_f` Integrity and confidentiality (security principle) (Art 5(1)(f)) (`CRYPTO`)
- `GDPR_Art_32_a` Security of processing: pseudonymisation and encryption (Art 32(1)(a)) (`CRYPTO`)
- `GDPR_Art_32_b` Security of processing: ongoing confidentiality, integrity, availability and resilience (Art 32(1)(b)) (`IAM`)

Controls that need documents:

- `GDPR_Art_5_1_a` Lawfulness, fairness and transparency (Art 5(1)(a))
- `GDPR_Art_5_1_b` Purpose limitation (Art 5(1)(b))

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

### Sovereignty requirements and tags

The framework metadata declares sovereignty requirements that the [landing-zone assessment](/assessment/landing-zone) reads when GDPR is selected: operator jurisdiction `EU-entity` and required service `key_vault`. Each control also carries tags on the axes `actor`, `obligation`, `scope` and `applies-to`, which are carried into the plan and the report.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| Chapter II: Principles | 12 | `GDPR_Art_5_1_a` Lawfulness, fairness and transparency (Art 5(1)(a)); `GDPR_Art_5_1_b` Purpose limitation (Art 5(1)(b)) |
| Chapter III: Data Subject Rights | 12 | `GDPR_Art_12` Transparent information, communication and modalities (Art 12); `GDPR_Art_13` Information to be provided where personal data are collected from the data subject (Art 13) |
| Chapter IV: Controller and Processor | 23 | `GDPR_Art_24` Responsibility of the controller (Art 24); `GDPR_Art_25` Data protection by design and by default (Art 25) |
| Chapter V: Third-Country Transfers | 6 | `GDPR_Art_44` General principle for transfers (Art 44); `GDPR_Art_45` Transfers on the basis of an adequacy decision (Art 45) |
| **Total** | **53** | |

Default severities: critical 24, high 25, medium 2, low 2.

## Cross-mapping to other frameworks

40 of 53 controls carry `maps_to` references to controls of other frameworks. The table counts the references per target framework. "Resolved" means the target ID exists as a control in a bundled SWAO catalogue; "unresolved" means the reference points at article or clause level, or uses an ID spelling that no catalogue contains.

| Target framework | Resolved references | Unresolved references |
|---|---|---|
| `ISO_27001` | 43 | 0 |
| `SOC_2` | 17 | 0 |
| `AI_10_PILLARS` | 12 | 0 |
| `ISO_42001` | 0 | 4 |
| `HIPAA` | 0 | 4 |
| `COPPA` | 0 | 1 |
| `NIST_SP_800_66R2` | 1 | 0 |
| `PCI_DSS` | 1 | 0 |

Examples of unresolved references: `HIPAA`: `HIPAA_164.502`, `HIPAA_164.504`, `HIPAA_164.514`; `COPPA`: `COPPA_312`; `ISO_42001`: `ISO_42001_A.5.4`, `ISO_42001_A.6.2`, `ISO_42001_A.6.3`.

In the other direction, controls of these frameworks reference GDPR controls: `BSI_GRUNDSCHUTZ_2023` (57), `BSI_C5` (17), `SOC_2` (17), `SECNUMCLOUD` (9), `EC_CSF` (8), `EU_AI_ACT` (5), `ISO_27001` (2), `COBIT_5` (1).

In addition, the metadata (`cross_mapping_hints`) names these related frameworks: `ISO_27001`, `SOC_2`, `HIPAA`, `PCI_DSS`, `BSI_C5`, `DORA`, `AI_10_PILLARS`, `GARTNER_APP_VENUE_2026`, `EU_AI_ACT`, `NIS2_2022_2555`, `EPRIVACY_2002_58`, `ISO_42001`, `EDPB_GUIDELINES`. This list indicates thematic overlap; it is not a control-level mapping.

## Demo variant

| Property | Value |
|---|---|
| Framework ID | `GDPR_DEMO` |
| Folder | `gdpr-demo` |
| Controls | 11 |
| Catalogue version | 1.1.0 |
| Last reviewed | 2026-07-07 |
| Pre-installed in new workspaces | Yes (`swao init`) |

The demo variant is a demo-sized subset for live presentations with the Sovereign Health demo application. It contains key articles such as Art. 5(1)(a), (c) and (f), Art. 6, 9, 17, 22, 25, 28, 32(1)(a) and 44, re-keyed with the prefix `GDPR_DEMO.` (for example `GDPR_DEMO.ART32_A`), and keeps the cross-references of the full catalogue. Its framework metadata restricts it to the `app` assessment type.

Use the demo variant for workshops, training and presentations where a short report matters more than full coverage. Enable it with its own ID, for example `regimes_active: [GDPR_DEMO]`.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/community-frameworks/gdpr](https://github.com/Accenture/SWAO/tree/main/community-frameworks/gdpr)
- Demo variant: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/gdpr-demo](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/gdpr-demo)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

To customise the framework for one engagement, copy the `gdpr` folder (with `framework-meta.yaml` and `controls.yaml`) into the workspace at `wsp/inputs/catalogs/community/gdpr/` and edit the copy there. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Make sure the `gdpr` folder is present under `wsp/inputs/catalogs/community/` in the workspace (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [GDPR]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [GDPR, BSI_C5]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "GDPR"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

## Limitations and notes

- Lawful basis, consent, purpose limitation and transfer safeguards are legal questions. 49 of the 53 controls rely on documents or manual questionnaires (for example `evidence/02-art-6-lawful-basis.md` or `evidence/03-art-17-erasure-questionnaire.yaml`).
- SWAO does not perform a data protection impact assessment (DPIA). It can only show whether one is documented (`GDPR_Art_35_a` to `GDPR_Art_35_c`).
- National supplementary data protection laws are not modelled.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The publisher's official source is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
