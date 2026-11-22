# SOC 2 Trust Services Criteria (SOC_2)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `SOC_2` |
| Authority / publisher | American Institute of Certified Public Accountants (AICPA) |
| Version | 2017 (revised points of focus 2022) |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `2.0.0` |
| Total controls | 61 |
| Scoring mode | `binary` (declared in framework-meta.yaml) |
| Assessment scope (framework-meta) | `app`, `aud` |
| Signal prefix | `SOC2` |
| Licence and redistribution | The Trust Services Criteria are copyrighted by the AICPA and the COSO principles by COSO. The catalogue cites criterion ids only and describes each criterion in its own words; no criterion text or point of focus is reproduced. |
| Last reviewed | 2026-11-09 |

## What it is

SOC 2 is an attestation report, not a law or a certification. A licensed CPA firm examines a service organisation's controls against the AICPA Trust Services Criteria and issues a Type I report (design at a point in time) or a Type II report (design and operating effectiveness over a period). SOC 2 reports are a common requirement of U.S. enterprise buyers of SaaS and cloud services.

The criteria are grouped into five Trust Services Categories. The Common Criteria (CC, security) are required in every SOC 2 report; Availability (A), Processing Integrity (PI), Confidentiality (C) and Privacy (P) are added according to the commitments the organisation makes. The SWAO catalogue contains 61 controls, one per criterion: 33 CC, 3 A, 5 PI, 2 C and 18 P.

## Who should use it in SWAO and when

Use SOC_2 for SaaS platforms, cloud-hosted B2B services, managed service providers and data processors that sell to U.S. enterprise customers or prepare for a first SOC 2 examination. It is a good readiness check before a CPA engagement and pairs with [ISO_27001](/frameworks/iso-27001) for international buyers and [GDPR](/frameworks/gdpr) for the privacy category.

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

Each control carries one evidence tag:

| Evidence kind (tag) | Controls | Meaning |
|---|---|---|
| `evidence.workload` | 3 | Code, configuration or infrastructure evidence |
| `evidence.both` | 15 | Technical evidence plus documents that complete it |
| `evidence.organisational` | 43 | Documents only (`layer: governance`) |

Organisational controls take their evidence from the app's ingestion folder. Put the documents into `apps/<app-id>/ingestion/`; Pass 00 copies them into `wsp/inputs/` and extracts their text, and [Pass 04 (CTX)](/passes/04-ctx) turns them into signals that cite the file. A `layer: governance` control is only `SATISFIED` or `PARTIAL` when a cited signal cites one of the documents the control expects; otherwise it is `UNKNOWN` (not assessed, insufficient evidence) with the expected documents listed. Missing evidence is never a pass.

A document counts as expected when its file name contains the expected input name, ignoring case and separators, for example `vendor_risk_register.xlsx` or `incident_management_procedure.pdf`. The framework README lists which document satisfies which control. Where DORA expects the same document, the name is the same.

All 18 Privacy controls (`SOC_2_P1.1` to `SOC_2_P8.1`) declare `assessment_type_scope: [aud]`: they need audit evidence such as privacy notices, consent records and data subject request procedures. `SOC_2_CC6.4` and `SOC_2_CC6.5` are marked `csp_inherited: true`: these physical controls are typically inherited from the cloud provider's own attestation. 18 controls declare a signal family:

