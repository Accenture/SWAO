# 2. Health Check

Führen Sie `swao health-check` aus (oder wählen Sie Option 2 im Hauptmenü), um zu prüfen, ob Ihr Workspace bereit für eine Bewertung ist. Alle sieben Prüfungen müssen grün sein.

## Prüfungen

| Prüfung | Was geprüft wird |
|---|---|
| Lizenz | Edition erkannt und gültig |
| Playwright | Browser-Engine bereit für dynamische Analyse |
| MCP | Model-Context-Protocol-Serverkonfiguration |
| Compliance-Kataloge | Rahmenwerk-YAML-Dateien vorhanden und parsebar |
| Import-Vorlagen | Kontexteinlese-Ordnerstruktur vorhanden |
| Nachvollziehbarkeit | Audit-konforme Signalfelder aktiviert |
| BI-Exportpaket | Integrität des letzten Exports (beim ersten Lauf übersprungen) |

## Ergebnisse interpretieren

- **Grün** -- Prüfung bestanden; keine Aktion erforderlich.
- **Gelb / Warnung** -- Hinweis; Bewertung möglich, aber eine nicht-kritische Komponente fehlt.
- **Rot / Blocker** -- Bewertung schlägt fehl oder liefert unvollständige Ergebnisse bis zur Behebung. Die Ausgabe enthält einen Behebungshinweis.

## CLI

```bash
swao health-check
swao health-check --verbose
```

Siehe auch: [Workspace-Setup](/de/workspace-setup) | [Fehlerbehebungs-Runbook](/de/runbooks/troubleshooting)
