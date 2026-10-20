# NCA Cloud Cybersecurity Controls CCC-2:2024, Cloud Service Provider (NCA_CCC_CSP)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `NCA_CCC_CSP` |
| Authority / publisher | National Cybersecurity Authority (NCA), Kingdom of Saudi Arabia |
| Version | CCC-2:2024 (issued 2024) |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `1.0.0` |
| Total controls | 37 |
| Scoring mode | `binary` (schema default; not declared) |
| Assessment scope (framework-meta) | `aud` |
| Signal prefix | `NCA_CCC_CSP` |
| Licence and redistribution | Published by the NCA and classified as publicly available. Control descriptions paraphrase the English text of the official publication; no legal advice. |
| Last reviewed | 2026-07-18 |

## What it is

The Cloud Cybersecurity Controls (CCC-2:2024) are issued by the National Cybersecurity Authority (NCA) of the Kingdom of Saudi Arabia. They are a mandatory extension of the Essential Cybersecurity Controls ([NCA_ECC](/frameworks/nca-ecc-2-2024)) for cloud computing and split the obligations along the shared-responsibility model: one set for cloud service providers (CSP, P-notation) and one for cloud service tenants (CST, T-notation). SWAO packages the two sides as separate frameworks.

The CSP side covers what a provider must do for the cloud technology stack it operates: governance and roles, risk management, Saudisation and personnel screening, change management, tenant isolation, network and data protection, cryptography and key management, system development security, storage media security, business continuity, and supply chain governance. It applies to cloud service providers that operate in the Kingdom or provide cloud services to Saudi government agencies, critical national infrastructure (CNI) entities or regulated private-sector organisations (`framework-meta.yaml` description).

## Who should use it in SWAO and when

Use NCA_CCC_CSP when the assessed party is the provider: a hyperscaler region, a local cloud provider or a managed platform team that offers IaaS, PaaS or SaaS to Saudi public-sector or regulated customers. Typical engagements are provider readiness reviews before NCA assessment, and partner workshops that compare a provider's controls with the obligations its tenants will inherit. For the consuming organisation use [NCA_CCC_CST](/frameworks/nca-ccc-2-2024-cst) instead, together with [NCA_ECC](/frameworks/nca-ecc-2-2024).

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

Most CSP controls concern provider governance and operations and are judged on documents. 30 of the 37 controls declare a consultant-supplied evidence file as their basis, for example `evidence/csp-12-tenant-isolation.md` for `NCA_CCC_CSP_12` Information Systems Configuration and Tenant Isolation. These files are not shipped with the framework; the engagement team collects them from the provider. Seven controls declare a signal family as evidence:

| Control | Title | Declared evidence basis |
|---|---|---|
| `NCA_CCC_CSP_11` | Identity and Access Management for Cloud Technology Stack | `IAM` |
| `NCA_CCC_CSP_16` | Cryptographic Standards for Cloud Services | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NCA_CCC_CSP_20` | Cybersecurity Event Logs and Monitoring for Cloud Technology Stack | `OBS` |
| `NCA_CCC_CSP_24` | Key Management Policy: Identification and Documentation | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NCA_CCC_CSP_25` | Key Management Policy: Implementation | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NCA_CCC_CSP_26` | Key Management: Technical Requirements | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NCA_CCC_CSP_27` | Key Management Policy: Periodic Review | `CRYPTO` ([Pass 08](/passes/08-crypto)) |

Note: this catalogue declares the signal families `IAM`, `OBS`. No pass in the current release emits signals with these prefixes, so the affected controls are in practice judged on related signals (for example Terraform, egress or cryptography findings) and on context documents.

## Control structure

The catalogue follows the CCC-2:2024 domain and subdomain numbering. Each control carries tags on the axes `domain`, `role` and `applies-to`.

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| Domain 1: Cloud Cybersecurity Governance | 9 | 0 | `NCA_CCC_CSP_01` Cybersecurity Roles and RACI for Cloud Services; `NCA_CCC_CSP_02` Cybersecurity Risk Management for Cloud Services |
| Domain 2: Cloud Cybersecurity Defense | 26 | 7 | `NCA_CCC_CSP_10` Asset Inventory and Ownership for Cloud Technology Stack; `NCA_CCC_CSP_11` Identity and Access Management for Cloud Technology Stack |
| Domain 3: Cloud Cybersecurity Resilience | 1 | 0 | `NCA_CCC_CSP_36` Cloud Business Continuity and Cybersecurity Resilience |
| Domain 4: Third-Party Cloud Cybersecurity | 1 | 0 | `NCA_CCC_CSP_37` Supply Chain and Third-Party Cybersecurity |
| **Total** | **37** | **7** |  |

