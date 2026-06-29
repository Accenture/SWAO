# How SWAO Works

SWAO analyses a cloud application and produces an auditor-grade assessment report
in a single command -- or through the guided terminal interface. No external services,
no data uploads, no call-home.

---

## The guided interface (TUI)

When you run `swao` without arguments, the **terminal user interface** opens. It walks
you through every step without needing to remember commands.

### Main menu

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

### Setup Wizard

If this is your first time, start here. The wizard asks:

1. **Workspace name** -- a short identifier for the engagement folder.
2. **Application name** -- the workload you are assessing.
3. **Compliance frameworks** -- GDPR is pre-selected. Nine community frameworks are
   available (GDPR, AI 10 Pillars, COBIT 5, NIST SP 800-66 R2, ISO 27001, PCI DSS,
   SOC 2, BSI C5, DORA). Add more at any time via `swao framework install`.
4. **LLM provider** -- Anthropic Claude, OpenAI, a local Ollama model, or a deterministic
   stub for offline use.

The wizard creates a ready-to-use workspace folder on disk.

### Health Check

Before running an assessment, select **Health Check** (item 2) to verify that the workspace
is healthy. Each probe reports `ok` or a specific action to take:

| Probe | What it checks |
|---|---|
| Licence | Edition detected and valid |
| Playwright | Dynamic analysis readiness |
| MCP | Model Context Protocol server configuration |
| Compliance catalogues | Framework files present and consistent |
| Import templates | Ingestion folder structure |
| Traceability | Audit-grade signal fields enabled |
| BI export bundle | Previous export integrity |

> See also: [Sample Gallery -- Health Check](/en/samples/#sample-12)

### Run Assessment

Select **3. Run Assessment** from the main menu. SWAO asks which assessment type to run:

| Option | What it does |
|---|---|
| Application Assessment | Analyses your application source code |
| Landing Zone Assessment | Checks your cloud infrastructure configuration |
| Audit Assessment | Coming soon -- human-led audit |
| LLM Assessment | Coming soon -- AI model benchmarking |
| Hybrid Assessment | Coming soon -- combined source + audit |

Select an assessment type, confirm, and SWAO runs automatically. A live progress bar
shows each pass as it completes.

---

## The assessment pipeline

An **Application Assessment** runs up to 14 analysis passes. Each pass is independent
and auditable.

| Pass | What it does (business view) |
|---|---|
| 1. Inventory | Maps the languages, frameworks, and dependencies in your codebase |
| 2. State analysis | Identifies stateful components: databases, session storage, caches |
| 3. Data classification | Finds personal data fields, PII columns, residency markers |
| 4. Context ingestion | Reads your CMDB, workshop transcripts, and architecture docs |
| 5. SBOM | Produces a Software Bill of Materials with licence classification |
| 6. Twelve-factor | Checks cloud-readiness against the 12-factor application standard |
| 7. Egress analysis | Maps outbound calls and third-party data transfers |
| 8. Cryptography | Reviews hashing, TLS configuration, and secrets handling |
| 9. Migration synthesis | Synthesises a 7R verdict (Retire, Retain, Rehost, Replatform, Refactor, Re-architect, Repurchase) |
| 10. Compliance evaluation | Maps findings to the active compliance frameworks |
| 11. Landing zone readiness | Checks fit against your cloud landing zone requirements |
| 12. Security posture | Identifies common vulnerability patterns in the source code |
| 13. Dynamic analysis | Browser crawl for UI surface mapping |
| 14. Evidence gallery | Collects screenshots and artefacts for the audit record |

The first three passes (inventory, state, data classification) are deterministic --
no LLM required. Passes 4, 9, and 10 call the LLM to produce human-readable rationale
on every signal and compliance verdict.

---

## The HTML publication

After an assessment, SWAO generates a **self-contained HTML file** you can open in
any browser, email to a client, or use offline in an air-gapped environment.

The publication includes:

- **Executive view** -- 7R verdict, coverage score, top risks in plain language.
- **Technical view** -- all signals with derivation, evidence links, and pass breakdowns.
- **Compliance view** -- per-framework control table with outcome and rationale.
- **Auditor view** -- per-control audit record: outcome, rationale, evidence, assessor,
  timestamp. Filterable by framework and verdict.
- **Evidence gallery** -- screenshots and artefacts from the assessment, embedded for
  offline delivery.
- **Run history** -- duration, LLM cost, files assessed, per-pass breakdown.

The HTML file contains everything. No server, no internet connection, no account needed
to open it.

**To generate the publication:**

```bash
swao publish --app my-app
# opens: wsp/publications/latest/index.html
```

> See also: [Sample Gallery -- Publish HTML TUI](/en/samples/#sample-14) and [PowerBI dashboard screenshots](/en/samples/#sample-04)

---

## MCP integration

SWAO can connect to **Claude AI** via the **Model Context Protocol (MCP)**. Once
connected, you can ask Claude questions about your assessment findings in natural
language -- without leaving your conversation.

Example questions you can ask Claude after connecting:

- "What are the top compliance gaps for this application?"
- "Summarise the landing zone fit/gap findings."
- "Show me all signals assessed by the rule engine."
- "What is the 7R migration verdict and why?"

### How to connect

1. Run `swao doctor` (or select **2. Health Check** in the TUI) -- the MCP probe shows the server path.
2. In Claude Desktop: Settings > Developer > MCP Servers > Add. Paste the path.
3. Restart Claude Desktop.

> See also: [Sample Gallery -- MCP connector setup](/en/samples/#sample-15) and [MCP challenge in Claude](/en/samples/#sample-16)

SWAO starts the MCP server automatically when Claude connects. All assessment data
stays on your machine -- MCP only exposes a query interface, not the raw files.

Available tools via MCP:

| Tool | What it does |
|---|---|
| `swao_assess` | Trigger a new assessment from within Claude |
| `swao_report` | Get a structured summary of the latest assessment |
| `swao_signal_detail` | Look up a specific signal by ID |
| `swao_compliance_status` | Query compliance control outcomes by framework |
| `swao_lz_fit` | Get the landing zone fit/gap summary |
| `swao_run_history` | List recent assessment runs with cost and duration |

---

## PowerBI dashboards

The **BI export bundle** produced by every assessment is a set of 17 CSV tables in
a star-schema layout. Any BI tool can load it.

For **Power BI Desktop** users, SWAO ships pre-built templates in your workspace at
`wsp/templates/powerbi/`:

| Template | Tier | Pages |
|---|---|---|
| `swao-report.pbit` (single app) | Consultant + Enterprise | Overview, Compliance, Signals, Risks, Auditor, Run Stats |
| `swao-portfolio.pbit` (multi-app) | Enterprise | Portfolio Overview, App Heatmap, Compliance, Risk & 7R, Wave Sequencing, Auditor Roll-up |

To open a template:

1. Open the `.pbit` file in Power BI Desktop.
2. When prompted for `SWAOExportPath`, paste the path to the `star/` folder inside
   your latest assessment export.
3. Click **Load**. The dashboard refreshes with your data.

For step-by-step instructions on customising the template, see the
[Power BI authoring guide](/en/exports/powerbi).

---

## What stays on your machine

SWAO is **file-only** by design:

- No telemetry. No usage data sent anywhere.
- No hosted endpoint. The assessment engine runs entirely on your machine.
- No call-home. The binary does not check for updates or send error reports.
- LLM calls go directly from your machine to the provider you configured
  (Anthropic, OpenAI, or Ollama). SWAO does not proxy or store them.
- The HTML publication, BI export, and PowerBI dashboard are local files.
  Share them only when and how you choose.
