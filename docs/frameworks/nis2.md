# NIS2 Directive, Network and Information Security Directive 2 (NIS2)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `NIS2` |
| Authority / publisher | European Union (Directive (EU) 2022/2555) |
| Version | 2022-12-27 (publication in the Official Journal) |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `1.0.0` |
| Total controls | 46 |
| Scoring mode | `binary` (declared in framework-meta.yaml) |
| Assessment scope (framework-meta) | `app`, `aud` |
| Signal prefix | `NIS2` |
| Licence and redistribution | EU legislative act, reusable under EUR-Lex terms. Descriptions paraphrase the directive; national transposition laws vary. |
| Last reviewed | 2026-09-21 |

## What it is

NIS2 is Directive (EU) 2022/2555 on measures for a high common level of cybersecurity across the Union. It replaced the first NIS Directive, had to be transposed by the member states by 17 October 2024, and applies through national law (for example the German NIS2 implementation act referenced in the catalogue). It covers medium and large essential entities (EE) and important entities (IE) in 18 sectors, including energy, transport, banking, financial market infrastructure, health, drinking and waste water, digital infrastructure, managed ICT services, public administration and space.

The core obligations are in Article 20 (accountability and training of management bodies), Article 21 (ten minimum cybersecurity risk-management measures, Art. 21(2)(a) to (j)) and Article 23 (incident reporting: early warning within 24 hours, notification within 72 hours, final report within one month). The SWAO catalogue models these as 46 controls in 10 domains.

## Who should use it in SWAO and when

Use NIS2 for applications and platforms of organisations that are, or may become, essential or important entities: utilities, hospitals, banks, transport operators, cloud and data centre providers, managed service providers, DNS providers and public administration. It is the default EU baseline for sovereign-cloud migration programmes and combines well with [ISO_27001](/frameworks/iso-27001) (shared control vocabulary), [DORA](/frameworks/dora) for financial entities, [KRITIS_DE](/frameworks/kritis-de) for German critical infrastructure operators and [BSI_GRUNDSCHUTZ_2023](/frameworks/bsi-grundschutz-2023) where the BSI methodology is used.

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

The catalogue separates technical measures, which code and infrastructure evidence can support, from governance duties, which need documents. 12 controls declare `assessment_type_scope: [aud]` (audit evidence only): `NIS2_GOV_1` to `NIS2_GOV_4`, `NIS2_RSK_6`, `NIS2_INC_3` to `NIS2_INC_5` (the reporting timeline), `NIS2_BCM_3`, `NIS2_SCM_3`, `NIS2_NSC_4` and `NIS2_HRS_2`. Most other controls name operations runbooks (25 controls) or the solution architecture (13 controls) as context. 14 controls declare a signal family:

| Control | Title | Declared evidence basis |
|---|---|---|
| `NIS2_INC_1` | Incident detection and classification process | `OBS`, context `ops_runbooks` |
| `NIS2_SCM_4` | Software supply chain security and SBOM | `SBOM` ([Pass 05](/passes/05-sbom)) |
| `NIS2_NSC_1` | Network security management and segmentation | `EGR` ([Pass 07](/passes/07-egr)), `TF` ([Pass 06](/passes/06-tf)) |
| `NIS2_NSC_2` | Endpoint security and patch management | `TF` ([Pass 06](/passes/06-tf)) |
| `NIS2_NSC_3` | Security monitoring and anomaly detection | `OBS` |
| `NIS2_NSC_5` | Security configuration management and hardening | `TF` ([Pass 06](/passes/06-tf)) |
| `NIS2_CRY_2` | Encryption of data at rest and in transit | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NIS2_CRY_3` | Cryptographic key management | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NIS2_HRS_3` | Access control based on least privilege | `IAM` |
| `NIS2_HRS_4` | Privileged access management | `IAM` |
| `NIS2_HRS_5` | Identity lifecycle and offboarding procedures | `IAM` |
| `NIS2_MFA_1` | MFA for critical systems and remote access | `IAM` |
| `NIS2_VHR_1` | Vulnerability identification and risk-based assessment | `TF` ([Pass 06](/passes/06-tf)) |
| `NIS2_VHR_2` | Patch and vulnerability remediation timescales | `TF` ([Pass 06](/passes/06-tf)), context `ops_runbooks` |