Subdomains covered by the catalogue:

| Subdomain | Controls | Control IDs |
|---|---|---|
| 1-1 Cybersecurity Roles and Responsibilities | 1 | `NCA_CCC_CSP_01` |
| 1-2 Cybersecurity Risk Management | 1 | `NCA_CCC_CSP_02` |
| 1-3 Compliance with Cybersecurity Standards, Laws, and Regulations | 1 | `NCA_CCC_CSP_03` |
| 1-4 Cybersecurity in Human Resources | 2 | `NCA_CCC_CSP_04`, `NCA_CCC_CSP_05` |
| 1-5 Cybersecurity in Change Management | 4 | `NCA_CCC_CSP_06`, `NCA_CCC_CSP_07`, `NCA_CCC_CSP_08`, `NCA_CCC_CSP_09` |
| 2-1 Asset Management | 1 | `NCA_CCC_CSP_10` |
| 2-2 Identity and Access Management | 1 | `NCA_CCC_CSP_11` |
| 2-3 Information System and Information Processing Facilities Protection | 1 | `NCA_CCC_CSP_12` |
| 2-4 Networks Security Management | 1 | `NCA_CCC_CSP_13` |
| 2-5 Mobile Devices Security | 1 | `NCA_CCC_CSP_14` |
| 2-6 Data and Information Protection | 1 | `NCA_CCC_CSP_15` |
| 2-7 Cryptography | 1 | `NCA_CCC_CSP_16` |
| 2-8 Backup and Recovery Management | 1 | `NCA_CCC_CSP_17` |
| 2-9 Vulnerabilities Management | 1 | `NCA_CCC_CSP_18` |
| 2-10 Penetration Testing | 1 | `NCA_CCC_CSP_19` |
| 2-11 Cybersecurity Event Logs and Monitoring Management | 1 | `NCA_CCC_CSP_20` |
| 2-12 Cybersecurity Incident and Threat Management | 1 | `NCA_CCC_CSP_21` |
| 2-13 Physical Security | 1 | `NCA_CCC_CSP_22` |
| 2-14 Web Application Security | 1 | `NCA_CCC_CSP_23` |
| 2-15 Key Management | 4 | `NCA_CCC_CSP_24`, `NCA_CCC_CSP_25`, `NCA_CCC_CSP_26`, `NCA_CCC_CSP_27` |
| 2-16 System Development Security | 4 | `NCA_CCC_CSP_28`, `NCA_CCC_CSP_29`, `NCA_CCC_CSP_30`, `NCA_CCC_CSP_31` |
| 2-17 Storage Media Security | 4 | `NCA_CCC_CSP_32`, `NCA_CCC_CSP_33`, `NCA_CCC_CSP_34`, `NCA_CCC_CSP_35` |
| 3-1 Cybersecurity Resilience Aspects of Business Continuity Management (BCM) | 1 | `NCA_CCC_CSP_36` |
| 4-1 Supply Chain and Third-Party Cybersecurity | 1 | `NCA_CCC_CSP_37` |

## Cross-mapping to other frameworks

Per-control mappings in `controls.yaml` (`maps_to`), counted by target framework:

| Target framework | Controls with at least one `maps_to` reference |
|---|---|
| [`ISO_27001`](/frameworks/iso-27001) | 35 |
| [`NCA_ECC`](/frameworks/nca-ecc-2-2024) | 25 |

Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`NCA_ECC`](/frameworks/nca-ecc-2-2024), [`NCA_CCC_CST`](/frameworks/nca-ccc-2-2024-cst), [`ISO_27001`](/frameworks/iso-27001), [`SOC_2`](/frameworks/soc-2), [`BSI_C5`](/frameworks/bsi-c5).

## How to enable

1. **Discovery.** Copy the folder `nca-ccc-2-2024-csp` into the workspace at `wsp/inputs/catalogs/community/nca-ccc-2-2024-csp/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. This framework declares `assessment_type_scope: [aud]` only. The TUI picker for [application assessments](/assessment/application) therefore does not list it; the [landing zone assessment](/assessment/landing-zone) picker lists all installed frameworks. Setting the ID directly in `.swao.yml` works in every case.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes NCA_CCC_CSP`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [NCA_CCC_CSP]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/nca-ccc-2-2024-csp>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `nca-ccc-2-2024-csp` into your workspace at `wsp/inputs/catalogs/community/nca-ccc-2-2024-csp/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info NCA_CCC_CSP` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- The Arabic version of NCA publications is binding for interpretation; the catalogue paraphrases the English text.
- Saudisation, physical security and personnel controls cannot be evidenced from code or configuration.
- The catalogue models the main P-controls; consult the official publication for the complete control text and any sub-controls.
