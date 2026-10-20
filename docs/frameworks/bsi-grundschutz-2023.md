# BSI IT-Grundschutz Kompendium, Edition 2023 (BSI_GRUNDSCHUTZ_2023)

This page describes the community framework `BSI_GRUNDSCHUTZ_2023` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `BSI_GRUNDSCHUTZ_2023` |
| Authority / publisher | Bundesamt für Sicherheit in der Informationstechnik (BSI), Germany |
| Version | Edition 2023 (published January 2023) |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 0.2.0 |
| Total controls | 105 |
| Scoring mode | `binary` (schema default; not declared) |
| Assessment types (metadata) | `app`, `aud` |
| Licence and redistribution | IT-Grundschutz is freely available from the BSI under its standard terms of use. Control texts paraphrase the Edition 2023 requirements; reviewers verify a control by locating the cited Baustein and requirement ID in the Kompendium. No legal advice. |
| Last reviewed | 2026-07-07 |
| Folder | `bsi-grundschutz-2023` |

## What it is

The IT-Grundschutz Kompendium is the BSI methodology for establishing, implementing and continually improving information security, based on the BSI standards 200-1 to 200-3. Edition 2023 organises 111 Bausteine (building blocks) in 10 Schichten (layers): ISMS, ORP, CON, OPS, DER, APP, SYS, IND, NET and INF.

The SWAO catalogue covers the workload-applicable scope: 105 requirements from 27 Bausteine in the layers ISMS, ORP, CON, OPS, DER, APP, SYS and NET. It contains 72 Basis (B) requirements, mapped to severity `high`, and 33 Standard (S) requirements, mapped to `medium`. Requirements for high protection needs (H) are excluded and need expert review.

## Who should use it in SWAO and when

- German public administration, regulated industry and critical infrastructure (catalogue hints include `german_public_sector`, `regulated_industry`, `critical_infrastructure`, `sovereign_cloud`, `bsi_certified`).
- Engagements where the client runs an ISMS according to BSI 200-2 and needs to show the migrated workload still fits it.
- Both cloud and on-premises workloads (hints `cloud_workload`, `on_premise`).

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
| Code and configuration signals only (`signal_prefix`, `local_signal_regex`) | 43 |
| Signals and documents combined | 0 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 62 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 0 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 0 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `CRYPTO` | 10 | [Pass 08 (CRYPTO)](/passes/08-crypto) |
| `OBS` | 10 | evidence area observability, logging and monitoring; no SWAO analysis pass emits signals with this prefix |
| `IAM` | 7 | evidence area identity and access; no SWAO analysis pass emits signals with this prefix |
| `SBOM` | 7 | [Pass 05 (SBOM)](/passes/05-sbom) |
| `EGR` | 5 | [Pass 07 (EGR)](/passes/07-egr) |
| `DATA` | 4 | [Pass 03 (DATA)](/passes/03-data) |

### Examples

Controls with code or configuration evidence:

- `BSI_ORP4_A2` User account and authorisation management (ORP.4.A2) (`IAM`)
- `BSI_CON1_A1` Definition of cryptographic requirements (CON.1.A1) (`CRYPTO`)
- `BSI_CON1_A2` Cryptographic key management (CON.1.A2) (`CRYPTO`)

Controls that need documents:

