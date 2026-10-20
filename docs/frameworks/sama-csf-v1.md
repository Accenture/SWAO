# SAMA Cyber Security Framework v1.0 (SAMA_CSF)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `SAMA_CSF` |
| Authority / publisher | Saudi Arabian Monetary Authority (SAMA) |
| Version | CSF v1.0 (first published 2017) |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `1.0.0` |
| Total controls | 30 |
| Scoring mode | `binary` (schema default). The catalogue declares a six-level maturity rating scale (0 to 5) with a regulatory minimum of Level 3 and sets `maturity_model: true` in `regime_meta`, but no `scoring_mode: maturity`. |
| Assessment scope (framework-meta) | `app`, `aud` |
| Signal prefix | `SAMA_CSF` |
| Licence and redistribution | Issued by the Saudi Arabian Monetary Authority. Descriptions paraphrase the official framework text; verify against the official SAMA publication. |
| Last reviewed | 2026-07-18 |

## What it is

The SAMA Cyber Security Framework (CSF) v1.0 is the mandatory cybersecurity framework of the Saudi Arabian Monetary Authority for the financial entities it regulates: banks, insurance companies, finance companies, payment providers and other SAMA-regulated entities. It was first published in 2017 (`framework-meta.yaml` version note).

Unlike most frameworks in the SWAO catalogue, SAMA CSF judges controls on a process maturity model:

| Level | Meaning |
|---|---|
| 0 | Incomplete: process not implemented or fails to achieve its purpose |
| 1 | Initial: process implemented but not managed |
| 2 | Managed: process planned, monitored and adjusted |
| 3 | Defined: process tailored from an organisation-wide standard (regulatory minimum) |
| 4 | Quantitatively managed: process controlled using statistical methods |
| 5 | Optimising: continuous improvement of process performance |

The SWAO catalogue covers all five domains of the framework with 30 domain-area controls.

## Who should use it in SWAO and when

Use SAMA_CSF for applications and platforms of SAMA-regulated financial institutions in the Kingdom of Saudi Arabia, for example core banking, payment, insurance policy administration or digital channel workloads that move to a cloud platform. Combine it with [NCA_ECC](/frameworks/nca-ecc-2-2024), which applies to the same entities, and with [NCA_CCC_CST](/frameworks/nca-ccc-2-2024-cst) for cloud consumption.

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

SWAO reports the standard outcomes (`SATISFIED`, `PARTIAL`, `GAP`, `UNKNOWN`, `N_A`); it does not compute a maturity level. Use the outcomes and rationales as input for the maturity rating that the institution or its auditor assigns. 27 of the 30 controls declare a consultant-supplied evidence file, for example `evidence/SAMA_CSF_GOV_01-strategy-governance-framework.md`. Four operations controls declare a signal family:

| Control | Title | Declared evidence basis |
|---|---|---|
| `SAMA_CSF_OPS_02` | Identity and Access Management | `IAM` |
| `SAMA_CSF_OPS_05` | Cryptography and Key Management | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `SAMA_CSF_OPS_07` | Cybersecurity Event Monitoring and SIEM | `OBS` |
| `SAMA_CSF_OPS_08` | Cyber Incident Management and Response | context `evidence/SAMA_CSF_OPS_08-incident-management.md`, `OBS` |

Note: this catalogue declares the signal families `IAM`, `OBS`. No pass in the current release emits signals with these prefixes, so the affected controls are in practice judged on related signals (for example Terraform, egress or cryptography findings) and on context documents.

## Control structure

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| Domain 1: Leadership and Governance | 6 | 0 | `SAMA_CSF_GOV_01` Cyber Security Strategy and Governance Framework; `SAMA_CSF_GOV_02` Cyber Security Management Structure and Ownership |
| Domain 2: Risk Management and Compliance | 4 | 0 | `SAMA_CSF_RISK_01` Cyber Risk Management Process; `SAMA_CSF_RISK_02` Third-Party Cyber Risk Assessment |
| Domain 3: Cybersecurity Operations | 12 | 4 | `SAMA_CSF_OPS_01` Asset Management and Classification; `SAMA_CSF_OPS_02` Identity and Access Management |
| Domain 4: Third-Party Cybersecurity | 4 | 0 | `SAMA_CSF_3P_01` Third-Party and Outsourcing Cyber Security Governance; `SAMA_CSF_3P_02` Cloud Computing Adoption Policy and Due Diligence |
| Domain 5: Cyber Resilience | 4 | 0 | `SAMA_CSF_RES_01` Business Continuity Management and Cyber Integration; `SAMA_CSF_RES_02` Disaster Recovery Planning and Testing |
| **Total** | **30** | **4** |  |

## Cross-mapping to other frameworks

Per-control mappings in `controls.yaml` (`maps_to`), counted by target framework:

| Target framework | Controls with at least one `maps_to` reference |
|---|---|
| [`ISO_27001`](/frameworks/iso-27001) | 30 |
| `NIST_CSF` | 29 |
| [`COBIT_5`](/frameworks/cobit-5) | 16 |
| [`NCA_ECC`](/frameworks/nca-ecc-2-2024) | 8 |
| [`SOC_2`](/frameworks/soc-2) | 4 |
| [`PCI_DSS`](/frameworks/pci-dss) | 2 |

Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`NCA_ECC`](/frameworks/nca-ecc-2-2024), [`ISO_27001`](/frameworks/iso-27001), `NIST_CSF`, [`COBIT_5`](/frameworks/cobit-5), [`PCI_DSS`](/frameworks/pci-dss), [`SOC_2`](/frameworks/soc-2).

## How to enable

1. **Discovery.** Copy the folder `sama-csf-v1` into the workspace at `wsp/inputs/catalogs/community/sama-csf-v1/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. In the TUI, the framework picker for [application assessments](/assessment/application) lists installed frameworks whose `assessment_type_scope` includes `app`. This framework declares `app` and `aud`, so it appears there; the [landing zone assessment](/assessment/landing-zone) picker lists all installed frameworks.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes SAMA_CSF`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [SAMA_CSF]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/sama-csf-v1>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `sama-csf-v1` into your workspace at `wsp/inputs/catalogs/community/sama-csf-v1/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info SAMA_CSF` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- The maturity level, and the regulatory minimum of Level 3, cannot be derived from code. It requires interviews and process evidence.
- SAMA has issued further guidance beyond CSF v1.0; check the current SAMA rulebook for the institution's full obligations.
