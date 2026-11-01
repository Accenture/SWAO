# BSI Grundschutz++ (SWAO community framework)

Framework id `BSI_GRUNDSCHUTZ_PP`, signal prefix `GSPP`, catalogue version 0.1.0.

This folder packages the complete **BSI Grundschutz++ Anwenderkatalog** (1000 requirements, 20 Praktiken, 140 Themen) as a SWAO community framework. Grundschutz++ is the successor of the IT-Grundschutz-Kompendium (last edition 2023). Its methodology is **BSI-Standard 300-1 "Methodik Grundschutz++" Version 1.0** (document date 20.10.2026, announced 26.10.2026). The requirements catalogue is a **rolling publication** in the early-adopter phase, and requirement ids may still change. Background, release facts and all chapters are in [RESEARCH.md](RESEARCH.md).

Status: shipped as a community framework (owner decision 2026-10-31). Copies: `docs/custom-frameworks/bsi-grundschutz-plus-plus/` (authoring, generator output), `swao/packages/@swao/community-frameworks/frameworks/bsi-grundschutz-plus-plus/` and `swao/community-frameworks/bsi-grundschutz-plus-plus/` (byte-identical product copies). No demo variant (owner decision 2026-11-01). Not pre-installed by `swao init`. After regenerating, copy the authoring folder to both product locations.

## Files

| File | Content | Generated |
|---|---|---|
| `framework-meta.yaml` | SWAO framework metadata (design 029, design 104) | yes |
| `controls.yaml` | 1000 SWAO controls, one per BSI requirement, including nested ones | yes |
| `evidence/<praktik>.md` | One evidence template per Praktik, a heading per requirement | yes |
| `crosswalk/itgs2023-to-gspp.csv` | IT-Grundschutz Kompendium 2023 to Grundschutz++ (BSI draft mapping) | yes |
| `crosswalk/iso27001-to-gspp.csv` | ISO/IEC 27001:2022 Annex A to Grundschutz++ (BSI mapping) | yes |
| `crosswalk/README.md` | Crosswalk statistics, coverage both ways, dangling targets | yes |
| `CATALOGUE-STRUCTURE.md` | All Praktiken and Themen with counts | yes |
| `LICENSE-CC-BY-SA-4.0.txt` | Licence text from the BSI repository | copied |
| `README.md`, `RESEARCH.md` | This file and the research report | hand-written |

## How the controls are built

The generator is `scripts/generate-bsi-gspp-controls.py`, and its tests are in `scripts/test_generate_bsi_gspp_controls.py`. It reads the official OSCAL files of the BSI Stand-der-Technik-Bibliothek at a **pinned commit**. It never reads `main`.

- **Source.** The resolved catalogue `control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json` (OSCAL 1.1.3, catalogue version `2026-10-29T08:03:12`) at commit `c3f37859fdf302394de39e89252eb3e72a45953c`. Its sha256 is recorded in `controls.yaml` (`source_sha256`).
- **Ids.** `GSPP_<official id with dots replaced>`, for example `KONF.2.1` becomes `GSPP_KONF_2_1`. The BSI id is kept in `official_control_id` and in the title.
- **Text.** Title, statement and guidance (`Umsetzungshinweis`) are German and verbatim. OSCAL parameters are resolved to their values, and dashes are normalised (CLAUDE.md §5.1). There is no translation.
- **Severity.** Follows the modal verb: MUSS is high, SOLLTE is medium, KANN is low.
- **Tags.** Praktik, Thema, class (Methodik / Kernel / Risikomanagement), security level (`normal-SdT`, `erhöht`), modal verb, effort (0 to 5), protection goals, target-object categories, BSI tags, elementary threats, and the parent requirement for nested requirements. Use them to filter, for example to the 773 `normal-SdT` requirements or to one target-object category.
- **Evidence.** Every control points to its Praktik evidence template, `evidence/<praktik>.md`. A control also inherits the automated `signal_prefix` evidence of a SWAO `BSI_GRUNDSCHUTZ_2023` control, but only when the BSI mapping states the 2023 requirement is `equal-to`, `equivalent-to` or a `superset-of` the GS++ requirement. This applies to 25 controls. It is a SWAO rule, not a BSI statement.
- **Cross-mapping.** `maps_to` lists the SWAO `BSI_GRUNDSCHUTZ_2023` and `ISO_27001` control ids that the BSI mapping files link to the requirement, with any relationship type. Relationship types and the full 2023 scope are only in the CSVs. See [crosswalk/README.md](crosswalk/README.md).

To regenerate after a new BSI rolling publication:

```bash
# 1. download the four files at the new commit (see RESEARCH.md section 4) into an empty folder
# 2. regenerate and test
python -I scripts/generate-bsi-gspp-controls.py --source-dir <folder> --commit <full sha>
python -m unittest scripts/test_generate_bsi_gspp_controls.py
```

Then review the diff. Requirement ids may have moved, and `maps_to` and the crosswalk statistics change with them.

## Relationship to BSI_GRUNDSCHUTZ_2023

Both frameworks coexist. `replaces` stays empty, because IT-Grundschutz certification on the 2023 basis remains possible until 30.11.2031 (BSI milestone plan). Setting `replaces: [BSI_GRUNDSCHUTZ_2023]` while 2023 still ships would also alias the old id in the registry.

The BSI 2023 mapping is a **draft**, generated with the gsmap tool. It covers 510 Kompendium requirements in 94 Bausteine. It covers 44 of the 105 SWAO 2023 controls; the other 61 have no GS++ target in the BSI file. 678 of the 1000 GS++ requirements have no 2023 predecessor in the mapping.

Note: the 2023 authoring copy in `docs/custom-frameworks/bsi-grundschutz-2023/` (72 controls, v0.1.0) is older than the product copy (105 controls, v0.2.0) and stays as it is (owner decision 2026-10-31). The crosswalk uses the product copy.

## Licence and attribution

The BSI content (requirement titles, statements, guidance, parameters, mappings) comes from the **BSI Stand-der-Technik-Bibliothek** (https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek). Its publisher is the Bundesamt für Sicherheit in der Informationstechnik (BSI), and it is licensed under **Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**.

- **Changes made by SWAO:** converted from OSCAL JSON to the SWAO catalogue YAML; parameters resolved; dashes normalised; SWAO ids, severities, tags, evidence references and cross-mapping fields added; crosswalk CSVs derived from the BSI mapping collections.
- **ShareAlike:** this derived catalogue, the evidence templates and the crosswalk files are shared under CC BY-SA 4.0. The licence applies to this folder only. The generator script is SWAO code.
- **Licence decision (owner, 2026-10-31):** the folder ships under CC BY-SA 4.0 with this attribution, alongside the Apache-2.0 SWAO code.

The BSI catalogue is authoritative. This packaging is not legal advice and not a certification statement.
