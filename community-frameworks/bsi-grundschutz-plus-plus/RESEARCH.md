# Research: BSI Grundschutz++ (status 2026-10-31)

Research for the SWAO community framework `BSI_GRUNDSCHUTZ_PP`. Every claim cites a source. The catalogue figures come from the pinned OSCAL file (see [CATALOGUE-STRUCTURE.md](CATALOGUE-STRUCTURE.md)), not from secondary sources.

## 1. Release facts

| Item | Fact | Source |
|---|---|---|
| Methodology | BSI-Standard 300-1 "Methodik Grundschutz++", Version 1.0. Change history: "1.0, 20.10.2026, Initiale Veröffentlichung der ersten anwendbaren Version" | https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Grundschutz/BSI_Standards/standard_300-1.pdf |
| Announcement | Press release 26.10.2026, "Methodik zum Grundschutz++ als BSI-Standard 300-1 veröffentlicht". It describes the approach as process-oriented and the risk method as freely selectable within minimum criteria. All requirements are machine-readable, the early-adopter phase follows, and an ISMS based on GS++ is certifiable from 2027 and compatible with ISO/IEC 27001 | https://www.bsi.bund.de/DE/Service-Navi/Presse/Alle-Meldungen-News/Meldungen/2026/BSI-Standard_300-1_261026.html |
| Presentation | it-sa Nürnberg, 27.10.2026 | BSI milestone page (below) |
| Target group | Version 1.0 addresses early adopters first (Standard 300-1, chapter 1) | standard_300-1.pdf |
| Catalogue | "Anwenderkatalog Grundschutz++", rolling publication without tags or releases. Catalogue version `2026-10-29T08:03:12.736989+00:00`, latest commit `c3f37859` (2026-10-30, "chore: publish rolling artifacts") | https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek |
| Licence | CC BY-SA 4.0 (repository LICENSE, GitHub `spdx_id`) | repository |
| Replaces | The machine-readable rule set replaces the IT-Grundschutz-Kompendium. Edition 2023 was the last Kompendium | https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/IT-Grundschutz/it-grundschutz_node.html |

### 1.1 Milestones and transition (BSI milestone page, status October 2026)

Source: https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/Grundschutz-in-der-Informationssicherheit/Grundschutz-Plus-Plus/grundschutz-plus-plus_node.html

| Date | Milestone |
|---|---|
| 01.04.2026 to 31.08.2026 | Pilot phase |
| 27.10.2026 | Presentation at it-sa |
| 30.11.2026 | Training concepts (GS++ Praktiker / Berater) |
| December 2026 | Worked example (fictitious authority "BDIT") |
| 01.01.2027 | GS++ certifiable: applications for ISO 27001 based on GS++, and for GS++ consultants and audit team leaders |
| Q1 2027 to 31.12.2027 | Early-adopter phase; upskilling of existing IT-Grundschutz consultants and auditors |
| 26.02.2027 | ISMS performance measurement integrated |
| 31.03.2027 | KPIs for every requirement of the methodology practices |
| 2027 ff. | Internationalisation (content is German only today) |
| 30.11.2031 | End of certification on the classic IT-Grundschutz basis |

No detailed transition rules for existing certificates (surveillance audits, recertification) were found. A practitioner source confirms this: https://www.kertos.io/en/blog/bsi-grundschutz-plus-plus (updated 2026-10-28).

### 1.2 Earlier context (not the current release)

| Date | Event | Source |
|---|---|---|
| 2025-09-29 / 30 | First public preview of the abstract GS++ requirements in the Stand-der-Technik-Bibliothek | https://www.bsi.bund.de/DE/Service-Navi/Presse/Alle-Meldungen-News/Meldungen/Stand-der-Technik-Bibliothek_250930.html |
| October 2025 | Methodology alpha shown at it-sa 2025 | de.wikipedia, article "Grundschutz++" |
| April 2026 | First "Leitfaden zur Methodik" and milestone plan | https://www.comconsult.com/bsi-veroeffentlicht-ersten-leitfaden-zur-methodik/ |
| 2026-07-27 | Repository migrated to a layer-based structure (`control_layer/`, `implementation_layer/`, `assessment_layer/`). Older raw URLs no longer resolve | repository history |
| 24.06.2026 | Secondary snapshot: 921 requirements, 19 Praktiken. The current file has 1000 requirements and 20 Praktiken | https://sits.com/de/blog/grundschutz-plus-plus-bsi-it-grundschutz/ |

