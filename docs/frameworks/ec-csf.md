# EC Cloud Sovereignty Framework v1.2.1 (EC_CSF)

This page describes the community framework `EC_CSF` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `EC_CSF` |
| Authority / publisher | European Commission, Directorate-General for Informatics (DIGIT) |
| Version | 1.2.1 |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 1.0.0 |
| Total controls | 34 |
| Scoring mode | `binary` (declared) |
| Assessment types (metadata) | `lz`, `aud` |
| Licence and redistribution | Published by the European Commission under its reuse policy for EU institutional publications. Control descriptions paraphrase the sovereignty objectives and are neither legal advice nor procurement guidance. |
| Last reviewed | 2026-09-22 |
| Folder | `ec-csf` |

## What it is

The EC Cloud Sovereignty Framework (CSF) v1.2.1 is a European Commission framework for assessing the sovereignty of cloud services used by EU institutions. According to the catalogue metadata it was published in October 2025, defines eight Sovereignty Objectives (SOV-1 to SOV-8) and scores them on a five-level maturity scale from SEAL-0 to SEAL-4 (Sovereignty Effectiveness Assurance Level), and was used in an EU institutional cloud procurement awarded in April 2026. It is a procurement and assessment framework, not a regulation.

The SWAO catalogue contains 34 controls across the eight SOV domains. It is described as a companion to SECNUMCLOUD.

## Who should use it in SWAO and when

- Cloud providers and integrators bidding for EU institutional or public-sector procurement (catalogue hints: `sovereign_cloud`, `eu_institutional`, `cloud_service_provider`, `eu_procurement`, `digital_sovereignty`).
- Sovereignty programmes that need to compare landing zones on strategic, legal, data, operational, supply-chain, technology, security and environmental criteria.
- The framework metadata declares the assessment types `lz` and `aud`; it is aimed at landing zones and providers rather than individual application code.

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
| Code and configuration signals only (`signal_prefix`, `local_signal_regex`) | 1 |
| Signals and documents combined | 1 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 32 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 22 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 0 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `ENCRYPT_AT_REST` | 2 | evidence area encryption at rest; no SWAO analysis pass emits signals with this prefix |
| `ENCRYPT_IN_TRANSIT` | 1 | evidence area encryption in transit; no SWAO analysis pass emits signals with this prefix |

### Examples

Controls with code or configuration evidence:

- `ECCSF_SOV3_02` Encryption with customer-controlled keys (`ENCRYPT_AT_REST`)
- `ECCSF_SOV7_05` Encryption sovereignty: ANSSI or equivalent approved algorithms (`ENCRYPT_AT_REST`, `ENCRYPT_IN_TRANSIT`)

Controls that need documents:

- `ECCSF_SOV1_01` Cloud strategy and vendor independence policy
- `ECCSF_SOV1_02` Provider concentration limit

Examples of audit-only controls: `ECCSF_SOV1_03`, `ECCSF_SOV1_04`, `ECCSF_SOV2_01`.

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

### Where EC_CSF is evaluated

Because the framework scope is `lz` and `aud`, the regime picker of the application assessment does not offer EC_CSF (it lists only frameworks whose scope includes `app`). The [landing-zone assessment](/assessment/landing-zone) reads only the `sovereignty_requirements` block of a selected framework, and EC_CSF declares none. If you add `EC_CSF` to an app's `assessment.regimes_active` by hand, Pass 11 would evaluate its 34 controls like any other listed framework once the catalogue loads; in the current release it does not load (see Limitations and notes). Expect most results to depend on documents.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| SOV-1: Strategic Sovereignty | 4 | `ECCSF_SOV1_01` Cloud strategy and vendor independence policy; `ECCSF_SOV1_02` Provider concentration limit |
| SOV-2: Legal Sovereignty | 4 | `ECCSF_SOV2_01` EU legal jurisdiction for data processing; `ECCSF_SOV2_02` Extraterritorial law immunity assessment |
| SOV-3: Data Sovereignty | 5 | `ECCSF_SOV3_01` EU data residency enforcement; `ECCSF_SOV3_02` Encryption with customer-controlled keys |
| SOV-4: Operational Sovereignty | 4 | `ECCSF_SOV4_01` EU-based operational support staff; `ECCSF_SOV4_02` Operational continuity without parent company dependency |
| SOV-5: Supply Chain Sovereignty | 4 | `ECCSF_SOV5_01` Supply chain risk assessment; `ECCSF_SOV5_02` Software bill of materials and dependency transparency |
| SOV-6: Technology Sovereignty | 4 | `ECCSF_SOV6_01` Open standards adoption for critical interfaces; `ECCSF_SOV6_02` Proprietary lock-in avoidance assessment |
| SOV-7: Security Sovereignty | 5 | `ECCSF_SOV7_01` Security certification and continuous assurance; `ECCSF_SOV7_02` Penetration testing by EU-based assessors |
| SOV-8: Environmental Sovereignty | 4 | `ECCSF_SOV8_01` Energy efficiency target and PUE reporting; `ECCSF_SOV8_02` Renewable energy commitment |
| **Total** | **34** | |

Default severities: high 21, medium 13.

## Cross-mapping to other frameworks

27 of 34 controls carry `maps_to` references to controls of other frameworks. The table counts the references per target framework. "Resolved" means the target ID exists as a control in a bundled SWAO catalogue; "unresolved" means the reference points at article or clause level, or uses an ID spelling that no catalogue contains.

| Target framework | Resolved references | Unresolved references |
|---|---|---|
| `SECNUMCLOUD` | 27 | 0 |
| `GDPR` | 8 | 0 |
| `NIS2` | 3 | 0 |
| `ISO_27001` | 1 | 0 |

In addition, the metadata (`cross_mapping_hints`) names these related frameworks: `SECNUMCLOUD`, `EUCS`, `ISO_27001`, `GDPR`, `NIS2`. This list indicates thematic overlap; it is not a control-level mapping.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/community-frameworks/ec-csf](https://github.com/Accenture/SWAO/tree/main/community-frameworks/ec-csf)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

To customise the framework for one engagement, copy the `ec-csf` folder (with `framework-meta.yaml` and `controls.yaml`) into the workspace at `wsp/inputs/catalogs/community/ec-csf/` and edit the copy there. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Make sure the `ec-csf` folder is present under `wsp/inputs/catalogs/community/` in the workspace (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [EC_CSF]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [EC_CSF, GDPR]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "EC_CSF"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

Note: in the current release the EC_CSF catalogue does not load (see Limitations and notes); these steps apply once the catalogue is corrected.

## Limitations and notes

- SWAO does not compute SEAL levels. Outcomes are SATISFIED, PARTIAL, GAP, UNKNOWN or N_A per control.
- 22 of the 34 controls are marked `aud` (for example legal jurisdiction, extraterritorial law immunity, renewable energy commitment); these need provider documentation or an accredited assessor.
- Two controls (`ECCSF_SOV3_02`, `ECCSF_SOV7_05`) use an evidence key `signal:` that the SWAO catalogue schema does not accept. In the current release the catalogue therefore fails schema validation when it is loaded, and Pass 11 reports that no catalogue was found. Treat EC_CSF results as unavailable until the catalogue is corrected.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The publisher's official source is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
