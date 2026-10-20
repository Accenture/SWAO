# COBIT 5: Governance und Management der Unternehmens-IT (COBIT_5)

Diese Seite beschreibt das Community-Rahmenwerk `COBIT_5`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `COBIT_5` |
| Herausgeber | ISACA (Information Systems Audit and Control Association) |
| Version | 2012 (ISBN 978-1-60420-237-3) |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 0.2.0 |
| Controls gesamt | 37 |
| Bewertungsmodus | `binary` (deklariert) |
| Assessment-Typen (Metadaten) | `app`, `aud` |
| Lizenz und Weiterverbreitung | Die Control-Beschreibungen, Prüfhinweise und Maßnahmentexte sind eigene SWAO-Formulierungen, weder kopiert noch aus ISACA-Material abgeleitet. Prozess-IDs und Prozessnamen sind die COBIT-5-Bezeichner und werden als sachliche Referenz verwendet. Referenzpublikation: ISACA, COBIT 5: A Business Framework for the Governance and Management of Enterprise IT (2012, ISBN 978-1-60420-237-3). COBIT ist eine eingetragene Marke von ISACA. |
| Zuletzt geprüft | 2026-10-17 |
| Ordner | `cobit-5` |

## Worum es geht

COBIT 5 ist das 2012 veröffentlichte Rahmenwerk von ISACA für Governance und Management der Unternehmens-IT (GEIT). Es definiert fünf Domänen mit 37 Prozessen sowie sieben Enabler, die quer zu den Domänen liegen. Es ist ein freiwilliges Good-Practice-Rahmenwerk, das von Interner Revision und IT-Governance-Funktionen breit genutzt wird, kein Gesetz.

Der SWAO-Katalog bildet jeden der 37 Prozesse als ein Control ab, gruppiert nach den fünf Domänen (EDM, APO, BAI, DSS, MEA). Die sieben Enabler sind nicht als eigene Achse modelliert.

## Wer es in SWAO einsetzt und wann

- Projekte, in denen der Kunde IT-Prüfungspflichten, einer IT-Governance-Prüfung auf Vorstandsebene oder einer regulatorischen Abstimmung über mehrere Rahmenwerke unterliegt (Hinweise im Katalog: `it_governance`, `enterprise_it_management`, `audit_assurance`, `risk_management`, `service_management`, `regulatory_alignment`).
- Als Governance-Overlay neben einem Sicherheitsrahmenwerk wie ISO_27001 oder einer Regulierung wie DORA.

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
| Nur Code- und Konfigurationssignale (`signal_prefix`, `local_signal_regex`) | 10 |
| Signale und Dokumente kombiniert | 0 |
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 27 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 0 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 0 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `OBS` | 5 | Nachweisbereich Beobachtbarkeit, Logging und Monitoring; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `IAM` | 2 | Nachweisbereich Identität und Zugriff; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `CRYPTO` | 2 | [Pass 08 (CRYPTO)](/de/passes/08-crypto) |
| `EGR` | 2 | [Pass 07 (EGR)](/de/passes/07-egr) |
| `QA` | 1 | Nachweisbereich Qualitätssicherung; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `INV` | 1 | [Pass 01 (INV)](/de/passes/01-inv) |
| `DR` | 1 | Nachweisbereich Notfallwiederherstellung; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `APO11` Manage Quality (`QA`)
- `APO13` Manage Security (`IAM`, `CRYPTO`, `OBS`, `EGR`)
- `BAI03` Manage Solutions Identification and Build (`.github/workflows/**/*.{yml,yaml}::(?i)(build|deploy|release)`)

Controls, die Dokumente benötigen:

- `EDM01` Ensure Governance Framework Setting and Maintenance
- `EDM02` Ensure Benefits Delivery

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

### Reifegradskala