## 2. Methodology: chapters of BSI-Standard 300-1

The method follows a PDCA cycle in five process steps. Chapter list from the table of contents of standard_300-1.pdf:

1. **Einleitung**
2. **Prozessschritt 1: Erhebung und Planung**
   - 2.1 Feststellung des Kontextes der Institution (2.1.1 external factors, 2.1.2 internal factors)
   - 2.2 Einbindung des Compliance-Managements
   - 2.3 Festlegung des Anwendungsbereichs
   - 2.4 Analyse der interessierten Parteien
   - 2.5 Identifizierung der Geschäftsprozesse
   - 2.6 Schutzbedarfsfeststellung
   - 2.7 Entwicklung einer Informationssicherheitsleitlinie
   - 2.8 Festlegung von Rollen und Zuständigkeiten in der Informationssicherheitsorganisation
   - 2.9 Dokumentation und Kommunikation
   - 2.10 Festlegung und Freigabe der Vorgehensweise
   - 2.11 Initiierung der Risikobetrachtung
3. **Prozessschritt 2: Anforderungsanalyse**
   - 3.1 Festlegung und Abgrenzung des Informationsverbunds
   - 3.2 Erfassung der Assets
   - 3.3 Auswahl von Blaupausen
   - 3.4 Erstellung eines Anforderungspakets (3.4.1 Anwendung der verpflichtenden Anforderungen, 3.4.2 Zuordnung der Zielobjektkategorien auf Assets, 3.4.3 Ergänzung von Anforderungen)
   - 3.5 Gestaltungsentscheidungen
4. **Prozessschritt 3: Realisierung**
   - 4.1 Ermittlung und Bewertung des Umsetzungsstatus (4.1.1 Ermittlung, 4.1.2 Bewertung fehlender Umsetzungen)
   - 4.2 Durchführung der Risikobetrachtung (4.2.1 Risikoidentifikation, 4.2.2 Risikobewertung, 4.2.3 Risikobehandlung)
   - 4.3 Umsetzungsplanung und Priorisierung
   - 4.4 Festlegung von Zuständigkeiten und Umsetzungsfristen
   - 4.5 Fortschrittsverfolgung
5. **Prozessschritt 4: Überwachung**
   - 5.1 Leistungsbewertung des ISMS
   - 5.2 Internes Auditprogramm und -durchführung (5.2.1 Planung, 5.2.2 Umsetzung)
   - 5.3 Managementbewertungen
   - 5.4 Monitoring-Methoden und -Tools
   - 5.5 Validierung der Anforderungen
6. **Prozessschritt 5: kontinuierliche Verbesserung**
   - 6.1 Umgang mit Nicht-Konformitäten
   - 6.2 Identifikation von Verbesserungspotenzialen
   - 6.3 Korrektur- und Verbesserungsplan
   - 6.4 Evaluation
- **Anhang 1:** Zielobjektkategorien
- **Anhang 2:** simplified business process analysis
- **Anhang 3:** minimum criteria for the risk consideration
- **Anhang 4:** elementare Gefährdungen G 0.1 to G 0.47

### 2.1 Changes compared with the Kompendium 2023

