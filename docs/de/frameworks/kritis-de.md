# KRITIS-DE: IT-Sicherheit Kritischer Infrastrukturen in Deutschland (KRITIS_DE)

Diese Seite beschreibt das Community-Rahmenwerk `KRITIS_DE`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `KRITIS_DE` |
| Herausgeber | Bundesamt für Sicherheit in der Informationstechnik (BSI); Bundesnetzagentur (BNetzA) für Energie und Wasser |
| Version | 2024 |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 1.0.0 |
| Controls gesamt | 40 |
| Bewertungsmodus | `binary` (deklariert) |
| Assessment-Typen (Metadaten) | `app`, `aud` |
| Lizenz und Weiterverbreitung | Die Controls sind aus öffentlich verfügbaren Leitfäden des BSI und der Sektorbehörden zusammengestellt, die unter offenen Inhaltsbedingungen der Bundesverwaltung veröffentlicht sind. Keine Rechtsberatung; Betreiber müssen für ihre Nachweise nach §8a eine vom BSI anerkannte prüfende Stelle hinzuziehen. |
| Zuletzt geprüft | 2026-09-21 |
| Ordner | `kritis-de` |

## Worum es geht

KRITIS-DE bündelt die IT-Sicherheitspflichten von Betreibern Kritischer Infrastrukturen in Deutschland nach §8a und §8b BSI-Gesetz (BSIG) in der Fassung des IT-Sicherheitsgesetzes 2.0 (2021). Betreiber müssen angemessene Sicherheitsmaßnahmen nach dem Stand der Technik umsetzen, sie dem BSI alle zwei Jahre nachweisen und erhebliche Störungen melden. Die Schwellenwerte je Sektor legt die BSI-KritisV fest.

KRITIS-DE ist kein offizieller BSI-Katalog. Der SWAO-Katalog fasst 40 Controls in sieben Domänen zusammen, abgeleitet aus der Orientierungshilfe des BSI zu Nachweisen nach §8a, branchenspezifischen IT-Sicherheitskatalogen und dem im Katalog referenzierten KRITIS-Dachgesetz (KRITIS-DachG).

## Wer es in SWAO einsetzt und wann

- Betreiber Kritischer Infrastrukturen in Deutschland und deren IT-Dienstleister (Hinweise im Katalog: `de_kritis`, `german_critical_infrastructure`, `energy_sector`, `water_sector`, `health_sector`, `transport_sector`, `finance_kritis`, `ict_kritis`, `de_sovereign`).
- Cloud-Migrationen von KRITIS-Systemen, zusammen mit BSI_C5 für die Anbieterseite.
- KRITIS-Betreiber des Finanzsektors mit Doppelpflicht nach DORA (siehe `KRITIS_DE_SEC_FIN`).

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
| Nur Code- und Konfigurationssignale (`signal_prefix`, `local_signal_regex`) | 7 |
| Signale und Dokumente kombiniert | 4 |
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 29 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 16 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 1 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `IAM` | 5 | Nachweisbereich Identität und Zugriff; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `EGR` | 3 | [Pass 07 (EGR)](/de/passes/07-egr) |
| `TF` | 2 | [Pass 06 (TF)](/de/passes/06-tf) |
| `OBS` | 2 | Nachweisbereich Beobachtbarkeit, Logging und Monitoring; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `SBOM` | 1 | [Pass 05 (SBOM)](/de/passes/05-sbom) |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `KRITIS_DE_AST_2` Network perimeter documentation and segmentation (`EGR`, `TF`)
- `KRITIS_DE_AST_3` IT/OT boundary management (`EGR`)
- `KRITIS_DE_AST_4` Software inventory and patch lifecycle management (`TF`)

Controls, die Dokumente benötigen:

- `KRITIS_DE_GOV_1` Management accountability for KRITIS IT security
- `KRITIS_DE_GOV_2` Biennial §8a security audit and BSI reporting

Beispiele für reine Audit-Controls: `KRITIS_DE_GOV_1`, `KRITIS_DE_GOV_2`, `KRITIS_DE_GOV_3`.

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

### Bedingte und geerbte Controls

- `KRITIS_DE_AST_3` (Management der IT/OT-Grenze) deklariert `applies_when: has_ot_systems: "true"`. Pass 11 gleicht `applies_when` vor jedem LLM-Aufruf mit dem Block `framework_context` in der `.swao.yml` der App ab; fehlt der Wert oder weicht er ab, ist das Control N/A (nicht zutreffend), wird als "Nicht zutreffend" angezeigt und weder als Nicht bestanden noch im Compliance-Score gezählt:

  ```yaml
  framework_context:
    has_ot_systems: "true"
    kritis_sector: health   # energy, water, health, finance, transport oder ict
  ```

