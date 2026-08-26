---
title: Getting Started with SWAO
audience: First-time users, consultants new to cloud migration assessment
version: 2026-07
related:
  - docs/assessment-dimension-catalogue.md
  - docs/runbooks/mcp-integration.md
  - docs/design/084-mcp-tool-reference-and-user-prompts.md

---

<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Getting Started
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# Getting Started with SWAO

## Who this guide is for

This guide is for consultants and engineers who are about to run their first
SWAO assessment and have not used a cloud migration assessment tool before. No
prior knowledge of cloud migration, regulatory compliance, or assessment
methodology is assumed. Every term is explained the first time it appears.

By the end of this guide you will be able to:

- Explain what SWAO does and why it exists
- Set up a workspace for a client application
- Run a complete assessment and read the results
- Generate a report and explain each finding to a stakeholder
- Know what to do when a result is unexpected or unclear

---

## Using SWAO through Claude Desktop (MCP)

SWAO exposes its full assessment engine as an MCP (Model Context Protocol) server.
When connected, Claude Desktop can run assessments, read signals, ingest evidence,
and apply overrides through natural-language prompts -- no command line needed.

### Connector setup

Add the following entry to your Claude Desktop config file:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "swao-mcp": {
      "command": "C:\\path\\to\\swao-enterprise-win.exe",
      "args": ["mcp"]
    }
  }
}
```

Replace the path with the location of your SWAO binary. Restart Claude Desktop
after saving. You should see "SWAO" under Connectors with a toggle switch, and
"Add from SWAO" in the attachment menu.

> Note: after every binary update, restart Claude Desktop to refresh the tool registry.

### Quick-start prompts for Claude Desktop

The table below gives the Claude Desktop equivalent for every CLI step in this guide.
All prompts assume the workspace has already been configured. Omit `at workspace ...`
if the MCP server already has the correct workspace loaded.

| Step | CLI command | Claude Desktop prompt |
|---|---|---|
| Check health | `swao doctor` | `Use swao_health_check at workspace C:\path\to\workspace.` |
| Show workspace | `swao ls` | `Use swao_workspace_inventory at workspace C:\path\to\workspace.` |
| Run assessment | `swao assess --app sovereign-health` | `Use swao_assess for sovereign-health at workspace C:\path\to\workspace.` |
| Run selected passes | `swao assess --app ... --passes inv,data,egr` | `Use swao_assess for sovereign-health, passes: inv,data,egr.` |
| Read report (all views) | `swao report --app ... --view exec` | `Use swao_report for sovereign-health, view business-owner.` |
| List signals | `swao signals --app ...` | `Use swao_signals for sovereign-health.` |
| Signal detail | `swao signal --id CTX-03` | `Use swao_signal_detail for sovereign-health, signal_id: CTX-03.` |
| Explain LZ choice | `swao lz-explain --app ...` | `Use swao_explain_landing_zone for sovereign-health.` |
| Run challenge | `swao challenge --app ... --agent compliance` | `Use swao_challenge for sovereign-health, agent: grc-compliance-officer.` |
| Ingest a document | `swao ingest --app ...` | `Use swao_ingest for sovereign-health. Category: compliance. Filename: dpa.md. Content: [text].` |
| Override a verdict | `swao feedback add ...` | `Use swao_feedback_add for sovereign-health. Target_type: signal. Target_id: CTX-03. Override_outcome: RISK_ACCEPTED. Rationale: [reason]. Author: you@accenture.com.` |
| Generate HTML report | `swao publish --app ...` | `Use swao_publish for sovereign-health, mode: html.` |
| Portfolio summary | `swao portfolio summary` | `Use swao_portfolio_summary at workspace C:\path\to\workspace.` |

Full tool reference and extended prompts: `docs/design/084-mcp-tool-reference-and-user-prompts.md`.

---

## Part 1: What SWAO does and why

### The problem SWAO solves

When a company wants to move an application from its own data centre to a
sovereign cloud (a cloud platform that meets European data-residency and
regulatory requirements), someone has to answer a long list of hard questions
first:

- Is this application technically ready to move?
- Does it use any services that are not available in the target cloud?
- Does it handle personal or regulated data in a way that must change?
- How long will the migration take and what will it cost?
- Which compliance frameworks (GDPR, HIPAA, BSI C5) apply and are they met?
- What happens if the migration goes wrong?

Traditionally, answering these questions requires several consultants, several
weeks of manual code review, and seven separate deliverables (architecture
review, cost model, compliance assessment, risk register, runbook, training
plan, infrastructure design) that are each produced separately and are
difficult to keep consistent with each other.

SWAO replaces that manual process with a single automated pipeline. It reads
the application's source code, its dependency list, its infrastructure
configuration, its incident history, its cloud spend data, and the notes from
stakeholder workshops -- then produces all seven deliverables simultaneously,
backed by a single machine-readable artefact called the Workload Sovereignty
Profile (WSP).

### What SWAO stands for

**Sovereign Workload Assessment and Onboarding**

- **Sovereign** -- all client data stays inside the client environment. No
  source code is uploaded to a public service. The tool runs on the client's
  infrastructure or in a client-approved container. Compliance requirements
  are built into the assessment from the start.
- **Workload** -- one application at a time is the unit of analysis.
- **Assessment** -- every finding is backed by a traceable source. SWAO does
  not produce opinions; it produces evidence-backed signals.
- **Onboarding** -- the assessment output feeds directly into cloud
  provisioning. SWAO generates Terraform templates and a service-catalogue
  entry so the migration plan triggers actual infrastructure, not another
  spreadsheet.

### What SWAO is not

SWAO is not a replacement for human judgement. It accelerates and structures
the assessment. A consultant still reviews the output, validates findings
against client knowledge, and makes the final recommendation. SWAO's job is
to surface the evidence so that conversation can happen in hours rather than
weeks.

---

## Part 2: Core concepts

Before running anything, understand these six terms. Every other concept in
SWAO is built on them.

### Application (workload)

The unit of analysis. One application = one repository of source code + its
runtime dependencies + its data + its operational history. SWAO assesses one
application at a time. A collection of applications assessed together is
called a portfolio.

### Workspace

A directory on your machine that holds everything SWAO needs to assess one
application. It contains:

- `.swao.yml`: the configuration file for this assessment (which application,
  which cloud provider, which data files to read)
- `imports/`: a folder where you place data files the client gives you (CMDB
  exports, incident reports, cost data, workshop notes)
- `source/`: where you clone or place the application's source code
- `wsp/`: created automatically when the assessment runs; contains the results

You create the workspace with `swao init`. You never need to create these
folders manually.

### Signal

A signal is a single finding that SWAO has discovered about the application,
backed by a specific piece of evidence. Think of it like a note a consultant
would write after reading the code: "I found an AWS-specific API call at
line 47 of data-provider.service.ts -- this service is not available in
European sovereign clouds."

Every signal has:
- An ID (e.g. `EGR-01`) that identifies which assessment pass produced it
- A label (a short human-readable finding)
- A confidence level (how certain SWAO is)
- An evidence reference (the exact source file, line, or document that
  proves the finding)

Signals are the building blocks of the entire assessment. Everything else
(scores, reports, migration plans) is derived from signals.

### Pass

A pass is one chapter of the assessment. SWAO runs up to 23 passes, each
focused on a different aspect of the application. The passes run in sequence
because later passes build on what earlier ones found.

| Pass group | What it looks at |
|---|---|
| INV (Inventory) | What is in the codebase: languages, frameworks, Docker, databases |
| STATE (Statefulness) | Does the application store data? How? Is it stateful or stateless? |
| DATA (Data Classes) | What categories of data does the application handle? (personal, medical, financial) |
| EGR (Egress) | Which external services does the application call? Are they available in the target cloud? |
| CRYPTO (Cryptography) | How does the application handle encryption, keys, and authentication? |
| SBOM (Dependencies) | What open-source libraries does it use? Are any vulnerable or legally restricted? |
| TF (Twelve-Factor) | Does the application follow cloud-native design principles? |
| CTX (Context) | What do the data files (CMDB, incidents, cost reports, workshop notes) say? |
| SYNTH (Synthesis) | Aggregates all signals into a migration verdict and a coverage score |
| OBS, LIC, QA, PAT, DBA, INT, IAM, DR | Observability, licences, quality, patterns, databases, integrations, identity, disaster recovery |
| LZR (Landing Zone) | Is the target cloud environment ready to receive this application? |
| DYN (Dynamic) | What does the running application actually do? (Playwright browser crawl) |

You do not need to understand every pass to start. INV, STATE, DATA, EGR, and
SYNTH are the core five that drive the primary verdict.

### Workload Sovereignty Profile (WSP)

The WSP is the master output of an assessment. It is a structured directory
of files (not a single document) that records everything SWAO learned about
the application: every signal, every evidence reference, the migration plan,
the risk register, the compliance posture, and the final verdict. It lives
in the `wsp/` folder inside your workspace.

The WSP is machine-readable, which means it can feed directly into platform
provisioning tools (Terraform, meshStack) without a manual handoff.

### Dimension

A dimension is a high-level score that summarises a group of signals into a
single number or verdict that a non-technical stakeholder can understand.
SWAO produces eight dimensions:

1. 7R Migration Pattern (what kind of migration is recommended)
2. Portability Score (what fraction of services can move to the target cloud)
3. Legacy Indicators (are there old technologies that block the migration?)
4. Data Migration Feasibility (can the data be transferred within the time window?)
5. CI/CD Pipeline Security (how secure is the delivery pipeline?)
6. Observability Readiness (can the application be monitored in the target cloud?)
7. Licence Compliance (are there open-source licence issues?)
8. Testing and Quality Maturity (is the test suite strong enough to catch migration regressions?)

Dimensions are explained in full in Part 5 of this guide.

---

## Part 3: Your first assessment, step by step

### Step 0: Check that everything is working

Before running any assessment, run the health check:

```
swao doctor
```

or, if you are using SWAO through Claude Desktop:

```
Use swao_health_check at workspace C:\path\to\workspace.
```

`swao doctor` checks that all the components SWAO needs are available and
configured:

- LLM provider: the language model SWAO uses to reason about code
- Credential store: where API keys are kept
- Playwright: the browser automation tool used for dynamic analysis
- Workspace layout: that the folder structure is correct
- Licence: that your SWAO licence is valid

All probes should show a green tick. If any probe fails, fix it before
continuing. The most common failure is a missing or expired LLM API key --
run `swao credential set` to update it.

### Step 1: Set up the workspace

Create a new workspace for the application you are assessing:

```
swao init --app <application-name>
```

Replace `<application-name>` with a short identifier for the application,
using only letters, numbers, and hyphens. For example: `sovereign-health` or
`medplum`.

This creates a folder called `<application-name>` with:

```
<application-name>/
├── .swao.yml          -- the configuration file you will edit
├── .swao.secrets.env  -- where you put credentials (never commit this file)
├── .gitignore         -- pre-configured to keep credentials and outputs out of git
├── imports/           -- put data files from the client here
└── source/            -- put the application source code here
```

### Step 2: Put the source code in place

Clone or copy the application's source code into the `source/` folder:

```
cd <application-name>
git clone <client-repository-url> source
```

If you do not have a git URL, copy the source files into `source/` manually.
SWAO reads the source code but never writes to it and never uploads it.

### Step 3: Add client data files to imports/

The `imports/` folder is where you put any data the client has given you.
SWAO reads these to enrich the assessment with real operational context.
None of these files are required -- the assessment can run without them --
but each one improves the quality of the findings.

Common files to add:

| File | What it is | Where to get it |
|---|---|---|
| `cmdb.csv` or `cmdb.xlsx` | A list of the application's servers, databases, and services | Client IT or configuration management team |
| `incidents.csv` | P1/P2 incident history for the past 6 months | ServiceNow export from the client |
| `cloudability.csv` | Monthly cloud spend by service | FinOps team or cloud billing portal |
| `arch-<date>.md` | Architecture document or design notes | Client engineering team |
| `workshops/<date>-<topic>.md` | Notes or transcript from a discovery workshop | Your own notes |

Drop the files into the `imports/` folder. SWAO will pick them up
automatically.

### Step 4: Configure .swao.yml

Open `.swao.yml` in a text editor. The file is pre-populated with a template.
Edit the values marked `# REQUIRED`:

