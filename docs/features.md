=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Features and Editions

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Features & Editions

SWAO is available in three editions. All editions share the same core engine and
produce the same audit-grade output. The differences are in advanced visualisation,
portfolio scope, and sector-specific content.

> **Hover over any feature name** to see a plain-English description of what it does.

---

## Assessment types

SWAO supports three assessment surfaces, all available now.

| Assessment type | Status | What it covers |
|---|---|---|
| <FeatureTooltip tip="Analyses application source code across 14 passes -- inventory, SBOM, data classification, compliance evaluation, 7R migration synthesis, and more. Produces signals, a BI export bundle, and an HTML publication.">Application Assessment</FeatureTooltip> | Available | Cloud application source code |
| <FeatureTooltip tip="Compares your cloud landing zone configuration against the sovereignty requirements derived from the active compliance framework. Fetches the cloud provider service catalogue and produces a fit/gap report.">Landing Zone Assessment</FeatureTooltip> | Available | Cloud infrastructure configuration |
| <FeatureTooltip tip="Connects to multiple LLM providers simultaneously and benchmarks each against sovereignty criteria: data residency, transparency, safety, cultural fit.">LLM Assessment</FeatureTooltip> | Available | AI model sovereignty benchmarking |

---

## Edition comparison

| Feature | Community | Consultant | Enterprise |
|---|---|---|---|
| **Assessment** | | | |
| <FeatureTooltip tip="Runs 14 analysis passes on your application source code and produces signals, reports, and a BI export bundle.">Application Assessment</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Compares your cloud landing zone against sovereignty requirements and produces a fit/gap report.">Landing Zone Assessment</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Benchmarks multiple LLM providers against sovereignty criteria side by side.">LLM Assessment</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="A second LLM agent independently challenges every finding; surfaces low-confidence assessments. Enterprise edition, requires completed Application Assessment.">Adversarial Challenge Review</FeatureTooltip> | -- | -- | Yes |
| **Compliance frameworks** | | | |
| <FeatureTooltip tip="14 frameworks available in every edition: GDPR, AI 10 Pillars, BSI C5, BSI IT-Grundschutz 2023, DORA, HIPAA / NIST SP 800-66r2, ISO 27001:2022, LLM Selection, NCA CCC 2024 (CSP), NCA CCC 2024 (CST), NCA ECC 2024, PCI-DSS v4, SAMA CSF v1, SOC 2 Type II. Install any with: swao framework install.">Community framework library (14 frameworks)</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Add your own compliance framework as a YAML file -- no coding required. Supports the same controls schema as the community frameworks.">Custom frameworks (YAML)</FeatureTooltip> | Yes | Yes | Yes |
| **AI & LLM** | | | |
| <FeatureTooltip tip="Use Anthropic Claude, OpenAI GPT, or a self-hosted Ollama model. The LLM analyses your code and produces plain-language rationale on every signal.">Bring your own LLM</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Advanced model management and custom model configuration -- Professional Services engagement.">Custom model configuration</FeatureTooltip> | -- | PS fee | Yes |
| **Output & publication** | | | |
| <FeatureTooltip tip="Text, YAML, JSON, and Markdown (auditor.md) reports generated after every assessment. Open in any editor or import into your reporting workflow.">Text and Markdown reports</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Star-schema CSV bundle (17 tables) plus NDJSON mirror and XLSX rollup. Ready to load into any BI tool.">BI export bundle (CSV / NDJSON / XLSX)</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="A self-contained HTML file you can open in any browser, email to a client, or use offline. Includes full-text search, persona views (executive, technical, auditor, DPO), and an evidence gallery.">HTML publication (single-file)</FeatureTooltip> | -- | Yes | Yes |
| <FeatureTooltip tip="PDF rendering of the full assessment report. Requires Playwright to be installed.">PDF report</FeatureTooltip> | -- | Yes | Yes |
| <FeatureTooltip tip="A pre-built Power BI Desktop template (.pbit) for single-application assessments. Six pages: Overview, Compliance, Signals, Risks, Auditor, Run Stats.">PowerBI single-app dashboard</FeatureTooltip> | -- | -- | Yes |
| <FeatureTooltip tip="A pre-built Power BI Desktop template for multi-application portfolio assessments. Aggregates findings across all apps with wave-sequencing and heatmap views.">PowerBI portfolio dashboard</FeatureTooltip> | -- | -- | Yes |
| **Integration** | | | |
| <FeatureTooltip tip="Load context from your CMDB, ServiceNow exports, FinOps reports, workshop transcripts, or architecture documents. SWAO fuses operational context with code analysis.">Context ingestion (CMDB / docs)</FeatureTooltip> | Yes | Yes | Yes |
| <FeatureTooltip tip="Expose SWAO assessment tools directly to Claude AI via the Model Context Protocol. Ask Claude about your assessment findings in natural language.">MCP integration (Claude AI)</FeatureTooltip> | -- | -- | Yes |
| **Portfolio** | | | |
| <FeatureTooltip tip="Assess and compare multiple applications in one workspace. Aggregated risk register, cross-app compliance matrix, migration wave planning.">Multi-app portfolio workspace</FeatureTooltip> | -- | Yes | Yes |
| <FeatureTooltip tip="Sector-specific migration runbook templates, executive briefing formats, and industry-vetted DPA skeletons.">Sector-specific engagement templates</FeatureTooltip> | -- | -- | Yes |

---

## Licence

- **Community** -- Apache 2.0. Free to use, modify, and distribute. Contributions welcome.
- **Consultant** -- Proprietary. Contact us to request access for your engagement.
- **Enterprise** -- Proprietary. Includes full compliance and custom library, portfolio dashboards, and sector content.

Questions or licence requests: start a [GitHub Discussion](https://github.com/Accenture/SWAO/discussions) or [raise an issue](https://github.com/Accenture/SWAO/issues).
