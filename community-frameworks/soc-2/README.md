<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     SOC 2 - Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# SOC 2: SWAO Community Framework

**Framework ID:** `SOC_2`
**Basis:** AICPA Trust Services Criteria (TSP Section 100, 2017, revised points of focus 2022)
**Catalogue version:** 2.0.0 (reviewed 2026-11-09, #4061)
**SWAO tier:** Community (copy this folder from the GitHub repository into `wsp/inputs/catalogs/community/soc-2/`)
**Controls:** 61, one per Trust Services Criterion
**Assessment types:** application (`app`), audit (`aud`); the privacy controls are audit only

## What this framework evaluates

SOC 2 is an attestation, not a law or a certification: a licensed CPA firm examines a service organisation's controls against the AICPA Trust Services Criteria and issues a Type 1 report (design at a point in time) or a Type 2 report (design and operating effectiveness over a period). Enterprise buyers of SaaS and cloud services, above all in the US market, ask their providers for it.

This catalogue holds one control per criterion. Each control describes the criterion in SWAO's own words and cites the criterion id (`references`, `official_control_id`; for CC1 to CC5 also the COSO 2013 principle the criterion is based on). A SWAO assessment is a readiness check before an examination; it does not replace one, and it gives no opinion on operating effectiveness over a period.

| Category | Criteria | Controls | In a SOC 2 report |
|---|---|---|---|
| Security, Common Criteria (CC) | CC1.1 to CC9.2 | 33 | Always |
| Availability (A) | A1.1 to A1.3 | 3 | When the organisation commits to availability |
| Processing Integrity (PI) | PI1.1 to PI1.5 | 5 | When processing results are part of the commitments |
| Confidentiality (C) | C1.1, C1.2 | 2 | When confidential information is handled |
| Privacy (P) | P1.1 to P8.1 | 18 | When personal information is part of the commitments |

The Common Criteria in detail:

| Series | Subject | Controls |
|---|---|---|
| CC1 | Control environment (COSO principles 1 to 5) | 5 |
| CC2 | Communication and information (COSO principles 13 to 15) | 3 |
| CC3 | Risk assessment (COSO principles 6 to 9) | 4 |
| CC4 | Monitoring activities (COSO principles 16 and 17) | 2 |
| CC5 | Control activities (COSO principles 10 to 12) | 3 |
| CC6 | Logical and physical access controls | 8 |
| CC7 | System operations | 5 |
| CC8 | Change management | 1 |
| CC9 | Risk mitigation | 2 |

## How to activate in SWAO

```bash
# copy this folder from the GitHub repository into the workspace
cp -r soc-2 <workspace>/wsp/inputs/catalogs/community/soc-2
```

```yaml
# apps/<app-id>/.swao.yml
assessment:
  regimes_active: [SOC_2]
```

The catalogue sets no `applies_when`: every control applies. Availability, Processing Integrity, Confidentiality and Privacy are only part of a SOC 2 report when the service organisation scopes them in; when one of them is out of scope for the system under review, read its controls as not applicable. The privacy controls carry `assessment_type_scope: [aud]` and are evaluated in audit runs only, because privacy practices need a manual review.

The installed copy at `wsp/inputs/catalogs/community/soc-2/controls.yaml` overrides the bundled version. See `CONTRIBUTING.md` for the authoring guide.

## Evidence: workload and organisational documents

Each control carries one `evidence.*` tag:

| Tag | Count | Meaning |
|---|---|---|
| `evidence.workload` | 3 | Assessable from workload evidence (pass signals): CC6.6, CC6.7, CC6.8 |
| `evidence.both` | 15 | Technical evidence plus documents that complete it |
| `evidence.organisational` | 43 | Organisational documents only; marked `layer: governance` |

Organisational controls read evidence from the app's ingestion folder: put the documents into `apps/<app-id>/ingestion/`. Pass 00 copies each file into `wsp/inputs/<category>/` and extracts text from PDF, DOCX, XLSX and PPTX; Pass 04 CTX reads them and emits signals that cite the file. Pass 11 accepts SATISFIED or PARTIAL for a `layer: governance` control only when a cited signal cites one of the control's expected documents; otherwise the control is UNKNOWN with `insufficient_evidence` and the expected documents in `missing_input` (needs verification, never a pass; `module-framework/src/compliance-evaluator.ts`, `requireOrganisationalEvidence`).

A document counts as expected when its file name contains the input name below, ignoring case and separators: `vendor_risk_register.xlsx` and `Incident-Management-Procedure_v3.docx` work; a generically named file (`policies.pdf`) unlocks no control. Where DORA uses the same document, the name is the same, so one document serves both frameworks.

| Document (`context_input`) | Controls (`SOC_2_...`) |
|---|---|
| `code_of_conduct` | CC1.1, CC1.5 |
| `security_governance_charter` | CC1.2, CC1.3, CC1.5 |
| `organisation_chart` | CC1.3 |
| `training_programme_record` | CC1.4, CC2.2 |
| `security_reporting_pack` | CC2.1 |
| `information_security_policy` | CC2.2, CC5.3 |
| `customer_security_commitments` | CC2.3 |
| `security_objectives` | CC3.1 |
| `ict_risk_assessment` | CC3.2, CC3.3, CC3.4 |
| `risk_register` | CC3.2, CC5.1 |
| `ict_internal_audit_plan` | CC4.1 |
| `deficiency_tracking_log` | CC4.2 |
| `configuration_baseline` | CC5.2 |
| `operating_procedures` | CC5.3 |
| `access_management_policy` | CC6.1, CC6.2, CC6.3 |
| `csp_assurance_report` (the cloud provider's SOC 2 or C5 report) | CC6.4, CC6.5 |
| `media_disposal_procedure` | CC6.5 |
| `patch_management_policy` | CC7.1 |
| `monitoring_and_alerting_runbook` | CC7.2 |
| `incident_classification_policy` | CC7.3 |
| `incident_management_procedure` | CC7.4 |
| `post_incident_review` | CC7.5 |
| `change_management_procedure` | CC8.1 |
| `ict_business_continuity_policy` | CC9.1 |
| `vendor_risk_register` | CC9.2 |
| `capacity_management_plan` | A1.1 |
| `backup_policy` | A1.2 |
| `bcp_dr_test_report`, `restore_test_report` | A1.3 |
| `processing_specification` | PI1.1 to PI1.5 |
| `data_classification_policy` | C1.1 |
| `data_disposal_procedure` | C1.2, P4.3 |
| `privacy_notice` | P1.1 |
| `consent_records` | P2.1, P3.2 |
| `record_of_processing` | P3.1, P4.1 |
| `retention_schedule` | P4.2 |
| `data_subject_request_procedure` | P5.1, P5.2, P6.7 |
| `disclosure_register` | P6.1, P6.2 |
| `breach_register` | P6.3 |
| `vendor_privacy_agreements` | P6.4, P6.5 |
| `breach_notification_procedure` | P6.6 |
| `data_quality_procedure` | P7.1 |
| `privacy_complaints_log` | P8.1 |

CC6.4 and CC6.5 carry `csp_inherited: true`: for a cloud-hosted service the physical controls are the provider's, shown through its assurance report.

`service-controls.yaml` maps SWAO capability tags (landing zone catalogue `fulfills`) to the controls a service helps to meet, for example `key_vault` to CC6.1 and `backup` to A1.2. The rows are drafted by `scripts/draft-service-controls.py` with the SOC 2 entry of `scripts/service-controls-overrides.yaml` and are `confidence: derived` until a human review sets `curated`.

## Control ids and earlier assessments

Control ids are `SOC_2_<criterion>`. Catalogue 1.0.0 (64 controls) had three ids the Trust Services Criteria do not have, `SOC_2_CC8.2`, `SOC_2_CC8.3` and `SOC_2_CC8.4`; their content (acquired software, security testing before release, data migration) is part of `SOC_2_CC8.1`, which lists them in `replaces:` so earlier assessments still resolve. A replaced id is never reused.

Catalogue 2.0.0 also corrected the subject of eleven controls whose id named another criterion's content: CC6.3 (role-based access and least privilege, was access removal), CC6.5 (media disposal, was encryption; encryption is in CC6.1 and CC6.7), CC6.6 (boundary protection, was malware; malware is CC6.8), CC6.8 (malicious software, was infrastructure change detection), CC7.5 (recovery from incidents), PI1.1 (processing specifications), PI1.5 (storage of processing data), and P6.2 to P6.5 and P6.7 (disclosure records, vendor commitments, accounting to data subjects). Results of earlier assessments for these ids refer to the old subject.

## Cross-mappings

`maps_to` names equivalent controls in ISO/IEC 27001:2022 Annex A (39 controls with at least one mapping), BSI C5:2020 (32), GDPR (18, the privacy category) and DORA (7); 55 of the 61 controls map to at least one framework. CC3.3 (fraud risk) and PI1.1 to PI1.5 have no equivalent in these catalogues. Each mapping was checked on 2026-11-09 for the same subject on both sides (#4061).

The seven DORA pairs are two-way and listed in the DORA README with the shared ISO/IEC 27001 control that joins them (#4058):

| SOC 2 control | DORA control |
|---|---|
| `SOC_2_CC6.1` | `DORA_Art_9_1` |
| `SOC_2_CC7.3` | `DORA_Art_18_1` |
| `SOC_2_CC7.4` | `DORA_Art_17_1` |
| `SOC_2_CC7.5` | `DORA_Art_13` |
| `SOC_2_CC8.1` | `DORA_Art_9_8` |
| `SOC_2_A1.2` | `DORA_Art_12_1` |
| `SOC_2_A1.3` | `DORA_Art_11_4` |

The ISO/IEC 27001 and BSI C5 mappings are one-way: those catalogues do not map back to SOC 2. Mappings from other frameworks into SOC 2 (GDPR, HIPAA, COBIT 5) are maintained in those catalogues. The cross-map gate `tests/audit-gates/framework-cross-map.gate.mjs` checks that every `maps_to` id resolves; `--report` lists the one-way pairs.

## Sources and copyright

- AICPA, TSP Section 100, 2017 Trust Services Criteria for Security, Availability, Processing Integrity, Confidentiality, and Privacy, with the revised points of focus of 2022. Available from the AICPA (aicpa-cima.com).
- COSO, Internal Control - Integrated Framework (2013), the 17 principles behind CC1 to CC5.

The Trust Services Criteria are copyrighted by the AICPA and the COSO principles by COSO. This catalogue cites criterion ids only and describes each criterion in SWAO's own words; it does not reproduce the criteria text or the points of focus. It is not an AICPA publication, gives no assurance and does not replace a SOC 2 examination by a licensed CPA firm or the criteria themselves.

The criterion list follows the research notes of the SWAO team; a check of every id and subject against the AICPA publication is open before publication (#4061).

## Contributor

SWAO Development Team (Accenture), https://github.com/Accenture/SWAO
