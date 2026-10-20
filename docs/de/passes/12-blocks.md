# Pass 12: Block-Assessments (BLOCKS)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 12 |
| Schlüssel (`--passes`) | `blocks` |
| Signal-Präfix | `BLOCKS` (deklariert; der Pass gibt keine Signale aus, siehe unten) |
| Typ | LLM-gestützt (ohne LLM wird jeder Block auf `UNKNOWN` gesetzt) |
| Standard | Aktiv (Teil der Standardliste von `--passes`) |
| Assessment-Typen | `application`, `service` (im Service-Profil immer aktiv) |
| Tier | Alle Tiers (keine Lizenzsperre) |
| Quelle | `packages/@swao/module-app-assessment/src/passes/pass-12-blocks.ts` |

## Wofür dieser Pass gedacht ist

Compliance-Frameworks (Pass 11) zeigen, ob Controls erfüllt sind. Pass 12 beantwortet eine betrieblichere Frage: „Wie reif ist diese Anwendung in den acht Bereichen, die meist darüber entscheiden, ob eine Migration reibungslos verläuft?“

Er erstellt eine Scorecard mit einem Eintrag je Block: ein Ergebnis, eine Bewertung zwischen 0 und 1, einen Risikostatus, eine kurze Begründung und die Signale, auf die sich die Bewertung stützt. Die acht Blöcke waren früher als eigene Passes mit den Nummern 15 bis 22 geplant; sie werden jetzt gemeinsam in diesem einen Pass bewertet.

## Was Sie bereitstellen müssen

| Eingabe | Ort | Hinweise |
|---|---|---|
| Signale vorangegangener Passes | Werden im selben Lauf automatisch geschrieben | Die Scorecard ist nur so gut wie die Nachweise |
| Ein LLM-Provider | `providers.llm` in `.swao.yml`, `--llm` oder `--model` | Ohne LLM ist jeder Block `UNKNOWN` |

Es gibt keine pass-spezifischen Konfigurationsschlüssel.

## So funktioniert der Pass

1. **Signale sammeln.** Der Pass liest alle bereits im aktuellen Laufverzeichnis geschriebenen Pass-Dateien (ohne seine eigene Datei `12-*`).
2. **Synthese lesen.** Pass 12 läuft in der kanonischen Reihenfolge zuletzt, nach [Pass 09 SYNTH](/de/passes/09-synth). Er liest die 7R-Empfehlung, den Abdeckungswert und die Migrationsbegründung aus `09-synth.yaml` im selben Laufverzeichnis. Fehlt diese Datei (etwa weil `synth` nicht ausgewählt war), vermerkt der Prompt, dass die Synthese nicht verfügbar ist.
3. **Ein LLM-Aufruf.** Ein einziger Prompt enthält die acht Block-Spezifikationen mit Schwellenwerten und Prüfachsen, die Ergebnisregeln und eine Zusammenfassung aller Signale (ID, Schweregrad und die ersten 240 Zeichen der Herleitung). Das LLM muss ausschließlich JSON liefern.
4. **Validieren.** Die Antwort wird gegen ein strenges Schema geprüft (Ergebnis, Begründung, Bewertung 0 bis 1, Status, Schlüsselsignale; ein Schwellenwert in der Antwort ist optional). Zitierte Signal-IDs, die im Lauf nicht existieren, werden entfernt. Der gespeicherte Schwellenwert stammt immer aus der Block-Spezifikation von SWAO in der Tabelle unten; ein vom LLM gelieferter Schwellenwert wird ignoriert und kann ihn nicht überschreiben.
5. **Rückfall.** Ein Block, der in der Antwort fehlt, oder alle Blöcke, wenn kein LLM konfiguriert ist oder die Antwort nicht auswertbar ist, werden als `UNKNOWN` mit Bewertung 0, Status medium und `assessor: rule_engine` erfasst.
6. **Zusammenfassung.** Der Pass setzt `any_gap_found` auf true, sobald ein Block `GAP` oder `PARTIAL` ist.

## Wie gemessen wird

### Die Block-Scorecard

