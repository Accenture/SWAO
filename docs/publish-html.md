# 5. Publish HTML

Select option 5 from the main menu (or run `swao publish`) to generate a **self-contained HTML file** from your assessment results. The file works offline, in air-gapped environments, and as an email attachment -- no server required.

## What the publication contains

| View | Audience | Content |
|---|---|---|
| Executive summary | Programme sponsor / CISO | 7R verdict, coverage score, top risks |
| Technical findings | Architect / developer | All signals with rationale and evidence links |
| Compliance view | DPO / compliance officer | Framework-specific control table |
| Auditor view | External / internal auditor | Audit log with timestamps and assessor identity |
| Evidence gallery | Reviewer | Screenshots and artefacts from dynamic analysis |
| Run log | Consultant | Duration, LLM cost, pass breakdown |

The publication includes a full-text search index built at generation time -- no external search service.

## CLI

```bash
swao publish --app my-app
# Output: wsp/publications/latest/index.html
```

## Edition

Available in **Consultant** and **Enterprise** editions.

See also: [Generate Report](/generate-report) | [Export BI](/export-bi)
