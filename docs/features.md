# Features & Editions

SWAO is available in three editions. All editions share the same core engine and
produce the same audit-grade output. The differences are in advanced visualisation,
portfolio scope, and sector-specific content.

> **Hover over any feature name** to see a plain-English description of what it does.

---

## Assessment types

SWAO supports four assessment types, all available now.

| Assessment type | Status | What it covers |
|---|---|---|
| <FeatureTooltip tip="Analyses application source code across 13 default passes - inventory, SBOM, data classification, compliance evaluation, 7R migration synthesis, and more. Produces signals, a BI export bundle, and an HTML publication.">Application Assessment</FeatureTooltip> | Available | Cloud application source code |
| <FeatureTooltip tip="Compares your cloud landing zone configuration against the sovereignty requirements derived from the active community framework. Fetches the cloud provider service catalogue and produces a fit/gap report.">Landing Zone Assessment</FeatureTooltip> | Available | Cloud infrastructure configuration |
| <FeatureTooltip tip="Connects to multiple LLM providers simultaneously and benchmarks each against sovereignty criteria: data residency, transparency, safety, cultural fit.">LLM Assessment</FeatureTooltip> | Available | AI model sovereignty benchmarking |
| <FeatureTooltip tip="Assesses bought, rented, and operated applications (third-party software, COTS, SaaS, legacy servers) from a spreadsheet intake without source code. Researches vulnerabilities and end of life, scores eleven portfolio domains, and recommends a TIME disposition and migration waves.">Service Portfolio Assessment</FeatureTooltip> | Available | Third-party, COTS, and SaaS application portfolio |

---

## Edition comparison

