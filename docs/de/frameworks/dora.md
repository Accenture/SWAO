# Verordnung über die digitale operationale Resilienz im Finanzsektor (DORA)

Diese Seite beschreibt das Community-Rahmenwerk `DORA`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `DORA` |
| Herausgeber | Europäische Union (Verordnung (EU) 2022/2554) |
| Version | 2025-01-17 |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 1.0.0 |
| Controls gesamt | 31 |
| Bewertungsmodus | `binary` (deklariert) |
| Assessment-Typen (Metadaten) | `app`, `aud` |
| Lizenz und Weiterverbreitung | DORA ist ein EU-Rechtsakt und gemäß den EUR-Lex-Bedingungen weiterverwendbar. Die Control-Beschreibungen geben die Verordnung sinngemäß wieder und sind keine Rechtsberatung; ziehen Sie Rechtsberatung und Ihre zuständige Aufsichtsbehörde hinzu. |
| Zuletzt geprüft | 2026-09-21 |
| Ordner | `dora` |

## Worum es geht

DORA (Verordnung (EU) 2022/2554) ist eine EU-Verordnung zur digitalen operationalen Resilienz des Finanzsektors. Sie gilt seit dem 17. Januar 2025 und ist in allen Mitgliedstaaten unmittelbar verbindlich. Sie umfasst IKT-Risikomanagement, Behandlung und Meldung IKT-bezogener Vorfälle, Tests der digitalen operationalen Resilienz, Management des IKT-Drittparteienrisikos und Informationsaustausch.

Der SWAO-Katalog enthält 31 Controls in den fünf Säulen von DORA, benannt nach Artikeln (zum Beispiel `DORA_Art_9_1` für Artikel 9).

## Wer es in SWAO einsetzt und wann

- Banken, Versicherer, Wertpapierfirmen, Zahlungsinstitute und andere Finanzunternehmen in der EU (Hinweise im Katalog: `financial_services`, `banking`, `insurance`, `payment_institution`, `investment_firm`, `eu_critical_infrastructure`).
- IKT-Drittdienstleister, die EU-Finanzunternehmen bedienen und die Übereinstimmung mit den DORA-Pflichten ihrer Kunden zeigen müssen.
- DORA-Readiness- und Gap-Analysen für Workloads, die in die Cloud wechseln.

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
| Signale und Dokumente kombiniert | 4 |
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 22 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 8 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 0 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `TF` | 3 | [Pass 06 (TF)](/de/passes/06-tf) |
| `OBS` | 3 | Nachweisbereich Beobachtbarkeit, Logging und Monitoring; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `EGR` | 1 | [Pass 07 (EGR)](/de/passes/07-egr) |
| `IAM` | 1 | Nachweisbereich Identität und Zugriff; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `CRYPTO` | 1 | [Pass 08 (CRYPTO)](/de/passes/08-crypto) |
| `SBOM` | 1 | [Pass 05 (SBOM)](/de/passes/05-sbom) |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `DORA_Art_7_1` ICT systems hardening and lifecycle management (`TF`)
- `DORA_Art_7_2` Network topology and traffic segregation (`EGR`, `TF`)
- `DORA_Art_9_1` Access control and privileged access management (`IAM`)

Controls, die Dokumente benötigen:

- `DORA_Art_5_1` Management body accountability for ICT risk
- `DORA_Art_5_2` ICT strategy and budget oversight by management body

Beispiele für reine Audit-Controls: `DORA_Art_17`, `DORA_Art_19`, `DORA_Art_24`.

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| Pillar 1: ICT Risk Management | 18 | `DORA_Art_5_1` Management body accountability for ICT risk; `DORA_Art_5_2` ICT strategy and budget oversight by management body |
| Pillar 2: ICT Incident Management and Reporting | 4 | `DORA_Art_15` ICT incident management process; `DORA_Art_16` ICT incident classification and major incident determination |
| Pillar 3: Digital Operational Resilience Testing | 3 | `DORA_Art_24` Digital operational resilience testing programme; `DORA_Art_25` Vulnerability and penetration testing |
| Pillar 4: ICT Third-party Risk Management | 5 | `DORA_Art_28_1` Third-party ICT risk strategy and oversight function; `DORA_Art_28_2` Register of ICT third-party contractual arrangements |
| Pillar 5: Information Sharing | 1 | `DORA_Art_45` Voluntary cyber threat information sharing |
| **Summe** | **31** | |

