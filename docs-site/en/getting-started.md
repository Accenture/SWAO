# SWAO -- Quick Start

**Read time:** 5 minutes. **Install to first assessment:** about 15 minutes.

SWAO is a sovereign workload assessment platform. Given a cloud application, it
produces: an audit-grade assessment report, a PowerBI dashboard, an HTML publication,
and a 7R migration verdict -- with full traceability on every signal and compliance verdict.

---

## Prerequisites

- Windows / macOS / Linux with **Node.js >= 20**
- A workload to assess (your own repo, or the example workspace bundled with SWAO)
- Optional: **Anthropic API key** for real-LLM analysis. Without it, use `--llm-stub`
  for deterministic offline output.
- Optional: **PowerBI Desktop** (Windows only) to open the resulting dashboard.

---

## Install

```bash
cd packages/swao
npm install
npm run build
npm link
```

Verify:

```bash
swao --version
# SWAO -- Sovereign Workload Assessment & Onboarding v0.4.8 (Community)
```

---

## First assessment -- via the guided interface

Run `swao` with no arguments to open the terminal user interface:

```bash
swao
```

The main menu appears:

```
SWAO -- Sovereign Workload Assessment and Onboarding
Community  v0.4.8

  1  Workspace Setup       init + LLM + credentials wizard
  2  Health Check          swao doctor
  3  Run Assessment        Application / Audit / Landing Zone + more
  4  Generate Report       swao report (text / PDF)
  5  Publish HTML          swao publish -- self-contained HTML file
  6  Export BI             star schema / PowerBI / Tableau
  7  Portfolio Operations  multi-app aggregate (Premium)
  8  Generate TF Modules   swao generate-tf
  9  Tools                 lenses / licence / credentials / help
  0  Exit
```

Use the arrow keys or type the number to navigate.

> See also: [Sample Gallery -- TUI Main Menu](/en/samples/#sample-10)

### Step 1: Workspace Setup

Select **1. Workspace Setup**. The wizard asks four questions:

1. **Workspace name** -- a short identifier for the engagement folder (e.g. `my-engagement`).
2. **Application name** -- the workload you are assessing (e.g. `my-app`).
3. **Compliance frameworks** -- choose from the available community frameworks. GDPR is
   pre-selected. More can be added at any time via `swao framework install`.
4. **LLM provider** -- Anthropic Claude, OpenAI, a local Ollama model, or a stub for
   offline testing.

The wizard creates the workspace folder and configuration on disk. No further setup needed.

### Step 2: Health Check

Select **2. Health Check** from the main menu. Seven probes run and each reports `ok`
or a specific action to take:

| Probe | What it checks |
|---|---|
| Licence | Edition detected and valid |
| Playwright | Dynamic analysis readiness |
| MCP | Model Context Protocol configuration |
| Compliance catalogues | Framework files present and consistent |
| Import templates | Ingestion folder structure |
| Traceability | Audit-grade signal fields enabled |
| BI export bundle | Previous export integrity |

All probes green means you are ready to assess.

> See also: [Sample Gallery -- Health Check](/en/samples/#sample-12)

### Step 3: Run Assessment

Select **3. Run Assessment** from the main menu. Choose **Application Assessment** (the
full source-code pipeline). SWAO runs automatically -- a live progress bar shows each pass.

Typical duration and cost:

| Workload size | Duration (real Anthropic) | Cost (real Anthropic) |
|---|---|---|
| Small (<100 files) | ~30 sec | ~$0.02 |
| Medium (~1,000 files) | 3-5 min | ~$0.10 |
| Large (~10,000 files) | 10-15 min | ~$0.50 |

Anthropic prompt-caching makes re-runs effectively free: a 3-month engagement running
SWAO weekly costs single-digit dollars in tokens.

### Step 4: View your results

When the assessment finishes, open the HTML publication:

```
wsp/publications/latest/index.html
```

The publication includes an executive summary, full signal trace, compliance table,
and auditor view -- all in a single self-contained file you can email or use offline.

---

## See the PowerBI dashboard

If you have PowerBI Desktop, the `.pbit` template is in your workspace:

```
wsp/templates/powerbi/swao-report.pbit
```

Open it in PowerBI Desktop. When prompted for `SWAOExportPath`, paste the path to
the `star/` folder inside your latest export:

```
C:\my-engagement\apps\my-app\wsp\exports\2026-05-11T12-00-00\star
```

Click **Load**. Six pages render: Overview, Compliance, Signals, Risks, Auditor, Run Stats.

For portfolio assessments (multiple apps), use `swao-portfolio.pbit` with parameter
`SWAOPortfolioExportPath`. See the [Power BI guide](/en/exports/powerbi) for
multi-bundle workflows.

No PowerBI? Open `wsp/exports/<ts>/xlsx/swao-export.xlsx` in Excel for the same data
in an 18-sheet workbook.

---

## What you have produced

After the steps above, your workspace holds:

```
wsp/
+-- runs/<timestamp>/
|   +-- passes/01-inv.yaml ... 14-evidence.yaml
|   +-- run-manifest.json    LLM provider, cost, schema version
+-- exports/<timestamp>/
|   +-- star/                17 CSVs (star schema, UTF-8 BOM)
|   +-- ndjson/              17 mirror files for ETL pipelines
|   +-- xlsx/swao-export.xlsx
|   +-- manifest.yaml        SHA-256 + row counts per file
+-- publications/latest/
|   +-- index.html           self-contained HTML report
+-- reports/auditor.md       Markdown audit report
```

Every signal carries: **outcome**, **derivation**, **false_positive_considered**,
**assessor** (rule_engine or llm), and **assessed_at** (ISO timestamp).

---

## Alternatively: via the command line

The same steps can be run directly from the terminal:

```bash
# 1. Create workspace
swao init --name my-app

# 2. Set LLM key
swao credential set anthropic-api-key

# 3. Select compliance frameworks
swao framework install GDPR

# 4. Pre-flight check
swao doctor

# 5. Assess + export
swao assess --app my-app
swao export --app my-app --formats csv,ndjson,xlsx
```

---

## Next steps

| You want to | Read |
|---|---|
| Re-run with a new export in PowerBI | [Power BI guide](/en/exports/powerbi) |
| Add a compliance framework | `swao framework install <id>` or add a YAML file in `catalogs/community/` |
| Run a portfolio assessment | `swao export --portfolio` (Consultant/Enterprise tier) |
| Connect Claude AI via MCP | [How it works -- MCP](/en/how-it-works) |
| Share findings | Open `wsp/publications/latest/index.html` |

---

## Help

```bash
swao --help
swao <command> --help
swao doctor
```

SWAO is **file-only on disk** -- no telemetry, no hosted endpoint, no call-home.
Your source code never leaves your machine.
