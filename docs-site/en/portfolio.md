# Portfolio Operations

Portfolio Operations provides an aggregate view across all applications in your workspace,
enabling you to compare findings, plan migration waves, and produce a portfolio-level
compliance picture for executive and regulatory audiences.

This feature is available in the **Enterprise** edition.

Access from the TUI main menu by pressing **7**.

---

## What it does

Where individual application assessments give you deep-dive findings for one application,
Portfolio Operations combines them into a single coherent view:

- **Aggregate risk register** -- all risks from all applications in one ranked list.
- **Cross-app compliance matrix** -- every framework control mapped against every application
  so you can see which controls are consistently passing and where portfolio-wide gaps exist.
- **Migration wave planning** -- applications grouped and sequenced for migration based on
  their 7R verdicts, risk scores, and dependency relationships.
- **Portfolio BI export** -- the portfolio star schema that feeds the Power BI portfolio
  dashboard (aggregated across all apps in `wsp/exports/latest/star/`).

---

## Running a portfolio export

After you have assessed all applications in the workspace, generate the portfolio export:

```
swao export --portfolio
```

This aggregates the individual star-schema bundles into a single portfolio-level export
ready for the Power BI portfolio template.

---

## Portfolio Power BI dashboard

The portfolio dashboard gives stakeholders a single view of the entire estate:

| Page | What it shows |
|---|---|
| Portfolio Overview | Total apps, average coverage, apps with critical risk, 7R distribution |
| Compliance | Cross-app compliance matrix by framework |
| Signals | Portfolio signal browser |
| Auditor Roll-up | Per-app rationale coverage and cross-app compliance status |
| Run Stats | Aggregate timing and LLM cost |

See [Export BI](/en/export-bi) for instructions on connecting the dashboard template to
your portfolio export.

---

## Wave planning

Portfolio Operations groups applications into migration waves based on:

- **Risk score** -- high-risk applications are typically addressed first.
- **7R verdict** -- applications with the same strategy are grouped together.
- **Dependencies** -- applications that depend on each other are placed in the same wave
  or in immediately consecutive waves.

Wave assignments are visible in the portfolio Power BI dashboard and are included in the
portfolio export bundle for use in external planning tools.