Standard-Schweregrade: critical 2, high 22, medium 6, low 1.

## Cross-Mapping

28 von 31 Controls tragen `maps_to`-Verweise auf Controls anderer Rahmenwerke. Die folgende Tabelle zählt die Verweise je Zielrahmenwerk. "Aufgelöst" bedeutet, dass die Ziel-ID als Control in einem mitgelieferten SWAO-Katalog existiert; "nicht aufgelöst" bedeutet, dass der Verweis auf Artikel- oder Klauselebene zielt oder eine ID-Schreibweise verwendet, die kein Katalog enthält.

| Zielrahmenwerk | Aufgelöste Verweise | Nicht aufgelöste Verweise |
|---|---|---|
| `ISO_27001` | 39 | 0 |

Umgekehrt verweisen Controls dieser Rahmenwerke auf Controls von DORA: `COBIT_5` (2).

Zusätzlich nennen die Metadaten (`cross_mapping_hints`) folgende verwandte Rahmenwerke: `ISO_27001`, `NIS2`, `BSI_C5`, `SOC_2`, `GDPR`. Diese Liste ist ein Hinweis auf thematische Überschneidung, kein Control-Mapping.

## Demo-Variante

| Eigenschaft | Wert |
|---|---|
| Framework-ID | `DORA_DEMO` |
| Ordner | `dora-demo` |
| Controls | 12 |
| Katalogversion | 0.1.0 |
| Zuletzt geprüft | 2026-09-21 |
| In neuen Workspaces vorinstalliert | Nein |

Die Demo-Variante enthält 12 Controls aus allen fünf Säulen und verwendet die artikelbasierten IDs des vollständigen Rahmenwerks (zum Beispiel `DORA_Art_9_1`, `DORA_Art_17`, `DORA_Art_30`). Sie ist für Live-Präsentationen gedacht; für echte Assessments verwenden Sie das vollständige DORA-Rahmenwerk. Die Demo-Controls enthalten keine `maps_to`-Einträge und keine `aud`-Kennzeichnung.

Die Demo-Variante ist für Workshops, Schulungen und Präsentationen gedacht, bei denen ein kurzer Bericht wichtiger ist als vollständige Abdeckung. Aktivieren Sie sie mit ihrer eigenen ID, zum Beispiel `regimes_active: [DORA_DEMO]`.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora)
- Demo-Variante: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora-demo](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/dora-demo)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Um das Rahmenwerk für ein einzelnes Projekt anzupassen, kopieren Sie den Ordner `dora` (mit `framework-meta.yaml` und `controls.yaml`) in den Workspace nach `wsp/inputs/catalogs/community/dora/` und bearbeiten Sie dort die Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Stellen Sie sicher, dass der Ordner `dora` unter `wsp/inputs/catalogs/community/` im Workspace liegt (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [DORA]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [DORA, GDPR]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "DORA"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

## Grenzen und Hinweise

- Aufsichtliche Meldungen (Art. 17, 19), Resilienztests einschließlich TLPT (Art. 24 bis 26) sowie das Informationsregister und die Vertragsbestimmungen für IKT-Dienstleister (Art. 28 Abs. 2, 30, 31) sind als `aud` gekennzeichnet. SWAO kann sie im Code nicht beobachten; sie erfordern Prüfungs- oder Aufsichtsnachweise.
- Die technischen Regulierungs- und Durchführungsstandards (RTS/ITS) der Europäischen Aufsichtsbehörden sind nicht als eigene Controls modelliert.
- Säule 5 ist nur durch ein Control (Art. 45, Informationsaustausch) vertreten.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer die offizielle Quelle des Herausgebers.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