```yaml
app:
  name: sovereign-health          # REQUIRED: must match the folder name
  target_url: "https://staging.sovereign-health.example"  # REQUIRED: non-production URL

landing_zone:
  provider: stackit               # REQUIRED: the target cloud (stackit, azure, aws, etc.)
  region: de-central-1            # REQUIRED: the target region
```

Leave everything else at its default for now. You can refine it after the
first assessment run.

### Step 5: Set credentials

SWAO needs an API key for the language model it uses to reason about code.
Store it in the credential store (not in `.swao.yml`):

```
swao credential set ANTHROPIC_API_KEY
```

You will be prompted to enter the key. It is stored encrypted and never
written to any file you might accidentally share.

### Step 6: Run the assessment

```
swao assess --app <application-name>
```

Or, from an AI assistant:

```
Run swao_assess for app sovereign-health at workspace /path/to/workspace
```

SWAO runs all the assessment passes in sequence. Depending on the size of
the application, this takes 5-30 minutes. You will see progress output for
each pass as it completes.

When the assessment finishes, the `wsp/` folder inside your workspace
contains the complete results.

### Step 7: Read the report

Generate a plain-language report from the assessment results:

```
swao report --app <application-name>
```

Or, from an AI assistant:

```
Run swao_report for app sovereign-health
```