Die Metadaten des Rahmenwerks beschreiben, wie die Prozessfähigkeitsstufen von COBIT 5 (ISO/IEC 15504) den SWAO-Ergebnissen entsprechen: Stufe 0 (unvollständig) entspricht GAP, Stufe 1 (durchgeführt) PARTIAL, Stufen 2 bis 5 SATISFIED und "Not Applicable" N_A. Im aktuellen Release dient diese Zuordnung als Dokumentation für die Prüfenden; der Compliance-Pass liest sie nicht aus.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| Evaluate Direct and Monitor | 5 | `EDM01` Ensure Governance Framework Setting and Maintenance; `EDM02` Ensure Benefits Delivery |
| Align Plan and Organise | 13 | `APO01` Manage the IT Management Framework; `APO02` Manage Strategy |
| Build Acquire and Implement | 10 | `BAI01` Manage Programmes and Projects; `BAI02` Manage Requirements Definition |
| Deliver Service and Support | 6 | `DSS01` Manage Operations; `DSS02` Manage Service Requests and Incidents |
| Monitor Evaluate and Assess | 3 | `MEA01` Monitor Evaluate and Assess Performance and Conformance; `MEA02` Monitor Evaluate and Assess the System of Internal Control |
| **Summe** | **37** | |

Standard-Schweregrade: critical 2, high 9, medium 22, low 4.

## Cross-Mapping

26 von 37 Controls tragen `maps_to`-Verweise auf Controls anderer Rahmenwerke. Die folgende Tabelle zählt die Verweise je Zielrahmenwerk. "Aufgelöst" bedeutet, dass die Ziel-ID als Control in einem mitgelieferten SWAO-Katalog existiert; "nicht aufgelöst" bedeutet, dass der Verweis auf Artikel- oder Klauselebene zielt oder eine ID-Schreibweise verwendet, die kein Katalog enthält.

| Zielrahmenwerk | Aufgelöste Verweise | Nicht aufgelöste Verweise |
|---|---|---|
| `SOC_2` | 29 | 0 |
| `ISO_27001` | 21 | 0 |
| `DORA` | 2 | 0 |
| `GDPR` | 1 | 0 |

Umgekehrt verweisen Controls dieser Rahmenwerke auf Controls von COBIT_5: `SAMA_CSF` (16).

Zusätzlich nennen die Metadaten (`cross_mapping_hints`) folgende verwandte Rahmenwerke: `ISO_27001`, `SOC_2`, `GDPR`, `DORA`, `ISO_20000`, `ISO_38500`, `ISO_31000`, `ITIL_V3`, `TOGAF`, `PRINCE2`, `CMMI`, `NIST_CSF`. Diese Liste ist ein Hinweis auf thematische Überschneidung, kein Control-Mapping.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/cobit-5](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/cobit-5)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

COBIT_5 wird wieder mit SWAO ausgeliefert. Die Control-Texte wurden in eigenen SWAO-Formulierungen neu geschrieben; der Katalog ist damit wieder Teil der Binaries und der öffentlichen Quellen. Prozess-IDs und Prozessnamen bleiben die COBIT-5-Bezeichner; die ISACA-Publikation ist als Referenz angegeben.

`swao framework list` führt COBIT_5 auf, und `swao framework install COBIT_5` kopiert den Ordner `cobit-5` (mit `framework-meta.yaml`, `controls.yaml` und `evidence/`) in den Workspace nach `wsp/inputs/catalogs/community/cobit-5/`. Sie können den Ordner auch von Hand kopieren. Um das Rahmenwerk für ein einzelnes Projekt anzupassen, bearbeiten Sie die Workspace-Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Kopieren Sie den Ordner `cobit-5` nach `wsp/inputs/catalogs/community/cobit-5/` im Workspace, mit `swao framework install COBIT_5` oder von Hand (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [COBIT_5]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [COBIT_5, GDPR]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "COBIT_5"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

## Grenzen und Hinweise

- Der SWAO-Katalog bildet COBIT 5 (2012) ab. Arbeitet der Kunde mit einer späteren COBIT-Ausgabe, prüfen Sie die Prozesszuordnung manuell.
- 27 der 37 Prozesse hängen von Governance-Dokumenten (zum Beispiel `evidence/edm-01-governance-framework.md`) oder manuellen Fragebögen ab. Bis diese Dokumente vorliegen, ist UNKNOWN zu erwarten.
- Neue Workspaces werden nicht mit COBIT_5 befüllt. Kopieren Sie es mit `swao framework install COBIT_5` in den Workspace (siehe oben).
- SWAO kann Prozessfähigkeitsstufen nicht so bewerten wie ein COBIT-Assessor.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind eigene SWAO-Beschreibungen des jeweiligen Prozesses und der Nachweise, auf die eine prüfende Person achten würde; sie geben die COBIT-5-Publikation nicht wieder. Maßgeblich ist immer das offizielle Material von ISACA.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
