# EU-Zertifizierungsschema für Cloud-Dienste (EUCS)

Diese Seite beschreibt das Community-Rahmenwerk `EUCS`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `EUCS` |
| Herausgeber | Agentur der Europäischen Union für Cybersicherheit (ENISA) |
| Version | candidate-2024 |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 1.0.0 |
| Controls gesamt | 66 |
| Bewertungsmodus | `binary` (deklariert) |
| Assessment-Typen (Metadaten) | `app`, `aud` |
| Lizenz und Weiterverbreitung | Von der ENISA unter offenen EU-Veröffentlichungsbedingungen herausgegeben. Die Beschreibungen geben das Kandidatenschema sinngemäß wieder, das sich bis zur förmlichen Annahme ändern kann. Für Zertifizierungsfragen wenden Sie sich an eine von der ENISA anerkannte Konformitätsbewertungsstelle. |
| Zuletzt geprüft | 2026-09-21 |
| Ordner | `eucs` |

## Worum es geht

EUCS ist das Kandidatenschema der ENISA zur Cybersicherheitszertifizierung von Cloud-Diensten nach dem EU-Rechtsakt zur Cybersicherheit (Verordnung (EU) 2019/881). Das Kandidatenschema wurde im Dezember 2020 veröffentlicht und wird laut Katalog von der Europäischen Kommission als delegierter Rechtsakt vorbereitet. Es definiert drei Vertrauenswürdigkeitsstufen: Basic, Substantial und High (letztere für sensible EU-Daten). EUCS ist noch keine verbindliche Regulierung; der Katalog empfiehlt, den Einsatz als Vorbereitung auf eine Zertifizierung zu verstehen.

Der SWAO-Katalog enthält 66 Controls in 12 Domänen. Jedes Control trägt ein Tag mit seiner Mindeststufe (`eucs:basic`, `eucs:substantial` oder `eucs:high`).

## Wer es in SWAO einsetzt und wann

- Cloud-Anbieter (IaaS, PaaS, SaaS), die die Zertifizierung ihrer Angebote für EU-Kunden und Behörden vorbereiten (Hinweise im Katalog: `eu_cloud_provider`, `iaas_provider`, `paas_provider`, `saas_provider`, `cloud_certification`).
- Cloud-Kunden, die den Zertifizierungsstatus oder die Souveränitätsreife eines Anbieters bewerten möchten (`eu_sovereign_cloud`, `eu_regulated`).

## Was SWAO prüft

Die Controls werden in [Pass 11 (Compliance-Bewertung)](/de/passes/11-comp) bewertet. Der Pass liest die Liste `assessment.regimes_active` aus der `.swao.yml` der App, lädt den Katalog und sendet die Controls in Paketen zu je 20 an das konfigurierte LLM. Für jedes Control erhält das LLM ID, Titel, Beschreibung und Standard-Schweregrad sowie alle Signale, die die vorherigen Passes dieses Laufs erzeugt haben. Das LLM gibt je Control eines von fünf Ergebnissen zurück:

| Ergebnis | Bedeutung |
|---|---|
| `SATISFIED` | Die Signale bestätigen, dass das Control erfüllt ist. |
| `PARTIAL` | Einige Elemente sind vorhanden, es bleiben Lücken. |
| `GAP` | Die Signale zeigen, dass das Control nicht erfüllt ist. |
| `UNKNOWN` | Kein Signal spricht für oder gegen das Control. |
| `N_A` | Das Control gilt für diesen Workload nicht (mit Begründung). |

Zitierte Signal-IDs werden gegen die tatsächlich vorhandenen Signale geprüft; erfundene IDs werden verworfen. Ohne konfigurierten LLM-Anbieter wird jedes Control als `UNKNOWN` ausgewiesen.

### Welche Nachweise die Controls erwarten

Jedes Control deklariert im Feld `evidence_basis`, auf welcher Art von Nachweis es beruht. Diese Angabe beschreibt den erwarteten Nachweis für die prüfende Person; das Ergebnis selbst bestimmt das LLM anhand der Signale. Für dieses Rahmenwerk ergibt sich folgende Aufteilung:

| Nachweisart | Controls |
|---|---|
| Nur Code- und Konfigurationssignale (`signal_prefix`, `local_signal_regex`) | 19 |
| Signale und Dokumente kombiniert | 2 |
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 45 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 26 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 6 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `IAM` | 7 | Nachweisbereich Identität und Zugriff; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `CRYPTO` | 5 | [Pass 08 (CRYPTO)](/de/passes/08-crypto) |
| `EGR` | 4 | [Pass 07 (EGR)](/de/passes/07-egr) |
| `TF` | 4 | [Pass 06 (TF)](/de/passes/06-tf) |
| `OBS` | 4 | Nachweisbereich Beobachtbarkeit, Logging und Monitoring; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `SBOM` | 1 | [Pass 05 (SBOM)](/de/passes/05-sbom) |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `EUCS_IAM_2` User account lifecycle management (`IAM`)
- `EUCS_IAM_3` Multi-factor authentication for administrative access (`IAM`)
- `EUCS_IAM_4` Privileged access management (`IAM`)

