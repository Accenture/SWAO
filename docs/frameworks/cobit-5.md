# COBIT 5: Governance and Management of Enterprise IT (COBIT_5)

This page describes the community framework `COBIT_5` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `COBIT_5` |
| Authority / publisher | ISACA (Information Systems Audit and Control Association) |
| Version | 2012 (ISBN 978-1-60420-237-3) |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 0.2.0 |
| Total controls | 37 |
| Scoring mode | `binary` (declared) |
| Assessment types (metadata) | `app`, `aud` |
| Licence and redistribution | The control descriptions, assessor guidance and remediation text are original SWAO wording, not copied or adapted from ISACA material. Process IDs and names are the COBIT 5 identifiers, used as factual references. Reference publication: ISACA, COBIT 5: A Business Framework for the Governance and Management of Enterprise IT (2012, ISBN 978-1-60420-237-3). COBIT is a registered trademark of ISACA. |
| Last reviewed | 2026-10-17 |
| Folder | `cobit-5` |

## What it is

COBIT 5 is ISACA's business framework for the governance and management of enterprise IT (GEIT), published in 2012. It defines five domains with 37 processes and seven enablers that cut across the domains. It is a voluntary good-practice framework, widely used by internal audit and IT governance functions; it is not a law.

The SWAO catalogue models each of the 37 processes as one control, grouped by the five domains (EDM, APO, BAI, DSS, MEA). The seven enablers are not modelled as a separate axis.

## Who should use it in SWAO and when

- Engagements where the client is subject to IT audit obligations, board-level IT governance review or regulatory alignment across several frameworks (catalogue hints: `it_governance`, `enterprise_it_management`, `audit_assurance`, `risk_management`, `service_management`, `regulatory_alignment`).
- As a governance overlay next to a security framework such as ISO_27001 or a regulation such as DORA.

## What SWAO checks

Controls are evaluated in [Pass 11 (compliance evaluation)](/passes/11-comp). The pass reads the `assessment.regimes_active` list from the app's `.swao.yml`, loads the catalogue and sends the controls in batches of 20 to the configured LLM. For each control the LLM receives the ID, title, description and default severity, together with all signals that the earlier passes of the run produced. It returns one of five outcomes per control:

| Outcome | Meaning |
|---|---|
| `SATISFIED` | Signals confirm the control is met. |
| `PARTIAL` | Some elements are present, but gaps remain. |
| `GAP` | Signals show the control is not met. |
| `UNKNOWN` | No signal addresses the control either way. |
| `N_A` | The control does not apply to this workload (with justification). |

Cited signal IDs are checked against the signals that actually exist; invented IDs are dropped. Without a configured LLM provider every control is reported as `UNKNOWN`.

### What evidence the controls expect

Each control declares in its `evidence_basis` field what kind of evidence it relies on. This tells the reviewer what evidence is expected; the outcome itself is decided by the LLM from the signals. For this framework the split is:

| Evidence type | Controls |
|---|---|
| Code and configuration signals only (`signal_prefix`, `local_signal_regex`) | 10 |
| Signals and documents combined | 0 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 27 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 0 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 0 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `OBS` | 5 | evidence area observability, logging and monitoring; no SWAO analysis pass emits signals with this prefix |
| `IAM` | 2 | evidence area identity and access; no SWAO analysis pass emits signals with this prefix |
| `CRYPTO` | 2 | [Pass 08 (CRYPTO)](/passes/08-crypto) |
| `EGR` | 2 | [Pass 07 (EGR)](/passes/07-egr) |
| `QA` | 1 | evidence area quality assurance; no SWAO analysis pass emits signals with this prefix |
| `INV` | 1 | [Pass 01 (INV)](/passes/01-inv) |
| `DR` | 1 | evidence area disaster recovery; no SWAO analysis pass emits signals with this prefix |

### Examples

Controls with code or configuration evidence:

- `APO11` Manage Quality (`QA`)
- `APO13` Manage Security (`IAM`, `CRYPTO`, `OBS`, `EGR`)
- `BAI03` Manage Solutions Identification and Build (`.github/workflows/**/*.{yml,yaml}::(?i)(build|deploy|release)`)

