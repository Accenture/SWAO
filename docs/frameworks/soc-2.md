# SOC 2 Trust Services Criteria (SOC_2)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `SOC_2` |
| Authority / publisher | American Institute of Certified Public Accountants (AICPA) |
| Version | 2017-revised |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `1.0.0` |
| Total controls | 64 |
| Scoring mode | `binary` (declared in framework-meta.yaml) |
| Assessment scope (framework-meta) | `app`, `aud` |
| Signal prefix | `SOC2` |
| Licence and redistribution | The criteria are publicly summarised by the AICPA; the full AT-C section 205 guide is a paid publication. Descriptions paraphrase the criteria; no AICPA text is reproduced. |
| Last reviewed | 2026-09-21 |

## What it is

SOC 2 is an attestation report, not a law or a certification. A licensed CPA firm examines a service organisation's controls against the AICPA Trust Services Criteria and issues a Type I report (design at a point in time) or a Type II report (design and operating effectiveness over a period). SOC 2 reports are a common requirement of U.S. enterprise buyers of SaaS and cloud services.

The criteria are grouped into five Trust Services Categories. The Common Criteria (CC, security) are required in every SOC 2 report; Availability (A), Processing Integrity (PI), Confidentiality (C) and Privacy (P) are added according to the commitments the organisation makes. The SWAO catalogue contains 64 controls: 36 CC, 3 A, 5 PI, 2 C and 18 P.

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

Each control in the catalogue also declares an `evidence_basis`: the signal family or document it is meant to be judged on. The evaluator does not filter on this field. It tells reviewers which evidence matters and is shown in the HTML publication as the scope of the automated check. Documents such as policies, runbooks and architecture descriptions reach the run through the [ingest](/passes/00-ingest) and [context](/passes/04-ctx) passes.

All 18 Privacy controls (`SOC_2_P1.1` to `SOC_2_P8.1`) declare `assessment_type_scope: [aud]`: they need audit evidence such as privacy notices, consent records and data subject request procedures. Across the catalogue, 29 controls name the solution architecture and 27 the operations runbooks as context. `SOC_2_CC6.4` Physical access restrictions is marked `csp_inherited: true`, meaning the control is typically inherited from the cloud provider's own attestation. 18 controls declare a signal family:

