# Cloud-Souveränitätsrahmen der Europäischen Kommission v1.2.1 (EC_CSF)

Diese Seite beschreibt das Community-Rahmenwerk `EC_CSF`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `EC_CSF` |
| Herausgeber | Europäische Kommission, Generaldirektion Informatik (DIGIT) |
| Version | 1.2.1 |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 1.0.0 |
| Controls gesamt | 34 |
| Bewertungsmodus | `binary` (deklariert) |
| Assessment-Typen (Metadaten) | `lz`, `aud` |
| Lizenz und Weiterverbreitung | Von der Europäischen Kommission nach ihrer Weiterverwendungspolitik für Veröffentlichungen der EU-Institutionen herausgegeben. Die Control-Beschreibungen geben die Souveränitätsziele sinngemäß wieder und sind weder Rechtsberatung noch Beschaffungsleitfaden. |
| Zuletzt geprüft | 2026-09-22 |
| Ordner | `ec-csf` |

## Worum es geht

Der Cloud Sovereignty Framework (CSF) v1.2.1 ist ein Rahmenwerk der Europäischen Kommission zur Bewertung der Souveränität von Cloud-Diensten, die von EU-Institutionen genutzt werden. Laut Katalog-Metadaten wurde er im Oktober 2025 veröffentlicht, definiert acht Souveränitätsziele (SOV-1 bis SOV-8), bewertet sie auf einer fünfstufigen Reifegradskala von SEAL-0 bis SEAL-4 (Sovereignty Effectiveness Assurance Level) und kam in einer im April 2026 vergebenen Cloud-Beschaffung der EU-Institutionen zum Einsatz. Er ist ein Beschaffungs- und Bewertungsrahmen, keine Verordnung.

Der SWAO-Katalog enthält 34 Controls in den acht SOV-Domänen. Er wird als Ergänzung zu SECNUMCLOUD beschrieben.

## Wer es in SWAO einsetzt und wann

- Cloud-Anbieter und Integratoren, die sich an Beschaffungen von EU-Institutionen oder des öffentlichen Sektors beteiligen (Hinweise im Katalog: `sovereign_cloud`, `eu_institutional`, `cloud_service_provider`, `eu_procurement`, `digital_sovereignty`).
- Souveränitätsprogramme, die Landing Zones nach strategischen, rechtlichen, datenbezogenen, betrieblichen, lieferketten-, technologie-, sicherheits- und umweltbezogenen Kriterien vergleichen müssen.
- Die Metadaten deklarieren die Assessment-Typen `lz` und `aud`; das Rahmenwerk zielt auf Landing Zones und Anbieter, nicht auf einzelnen Anwendungscode.

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
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 32 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 22 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 0 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `ENCRYPT_AT_REST` | 2 | Nachweisbereich Verschlüsselung ruhender Daten; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `ENCRYPT_IN_TRANSIT` | 1 | Nachweisbereich Verschlüsselung bei der Übertragung; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `ECCSF_SOV3_02` Encryption with customer-controlled keys (`ENCRYPT_AT_REST`)
- `ECCSF_SOV7_05` Encryption sovereignty: ANSSI or equivalent approved algorithms (`ENCRYPT_AT_REST`, `ENCRYPT_IN_TRANSIT`)

Controls, die Dokumente benötigen:

- `ECCSF_SOV1_01` Cloud strategy and vendor independence policy
- `ECCSF_SOV1_02` Provider concentration limit

Beispiele für reine Audit-Controls: `ECCSF_SOV1_03`, `ECCSF_SOV1_04`, `ECCSF_SOV2_01`.

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

### Wo EC_CSF bewertet wird

