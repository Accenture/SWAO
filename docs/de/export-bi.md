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

## Portfolio-Export (Anwendungs- und Service-Apps)

`swao service export` (Enterprise) schreibt das Portfolio-Sternschema (`wsp/star-schema/portfolio-*.json`, 9 Tabellen) und die Portfolio-Arbeitsmappe (`wsp/reports/swao-portfolio-YYYYMMDD.xlsx`, 14 Blätter) aus `wsp/portfolio-summary.json`. Seit der kombinierten Portfolio-Sicht ([Portfolio-Betrieb](/de/portfolio)) enthalten beide Anwendungs- und Service-Apps:

- `dim_service_app.assessment_type` ist `application` oder `service`; verbinden Sie die anderen Portfolio-Tabellen über `app_id`, um nach Typ zu filtern.
- Die Blätter Portfolio Overview, Migration Waves, Migration Candidates und Cost vs Risk enden mit der Spalte `Assessment Type`; Source Data enthält `computed.assessment_type` (und `computed.seven_r_label`, sobald eine Anwendungs-App vorhanden ist).

Ein reiner Service-Workspace erzeugt dieselben Tabellen und Blätter wie bisher, abgesehen von der neuen Spalte. Die `.pbit`-Vorlagen oben lesen den Anwendungsexport (`swao export`) und bleiben unverändert; ein Power-BI-Modell über die Portfolio-Tabellen filtert über `dim_service_app.assessment_type`.

## CLI

```bash
swao export --app meine-app --formats csv,ndjson,xlsx
```

Siehe auch: [HTML veröffentlichen](/de/publish-html)