| Topic | Kompendium 2023 | Grundschutz++ |
|---|---|---|
| Grouping | Bausteine in layers (ISMS, ORP, CON, OPS, DER, APP, SYS, IND, NET, INF) | 20 Praktiken with Themen. 6 methodology practices plus 14 organisational and technical practices (the "Stand der Technik Kernel") |
| Applicability | Modelling Bausteine onto target objects | Assets are mapped to Zielobjektkategorien, and requirements apply by category. Methodology requirements and requirements without a target object are mandatory (300-1, 3.4.1 to 3.4.2) |
| Levels | Basis, Standard, erhöhter Schutzbedarf (B / S / H) | Two security levels: `normal-SdT` and `erhöht`. `erhöht` is optional input to the risk consideration (300-1, 3.4.2) |
| Requirement wording | Free text | Sentence template ("Satzschablone"): target object, modal verb (MUSS / SOLLTE / KANN), result, action word, parameters |
| Scenarios | Bausteine | "Blaupausen", pre-parameterised catalogue profiles (300-1, 3.3) |
| Risk | BSI-Standard 200-3 | Freely selectable risk method that meets the minimum criteria (300-1, Anhang 3) |
| Format | PDF and Word | OSCAL JSON, CC BY-SA 4.0 |

## 3. Catalogue: all Praktiken

Counts come from the pinned resolved catalogue. They include nested requirements: 652 top level and 348 nested, 1000 in total. All Themen are listed in [CATALOGUE-STRUCTURE.md](CATALOGUE-STRUCTURE.md).

| # | Praktik | Title | Group | Requirements |
|---|---|---|---|---|
| 1 | GC | Governance und Compliance | Methodik | 35 |
| 2 | STM | Strukturmodellierung | Methodik | 15 |
| 3 | UMS | Umsetzung | Methodik | 11 |
| 4 | VRB | Verbesserung | Methodik | 10 |
| 5 | PERF | Monitoring-Evaluation | Methodik | 24 |
| 6 | RISK | Risikomanagement | Methodik | 4 |
| 7 | ASST | Informationen und Assets | Organisatorisch | 58 |
| 8 | PERS | Personal | Organisatorisch | 30 |
| 9 | BES | Beschaffungsmanagement | Organisatorisch | 109 |
| 10 | DLS | Dienstleistersteuerung | Organisatorisch | 18 |
| 11 | TEST | Änderungen und Tests | Organisatorisch | 36 |
| 12 | GEB | Gebäudemanagement | Organisatorisch | 75 |
| 13 | SENS | Sensibilisierung | Organisatorisch | 87 |
| 14 | ARCH | Architektur | Technisch | 63 |
| 15 | BER | Berechtigung | Technisch | 92 |
| 16 | NOT | Notfallplanung | Organisatorisch | 37 |
| 17 | DET | Detektion | Technisch | 82 |
| 18 | REA | Sicherheitsvorfallsbehandlung | Technisch | 23 |
| 19 | KONF | Konfiguration | Technisch | 157 |
| 20 | DEV | Entwicklung | Technisch | 34 |

Group and order come from `documentation/namespaces/practices.csv`, which also defines an example practice `EXMP` that does not appear in the catalogue.

Requirement model (verified in the OSCAL file):

- **Classes:** `BSI-Stand-der-Technik-Kernel` 901, `BSI-Methodik-Grundschutz-plus-plus` 95, `BSI-Anforderungen-zum-Risikomanagement` 4.
- **Modal verbs:** SOLLTE 627, KANN 224, MUSS 149.
- **Security levels:** `normal-SdT` 773, `erhöht` 227.
- **Effort level:** 0 to 5.
- **Kernel requirements** also carry protection-goal impact (confidentiality, integrity, availability, authenticity) and elementary threats.
- **Statements** carry target-object categories, documentation, result and action word.
- **Controlled vocabularies:** `documentation/namespaces/*.csv`. They define 39 target-object categories, 58 tags and 120 topics.
- **Data inconsistency:** Standard 300-1 (3.4.2) describes `erhöht` requirements as KANN, but BES.1.4, DET.4.12.1 and REA.2.5 are `erhöht` with SOLLTE. Kept as published (owner decision 2026-10-31).

## 4. Machine-readable files

Repository: https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek (OSCAL JSON, CC BY-SA 4.0). Files used by SWAO, all at commit `c3f37859fdf302394de39e89252eb3e72a45953c`:

