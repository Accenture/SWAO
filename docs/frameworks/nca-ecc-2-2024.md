# NCA Essential Cybersecurity Controls ECC-2:2024 (NCA_ECC)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `NCA_ECC` |
| Authority / publisher | National Cybersecurity Authority (NCA), Kingdom of Saudi Arabia |
| Version | ECC-2:2024 (issued 2024) |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `1.0.0` |
| Total controls | 28 |
| Scoring mode | `binary` (schema default; not declared) |
| Assessment scope (framework-meta) | `app`, `aud` |
| Signal prefix | `NCA_ECC` |
| Licence and redistribution | Issued by the NCA, classified TLP:White / public. Descriptions paraphrase the subdomain text; the Arabic version is binding. No legal advice. |
| Last reviewed | 2026-07-18 |

## What it is

The Essential Cybersecurity Controls (ECC-2:2024) are the minimum mandatory cybersecurity baseline of the National Cybersecurity Authority (NCA) of the Kingdom of Saudi Arabia. They apply to entities under NCA oversight, including government agencies and critical-sector organisations, and form the base on which sector- and topic-specific NCA controls build, such as the cloud controls [NCA_CCC_CST](/frameworks/nca-ccc-2-2024-cst) and [NCA_CCC_CSP](/frameworks/nca-ccc-2-2024-csp).

ECC-2:2024 has four main domains: Cybersecurity Governance (10 subdomains), Cybersecurity Defense (15), Cybersecurity Resilience (1) and Third-Party and Cloud Computing Cybersecurity (2). The SWAO catalogue models one control per subdomain, 28 in total (`framework-meta.yaml` description).

## Who should use it in SWAO and when

Use NCA_ECC for any workload of an organisation under NCA oversight: government systems, critical infrastructure, financial services and cloud workloads (applicability hints in the catalogue). It is the natural first framework for Saudi engagements and is usually combined with [NCA_CCC_CST](/frameworks/nca-ccc-2-2024-cst) for cloud workloads and [SAMA_CSF](/frameworks/sama-csf-v1) for SAMA-regulated financial institutions.

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

24 of the 28 controls rely on consultant-supplied evidence files, for example `evidence/gov-01-cybersecurity-strategy.md` for `NCA_ECC_GOV_01` Cybersecurity Strategy. Four Defense controls declare an automated signal family:

| Control | Title | Declared evidence basis |
|---|---|---|
| `NCA_ECC_DEF_02` | Identity and Access Management | `IAM` |
| `NCA_ECC_DEF_08` | Cryptography | `CRYPTO` ([Pass 08](/passes/08-crypto)) |
| `NCA_ECC_DEF_09` | Backup and Recovery Management | `INFRA` |
| `NCA_ECC_DEF_12` | Cybersecurity Event Logs and Monitoring Management | `OBS` |

Note: this catalogue declares the signal families `IAM`, `INFRA`, `OBS`. No pass in the current release emits signals with these prefixes, so the affected controls are in practice judged on related signals (for example Terraform, egress or cryptography findings) and on context documents.

## Control structure

Each control carries tags on the axes `domain`, `applies-to`, `mechanism` and `evidence`.

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| Cybersecurity Governance | 10 | 0 | `NCA_ECC_GOV_01` Cybersecurity Strategy; `NCA_ECC_GOV_02` Cybersecurity Management |
| Cybersecurity Defense | 15 | 4 | `NCA_ECC_DEF_01` Asset Management; `NCA_ECC_DEF_02` Identity and Access Management |
| Cybersecurity Resilience | 1 | 0 | `NCA_ECC_RES_01` Cybersecurity Resilience Aspects of Business Continuity Management (BCM) |
| Third-Party and Cloud Computing Cybersecurity | 2 | 0 | `NCA_ECC_TPC_01` Third-Party Cybersecurity; `NCA_ECC_TPC_02` Cloud Computing and Hosting Cybersecurity |
| **Total** | **28** | **4** |  |

## Cross-mapping to other frameworks

Per-control mappings in `controls.yaml` (`maps_to`), counted by target framework:

| Target framework | Controls with at least one `maps_to` reference |
|---|---|
| `NIST_CSF` | 28 |
| [`ISO_27001`](/frameworks/iso-27001) | 28 |

Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`ISO_27001`](/frameworks/iso-27001), `NIST_CSF`, [`SAMA_CSF`](/frameworks/sama-csf-v1), [`NCA_CCC_CSP`](/frameworks/nca-ccc-2-2024-csp), [`NCA_CCC_CST`](/frameworks/nca-ccc-2-2024-cst).

## Demo variant

| Property | Value |
|---|---|
| Framework ID | `NCA_ECC_DEMO` |
| Folder | `nca-ecc-demo` |
| Controls | 20 (Governance 5, Defense 12, Resilience 1, Third-Party and Cloud 2) |
| Assessment scope | `app` |
| Control IDs | `NCA_ECC_DEMO.GOV_01` and similar |

The demo variant is a live-presentation and first-run subset. Its selection prioritises controls with automated signal evidence and controls that cross-map to the other demo frameworks (`GDPR_DEMO`, `BSI_GRUNDSCHUTZ_2023_DEMO`, `NIST_SP_800_66R2_DEMO`, `AI_10_PILLARS_DEMO`). It is not seeded by `swao init`; copy it into the workspace like any other framework. Use the full `NCA_ECC` for client deliverables.

## How to enable

1. **Discovery.** Copy the folder `nca-ecc-2-2024` into the workspace at `wsp/inputs/catalogs/community/nca-ecc-2-2024/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. In the TUI, the framework picker for [application assessments](/assessment/application) lists installed frameworks whose `assessment_type_scope` includes `app`. This framework declares `app` and `aud`, so it appears there; the [landing zone assessment](/assessment/landing-zone) picker lists all installed frameworks.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes NCA_ECC`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [NCA_ECC]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/nca-ecc-2-2024>
- Demo variant `NCA_ECC_DEMO`: <https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/nca-ecc-demo>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `nca-ecc-2-2024` into your workspace at `wsp/inputs/catalogs/community/nca-ecc-2-2024/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info NCA_ECC` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- One control per subdomain is a modelling simplification. The official ECC text contains several numbered requirements per subdomain; consult it for audit preparation.
- The Arabic version is binding for interpretation.