The report shows:

- The migration verdict (the 7R label and what it means)
- The top three blockers (findings that must be resolved before migration)
- The key scores (portability, coverage, data feasibility)
- Recommended next steps
- A risk register summary

You can also request a report written for a specific audience:

```
swao report --app <application-name> --view exec
```

Available views:

| View ID | Audience | Emphasis | Claude Desktop prompt |
|---|---|---|---|
| `application-architect` (default) | Technical lead | All findings with full evidence | `Use swao_report for [app], view application-architect.` |
| `business-owner` | Business owner / programme sponsor | Business impact, cost, timeline | `Use swao_report for [app], view business-owner.` |
| `grc-compliance-officer` | GRC officer | Compliance verdicts, control gaps | `Use swao_report for [app], view grc-compliance-officer.` |
| `finops-lead` | FinOps lead | Cost model, spend reallocation | `Use swao_report for [app], view finops-lead.` |
| `programme-manager` | Programme manager | Workstream plan, dependencies, risks | `Use swao_report for [app], view programme-manager.` |

---

## Part 4: Understanding signals

### Reading a signal ID

Every signal has an ID that tells you which pass produced it and which finding
number it is within that pass. For example: `EGR-01`

- `EGR` is the pass prefix (Egress analysis)
- `01` is the sequence number within that pass

