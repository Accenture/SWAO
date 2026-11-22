# Digital Operational Resilience Act (DORA)

This page describes the community framework `DORA` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `DORA` |
| Authority / publisher | European Union (Regulation (EU) 2022/2554) |
| Version | 2025-01-17 (date of application) |
| Level 2 acts covered | Delegated Regulations (EU) 2024/1774, 2024/1772, 2024/1773, 2025/301, 2025/532, 2025/1190; Implementing Regulations (EU) 2024/2956, 2025/302 |
| SWAO catalogue version | 2.0.0 |
| Total controls | 55 |
| Scoring mode | `binary` (declared) |
| Assessment types (metadata) | `app`, `aud`, `lz` |
| Licence and redistribution | DORA and its Level 2 acts are EU legislative acts, reusable under the EUR-Lex terms. Control descriptions paraphrase the legal text and are not legal advice; consult legal counsel and your competent authority. |
| Last reviewed | 2026-11-06 |
| Folder | `dora` |

## What it is

DORA (Regulation (EU) 2022/2554) is an EU regulation on digital operational resilience for the financial sector. It entered into force on 16 January 2023, applies from 17 January 2025 and is directly binding in all member states. It covers ICT risk management, ICT-related incident management and reporting, digital operational resilience testing, ICT third-party risk and information sharing. Eight Level 2 acts specify the details; the SWAO catalogue cites them where they apply.

Every control cites the DORA article, paragraph and point (`regulatory_basis`, `official_control_id`) and, where one applies, the article of the Level 2 act. Ids name the article (`DORA_Art_<article>_<n>`); the trailing number is a sequence, not the paragraph.

## Who should use it in SWAO and when

- Banks, insurers, investment firms, payment institutions and other financial entities in the EU (catalogue hints: `financial_services`, `banking`, `insurance`, `payment_institution`, `investment_firm`).
- ICT third-party providers that serve EU financial entities and must show alignment with their clients' DORA obligations.
- DORA readiness and gap assessments for workloads moving to cloud, and for the landing zone they move to.

## What SWAO checks

Controls are evaluated in [Pass 11 (compliance evaluation)](/passes/11-comp). The pass reads `assessment.regimes_active` from the app's `.swao.yml`, loads the catalogue and sends the controls in batches of 20 to the configured LLM, together with the signals of the run. It returns `SATISFIED`, `PARTIAL`, `GAP`, `UNKNOWN` or `N_A` per control. Controls with `applies_when` that does not match the app's `framework_context` are N/A by rule.

### Evidence: workload, landing zone and organisational documents

| Evidence kind (tag) | Controls | Meaning |
|---|---|---|
| `evidence.workload` | 2 | Code, configuration or landing zone evidence |
| `evidence.both` | 18 | Technical evidence plus documents that complete it |
| `evidence.organisational` | 35 | Documents only (`layer: governance`) |

Organisational controls take their evidence from the app's ingestion folder. Put the documents into `apps/<app-id>/ingestion/`; Pass 00 copies them into `wsp/inputs/` and extracts their text, and [Pass 04 (CTX)](/passes/04-ctx) turns them into signals that cite the file. A `layer: governance` control is only `SATISFIED` or `PARTIAL` when a cited signal cites one of the documents the control expects; otherwise it is `UNKNOWN` (not assessed, insufficient evidence) with the expected documents listed. Missing evidence is never a pass.

A document counts as expected when its file name contains the expected input name, ignoring case and separators, for example `incident_classification_policy.pdf` or `register_of_information.xlsx`. The framework README lists which document satisfies which control (`ict_risk_management_framework`, `incident_reporting_procedure`, `register_of_information`, `exit_plan`, `tlpt_plan_and_attestation` and others).

### Signal areas referenced

| Prefix | Controls |
|---|---|
| `TF` | 16 |
| `STATE` | 4 |
| `LZR` | 4 |
| `INV` | 3 |
| `SBOM` | 3 |
| `IAM` | 2 |
| `CRYPTO` | 2 |
| `MAL` | 2 |
| `EGR`, `QUAL`, `DYN`, `SYNTH` | 1 each |

### Landing zone assessments