| Control | Title | Declared evidence basis |
|---|---|---|
| `SOC_2_CC4.1` | Ongoing and separate evaluations of controls | `TF` ([Pass 06](/passes/06-tf)), `CTX` ([Pass 04](/passes/04-ctx)), context `ict_internal_audit_plan` |
| `SOC_2_CC5.2` | General controls over technology | `TF` ([Pass 06](/passes/06-tf)), `IAM`, context `configuration_baseline` |
| `SOC_2_CC6.1` | Logical access security, authentication and encryption of protected assets | `IAM`, `CRYPTO` ([Pass 08](/passes/08-crypto)), context `access_management_policy` |
| `SOC_2_CC6.2` | User registration and authorisation before credentials are issued | `IAM`, context `access_management_policy` |
| `SOC_2_CC6.3` | Role-based access, least privilege and segregation of duties | `IAM`, context `access_management_policy` |
| `SOC_2_CC6.6` | Protection against threats from outside the system boundary | `EGR` ([Pass 07](/passes/07-egr)), `TF` ([Pass 06](/passes/06-tf)), `CTX` ([Pass 04](/passes/04-ctx)) |
| `SOC_2_CC6.7` | Controlled and protected transmission and movement of data | `EGR` ([Pass 07](/passes/07-egr)), `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `SOC_2_CC6.8` | Prevention and detection of unauthorised or malicious software | `SBOM` ([Pass 05](/passes/05-sbom)), `TF` ([Pass 06](/passes/06-tf)), `CTX` ([Pass 04](/passes/04-ctx)) |
| `SOC_2_CC7.1` | Detection of vulnerabilities and insecure configuration changes | `SBOM` ([Pass 05](/passes/05-sbom)), `TF` ([Pass 06](/passes/06-tf)), `CTX` ([Pass 04](/passes/04-ctx)), context `patch_management_policy` |
| `SOC_2_CC7.2` | Monitoring for anomalies that point to attacks, failures or errors | `TF` ([Pass 06](/passes/06-tf)), `CTX` ([Pass 04](/passes/04-ctx)), context `monitoring_and_alerting_runbook` |
| `SOC_2_CC7.3` | Evaluation of security events as incidents | `TF` ([Pass 06](/passes/06-tf)), `CTX` ([Pass 04](/passes/04-ctx)), context `incident_classification_policy` |
| `SOC_2_CC8.1` | Controlled changes to infrastructure, data, software and procedures | `TF` ([Pass 06](/passes/06-tf)), `CTX` ([Pass 04](/passes/04-ctx)), context `change_management_procedure` |
| `SOC_2_A1.1` | Capacity management | `TF` ([Pass 06](/passes/06-tf)), `CTX` ([Pass 04](/passes/04-ctx)), context `capacity_management_plan` |
| `SOC_2_A1.2` | Environmental protection, backup and recovery infrastructure | `TF` ([Pass 06](/passes/06-tf)), context `backup_policy` |
| `SOC_2_PI1.2` | Complete and accurate system inputs | `CTX` ([Pass 04](/passes/04-ctx)), context `processing_specification` |
| `SOC_2_PI1.3` | Complete, accurate and timely processing | `TF` ([Pass 06](/passes/06-tf)), `CTX` ([Pass 04](/passes/04-ctx)), context `processing_specification` |
| `SOC_2_PI1.5` | Complete and accurate storage of inputs, work in progress and outputs | `TF` ([Pass 06](/passes/06-tf)), `CTX` ([Pass 04](/passes/04-ctx)), context `processing_specification` |
| `SOC_2_C1.1` | Identification and protection of confidential information | `CRYPTO` ([Pass 08](/passes/08-crypto)), context `data_classification_policy` |

Note: this catalogue declares the signal family `IAM`. No pass in the current release emits signals with this prefix, so the affected controls are in practice judged on related signals (for example Terraform or cryptography findings) and on context documents.

## Control structure

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| CC1: Control environment | 5 | 0 | `SOC_2_CC1.1` Integrity and ethical values; `SOC_2_CC1.2` Independent oversight of internal control by the governing body |
| CC2: Communication and information | 3 | 0 | `SOC_2_CC2.1` Quality information for running internal control; `SOC_2_CC2.2` Internal communication of control objectives and duties |
| CC3: Risk assessment | 4 | 0 | `SOC_2_CC3.1` Objectives clear enough to assess risk against; `SOC_2_CC3.2` Risk identification and analysis |
| CC4: Monitoring activities | 2 | 1 | `SOC_2_CC4.1` Ongoing and separate evaluations of controls; `SOC_2_CC4.2` Reporting and correcting control deficiencies |
| CC5: Control activities | 3 | 1 | `SOC_2_CC5.1` Control activities chosen to reduce risk; `SOC_2_CC5.2` General controls over technology |
| CC6: Logical and physical access controls | 8 | 6 | `SOC_2_CC6.1` Logical access security, authentication and encryption of protected assets; `SOC_2_CC6.2` User registration and authorisation before credentials are issued |
| CC7: System operations | 5 | 3 | `SOC_2_CC7.1` Detection of vulnerabilities and insecure configuration changes; `SOC_2_CC7.2` Monitoring for anomalies that point to attacks, failures or errors |
| CC8: Change management | 1 | 1 | `SOC_2_CC8.1` Controlled changes to infrastructure, data, software and procedures |
| CC9: Risk mitigation | 2 | 0 | `SOC_2_CC9.1` Mitigation of business disruption risk; `SOC_2_CC9.2` Vendor and business partner risk |
| A: Availability | 3 | 2 | `SOC_2_A1.1` Capacity management; `SOC_2_A1.2` Environmental protection, backup and recovery infrastructure |
| PI: Processing Integrity | 5 | 3 | `SOC_2_PI1.1` Processing specifications and data definitions; `SOC_2_PI1.2` Complete and accurate system inputs |
| C: Confidentiality | 2 | 1 | `SOC_2_C1.1` Identification and protection of confidential information; `SOC_2_C1.2` Disposal of confidential information |
| P: Privacy | 18 | 0 | `SOC_2_P1.1` Privacy notice to data subjects; `SOC_2_P2.1` Choice and consent |
| **Total** | **61** | **18** |  |

## Cross-mapping to other frameworks

Per-control mappings in `controls.yaml` (`maps_to`), counted by target framework:

| Target framework | Controls with at least one `maps_to` reference |
|---|---|
| [`ISO_27001`](/frameworks/iso-27001) | 39 |
| [`BSI_C5`](/frameworks/bsi-c5) | 32 |
| [`GDPR`](/frameworks/gdpr) | 18 |
| [`DORA`](/frameworks/dora) | 7 |

Each mapping was checked on 2026-11-09 for the same subject on both sides (#4061). The seven DORA pairs are two-way and listed in the DORA README with the ISO/IEC 27001 control that joins them. The ISO/IEC 27001 and BSI C5 mappings are one-way; those catalogues do not map back to SOC 2. `SOC_2_CC3.3` (fraud risk) and `SOC_2_PI1.1` to `SOC_2_PI1.5` have no equivalent.

Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`ISO_27001`](/frameworks/iso-27001), [`BSI_C5`](/frameworks/bsi-c5), [`GDPR`](/frameworks/gdpr), [`DORA`](/frameworks/dora).

## Demo variant

| Property | Value |
|---|---|
| Framework ID | `SOC_2_DEMO` |
| Folder | `soc-2-demo` |
| Controls | 12 (CC1.1, CC2.1, CC3.2, CC4.1, CC5.2, CC6.1, CC6.5, CC7.2, CC7.4, CC8.1, CC9.2, A1.2) |
| Scoring mode | `binary` (declared) |
| Catalogue version | `0.1.0` |

The demo variant is a sample of the CC security baseline plus one availability control, intended for live presentations. Its control IDs are the same as in the full framework (`SOC_2_CC1.1` and so on), so enable either `SOC_2` or `SOC_2_DEMO` in an application, not both. It is not seeded by `swao init`. Use the full `SOC_2` for production assessments.

## How to enable

1. **Discovery.** Copy the folder `soc-2` into the workspace at `wsp/inputs/catalogs/community/soc-2/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. In the TUI, the framework picker for [application assessments](/assessment/application) lists installed frameworks whose `assessment_type_scope` includes `app`. This framework declares `app` and `aud`, so it appears there; the [landing zone assessment](/assessment/landing-zone) picker lists all installed frameworks.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes SOC_2`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [SOC_2]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/soc-2>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `soc-2` into your workspace at `wsp/inputs/catalogs/community/soc-2/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework list` lists the frameworks in the workspace.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- A SOC 2 report can only be issued by a licensed CPA firm. SWAO does not test operating effectiveness over a period, which is the essence of a Type II report.
- The applicable categories depend on the organisation's service commitments; remove the categories that are out of scope in a workspace copy, or treat their outcomes as `N_A`.
