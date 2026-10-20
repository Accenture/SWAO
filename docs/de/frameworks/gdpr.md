# Datenschutz-Grundverordnung, DSGVO (GDPR)

Diese Seite beschreibt das Community-Rahmenwerk `GDPR`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `GDPR` |
| Herausgeber | Europäisches Parlament und Rat der Europäischen Union (Verordnung (EU) 2016/679) |
| Version | Regulation (EU) 2016/679, in force since 2018-05-25 |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 0.1.0 |
| Controls gesamt | 53 |
| Bewertungsmodus | `binary` (Standardwert des Schemas; nicht deklariert) |
| Assessment-Typen (Metadaten) | `app`, `aud` |
| Lizenz und Weiterverbreitung | Die DSGVO ist EU-Recht, veröffentlicht vom Amt für Veröffentlichungen (EUR-Lex). Die Control-Beschreibungen geben den Artikeltext sinngemäß wieder; maßgeblich ist der EUR-Lex-Text. Keine Rechtsberatung. |
| Zuletzt geprüft | 2026-05-22 |
| Ordner | `gdpr` |

## Worum es geht

Die Datenschutz-Grundverordnung (Verordnung (EU) 2016/679) ist der verbindliche EU-weite Rahmen für die Verarbeitung personenbezogener Daten natürlicher Personen. Sie gilt seit dem 25. Mai 2018 und umfasst 99 Artikel in 11 Kapiteln. Ihr räumlicher Anwendungsbereich (Artikel 3) erstreckt sich auch auf Organisationen außerhalb der EU, die Personen in der EU Waren oder Dienstleistungen anbieten oder ihr Verhalten beobachten.

Der SWAO-Katalog deckt den für Workloads relevanten Umfang ab, die Kapitel II bis V (Grundsätze, Rechte der betroffenen Person, Verantwortlicher und Auftragsverarbeiter, Übermittlungen in Drittländer), mit 53 Controls. Artikel zu Aufsichtsbehörden, zum Europäischen Datenschutzausschuss und Schlussbestimmungen sind ausgeschlossen. Manche Artikel sind in Teil-Controls aufgeteilt, zum Beispiel `GDPR_Art_32_a` bis `GDPR_Art_32_d` für Artikel 32 Abs. 1 lit. a bis d.

## Wer es in SWAO einsetzt und wann

- Praktisch jedes Projekt, in dem der Workload personenbezogene Daten von Personen in der EU verarbeitet (Hinweise im Katalog: `eu_data`, `personal_data`, `consumer_app`, `health_data`, `employee_data`, `cross_border_transfer`, `automated_decisioning`, `profiling`).
- Cloud-Migrationen, bei denen personenbezogene Daten zu Anbietern außerhalb der EU gelangen (Kapitel V).
- Zusammen mit sektoralen Rahmenwerken wie DORA, NIST_SP_800_66R2 (HIPAA) oder BSI_C5.

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
| Nur Code- und Konfigurationssignale (`signal_prefix`, `local_signal_regex`) | 4 |
| Signale und Dokumente kombiniert | 0 |
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 49 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 0 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 0 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `CRYPTO` | 2 | [Pass 08 (CRYPTO)](/de/passes/08-crypto) |
| `IAM` | 1 | Nachweisbereich Identität und Zugriff; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `OBS` | 1 | Nachweisbereich Beobachtbarkeit, Logging und Monitoring; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `GDPR_Art_5_1_f` Integrity and confidentiality (security principle) (Art 5(1)(f)) (`CRYPTO`)
- `GDPR_Art_32_a` Security of processing: pseudonymisation and encryption (Art 32(1)(a)) (`CRYPTO`)
- `GDPR_Art_32_b` Security of processing: ongoing confidentiality, integrity, availability and resilience (Art 32(1)(b)) (`IAM`)

Controls, die Dokumente benötigen:

- `GDPR_Art_5_1_a` Lawfulness, fairness and transparency (Art 5(1)(a))
- `GDPR_Art_5_1_b` Purpose limitation (Art 5(1)(b))

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

### Souveränitätsanforderungen und Tags

Die Metadaten des Rahmenwerks deklarieren Souveränitätsanforderungen, die das [Landing-Zone-Assessment](/de/assessment/landing-zone) auswertet, wenn GDPR ausgewählt ist: Betreiber-Jurisdiktion `EU-entity` und erforderlicher Dienst `key_vault`. Jedes Control trägt zudem Tags auf den Achsen `actor`, `obligation`, `scope` und `applies-to`, die in den Plan und den Bericht übernommen werden.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| Chapter II: Principles | 12 | `GDPR_Art_5_1_a` Lawfulness, fairness and transparency (Art 5(1)(a)); `GDPR_Art_5_1_b` Purpose limitation (Art 5(1)(b)) |
| Chapter III: Data Subject Rights | 12 | `GDPR_Art_12` Transparent information, communication and modalities (Art 12); `GDPR_Art_13` Information to be provided where personal data are collected from the data subject (Art 13) |
| Chapter IV: Controller and Processor | 23 | `GDPR_Art_24` Responsibility of the controller (Art 24); `GDPR_Art_25` Data protection by design and by default (Art 25) |
| Chapter V: Third-Country Transfers | 6 | `GDPR_Art_44` General principle for transfers (Art 44); `GDPR_Art_45` Transfers on the basis of an adequacy decision (Art 45) |
| **Summe** | **53** | |

