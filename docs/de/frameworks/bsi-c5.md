# BSI Kriterienkatalog Cloud Computing C5:2020 (BSI_C5)

Diese Seite beschreibt das Community-Rahmenwerk `BSI_C5`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `BSI_C5` |
| Herausgeber | Bundesamt für Sicherheit in der Informationstechnik (BSI) |
| Version | 2020 |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 1.0.0 |
| Controls gesamt | 62 |
| Bewertungsmodus | `binary` (Standardwert des Schemas; nicht deklariert) |
| Assessment-Typen (Metadaten) | `app`, `aud` |
| Lizenz und Weiterverbreitung | BSI C5:2020 ist unter den Nutzungsbedingungen des BSI frei verfügbar. Die Control-Texte geben die Basiskriterien sinngemäß wieder; zur Prüfung sucht man die zitierte Domäne und das Kriterium in der BSI-Veröffentlichung. Keine Rechtsberatung. |
| Zuletzt geprüft | 2026-07-08 |
| Ordner | `bsi-c5` |

## Worum es geht

C5 (Cloud Computing Compliance Criteria Catalogue) ist der Kriterienkatalog des BSI mit Mindestanforderungen an die sichere Nutzung und den sicheren Betrieb von Cloud-Diensten. Die Revision 2020 definiert Basis- und Zusatzkriterien in 17 Domänen. Laut Katalog-Metadaten ist C5 die verpflichtende Basis für die Cloud-Nutzung im deutschen öffentlichen Sektor und wird für KRITIS-regulierte Sektoren dringend empfohlen. C5 selbst ist ein Kriterienkatalog, gegen den Cloud-Anbieter geprüft werden (C5-Testat), kein Gesetz.

Der SWAO-Katalog umfasst 62 Controls aus den Basiskriterien in 16 Domänen (OIS bis PI). Zusatzkriterien sind nicht enthalten.

## Wer es in SWAO einsetzt und wann

- Migrationen von Workloads des deutschen öffentlichen Sektors in die Cloud sowie Projekte für KRITIS-Betreiber (Hinweise im Katalog: `de_sovereign`, `public_sector`, `cloud`, `kritis`, `german_regulated`, `bsi_c5_attested`).
- Auswahl von Cloud-Anbietern, wenn der Zielanbieter ein C5-Testat vorweisen muss.
- Zusammen mit BSI_GRUNDSCHUTZ_2023 (organisationsweite ISMS-Sicht) und KRITIS_DE (sektorale Pflichten).

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
| Nur Code- und Konfigurationssignale (`signal_prefix`, `local_signal_regex`) | 21 |
| Signale und Dokumente kombiniert | 7 |
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 34 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 0 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 0 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `IAM` | 7 | Nachweisbereich Identität und Zugriff; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `TF` | 7 | [Pass 06 (TF)](/de/passes/06-tf) |
| `OBS` | 7 | Nachweisbereich Beobachtbarkeit, Logging und Monitoring; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `CRYPTO` | 6 | [Pass 08 (CRYPTO)](/de/passes/08-crypto) |
| `DATA` | 4 | [Pass 03 (DATA)](/de/passes/03-data) |
| `SBOM` | 2 | [Pass 05 (SBOM)](/de/passes/05-sbom) |
| `INV` | 1 | [Pass 01 (INV)](/de/passes/01-inv) |
| `EGR` | 1 | [Pass 07 (EGR)](/de/passes/07-egr) |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `BSI_C5_IDM-01` Identity and access management policies (`IAM`)
- `BSI_C5_IDM-02` Multi-factor authentication for privileged access (`IAM`)
- `BSI_C5_IDM-03` Access rights review and recertification (`IAM`)

Controls, die Dokumente benötigen:

- `BSI_C5_OIS-01` Information security policy documented and communicated
- `BSI_C5_OIS-02` Information security roles and responsibilities defined

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

### Souveränitätsanforderungen im Landing-Zone-Assessment

