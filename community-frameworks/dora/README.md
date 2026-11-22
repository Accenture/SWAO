<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     DORA - Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# DORA: SWAO Community Framework

**Framework ID:** `DORA`
**Legal basis:** Regulation (EU) 2022/2554, in force since 16 January 2023, applicable from 17 January 2025, with its eight Level 2 acts
**Catalogue version:** 2.0.0 (reviewed 2026-11-06)
**SWAO tier:** Community (copy this folder from the GitHub repository into `wsp/inputs/catalogs/community/dora/`)
**Controls:** 55 across the five DORA pillars
**Assessment types:** application (`app`), audit (`aud`), landing zone (`lz`)

## What this framework evaluates

DORA sets the digital operational resilience requirements for financial entities in the EU: ICT risk management, ICT-related incident management and reporting, resilience testing, ICT third-party risk and information sharing. This catalogue paraphrases each requirement and cites the article, paragraph and point of Regulation (EU) 2022/2554, and the article of the Level 2 act where one applies (`regulatory_basis`, `official_control_id`).

| Pillar | Articles | Controls |
|---|---|---|
| ICT risk management | Art. 5 to 16 | 32 |
| ICT-related incident management and reporting | Art. 17 to 23 | 8 |
| Digital operational resilience testing | Art. 24 to 27 | 4 |
| ICT third-party risk | Art. 28 to 44 | 10 |
| Information sharing | Art. 45 | 1 |

Level 2 acts cited (tag `level2.<act>`): Delegated Regulations (EU) 2024/1774 (ICT risk management framework), 2024/1772 (incident classification), 2024/1773 (policy on ICT services for critical or important functions), 2025/301 (incident report content and time limits), 2025/532 (subcontracting), 2025/1190 (TLPT); Implementing Regulations (EU) 2024/2956 (register of information) and 2025/302 (incident reporting templates). EUR-Lex URLs are in `framework-meta.yaml` `companion_standards`.

Numbers in the controls are those of the legal text only (for example the 4 hour, 72 hour and one month reporting limits of 2025/301 Art. 5, the six-monthly firewall rule review of 2024/1774 Art. 13, second subparagraph). Where DORA leaves a value to the entity (log retention, backup frequency, patch deadlines, RTO and RPO, exit plan tests), the control asks for the entity's documented value.

## How to activate in SWAO

```bash
# copy this folder from the GitHub repository into the workspace
cp -r dora <workspace>/wsp/inputs/catalogs/community/dora
```

```yaml
# apps/<app-id>/.swao.yml
assessment:
  regimes_active: [DORA]
framework_context:            # only for the proportionality controls; omit keys that do not apply
  dora_simplified_framework: "false"   # "true" for Art. 16(1) entities (DORA_Art_16_1)
  dora_tlpt_required: "false"          # "true" when the TLPT authority requires TLPT (DORA_Art_26, DORA_Art_27_1)
  dora_payment_entity: "false"         # "true" for credit, payment, account information and e-money institutions (DORA_Art_23_1)
```

A control with `applies_when` is not applicable (N/A) when its key is missing or does not match. Landing zone runs select the framework with `--frameworks DORA` (`swao assess --type landing-zone-live`).

## Evidence: workload, landing zone and organisational documents

Each control carries one `evidence.*` tag:

| Tag | Count | Meaning |
|---|---|---|
| `evidence.workload` | 2 | Assessable from workload or landing zone evidence (pass signals; LZ live through `service-controls.yaml`) |
| `evidence.both` | 18 | Technical evidence plus documents that complete it |
| `evidence.organisational` | 35 | Organisational documents only; marked `layer: governance` |

Organisational controls read evidence from the app's ingestion folder, the existing context ingestion path: put the documents into `apps/<app-id>/ingestion/`. Pass 00 copies each file into `wsp/inputs/<category>/` and extracts text from PDF, DOCX, XLSX and PPTX (`module-app-assessment/src/passes/pass-00-ingest.ts:410`, routing `:186`, rules `normalize/classifier.ts:57`); Pass 04 CTX reads them and emits signals that cite the file (`pass-04-ctx.ts:262`). No other configuration file is needed.

A Landing Zone Live Assessment (`--frameworks DORA`) reads the landing zone's own ingestion folder, `landing-zones/<lz-id>/ingestion/`, with the same Pass 00 routing and the same naming rule. It runs no LLM there. The 8 organisational controls with scope `lz` (DORA_Art_5_1, 5_2, 6, 6_3, 9_7, 11_1, 11_4, 16_1) are decided from the document names and readability; the other 27 are scoped `[app, aud]` and are counted as out of scope there:
- documented (SATISFIED) when every expected document is present and has text;
- partly documented (PARTIAL) when some are;
- not evaluated (UNKNOWN) otherwise, never failed.