- `BSI_ISMS1_A1` Management responsibility for information security (ISMS.1.A1)
- `BSI_ISMS1_A3` Information security policy (ISMS.1.A3)

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| ISMS: Security Management | 8 | `BSI_ISMS1_A1` Management responsibility for information security (ISMS.1.A1); `BSI_ISMS1_A3` Information security policy (ISMS.1.A3) |
| ORP: Organisation and Personnel | 13 | `BSI_ORP1_A1` Roles and responsibilities for information security (ORP.1.A1); `BSI_ORP1_A2` Assignment of tasks and authorisations (ORP.1.A2) |
| CON: Concepts and Procedures | 16 | `BSI_CON1_A1` Definition of cryptographic requirements (CON.1.A1); `BSI_CON1_A2` Cryptographic key management (CON.1.A2) |
| OPS: Operations | 18 | `BSI_OPS112_A1` Change management concept (OPS.1.1.2.A1); `BSI_OPS112_A2` Maintaining operations during changes (OPS.1.1.2.A2) |
| DER: Detection and Response | 15 | `BSI_DER1_A1` Detection concept (DER.1.A1); `BSI_DER1_A2` Central logging (DER.1.A2) |
| APP: Applications | 14 | `BSI_APP31_A1` Authentication for web applications and services (APP.3.1.A1); `BSI_APP31_A2` Access control for web applications (APP.3.1.A2) |
| SYS: IT Systems | 10 | `BSI_SYS11_A1` Physical and logical access restrictions for servers (SYS.1.1.A1); `BSI_SYS11_A2` Minimal server configuration (SYS.1.1.A2) |
| NET: Networks and Communication | 11 | `BSI_NET11_A1` Network architecture requirements (NET.1.1.A1); `BSI_NET11_A2` Network segmentation (NET.1.1.A2) |
| **Total** | **105** | |

Default severities: high 72, medium 33.

## Cross-mapping to other frameworks

105 of 105 controls carry `maps_to` references to controls of other frameworks. The table counts the references per target framework. "Resolved" means the target ID exists as a control in a bundled SWAO catalogue; "unresolved" means the reference points at article or clause level, or uses an ID spelling that no catalogue contains.

| Target framework | Resolved references | Unresolved references |
|---|---|---|
| `ISO_27001` | 144 | 0 |
| `GDPR` | 57 | 0 |

In the other direction, controls of these frameworks reference BSI_GRUNDSCHUTZ_2023 controls: `BSI_C5` (44), `ISO_27001` (3).

In addition, the metadata (`cross_mapping_hints`) names these related frameworks: `GDPR`, `ISO_27001`, `BSI_C5`, `DORA`, `SOC_2`, `CIS_CONTROLS_V8`, `NIST_CSF_2`, `PCI_DSS_4_0_1`. This list indicates thematic overlap; it is not a control-level mapping.

## Demo variant

| Property | Value |
|---|---|
| Framework ID | `BSI_GRUNDSCHUTZ_2023_DEMO` |
| Folder | `bsi-grundschutz-2023-demo` |
| Controls | 11 |
| Catalogue version | 1.0.0 |
| Last reviewed | 2026-07-07 |
| Pre-installed in new workspaces | Yes (`swao init`) |

The demo variant is a demo-sized subset for live presentations with the Sovereign Health demo application. It contains one or two requirements from each of eight layers (for example `BSI_GS_DEMO.ISMS1_A1`, `BSI_GS_DEMO.ORP4_A1`, `BSI_GS_DEMO.NET11_A1`) and is designed to cross-reference the GDPR, AI 10 Pillars and HIPAA demo frameworks. Its framework metadata restricts it to the `app` assessment type.

Use the demo variant for workshops, training and presentations where a short report matters more than full coverage. Enable it with its own ID, for example `regimes_active: [BSI_GRUNDSCHUTZ_2023_DEMO]`.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-grundschutz-2023](https://github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-grundschutz-2023)
- Demo variant: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/bsi-grundschutz-2023-demo](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/bsi-grundschutz-2023-demo)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

To customise the framework for one engagement, copy the `bsi-grundschutz-2023` folder (with `framework-meta.yaml` and `controls.yaml`) into the workspace at `wsp/inputs/catalogs/community/bsi-grundschutz-2023/` and edit the copy there. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Make sure the `bsi-grundschutz-2023` folder is present under `wsp/inputs/catalogs/community/` in the workspace (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [BSI_GRUNDSCHUTZ_2023]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [BSI_GRUNDSCHUTZ_2023, GDPR]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "BSI_GRUNDSCHUTZ_2023"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

## Limitations and notes

- Only 8 of the 10 layers and 27 Bausteine are included; IND (industrial IT) and INF (infrastructure, buildings) are out of scope, as are all H requirements.
- Applying the BSI methodology to the client's information domain remains the task of the client or auditor. SWAO results support, but do not replace, that work.
- 62 of the 105 requirements depend on documents (for example `evidence/isms1-a1-management-responsibility.md`) or on a manual questionnaire.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The publisher's official source is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
