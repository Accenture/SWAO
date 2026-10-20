# EU Cyber Resilience Act (EU_CRA)

This page describes the community framework `EU_CRA` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `EU_CRA` |
| Authority / publisher | European Union (Regulation (EU) 2024/2847) |
| Version | 2024-12-11 |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 1.0.0 |
| Total controls | 35 |
| Scoring mode | `binary` (declared) |
| Assessment types (metadata) | `app`, `aud` |
| Licence and redistribution | The CRA is an EU legislative act, reusable under the EUR-Lex terms. The framework represents the manufacturer perspective; cloud-hosted SaaS is excluded from CRA scope. Consult legal counsel for product classification. |
| Last reviewed | 2026-09-21 |
| Folder | `eu-cra` |

## What it is

The Cyber Resilience Act (Regulation (EU) 2024/2847) sets cybersecurity requirements for "products with digital elements" (hardware and software products with network connectivity) placed on the EU market. According to the catalogue it entered into force on 10 December 2024; most requirements apply from 11 December 2027, and the reporting obligations of Article 14 apply from September 2026. Excluded are, among others, SaaS, medical devices, aviation, automotive and national-security products. The CRA requires a machine-readable software bill of materials (SBOM) and notification of actively exploited vulnerabilities to ENISA within 24 hours.

The SWAO catalogue contains 35 controls in six domains.

## Who should use it in SWAO and when

- Software and hardware vendors, IoT and connected-device manufacturers selling in the EU (catalogue hints: `product_vendor`, `iot_product`, `software_product`, `hardware_vendor`, `connected_device`, `eu_market`).
- Assessments of a product codebase before market placement, especially for SBOM and vulnerability-handling readiness.
- Not for pure SaaS workloads, which the CRA excludes.

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
| Code and configuration signals only (`signal_prefix`, `local_signal_regex`) | 5 |
| Signals and documents combined | 2 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 28 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 13 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 0 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `SBOM` | 4 | [Pass 05 (SBOM)](/passes/05-sbom) |
| `IAM` | 1 | evidence area identity and access; no SWAO analysis pass emits signals with this prefix |
| `CRYPTO` | 1 | [Pass 08 (CRYPTO)](/passes/08-crypto) |
| `OBS` | 1 | evidence area observability, logging and monitoring; no SWAO analysis pass emits signals with this prefix |

### Examples

Controls with code or configuration evidence:

- `EU_CRA_SBD_3` Authentication and access protection mechanisms (`IAM`)
- `EU_CRA_SBD_4` Confidentiality protection and data encryption (`CRYPTO`)
- `EU_CRA_SBD_10` Security event logging and monitoring capability (`OBS`)

Controls that need documents:

- `EU_CRA_SBD_1` No known exploitable vulnerabilities at market placement
- `EU_CRA_SBD_2` Secure by default configuration

Examples of audit-only controls: `EU_CRA_SBD_12`, `EU_CRA_VHR_5`, `EU_CRA_VHR_6`.

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| CRA-SBD: Security by Design (Annex I Part I) | 12 | `EU_CRA_SBD_1` No known exploitable vulnerabilities at market placement; `EU_CRA_SBD_2` Secure by default configuration |
| CRA-VHR: Vulnerability Handling (Annex I Part II) | 8 | `EU_CRA_VHR_1` Vulnerability identification and tracking process; `EU_CRA_VHR_2` Coordinated vulnerability disclosure (CVD) policy |
| CRA-CLS: Critical Product Classification (Annex II) | 5 | `EU_CRA_CLS_1` Product classification determination (default, Class I, Class II); `EU_CRA_CLS_2` Class I conformity assessment via harmonised standard or self-assessment |
| CRA-CAF: Conformity Assessment and CE Marking | 4 | `EU_CRA_CAF_1` EU Declaration of Conformity (DoC); `EU_CRA_CAF_2` CE marking with cybersecurity conformity |
| CRA-MSV: Market Surveillance and Incident Reporting | 3 | `EU_CRA_MSV_1` 24-hour ENISA notification for actively exploited vulnerabilities (cross-reference); `EU_CRA_MSV_2` Market surveillance authority cooperation |
| CRA-SBM: Software Bill of Materials Management | 3 | `EU_CRA_SBM_1` SBOM generation at each product release; `EU_CRA_SBM_2` SBOM in machine-readable standard format |
| **Total** | **35** | |

Default severities: critical 6, high 18, medium 11.

## Cross-mapping to other frameworks

14 of 35 controls carry `maps_to` references to controls of other frameworks. The table counts the references per target framework. "Resolved" means the target ID exists as a control in a bundled SWAO catalogue; "unresolved" means the reference points at article or clause level, or uses an ID spelling that no catalogue contains.

| Target framework | Resolved references | Unresolved references |
|---|---|---|
| `ISO_27001` | 10 | 0 |
| `NIS2` | 7 | 0 |

In the other direction, controls of these frameworks reference EU_CRA controls: `OPENSSF_SCORECARD` (10), `EU_AI_ACT` (2).

In addition, the metadata (`cross_mapping_hints`) names these related frameworks: `NIS2`, `ISO_27001`, `GDPR`, `EUCS`, `DORA`. This list indicates thematic overlap; it is not a control-level mapping.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/community-frameworks/eu-cra](https://github.com/Accenture/SWAO/tree/main/community-frameworks/eu-cra)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

To customise the framework for one engagement, copy the `eu-cra` folder (with `framework-meta.yaml` and `controls.yaml`) into the workspace at `wsp/inputs/catalogs/community/eu-cra/` and edit the copy there. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Make sure the `eu-cra` folder is present under `wsp/inputs/catalogs/community/` in the workspace (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [EU_CRA]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [EU_CRA, GDPR]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "EU_CRA"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

## Limitations and notes

- Product classification (default, Class I, Class II), conformity assessment, CE marking and ENISA notifications are marked `aud` (13 controls). SWAO cannot decide them from code.
- The SBOM controls benefit from Pass 05 output, but a SWAO SBOM is evidence for the assessment, not the manufacturer's official SBOM deliverable.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The publisher's official source is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
