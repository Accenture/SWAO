# 5. Publish HTML

Select option 5 from the main menu (or run `swao publish`) to generate a **self-contained HTML file** from your assessment results. The file works offline, in air-gapped environments, and as an email attachment: no server required.

## What the publication contains

| View | Audience | Content |
|---|---|---|
| Executive summary | Programme sponsor / CISO | 7R verdict, coverage score, top risks |
| Technical findings | Architect / developer | All signals with rationale and evidence links |
| Compliance view | DPO / compliance officer | Framework-specific control table |
| Auditor view | External / internal auditor | Audit log with timestamps and assessor identity |
| Evidence gallery | Reviewer | Screenshots and artefacts from dynamic analysis |
| Run log | Consultant | Duration, LLM cost, pass breakdown |

The publication includes a full-text search index built at generation time: no external search service.

![Publish screen in the terminal interface with the options Single HTML page and HTML Editor](./samples/14-tui-publish-html.png)
*The Publish screen in the terminal interface (menu option 5): a single self-contained HTML page, or the HTML Editor (Enterprise). Captured with an earlier SWAO version.*

## Sample publications

Three HTML publications for the Sovereign Health demo application, rendered from the public repository:

| Type | Description | Link |
|---|---|---|
| Application Assessment | Full GDPR and BSI C5 compliance report for a fictitious patient-management application. Signal findings, risk register and 7R migration strategy, all sourced from static and LLM analysis. | [Open live report](https://htmlpreview.github.io/?https://github.com/Accenture/SWAO/blob/main/examples/publications/2026-08-23T17-29-27-sovereign-health.html) |
| Landing Zone Assessment | Fit/gap analysis comparing EU sovereign and hyperscaler cloud providers for the Sovereign Health application. Shows which providers meet data-residency and compliance requirements. | [Open live report](https://htmlpreview.github.io/?https://github.com/Accenture/SWAO/blob/main/examples/publications/2026-08-24T11-36-12-sovereign-health-lz.html) |
| LLM Assessment | Multi-LLM sovereignty benchmarking report. Evaluates language models against data-residency, GDPR and BSI C5 requirements, with per-model verdicts and sourced rationale. | [Open live report](https://htmlpreview.github.io/?https://github.com/Accenture/SWAO/blob/main/examples/publications/2026-08-24-08-32-09-llm-assessment.html) |

## CLI

```bash
swao publish --app my-app
# Output: wsp/publications/latest/index.html
```

## Edition

<Badge type="tip" text="Consultant"/> <Badge type="warning" text="Enterprise"/>

Available in **Consultant** and **Enterprise** editions. The HTML Editor (`swao publish --edit`) is Enterprise only.

See also: [Generate Report](/generate-report) | [Export BI](/export-bi)
