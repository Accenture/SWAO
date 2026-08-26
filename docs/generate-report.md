# 4. Generate Report

After an assessment completes, select option 4 from the main menu (or run `swao report`) to generate a structured text report from the Workload Sovereignty Profile.

## Report formats

| Format | Description | Edition |
|---|---|---|
| Text / Markdown | Plain-text summary and `auditor.md` for auditors | All |
| YAML | Machine-readable signal dump | All |
| JSON | Full WSP export for downstream tooling | All |
| PDF | Rendered PDF of the full assessment | Consultant + Enterprise |

## CLI

```bash
# Text report (default)
swao report --app my-app

# PDF report (requires Playwright)
swao report --app my-app --format pdf

# All formats
swao report --app my-app --format text,pdf,yaml,json
```

## Output location

Reports are written to `wsp/reports/<run-id>/` inside your workspace folder.

See also: [Publish HTML](/publish-html) | [Export BI](/export-bi)
