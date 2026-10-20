# HIPAA Security Rule, Implementation Guidance NIST SP 800-66 Revision 2 (NIST_SP_800_66R2)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `NIST_SP_800_66R2` |
| Authority / publisher | U.S. Department of Health and Human Services (45 CFR Part 164 Subpart C, Security Rule); implementation guidance by NIST (SP 800-66 Revision 2, February 2024) |
| Version | NIST SP 800-66r2 / 2024-02 |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `0.1.0` |
| Total controls | 49 |
| Scoring mode | `binary` (declared). The catalogue also maps the native HIPAA rating to SWAO outcomes, see below. |
| Assessment scope (framework-meta) | `app`, `aud` |
| Signal prefix | `HIPAA` |
| Licence and redistribution | NIST SP 800-66r2 is a U.S. Government work not subject to copyright in the United States (17 USC 105); the Security Rule is federal regulation. Titles are verbatim, descriptions paraphrased. |
| Last reviewed | 2026-05-23 |

## What it is

The HIPAA Security Rule (45 CFR Part 164 Subpart C) is U.S. federal regulation under the Health Insurance Portability and Accountability Act. It requires covered entities (health plans, healthcare clearinghouses and most healthcare providers) and their business associates to protect electronic protected health information (ePHI) with administrative, physical and technical safeguards. NIST SP 800-66 Revision 2 (February 2024) is NIST's resource guide for implementing the rule; it is guidance, not regulation.

The rule is organised into sections, standards and implementation specifications. Specifications are either Required (R) or Addressable (A): an addressable specification may be met by an equivalent alternative measure if the entity documents why. SWAO models each implementation specification as one control and groups the controls by the five sections 164.308, 164.310, 164.312, 164.314 and 164.316. This framework supersedes the earlier three-control HIPAA stub (`replaces: HIPAA`).

## Who should use it in SWAO and when

Use NIST_SP_800_66R2 for any workload that stores, processes or transmits ePHI for the U.S. market: electronic health record systems, health data analytics, telehealth, claims processing and the cloud platforms that host them. It applies to covered entities and to business associates such as SaaS and hosting providers. It pairs naturally with [SOC_2](/frameworks/soc-2) for U.S. B2B buyers and with [GDPR](/frameworks/gdpr) when the same health platform also serves the EU.

The framework declares a sovereignty requirement (`require_certifications: [HIPAA]`), which the landing zone assessment can use when it compares target platforms.

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

The catalogue maps the native HIPAA posture onto SWAO outcomes (`rating_scale` in `framework-meta.yaml`):

| HIPAA posture | SWAO outcome | Severity floor |
|---|---|---|
| Fully implemented (R) / implemented or alternative measure (A) | `SATISFIED` | |
| Partially implemented | `PARTIAL` | |
| Not implemented, no alternative measure documented (A) | `GAP` | high |
| Not implemented (R) | `GAP` | critical |
| Not applicable | `N_A` | |

Technical safeguards are where code and configuration evidence helps most: 7 of the 9 technical controls declare a signal family and one (`HIPAA-TEC-03`) a local regular expression. Administrative, physical and documentation controls rely on documents. Ten controls declare a manual questionnaire, for example `HIPAA-ADM-07` Workforce Clearance Procedure, and the framework folder ships eight evidence templates under `evidence/` (four Markdown templates and four questionnaires). 16 controls declare automated evidence:

| Control | Title | Declared evidence basis |
|---|---|---|
| `HIPAA-ADM-04` | Information System Activity Review (Required), 164.308(a)(1)(ii)(D) | `OBS` |
| `HIPAA-ADM-10` | Access Authorisation (Addressable), 164.308(a)(4)(ii)(B) | `IAM` |
| `HIPAA-ADM-11` | Access Establishment and Modification (Addressable), 164.308(a)(4)(ii)(C) | `IAM` |
| `HIPAA-ADM-14` | Log-in Monitoring (Addressable), 164.308(a)(5)(ii)(C) | `OBS` |
| `HIPAA-ADM-15` | Password Management (Addressable), 164.308(a)(5)(ii)(D) | `IAM` |
| `HIPAA-ADM-17` | Data Backup Plan (Required), 164.308(a)(7)(ii)(A) | `DR` |
| `HIPAA-ADM-18` | Disaster Recovery Plan (Required), 164.308(a)(7)(ii)(B) | `DR` |
| `HIPAA-PHY-10` | Data Backup and Storage (Addressable), 164.310(d)(2)(iv) | `DR` |
| `HIPAA-TEC-01` | Unique User Identification (Required), 164.312(a)(2)(i) | `IAM` |
| `HIPAA-TEC-03` | Automatic Logoff (Addressable), 164.312(a)(2)(iii) | local_signal_regex |
| `HIPAA-TEC-04` | Encryption and Decryption at Rest (Addressable), 164.312(a)(2)(iv) | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `HIPAA-TEC-05` | Audit Controls (Required), 164.312(b) | `OBS` |
| `HIPAA-TEC-06` | Integrity Mechanism for ePHI (Addressable), 164.312(c)(2) | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `HIPAA-TEC-07` | Person or Entity Authentication (Required), 164.312(d) | `IAM` |
| `HIPAA-TEC-08` | Integrity Controls in Transit (Addressable), 164.312(e)(2)(i) | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `HIPAA-TEC-09` | Encryption in Transit (Addressable), 164.312(e)(2)(ii) | `CRYPTO` ([Pass 08](/passes/08-crypto)) |

