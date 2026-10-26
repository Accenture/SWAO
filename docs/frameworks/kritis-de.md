# KRITIS-DE: German Critical Infrastructure IT Security (KRITIS_DE)

This page describes the community framework `KRITIS_DE` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `KRITIS_DE` |
| Authority / publisher | Bundesamt für Sicherheit in der Informationstechnik (BSI); Bundesnetzagentur (BNetzA) for energy and water |
| Version | 2024 |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 1.0.0 |
| Total controls | 40 |
| Scoring mode | `binary` (declared) |
| Assessment types (metadata) | `app`, `aud` |
| Licence and redistribution | Controls are synthesised from publicly available BSI guidance and sector authority publications, published under German government open-content terms. Not legal advice; operators must consult a BSI-approved auditor for their §8a evidence. |
| Last reviewed | 2026-09-21 |
| Folder | `kritis-de` |

## What it is

KRITIS-DE packages the IT security obligations of operators of critical infrastructure in Germany under §8a and §8b of the BSI Act (BSIG), as amended by the IT-Sicherheitsgesetz 2.0 (2021). Operators must implement appropriate state-of-the-art security measures, prove them to the BSI every two years and report significant disruptions. Sector thresholds are set in the BSI-KritisV ordinance.

KRITIS-DE is not an official BSI catalogue. The SWAO catalogue synthesises 40 controls in seven domains from the BSI KRITIS guidance on §8a evidence (Orientierungshilfe), sector-specific IT security catalogues and the KRITIS umbrella act (KRITIS-DachG) referenced in the catalogue.

## Who should use it in SWAO and when

- Operators of critical infrastructure in Germany and their IT service providers (catalogue hints: `de_kritis`, `german_critical_infrastructure`, `energy_sector`, `water_sector`, `health_sector`, `transport_sector`, `finance_kritis`, `ict_kritis`, `de_sovereign`).
- Cloud migrations of KRITIS systems, together with BSI_C5 for the provider side.
- Financial-sector KRITIS operators with a dual obligation under DORA (see `KRITIS_DE_SEC_FIN`).

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
| Code and configuration signals only (`signal_prefix`, `local_signal_regex`) | 7 |
| Signals and documents combined | 4 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 29 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 16 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 1 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `IAM` | 5 | evidence area identity and access; no SWAO analysis pass emits signals with this prefix |
| `EGR` | 3 | [Pass 07 (EGR)](/passes/07-egr) |
| `TF` | 2 | [Pass 06 (TF)](/passes/06-tf) |
| `OBS` | 2 | evidence area observability, logging and monitoring; no SWAO analysis pass emits signals with this prefix |
| `SBOM` | 1 | [Pass 05 (SBOM)](/passes/05-sbom) |

### Examples

Controls with code or configuration evidence:

- `KRITIS_DE_AST_2` Network perimeter documentation and segmentation (`EGR`, `TF`)
- `KRITIS_DE_AST_3` IT/OT boundary management (`EGR`)
- `KRITIS_DE_AST_4` Software inventory and patch lifecycle management (`TF`)

Controls that need documents:

- `KRITIS_DE_GOV_1` Management accountability for KRITIS IT security
- `KRITIS_DE_GOV_2` Biennial §8a security audit and BSI reporting

Examples of audit-only controls: `KRITIS_DE_GOV_1`, `KRITIS_DE_GOV_2`, `KRITIS_DE_GOV_3`.

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

### Conditional and inherited controls

- `KRITIS_DE_AST_3` (IT/OT boundary management) declares `applies_when: has_ot_systems: "true"`. Pass 11 matches `applies_when` against the `framework_context` block of the app's `.swao.yml` before any LLM call; a missing or different value makes the control N/A (not applicable), shown as "N/A" and never counted as Fail or in the compliance score:

  ```yaml
  framework_context:
    has_ot_systems: "true"
    kritis_sector: health   # energy, water, health, finance, transport or ict
  ```

