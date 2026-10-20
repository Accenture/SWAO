# BSI IT-Grundschutz-Kompendium, Edition 2023 (BSI_GRUNDSCHUTZ_2023)

Diese Seite beschreibt das Community-Rahmenwerk `BSI_GRUNDSCHUTZ_2023`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `BSI_GRUNDSCHUTZ_2023` |
| Herausgeber | Bundesamt für Sicherheit in der Informationstechnik (BSI) |
| Version | Edition 2023 (published January 2023) |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 0.2.0 |
| Controls gesamt | 105 |
| Bewertungsmodus | `binary` (Standardwert des Schemas; nicht deklariert) |
| Assessment-Typen (Metadaten) | `app`, `aud` |
| Lizenz und Weiterverbreitung | IT-Grundschutz ist beim BSI unter dessen Standard-Nutzungsbedingungen frei verfügbar. Die Control-Texte geben die Anforderungen der Edition 2023 sinngemäß wieder; zur Prüfung sucht man den zitierten Baustein und die Anforderungs-ID im Kompendium. Keine Rechtsberatung. |
| Zuletzt geprüft | 2026-07-07 |
| Ordner | `bsi-grundschutz-2023` |

## Worum es geht

Das IT-Grundschutz-Kompendium ist die Methodik des BSI zum Aufbau, zur Umsetzung und zur kontinuierlichen Verbesserung der Informationssicherheit auf Grundlage der BSI-Standards 200-1 bis 200-3. Die Edition 2023 gliedert 111 Bausteine in 10 Schichten: ISMS, ORP, CON, OPS, DER, APP, SYS, IND, NET und INF.

Der SWAO-Katalog deckt den für Workloads relevanten Umfang ab: 105 Anforderungen aus 27 Bausteinen der Schichten ISMS, ORP, CON, OPS, DER, APP, SYS und NET. Er enthält 72 Basis-Anforderungen (B), abgebildet auf den Schweregrad `high`, und 33 Standard-Anforderungen (S), abgebildet auf `medium`. Anforderungen für hohen Schutzbedarf (H) sind ausgeschlossen und erfordern eine Expertenprüfung.

## Wer es in SWAO einsetzt und wann

- Deutsche öffentliche Verwaltung, regulierte Branchen und kritische Infrastrukturen (Hinweise im Katalog u. a. `german_public_sector`, `regulated_industry`, `critical_infrastructure`, `sovereign_cloud`, `bsi_certified`).
- Projekte, in denen der Kunde ein ISMS nach BSI-Standard 200-2 betreibt und nachweisen muss, dass der migrierte Workload weiterhin dazu passt.
- Cloud- und On-Premises-Workloads gleichermaßen (Hinweise `cloud_workload`, `on_premise`).

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
| Nur Code- und Konfigurationssignale (`signal_prefix`, `local_signal_regex`) | 43 |
| Signale und Dokumente kombiniert | 0 |
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 62 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 0 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 0 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `CRYPTO` | 10 | [Pass 08 (CRYPTO)](/de/passes/08-crypto) |
| `OBS` | 10 | Nachweisbereich Beobachtbarkeit, Logging und Monitoring; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `IAM` | 7 | Nachweisbereich Identität und Zugriff; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `SBOM` | 7 | [Pass 05 (SBOM)](/de/passes/05-sbom) |
| `EGR` | 5 | [Pass 07 (EGR)](/de/passes/07-egr) |
| `DATA` | 4 | [Pass 03 (DATA)](/de/passes/03-data) |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `BSI_ORP4_A2` User account and authorisation management (ORP.4.A2) (`IAM`)
- `BSI_CON1_A1` Definition of cryptographic requirements (CON.1.A1) (`CRYPTO`)
- `BSI_CON1_A2` Cryptographic key management (CON.1.A2) (`CRYPTO`)

Controls, die Dokumente benötigen:

- `BSI_ISMS1_A1` Management responsibility for information security (ISMS.1.A1)
- `BSI_ISMS1_A3` Information security policy (ISMS.1.A3)

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| ISMS: Security Management | 8 | `BSI_ISMS1_A1` Management responsibility for information security (ISMS.1.A1); `BSI_ISMS1_A3` Information security policy (ISMS.1.A3) |
| ORP: Organisation and Personnel | 13 | `BSI_ORP1_A1` Roles and responsibilities for information security (ORP.1.A1); `BSI_ORP1_A2` Assignment of tasks and authorisations (ORP.1.A2) |
| CON: Concepts and Procedures | 16 | `BSI_CON1_A1` Definition of cryptographic requirements (CON.1.A1); `BSI_CON1_A2` Cryptographic key management (CON.1.A2) |
| OPS: Operations | 18 | `BSI_OPS112_A1` Change management concept (OPS.1.1.2.A1); `BSI_OPS112_A2` Maintaining operations during changes (OPS.1.1.2.A2) |
| DER: Detection and Response | 15 | `BSI_DER1_A1` Detection concept (DER.1.A1); `BSI_DER1_A2` Central logging (DER.1.A2) |
| APP: Applications | 14 | `BSI_APP31_A1` Authentication for web applications and services (APP.3.1.A1); `BSI_APP31_A2` Access control for web applications (APP.3.1.A2) |
| SYS: IT Systems | 10 | `BSI_SYS11_A1` Physical and logical access restrictions for servers (SYS.1.1.A1); `BSI_SYS11_A2` Minimal server configuration (SYS.1.1.A2) |
| NET: Networks and Communication | 11 | `BSI_NET11_A1` Network architecture requirements (NET.1.1.A1); `BSI_NET11_A2` Network segmentation (NET.1.1.A2) |
| **Summe** | **105** | |