Standard-Schweregrade: critical 24, high 25, medium 2, low 2.

## Cross-Mapping

40 von 53 Controls tragen `maps_to`-Verweise auf Controls anderer Rahmenwerke. Die folgende Tabelle zählt die Verweise je Zielrahmenwerk. "Aufgelöst" bedeutet, dass die Ziel-ID als Control in einem mitgelieferten SWAO-Katalog existiert; "nicht aufgelöst" bedeutet, dass der Verweis auf Artikel- oder Klauselebene zielt oder eine ID-Schreibweise verwendet, die kein Katalog enthält.

| Zielrahmenwerk | Aufgelöste Verweise | Nicht aufgelöste Verweise |
|---|---|---|
| `ISO_27001` | 43 | 0 |
| `SOC_2` | 17 | 0 |
| `AI_10_PILLARS` | 12 | 0 |
| `ISO_42001` | 0 | 4 |
| `HIPAA` | 0 | 4 |
| `COPPA` | 0 | 1 |
| `NIST_SP_800_66R2` | 1 | 0 |
| `PCI_DSS` | 1 | 0 |

Beispiele nicht aufgelöster Verweise: `HIPAA`: `HIPAA_164.502`, `HIPAA_164.504`, `HIPAA_164.514`; `COPPA`: `COPPA_312`; `ISO_42001`: `ISO_42001_A.5.4`, `ISO_42001_A.6.2`, `ISO_42001_A.6.3`.

Umgekehrt verweisen Controls dieser Rahmenwerke auf Controls von GDPR: `BSI_GRUNDSCHUTZ_2023` (57), `BSI_C5` (17), `SOC_2` (17), `SECNUMCLOUD` (9), `EC_CSF` (8), `EU_AI_ACT` (5), `ISO_27001` (2), `COBIT_5` (1).

Zusätzlich nennen die Metadaten (`cross_mapping_hints`) folgende verwandte Rahmenwerke: `ISO_27001`, `SOC_2`, `HIPAA`, `PCI_DSS`, `BSI_C5`, `DORA`, `AI_10_PILLARS`, `GARTNER_APP_VENUE_2026`, `EU_AI_ACT`, `NIS2_2022_2555`, `EPRIVACY_2002_58`, `ISO_42001`, `EDPB_GUIDELINES`. Diese Liste ist ein Hinweis auf thematische Überschneidung, kein Control-Mapping.

## Demo-Variante

| Eigenschaft | Wert |
|---|---|
| Framework-ID | `GDPR_DEMO` |
| Ordner | `gdpr-demo` |
| Controls | 11 |
| Katalogversion | 1.1.0 |
| Zuletzt geprüft | 2026-07-07 |
| In neuen Workspaces vorinstalliert | Ja (`swao init`) |

Die Demo-Variante ist eine verkleinerte Auswahl für Live-Präsentationen mit der Demo-Anwendung Sovereign Health. Sie enthält zentrale Artikel wie Art. 5 Abs. 1 lit. a, c und f, Art. 6, 9, 17, 22, 25, 28, 32 Abs. 1 lit. a und 44 mit dem Präfix `GDPR_DEMO.` (zum Beispiel `GDPR_DEMO.ART32_A`) und übernimmt die Querverweise des vollständigen Katalogs. Laut Metadaten ist sie auf den Assessment-Typ `app` beschränkt.

Die Demo-Variante ist für Workshops, Schulungen und Präsentationen gedacht, bei denen ein kurzer Bericht wichtiger ist als vollständige Abdeckung. Aktivieren Sie sie mit ihrer eigenen ID, zum Beispiel `regimes_active: [GDPR_DEMO]`.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/community-frameworks/gdpr](https://github.com/Accenture/SWAO/tree/main/community-frameworks/gdpr)
- Demo-Variante: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/gdpr-demo](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/gdpr-demo)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Um das Rahmenwerk für ein einzelnes Projekt anzupassen, kopieren Sie den Ordner `gdpr` (mit `framework-meta.yaml` und `controls.yaml`) in den Workspace nach `wsp/inputs/catalogs/community/gdpr/` und bearbeiten Sie dort die Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Stellen Sie sicher, dass der Ordner `gdpr` unter `wsp/inputs/catalogs/community/` im Workspace liegt (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [GDPR]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [GDPR, BSI_C5]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "GDPR"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

## Grenzen und Hinweise

- Rechtsgrundlage, Einwilligung, Zweckbindung und Garantien für Drittlandübermittlungen sind Rechtsfragen. 49 der 53 Controls stützen sich auf Dokumente oder manuelle Fragebögen (zum Beispiel `evidence/02-art-6-lawful-basis.md` oder `evidence/03-art-17-erasure-questionnaire.yaml`).
- SWAO führt keine Datenschutz-Folgenabschätzung (DSFA) durch. Es kann nur zeigen, ob eine dokumentiert ist (`GDPR_Art_35_a` bis `GDPR_Art_35_c`).
- Nationale ergänzende Datenschutzgesetze sind nicht modelliert.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer die offizielle Quelle des Herausgebers.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