Note: this catalogue declares the signal families `DR`, `IAM`, `OBS`. No pass in the current release emits signals with these prefixes, so the affected controls are in practice judged on related signals (for example Terraform, egress or cryptography findings) and on context documents.

## Control structure

Each control is tagged on the axes `section`, `family`, `requirement` and `applies-to`. By `requirement` tag, 22 controls are Required, 22 Addressable and 5 are standard-level controls without a separate implementation specification (`HIPAA-ADM-05`, `HIPAA-ADM-22`, `HIPAA-PHY-05`, `HIPAA-PHY-06`, `HIPAA-PND-01`).

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| Administrative Safeguards | 23 | 7 | `HIPAA-ADM-01` Risk Analysis (Required), 164.308(a)(1)(ii)(A); `HIPAA-ADM-02` Risk Management (Required), 164.308(a)(1)(ii)(B) |
| Physical Safeguards | 10 | 1 | `HIPAA-PHY-01` Contingency Operations (Addressable), 164.310(a)(2)(i); `HIPAA-PHY-02` Facility Security Plan (Addressable), 164.310(a)(2)(ii) |
| Technical Safeguards | 9 | 8 | `HIPAA-TEC-01` Unique User Identification (Required), 164.312(a)(2)(i); `HIPAA-TEC-02` Emergency Access Procedure (Required), 164.312(a)(2)(ii) |
| Organisational Requirements | 3 | 0 | `HIPAA-ORG-01` Business Associate Contracts (Required), 164.314(a)(2)(i); `HIPAA-ORG-02` Other Arrangements (Required), 164.314(a)(2)(ii) |
| Policies and Procedures and Documentation | 4 | 0 | `HIPAA-PND-01` Policies and Procedures: 164.316(a); `HIPAA-PND-02` Documentation Time Limit (Required), 164.316(b)(2)(i) |
| **Total** | **49** | **16** |  |

## Cross-mapping to other frameworks

Per-control mappings in `controls.yaml` (`maps_to`), counted by target framework:

| Target framework | Controls with at least one `maps_to` reference |
|---|---|
| [`ISO_27001`](/frameworks/iso-27001) | 43 |
| [`SOC_2`](/frameworks/soc-2) | 29 |

Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`ISO_27001`](/frameworks/iso-27001), [`SOC_2`](/frameworks/soc-2), [`COBIT_5`](/frameworks/cobit-5), [`GDPR`](/frameworks/gdpr), [`DORA`](/frameworks/dora), `NIST_CSF_2`, `NIST_800_53R5`, `HITRUST_CSF`, [`PCI_DSS`](/frameworks/pci-dss), `ISO_27799`.

## Demo variant

Two demo-sized subsets exist. They contain the same 12 controls with the same IDs (`HIPAA_DEMO.ADM_01` and similar): six administrative safeguards, five technical safeguards and one organisational requirement, selected for cross-regime coverage with `GDPR_DEMO`, `AI_10_PILLARS_DEMO` and `BSI_GRUNDSCHUTZ_2023_DEMO`.

| Framework ID | Folder | Controls | Notes |
|---|---|---|---|
| `NIST_SP_800_66R2_DEMO` | `nist-sp-800-66r2-demo` | 12 | Seeded into every new workspace by `swao init` and shown by `swao framework list`. |
| `NIST_HIPAA_DEMO` | `nist-hipaa-demo` | 12 | Same content under a different ID; its `framework-meta.yaml` sets `listed: false`, so `swao framework list` does not show it, and it is not seeded. |

Enable only one of the two in an application, because they evaluate the same controls. Use the full `NIST_SP_800_66R2` for client deliverables.

## How to enable

1. **Discovery.** Copy the folder `nist-sp-800-66r2-hipaa` into the workspace at `wsp/inputs/catalogs/community/nist-sp-800-66r2-hipaa/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. In the TUI, the framework picker for [application assessments](/assessment/application) lists installed frameworks whose `assessment_type_scope` includes `app`. This framework declares `app` and `aud`, so it appears there; the [landing zone assessment](/assessment/landing-zone) picker lists all installed frameworks.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes NIST_SP_800_66R2`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [NIST_SP_800_66R2]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/nist-sp-800-66r2-hipaa>
- Demo variant `NIST_SP_800_66R2_DEMO`: <https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/nist-sp-800-66r2-demo>
- Demo variant `NIST_HIPAA_DEMO`: <https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/nist-hipaa-demo>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `nist-sp-800-66r2-hipaa` into your workspace at `wsp/inputs/catalogs/community/nist-sp-800-66r2-hipaa/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info NIST_SP_800_66R2` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- `HIPAA-TEC-03` Automatic Logoff declares a local regular expression over source and configuration files (session or idle timeout settings). The compliance pass does not run this expression itself; the control is judged like all others on the run's signals.
- Business associate agreements, workforce sanctions and facility controls need documents from the client.
- A HIPAA compliance determination is made by the covered entity and, in enforcement, by the HHS Office for Civil Rights; SWAO results are preparatory.
