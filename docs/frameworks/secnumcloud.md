# SecNumCloud v3.2, ANSSI Sovereign Cloud Qualification (SECNUMCLOUD)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `SECNUMCLOUD` |
| Authority / publisher | ANSSI, Agence nationale de la sécurité des systèmes d'information (France) |
| Version | 3.2 |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `1.0.0` |
| Total controls | 59 |
| Scoring mode | `binary` (declared in framework-meta.yaml) |
| Assessment scope (framework-meta) | `lz`, `aud` |
| Signal prefix | `SECNUM` |
| Licence and redistribution | Published by ANSSI; the English translation v3.2.a is hosted by ITIF. Descriptions paraphrase the requirements and are not legal advice. |
| Last reviewed | 2026-09-22 |

**Known issue:** in this release the SECNUMCLOUD catalogue fails SWAO's schema validation and is not loaded by the compliance pass. See Limitations and notes.

## What it is

SecNumCloud is the qualification scheme of ANSSI, the French national cybersecurity agency, for cloud service providers that handle sensitive data. A provider obtains the qualification through an audit by an accredited assessment body; ANSSI publishes the list of qualified providers. Beyond classic security controls, SecNumCloud requires immunity from extraterritorial law, EU-based operation and support, reversibility and transparency, which makes it a reference point for sovereign cloud requirements in Europe.

The SWAO catalogue groups 59 controls into 19 chapters, from governance and human resources to data sovereignty, transparency and environmental management.

## Who should use it in SWAO and when

Use SECNUMCLOUD in [landing zone assessments](/assessment/landing-zone) when the target platform must meet French or EU sovereign cloud expectations: French public-sector workloads, data at Diffusion Restreinte level or equivalent, and EU-regulated workloads that require protection from extraterritorial access. It is also useful when comparing a provider's offer against [EUCS](/frameworks/eucs) high-assurance expectations or [BSI_C5](/frameworks/bsi-c5).

The catalogue assesses provider and platform posture, not application code: 18 controls are scoped `lz`, 32 `aud` and 9 both.

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

Most controls rely on documents: compliance documentation (24 controls), solution architecture (17) and operations runbooks (12). Seven controls name a specific signal as evidence instead of a signal family:

| Control | Title | Declared evidence basis |
|---|---|---|
| `SECNUM_IAM_01` | Privileged access management and least-privilege | signal `IAM_PRIVILEGED_ACCESS`, context `solution_arch` |
| `SECNUM_IAM_02` | Multi-factor authentication for privileged and remote access | signal `IAM_MFA_ENABLED` |
| `SECNUM_CRY_01` | Encryption at rest for customer data | signal `ENCRYPT_AT_REST` |
| `SECNUM_CRY_02` | Encryption in transit using approved protocols | signal `ENCRYPT_IN_TRANSIT` |
| `SECNUM_VUL_01` | Vulnerability scanning and management process | signal `VULN_SCAN_ENABLED`, context `ops_runbooks` |
| `SECNUM_LOG_01` | Security event logging coverage | signal `STATE_LOG_ENABLED` |
| `SECNUM_LOG_03` | Log retention period | signal `STATE_LOG_RETENTION_DAYS` |

