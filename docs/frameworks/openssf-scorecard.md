# OpenSSF Security Scorecard (OPENSSF_SCORECARD)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `OPENSSF_SCORECARD` |
| Authority / publisher | Open Source Security Foundation (OpenSSF), Linux Foundation |
| Version | v4.13 / v5.0-rc (2024) |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `1.0.0` |
| Total controls | 17 |
| Scoring mode | `weighted` declared in framework-meta.yaml. `controls.yaml` sets no `scoring_mode`, so the catalogue loads with the schema default `binary`; the Scorecard weight of each check is shown in the control title. |
| Assessment scope (framework-meta) | `app`, `aud` |
| Signal prefix | `OSS` |
| Licence and redistribution | OpenSSF Scorecard is an Apache-2.0 project; check names and criteria are reproduced under Apache-2.0 terms. |
| Last reviewed | 2026-09-21 |

## What it is

The OpenSSF Security Scorecard is an automated tool of the Open Source Security Foundation (Linux Foundation) that rates the security practices of open-source projects. Each check (for example Branch-Protection, Code-Review, Pinned-Dependencies or Dangerous-Workflow) scores from 0 to 10 and carries a published weight. Scorecard is not a regulation; it is a widely used measure of software supply chain hygiene and is referenced by CISA guidance on securing the software supply chain and by the NIST SSDF (SP 800-218).

SWAO packages the Scorecard checks as 17 controls in five domains. The title of each control names the Scorecard check and its weight, for example `OSS_VLN_1` No known open CVEs in dependencies (Scorecard: Vulnerabilities, weight 10).

## Who should use it in SWAO and when

Use OPENSSF_SCORECARD when open-source software is part of the risk picture:

- the application depends heavily on open-source packages and the client wants to understand supply chain risk;
- the client maintains an open-source or inner-source project and needs a security posture benchmark;
- supply chain evidence is needed for [NIS2](/frameworks/nis2) supply chain measures or the [EU_CRA](/frameworks/eu-cra) vulnerability-handling requirements.

The framework is region- and sector-neutral. The catalogue notes that SWAO's own public repository should score 8 or higher.

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

SWAO does not run the Scorecard tool or query the public Scorecard API in this framework. The controls are judged on the run's signals and on context documents: 10 controls name the solution architecture and 6 the operations runbooks as context. Six repository-governance controls declare `assessment_type_scope: [aud]`: `OSS_INT_1`, `OSS_INT_2`, `OSS_INT_4`, `OSS_SCH_3`, `OSS_OPS_3` and `OSS_CMH_1`. To use real Scorecard results, export them (for example from the Scorecard CLI or API) and supply them as context documents. One control declares a signal family:

| Control | Title | Declared evidence basis |
|---|---|---|
| `OSS_VLN_1` | No known open CVEs in dependencies (Scorecard: Vulnerabilities, weight 10) | `TF` ([Pass 06](/passes/06-tf)) |

## Control structure

| Domain / pillar | Controls | Declared automated evidence | Example controls |
|---|---|---|---|
| OSS-INT: Code and Repository Integrity | 5 | 0 | `OSS_INT_1` Branch protection on default branch (Scorecard: Branch-Protection, weight 3); `OSS_INT_2` Code review required for all changes (Scorecard: Code-Review, weight 3); `OSS_INT_3` Signed releases (Scorecard: Signed-Releases, weight 4); `OSS_INT_4` No binary artefacts committed to repository (Scorecard: Binary-Artifacts, weight 5); `OSS_INT_5` Pinned dependencies by cryptographic hash (Scorecard: Pinned-Dependencies, weight 7) |
| OSS-VLN: Vulnerability Management | 3 | 1 | `OSS_VLN_1` No known open CVEs in dependencies (Scorecard: Vulnerabilities, weight 10); `OSS_VLN_2` Automated dependency update tool active (Scorecard: Dependency-Update-Tool, weight 10); `OSS_VLN_3` Static analysis (SAST) running in CI (Scorecard: SAST, weight 3) |
| OSS-SCH: Supply Chain Security | 4 | 0 | `OSS_SCH_1` GitHub Actions tokens use least privilege (Scorecard: Token-Permissions, weight 4); `OSS_SCH_2` No dangerous workflows with script injection risk (Scorecard: Dangerous-Workflow, weight 10); `OSS_SCH_3` Published to package registry from CI only (Scorecard: Packaging, weight 4); `OSS_SCH_4` Webhook secrets configured (Scorecard: Webhooks, weight 4) |
| OSS-OPS: Operational Security | 3 | 0 | `OSS_OPS_1` Security policy published in repository (Scorecard: Security-Policy, weight 1); `OSS_OPS_2` Project actively maintained (Scorecard: Maintained, weight 1); `OSS_OPS_3` CII Best Practices badge (Scorecard: CII-Best-Practices, weight 1) |
| OSS-CMH: Community Health | 2 | 0 | `OSS_CMH_1` Open source license file present (Scorecard: License, weight 3); `OSS_CMH_2` Diverse contributor base (Scorecard: Contributors, weight 1) |
| **Total** | **17** | **1** |  |

## Cross-mapping to other frameworks

Per-control mappings in `controls.yaml` (`maps_to`), counted by target framework:

| Target framework | Controls with at least one `maps_to` reference |
|---|---|
| [`EU_CRA`](/frameworks/eu-cra) | 10 |
| [`ISO_27001`](/frameworks/iso-27001) | 6 |
| [`NIS2`](/frameworks/nis2) | 6 |

Declared cross-mapping hints in `framework-meta.yaml` (framework level, not per control): [`EU_CRA`](/frameworks/eu-cra), [`NIS2`](/frameworks/nis2), [`ISO_27001`](/frameworks/iso-27001), [`GDPR`](/frameworks/gdpr).

## How to enable

1. **Discovery.** Copy the folder `openssf-scorecard` into the workspace at `wsp/inputs/catalogs/community/openssf-scorecard/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. In the TUI, the framework picker for [application assessments](/assessment/application) lists installed frameworks whose `assessment_type_scope` includes `app`. This framework declares `app` and `aud`, so it appears there; the [landing zone assessment](/assessment/landing-zone) picker lists all installed frameworks.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes OPENSSF_SCORECARD`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [OPENSSF_SCORECARD]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/openssf-scorecard>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `openssf-scorecard` into your workspace at `wsp/inputs/catalogs/community/openssf-scorecard/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info OPENSSF_SCORECARD` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- Scorecard measures practices visible in a source repository and its CI configuration. It says little about runtime security or the security of the deployed workload.
- Results for private repositories require running the Scorecard tool with appropriate access; SWAO does not do this for you.