The signal prefixes you will see most often:

| Prefix | Pass | What it covers |
|---|---|---|
| `INV` | Inventory | Languages, frameworks, Docker images, database clients |
| `STATE` | Statefulness | Stateful components, session management, Redis/queue usage |
| `DATA` | Data classes | PII, medical data, financial data found in the codebase |
| `EGR` | Egress | External API calls, cloud-provider-specific services |
| `CRYPTO` | Cryptography | Encryption strength, key management, JWT configuration |
| `SBOM` | Dependencies | Vulnerable packages, end-of-life runtimes, licence flags |
| `TF` | Twelve-Factor | Configuration, logging, port binding, process model |
| `CTX` | Context | Signals derived from CMDB, incident history, cost data, workshops |
| `SYNTH` | Synthesis | Final 7R verdict, coverage score, key gaps |
| `OBS` | Observability | Monitoring, tracing, structured logging coverage |
| `LIC` | Licence | Copyleft, commercial, geographic restrictions |
| `QA` | Quality | Test coverage, flakiness, required PR checks |
| `DBA` | Database | Engine compatibility, stored procedures, migration complexity |
| `INT` | Integrations | Message brokers, ESB, synchronous vs asynchronous patterns |
| `IAM` | Identity | RBAC, service accounts, federation, privilege escalation paths |
| `DR` | Disaster Recovery | RTO/RPO gaps, backup strategy, failover evidence |
| `LZR` | Landing Zone | Target cloud readiness: quotas, policies, network |
| `DYN` | Dynamic | Runtime behaviour from browser crawl |

### Signal confidence levels

Every signal carries a confidence level:

| Level | What it means |
|---|---|
| `high` | SWAO found direct code evidence. The finding is reliable. |
| `medium` | SWAO inferred from indirect evidence (e.g. a package name implies a service). Verify before presenting. |
| `low` | Pattern match only; context evidence is ambiguous. Treat as a hypothesis to investigate. |

Low-confidence signals are not wrong -- they are prompts for human
investigation. When a signal is low-confidence, SWAO flags it as a data gap
and recommends gathering more context (a workshop, a CMDB entry, a network
flow export).