The content is not reviewed. The results are in `lz-organisational.json` of the run, in the `lz-live` publication and in the MCP tools, with evidence references instead of file names (`module-landing-zone/src/evaluate/lz-organisational-eval.ts`, Design 120 section 8.4).

Pass 11 accepts SATISFIED or PARTIAL for a `layer: governance` control only when a cited signal cites one of the control's expected documents; otherwise the control is UNKNOWN with `insufficient_evidence` and the expected documents in `missing_input` (needs verification, never a pass; `module-framework/src/compliance-evaluator.ts:409`, Design 104 section 5.2a). A document counts as expected when its file name contains the input name below, ignoring case and separators: `incident_classification_policy.pdf`, `Incident-Classification-Policy_v2.docx` and `register_of_information.xlsx` work; an unrelated or generically named file (`policies.pdf`) unlocks no control. Use `-` or `_` instead of spaces. PDF, DOCX, Markdown and XLSX work; avoid names with `terraform`, `deploy`, `pipeline`, `stack` or `manifest` for YAML files, which are routed as IaC.

| Document (`context_input`) | Controls (`DORA_Art_...`) |
|---|---|
| `ict_governance_terms_of_reference`, `management_body_training_record` | 5_1 |
| `management_body_approval_minutes` | 5_2 |
| `ict_risk_management_framework` | 6 |
| `ict_risk_framework_review_report`, `ict_internal_audit_plan` | 6_2 |
| `digital_operational_resilience_strategy` | 6_3 |
| `capacity_management_plan` | 7_1 |
| `cmdb_export`, `ict_asset_inventory` | 8_1 |
| `ict_risk_assessment`, `risk_register` | 8_2 |
| `third_party_dependency_map` | 8_3 |
| `register_of_information` (2024/2956 templates) | 8_3, 28_2, 29 |
| `access_management_policy` | 9_1, 9_5 |
| `encryption_policy` | 9_2 |
| `patch_management_policy` | 9_3 |
| `network_architecture` | 9_4 |
| `key_management_policy` | 9_6 |
| `information_security_policy` | 9_7 |
| `change_management_procedure` | 9_8 |
| `configuration_baseline` | 9_9 |
| `monitoring_and_alerting_runbook` | 10_1 |
| `logging_policy` | 10_2 |
| `ict_business_continuity_policy` | 11_1 |
| `ict_response_and_recovery_plan` | 11_1, 12_3 |
| `business_impact_analysis` | 11_3, 12_3 |
| `bcp_dr_test_report` | 11_4 |
| `backup_policy` | 12_1 |
| `restore_test_report` | 12_2 |
| `backup_architecture` | 12_4 |
| `solution_arch` | 12_5 |
| `post_incident_review`, `threat_intelligence_report` | 13 |
| `training_programme_record` | 13_2 |
| `crisis_communication_plan` | 14, 19_2 |
| `simplified_ict_risk_management_framework` | 16_1 |
| `incident_management_procedure`, `servicenow_tickets` (incident export) | 17_1, 17_2 |
| `incident_classification_policy` | 18_1, 18_2, 23_1 |
| `incident_reporting_procedure` | 19_1, 19_2, 20_1, 23_1 |
| `resilience_testing_programme` | 24 |
| `penetration_test_report` | 25 |
| `tlpt_plan_and_attestation` | 26, 27_1 |
| `third_party_risk_strategy`, `ict_services_policy` | 28_1 |
| `provider_due_diligence_record` | 28_3 |
| `provider_audit_plan`, `contracts` | 28_4 |
| `exit_plan` | 28_5 |
| `concentration_risk_assessment` | 29 |
| `contracts` | 30, 30_2, 30_3, 30_4 |
| `subcontractor_list` | 30_2 |
| `information_sharing_membership` | 45 |

Landing zone runs read no ingestion folder: in a live LZ assessment DORA is evaluated per service through `service-controls.yaml`, and the organisational controls stay unassessed there.

## Control ids and earlier assessments

`DORA_Art_<article>[_<n>]`: the id names the DORA article; the trailing number is a sequence, not the paragraph. Catalogue 1.0.0 had seven ids with the wrong article. They were corrected; each new control lists its old id in `replaces:`, so assessments made with 1.0.0 still resolve in publications. A replaced id is never reused.

