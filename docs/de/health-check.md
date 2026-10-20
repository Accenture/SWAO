# 2. Health Check

Führen Sie `swao health-check` aus (oder wählen Sie Option 2 im Hauptmenü), um zu prüfen, ob Ihr Workspace bereit für eine Bewertung ist. Er führt 25 Prüfungen aus; die Prüfungen 17 bis 25 gelten für Service-Portfolio-Workspaces und zeigen sonst INFO. Beheben Sie vor einer Bewertung jedes FAIL; WARN und INFO sind Hinweise.

## Prüfungen

| Prüfung | Was geprüft wird |
|---|---|
| Lizenz | Edition erkannt und gültig |
| Playwright | Browser-Engine bereit für dynamische Analyse |
| MCP | Model-Context-Protocol-Serverkonfiguration. Prüft jede Claude-Desktop-Konfiguration (Microsoft Store / MSIX und klassische Installation) und warnt, wenn ein SWAO-Eintrag auf ein Binary zeigt, das nicht mehr existiert oder nicht das laufende SWAO-Binary ist; jeder veraltete Eintrag wird mit dem Pfad seiner Konfiguration aufgeführt |
| Compliance-Kataloge | Rahmenwerk-YAML-Dateien vorhanden und parsebar |
| Import-Vorlagen | Kontexteinlese-Ordnerstruktur vorhanden |
| Nachvollziehbarkeit | Audit-konforme Signalfelder aktiviert |
| BI-Exportpaket | Integrität des letzten Exports (beim ersten Lauf übersprungen) |
| LZ-Katalog (Prüfung 15) | Jeder LZ-Katalog, den die Fit-Bewertung auflösen kann, lädt und ist schemagültig; die folgenden Katalog-Qualitätsregeln sind für die mitgelieferten Kataloge (und für einen Workspace-Katalogordner, der Katalogdateien enthält) erfüllt; die in `.swao.yml` konfigurierten LZ-Ziele nennen einen bekannten Provider und eine bekannte Region oder Geografie. Jeder Fehler- oder Warnbefund ist ein WARN; die Prüfung schlägt nie fehl |

## Qualitätsregeln für LZ-Kataloge

Das SWAO-Team verantwortet die mitgelieferten LZ-Kataloge (`lz-catalogues/`: eine JSON-Datei je Provider, `_lz-catalogue-template.json`, `_coming-soon.json`, `aws-service-meta.json` und die VM-Preistabelle `prices/vm-prices.json` des Kostenmodells der Service-Bewertung). Eine `index.json` gibt es nicht: SWAO listet die Kataloge aus dem `meta`-Block jeder Datei, die Regeln prüfen daher jede Datei für sich; eine `index.json` in einem älteren Workspace-Ordner wird ignoriert. Prüfung 15 und das CI-Audit-Gate `tests/audit-gates/lz-catalogue-quality.gate.mjs` wenden dieselben Regeln an (`module-landing-zone/src/catalogue/quality.ts`). Fehlerregeln lassen das Gate scheitern, sodass kein inkonsistenter Katalog ausgeliefert wird; Warnregeln werden nur gemeldet. Im Health Check macht ein Fehler- oder Warnbefund Prüfung 15 zu WARN, ein Info-Befund (`target-geography`) nicht; keiner lässt den Health Check scheitern.