### What to do when a signal surprises you

If a signal appears that seems wrong -- for example, SWAO flags an AWS
service that the client says they no longer use -- do not delete the signal.
Instead:

1. Check the evidence reference in the signal (the file and line number)
2. Ask the client engineering team whether the reference is active or dead code
3. If the finding is confirmed as inactive, add a `context_override` in the
   workspace to record that decision with a reason

This keeps the audit trail intact while correctly adjusting the assessment.

---

## Part 5: Understanding the eight assessment dimensions

The dimensions are the scores that appear at the top of every report. They
translate the raw signal list into numbers and verdicts a stakeholder can act on.

### Dimension 1: 7R Migration Pattern

**What it answers:** What kind of migration is recommended for this application?

The 7R framework is the industry-standard vocabulary for cloud migration
decisions. SWAO assigns one of seven labels:

| Label | Plain-language meaning |
|---|---|
| Retire | The application is no longer needed. Decommission it instead of migrating. |
| Retain | The application cannot migrate yet. Keep it on-premise and set a review date. |
| Rehost | Move the application to the cloud with no changes. Also called lift-and-shift. |
| Replatform | Move with minor changes (for example, switch from a managed database to a cloud-native equivalent). |
| Repurchase | Replace the application with a commercial SaaS product. |
| Refactor | Rewrite parts of the application to be cloud-native before migrating. |
| Re-architect | Significant redesign required before migration can begin. |

The label comes with a confidence score (0.0 to 1.0). A confidence below 0.70
means SWAO does not have enough evidence to be certain -- gather more context
and re-run.

**What it means for the programme:**

- Rehost and Replatform: migration can begin in weeks. Low risk.
- Refactor: 2-6 months of engineering work before migration.
- Re-architect: 6-18 months. Escalate to architecture board.
- Retain: identify the specific blocker (regulatory, technical, cost). Set a
  review date. Do not let Retain become a permanent state without a decision.

---

### Dimension 2: Portability Score

**What it answers:** What fraction of the services this application uses are
available in the target sovereign cloud?

A portability score of 1.0 means every external service the application calls
has a sovereign-cloud equivalent. A score of 0.0 means none of them do.

**Score thresholds:**

| Score | Status | What to do |
|---|---|---|
| 0.85 and above | Sovereign-ready | Migration can proceed |
| 0.70 to 0.84 | Conditional | One or two services need validation or replacement |
| 0.50 to 0.69 | At risk | Multiple services need replacement before migration |
| Below 0.50 | Blocked | Significant remediation required |

**Common low-portability finding:**

The application calls an AWS-specific AI service (for example, Amazon
Comprehend Medical for medical text analysis). There is no direct equivalent
on European sovereign clouds. The service either needs to be replaced with
an EU-hosted alternative, or the feature that depends on it needs to be
disabled until an alternative is available. Either path adds time and cost to
the programme.

**How to talk about this to a client:**

"The portability score of 0.56 means that 44% of the external services
your application calls do not have a direct sovereign-cloud equivalent.
The good news is that two of these may be inactive in production. Once
we confirm that with your team, the score rises to 0.75 and the application
is in the conditional range -- one service left to resolve, which is
manageable."

---

### Dimension 3: Legacy Indicators

**What it answers:** Are there old technologies in this application that would
prevent or significantly complicate a migration?

SWAO classifies legacy findings into three tiers:

| Tier | Label | Migration impact |
|---|---|---|
| Tier 1 | Blocker | No sovereign-cloud equivalent. Full replacement required before migration can begin. Typically 12-24 months of engineering work. |
| Tier 2 | Complicator | A sovereign alternative exists, but migration takes significant effort (30-90 days per component). |
| Tier 3 | Manageable | Adds cost and time but does not change the overall migration verdict. |

**Common Tier 1 blockers:**

- IBM MQ (message broker with no sovereign-cloud equivalent)
- Oracle SOA Suite (middleware platform)
- TIBCO BusinessWorks (integration platform)
- COM/DCOM Windows dependencies (cannot run in a Linux container)

**If no legacy blockers are found:** Record this explicitly. "Legacy-clear"
is a positive differentiator for a client application -- it means the
migration is not gated by technology debt.

---

### Dimension 4: Data Migration Feasibility

