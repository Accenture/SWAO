# KI-Verordnung der EU (EU_AI_ACT)

Diese Seite beschreibt das Community-Rahmenwerk `EU_AI_ACT`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `EU_AI_ACT` |
| Herausgeber | Europäische Union (Verordnung (EU) 2024/1689) |
| Version | 2024-08-01 |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 1.0.0 |
| Controls gesamt | 37 |
| Bewertungsmodus | `binary` (deklariert) |
| Assessment-Typen (Metadaten) | `app`, `aud` |
| Lizenz und Weiterverbreitung | Die KI-Verordnung ist ein EU-Rechtsakt und gemäß den EUR-Lex-Bedingungen weiterverwendbar. Die Control-Beschreibungen geben die Verordnung sinngemäß wieder und sind keine Rechtsberatung. |
| Zuletzt geprüft | 2026-09-22 |
| Ordner | `eu-ai-act` |

## Worum es geht

Die KI-Verordnung (Verordnung (EU) 2024/1689) ist die risikobasierte EU-Regulierung für KI-Systeme, die in der EU in Verkehr gebracht oder in Betrieb genommen werden. Sie trat am 1. August 2024 in Kraft; ihre Pflichten gelten gestaffelt, die verbotenen Praktiken nach Artikel 5 seit dem 2. Februar 2025. Sie unterscheidet verbotene Praktiken, Hochrisiko-Systeme, Systeme mit Transparenzpflichten und KI-Modelle mit allgemeinem Verwendungszweck (GPAI).

Der SWAO-Katalog enthält 37 Controls in vier Teilen. Teil RC (Risikoklassifizierung) entscheidet, welche weiteren Teile gelten: Teil HR gilt, wenn `AIACT_RC_02` ein Hochrisiko-System feststellt, Teil TR gilt ab begrenztem Risiko, und Teil GP gilt, wenn `AIACT_RC_04` ein GPAI-Modell feststellt.

## Wer es in SWAO einsetzt und wann

- Anbieter und Betreiber von KI-Systemen auf dem EU-Markt (Hinweise im Katalog: `ai_system`, `high_risk_ai`, `gpai_provider`, `automated_decisioning`, `eu_market`).
- Jedes Application Assessment, in dem der Workload KI für Entscheidungen über Personen, Chatbots, Emotionserkennung oder generierte Inhalte einsetzt.
- Zusammen mit AI_10_PILLARS (technische Sicherheitsbasis) und GDPR (automatisierte Entscheidungen nach Art. 22).

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
| Nur Code- und Konfigurationssignale (`signal_prefix`, `local_signal_regex`) | 1 |
| Signale und Dokumente kombiniert | 1 |
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 35 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 19 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 0 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `STATE_LOG_ENABLED` | 1 | Nachweisbereich Logging aktiviert; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `STATE_LOG_RETENTION_DAYS` | 1 | Nachweisbereich Aufbewahrung von Logs; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `AIACT_HR_06` Automatic logging and audit trail (`STATE_LOG_ENABLED`)
- `AIACT_HR_07` Log retention period (`STATE_LOG_RETENTION_DAYS`)

Controls, die Dokumente benötigen:

- `AIACT_RC_01` Prohibited AI practices check
- `AIACT_RC_02` High-risk AI system identification

Beispiele für reine Audit-Controls: `AIACT_RC_05`, `AIACT_HR_04`, `AIACT_HR_05`.

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| Part RC: Risk Classification | 5 | `AIACT_RC_01` Prohibited AI practices check; `AIACT_RC_02` High-risk AI system identification |
| Part HR: High-Risk AI Requirements | 18 | `AIACT_HR_01` Risk management system establishment; `AIACT_HR_02` Training data governance: representativeness and bias |
| Part TR: Transparency Obligations | 5 | `AIACT_TR_01` Chatbot AI disclosure to users; `AIACT_TR_02` Emotion recognition system disclosure |
| Part GP: GPAI Model Obligations | 9 | `AIACT_GP_01` GPAI model technical documentation; `AIACT_GP_02` Training data copyright compliance |
| **Summe** | **37** | |

Standard-Schweregrade: critical 1, high 24, medium 12.

## Cross-Mapping

13 von 37 Controls tragen `maps_to`-Verweise auf Controls anderer Rahmenwerke. Die folgende Tabelle zählt die Verweise je Zielrahmenwerk. "Aufgelöst" bedeutet, dass die Ziel-ID als Control in einem mitgelieferten SWAO-Katalog existiert; "nicht aufgelöst" bedeutet, dass der Verweis auf Artikel- oder Klauselebene zielt oder eine ID-Schreibweise verwendet, die kein Katalog enthält.

| Zielrahmenwerk | Aufgelöste Verweise | Nicht aufgelöste Verweise |
|---|---|---|
| `NIS2` | 6 | 0 |
| `GDPR` | 5 | 0 |
| `ISO_27001` | 4 | 0 |
| `EU_CRA` | 2 | 0 |

Zusätzlich nennen die Metadaten (`cross_mapping_hints`) folgende verwandte Rahmenwerke: `GDPR`, `EU_CRA`, `NIS2`, `AI_10_PILLARS`. Diese Liste ist ein Hinweis auf thematische Überschneidung, kein Control-Mapping.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/community-frameworks/eu-ai-act](https://github.com/Accenture/SWAO/tree/main/community-frameworks/eu-ai-act)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Um das Rahmenwerk für ein einzelnes Projekt anzupassen, kopieren Sie den Ordner `eu-ai-act` (mit `framework-meta.yaml` und `controls.yaml`) in den Workspace nach `wsp/inputs/catalogs/community/eu-ai-act/` und bearbeiten Sie dort die Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Stellen Sie sicher, dass der Ordner `eu-ai-act` unter `wsp/inputs/catalogs/community/` im Workspace liegt (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [EU_AI_ACT]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [EU_AI_ACT, GDPR]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "EU_AI_ACT"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

## Grenzen und Hinweise

- Die Risikoklassifizierung selbst ist eine rechtliche Bewertung. SWAO kann Indikatoren aus der Lösungsarchitektur und der Beschreibung des KI-Systems markieren, die endgültige Einstufung obliegt der Rechtsberatung.
- 19 der 37 Controls sind als `aud` gekennzeichnet, darunter Konformitätserklärung, CE-Kennzeichnung, technische Dokumentation und Meldung schwerwiegender Vorfälle.
- Die Bewertung setzt die RC-Steuerung nicht automatisch durch: Alle 37 Controls werden bewertet, und das LLM soll für nicht zutreffende Teile N_A zurückgeben. Prüfen Sie die N_A-Begründungen im Bericht.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer die offizielle Quelle des Herausgebers.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