Standard-Schweregrade: high 72, medium 33.

## Cross-Mapping

105 von 105 Controls tragen `maps_to`-Verweise auf Controls anderer Rahmenwerke. Die folgende Tabelle zählt die Verweise je Zielrahmenwerk. "Aufgelöst" bedeutet, dass die Ziel-ID als Control in einem mitgelieferten SWAO-Katalog existiert; "nicht aufgelöst" bedeutet, dass der Verweis auf Artikel- oder Klauselebene zielt oder eine ID-Schreibweise verwendet, die kein Katalog enthält.

| Zielrahmenwerk | Aufgelöste Verweise | Nicht aufgelöste Verweise |
|---|---|---|
| `ISO_27001` | 144 | 0 |
| `GDPR` | 57 | 0 |

Umgekehrt verweisen Controls dieser Rahmenwerke auf Controls von BSI_GRUNDSCHUTZ_2023: `BSI_C5` (44), `ISO_27001` (3).

Zusätzlich nennen die Metadaten (`cross_mapping_hints`) folgende verwandte Rahmenwerke: `GDPR`, `ISO_27001`, `BSI_C5`, `DORA`, `SOC_2`, `CIS_CONTROLS_V8`, `NIST_CSF_2`, `PCI_DSS_4_0_1`. Diese Liste ist ein Hinweis auf thematische Überschneidung, kein Control-Mapping.

## Demo-Variante

| Eigenschaft | Wert |
|---|---|
| Framework-ID | `BSI_GRUNDSCHUTZ_2023_DEMO` |
| Ordner | `bsi-grundschutz-2023-demo` |
| Controls | 11 |
| Katalogversion | 1.0.0 |
| Zuletzt geprüft | 2026-07-07 |
| In neuen Workspaces vorinstalliert | Ja (`swao init`) |

Die Demo-Variante ist eine verkleinerte Auswahl für Live-Präsentationen mit der Demo-Anwendung Sovereign Health. Sie enthält eine oder zwei Anforderungen aus acht Schichten (zum Beispiel `BSI_GS_DEMO.ISMS1_A1`, `BSI_GS_DEMO.ORP4_A1`, `BSI_GS_DEMO.NET11_A1`) und ist auf Querbezüge zu den Demo-Rahmenwerken für GDPR, AI 10 Pillars und HIPAA ausgelegt. Laut Metadaten ist sie auf den Assessment-Typ `app` beschränkt.

Die Demo-Variante ist für Workshops, Schulungen und Präsentationen gedacht, bei denen ein kurzer Bericht wichtiger ist als vollständige Abdeckung. Aktivieren Sie sie mit ihrer eigenen ID, zum Beispiel `regimes_active: [BSI_GRUNDSCHUTZ_2023_DEMO]`.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-grundschutz-2023](https://github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-grundschutz-2023)
- Demo-Variante: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/bsi-grundschutz-2023-demo](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/bsi-grundschutz-2023-demo)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Um das Rahmenwerk für ein einzelnes Projekt anzupassen, kopieren Sie den Ordner `bsi-grundschutz-2023` (mit `framework-meta.yaml` und `controls.yaml`) in den Workspace nach `wsp/inputs/catalogs/community/bsi-grundschutz-2023/` und bearbeiten Sie dort die Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Stellen Sie sicher, dass der Ordner `bsi-grundschutz-2023` unter `wsp/inputs/catalogs/community/` im Workspace liegt (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [BSI_GRUNDSCHUTZ_2023]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [BSI_GRUNDSCHUTZ_2023, GDPR]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "BSI_GRUNDSCHUTZ_2023"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

## Grenzen und Hinweise

- Nur 8 der 10 Schichten und 27 Bausteine sind enthalten; IND (industrielle IT) und INF (Infrastruktur, Gebäude) sowie alle H-Anforderungen liegen außerhalb des Umfangs.
- Die Anwendung der BSI-Methodik auf den Informationsverbund des Kunden bleibt Aufgabe des Kunden oder Prüfers. SWAO-Ergebnisse unterstützen diese Arbeit, ersetzen sie aber nicht.
- 62 der 105 Anforderungen hängen von Dokumenten (zum Beispiel `evidence/isms1-a1-management-responsibility.md`) oder von einem manuellen Fragebogen ab.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer die offizielle Quelle des Herausgebers.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
