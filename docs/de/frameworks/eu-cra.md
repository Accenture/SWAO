# Cyberresilienzverordnung der EU (EU_CRA)

Diese Seite beschreibt das Community-Rahmenwerk `EU_CRA`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `EU_CRA` |
| Herausgeber | Europäische Union (Verordnung (EU) 2024/2847) |
| Version | 2024-12-11 |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 1.0.0 |
| Controls gesamt | 35 |
| Bewertungsmodus | `binary` (deklariert) |
| Assessment-Typen (Metadaten) | `app`, `aud` |
| Lizenz und Weiterverbreitung | Der CRA ist ein EU-Rechtsakt und gemäß den EUR-Lex-Bedingungen weiterverwendbar. Das Rahmenwerk bildet die Herstellerperspektive ab; cloudbasiertes SaaS ist vom CRA ausgenommen. Für die Produktklassifizierung ziehen Sie Rechtsberatung hinzu. |
| Zuletzt geprüft | 2026-09-21 |
| Ordner | `eu-cra` |

## Worum es geht

Die Cyberresilienzverordnung (Verordnung (EU) 2024/2847) legt Cybersicherheitsanforderungen für "Produkte mit digitalen Elementen" fest (Hard- und Softwareprodukte mit Netzwerkanbindung), die auf dem EU-Markt bereitgestellt werden. Laut Katalog trat sie am 10. Dezember 2024 in Kraft; die meisten Anforderungen gelten ab dem 11. Dezember 2027, die Meldepflichten nach Artikel 14 ab September 2026. Ausgenommen sind unter anderem SaaS, Medizinprodukte, Luftfahrt, Kraftfahrzeuge und Produkte der nationalen Sicherheit. Der CRA verlangt eine maschinenlesbare Software-Stückliste (SBOM) und die Meldung aktiv ausgenutzter Schwachstellen an die ENISA binnen 24 Stunden.

Der SWAO-Katalog enthält 35 Controls in sechs Domänen.

## Wer es in SWAO einsetzt und wann

- Software- und Hardwarehersteller, IoT- und Gerätehersteller mit Vertrieb in der EU (Hinweise im Katalog: `product_vendor`, `iot_product`, `software_product`, `hardware_vendor`, `connected_device`, `eu_market`).
- Bewertung einer Produkt-Codebasis vor dem Inverkehrbringen, insbesondere zur Bereitschaft bei SBOM und Schwachstellenbehandlung.
- Nicht für reine SaaS-Workloads, die der CRA ausnimmt.

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
| Nur Code- und Konfigurationssignale (`signal_prefix`, `local_signal_regex`) | 5 |
| Signale und Dokumente kombiniert | 2 |
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 28 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 13 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 0 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `SBOM` | 4 | [Pass 05 (SBOM)](/de/passes/05-sbom) |
| `IAM` | 1 | Nachweisbereich Identität und Zugriff; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `CRYPTO` | 1 | [Pass 08 (CRYPTO)](/de/passes/08-crypto) |
| `OBS` | 1 | Nachweisbereich Beobachtbarkeit, Logging und Monitoring; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `EU_CRA_SBD_3` Authentication and access protection mechanisms (`IAM`)
- `EU_CRA_SBD_4` Confidentiality protection and data encryption (`CRYPTO`)
- `EU_CRA_SBD_10` Security event logging and monitoring capability (`OBS`)

Controls, die Dokumente benötigen:

- `EU_CRA_SBD_1` No known exploitable vulnerabilities at market placement
- `EU_CRA_SBD_2` Secure by default configuration

Beispiele für reine Audit-Controls: `EU_CRA_SBD_12`, `EU_CRA_VHR_5`, `EU_CRA_VHR_6`.

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| CRA-SBD: Security by Design (Annex I Part I) | 12 | `EU_CRA_SBD_1` No known exploitable vulnerabilities at market placement; `EU_CRA_SBD_2` Secure by default configuration |
| CRA-VHR: Vulnerability Handling (Annex I Part II) | 8 | `EU_CRA_VHR_1` Vulnerability identification and tracking process; `EU_CRA_VHR_2` Coordinated vulnerability disclosure (CVD) policy |
| CRA-CLS: Critical Product Classification (Annex II) | 5 | `EU_CRA_CLS_1` Product classification determination (default, Class I, Class II); `EU_CRA_CLS_2` Class I conformity assessment via harmonised standard or self-assessment |
| CRA-CAF: Conformity Assessment and CE Marking | 4 | `EU_CRA_CAF_1` EU Declaration of Conformity (DoC); `EU_CRA_CAF_2` CE marking with cybersecurity conformity |
| CRA-MSV: Market Surveillance and Incident Reporting | 3 | `EU_CRA_MSV_1` 24-hour ENISA notification for actively exploited vulnerabilities (cross-reference); `EU_CRA_MSV_2` Market surveillance authority cooperation |
| CRA-SBM: Software Bill of Materials Management | 3 | `EU_CRA_SBM_1` SBOM generation at each product release; `EU_CRA_SBM_2` SBOM in machine-readable standard format |
| **Summe** | **35** | |

Standard-Schweregrade: critical 6, high 18, medium 11.

## Cross-Mapping

14 von 35 Controls tragen `maps_to`-Verweise auf Controls anderer Rahmenwerke. Die folgende Tabelle zählt die Verweise je Zielrahmenwerk. "Aufgelöst" bedeutet, dass die Ziel-ID als Control in einem mitgelieferten SWAO-Katalog existiert; "nicht aufgelöst" bedeutet, dass der Verweis auf Artikel- oder Klauselebene zielt oder eine ID-Schreibweise verwendet, die kein Katalog enthält.

| Zielrahmenwerk | Aufgelöste Verweise | Nicht aufgelöste Verweise |
|---|---|---|
| `ISO_27001` | 10 | 0 |
| `NIS2` | 7 | 0 |

Umgekehrt verweisen Controls dieser Rahmenwerke auf Controls von EU_CRA: `OPENSSF_SCORECARD` (10), `EU_AI_ACT` (2).

Zusätzlich nennen die Metadaten (`cross_mapping_hints`) folgende verwandte Rahmenwerke: `NIS2`, `ISO_27001`, `GDPR`, `EUCS`, `DORA`. Diese Liste ist ein Hinweis auf thematische Überschneidung, kein Control-Mapping.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/community-frameworks/eu-cra](https://github.com/Accenture/SWAO/tree/main/community-frameworks/eu-cra)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Um das Rahmenwerk für ein einzelnes Projekt anzupassen, kopieren Sie den Ordner `eu-cra` (mit `framework-meta.yaml` und `controls.yaml`) in den Workspace nach `wsp/inputs/catalogs/community/eu-cra/` und bearbeiten Sie dort die Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Stellen Sie sicher, dass der Ordner `eu-cra` unter `wsp/inputs/catalogs/community/` im Workspace liegt (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [EU_CRA]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [EU_CRA, GDPR]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "EU_CRA"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

## Grenzen und Hinweise

- Produktklassifizierung (Standard, Klasse I, Klasse II), Konformitätsbewertung, CE-Kennzeichnung und ENISA-Meldungen sind als `aud` gekennzeichnet (13 Controls). SWAO kann sie nicht aus dem Code entscheiden.
- Die SBOM-Controls profitieren von der Ausgabe von Pass 05; eine SWAO-SBOM ist jedoch ein Nachweis für das Assessment, nicht die offizielle SBOM des Herstellers.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer die offizielle Quelle des Herausgebers.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
