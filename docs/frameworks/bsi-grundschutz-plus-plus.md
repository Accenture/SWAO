# BSI Grundschutz++ (BSI_GRUNDSCHUTZ_PP)

This page describes the community framework `BSI_GRUNDSCHUTZ_PP` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `BSI_GRUNDSCHUTZ_PP` |
| Authority / publisher | Bundesamt für Sicherheit in der Informationstechnik (BSI), Germany |
| Version | Anwenderkatalog 2026-10-29 (rolling publication, BSI repository commit `c3f37859`); methodology BSI-Standard 300-1 Version 1.0 (20.10.2026) |
| Status | Early-adopter phase; certifiable from 01.01.2027 according to the BSI milestone plan |
| SWAO catalogue version | 0.1.0 |
| Total controls | 1000 |
| Language | German (verbatim BSI text) |
| Scoring mode | `binary` |
| Assessment types (metadata) | `app`, `aud` |
| Licence | BSI content under CC BY-SA 4.0 (BSI Stand-der-Technik-Bibliothek). The framework folder carries the licence text and attribution. No legal advice. |
| Folder | `bsi-grundschutz-plus-plus` |

## What it is

Grundschutz++ is the successor of the IT-Grundschutz-Kompendium, whose last edition was 2023. The BSI publishes the requirements as a machine-readable OSCAL catalogue, the "Anwenderkatalog Grundschutz++". It replaces the Bausteine with 20 Praktiken in 140 Themen. Six Praktiken cover the methodology: GC, STM, UMS, VRB, PERF and RISK. The other fourteen form the "Stand der Technik Kernel": ASST, PERS, BES, DLS, TEST, GEB, SENS, ARCH, BER, NOT, DET, REA, KONF and DEV.

Requirements apply to target-object categories, and there are two security levels, `normal-SdT` and `erhöht`. The method is described in BSI-Standard 300-1.

The SWAO catalogue contains all 1000 requirements of the pinned catalogue (652 top level, 348 nested). Severity follows the modal verb: MUSS is `high` (149), SOLLTE is `medium` (627) and KANN is `low` (224).

## Who should use it in SWAO and when

- Organisations that plan or start an ISMS on the Grundschutz++ basis (early adopters), especially German public administration, regulated industry and critical infrastructure.
- Engagements that need to show how a workload fits the new requirements, alongside or instead of `BSI_GRUNDSCHUTZ_2023`.
- Classic IT-Grundschutz certification remains possible until 30.11.2031. Both frameworks can be active together.

## What SWAO checks

Controls are evaluated in [Pass 11 (compliance evaluation)](/passes/11-comp), in the same way as for every community framework: the LLM rates each control `SATISFIED`, `PARTIAL`, `GAP`, `UNKNOWN` or `N_A` from the signals of the run. Without a configured LLM provider every control is reported as `UNKNOWN`.

### What evidence the controls expect

| Evidence type | Controls |
|---|---|
| Praktik evidence document (`context_input: evidence/<praktik>.md`) | 1000 |
| Additionally, code and configuration signals inherited from an equivalent 2023 control | 25 |

The inherited signal prefixes are `SBOM` (9), `EGR` (9), `OBS` (4), `IAM` (2) and `DATA` (1). A control inherits them only when the BSI mapping states that the 2023 requirement is equal to, equivalent to or broader than the Grundschutz++ requirement. Fill in the 20 evidence templates under `evidence/` and place them in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them. Without them, expect `UNKNOWN` for most controls.

### Filtering with tags

Every control carries tags such as:

- `praktik:KONF` and `thema:KONF.2`
- `sec-level:normal-SdT` or `sec-level:erhöht`
- `modal:SOLLTE`, `effort:3`
- `schutzziel:integrity`
- `zielobjekt:<category>`, `gefaehrdung:G 0.18`
- `parent:<id>` for nested requirements

Use them to build a workspace copy for one information domain, for example the 773 `normal-SdT` requirements only.

## Control structure

| Praktik | Title | Controls |
|---|---|---|
| GC | Governance und Compliance | 35 |
| STM | Strukturmodellierung | 15 |
| UMS | Umsetzung | 11 |
| VRB | Verbesserung | 10 |
| PERF | Monitoring-Evaluation | 24 |
| RISK | Risikomanagement | 4 |
| ASST | Informationen und Assets | 58 |
| PERS | Personal | 30 |
| BES | Beschaffungsmanagement | 109 |
| DLS | Dienstleistersteuerung | 18 |
| TEST | Änderungen und Tests | 36 |
| GEB | Gebäudemanagement | 75 |
| SENS | Sensibilisierung | 87 |
| ARCH | Architektur | 63 |
| BER | Berechtigung | 92 |
| NOT | Notfallplanung | 37 |
| DET | Detektion | 82 |
| REA | Sicherheitsvorfallsbehandlung | 23 |
| KONF | Konfiguration | 157 |
| DEV | Entwicklung | 34 |
| **Total** | | **1000** |

Control IDs follow the BSI ID: `KONF.2.1` becomes `GSPP_KONF_2_1`, and the original ID is kept in `official_control_id`.

## Cross-mapping to other frameworks

338 of 1000 controls carry `maps_to` references, derived from the two BSI mapping files:

| Target framework | References | Source |
|---|---|---|
| `ISO_27001` | 343 | BSI mapping ISO/IEC 27001:2022 Annex A to Grundschutz++ (status complete) |
| `BSI_GRUNDSCHUTZ_2023` | 129 | BSI mapping Kompendium 2023 to Grundschutz++ (status draft) |

The 2023 mapping is a BSI draft. It covers 510 Kompendium requirements; 44 of the 105 SWAO `BSI_GRUNDSCHUTZ_2023` controls have a Grundschutz++ counterpart in it. The full crosswalk, with relationship types in both directions, is in the framework folder under `crosswalk/`.

## Get or customise this framework

- Source: [github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-grundschutz-plus-plus](https://github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-grundschutz-plus-plus)
- Upstream catalogue: [github.com/BSI-Bund/Stand-der-Technik-Bibliothek](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek)

To customise it for one engagement, copy the folder into the workspace at `wsp/inputs/catalogs/community/bsi-grundschutz-plus-plus/` and edit the copy. Keep the `id` in `regime_meta` unchanged, and check the copy with the [health check](/health-check).

## How to enable

1. Copy the `bsi-grundschutz-plus-plus` folder into `wsp/inputs/catalogs/community/` in the workspace.
2. Add the framework ID to the app's `.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [BSI_GRUNDSCHUTZ_PP]
   ```

3. Run the [application assessment](/assessment/application) with an LLM configured.

## Limitations and notes

- **Rolling catalogue.** The BSI catalogue is a rolling publication and requirement IDs may still change. SWAO pins one repository commit and updates deliberately.
- **Large catalogue.** With 1000 controls, a full evaluation makes many LLM calls. Filter a workspace copy by tags for focused assessments.
- **German only.** Control texts are verbatim German BSI text, and the BSI plans internationalisation from 2027.
- **Inconsistency kept as published.** Three requirements at level `erhöht` carry SOLLTE instead of KANN (BES.1.4, DET.4.12.1, REA.2.5).
- **Not an audit.** Outcomes come from an LLM that interprets signals and documents. They support expert review and do not replace an audit or a certification.
- **Not legal advice.** This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [BSI IT-Grundschutz Kompendium 2023](/frameworks/bsi-grundschutz-2023)
- [Pass 11: compliance evaluation](/passes/11-comp)
