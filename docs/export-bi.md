# 6. Export BI

Select option 6 from the main menu (or run `swao export`) to generate a structured data export bundle for use in Power BI, Tableau, Excel, or any other BI tool.

## Export formats

| Format | Contents | Use case |
|---|---|---|
| CSV (star schema) | 17 fact and dimension tables | Power BI Desktop, Tableau, Excel |
| NDJSON | Newline-delimited JSON mirror of the CSV tables | Data pipelines, dbt, custom tooling |
| XLSX | Single-workbook rollup | Quick review, stakeholder sharing |

## Pre-built Power BI templates

Two `.pbit` templates are included in your workspace under `wsp/templates/powerbi/`:

| Template | Edition | Pages |
|---|---|---|
| `swao-report.pbit` | Consultant + Enterprise | Overview, Compliance, Signals, Risks, Auditor, Run Stats |
| `swao-portfolio.pbit` | Enterprise | Portfolio overview, heatmap, compliance, risk and 7R, wave sequencing |

Open the `.pbit` file in Power BI Desktop, set `SWAOExportPath` to your `star/` folder, and click **Load**.

## CLI

```bash
swao export --app my-app --formats csv,ndjson,xlsx
```

See also: [PowerBI authoring guide](/templates/AUTHORING-GUIDE) | [Publish HTML](/publish-html)