| File | OSCAL | Content | sha256 |
|---|---|---|---|
| `control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json` | 1.1.3 | Anwenderkatalog, 20 Praktiken, 1000 requirements | `592410c5...d311fa28` |
| `control_layer/Mappings/IT-GS2023-zu-GSpp/ITGS-to-GS++-mapping_collection.json` | 1.2.1 | Kompendium 2023 to GS++, draft | `df7ea112...d22f267f` |
| `control_layer/Mappings/ISO-27001-zu-GSpp/ISO27001-AnnexA-to-GS++-mapping_collection.json` | 1.2.2 | ISO 27001 Annex A to GS++ | `ffb785b2...70e91662` |
| `LICENSE` | | CC BY-SA 4.0 | |

Other files in the repository, not used by SWAO yet:

- The source catalogues: Methodik, Kernel, Risikomanagement.
- The profile `Grundschutz++-profile.json`.
- The scenario catalogues: Lieferkettensicherheit, WLAN, and the Mindeststandard TLS draft.
- Component definitions in `implementation_layer/`: AWS Security Hub, Keycloak, network architecture, password policy and others.
- The data-model schema `documentation/datamodel/oscal_satzschablone_schema.json`.

Download pattern, with `+` encoded as `%2B`:
`https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/<commit>/control_layer/Grundschutz%2B%2B/Grundschutz%2B%2B-resolved_catalog.json`

## 5. Mappings

| Mapping | Status | Scope | Notes |
|---|---|---|---|
| Kompendium 2023 to GS++ | `draft`, generated with the gsmap tool (github.com/gsmap/pre-mapping-tool-baustein-to-oscal) | 1185 map entries; 824 sub-requirements = 510 Kompendium requirements in 94 Bausteine | Relationships: subset-of 464, intersects-with 395, superset-of 187, equivalent-to 118, equal-to 21. Sub-requirement suffix `-UA.n` is not part of the published Kompendium ids. 17 targets are not in the pinned catalogue |
| ISO 27001:2022 Annex A to GS++ | `complete`, human, semantic | All 93 Annex A controls | 19 targets are not in the pinned catalogue (the mapping predates the July 2026 restructuring) |
| NIS2 / BSIG / BSI C5 | none found | | The only machine-readable hook is the catalogue metadata property `scope_implements_norm` = "§ 44 Abs. 1 BSIG" |

SWAO results are in [crosswalk/README.md](crosswalk/README.md): coverage of the 105 SWAO 2023 controls (44 have a GS++ target), GS++ requirements without a 2023 predecessor (678), and the dangling targets.

## 6. Tooling

- **Stand-der-Technik-Viewer** (catalogues, component definitions, mapping crosswalks; runs locally in the browser), linked from the repository README: https://bsi-community.github.io/Stand-der-Technik-Viewer/ . It is hosted by the GitHub organisation `bsi-community`, not `BSI-Bund`.
- **verinice:** a GS++ domain prototype was shown at it-sa 2025 (de.wikipedia). No production support was confirmed.

## 7. Open points for SWAO

1. **Rolling catalogue.** It has no semantic version, and ids and paths still move. SWAO pins a commit and regenerates deliberately.
2. **Licence.** Decided (owner, 2026-10-31): the framework folder ships under CC BY-SA 4.0 with attribution, alongside the Apache-2.0 code.
3. **Draft 2023 mapping** with dangling targets. `maps_to` and inherited signals are derived, not authoritative.
4. **German only.** English titles would be SWAO additions and need review; the BSI plans internationalisation from 2027.
5. **KPIs and performance measurement** are pending (BSI milestones 26.02.2027 and 31.03.2027). Maturity scoring could follow then.
6. **Product wiring** done (2026-10-31): package and standalone copies, docs-site pages (EN, DE), `cross_mapping_hints` in kritis-de, nis2, bsi-c5, bsi-tr03107 and sgbx-de. Open: pre-installation by `swao init` (not planned). The demo variant was removed before release (owner decision 2026-11-01).
