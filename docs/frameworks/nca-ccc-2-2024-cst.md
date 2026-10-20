# NCA Cloud Cybersecurity Controls CCC-2:2024, Cloud Service Tenant (NCA_CCC_CST)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `NCA_CCC_CST` |
| Authority / publisher | National Cybersecurity Authority (NCA), Kingdom of Saudi Arabia |
| Version | CCC-2:2024 (issued 2024) |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `1.0.0` |
| Total controls | 18 |
| Scoring mode | `binary` (schema default; not declared) |
| Assessment scope (framework-meta) | `app`, `aud` |
| Signal prefix | `NCA_CCC_CST` |
| Licence and redistribution | Published by the NCA and classified as publicly available. Control descriptions paraphrase the English text of the official publication; no legal advice. |
| Last reviewed | 2026-07-18 |

## What it is

The Cloud Cybersecurity Controls (CCC-2:2024) are issued by the National Cybersecurity Authority (NCA) of the Kingdom of Saudi Arabia. They are a mandatory extension of the Essential Cybersecurity Controls ([NCA_ECC](/frameworks/nca-ecc-2-2024)) for cloud computing and split the obligations along the shared-responsibility model: one set for cloud service providers (CSP, P-notation) and one for cloud service tenants (CST, T-notation). SWAO packages the two sides as separate frameworks.

The CST side covers what a consuming organisation must do: cloud roles and risk management, monitoring the provider's compliance, screening of staff in cloud-sensitive functions, an inventory of cloud services, credential and access management, verification of community cloud isolation, protection of the connection to the provider, an exit strategy, cryptography and key management, vulnerability management, logging, and disaster recovery for cloud. CSTs must comply with both ECC and CCC. CCC applies to Saudi government agencies, CNI operators and private-sector entities that use or plan to use cloud services (`framework-meta.yaml` description).

## Who should use it in SWAO and when

Use NCA_CCC_CST when an organisation subject to NCA oversight moves an application to the cloud or already runs it there: a ministry portal, a CNI operator's back-office system or a regulated company's SaaS workload. It fits application and migration assessments, typically combined with [NCA_ECC](/frameworks/nca-ecc-2-2024) and, for financial institutions, [SAMA_CSF](/frameworks/sama-csf-v1). Use [NCA_CCC_CSP](/frameworks/nca-ccc-2-2024-csp) when the provider itself is assessed.

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

Eleven of the 18 controls declare a consultant-supplied evidence file, for example `evidence/cst-10-data-exit-strategy.md` for `NCA_CCC_CST_10` Cloud Data Exit Strategy and Secure Transfer. These files are not shipped with the framework. Seven controls declare a signal family that code, configuration and infrastructure-as-code analysis can contribute to:

| Control | Title | Declared evidence basis |
|---|---|---|
| `NCA_CCC_CST_06` | Identity and Access Management for Cloud Credentials | `IAM` |
| `NCA_CCC_CST_11` | Cryptographic Standards for Cloud Data Protection | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NCA_CCC_CST_13` | Cloud Service Log Collection and Monitoring | `OBS` |
| `NCA_CCC_CST_14` | Key Management Policy: Identification and Documentation | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NCA_CCC_CST_15` | Key Management Policy: Implementation | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NCA_CCC_CST_16` | Key Management: Technical Requirements | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NCA_CCC_CST_17` | Key Management Policy: Periodic Review | `CRYPTO` ([Pass 08](/passes/08-crypto)) |

Note: this catalogue declares the signal families `IAM`, `OBS`. No pass in the current release emits signals with these prefixes, so the affected controls are in practice judged on related signals (for example Terraform, egress or cryptography findings) and on context documents.

## Control structure