**What it answers:** Can the application's data be transferred to the target
cloud within the agreed maintenance window?

SWAO estimates the data volume (from CMDB, FinOps, or STATE signals) and
divides it by a realistic data transfer rate to produce a feasibility ratio.

| Feasibility ratio | Verdict | Implication |
|---|---|---|
| Below 1.0 | Feasible | A single-window cutover is achievable |
| 1.0 to 2.0 | Marginal | Consider an off-peak window or incremental approach |
| 2.0 to 5.0 | Requires phased migration | A Change Data Capture bridge is needed |
| Above 5.0 | Major data migration programme | A dedicated data migration workstream is needed |

**What a phased migration means in practice:**

Instead of copying all data on a Saturday night and switching over on Sunday
morning, a CDC bridge keeps a replica of the database continuously
synchronised with the source. The actual cutover (the point where the
application switches from the old database to the new one) then takes minutes
rather than hours, because the data is already there.

---

### Dimension 5: CI/CD Pipeline Security

**What it answers:** How secure is the application's build and deployment
pipeline? (This matters during migration because the pipeline will be
modified, new credentials will be provisioned, and the deployment path will
change.)

SWAO checks eight security rules (PP-R-01 to PP-R-08):

| Rule | What it checks |
|---|---|
| PP-R-01 | GitHub Actions are pinned to a specific SHA (not a floating version tag) |
| PP-R-02 | Workflow permissions are scoped to the minimum required |
| PP-R-03 | Secrets are injected via OIDC or secret manager (not hardcoded) |
| PP-R-04 | Self-hosted runners have network isolation |
| PP-R-05 | Third-party actions are from verified publishers |
| PP-R-06 | OIDC token scope is restricted |
| PP-R-07 | Build containers do not run as privileged |
| PP-R-08 | Secrets are never echoed to logs |

Results are reported as a count of findings by severity (critical, high,
medium, low). There is no aggregate score -- the severity distribution drives
the recommendation.

---

### Dimension 6: Observability Readiness

**What it answers:** Can the application be monitored in the target cloud?

An application that cannot be observed in production cannot be safely
migrated. If something goes wrong during or after the migration, the team
needs to know immediately. SWAO checks eight instrumentation areas:

1. HTTP layer (request traces, error rates, latency)
2. Background job queues (job success/failure rates)
3. Database query performance
4. External service calls (timeouts, error rates per dependency)
5. Error tracking (Sentry or equivalent)
6. Distributed tracing (connecting a request across multiple services)
7. Custom business metrics (application-specific KPIs)
8. Structured log output (machine-readable logs, not free text)

**Score threshold:** 0.60 (at least 5 of 8 areas covered) is the minimum
recommended before a migration goes live. Below that, the team cannot
reliably detect regressions.

---

### Dimension 7: Licence Compliance

**What it answers:** Are there open-source software licences in the
application's dependency tree that could create legal problems?

The most common finding is AGPL (GNU Affero General Public License).
AGPL requires that any organisation running the software over a network must
make its own source code publicly available. In a client-hosted sovereign
cloud deployment, this can create obligations the client did not anticipate.

Verdicts:

| Verdict | Meaning |
|---|---|
| clear | No licence conflicts found |
| advisory | Copyleft licences present; legal review recommended before go-live |
| blocked | Licence conflict requires remediation before migration |

---

### Dimension 8: Testing and Quality Maturity

**What it answers:** Does the application have a test suite strong enough to
catch regressions introduced by the migration?

Migrations change infrastructure, environment variables, database engines,
and network topology. An application without a reliable test suite cannot
validate that the migrated version behaves identically to the original.

| Score | Status | Interpretation |
|---|---|---|
| 0.80 and above | Mature | Migration risk from regressions is low |
| 0.60 to 0.79 | Developing | Address coverage gaps in critical paths before migration |
| Below 0.60 | Immature | A manual regression testing plan is required |

---

## Part 6: Common questions

**Q: The assessment says the 7R verdict is Retain. What does that mean for
the engagement?**

It means SWAO found at least one blocker that prevents migration. Check the
risk register in the report for the specific reason. Common reasons: a Tier 1
legacy dependency, a portability score below 0.50, or a regulatory constraint
(data that legally cannot leave a specific jurisdiction). The Retain verdict
is not a dead end -- it is a scoped problem. Work with the client to resolve
the specific blocker and re-run the assessment.

