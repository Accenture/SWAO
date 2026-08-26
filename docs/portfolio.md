# 7. Portfolio Operations

Portfolio Operations (option 7 in the main menu) aggregate assessment results across multiple applications in a single workspace. Available in **Consultant** and **Enterprise** editions.

## What portfolio mode provides

| Capability | Description |
|---|---|
| Multi-app assessment | Run assessments across all apps in a workspace in sequence or in parallel |
| Aggregated risk register | Cross-application finding list, deduplicated and ranked |
| Portfolio compliance matrix | Framework coverage across every assessed app |
| Migration wave planning | Dependency-aware sequencing for phased cloud migration |
| Portfolio Power BI dashboard | `swao-portfolio.pbit` with heatmap and wave views (Enterprise) |

## CLI

```bash
# Assess all apps in the workspace
swao assess --portfolio

# Export aggregated BI bundle
swao export --portfolio --formats csv,xlsx

# Open the portfolio dashboard
# Open wsp/templates/powerbi/swao-portfolio.pbit in Power BI Desktop
```

## Edition

Full portfolio operations require **Consultant** or **Enterprise**. The Community edition can run individual assessments in the same workspace folder but does not aggregate results.

See also: [Export BI](/export-bi) | [Features & Editions](/features)