Da der Geltungsbereich `lz` und `aud` lautet, bietet die Regime-Auswahl des Application Assessments EC_CSF nicht an (sie zeigt nur Rahmenwerke, deren Geltungsbereich `app` enthält). Das [Landing-Zone-Assessment](/de/assessment/landing-zone) liest nur den Block `sovereignty_requirements` eines gewählten Rahmenwerks, und EC_CSF deklariert keinen. Tragen Sie `EC_CSF` von Hand in `assessment.regimes_active` einer App ein, würde Pass 11 die 34 Controls wie jedes andere gelistete Rahmenwerk bewerten, sobald der Katalog geladen werden kann; im aktuellen Release ist das nicht der Fall (siehe Grenzen und Hinweise). Die meisten Ergebnisse hängen von Dokumenten ab.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| SOV-1: Strategic Sovereignty | 4 | `ECCSF_SOV1_01` Cloud strategy and vendor independence policy; `ECCSF_SOV1_02` Provider concentration limit |
| SOV-2: Legal Sovereignty | 4 | `ECCSF_SOV2_01` EU legal jurisdiction for data processing; `ECCSF_SOV2_02` Extraterritorial law immunity assessment |
| SOV-3: Data Sovereignty | 5 | `ECCSF_SOV3_01` EU data residency enforcement; `ECCSF_SOV3_02` Encryption with customer-controlled keys |
| SOV-4: Operational Sovereignty | 4 | `ECCSF_SOV4_01` EU-based operational support staff; `ECCSF_SOV4_02` Operational continuity without parent company dependency |
| SOV-5: Supply Chain Sovereignty | 4 | `ECCSF_SOV5_01` Supply chain risk assessment; `ECCSF_SOV5_02` Software bill of materials and dependency transparency |
| SOV-6: Technology Sovereignty | 4 | `ECCSF_SOV6_01` Open standards adoption for critical interfaces; `ECCSF_SOV6_02` Proprietary lock-in avoidance assessment |
| SOV-7: Security Sovereignty | 5 | `ECCSF_SOV7_01` Security certification and continuous assurance; `ECCSF_SOV7_02` Penetration testing by EU-based assessors |
| SOV-8: Environmental Sovereignty | 4 | `ECCSF_SOV8_01` Energy efficiency target and PUE reporting; `ECCSF_SOV8_02` Renewable energy commitment |
| **Summe** | **34** | |

Standard-Schweregrade: high 21, medium 13.

## Cross-Mapping

27 von 34 Controls tragen `maps_to`-Verweise auf Controls anderer Rahmenwerke. Die folgende Tabelle zählt die Verweise je Zielrahmenwerk. "Aufgelöst" bedeutet, dass die Ziel-ID als Control in einem mitgelieferten SWAO-Katalog existiert; "nicht aufgelöst" bedeutet, dass der Verweis auf Artikel- oder Klauselebene zielt oder eine ID-Schreibweise verwendet, die kein Katalog enthält.

| Zielrahmenwerk | Aufgelöste Verweise | Nicht aufgelöste Verweise |
|---|---|---|
| `SECNUMCLOUD` | 27 | 0 |
| `GDPR` | 8 | 0 |
| `NIS2` | 3 | 0 |
| `ISO_27001` | 1 | 0 |

Zusätzlich nennen die Metadaten (`cross_mapping_hints`) folgende verwandte Rahmenwerke: `SECNUMCLOUD`, `EUCS`, `ISO_27001`, `GDPR`, `NIS2`. Diese Liste ist ein Hinweis auf thematische Überschneidung, kein Control-Mapping.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/community-frameworks/ec-csf](https://github.com/Accenture/SWAO/tree/main/community-frameworks/ec-csf)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Um das Rahmenwerk für ein einzelnes Projekt anzupassen, kopieren Sie den Ordner `ec-csf` (mit `framework-meta.yaml` und `controls.yaml`) in den Workspace nach `wsp/inputs/catalogs/community/ec-csf/` und bearbeiten Sie dort die Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Stellen Sie sicher, dass der Ordner `ec-csf` unter `wsp/inputs/catalogs/community/` im Workspace liegt (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [EC_CSF]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [EC_CSF, GDPR]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "EC_CSF"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

Hinweis: Im aktuellen Release lädt der EC_CSF-Katalog nicht (siehe Grenzen und Hinweise); die Schritte gelten, sobald der Katalog korrigiert ist.

## Grenzen und Hinweise

- SWAO berechnet keine SEAL-Stufen. Die Ergebnisse lauten je Control SATISFIED, PARTIAL, GAP, UNKNOWN oder N_A.
- 22 der 34 Controls sind als `aud` gekennzeichnet (zum Beispiel rechtliche Jurisdiktion, Immunität gegenüber extraterritorialem Recht, Bekenntnis zu erneuerbarer Energie); sie erfordern Anbieterdokumentation oder einen akkreditierten Assessor.
- Zwei Controls (`ECCSF_SOV3_02`, `ECCSF_SOV7_05`) verwenden den Nachweisschlüssel `signal:`, den das SWAO-Katalogschema nicht akzeptiert. Im aktuellen Release schlägt die Schemaprüfung des Katalogs beim Laden deshalb fehl, und Pass 11 meldet, dass kein Katalog gefunden wurde. Betrachten Sie EC_CSF-Ergebnisse als nicht verfügbar, bis der Katalog korrigiert ist.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer die offizielle Quelle des Herausgebers.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