Controls, die Dokumente benötigen:

- `EUCS_GRC_1` Information security policy
- `EUCS_GRC_2` Risk management framework

Beispiele für reine Audit-Controls: `EUCS_GRC_3`, `EUCS_GRC_4`, `EUCS_GRC_5`.

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

### Tags für die Vertrauenswürdigkeitsstufe

| Tag | Controls |
|---|---|
| `eucs:basic` | 9 |
| `eucs:substantial` | 29 |
| `eucs:high` | 28 |

Die Tags werden in den Plan und den Bericht übernommen, sodass Sie Controls nach Stufe filtern können. SWAO filtert nicht automatisch nach Stufe; alle 66 Controls werden bewertet.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| EUCS-GRC: Governance and Risk Management | 8 | `EUCS_GRC_1` Information security policy; `EUCS_GRC_2` Risk management framework |
| EUCS-HRS: Human Resources Security | 4 | `EUCS_HRS_1` Pre-employment screening; `EUCS_HRS_2` Mandatory security awareness training |
| EUCS-ASM: Asset Management | 5 | `EUCS_ASM_1` Cloud service asset inventory; `EUCS_ASM_2` Customer data classification scheme |
| EUCS-IAM: Access Control | 8 | `EUCS_IAM_1` Access control policy; `EUCS_IAM_2` User account lifecycle management |
| EUCS-CRY: Cryptography and Key Management | 6 | `EUCS_CRY_1` Encryption of customer data at rest; `EUCS_CRY_2` Encryption of data in transit |
| EUCS-PHY: Physical and Environmental Security | 5 | `EUCS_PHY_1` Physical access controls and multi-zone perimeter; `EUCS_PHY_2` Environmental monitoring and alerting |
| EUCS-OPS: Operations Management | 8 | `EUCS_OPS_1` Change management process; `EUCS_OPS_2` Vulnerability management and patching |
| EUCS-BCP: Business Continuity and Resilience | 5 | `EUCS_BCP_1` Business continuity plan for cloud services; `EUCS_BCP_2` Disaster recovery capabilities and geographic redundancy |
| EUCS-INC: Incident Management | 4 | `EUCS_INC_1` Incident management process; `EUCS_INC_2` Customer incident notification |
| EUCS-DEV: Secure Development and Supply Chain | 5 | `EUCS_DEV_1` Secure software development lifecycle (SSDLC); `EUCS_DEV_2` Software composition analysis and SBOM |
| EUCS-DPI: Data Portability and Interoperability | 4 | `EUCS_DPI_1` Customer data portability and export; `EUCS_DPI_2` Secure data deletion on contract termination |
| EUCS-AUD: Transparency and Audit | 4 | `EUCS_AUD_1` Third-party security attestation; `EUCS_AUD_2` Customer audit rights |
| **Summe** | **66** | |

Standard-Schweregrade: critical 5, high 45, medium 16.

## Cross-Mapping

61 von 66 Controls tragen `maps_to`-Verweise auf Controls anderer Rahmenwerke. Die folgende Tabelle zählt die Verweise je Zielrahmenwerk. "Aufgelöst" bedeutet, dass die Ziel-ID als Control in einem mitgelieferten SWAO-Katalog existiert; "nicht aufgelöst" bedeutet, dass der Verweis auf Artikel- oder Klauselebene zielt oder eine ID-Schreibweise verwendet, die kein Katalog enthält.

| Zielrahmenwerk | Aufgelöste Verweise | Nicht aufgelöste Verweise |
|---|---|---|
| `BSI_C5` | 55 | 0 |
| `ISO_27001` | 50 | 0 |

Zusätzlich nennen die Metadaten (`cross_mapping_hints`) folgende verwandte Rahmenwerke: `BSI_C5`, `ISO_27001`, `SOC_2`, `GDPR`, `KRITIS_DE`, `DORA`. Diese Liste ist ein Hinweis auf thematische Überschneidung, kein Control-Mapping.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/community-frameworks/eucs](https://github.com/Accenture/SWAO/tree/main/community-frameworks/eucs)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Um das Rahmenwerk für ein einzelnes Projekt anzupassen, kopieren Sie den Ordner `eucs` (mit `framework-meta.yaml` und `controls.yaml`) in den Workspace nach `wsp/inputs/catalogs/community/eucs/` und bearbeiten Sie dort die Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Stellen Sie sicher, dass der Ordner `eucs` unter `wsp/inputs/catalogs/community/` im Workspace liegt (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [EUCS]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [EUCS, GDPR]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "EUCS"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

## Grenzen und Hinweise

- EUCS ist ein Kandidatenschema; das endgültig angenommene Schema kann von diesem Katalog abweichen.
- Sechs Controls (physische Sicherheit und Hardware-Integrität) sind als `csp_inherited` gekennzeichnet: Die Verantwortung liegt beim Cloud-Anbieter. 26 Controls sind als `aud` gekennzeichnet.
- Eine förmliche Zertifizierung stellt eine akkreditierte Konformitätsbewertungsstelle aus, niemals SWAO.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer die offizielle Quelle des Herausgebers.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