- `KRITIS_DE_AST_5` (physical security perimeters) is marked `csp_inherited`.
- The five sector controls `KRITIS_DE_SEC_ENE` (`kritis_sector: energy` or `water`), `_HLT` (`health`), `_FIN` (`finance`), `_TRN` (`transport`) and `_ICT` (`ict`) declare `applies_when: kritis_sector`; without a matching `framework_context.kritis_sector` they are N/A. `KRITIS_DE_SEC_DACHG` applies to every operator in KRITIS-DachG scope.
- Controls scoped `assessment_type_scope: [aud]` (including all sector controls) are not evaluated in an application run; they appear as not assessed and need an audit assessment.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| KRIT-GOV: Governance and Accountability | 6 | `KRITIS_DE_GOV_1` Management accountability for KRITIS IT security; `KRITIS_DE_GOV_2` Biennial §8a security audit and BSI reporting |
| KRIT-AST: Asset and Network Inventory | 5 | `KRITIS_DE_AST_1` KRITIS system inventory and criticality classification; `KRITIS_DE_AST_2` Network perimeter documentation and segmentation |
| KRIT-INC: Incident Detection and Reporting | 6 | `KRITIS_DE_INC_1` Disruption classification and major incident criteria; `KRITIS_DE_INC_2` Mandatory §8b 2-hour reporting to BSI |
| KRIT-IDM: Access Control and Identity | 5 | `KRITIS_DE_IDM_1` Multi-factor authentication for KRITIS systems; `KRITIS_DE_IDM_2` Privileged access management for KRITIS systems |
| KRIT-BCM: Resilience and Continuity | 7 | `KRITIS_DE_BCM_1` High availability architecture for KRITIS systems; `KRITIS_DE_BCM_2` Business continuity plan for KRITIS services |
| KRIT-SCM: Supply Chain and Third-party Risk | 5 | `KRITIS_DE_SCM_1` Third-party KRITIS classification and due diligence; `KRITIS_DE_SCM_2` Cloud service provider requirements for KRITIS workloads |
| KRIT-SEC: Sector-Specific Requirements | 6 | `KRITIS_DE_SEC_ENE` Energy and Water: IT-Sicherheitskatalog compliance (BNetzA); `KRITIS_DE_SEC_HLT` Health sector: §75c SGB V security measures |
| **Total** | **40** | |

Default severities: critical 6, high 27, medium 7.

## Cross-mapping to other frameworks

38 of 40 controls carry `maps_to` references to controls of other frameworks. The table counts the references per target framework. "Resolved" means the target ID exists as a control in a bundled SWAO catalogue; "unresolved" means the reference points at article or clause level, or uses an ID spelling that no catalogue contains.

| Target framework | Resolved references | Unresolved references |
|---|---|---|
| `ISO_27001` | 43 | 0 |
| `BSI_C5` | 22 | 0 |

In addition, the metadata (`cross_mapping_hints`) names these related frameworks: `BSI_C5`, `BSI_GRUNDSCHUTZ_2023`, `ISO_27001`, `DORA`, `NIS2`. This list indicates thematic overlap; it is not a control-level mapping.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/community-frameworks/kritis-de](https://github.com/Accenture/SWAO/tree/main/community-frameworks/kritis-de)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

To customise the framework for one engagement, copy the `kritis-de` folder (with `framework-meta.yaml` and `controls.yaml`) into the workspace at `wsp/inputs/catalogs/community/kritis-de/` and edit the copy there. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Make sure the `kritis-de` folder is present under `wsp/inputs/catalogs/community/` in the workspace (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [KRITIS_DE]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [KRITIS_DE, GDPR]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "KRITIS_DE"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

## Limitations and notes

- The 2-hour reporting duty to the BSI under §8b (`KRITIS_DE_INC_2`), the biennial §8a audit (`KRITIS_DE_GOV_2`) and the sector controls are marked `aud` (16 controls in total). They need evidence from a §8a audit or the sector authority.
- Whether an organisation is a KRITIS operator at all depends on the BSI-KritisV thresholds; SWAO does not determine this.
- German KRITIS law is changing with the NIS2 transposition and the KRITIS umbrella act; check the current legal status before relying on the catalogue.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The publisher's official source is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