| Old id (1.0.0) | New id (2.0.0) | Reason |
|---|---|---|
| `DORA_Art_7_2` | `DORA_Art_9_4` | Network segmentation is Art. 9(4)(b); Art. 7 has no paragraph 4 |
| `DORA_Art_11_2` | `DORA_Art_12_3` | RTO and RPO are Art. 12(6) |
| `DORA_Art_15` | `DORA_Art_17_1` | Incident management process is Art. 17 |
| `DORA_Art_16` | `DORA_Art_18_1` | Incident classification is Art. 18 |
| `DORA_Art_17` | `DORA_Art_19_1` | Major incident reporting is Art. 19 |
| `DORA_Art_19` | `DORA_Art_20_1` | Reporting templates are Art. 20 |
| `DORA_Art_31` | `DORA_Art_30_2` | Subcontracting conditions are Art. 30(2)(a) and RTS 2025/532 |

## Cross-mappings

`maps_to` targets the public catalogues NIS2, BSI C5, EUCS and GDPR, and ISO/IEC 27001:2022 Annex A (not in the public download). Every id is validated against the shipped catalogues.

### Both directions (#4058, 2026-11-08)

A DORA mapping that is an equivalence is mirrored: the NIS2, BSI C5, EUCS and ISO/IEC 27001 control lists the DORA control in its own `maps_to` (182 reverse entries), so a finding under those frameworks shows its DORA meaning. The mappings to the `-demo` catalogues are not mirrored.

A mapping stays one-way where the two controls do not carry the same obligation. The pairs below are the complete list.

| DORA control | Target | Why one-way |
|---|---|---|
| `DORA_Art_6_2` | `ISO_27001_A.5.3` | DORA asks for the segregation of the ICT risk control function only (Art. 6(4)); A.5.3 covers segregation of duties in general |
| `DORA_Art_6_2` | `EUCS_GRC_8` | continuous improvement is the lessons-learned side, which DORA places in Art. 13 (DORA_Art_13 maps both ways) |
| `DORA_Art_7_1` | `EUCS_ASM_3` | asset lifecycle management is one input to up-to-date, resilient ICT systems, not the same obligation |
| `DORA_Art_11_3` | `BSI_C5_AVL-01` | the business impact analysis is one part of a business continuity plan; the plan maps both ways with DORA_Art_11_1 |
| `DORA_Art_11_3` | `ISO_27001_A.5.30` | the business impact analysis is one part of ICT readiness for business continuity; A.5.30 maps both ways with DORA_Art_11_1 |
| `DORA_Art_12_4` | `BSI_C5_AVL-04` | restoration onto segregated systems is a specific DORA condition (Art. 12(3)) the backup control does not state |
| `DORA_Art_12_4` | `ISO_27001_A.8.13` | restoration onto segregated systems is a specific DORA condition (Art. 12(3)) the backup control does not state |
| `DORA_Art_16_1` | `NIS2_RSK_1` | the simplified framework applies only to the entities of Art. 16; the general framework DORA_Art_6 maps both ways |
| `DORA_Art_16_1` | `EUCS_GRC_2` | the simplified framework applies only to the entities of Art. 16; the general framework DORA_Art_6 maps both ways |
| `DORA_Art_18_2` | `NIS2_VHR_4` | classifying significant cyber threats is narrower than threat intelligence integration; DORA_Art_13 and DORA_Art_45 map both ways |
| `DORA_Art_18_2` | `BSI_C5_SIM-03` | classifying significant cyber threats is narrower than threat intelligence integration; DORA_Art_13 and DORA_Art_45 map both ways |
| `DORA_Art_20_1` | `BSI_C5_INM-03` | the reporting templates are a format requirement of the DORA reports; the reporting duty itself (DORA_Art_19_1) maps both ways |
| `DORA_Art_20_1` | `EUCS_INC_3` | the reporting templates are a format requirement of the DORA reports; the reporting duty itself (DORA_Art_19_1) maps both ways |
| `DORA_Art_23_1` | `NIS2_INC_1` | payment-related incidents concern payment entities only (applies_when dora_payment_entity) |
| `DORA_Art_24` | `BSI_C5_DEV-03` | code review before release is one test type of the programme; the test types map both ways with DORA_Art_25 |
| `DORA_Art_24` | `ISO_27001_A.8.29` | security testing in development is one test type of the programme; the test types map both ways with DORA_Art_25 |
| `DORA_Art_26` | `EUCS_OPS_8` | threat-led penetration testing goes beyond an annual penetration test and applies to designated entities only (applies_when dora_tlpt_required) |
| `DORA_Art_28_2` | `BSI_C5_OIS-05` | the register of information is a DORA artefact (Implementing Regulation (EU) 2024/2956); the supplier policy maps both ways with DORA_Art_28_1 |
| `DORA_Art_28_2` | `ISO_27001_A.5.19` | the register of information is a DORA artefact (Implementing Regulation (EU) 2024/2956); A.5.19 maps both ways with DORA_Art_28_1 and DORA_Art_28_3 |
| `DORA_Art_28_3` | `BSI_C5_DEV-01` | security requirements in software procurement are narrower than the due diligence of ICT third-party providers |
| `DORA_Art_28_3` | `ISO_27001_A.5.23` | A.5.23 covers cloud services only, one kind of ICT third-party service |
| `DORA_Art_30` | `BSI_C5_DAT-04` | a data processing agreement with subprocessors is one contract type; DORA Art. 30 covers every ICT service contract |
| `DORA_Art_30_4` | `ISO_27001_A.5.23` | A.5.23 covers cloud services only; the service and data processing locations of DORA apply to every ICT service |
| `DORA_Art_9_2` | `GDPR_Art_32_a` | GDPR covers personal data and protects data subjects; DORA covers all ICT of financial entities |
| `DORA_Art_11_4` | `GDPR_Art_32_d` | GDPR covers personal data and protects data subjects; DORA covers all ICT of financial entities |
| `DORA_Art_12_1` | `GDPR_Art_32_c` | GDPR covers personal data and protects data subjects; DORA covers all ICT of financial entities |
| `DORA_Art_12_4` | `GDPR_Art_32_c` | GDPR covers personal data and protects data subjects; DORA covers all ICT of financial entities |
| `DORA_Art_19_1` | `GDPR_Art_33` | a personal data breach notification to the supervisory authority is a different duty from major ICT-related incident reporting to the competent authority |
| `DORA_Art_19_2` | `GDPR_Art_34` | a communication to data subjects is a different duty from informing clients of a major incident |
| `DORA_Art_24` | `GDPR_Art_32_d` | GDPR covers personal data and protects data subjects; DORA covers all ICT of financial entities |
| `DORA_Art_30` | `GDPR_Art_28` | a processor contract under GDPR is one contract type with a personal data scope; DORA Art. 30 covers every ICT service contract |
| `DORA_Art_30_2` | `GDPR_Art_28` | a processor contract under GDPR is one contract type with a personal data scope; DORA subcontracting conditions cover every ICT service supporting a critical or important function |
| `DORA_Art_30_4` | `GDPR_Art_44` | the GDPR transfer principle concerns personal data leaving the EU; DORA asks for the service and data processing locations of every ICT service |