The catalogue follows the CCC-2:2024 domain and subdomain numbering. The `framework-meta.yaml` description names four domains; the catalogue contains controls for Domains 1 to 3 and none for Domain 4 (Third-Party Cloud Cybersecurity). Each control carries tags on the axes `domain`, `role` and `applies-to`.

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| Domain 1: Cloud Cybersecurity Governance | 4 | 0 | `NCA_CCC_CST_01` Cybersecurity Roles and RACI for Cloud Services; `NCA_CCC_CST_02` Cybersecurity Risk Management for Cloud Services |
| Domain 2: Cloud Cybersecurity Defense | 13 | 7 | `NCA_CCC_CST_05` Inventory of Cloud Services and Related Technology Assets; `NCA_CCC_CST_06` Identity and Access Management for Cloud Credentials |
| Domain 3: Cloud Cybersecurity Resilience | 1 | 0 | `NCA_CCC_CST_18` Cloud Disaster Recovery and Business Continuity |
| **Total** | **18** | **7** |  |

Subdomains covered by the catalogue:

| Subdomain | Controls | Control IDs |
|---|---|---|
| 1-1 Cybersecurity Roles and Responsibilities | 1 | `NCA_CCC_CST_01` |
| 1-2 Cybersecurity Risk Management | 1 | `NCA_CCC_CST_02` |
| 1-3 Compliance with Cybersecurity Standards, Laws, and Regulations | 1 | `NCA_CCC_CST_03` |
| 1-4 Cybersecurity in Human Resources | 1 | `NCA_CCC_CST_04` |
| 2-1 Asset Management | 1 | `NCA_CCC_CST_05` |
| 2-2 Identity and Access Management | 1 | `NCA_CCC_CST_06` |
| 2-3 Information System and Information Processing Facilities Protection | 1 | `NCA_CCC_CST_07` |
| 2-4 Networks Security Management | 1 | `NCA_CCC_CST_08` |
| 2-5 Mobile Devices Security | 1 | `NCA_CCC_CST_09` |
| 2-6 Data and Information Protection | 1 | `NCA_CCC_CST_10` |
| 2-7 Cryptography | 1 | `NCA_CCC_CST_11` |
| 2-9 Vulnerabilities Management | 1 | `NCA_CCC_CST_12` |
| 2-11 Cybersecurity Event Logs and Monitoring Management | 1 | `NCA_CCC_CST_13` |
| 2-15 Key Management | 4 | `NCA_CCC_CST_14`, `NCA_CCC_CST_15`, `NCA_CCC_CST_16`, `NCA_CCC_CST_17` |
| 3-1 Cybersecurity Resilience Aspects of Business Continuity Management (BCM) | 1 | `NCA_CCC_CST_18` |

## Cross-mapping to other frameworks

Per-control mappings in `controls.yaml` (`maps_to`), counted by target framework:

| Target framework | Controls with at least one `maps_to` reference |
|---|---|
| [`ISO_27001`](/frameworks/iso-27001) | 16 |
| [`NCA_ECC`](/frameworks/nca-ecc-2-2024) | 18 |

Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`NCA_ECC`](/frameworks/nca-ecc-2-2024), [`NCA_CCC_CSP`](/frameworks/nca-ccc-2-2024-csp), [`ISO_27001`](/frameworks/iso-27001), [`SAMA_CSF`](/frameworks/sama-csf-v1).

## How to enable

1. **Discovery.** Copy the folder `nca-ccc-2-2024-cst` into the workspace at `wsp/inputs/catalogs/community/nca-ccc-2-2024-cst/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. In the TUI, the framework picker for [application assessments](/assessment/application) lists installed frameworks whose `assessment_type_scope` includes `app`. This framework declares `app` and `aud`, so it appears there; the [landing zone assessment](/assessment/landing-zone) picker lists all installed frameworks.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes NCA_CCC_CST`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [NCA_CCC_CST]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/nca-ccc-2-2024-cst>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `nca-ccc-2-2024-cst` into your workspace at `wsp/inputs/catalogs/community/nca-ccc-2-2024-cst/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info NCA_CCC_CST` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- The Arabic version of NCA publications is binding for interpretation; the catalogue paraphrases the English text.
- Tenant obligations that depend on the provider (for example isolation in a community cloud) need provider attestations; SWAO cannot inspect the provider's platform.
- The catalogue models the main T-controls; consult the official publication for the complete control text.
