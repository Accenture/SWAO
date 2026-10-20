# 10 Säulen sicherer KI-Systeme (AI_10_PILLARS)

Diese Seite beschreibt das Community-Rahmenwerk `AI_10_PILLARS`, wie es mit SWAO ausgeliefert wird: was es abdeckt, wann Sie es einsetzen, was SWAO dabei prüft und wie Sie es aktivieren.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Framework-ID (für `regimes_active`) | `AI_10_PILLARS` |
| Herausgeber | Alok Sharan (Konzept); für SWAO aufbereitet vom SWAO Development Team (Accenture) |
| Version | 2026-Q2 |
| Status | Im Katalog nicht deklariert |
| SWAO-Katalogversion | 1.0.0 |
| Controls gesamt | 11 |
| Bewertungsmodus | `binary` (Standardwert des Schemas; nicht deklariert) |
| Assessment-Typen (Metadaten) | `app`, `llm`, `aud` |
| Lizenz und Weiterverbreitung | Im Katalog ist kein Hinweis zur Weiterverbreitung hinterlegt. Die Demo-Variante vermerkt, dass sie auf dem AI-10-Pillars-Rahmenwerk von Alok Sharan beruht. |
| Zuletzt geprüft | 2026-05-21 |
| Ordner | `ai-10-pillars` |

## Worum es geht

Die 10 Säulen sicherer KI-Systeme sind ein Architektur-Regelwerk zur Absicherung von Anwendungen, die ein Large Language Model (LLM), eine RAG-Pipeline (Retrieval-Augmented Generation), Agenten oder Foundation-Model-APIs einbetten. Es handelt sich um ein von Alok Sharan beigesteuertes Community-Rahmenwerk, nicht um ein Gesetz oder einen zertifizierbaren Standard. Die zehn Säulen umfassen Eingabesicherheit, Identitäts- und Zugriffskontrolle, Datenschutz, Modellsicherheit, Prompt-Sicherheit, Retrieval-Sicherheit, Tool- und API-Sicherheit, Ausgabe-Leitplanken, Überwachung und Erkennung sowie Governance und Compliance.

Laut Katalog-Metadaten eignet es sich als Basis-Overlay neben regulatorischen Regimen wie GDPR, PCI DSS oder SOC 2 für jede Anwendung, die ein LLM einbettet oder auf RAG aufbaut.

## Wer es in SWAO einsetzt und wann

- Jedes Projekt, in dem der Workload ein LLM aufruft, eine RAG-Pipeline betreibt oder Agenten-Tools bereitstellt (Anwendbarkeitshinweise im Katalog: `ai_workload`, `llm_app`, `rag_pipeline`, `genai_application`).
- Als technische Basis neben EU_AI_ACT (rechtliche Pflichten) und GDPR (personenbezogene Daten in Prompts und Ausgaben).
- Branchen- und regionsneutral; besonders relevant für souveräne Bereitstellungen, in denen Prompts personenbezogene oder regulierte Daten enthalten.
- Die Metadaten nennen die Assessment-Typen `app`, `llm` und `aud`; neben dem Application Assessment ist also auch `llm` deklariert (siehe [LLM Assessment](/de/assessment/llm)).

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
| Signale und Dokumente kombiniert | 0 |
| Nur Dokumente oder Fragebögen (`context_input`, `manual_questionnaire`) | 6 |
| Davon als reines Audit-Control gekennzeichnet (`assessment_type_scope: [aud]`) | 0 |
| Als Verantwortung des Cloud-Anbieters gekennzeichnet (`csp_inherited: true`) | 0 |

### Referenzierte Signalbereiche

| Präfix | Controls | Quelle |
|---|---|---|
| `IAM` | 1 | Nachweisbereich Identität und Zugriff; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |
| `CRYPTO` | 1 | [Pass 08 (CRYPTO)](/de/passes/08-crypto) |
| `DATA` | 1 | [Pass 03 (DATA)](/de/passes/03-data) |
| `EGR` | 1 | [Pass 07 (EGR)](/de/passes/07-egr) |
| `OBS` | 1 | Nachweisbereich Beobachtbarkeit, Logging und Monitoring; kein SWAO-Analysepass erzeugt Signale mit diesem Präfix |

### Beispiele

Controls mit Code- oder Konfigurationsnachweis:

- `AI10P-IAM-01` AuthN/AuthZ across AI APIs (`IAM`)
- `AI10P-DAT-01` Encrypt and mask sensitive data (`CRYPTO`)
- `AI10P-DAT-02` Prevent data leakage in AI outputs (`DATA`)

Controls, die Dokumente benötigen:

- `AI10P-INP-01` Validate and sanitise all incoming inputs
- `AI10P-MOD-01` Protect models from theft and adversarial manipulation