| Control | Title | Declared evidence basis |
|---|---|---|
| `SOC_2_CC4.1` | Ongoing evaluations of internal controls | `OBS`, context `ops_runbooks` |
| `SOC_2_CC5.1` | Selection and development of control activities to mitigate risks | `TF` ([Pass 06](/passes/06-tf)), context `solution_arch` |
| `SOC_2_CC5.2` | Selection and development of general technology controls | `TF` ([Pass 06](/passes/06-tf)), `IAM` |
| `SOC_2_CC6.1` | Logical access security controls | `IAM` |
| `SOC_2_CC6.2` | Access provisioning and removal | `IAM` |
| `SOC_2_CC6.3` | Access removal on role change or termination | `IAM` |
| `SOC_2_CC6.5` | Encryption of data at rest and in transit | `CRYPTO` ([Pass 08](/passes/08-crypto)), `EGR` ([Pass 07](/passes/07-egr)) |
| `SOC_2_CC6.6` | Protection against threats from outside system boundaries | `EGR` ([Pass 07](/passes/07-egr)), `OBS` |
| `SOC_2_CC6.7` | Protection and transmission of confidential information | `EGR` ([Pass 07](/passes/07-egr)), `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `SOC_2_CC6.8` | Detection of unauthorised changes to infrastructure | `TF` ([Pass 06](/passes/06-tf)), `OBS` |
| `SOC_2_CC7.1` | Detection and monitoring of new vulnerabilities | `OBS`, context `cmdb_export` |
| `SOC_2_CC7.2` | Monitoring for anomalous activity | `OBS` |
| `SOC_2_CC7.3` | Evaluation of security incidents | context `ops_runbooks`, `OBS` |
| `SOC_2_CC8.1` | Managed infrastructure, data, software, and procedure changes | context `ops_runbooks`, `TF` ([Pass 06](/passes/06-tf)) |
| `SOC_2_A1.1` | Availability commitments and system requirements | `OBS`, context `ops_runbooks` |
| `SOC_2_PI1.3` | System processing is complete, accurate, timely, and authorised | context `solution_arch`, `OBS` |
| `SOC_2_PI1.5` | Detection and correction of processing errors | context `ops_runbooks`, `OBS` |
| `SOC_2_P6.7` | Personal information disclosed only through secure means | `CRYPTO` ([Pass 08](/passes/08-crypto)), `EGR` ([Pass 07](/passes/07-egr)) |

Note: this catalogue declares the signal families `IAM`, `OBS`. No pass in the current release emits signals with these prefixes, so the affected controls are in practice judged on related signals (for example Terraform, egress or cryptography findings) and on context documents.

## Control structure

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| CC1: Control Environment | 5 | 0 | `SOC_2_CC1.1` Integrity and ethical values; `SOC_2_CC1.2` Board independence and oversight of information security |
| CC2: Communication and Information | 3 | 0 | `SOC_2_CC2.1` Relevant, quality information to support internal controls; `SOC_2_CC2.2` Internal communication of information security objectives and responsibilities |
| CC3: Risk Assessment | 4 | 0 | `SOC_2_CC3.1` Specification of objectives; `SOC_2_CC3.2` Risk identification and analysis |
| CC4: Monitoring Activities | 2 | 1 | `SOC_2_CC4.1` Ongoing evaluations of internal controls; `SOC_2_CC4.2` Communication of internal control deficiencies |
| CC5: Control Activities | 3 | 2 | `SOC_2_CC5.1` Selection and development of control activities to mitigate risks; `SOC_2_CC5.2` Selection and development of general technology controls |
| CC6: Logical and Physical Access Controls | 8 | 7 | `SOC_2_CC6.1` Logical access security controls; `SOC_2_CC6.2` Access provisioning and removal |
| CC7: System Operations | 5 | 3 | `SOC_2_CC7.1` Detection and monitoring of new vulnerabilities; `SOC_2_CC7.2` Monitoring for anomalous activity |
| CC8: Change Management | 4 | 1 | `SOC_2_CC8.1` Managed infrastructure, data, software, and procedure changes; `SOC_2_CC8.2` Software acquisition and development controls |
| CC9: Risk Mitigation | 2 | 0 | `SOC_2_CC9.1` Risk mitigation activities including transfer; `SOC_2_CC9.2` Assessment of vendor and business partner risk |
| A: Availability | 3 | 1 | `SOC_2_A1.1` Availability commitments and system requirements; `SOC_2_A1.2` Environmental threats and recovery planning |
| PI: Processing Integrity | 5 | 2 | `SOC_2_PI1.1` Complete, accurate, and timely processing; `SOC_2_PI1.2` System inputs are complete, accurate, and authorised |
| C: Confidentiality | 2 | 0 | `SOC_2_C1.1` Identification and maintenance of confidential information; `SOC_2_C1.2` Disposal of confidential information |
| P: Privacy | 18 | 1 | `SOC_2_P1.1` Privacy notice provided to data subjects; `SOC_2_P2.1` Choice and consent for personal information collection |
| **Total** | **64** | **18** |  |

## Cross-mapping to other frameworks

Per-control mappings in `controls.yaml` (`maps_to`), counted by target framework:

| Target framework | Controls with at least one `maps_to` reference |
|---|---|
| [`ISO_27001`](/frameworks/iso-27001) | 43 |
| [`GDPR`](/frameworks/gdpr) | 11 |

Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`ISO_27001`](/frameworks/iso-27001), [`BSI_C5`](/frameworks/bsi-c5), [`GDPR`](/frameworks/gdpr), [`EUCS`](/frameworks/eucs), [`NIS2`](/frameworks/nis2).

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
- Demo variant `SOC_2_DEMO`: <https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/soc-2-demo>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `soc-2` into your workspace at `wsp/inputs/catalogs/community/soc-2/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info SOC_2` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- A SOC 2 report can only be issued by a licensed CPA firm. SWAO does not test operating effectiveness over a period, which is the essence of a Type II report.
- The applicable categories depend on the organisation's service commitments; remove the categories that are out of scope in a workspace copy, or treat their outcomes as `N_A`.
