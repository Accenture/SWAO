---
layout: home

hero:
  name: SWAO
  text: Sovereign Workload Assessment and Onboarding
  tagline: Audit-grade cloud workload assessments in a single command. No telemetry. No call-home. Your data stays on your machine.
  image:
    src: /swao-icon-512.png
    alt: SWAO logo
  actions:
    - theme: brand
      text: Quick start (5 min)
      link: /quick-start
    - theme: alt
      text: Features & Editions
      link: /features
    - theme: alt
      text: How it works
      link: /how-it-works

features:
  - title: Four assessment types
    details: Application, Service Portfolio, Landing Zone Catalog, and LLM Assessment. Every assessment type runs in every edition.
  - title: Bring your own LLM
    details: Anthropic Claude, OpenAI, Ollama, or run with `--skip-llm` to skip LLM passes for fully offline assessments. LLM access is included in every edition.
  - title: Audit-grade traceability
    details: Every signal carries outcome, derivation, assessor identity, false-positive consideration, and timestamp. Defensible against external auditors.
  - title: HTML publication
    details: A self-contained HTML file with executive, technical, compliance, and auditor views. Works offline, in air-gapped environments, and in email. Consultant and Enterprise editions.
  - title: PowerBI dashboards
    details: Star-schema export for any BI tool in every edition; pre-built Power BI templates in the Consultant and Enterprise editions.
  - title: MCP integration
    details: Ask Claude AI questions about your assessment findings in natural language via the Model Context Protocol. Enterprise edition.
---

<div class="swao-release-banner">

**Latest release:** download the current binaries and read the release notes on the [SWAO releases page on GitHub](https://github.com/Accenture/SWAO/releases/latest).

</div>

## What you get

<div class="swao-outputs">
<div class="swao-output">

![SWAO HTML publication of an LLM Assessment for the demo application sovereign-health](/home/html-publication.png)

### HTML publication

A single self-contained HTML file with executive, technical, compliance and auditor views. Open it in any browser, send it by email or use it offline.

<span class="swao-edition">Consultant and Enterprise</span>

[Publish HTML](/publish-html)

</div>
<div class="swao-output">

![SWAO Power BI report, risks page, for the demo application sovereign-health](/home/power-bi-dashboard.png)

### Power BI dashboards

Pre-built Power BI templates on top of the star-schema export: overview, compliance, signals, risks and auditor pages. The star schema itself is available in every edition.

<span class="swao-edition">Consultant and Enterprise</span>

[Export BI](/export-bi)

</div>
<div class="swao-output">

![An AI assistant answering a question about the GDPR findings of the demo application sovereign-health through the SWAO MCP server](/home/mcp-chat.png)

### MCP and SWAO Chat

Ask questions about your assessment findings in natural language, from an AI assistant through the Model Context Protocol or in the built-in SWAO Chat.

<span class="swao-edition">Enterprise</span>

[MCP server](/runbooks/mcp-integration)

</div>
</div>

---

## Editions at a glance

| | Community | Consultant | Enterprise |
|---|---|---|---|
| All four assessment types, unlimited single-application runs | Yes | Yes | Yes |
| Bring your own LLM, or run fully offline | Yes | Yes | Yes |
| Text and Markdown reports, BI export bundle (star schema) | Yes | Yes | Yes |
| HTML publication, PDF report, Power BI templates | - | Yes | Yes |
| Portfolio assessment, reporting and BI export | - | - | Yes |
| MCP server, SWAO Chat, adversarial challenge review | - | - | Yes |

Community is Apache 2.0 and needs no activation. See [Features & Editions](/features) for the full comparison.

---

## What is SWAO?

SWAO analyses cloud applications and infrastructure and produces an auditor-grade
assessment report. It combines static code analysis, LLM-driven compliance evaluation,
and context ingestion from your CMDB and operational documents, and outputs a full
traceability chain from source evidence to compliance verdict.

**File-only on disk.** No telemetry, no hosted endpoint, no call-home. Your source
code and assessment data never leave your machine. Bring your own LLM provider.

---

## Assessment types

| Type | Status | What you get |
|---|---|---|
| [Application Assessment](/assessment/application) | Available | Analysis passes over the application source code and its operational context, with every finding traced to file, derivation and assessor. You get per-control compliance verdicts for your active frameworks, a 7R migration recommendation and a landing zone fit. |
| [Service Portfolio Assessment](/service-assessment/) | Available | Assesses bought, rented and operated applications (third-party, COTS, SaaS, legacy servers) from a spreadsheet intake, without source code. Each application gets researched vulnerabilities and end of life, scores across eleven portfolio domains and a TIME recommendation; the portfolio gets migration waves and vendor consolidation. |
| [Landing Zone Catalog Assessment](/assessment/landing-zone) | Available | Checks whether one or more cloud provider regions can host the application under the sovereignty requirements of your active frameworks. You get a per-service fit/gap verdict and an overall verdict per target; the assessment is deterministic and makes no LLM calls. |
| [LLM Assessment](/assessment/llm) | Available | Reruns a completed Application Assessment with 2 to 5 LLM models side by side to find the model that does SWAO's assessment work best on your application. You get a comparison of quality, reliability, speed, cost and security behaviour, a weighted final ranking and a findings log. |

---

## Questions and licence requests

Open a [GitHub Discussion](https://github.com/Accenture/SWAO/discussions) or [raise an issue](https://github.com/Accenture/SWAO/issues).
For licence enquiries, email [swao-tool@accenture.com](mailto:swao-tool@accenture.com?subject=SWAO%20Licence%20Enquiry).