Note: this catalogue declares the signal families `IAM`, `OBS`. No pass in the current release emits signals with these prefixes, so the affected controls are in practice judged on related signals (for example Terraform, egress or cryptography findings) and on context documents.

## Control structure

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| NIS2-GOV: Governance and Management Body Accountability | 4 | 0 | `NIS2_GOV_1` Management body oversight and accountability for cybersecurity; `NIS2_GOV_2` Management body cybersecurity training |
| NIS2-RSK: Risk Analysis and Security Policies | 6 | 0 | `NIS2_RSK_1` Cybersecurity risk management framework; `NIS2_RSK_2` Cybersecurity risk assessment |
| NIS2-INC: Incident Handling | 6 | 1 | `NIS2_INC_1` Incident detection and classification process; `NIS2_INC_2` Significant incident determination criteria |
| NIS2-BCM: Business Continuity | 5 | 0 | `NIS2_BCM_1` Business continuity plan for network and information systems; `NIS2_BCM_2` Disaster recovery planning and geographic redundancy |
| NIS2-SCM: Supply Chain Security | 5 | 1 | `NIS2_SCM_1` Supply chain security policy; `NIS2_SCM_2` Supplier security assessment and due diligence |
| NIS2-NSC: Network and Information System Security | 5 | 4 | `NIS2_NSC_1` Network security management and segmentation; `NIS2_NSC_2` Endpoint security and patch management |
| NIS2-CRY: Cryptography and Encryption | 3 | 2 | `NIS2_CRY_1` Encryption policy and approved cryptographic algorithms; `NIS2_CRY_2` Encryption of data at rest and in transit |
| NIS2-HRS: Human Resources Security and Access Control | 5 | 3 | `NIS2_HRS_1` Cybersecurity awareness training for management and staff; `NIS2_HRS_2` Personnel security screening |
| NIS2-MFA: Multi-factor Authentication and Secure Communications | 3 | 1 | `NIS2_MFA_1` MFA for critical systems and remote access; `NIS2_MFA_2` Secured voice, video, and text communications |
| NIS2-VHR: Vulnerability Management | 4 | 2 | `NIS2_VHR_1` Vulnerability identification and risk-based assessment; `NIS2_VHR_2` Patch and vulnerability remediation timescales |
| **Total** | **46** | **14** |  |

## Cross-mapping to other frameworks

Per-control mappings in `controls.yaml` (`maps_to`), counted by target framework:

| Target framework | Controls with at least one `maps_to` reference |
|---|---|
| [`ISO_27001`](/frameworks/iso-27001) | 42 |

Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`ISO_27001`](/frameworks/iso-27001), [`DORA`](/frameworks/dora), [`GDPR`](/frameworks/gdpr), [`EU_CRA`](/frameworks/eu-cra), [`KRITIS_DE`](/frameworks/kritis-de), [`BSI_GRUNDSCHUTZ_2023`](/frameworks/bsi-grundschutz-2023), [`EUCS`](/frameworks/eucs).

## How to enable

1. **Discovery.** Copy the folder `nis2` into the workspace at `wsp/inputs/catalogs/community/nis2/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. In the TUI, the framework picker for [application assessments](/assessment/application) lists installed frameworks whose `assessment_type_scope` includes `app`. This framework declares `app` and `aud`, so it appears there; the [landing zone assessment](/assessment/landing-zone) picker lists all installed frameworks.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes NIS2`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [NIS2]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/nis2>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `nis2` into your workspace at `wsp/inputs/catalogs/community/nis2/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info NIS2` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- Obligations differ by member state transposition and by entity class (EE or IE). Confirm the national law and the entity's classification with counsel.
- The 24-hour, 72-hour and one-month reporting duties are process obligations; SWAO can check that procedures are documented, not that they are met in practice.