**Q: A signal has high confidence but the client says it is wrong. What do I do?**

Verify the evidence reference first (the specific file and line in the
codebase). If the code evidence is real but the situation has changed (for
example, the client has already replaced the flagged library), record a
context override in `.swao.yml` with the reason. If the evidence reference
is a false positive (SWAO misread the code), file a gap note. Do not ignore
the signal without recording a decision.

**Q: The coverage score is below 0.75. Is this a problem?**

Coverage score measures what fraction of signals are backed by high-confidence
evidence. Below 0.75, the assessment is relying heavily on inference rather
than direct evidence. This is common early in an engagement when context data
files (CMDB, incidents) are not yet available. Add the missing context files
to `imports/` and re-run to improve the score.

**Q: The assessment mentions DORA compliance. What is DORA?**

DORA (Digital Operational Resilience Act) is a European Union regulation that
applies to financial services companies. It requires that critical IT systems
have tested disaster recovery plans, defined recovery time objectives, and
documented third-party risk management. If the application is in scope for
DORA, SWAO flags any gaps in the DR and IAM passes.

**Q: What is a landing zone and why does the LZR pass matter?**

A landing zone is the cloud environment that has been prepared to receive the
migrated application: the virtual network, the identity configuration, the
resource quotas, the security policies. The LZR pass checks whether this
environment is actually ready. A green LZR result means the team can proceed
to provisioning. A blocked LZR result means the target environment needs
work before the application can move.

**Q: I ran swao_challenge after the assessment. What does it do?**

The challenge session runs five AI agents that each represent a stakeholder
perspective. The five canonical persona IDs:

| CLI / MCP ID | Stakeholder | Claude Desktop prompt |
|---|---|---|
| `application-architect` | Technical lead | `Use swao_challenge for [app], agent: application-architect.` |
| `business-owner` | Business owner / sponsor | `Use swao_challenge for [app], agent: business-owner.` |
| `grc-compliance-officer` | GRC / compliance officer | `Use swao_challenge for [app], agent: grc-compliance-officer.` |
| `finops-lead` | FinOps lead | `Use swao_challenge for [app], agent: finops-lead.` |
| `programme-manager` | Migration / programme manager | `Use swao_challenge for [app], agent: programme-manager.` |

The same five IDs drive `swao report --view <id>`. Legacy aliases
(`technical`, `exec`, `compliance`, `finops`, `migration-manager`) are still
accepted but print a deprecation warning.

Each agent reads the WSP and generates the hardest questions that stakeholder
would ask in a review meeting. This helps the consulting team prepare for
client challenges before they happen. It is especially useful before
presenting findings to a sceptical or technically sophisticated client team.

**Q: How long does an assessment take?**

Initial setup (workspace init, credentials, source code): 15-30 minutes.
Assessment run (all passes): 5-30 minutes depending on application size and
LLM provider speed. Report generation: under a minute. Total active time
for a first assessment: 1-2 hours. Subsequent iterations (after adding more
context data): 15-30 minutes each.

---

## Part 7: What to do after your first assessment

1. **Read the blockers first.** The report lists the top findings by severity.
   Start with the critical and high-severity items. These are the things that
   will delay or block the migration if not addressed.

2. **Share the executive view with the client sponsor.** Run
   `swao report --view exec` and walk through it with the business owner.
   Avoid technical jargon. Lead with the 7R verdict, the timeline implication,
   and the top two or three risks.

3. **Schedule a technical deep-dive for the findings.** The default technical
   report is the input for a session with the client engineering team. Go
   through the portability blockers and legacy indicators together. They will
   often have context that resolves low-confidence signals.

4. **Add context data and iterate.** After the first conversation, ask the
   client for the data files you are missing (CMDB, incidents, FinOps). Drop
   them in `imports/` and re-run. Watch the coverage score rise as each
   file is added.

5. **Run the challenge session before the final presentation.** Use
   `swao challenge --app <name> --agent compliance` (and other agents) to
   stress-test the findings from each stakeholder perspective before you sit
   in the room with them.

6. **Generate the Terraform templates when the plan is finalised.** Once the
   7R verdict is confirmed and the risk register is agreed, run
   `swao generate-tf` to produce the infrastructure-as-code templates for the
   target landing zone.