Controls that need documents:

- `EDM01` Ensure Governance Framework Setting and Maintenance
- `EDM02` Ensure Benefits Delivery

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

### Capability rating scale

The framework metadata documents how COBIT 5 process capability levels (ISO/IEC 15504) relate to SWAO outcomes: Level 0 (incomplete) corresponds to GAP, Level 1 (performed) to PARTIAL, Levels 2 to 5 to SATISFIED, and "Not Applicable" to N_A. In the current release this mapping is documentation for the reviewer; the compliance pass does not read it.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| Evaluate Direct and Monitor | 5 | `EDM01` Ensure Governance Framework Setting and Maintenance; `EDM02` Ensure Benefits Delivery |
| Align Plan and Organise | 13 | `APO01` Manage the IT Management Framework; `APO02` Manage Strategy |
| Build Acquire and Implement | 10 | `BAI01` Manage Programmes and Projects; `BAI02` Manage Requirements Definition |
| Deliver Service and Support | 6 | `DSS01` Manage Operations; `DSS02` Manage Service Requests and Incidents |
| Monitor Evaluate and Assess | 3 | `MEA01` Monitor Evaluate and Assess Performance and Conformance; `MEA02` Monitor Evaluate and Assess the System of Internal Control |
| **Total** | **37** | |

Default severities: critical 2, high 9, medium 22, low 4.

## Cross-mapping to other frameworks

26 of 37 controls carry `maps_to` references to controls of other frameworks. The table counts the references per target framework. "Resolved" means the target ID exists as a control in a bundled SWAO catalogue; "unresolved" means the reference points at article or clause level, or uses an ID spelling that no catalogue contains.

| Target framework | Resolved references | Unresolved references |
|---|---|---|
| `SOC_2` | 29 | 0 |
| `ISO_27001` | 21 | 0 |
| `DORA` | 2 | 0 |
| `GDPR` | 1 | 0 |

In the other direction, controls of these frameworks reference COBIT_5 controls: `SAMA_CSF` (16).

In addition, the metadata (`cross_mapping_hints`) names these related frameworks: `ISO_27001`, `SOC_2`, `GDPR`, `DORA`, `ISO_20000`, `ISO_38500`, `ISO_31000`, `ITIL_V3`, `TOGAF`, `PRINCE2`, `CMMI`, `NIST_CSF`. This list indicates thematic overlap; it is not a control-level mapping.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/cobit-5](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/cobit-5)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

COBIT_5 ships with SWAO again. Its control text was rewritten in original SWAO wording, so the catalogue is part of the binaries and the public source once more. Process IDs and names stay the COBIT 5 identifiers; the ISACA publication is cited as the reference.

`swao framework list` shows COBIT_5, and `swao framework install COBIT_5` copies the `cobit-5` folder (with `framework-meta.yaml`, `controls.yaml` and `evidence/`) into the workspace at `wsp/inputs/catalogs/community/cobit-5/`. You can also copy the folder by hand. To customise the framework for one engagement, edit the workspace copy. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Copy the `cobit-5` folder into `wsp/inputs/catalogs/community/cobit-5/` in the workspace, with `swao framework install COBIT_5` or by hand (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [COBIT_5]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [COBIT_5, GDPR]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "COBIT_5"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

## Limitations and notes

- The SWAO catalogue models COBIT 5 (2012). If the client works with a later COBIT edition, check the process mapping manually.
- 27 of the 37 processes depend on governance documents (for example `evidence/edm-01-governance-framework.md`) or manual questionnaires. Expect UNKNOWN for these until the documents are supplied.
- New workspaces are not seeded with COBIT_5. Copy it into the workspace with `swao framework install COBIT_5` (see above).
- SWAO cannot rate process capability levels the way a COBIT assessor does.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are original SWAO descriptions of each process and of the evidence an assessor would look for; they do not reproduce the COBIT 5 publication. ISACA's official material is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