| Regel | Schweregrad | Was geprüft wird |
|---|---|---|
| `template-invalid` | Fehler | `_lz-catalogue-template.json` existiert und besteht ohne ihre `_comment`-Schlüssel das Katalogschema |
| `catalogue-schema` | Fehler | Der Katalogordner ist lesbar, und jede Katalogdatei ist gültiges JSON und besteht das Katalogschema; ein Fehler nennt Datei und Grund und wird nie übersprungen |
| `provider-filename` | Fehler | `meta.provider` entspricht dem Dateinamen |
| `meta-fields` | Fehler | Der `meta`-Block hat genau die Feldmenge der Vorlage |
| `regions-count` | Fehler | `meta.regions_count` entspricht der Anzahl der Regionen |
| `region-id-duplicate` | Fehler | Regions-IDs sind je Provider eindeutig |
| `sovereignty-shape` | Fehler | Jede Region führt `residency_country`, `operator_jurisdiction`, `extraterritorial_exposure` und `certifications`; eine Region, deren Standort der Kunde wählt, führt `residency_country: OPERATOR_SITE`, das nur zusammen mit `operator_jurisdiction: operator-site` gültig ist |
| `confidence-vocabulary` | Fehler | `meta.confidence` ist `high`, `medium` oder `low` |
| `certification-vocabulary` | Warnung | Jede Zertifizierung einer Region gehört zum Vokabular der Vorlage: `BSI_C5`, `ISO_27001`, `SOC_2`, `TISAX_L3`, `PCI_DSS`, `FedRAMP_High`, `MAS_TRM`, `IRAP` |
| `source-missing` | Fehler | Jeder Katalog nennt eine Quelle (`meta.source.mode`) |
| `date-format` | Fehler | `meta.last_updated` ist ein gültiges Datum im Format `YYYY-MM-DD` |
| `stale` | Warnung | `last_updated` (bzw. `generated_at` von `aws-service-meta.json` oder `meta.generated_at` von `prices/vm-prices.json`) ist älter als 90 Tage (`LZ_CATALOGUE_MAX_AGE_DAYS`) |
| `services-empty` | Warnung | Eine Region führt keine Services |
| `service-code-duplicate` | Warnung | Ein Service-Code kommt in einer Region doppelt vor |
| `pin-drift` | Warnung | Souveränitätsfakten weichen vom Refresh-Overlay-Pin der Region ab (`catalogue/sovereignty-pins.ts`, die Pins, die `swao lz catalogue update` schreibt) |
| `facts-unsourced` | Warnung | Souveränitätsfakten haben keine Quelle: Platzhalter `UNKNOWN` als Residency, oder weder Overlay-Pin noch `meta.source.source_note` |
| `geography-coverage` | Fehler | Jede Region mit Residenzland ist durch das gemeinsame Geografiemodell erfasst; ein Residenzland außerhalb des Modells schlägt fehl, ebenso ein Katalog ohne erfasste Region, außer alle Regionen sind Betreiberstandort-Regionen (`OPERATOR_SITE`) |
| `price-table` | Fehler | Die VM-Preistabelle `prices/vm-prices.json` ist, sofern vorhanden, gültiges JSON und erfüllt das Preistabellen-Schema: Jeder Preis nennt Provider, Größe, Betriebssystem (`linux` oder `windows`), Region, Währung und einen positiven Stundenpreis, und jede Provider-Region hat eine Quelle mit API, URL und Abrufdatum |
| `target-invalid` | Warnung (nur Health Check) | Ein Ziel in der Workspace- oder App-`.swao.yml` (`assessment.landing_zone.provider` + `region` oder `assessment.landing_zone.targets`) nennt einen unbekannten Provider oder eine unbekannte Region; die Warnung listet gültige Regions-IDs |
| `target-geography` | Info (nur Health Check) | Ein Ziel nennt eine bekannte Geografie (zum Beispiel `azure:Europe`) statt einer Regions-ID; das ist keine Warnung, die Zeile nennt die Standardregion, auf die es aufgelöst wird (siehe [Landing Zone Catalog Assessment](/de/assessment/landing-zone#geografien)) |

`swao health-check --json` enthält jeden Befund unter `lz_catalogue_coverage.quality` (Regel, Schweregrad, Datei, Provider, Region, Meldung) mit der Zahl der Fehler und Warnungen; die Textausgabe fasst Regionsbefunde je Regel und Datei zusammen. Das Gate lässt sich lokal mit `node tests/audit-gates/lz-catalogue-quality.gate.mjs` ausführen (Node mit TypeScript-Type-Stripping, ab 22.18).

Die Altersgrenze bleibt bei 90 Tagen; das Release-Runbook aktualisiert die mitgelieferten Kataloge vor jedem Minor-Release, sodass keine veralteten Kataloge ausgeliefert werden. Residency-Pins, die aus Regionsseiten der Provider ergänzt wurden, führen Quell-URL und Abrufdatum in `LZ_SOVEREIGNTY_PIN_SOURCES` (`catalogue/sovereignty-pins.ts`).

## Laufstatus

Jeder Bewertungslauf (Anwendung, Service und Landing-Zone-Katalog) schreibt `run-status.json` in seinen Lauf-Ordner `apps/<id>/wsp/runs/<zeitstempel>/`. Der Status ist beim Start `started` und wird auf jedem Ausgangspfad abgeschlossen:

| Status | Bedeutung |
|---|---|
| `started` | Der Lauf ist aktiv, oder der Prozess wurde beendet oder ist abgestürzt, bevor er den Lauf abschließen konnte |
| `complete` | Der Lauf wurde normal beendet |
| `partial` | Der Lauf wurde beendet, aber einige Landing-Zone-Ziele wurden übersprungen (`failed_targets`) oder einige Durchläufe schlugen fehl (`failed_passes`) |
| `failed` | Der Lauf endete vor dem Abschluss, zum Beispiel durch ein `--fail-on`-Gate oder einen Fehler; `exit_code` und `reason` nennen den Grund, und es wird keine `run-manifest.json` geschrieben |
| `aborted` | Der Lauf wurde unterbrochen (SIGINT oder SIGTERM) |

Der Health Check listet Läufe unter den jüngsten 10 je App, die `failed` oder `aborted` sind oder mehr als 6 Stunden nach dem Start noch `started` sind (veraltet), zum Beispiel `[WARN] apps/billing/wsp/runs/2026-10-17T09-00-00: application run failed (exit 6): --fail-on severity=high: 3 signal(s) matched`. Der Laufverlauf der Publikation, der Engagement Hub, die MCP-Laufliste, der Power-BI-Export und die Aufbewahrung (`workspace.run_retention.keep_latest`, die nur abgeschlossene Läufe zählt) verwenden nur Läufe mit `complete` und `partial`, und der Engagement Hub markiert eine App, deren jüngster Lauf nicht abgeschlossen wurde. Läufe aus der Zeit vor dieser Markierung werden wie bisher behandelt: Ein Lauf gilt als abgeschlossen, wenn er eine `run-manifest.json` hat.

![Health-Check-Bildschirm in der Terminaloberfläche mit der Liste der Prüfungen und ihrem Status OK, WARN und INFO](../samples/12-tui-health-check.png)
*Der Health-Check-Bildschirm in der Terminaloberfläche (Menüpunkt 2). Aufgenommen mit einer früheren SWAO-Version mit 11 Prüfungen; wählen Sie eine Prüfung, um ihren Hinweistext zu lesen.*

## Ergebnisse interpretieren

- **Grün**: Prüfung bestanden; keine Aktion erforderlich.
- **Gelb / Warnung**: Hinweis; Bewertung möglich, aber eine nicht-kritische Komponente fehlt.
- **Rot / Blocker**: Bewertung schlägt fehl oder liefert unvollständige Ergebnisse bis zur Behebung. Die Ausgabe enthält einen Behebungshinweis.

Nur FAIL-Ergebnisse zählen als Fehler. Die Zusammenfassungszeile (`All probes passed.` oder `N probe(s) failed: ...`) nennt die fehlgeschlagenen Prüfungen, und der Setup-Assistent meldet dieselbe Fehlerzahl; Warnungen führt er getrennt auf.

## CLI

```bash
swao health-check
swao health-check --verbose
```

Siehe auch: [Workspace-Setup](/de/workspace-setup) | [Fehlerbehebungs-Runbook](/de/runbooks/troubleshooting)