- `KRITIS_DE_AST_5` (physische Sicherheitsperimeter) ist als `csp_inherited` gekennzeichnet.
- Die fünf Sektor-Controls `KRITIS_DE_SEC_ENE` (`kritis_sector: energy` oder `water`), `_HLT` (`health`), `_FIN` (`finance`), `_TRN` (`transport`) und `_ICT` (`ict`) deklarieren `applies_when: kritis_sector`; ohne passendes `framework_context.kritis_sector` sind sie N/A. `KRITIS_DE_SEC_DACHG` gilt für jeden Betreiber im Geltungsbereich des KRITIS-DachG.
- Controls mit `assessment_type_scope: [aud]` (darunter alle Sektor-Controls) werden in einem Application-Lauf nicht bewertet; sie erscheinen als nicht bewertet und erfordern ein Audit-Assessment.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| KRIT-GOV: Governance and Accountability | 6 | `KRITIS_DE_GOV_1` Management accountability for KRITIS IT security; `KRITIS_DE_GOV_2` Biennial §8a security audit and BSI reporting |
| KRIT-AST: Asset and Network Inventory | 5 | `KRITIS_DE_AST_1` KRITIS system inventory and criticality classification; `KRITIS_DE_AST_2` Network perimeter documentation and segmentation |
| KRIT-INC: Incident Detection and Reporting | 6 | `KRITIS_DE_INC_1` Disruption classification and major incident criteria; `KRITIS_DE_INC_2` Mandatory §8b 2-hour reporting to BSI |
| KRIT-IDM: Access Control and Identity | 5 | `KRITIS_DE_IDM_1` Multi-factor authentication for KRITIS systems; `KRITIS_DE_IDM_2` Privileged access management for KRITIS systems |
| KRIT-BCM: Resilience and Continuity | 7 | `KRITIS_DE_BCM_1` High availability architecture for KRITIS systems; `KRITIS_DE_BCM_2` Business continuity plan for KRITIS services |
| KRIT-SCM: Supply Chain and Third-party Risk | 5 | `KRITIS_DE_SCM_1` Third-party KRITIS classification and due diligence; `KRITIS_DE_SCM_2` Cloud service provider requirements for KRITIS workloads |
| KRIT-SEC: Sector-Specific Requirements | 6 | `KRITIS_DE_SEC_ENE` Energy and Water: IT-Sicherheitskatalog compliance (BNetzA); `KRITIS_DE_SEC_HLT` Health sector: §75c SGB V security measures |
| **Summe** | **40** | |

Standard-Schweregrade: critical 6, high 27, medium 7.

## Cross-Mapping

38 von 40 Controls tragen `maps_to`-Verweise auf Controls anderer Rahmenwerke. Die folgende Tabelle zählt die Verweise je Zielrahmenwerk. "Aufgelöst" bedeutet, dass die Ziel-ID als Control in einem mitgelieferten SWAO-Katalog existiert; "nicht aufgelöst" bedeutet, dass der Verweis auf Artikel- oder Klauselebene zielt oder eine ID-Schreibweise verwendet, die kein Katalog enthält.

| Zielrahmenwerk | Aufgelöste Verweise | Nicht aufgelöste Verweise |
|---|---|---|
| `ISO_27001` | 43 | 0 |
| `BSI_C5` | 22 | 0 |

Zusätzlich nennen die Metadaten (`cross_mapping_hints`) folgende verwandte Rahmenwerke: `BSI_C5`, `BSI_GRUNDSCHUTZ_2023`, `ISO_27001`, `DORA`, `NIS2`. Diese Liste ist ein Hinweis auf thematische Überschneidung, kein Control-Mapping.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/community-frameworks/kritis-de](https://github.com/Accenture/SWAO/tree/main/community-frameworks/kritis-de)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Um das Rahmenwerk für ein einzelnes Projekt anzupassen, kopieren Sie den Ordner `kritis-de` (mit `framework-meta.yaml` und `controls.yaml`) in den Workspace nach `wsp/inputs/catalogs/community/kritis-de/` und bearbeiten Sie dort die Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Stellen Sie sicher, dass der Ordner `kritis-de` unter `wsp/inputs/catalogs/community/` im Workspace liegt (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [KRITIS_DE]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [KRITIS_DE, GDPR]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "KRITIS_DE"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

## Grenzen und Hinweise

- Die 2-Stunden-Meldepflicht an das BSI nach §8b (`KRITIS_DE_INC_2`), die zweijährliche Prüfung nach §8a (`KRITIS_DE_GOV_2`) und die Sektor-Controls sind als `aud` gekennzeichnet (insgesamt 16 Controls). Sie erfordern Nachweise aus einer §8a-Prüfung oder von der Sektorbehörde.
- Ob eine Organisation überhaupt KRITIS-Betreiber ist, hängt von den Schwellenwerten der BSI-KritisV ab; SWAO stellt dies nicht fest.
- Das deutsche KRITIS-Recht ändert sich mit der NIS2-Umsetzung und dem KRITIS-Dachgesetz; prüfen Sie vor der Nutzung des Katalogs den aktuellen Rechtsstand.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer die offizielle Quelle des Herausgebers.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
