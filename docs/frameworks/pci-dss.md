# Payment Card Industry Data Security Standard v4.0 (PCI_DSS)

## At a glance

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `PCI_DSS` |
| Authority / publisher | PCI Security Standards Council (PCI SSC) |
| Version | 4.0 |
| Status | Not declared in the catalogue metadata |
| SWAO catalogue version | `0.1.0` (`regime_meta` in controls.yaml states `1.0.0`) |
| Total controls | 5 |
| Scoring mode | `binary` (declared in framework-meta.yaml) |
| Assessment scope (framework-meta) | `app`, `aud` |
| Signal prefix | - |
| Licence and redistribution | No redistribution note is declared. The standard is published by the PCI Security Standards Council in its document library. |
| Last reviewed | 2026-05-24 |

## What it is

PCI DSS is the global security standard of the PCI Security Standards Council, founded by the major payment card brands. It applies to every entity that stores, processes or transmits cardholder data or sensitive authentication data. It is not law; it is enforced contractually through acquirers and card brands. Version 4.0 became effective on 31 March 2024, with full enforcement from 31 March 2025 (`framework-meta.yaml` description), and introduced the customised approach as an alternative to the defined approach.

The SWAO catalogue is a thin packaging at proof-of-concept depth: it contains five controls for Requirements 3.4, 4.1, 6.2, 8.3 and 10, which cover the code- and infrastructure-relevant core of the standard. It is not a complete representation of the twelve PCI DSS requirements.

## Who should use it in SWAO and when

Use PCI_DSS as a quick technical screen for applications in or near a cardholder data environment (CDE): e-commerce checkouts, payment back ends, card-on-file services, and platforms being migrated to a sovereign cloud with payment data in scope. Combine it with [ISO_27001](/frameworks/iso-27001) or [SOC_2](/frameworks/soc-2) for broader control coverage. For a formal Report on Compliance or Self-Assessment Questionnaire, work with a Qualified Security Assessor and the full standard.

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

All five controls declare signal evidence. Cryptography findings ([Pass 08](/passes/08-crypto)) and data classification ([Pass 03](/passes/03-data)) inform `PCI_DSS_3.4` (render PAN unreadable), cryptography and Terraform findings inform `PCI_DSS_4.1` (strong cryptography in transit), and SBOM findings ([Pass 05](/passes/05-sbom)) inform `PCI_DSS_6.2` (secure software development). The full mapping is in the table under Control structure.

## Control structure

The five controls carry no pillar; they are listed by PCI DSS requirement.

| Requirement | Control | Title | Default severity | Declared evidence basis |
|---|---|---|---|---|
| 3.4 | `PCI_DSS_3.4` | Render PAN unreadable wherever it is stored | critical | `CRYPTO` ([Pass 08](/passes/08-crypto)), `DATA` ([Pass 03](/passes/03-data)) |
| 4.1 | `PCI_DSS_4.1` | Strong cryptography for transmission of cardholder data | high | `CRYPTO` ([Pass 08](/passes/08-crypto)), `TF` ([Pass 06](/passes/06-tf)) |
| 6.2 | `PCI_DSS_6.2` | Secure software development | medium | `PP`, `QA`, `SBOM` ([Pass 05](/passes/05-sbom)) |
| 8.3-8.5 | `PCI_DSS_8.3` | Multi-factor authentication for non-console access | high | `IAM`, context `solution_arch` |
| 10 | `PCI_DSS_10` | Log and monitor all access to system components and cardholder data | high | `OBS`, context `ops_runbooks` |

## How to enable

1. **Discovery.** Copy the folder `pci-dss` into the workspace at `wsp/inputs/catalogs/community/pci-dss/` (see the next section). Any framework folder there is discovered automatically; no registration is needed. The TUI framework selection (Run Assessment, then the application's framework step) offers it, and the compliance pass resolves catalogues from this workspace folder. In the TUI, the framework picker for [application assessments](/assessment/application) lists installed frameworks whose `assessment_type_scope` includes `app`. This framework declares `app` and `aud`, so it appears there; the [landing zone assessment](/assessment/landing-zone) picker lists all installed frameworks.
2. **Selection.** The chosen frameworks are stored per application in `apps/<app-id>/.swao.yml` as `assessment.regimes_active`, and the compliance pass evaluates exactly that list. The TUI writes the entry for you; on the command line use `swao regime-select --app <app-id> --regimes PCI_DSS`. As a manual alternative, edit the application's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [PCI_DSS]
   ```

   Several frameworks can be combined in one list. To assess several applications against the same framework, add the ID to each of them.
3. **Workspace level.** A `regimes_active` list in the workspace `.swao.yml` applies to every application that has no list of its own. A list in the app always takes precedence.
4. **Check.** Run [`swao health-check`](/health-check): it reports IDs in `regimes_active` that have no installed catalogue.

## Get or customise this framework

The framework source (`framework-meta.yaml`, `controls.yaml` and any supporting files) is public. You can view it on GitHub and copy and paste it:

- Framework source: <https://github.com/Accenture/SWAO/tree/main/community-frameworks/pci-dss>
- Overview of all community frameworks: <https://github.com/Accenture/SWAO/tree/main/community-frameworks>

To customise the framework for one engagement, copy the folder `pci-dss` into your workspace at `wsp/inputs/catalogs/community/pci-dss/` and edit the copy there, for example to adjust severities or to add engagement-specific controls. This workspace folder is what SWAO reads; the original bundled with SWAO stays unchanged. Place the copy directly under `community/`, because folders whose name starts with a dot are skipped. Keep `regime_meta.id` unique: if two workspace folders declare the same ID, only one of them is loaded. `swao framework info PCI_DSS` prints the bundled metadata.

## Limitations and notes

- SWAO produces an evidence-based pre-assessment. It is not a certification, an audit opinion or legal advice. Review every `SATISFIED` and `GAP` outcome before relying on it, and involve qualified auditors or counsel for formal compliance statements.
- Outcomes depend on the evidence available to the run (code, configuration, infrastructure-as-code, ingested documents) and on LLM judgement. Where no signal addresses a control, the LLM is instructed to return `UNKNOWN`, not `GAP`.
- Organisational, physical and contractual controls cannot be proven from code. They need documents supplied by the client.
- Five controls cannot establish PCI DSS compliance. Scoping of the CDE, segmentation testing, physical security (Requirement 9), anti-malware (Requirement 5), security testing (Requirement 11) and the policy programme (Requirement 12) are not covered.
- `framework-meta.yaml` states catalogue version `0.1.0`, while `regime_meta` in `controls.yaml` states `1.0.0`.