| Block (`assessment.blocks.<name>`) | Frühere Pass-Nummer | Schwellenwert | Worauf der Prüfer achtet |
|---|---|---|---|
| `observability` | 15 | 0.7 | Strukturierte Logs, exportierte Metriken, verteiltes Tracing, definierte SLOs, Alarmregeln, Bereitschafts-Runbooks |
| `licence_compliance` | 16 | 0.8 | Vollständigkeit der SBOM, GPL/AGPL-Exposition, Abdeckung der Namensnennung, kommerziell unverträgliche Abhängigkeiten, End-of-Life- oder verwaiste Pakete |
| `testing_maturity` | 17 | 0.6 | Unit-, Integrations- und End-to-End-Tests, CI als Merge-Voraussetzung, Performance- und Lasttests, Mutationstests |
| `architecture_assessment` | 18 | 0.65 | Klare Service-Grenzen, geringe Kopplung, azyklische Abhängigkeiten, einfache Deployment-Topologie, dokumentierter Skalierungspfad |
| `database_assessment` | 19 | 0.7 | Versioniertes Schema, Replikation, geprüfte Backups, Verschlüsselung im Ruhezustand, Aufbewahrungsrichtlinie, Unterstützung des Rechts auf Löschung |
| `integration_assessment` | 20 | 0.65 | Wiederholung mit Backoff, Idempotenzschlüssel, Contract-Tests, Circuit Breaker, dokumentierte Egress-Allowlist, geprüfte Webhook-Signaturen |
| `iam_assessment` | 21 | 0.8 | Starke Authentifizierung, MFA für Administratoren, durchgesetztes RBAC, Secrets in KMS oder Vault, Audit-Log der Zugriffe, Sitzungsablauf |
| `dr_assessment` | 22 | 0.6 | Definierte RTO/RPO, geprüfte Backups, mehrere Zonen oder Regionen, aktuelles DR-Runbook, DR-Test innerhalb von sechs Monaten, automatisierter Failover |

### Ergebnisregeln für den Prüfer

| Ergebnis | Regel |
|---|---|
| `SATISFIED` | Der Block ist ausgereift; Bewertung mindestens auf dem Schwellenwert des Blocks |
| `PARTIAL` | Einige Elemente vorhanden, Lücken bleiben; Bewertung ab 0.4 bis unter den Schwellenwert |
| `GAP` | Der Block fehlt weitgehend; Bewertung unter 0.4 |
| `N_A` | Der Block ist für diesen Workload nicht anwendbar (selten, muss begründet werden) |
| `UNKNOWN` | Kein Signal betrifft den Block; Bewertung 0.0 |

Jeder Block trägt außerdem einen `status` von `low`, `medium`, `high` oder `critical`: das Migrationsrisiko aus Sicht des Betreibers. Derselbe Wert wird als `sovereign_migration_risk` gespeichert.

### Felder auf Pass-Ebene

| Feld | Bedeutung |
|---|---|
| `blocks_evaluated` | Immer 8 |
| `evaluation_mode` | `llm` oder `rule_engine` (kein LLM) |
| `any_gap_found` | True, sobald ein Block `GAP` oder `PARTIAL` ist |
| `evaluation_note` | Zusammenfassung des Ergebnisses in Klartext |
| `skipped_reason` | `no_llm_provider`, wenn kein LLM konfiguriert war |

## Module, Werkzeuge und externe Dienste von Drittanbietern

| Name | Zweck | Lizenz | Gebündelt oder optional | Verhalten bei Fehlen oder offline |
|---|---|---|---|---|
| Konfigurierter LLM-Provider | Bewertet die acht Blöcke | Abhängig vom Provider | Optional, für aussagekräftige Ergebnisse aber nötig | Alle Blöcke `UNKNOWN` |
| `js-yaml`, `zod` | Pass-Dateien lesen und LLM-Antwort validieren | MIT | Gebündelt | - |

## Ausgaben

| Datei | Inhalt |
|---|---|
| `apps/<app>/wsp/runs/<ts>/passes/12-blocks.yaml` | Pass-Kopf, leere Signalliste und Scorecard `assessment.blocks` |
| `apps/<app>/wsp/runs/<ts>/llm-traces/12-blocks-call-1.json` | Prompt (nach der Schwärzung) und Antwort |
| `wsp-plan.yaml` (über die Plan-Ableitung) | Die acht Blöcke für den Bericht und den BI-Export |

## Konfiguration und Einschränkungen

| Einstellung | Wirkung |
|---|---|
| `--passes` ohne `blocks` | Überspringt den Pass |
| `--skip-llm` (Alias `--no-llm`) | Entfernt `ctx`, `comp` und `blocks` aus dem Lauf |
| `--llm`, `--model`, `--no-cache` | Wählen das LLM und umgehen den Antwort-Cache |

Bekannte Einschränkungen:

- **Bewertung und Ergebnis werden nicht gegeneinander geprüft.** Die Schwellenwerte legt SWAO fest, SWAO prüft aber nicht, ob die vom LLM gelieferte Bewertung zum gewählten Ergebnis passt. Prüfen Sie die Scorecard mit diesem Wissen.
- **Keine Signale.** Der Pass deklariert sein eigenes Präfix `BLOCKS`, gibt aber keine Signale aus; das Ergebnis steht nur in `assessment.blocks`. `--fail-on` wirkt daher auf andere Passes, nicht auf Block-Ergebnisse.

Siehe auch [Pass 11: Compliance-Bewertung](/de/passes/11-comp) und [Bericht erzeugen](/de/generate-report).