Dokumente legen Sie im Ordner `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie einliest und als Signale bereitstellt; siehe auch [Workspace einrichten](/de/workspace-setup). Fehlen sie, ist für dokumentenbasierte Controls `UNKNOWN` zu erwarten.

## Aufbau der Controls

Gruppenbezeichnungen und Control-Titel werden wie im Katalog (Englisch) wiedergegeben.

| Gruppe | Controls | Beispiel-Controls |
|---|---|---|
| INP: Input Security | 1 | `AI10P-INP-01` Validate and sanitise all incoming inputs |
| IAM: Identity and Access Control | 1 | `AI10P-IAM-01` AuthN/AuthZ across AI APIs |
| DAT: Data Protection | 2 | `AI10P-DAT-01` Encrypt and mask sensitive data; `AI10P-DAT-02` Prevent data leakage in AI outputs |
| MOD: Model Security | 1 | `AI10P-MOD-01` Protect models from theft and adversarial manipulation |
| PRM: Prompt Security | 1 | `AI10P-PRM-01` Protect system-prompt integrity |
| RAG: Retrieval Security | 1 | `AI10P-RAG-01` Secure RAG pipeline and vector store |
| TAS: Tool and API Security | 1 | `AI10P-TAS-01` Secure tool and external-API integrations |
| OUT: Output Guardrails | 1 | `AI10P-OUT-01` Filter and constrain AI outputs |
| OBS: Monitoring and Detection | 1 | `AI10P-OBS-01` Continuously track usage and anomalies |
| GOV: Governance and Compliance | 1 | `AI10P-GOV-01` AI governance and regulatory alignment |
| **Summe** | **11** | |

Standard-Schweregrade: high 10, medium 1.

## Cross-Mapping

Die Controls dieses Rahmenwerks enthalten keine `maps_to`-Verweise.

Umgekehrt verweisen Controls dieser Rahmenwerke auf Controls von AI_10_PILLARS: `GDPR` (12).

## Demo-Variante

| Eigenschaft | Wert |
|---|---|
| Framework-ID | `AI_10_PILLARS_DEMO` |
| Ordner | `ai-10-pillars-demo` |
| Controls | 11 |
| Katalogversion | 1.1.0 |
| Zuletzt geprüft | 2026-07-07 |
| In neuen Workspaces vorinstalliert | Ja (`swao init`) |

Die Demo-Variante enthält dieselben 11 Controls wie das vollständige Rahmenwerk, jedoch mit dem Präfix `AI10P_DEMO.` und mit Säulennamen beschriftet. Sie ist für Live-Präsentationen mit der Demo-Anwendung Sovereign Health gedacht und auf Querbezüge zu den Demo-Rahmenwerken für GDPR, HIPAA und BSI IT-Grundschutz ausgelegt. Laut Metadaten ist sie auf den Assessment-Typ `app` beschränkt.

Die Demo-Variante ist für Workshops, Schulungen und Präsentationen gedacht, bei denen ein kurzer Bericht wichtiger ist als vollständige Abdeckung. Aktivieren Sie sie mit ihrer eigenen ID, zum Beispiel `regimes_active: [AI_10_PILLARS_DEMO]`.

## Rahmenwerk beziehen oder anpassen

- Quelle zum Ansehen und Kopieren: [github.com/Accenture/SWAO/tree/main/community-frameworks/ai-10-pillars](https://github.com/Accenture/SWAO/tree/main/community-frameworks/ai-10-pillars)
- Demo-Variante: [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/ai-10-pillars-demo](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks/ai-10-pillars-demo)
- Übersicht aller Community-Rahmenwerke: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

Um das Rahmenwerk für ein einzelnes Projekt anzupassen, kopieren Sie den Ordner `ai-10-pillars` (mit `framework-meta.yaml` und `controls.yaml`) in den Workspace nach `wsp/inputs/catalogs/community/ai-10-pillars/` und bearbeiten Sie dort die Kopie. SWAO liest Kataloge für die Compliance-Bewertung aus diesem Verzeichnis; die Workspace-Kopie ist damit maßgeblich. Behalten Sie die `id` in `regime_meta` bei, damit `regimes_active` sie weiterhin findet, und prüfen Sie die Kopie anschließend mit dem [Health Check](/de/health-check).

## Aktivieren

1. Stellen Sie sicher, dass der Ordner `ai-10-pillars` unter `wsp/inputs/catalogs/community/` im Workspace liegt (siehe oben). Neue Workspaces enthalten nach `swao init` nur die Demo-Rahmenwerke `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` und `bsi-grundschutz-2023-demo`.
2. Tragen Sie die Framework-ID in die `.swao.yml` der App ein (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [AI_10_PILLARS]
   ```

   Mehrere Rahmenwerke werden als Liste angegeben, zum Beispiel `regimes_active: [AI_10_PILLARS, GDPR]`. Alternativ schreibt `swao regime-select --app app-crm-01 --regimes "AI_10_PILLARS"` denselben Eintrag.
3. Führen Sie das [Application Assessment](/de/assessment/application) mit einem konfigurierten LLM aus.

Pass 11 liest `regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste in der `.swao.yml` im Workspace-Stammverzeichnis (die `swao regime-select` ohne `--app` schreibt); eine Liste in der App hat immer Vorrang. Fehlt der Katalog, erzeugt Pass 11 ein Signal `COMP-NN` mit dem Hinweis, dass kein Katalog gefunden wurde.

## Grenzen und Hinweise

- Die Säulen sind Architekturleitlinien. Ein Ergebnis SATISFIED bedeutet, dass die Bewertung unterstützende Signale gefunden hat; es ersetzt keinen Red-Team-Test. Widerstandsfähigkeit gegen Prompt Injection, Jailbreaks und Modelldiebstahl lässt sich nur durch gezielte Tests nachweisen.
- Sechs der elf Controls stützen sich auf Dokumente (zum Beispiel `ai_prompt_security`, `ai_retrieval_security`, `ai_governance`). Fehlen diese Dokumente im App-Kontext, ist für diese Controls UNKNOWN zu erwarten.
- Das Rahmenwerk enthält keine `maps_to`-Einträge auf Control-Ebene; SWAO zeigt dafür also kein eigenes Mapping. Andere Rahmenwerke (GDPR) verweisen jedoch darauf; siehe Abschnitt zum Cross-Mapping.
- Die Ergebnisse stammen von einem LLM, das Signale und Dokumente auswertet. Sie sind ein strukturierter Ausgangspunkt für die Prüfung durch Fachleute, kein Prüfurteil und keine Zertifizierung.
- Die Control-Texte sind sinngemäße Zusammenfassungen. Maßgeblich ist immer die offizielle Quelle des Herausgebers.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
- [Application Assessment](/de/assessment/application)