| Feature | <Badge type="info" text="Community"/> | <Badge type="tip" text="Consultant"/> | <Badge type="warning" text="Enterprise"/> |
|---|---|---|---|
| **Assessment** | | | |
| <FeatureTooltip tip="Runs 13 default analysis passes on your application source code and produces signals, reports, and a BI export bundle.">Application Assessment</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Compares your cloud landing zone against sovereignty requirements and produces a fit/gap report.">Landing Zone Assessment</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Benchmarks multiple LLM providers against sovereignty criteria side by side.">LLM Assessment</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Assesses third-party, COTS, and SaaS applications from an Excel intake. HTML publication needs Consultant; the portfolio workbook and star schema need Enterprise.">Service Portfolio Assessment</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Researches vulnerabilities (CVE) and end of life for every service; with a configured LLM also the vendor profile, certifications, data residency, and breach history. Run with: swao service research">Service research (incl. LLM research)</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="A second LLM agent independently challenges every finding; surfaces low-confidence assessments. Enterprise edition, requires completed Application Assessment.">Adversarial Challenge Review</FeatureTooltip> | - | - | Yes |
| **Community frameworks** | | | |
| <FeatureTooltip tip="21 frameworks in the public community-frameworks directory: 10 Pillars of Secure AI Systems, BSI C5, BSI IT-Grundschutz 2023, COBIT 5, EC Cloud Sovereignty Framework, EU AI Act, EU Cyber Resilience Act, EUCS, GDPR, KRITIS-DE, LLM Selection, NCA CCC 2024 (CSP), NCA CCC 2024 (CST), NCA ECC 2024, NIS2, HIPAA / NIST SP 800-66r2, OpenSSF Scorecard, PCI-DSS v4, SAMA CSF v1, SecNumCloud, SWAO APM. Copy into the workspace with swao framework install or download from the SWAO community-frameworks repository on GitHub.">Community framework library (21 frameworks)</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Add your own community framework as a YAML file - no coding required. Supports the same controls schema as the community frameworks.">Custom frameworks (YAML)</FeatureTooltip> | Yes | Yes | Yes |
| **Landing Zone Catalogues** | | | |
| <FeatureTooltip tip="10 cloud providers covered: STACKIT, OTC (T-Systems), Microsoft Azure EU, Azure Local, AWS eu-central-1, AWS ESC, AWS ISO-E, Google Cloud EU, Delos Cloud, Oracle Cloud (OCI). Each provider entry includes readiness checks (blockers, warnings, info items) tailored to that platform's service portfolio and sovereignty evidence.">Built-in LZ catalogue (10 providers)</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Refresh the landing zone service catalogue of a cloud provider (services, regions, VM prices) from the provider's public sources before an engagement. Run with: swao lz catalogue update">LZ catalogue update</FeatureTooltip> | - | Yes | Yes |
| <FeatureTooltip tip="Copy a built-in provider catalogue into the workspace with swao lz catalogue copy, or scaffold a new provider with swao lz catalogue new, and edit the JSON file. Workspace copies are used instead of the built-in entries.">Custom LZ catalogue entries (JSON)</FeatureTooltip> | Yes | Yes | Yes |
| **AI & LLM** | | | |
| <FeatureTooltip tip="Use Anthropic Claude, OpenAI GPT, Amazon Bedrock Gateway, or a self-hosted Ollama model. The LLM analyses your code and produces plain-language rationale on every signal.">Bring your own LLM (incl. Bedrock Gateway)</FeatureTooltip> | Yes | Yes | Yes |
| **Output & publication** | | | |
| <FeatureTooltip tip="Text, YAML, JSON, and Markdown (auditor.md) reports generated after every assessment. Open in any editor or import into your reporting workflow.">Text and Markdown reports</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Star-schema CSV bundle (17 tables) plus NDJSON mirror and XLSX rollup. Ready to load into any BI tool. Run with: swao export">BI export bundle (CSV / NDJSON / XLSX)</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="A self-contained HTML file you can open in any browser, email to a client, or use offline. Includes full-text search, persona views (executive, technical, auditor, DPO), and an evidence gallery. Run with: swao publish --app or swao report --format html">HTML publication (single-file)</FeatureTooltip> | - | Yes | Yes |
| <FeatureTooltip tip="Interactive in-browser editor to annotate and customise the HTML evidence report, adjust findings text, and export a final client-ready version. Run with: swao publish --edit">HTML Editor (interactive, swao publish --edit)</FeatureTooltip> | - | - | Yes |
| <FeatureTooltip tip="PDF rendering of the full assessment report. Requires Playwright to be installed.">PDF report</FeatureTooltip> | - | Yes | Yes |
| <FeatureTooltip tip="A pre-built Power BI Desktop template (.pbit) for single-application assessments, written by swao export next to the star schema. Six pages: Overview, Compliance, Signals, Risks, Auditor, Run Stats.">PowerBI single-app dashboard</FeatureTooltip> | - | Yes | Yes |
| <FeatureTooltip tip="A pre-built Power BI Desktop template for multi-application portfolio assessments. Aggregates findings across all apps with wave-sequencing and heatmap views. Needs the portfolio BI export (swao export --portfolio, Enterprise).">PowerBI portfolio dashboard</FeatureTooltip> | - | - | Yes |
| **Integration** | | | |
| <FeatureTooltip tip="Load context from your CMDB, ServiceNow exports, FinOps reports, workshop transcripts, or architecture documents. SWAO fuses operational context with code analysis.">Context ingestion (CMDB / docs)</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Expose SWAO assessment tools directly to Claude AI via the Model Context Protocol. Ask Claude about your assessment findings in natural language.">MCP integration (Claude AI)</FeatureTooltip> | - | - | Yes |
| <FeatureTooltip tip="Conversational AI interface built into SWAO. Ask questions about your assessment results, get plain-language explanations of findings, and explore recommendations in a guided chat session. Available from v1.1.0.">SWAO Chat</FeatureTooltip> | - | - | Yes |
| **Portfolio** | | | |
| <FeatureTooltip tip="Assess and compare multiple applications in one workspace. Aggregated risk register, cross-app compliance matrix, migration wave planning. Run with: swao assess --portfolio, swao report --portfolio, swao export --portfolio">Multi-app portfolio workspace</FeatureTooltip> | - | - | Yes |
| <FeatureTooltip tip="Portfolio workbook and BI bundle for a Service Portfolio Assessment. Run with: swao service export">Service portfolio export</FeatureTooltip> | - | - | Yes |
| <FeatureTooltip tip="Sector-specific migration runbook templates, executive briefing formats, and industry-vetted DPA skeletons.">Sector-specific engagement templates</FeatureTooltip> | - | - | Yes |
| **Advanced delivery** | | | |
| <FeatureTooltip tip="Generates Terraform module stubs for the recommended landing zone, pre-populated from the landing zone readiness assessment output.">Terraform LZ module stubs (from LZ readiness output)</FeatureTooltip> | - | - | Roadmap |
| <FeatureTooltip tip="meshStack Developer Portal Building Block deployment and cloud management portal integration for self-service provisioning workflows.">meshStack Developer Portal integration</FeatureTooltip> | - | - | Roadmap |
| <FeatureTooltip tip="Replace or extend the bundled landing zone catalogue with your organisation's cloud platform configuration standard.">Custom LZ catalogue standard (organisation-wide)</FeatureTooltip> | - | - | Roadmap |

