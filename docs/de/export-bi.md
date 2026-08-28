# 6. BI exportieren

Wählen Sie Option 6 im Hauptmenü (oder führen `swao export` aus), um ein strukturiertes Datenexportpaket für Power BI, Tableau, Excel oder ein anderes BI-Tool zu erstellen.

## Exportformate

| Format | Inhalt | Anwendungsfall |
|---|---|---|
| CSV (Sternschema) | 17 Fakten- und Dimensionstabellen | Power BI Desktop, Tableau, Excel |
| NDJSON | Zeilengetrennte JSON-Spiegelung der CSV-Tabellen | Datenpipelines, dbt, eigene Werkzeuge |
| XLSX | Einzelne Arbeitsmappe als Rollup | Schnelle Überprüfung, Stakeholder-Weitergabe |

## Vorgefertigte Power-BI-Vorlagen

Zwei `.pbit`-Vorlagen sind in Ihrem Workspace unter `wsp/templates/powerbi/` enthalten:

| Vorlage | Edition | Seiten |
|---|---|---|
| `swao-report.pbit` | Enterprise | Übersicht, Compliance, Signale, Risiken, Prüfer, Laufstatistiken |
| `swao-portfolio.pbit` | Enterprise | Portfolio-Übersicht, Heatmap, Compliance, Risiko & 7R, Wellensequenzierung |

Öffnen Sie die `.pbit`-Datei in Power BI Desktop, setzen Sie `SWAOExportPath` auf Ihren `star/`-Ordner und klicken Sie **Laden**.

## CLI

```bash
swao export --app meine-app --formats csv,ndjson,xlsx
```

Siehe auch: [HTML veröffentlichen](/de/publish-html)