## Control structure

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| Chapter 1: Governance and Risk Management | 3 | 0 | `SECNUM_GOV_01` Information security governance structure; `SECNUM_GOV_02` Risk assessment and treatment process |
| Chapter 2: Human Resources Security | 3 | 0 | `SECNUM_HRS_01` Background screening for security-sensitive roles; `SECNUM_HRS_02` Security awareness and training programme |
| Chapter 3: Physical and Environmental Security | 3 | 0 | `SECNUM_PHY_01` Secure perimeter and access control for data centres; `SECNUM_PHY_02` Environmental controls for infrastructure protection |
| Chapter 4: Asset Management and Lifecycle | 3 | 0 | `SECNUM_AST_01` Hardware asset inventory and lifecycle management; `SECNUM_AST_02` Secure disposal of storage media |
| Chapter 5: Access Control and Authentication | 4 | 2 | `SECNUM_IAM_01` Privileged access management and least-privilege; `SECNUM_IAM_02` Multi-factor authentication for privileged and remote access |
| Chapter 6: Cryptography | 3 | 2 | `SECNUM_CRY_01` Encryption at rest for customer data; `SECNUM_CRY_02` Encryption in transit using approved protocols |
| Chapter 7: Network Security and Filtering | 4 | 0 | `SECNUM_NET_01` Network segmentation and tenant isolation; `SECNUM_NET_02` Firewall and network filtering controls |
| Chapter 8: Secure Development | 3 | 0 | `SECNUM_DEV_01` Secure software development lifecycle (SSDLC); `SECNUM_DEV_02` Code review and security testing |
| Chapter 9: Patch Management and Vulnerability Management | 3 | 1 | `SECNUM_VUL_01` Vulnerability scanning and management process; `SECNUM_VUL_02` Patch management and deployment cadence |
| Chapter 10: Incident Management | 3 | 0 | `SECNUM_INC_01` Security incident response process; `SECNUM_INC_02` Security incident notification to customers |
| Chapter 11: Business Continuity | 3 | 0 | `SECNUM_BCM_01` Business continuity and disaster recovery plan; `SECNUM_BCM_02` Geographic redundancy and data replication |
| Chapter 12: Compliance and Legal Requirements | 2 | 0 | `SECNUM_CPL_01` French and EU legal framework compliance; `SECNUM_CPL_02` Intellectual property and licence compliance |
| Chapter 13: Audit and Logging | 4 | 2 | `SECNUM_LOG_01` Security event logging coverage; `SECNUM_LOG_02` Log integrity and tamper protection |
| Chapter 14: Cloud Configuration Management | 3 | 0 | `SECNUM_CFG_01` Hardened configuration baselines; `SECNUM_CFG_02` Change management for infrastructure components |
| Chapter 15: Supply Chain and Third-Party Management | 3 | 0 | `SECNUM_SCM_01` Third-party supplier security assessment; `SECNUM_SCM_02` EU-based subprocessor requirement |
| Chapter 16: Reversibility and Portability | 3 | 0 | `SECNUM_REV_01` Customer data export capability; `SECNUM_REV_02` Service termination and data deletion |
| Chapter 17: Data Sovereignty and Extraterritoriality | 3 | 0 | `SECNUM_SOV_01` No extraterritorial law exposure for customer data; `SECNUM_SOV_02` EU-based support staff access restrictions |
| Chapter 18: Transparency and Certification | 3 | 0 | `SECNUM_TRS_01` SecNumCloud qualification maintenance; `SECNUM_TRS_02` Security transparency report |
| Chapter 19: Environmental and Energy Management | 3 | 0 | `SECNUM_ENV_01` Power usage effectiveness (PUE) target; `SECNUM_ENV_02` Renewable energy sourcing |
| **Total** | **59** | **7** |  |

## Cross-mapping to other frameworks

Per-control mappings in `controls.yaml` (`maps_to`), counted by target framework:

| Target framework | Controls with at least one `maps_to` reference |
|---|---|
| [`ISO_27001`](/frameworks/iso-27001) | 38 |
| [`NIS2`](/frameworks/nis2) | 13 |
| [`GDPR`](/frameworks/gdpr) | 8 |

Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`EUCS`](/frameworks/eucs), [`BSI_C5`](/frameworks/bsi-c5), [`ISO_27001`](/frameworks/iso-27001), [`GDPR`](/frameworks/gdpr), [`NIS2`](/frameworks/nis2).

## How to enable

1. **Discovery.** Copy the folder `secnumcloud` into the workspace at `wsp/inputs/catalogs/community/secnumcloud/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. This framework declares `assessment_type_scope: [lz, aud]`. The TUI picker for [application assessments](/assessment/application) therefore does not list it; it is intended for the [landing zone assessment](/assessment/landing-zone), whose picker lists all installed frameworks. Note the known schema issue described under Limitations and notes: in this release the catalogue does not load.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes SECNUMCLOUD`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [SECNUMCLOUD]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/secnumcloud>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `secnumcloud` into your workspace at `wsp/inputs/catalogs/community/secnumcloud/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info SECNUMCLOUD` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- Known issue in this release: these seven `signal:` entries do not match the evidence types accepted by SWAO's catalogue schema, so the catalogue fails validation when it is loaded. The compliance pass then reports that no catalogue was found for `SECNUMCLOUD`. Check the result of `swao health-check` and the `COMP` signals of your run before relying on this framework. No pass in the current release emits the signal IDs named in these entries.
- SecNumCloud qualification is granted by ANSSI after an audit by an accredited body. SWAO cannot qualify or pre-qualify a provider.