Inbound one-way: `KRITIS_DE_SEC_FIN` maps to `DORA_Art_6`, because the KRITIS finance-sector control names the DORA ICT risk management framework as the second half of a dual obligation (`kritis-de/controls.yaml`, control `KRITIS_DE_SEC_FIN`); the DORA framework itself does not create a KRITIS obligation.

### BSI IT-Grundschutz 2023, KRITIS-DE and SOC 2 (#4058)

These mappings rest on the mappings already in the repository, not on new reading of the legal texts: each is a two-way pair whose controls are joined through at least one shared BSI C5 or ISO/IEC 27001 control (the path below) and whose own title and description in the repository name the same subject. Candidates with a path but a different subject were left out.

| DORA control | Target | Framework | Path in the repository |
|---|---|---|---|
| `DORA_Art_5_1` | `BSI_ORP1_A1` | BSI IT-Grundschutz 2023 | `BSI_C5_OIS-02`, `ISO_27001_A.5.2` |
| `DORA_Art_5_2` | `BSI_ISMS1_A1` | BSI IT-Grundschutz 2023 | `BSI_C5_OIS-04`, `ISO_27001_A.5.1` |
| `DORA_Art_9_1` | `BSI_ORP4_A1` | BSI IT-Grundschutz 2023 | `BSI_C5_IDM-01`, `ISO_27001_A.8.2` |
| `DORA_Art_9_3` | `BSI_OPS113_A1` | BSI IT-Grundschutz 2023 | `BSI_C5_OPS-02`, `ISO_27001_A.8.8` |
| `DORA_Art_9_4` | `BSI_NET11_A1` | BSI IT-Grundschutz 2023 | `BSI_C5_COS-01`, `ISO_27001_A.8.20`, `ISO_27001_A.8.22` |
| `DORA_Art_9_4` | `BSI_NET32_A1` | BSI IT-Grundschutz 2023 | `BSI_C5_COS-02`, `ISO_27001_A.8.22` |
| `DORA_Art_9_6` | `BSI_CON1_A2` | BSI IT-Grundschutz 2023 | `ISO_27001_A.8.24` |
| `DORA_Art_9_7` | `BSI_ISMS1_A3` | BSI IT-Grundschutz 2023 | `BSI_C5_OIS-01`, `ISO_27001_A.5.1` |
| `DORA_Art_9_8` | `BSI_OPS112_A1` | BSI IT-Grundschutz 2023 | `BSI_C5_OPS-01`, `ISO_27001_A.8.32` |
| `DORA_Art_10_2` | `BSI_DER1_A2` | BSI IT-Grundschutz 2023 | `ISO_27001_A.8.15`, `ISO_27001_A.8.17` |
| `DORA_Art_11_1` | `BSI_DER4_A1` | BSI IT-Grundschutz 2023 | `BSI_C5_AVL-01`, `ISO_27001_A.5.29` |
| `DORA_Art_11_4` | `BSI_DER4_A2` | BSI IT-Grundschutz 2023 | `BSI_C5_AVL-02`, `ISO_27001_A.5.30` |
| `DORA_Art_12_1` | `BSI_CON3_A1` | BSI IT-Grundschutz 2023 | `BSI_C5_AVL-04`, `ISO_27001_A.8.13` |
| `DORA_Art_17_1` | `BSI_DER21_A1` | BSI IT-Grundschutz 2023 | `BSI_C5_INM-01`, `ISO_27001_A.5.26` |
| `DORA_Art_18_1` | `BSI_DER21_A2` | BSI IT-Grundschutz 2023 | `BSI_C5_INM-02`, `ISO_27001_A.5.25` |
| `DORA_Art_9_3` | `KRITIS_DE_AST_4` | KRITIS-DE | `BSI_C5_OPS-02`, `ISO_27001_A.8.8` |
| `DORA_Art_9_4` | `KRITIS_DE_AST_2` | KRITIS-DE | `ISO_27001_A.8.20`, `ISO_27001_A.8.22` |
| `DORA_Art_9_7` | `KRITIS_DE_GOV_5` | KRITIS-DE | `BSI_C5_OIS-01`, `ISO_27001_A.5.1` |
| `DORA_Art_10_1` | `KRITIS_DE_INC_4` | KRITIS-DE | `BSI_C5_SIM-01`, `ISO_27001_A.8.16` |
| `DORA_Art_11_1` | `KRITIS_DE_BCM_2` | KRITIS-DE | `BSI_C5_AVL-01`, `ISO_27001_A.5.29`, `ISO_27001_A.5.30` |
| `DORA_Art_12_1` | `KRITIS_DE_BCM_4` | KRITIS-DE | `BSI_C5_AVL-04`, `ISO_27001_A.8.13` |
| `DORA_Art_9_1` | `SOC_2_CC6.1` | SOC 2 | `ISO_27001_A.5.15` |
| `DORA_Art_9_8` | `SOC_2_CC8.1` | SOC 2 | `ISO_27001_A.8.32` |
| `DORA_Art_11_4` | `SOC_2_A1.3` | SOC 2 | `ISO_27001_A.5.30` |
| `DORA_Art_12_1` | `SOC_2_A1.2` | SOC 2 | `ISO_27001_A.8.13` |
| `DORA_Art_13` | `SOC_2_CC7.5` | SOC 2 | `ISO_27001_A.5.27` |
| `DORA_Art_17_1` | `SOC_2_CC7.4` | SOC 2 | `ISO_27001_A.5.26` |
| `DORA_Art_18_1` | `SOC_2_CC7.3` | SOC 2 | `ISO_27001_A.5.25` |

## Sources and verification

Every article, paragraph and point cited was verified on 2026-11-06 against the EUR-Lex text of Regulation (EU) 2022/2554 and of the eight Level 2 acts (#3965); the references link the EUR-Lex ELI page of each act. EBA/GL/2019/04 is not a DORA source (amended by EBA/GL/2025/02). The Digital Omnibus proposal COM(2025) 837 would change incident reporting channels; it is pending (`next_review_date`).

Control descriptions paraphrase the legal text and are not legal advice.

## Contributor

SWAO Development Team (Accenture), https://github.com/Accenture/SWAO
