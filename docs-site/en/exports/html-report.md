---
title: HTML Report
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->

# HTML Report

SWAO generates a self-contained single-page HTML report after every assessment. The report
is portable (one file, no external dependencies), suitable for audit submissions, and
readable in any modern browser.

## Generating the Report

Generate automatically at the end of an assessment:

```bash
swao assess --app <name>
```

Re-generate from the most recent assessment result without re-running the analysis:

```bash
swao report
```

Open the report in your default browser immediately after generation:

```bash
swao report --open
```

Write to a specific path:

```bash
swao report --output ./audit/gdpr-q2-2026.html
```

## Report Structure

The HTML report is a single page divided into five sections:

```
+--------------------------------------------------+
|  SWAO Assessment Report                          |
|  payment-service  |  GDPR  |  2026-06-25         |
+--------------------------------------------------+
|  EXECUTIVE SUMMARY                               |
|  24 findings  |  3 CRITICAL  |  8 HIGH           |
|  Compliance score: 61%                           |
+--------------------------------------------------+
|  CONTROL DOMAIN BREAKDOWN                        |
|  Data Protection        6 / 9   (67%)  [====   ] |
|  Access Control         4 / 5   (80%)  [======= ] |
|  Incident Management    3 / 4   (75%)  [======  ] |
|  Third-country Transfer 1 / 3   (33%)  [==      ] |
+--------------------------------------------------+
|  FINDING CARDS  (filterable, sortable)           |
|  Each card shows: Control ID, status, severity,  |
|  evidence excerpt, source file:line reference    |
+--------------------------------------------------+
|  APPENDIX: Full evidence log                     |
+--------------------------------------------------+
```

### Executive Summary

The summary panel shows total finding counts grouped by status (PASS / FAIL / WARN) and
severity (CRITICAL / HIGH / MEDIUM / LOW), plus a percentage compliance score calculated
as `PASS / (PASS + FAIL)`.

### Control Domain Breakdown

A table and horizontal progress bars for each control domain in the assessed framework,
showing how many controls passed out of the total applicable.

### Finding Cards

One card per finding, expandable to show the full evidence. Each card contains:

- **Control ID** and name (e.g. `ART-5 -- Data minimisation`)
- **Status** badge: PASS / FAIL / WARN / INFO / SKIP
- **Severity** badge: CRITICAL / HIGH / MEDIUM / LOW
- **Evidence excerpt**: the specific code or configuration fragment that triggered the finding
- **Source reference**: `path/to/file.ts:line` (clickable if viewed from the workspace directory)
- **Recommendation**: remediation guidance from the framework control definition

### Appendix

A plain-text log of all evidence fragments captured during the assessment run, in the order
they were processed. Useful for providing a complete audit trail.

## Filtering and Sorting

The HTML report includes an embedded filter panel (no server required):

- Filter by **status**, **severity**, or **control domain**
- Sort by **severity** (default), **control ID**, or **status**
- Search across control names and evidence text

All filters are client-side JavaScript -- the file works offline.

## Sharing the Report

Because the report is a single self-contained HTML file, you can:

- Attach it directly to a Jira ticket or email
- Commit it to a `reports/` directory in version control
- Upload it to SharePoint or a shared drive
- Serve it via SWAO's `swao report --open` command

The file contains no external resource links. It renders identically across environments.

## Customising the Report

Report branding (logo, colour scheme, company name) can be configured in `.swao.yml`:

```yaml
report:
  title: "Q2 2026 GDPR Assessment"
  logo: ./docs/brand/logo.png
  theme: dark
```

Available themes: `dark` (default), `light`.