Die Metadaten des Rahmenwerks deklarieren Souveränitätsanforderungen, die das [Landing-Zone-Assessment](/de/assessment/landing-zone) auswertet, wenn BSI_C5 ausgewählt ist: keine Exposition gegenüber `us_cloud_act` und `fisa_702`, Betreiber-Jurisdiktion `EU-entity` und erforderliche Zertifizierung `BSI_C5`. Diese Anforderungen wirken auf die Landing-Zone-Bewertung, unabhängig von der Control-Bewertung.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| OIS: Organisational Information Security | 5 | `BSI_C5_OIS-01` Information security policy documented and communicated; `BSI_C5_OIS-02` Information security roles and responsibilities defined |
| PRY: Physical Security | 4 | `BSI_C5_PRY-01` Physical access control to data centre and server rooms; `BSI_C5_PRY-02` Environmental controls for data centre facilities |
| HRS: Human Resources Security | 4 | `BSI_C5_HRS-01` Background verification for staff in sensitive roles; `BSI_C5_HRS-02` Security awareness training programme |
| IDM: Identity and Access Management | 6 | `BSI_C5_IDM-01` Identity and access management policies; `BSI_C5_IDM-02` Multi-factor authentication for privileged access |
| CRY: Cryptography | 4 | `BSI_C5_CRY-01` Cryptography policies and key management; `BSI_C5_CRY-02` Encryption of data at rest for sensitive and personal data |
| COS: Communication Security | 4 | `BSI_C5_COS-01` Network segmentation and zone architecture; `BSI_C5_COS-02` Firewall management and rule review process |
| OPS: Operations | 6 | `BSI_C5_OPS-01` Change management process for cloud infrastructure; `BSI_C5_OPS-02` Patch and vulnerability management |
| AVL: Availability and Resilience | 4 | `BSI_C5_AVL-01` Business continuity plan covering cloud services; `BSI_C5_AVL-02` Recovery time and recovery point objectives defined and tested |
| DEV: Procurement and Development | 4 | `BSI_C5_DEV-01` Security requirements in software procurement; `BSI_C5_DEV-02` Secure software development lifecycle |
| INM: Incident Management | 4 | `BSI_C5_INM-01` Incident response plan and team defined; `BSI_C5_INM-02` Incident classification and escalation procedure |
| SIM: Security Incident Management | 3 | `BSI_C5_SIM-01` Security event monitoring and alerting; `BSI_C5_SIM-02` Forensic capability and evidence preservation |
| COM: Compliance | 3 | `BSI_C5_COM-01` Legal and regulatory compliance register; `BSI_C5_COM-02` Internal audit programme covering C5 criteria |
| PSS: Portability and Interoperability | 2 | `BSI_C5_PSS-01` Data export capability and format documentation; `BSI_C5_PSS-02` Service termination and data return or deletion |
| BCP: Business Continuity Planning | 2 | `BSI_C5_BCP-01` Crisis communication plan for cloud service disruption; `BSI_C5_BCP-02` Supplier dependency mapping and exit strategy |
| DAT: Data Security | 4 | `BSI_C5_DAT-01` Data security: classification and protection; `BSI_C5_DAT-02` Data residency controls and documentation |
| PI: Personal Information / Privacy | 3 | `BSI_C5_PI-01` Privacy by design in cloud service architecture; `BSI_C5_PI-02` Data subject rights fulfilment process |
| **Summe** | **62** | |

Standard-Schweregrade: critical 4, high 38, medium 20.

## Cross-Mapping

62 von 62 Controls tragen `maps_to`-Verweise auf Controls anderer Rahmenwerke. Die folgende Tabelle zählt die Verweise je Zielrahmenwerk. "Aufgelöst" bedeutet, dass die Ziel-ID als Control in einem mitgelieferten SWAO-Katalog existiert; "nicht aufgelöst" bedeutet, dass der Verweis auf Artikel- oder Klauselebene zielt oder eine ID-Schreibweise verwendet, die kein Katalog enthält.

| Zielrahmenwerk | Aufgelöste Verweise | Nicht aufgelöste Verweise |
|---|---|---|
| `ISO_27001` | 97 | 0 |
| `BSI_GRUNDSCHUTZ_2023` | 44 | 0 |
| `GDPR` | 17 | 0 |

Umgekehrt verweisen Controls dieser Rahmenwerke auf Controls von BSI_C5: `EUCS` (55), `KRITIS_DE` (22).

Zusätzlich nennen die Metadaten (`cross_mapping_hints`) folgende verwandte Rahmenwerke: `BSI_GRUNDSCHUTZ_2023`, `ISO_27001`, `GDPR`, `SOC_2`, `EUCS`, `DORA`. Diese Liste ist ein Hinweis auf thematische Überschneidung, kein Control-Mapping.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-c5](https://github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-c5)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Um das Rahmenwerk für ein einzelnes Projekt anzupassen, kopieren Sie den Ordner `bsi-c5` (mit `framework-meta.yaml` und `controls.yaml`) in den Workspace nach `wsp/inputs/catalogs/community/bsi-c5/` und bearbeiten Sie dort die Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Stellen Sie sicher, dass der Ordner `bsi-c5` unter `wsp/inputs/catalogs/community/` im Workspace liegt (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [BSI_C5]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [BSI_C5, GDPR]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "BSI_C5"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

## Grenzen und Hinweise

- SWAO bewertet einen Workload, nicht einen Cloud-Anbieter. Domänen wie PRY (physische Sicherheit) und HRS (Personal) beschreiben Pflichten des Anbieters oder der Organisation; hier ist SWAO auf von Ihnen bereitgestellte Dokumente oder auf das C5-Testat des Anbieters angewiesen.
- Der Katalog umfasst nur Basiskriterien. Ein offizielles C5-Testat stellt ein Prüfer aus, nicht SWAO.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer die offizielle Quelle des Herausgebers.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