---

## Landing Zone Catalogues

SWAO ships with a curated catalogue of cloud providers. During a Landing Zone Assessment, SWAO
selects the relevant provider entry and validates a set of readiness checks - blockers, warnings,
and informational items - against your workload's signals and your target cloud's service portfolio.

### Included providers

| Provider | Type | Sovereignty |
|---|---|---|
| STACKIT (Schwarz Group) | Dedicated sovereign | DE / EU |
| Open Telekom Cloud (T-Systems) | Dedicated sovereign | DE / EU |
| Microsoft Azure (EU regions) | Hyperscaler EU region | EU |
| Azure Local (on-premises) | On-premises sovereign | Customer-controlled |
| AWS eu-central-1 | Hyperscaler EU region | EU |
| AWS ESC (European Sovereign Cloud) | Hyperscaler sovereign | EU |
| AWS ISO-E | Hyperscaler sovereign sector | EU |
| Google Cloud (EU regions) | Hyperscaler EU region | EU |
| Delos Cloud (SAP / Arvato) | Dedicated sovereign | DE |
| Oracle Cloud Infrastructure (OCI) | Hyperscaler EU / sovereign | EU |

### Customisable

Each provider catalogue is a plain JSON file. `swao lz catalogue copy <provider>` copies a
built-in catalogue into the workspace for editing, and `swao lz catalogue new <provider>`
scaffolds an empty one for your own provider entry: private cloud, managed hosting, or
internal platform team. SWAO uses the workspace copy on the next run; no recompilation required.

Download the latest catalogues from GitHub:
[github.com/Accenture/SWAO/tree/main/lz-catalogues](https://github.com/Accenture/SWAO/tree/main/lz-catalogues)

---

## Community Frameworks

SWAO assesses against the frameworks in your workspace `wsp/inputs/catalogs/community/<folder>/`
directory. Copy a bundled framework there with `swao framework install <ID>`, or download
community frameworks directly from GitHub and place them there:
[github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

---

## LLM Gateway configurations

Pre-built LLM gateway YAML files for Anthropic, OpenAI, Bedrock, Ollama, OpenRouter,
and vLLM are available for download:
[github.com/Accenture/SWAO/tree/main/llm-gateway](https://github.com/Accenture/SWAO/tree/main/llm-gateway)

---

## Licence

- <Badge type="info" text="Community"/> Apache 2.0. Free to use, modify, and distribute. Community frameworks and LZ catalogues are included in every edition.
- <Badge type="tip" text="Consultant"/> Proprietary (SWAO Premium Edition). Adds HTML publication, PDF report, Power BI dashboard templates, and LZ catalogue update.
- <Badge type="warning" text="Enterprise"/> Proprietary (SWAO Premium Edition). Adds portfolio assessment, reporting and BI export, service portfolio export, adversarial challenge review, the HTML Editor, MCP integration, SWAO Chat, sector-specific engagement templates, and the roadmap items (Terraform module stubs, meshStack integration).

Questions or licence requests: start a [GitHub Discussion](https://github.com/Accenture/SWAO/discussions) or [raise an issue](https://github.com/Accenture/SWAO/issues).
