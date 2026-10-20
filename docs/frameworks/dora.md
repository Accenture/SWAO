# Digital Operational Resilience Act (DORA)

This page describes the community framework `DORA` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `DORA` |
| Authority / publisher | European Union (Regulation (EU) 2022/2554) |
| Version | 2025-01-17 |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 1.0.0 |
| Total controls | 31 |
| Scoring mode | `binary` (declared) |
| Assessment types (metadata) | `app`, `aud` |
| Licence and redistribution | DORA is an EU legislative act, reusable under the EUR-Lex terms. Control descriptions paraphrase the regulation and are not legal advice; consult legal counsel and your competent authority. |
| Last reviewed | 2026-09-21 |
| Folder | `dora` |

## What it is

DORA (Regulation (EU) 2022/2554) is an EU regulation on digital operational resilience for the financial sector. It applies since 17 January 2025 and is directly binding in all member states. It covers ICT risk management, ICT incident management and reporting, digital operational resilience testing, ICT third-party risk management and information sharing.

The SWAO catalogue contains 31 controls in DORA's five pillars, keyed by article (for example `DORA_Art_9_1` for Article 9).

## Who should use it in SWAO and when

- Banks, insurers, investment firms, payment institutions and other financial entities in the EU (catalogue hints: `financial_services`, `banking`, `insurance`, `payment_institution`, `investment_firm`, `eu_critical_infrastructure`).
- ICT third-party providers that serve EU financial entities and must show alignment with their clients' DORA obligations.
- DORA readiness and gap assessments for workloads moving to cloud.

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
| Signals and documents combined | 4 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 22 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 8 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 0 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `TF` | 3 | [Pass 06 (TF)](/passes/06-tf) |
| `OBS` | 3 | evidence area observability, logging and monitoring; no SWAO analysis pass emits signals with this prefix |
| `EGR` | 1 | [Pass 07 (EGR)](/passes/07-egr) |
| `IAM` | 1 | evidence area identity and access; no SWAO analysis pass emits signals with this prefix |
| `CRYPTO` | 1 | [Pass 08 (CRYPTO)](/passes/08-crypto) |
| `SBOM` | 1 | [Pass 05 (SBOM)](/passes/05-sbom) |

### Examples

Controls with code or configuration evidence:

- `DORA_Art_7_1` ICT systems hardening and lifecycle management (`TF`)
- `DORA_Art_7_2` Network topology and traffic segregation (`EGR`, `TF`)
- `DORA_Art_9_1` Access control and privileged access management (`IAM`)

Controls that need documents:

- `DORA_Art_5_1` Management body accountability for ICT risk
- `DORA_Art_5_2` ICT strategy and budget oversight by management body

Examples of audit-only controls: `DORA_Art_17`, `DORA_Art_19`, `DORA_Art_24`.

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| Pillar 1: ICT Risk Management | 18 | `DORA_Art_5_1` Management body accountability for ICT risk; `DORA_Art_5_2` ICT strategy and budget oversight by management body |
| Pillar 2: ICT Incident Management and Reporting | 4 | `DORA_Art_15` ICT incident management process; `DORA_Art_16` ICT incident classification and major incident determination |
| Pillar 3: Digital Operational Resilience Testing | 3 | `DORA_Art_24` Digital operational resilience testing programme; `DORA_Art_25` Vulnerability and penetration testing |
| Pillar 4: ICT Third-party Risk Management | 5 | `DORA_Art_28_1` Third-party ICT risk strategy and oversight function; `DORA_Art_28_2` Register of ICT third-party contractual arrangements |
| Pillar 5: Information Sharing | 1 | `DORA_Art_45` Voluntary cyber threat information sharing |
| **Total** | **31** | |

Default severities: critical 2, high 22, medium 6, low 1.

## Cross-mapping to other frameworks

28 of 31 controls carry `maps_to` references to controls of other frameworks. The table counts the references per target framework. "Resolved" means the target ID exists as a control in a bundled SWAO catalogue; "unresolved" means the reference points at article or clause level, or uses an ID spelling that no catalogue contains.

| Target framework | Resolved references | Unresolved references |
|---|---|---|
| `ISO_27001` | 39 | 0 |

In the other direction, controls of these frameworks reference DORA controls: `COBIT_5` (2).

In addition, the metadata (`cross_mapping_hints`) names these related frameworks: `ISO_27001`, `NIS2`, `BSI_C5`, `SOC_2`, `GDPR`. This list indicates thematic overlap; it is not a control-level mapping.

## Demo variant

| Property | Value |
|---|---|
| Framework ID | `DORA_DEMO` |
| Folder | `dora-demo` |
| Controls | 12 |
| Catalogue version | 0.1.0 |
| Last reviewed | 2026-09-21 |
| Pre-installed in new workspaces | No |

The demo variant contains 12 controls sampled across all five pillars, reusing the article-based IDs of the full framework (for example `DORA_Art_9_1`, `DORA_Art_17`, `DORA_Art_30`). It is intended for live presentations; use the full DORA framework for real assessments. The demo controls carry no `maps_to` entries and no `aud` scope markers.

Use the demo variant for workshops, training and presentations where a short report matters more than full coverage. Enable it with its own ID, for example `regimes_active: [DORA_DEMO]`.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora)
- Demo variant: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora-demo](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora-demo)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

To customise the framework for one engagement, copy the `dora` folder (with `framework-meta.yaml` and `controls.yaml`) into the workspace at `wsp/inputs/catalogs/community/dora/` and edit the copy there. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Make sure the `dora` folder is present under `wsp/inputs/catalogs/community/` in the workspace (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [DORA]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [DORA, GDPR]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "DORA"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

## Limitations and notes

- Regulatory reporting (Art. 17, 19), resilience testing including TLPT (Art. 24 to 26) and the register and contractual provisions for ICT providers (Art. 28(2), 30, 31) are marked `aud`. SWAO cannot observe these in code; they need audit or regulatory evidence.
- The level-2 regulatory technical standards (RTS/ITS) issued by the European Supervisory Authorities are not modelled as separate controls.
- Only one control (Art. 45, information sharing) represents Pillar 5.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The publisher's official source is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
