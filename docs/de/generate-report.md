# 4. Bericht erstellen

Nach Abschluss einer Bewertung wählen Sie Option 4 im Hauptmenü (oder führen `swao report` aus), um einen strukturierten Textbericht aus dem Workload-Souveränitätsprofil zu erstellen.

## Berichtsformate

| Format | Beschreibung | Edition |
|---|---|---|
| Text / Markdown | Klartextzusammenfassung und `auditor.md` für Prüfer | Alle |
| YAML | Maschinenlesbarer Signal-Dump | Alle |
| JSON | Vollständiger WSP-Export für nachgelagerte Werkzeuge | Alle |
| PDF | Gerendertes PDF des vollständigen Berichts | Consultant + Enterprise |

## CLI

```bash
# Textbericht (Standard)
swao report --app meine-app

# PDF-Bericht (erfordert Playwright)
swao report --app meine-app --format pdf

# Alle Formate
swao report --app meine-app --format text,pdf,yaml,json
```

## Ausgabeort

Berichte werden in `wsp/reports/<run-id>/` in Ihrem Workspace-Ordner gespeichert.

Siehe auch: [HTML veröffentlichen](/de/publish-html) | [BI exportieren](/de/export-bi)
