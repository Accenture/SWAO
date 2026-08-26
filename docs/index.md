=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Overview

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
---
layout: home

hero:
  name: SWAO
  text: Sovereign Workload Assessment and Onboarding
  tagline: Audit-grade cloud workload assessments in a single command. No telemetry. No call-home. Your data stays on your machine.
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
  - title: Five assessment types
    details: Application Assessment, Landing Zone Assessment, and LLM Assessment are available now. Audit and Hybrid assessments are on the roadmap.
  - title: Bring your own LLM
    details: Anthropic Claude, OpenAI, Ollama, or a deterministic stub for offline use. LLM access is included in every edition.
  - title: Audit-grade traceability
    details: Every signal carries outcome, derivation, assessor identity, false-positive consideration, and timestamp. Defensible against external auditors.
  - title: HTML publication
    details: A self-contained HTML file with executive, technical, compliance, and auditor views. Works offline, in air-gapped environments, and in email.
  - title: PowerBI dashboards
    details: Pre-built templates for single-app and portfolio assessments. Star-schema CSV export works with any BI tool.
  - title: MCP integration
    details: Ask Claude AI questions about your assessment findings in natural language via the Model Context Protocol.
---

## What is SWAO?

SWAO analyses cloud applications and infrastructure and produces an auditor-grade
assessment report. It combines static code analysis, LLM-driven compliance evaluation,
and context ingestion from your CMDB and operational documents -- and outputs a full
traceability chain from source evidence to compliance verdict.

**File-only on disk.** No telemetry, no hosted endpoint, no call-home. Your source
code and assessment data never leave your machine. Bring your own LLM provider.

---

## What's new in v1.0

- **LLM Assessment** -- benchmark multiple AI providers against the same sovereignty
  controls that govern the assessed workload. Parallel and serial leg execution.
  Includes the vision pass: Playwright screenshots analysed by the configured LLM.
- **HTML portal publication** -- self-contained single-file report with executive,
  technical, compliance, and auditor views. Works offline and in air-gapped environments.
- **Terraform module generation** -- `swao generate-tf` produces validated Terraform
  modules for the assessed landing zone configuration.
- **Multi-leg LLM runs** -- configure 2 to 5 LLM connectors and compare their
  sovereignty scores side by side in a single command.
- **Three-tier licensing** -- Community (Apache 2.0, no activation), Consultant, and
  Enterprise. All tiers include the full assessment engine and LLM integration.

---

## Assessment types

| Type | Status | What you get |
|---|---|---|
| Application Assessment | Available | Full pipeline: inventory, SBOM, data classification, compliance, 7R synthesis |
| Landing Zone Assessment | Available | Cloud infrastructure fit/gap report against sovereignty requirements |
| LLM Assessment | Available | Side-by-side sovereignty benchmarking across multiple LLM providers |
| Audit Assessment | In development | Human-led checklist and evidence with deterministic compliance verdict |
| Hybrid Assessment | In development | Combined source analysis and consultant audit evidence |

---

## Questions and licence requests

Open a [GitHub Discussion](https://github.com/Accenture/SWAO/discussions) or [raise an issue](https://github.com/Accenture/SWAO/issues).
For licence enquiries, email [swao-tool@accenture.com](mailto:swao-tool@accenture.com?subject=SWAO%20Licence%20Enquiry).
