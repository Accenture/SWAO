# 6. BI exportieren

Wählen Sie Option 6 im Hauptmenü (oder führen `swao export` aus), um ein strukturiertes Datenexportpaket für Power BI, Tableau, Excel oder ein anderes BI-Tool zu erstellen.

## Exportformate

| Format | Inhalt | Anwendungsfall |
|---|---|---|
| CSV (Sternschema) | 17 Fakten- und Dimensionstabellen | Power BI Desktop, Tableau, Excel |
| NDJSON | Zeilengetrennte JSON-Spiegelung der CSV-Tabellen | Datenpipelines, dbt, eigene Werkzeuge |
| XLSX | Einzelne Arbeitsmappe als Rollup | Schnelle Überprüfung, Stakeholder-Weitergabe |

Der Sternschema-Export ist in jeder Edition verfügbar, auch in Community <Badge type="info" text="Community"/>.

## Vorgefertigte Power-BI-Vorlagen

In Consultant und Enterprise sind zwei `.pbit`-Vorlagen in Ihrem Workspace unter `wsp/templates/powerbi/` enthalten <Badge type="tip" text="Consultant"/>. In Community schreibt `swao export` das Sternschema und einen Lizenzhinweis anstelle der Vorlagen.

| Vorlage | Edition | Seiten |
|---|---|---|
| `swao-report.pbit` | Consultant und Enterprise | Übersicht, Compliance, Signale, Risiken, Prüfer, Laufstatistiken |
| `swao-portfolio.pbit` | Consultant und Enterprise (Portfolio-Daten erfordern Enterprise) | Portfolio-Übersicht, Heatmap, Compliance, Risiko & 7R, Wellensequenzierung |

Öffnen Sie die `.pbit`-Datei in Power BI Desktop, setzen Sie `SWAOExportPath` auf Ihren `star/`-Ordner und klicken Sie **Laden**.

![Power-BI-Seite Auditor mit Begründungsabdeckung, Bewertungen je Block und der Falsch-Positiv-Prüfung je Signal](../samples/07-powerbi-auditor.png)
*Die Seite Auditor von `swao-report.pbit` für die Demo-Anwendung Sovereign Health: Jedes Signal trägt seine Begründung und den Bewerter.*

![Power-BI-Seite Risks mit Risikoregister, Risikowerten und Risikokategorien](../samples/06-powerbi-risks.png)
*Die Seite Risks von `swao-report.pbit`: Risikoregister mit Eintrittswahrscheinlichkeit, Auswirkung und Maßnahme, nach Wert sortiert.*

## Portfolio-Export (Anwendungs- und Service-Apps)

`swao service export` <Badge type="warning" text="Enterprise"/> schreibt das Portfolio-Sternschema (`wsp/star-schema/portfolio-*.json`, 9 Tabellen) und die Portfolio-Arbeitsmappe (`wsp/reports/swao-portfolio-YYYYMMDD.xlsx`, 14 Blätter) aus `wsp/portfolio-summary.json`. Seit der kombinierten Portfolio-Sicht ([Portfolio-Betrieb](/de/portfolio)) enthalten beide Anwendungs- und Service-Apps:

- `dim_service_app.assessment_type` ist `application` oder `service`; verbinden Sie die anderen Portfolio-Tabellen über `app_id`, um nach Typ zu filtern.
- Die Blätter Portfolio Overview, Migration Waves, Migration Candidates und Cost vs Risk enden mit der Spalte `Assessment Type`; Source Data enthält `computed.assessment_type` (und `computed.seven_r_label`, sobald eine Anwendungs-App vorhanden ist).

Ein reiner Service-Workspace erzeugt dieselben Tabellen und Blätter wie bisher, abgesehen von der neuen Spalte. Die `.pbit`-Vorlagen oben lesen den Anwendungsexport (`swao export`) und bleiben unverändert; ein Power-BI-Modell über die Portfolio-Tabellen filtert über `dim_service_app.assessment_type`.

## CLI

```bash
swao export --app meine-app --formats csv,ndjson,xlsx
```

Siehe auch: [HTML veröffentlichen](/de/publish-html)