DORA is offered for the Landing Zone Live Assessment (`swao assess --type landing-zone-live --frameworks DORA`). There it is evaluated per service through `service-controls.yaml`: 18 controls are mapped to capability tags (encryption, keys and certificates, identity, logging and monitoring, network segmentation, backup and restore, redundancy, data processing locations, patching and hardening, change management, exit). The 8 organisational controls scoped to `lz` (DORA_Art_5_1, 5_2, 6, 6_3, 9_7, 11_1, 11_4, 16_1) are decided from the documents in the landing zone's ingestion folder, `landing-zones/<lz-id>/ingestion/`, named after the expected inputs as for an application. The decision uses the document names and readability, not the content: documented, partly documented or not evaluated (see [Organisational controls](/assessment/landing-zone-live#organisational-controls-ingestion-folder)). An application assessment reviews the content and decides the other 27 organisational controls, which are scoped to application and audit assessments. The 64 mapping rows were reviewed by a human on 2026-11-06 (`confidence: curated`), including the AI capability tags `ml_training` and `ml_inference`.

## Control structure

| Pillar | Articles | Controls |
|---|---|---|
| ICT risk management | Art. 5 to 16 | 32 |
| ICT-related incident management and reporting | Art. 17 to 23 | 8 |
| Digital operational resilience testing | Art. 24 to 27 | 4 |
| ICT third-party risk | Art. 28 to 44 | 10 |
| Information sharing | Art. 45 | 1 |
| **Total** | | **55** |

Default severities: high 38, medium 16, low 1.

Numbers in the controls are those of the legal text, for example the reporting limits of Delegated Regulation (EU) 2025/301 Art. 5 (initial notification within 4 hours of classification as major and no later than 24 hours after awareness, intermediate report within 72 hours, final report within one month of the latest intermediate report). Where DORA leaves a value to the entity (log retention, backup frequency, patch deadlines, RTO and RPO, exit plan tests), the control asks for the entity's documented value.

### Proportionality

Three groups of controls apply only to some entities and are N/A unless `framework_context` in the app's `.swao.yml` says so:

```yaml
framework_context:
  dora_simplified_framework: "true"   # Art. 16(1) entities: DORA_Art_16_1
  dora_tlpt_required: "true"          # entities required to perform TLPT: DORA_Art_26, DORA_Art_27_1
  dora_payment_entity: "true"         # credit, payment, account information and e-money institutions: DORA_Art_23_1
```

### Corrected ids (catalogue 1.0.0 to 2.0.0)

Seven ids of catalogue 1.0.0 named the wrong article. They were corrected; the new controls list the old id in `replaces:`, so publications of earlier assessments still resolve them: `DORA_Art_7_2` to `DORA_Art_9_4`, `DORA_Art_11_2` to `DORA_Art_12_3`, `DORA_Art_15` to `DORA_Art_17_1`, `DORA_Art_16` to `DORA_Art_18_1`, `DORA_Art_17` to `DORA_Art_19_1`, `DORA_Art_19` to `DORA_Art_20_1`, `DORA_Art_31` to `DORA_Art_30_2`.

## Cross-mapping to other frameworks

54 of 55 controls carry `maps_to` references. All targets exist as controls in the bundled catalogues.

| Target framework | References | Distinct target controls |
|---|---|---|
| `BSI_C5` | 55 | 40 |
| `NIS2` | 48 | 38 |
| `EUCS` | 46 | 37 |
| `GDPR` | 10 | 7 |
| `ISO_27001` (Annex A; not in the public download) | 56 | 39 |

In the other direction, `COBIT_5` references `DORA_Art_6` and `DORA_Art_30`.

## Demo variant

| Property | Value |
|---|---|
| Framework ID | `DORA_DEMO` |
| Folder | `dora-demo` |
| Controls | 12 |
| Pre-installed in new workspaces | No |

The demo variant is a 12-control sample for live presentations; it still uses ids of catalogue 1.0.0. Use the full DORA framework for real assessments.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Copy the `dora` folder from the [GitHub repository](https://github.com/Accenture/SWAO/tree/main/community-frameworks) into `wsp/inputs/catalogs/community/dora/`. SWAO reads catalogues from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged and check the copy with the [health check](/health-check).

## How to enable

1. Copy the `dora` folder from the GitHub repository into `wsp/inputs/catalogs/community/dora/` in the workspace.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [DORA]
   ```

3. Put the organisational documents into `apps/<app-id>/ingestion/`, named after the expected inputs.
4. Run the [application assessment](/assessment/application) with an LLM configured. For a landing zone, run the Landing Zone Live Assessment with `--frameworks DORA`.

## Limitations and notes

- Every citation was verified on 2026-11-06 against the EUR-Lex text of the regulation and of its eight Level 2 acts.
- In landing zone runs, organisational controls are decided from document names and readability only (`landing-zones/<lz-id>/ingestion/`); the content is reviewed in application assessments.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The official legal text is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
