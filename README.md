<div align="center">
  <img src="docs/brand/assets/logo-icon-dark.png" alt="SWAO" width="160" />

  # SWAO -- Sovereign Workload Assessment and Onboarding

  AI-accelerated cloud workload compliance assessment with audit-grade traceability.

  [Documentation](https://accenture.github.io/SWAO/) |
  [Quick Start](https://accenture.github.io/SWAO/en/getting-started) |
  [Discussions](https://github.com/Accenture/SWAO/discussions) |
  [Website](https://swao.here.now)

  ![CI](https://github.com/Accenture/SWAO/actions/workflows/ci-community.yml/badge.svg)
  ![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
  ![Version](https://img.shields.io/github/v/release/Accenture/SWAO)
</div>

---

## What is SWAO?

SWAO (Sovereign Workload Assessment and Onboarding) is an AI-accelerated compliance assessment tool for cloud migration. It analyses source code and configuration files, evaluates them against community compliance frameworks (GDPR, HIPAA, PCI-DSS, ISO 27001, and others), and generates audit-grade HTML reports and dashboards. The CLI runs in minutes and produces findings with full evidence traceability.

### How SWAO works

```
  INPUT              ASSESSMENT            OUTPUT            ONBOARDING
  ──────             ────────────          ──────            ──────────

 ┌──────────┐       ┌────────────┐       ┌──────────┐      ┌────────────┐
 │  Source  │       │            │       │  HTML    │      │ Terraform  │
 │  Code    ├──────►│  SWAO      ├──────►│  Report  ├─────►│ Landing    │
 │          │       │  CLI       │       │  BI/CSV  │      │ Zones      │
 └──────────┘       │  TUI       │       │  JSON    │      │ Meshcloud  │
 ┌──────────┐       │  MCP       │       └──────────┘      └─────┬──────┘
 │  Config  │       └─────┬──────┘                               │
 │  Files   ├─────────────┘         Frameworks:                  │  7R
 └──────────┘                       GDPR · HIPAA · PCI-DSS       ▼
                                    ISO 27001 · SOC 2 · BSI C5  ┌────────────┐
                                    DORA · COBIT-5 · NIST · ... │ 1 Retire   │
                                                                 │ 2 Retain   │
 ◄─────────────────────────────────────────────────────────────  │ 3 Rehost   │
              CONTINUOUS IMPROVEMENT                             │ 4 Relocate │
              Re-assess · Drift detection · Updated 7R          │ 5 Replatform│
                                                                 │ 6 Refactor │
                                                                 │ 7 Repurchase│
                                                                 └────────────┘
```

---

## Key Features

- Assessment against 9+ community compliance frameworks
- Terminal UI (TUI) for interactive assessment runs
- AI-assisted finding explanations (LLM ungated, bring your own key)
- HTML report with per-control evidence
- Portfolio dashboard for multi-application views
- MCP server for Claude Code integration
- 7R migration recommendations (Rehost, Replatform, Refactor, and more)
- Extensible: add custom frameworks via YAML (no TypeScript required)

---

## Compliance Frameworks

| Framework | Standard Body | Region |
|-----------|---------------|--------|
| GDPR | European Parliament | EU |
| HIPAA | US Dept. of Health and Human Services | US |
| PCI-DSS | PCI Security Standards Council | Global |
| ISO 27001 | ISO/IEC | Global |
| SOC 2 | AICPA | US |
| BSI C5 | Bundesamt fur Sicherheit in der Informationstechnik | Germany |
| DORA | European Parliament | EU |
| COBIT-5 | ISACA | Global |
| NIST SP 800-66r2 | NIST | US |
| AI Act (EU) | European Parliament | EU |
| KRITIS | BSI | Germany |
| EU CRA | European Parliament | EU |

---

## Edition Comparison

| Feature | Community | Consultant | Enterprise |
|---------|-----------|------------|------------|
| CLI + TUI assessment | Yes | Yes | Yes |
| Community frameworks | 9+ | 9+ + custom | 9+ + custom |
| Custom frameworks (YAML) | -- | Yes | Yes |
| HTML single-page report | Yes | Yes | Yes |
| HTML portal + dashboard | -- | Yes | Yes |
| PDF report | -- | Yes | Yes |
| Power BI export | -- | Yes | Yes |
| LLM assessment (bring your own key) | Yes | Yes | Yes |
| MCP server | -- | -- | Yes |
| Terraform + Landing Zone generation | -- | -- | Yes |
| Support | GitHub Discussions | Accenture PS | Accenture PS |

Consultant and Enterprise tiers are available for commercial engagements via Accenture.

---

## Quick Start

Binary downloads and package installation are coming in Phase 2. In the meantime, visit the [Installation page](https://accenture.github.io/SWAO/en/getting-started) in the documentation.

---

## Contributing

We welcome framework contributions and bug reports. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting new compliance frameworks, raising issues, and opening pull requests. Join the conversation in [Discussions](https://github.com/Accenture/SWAO/discussions).

---

## "Powered by SWAO" Badge

If your project uses SWAO for compliance assessment, you are welcome to include this badge in your README:

```markdown
[![Powered by SWAO](https://raw.githubusercontent.com/Accenture/SWAO/main/docs/brand/assets/logo.svg)](https://github.com/Accenture/SWAO)
```

---

## Licence

The Community Edition of SWAO is licensed under the [Apache 2.0 licence](LICENSE). Consultant and Enterprise tiers are proprietary -- contact Accenture for commercial licensing enquiries.
