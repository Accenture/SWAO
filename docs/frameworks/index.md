# Community frameworks

Community frameworks are the compliance and assessment catalogues SWAO evaluates applications against: regulations (GDPR, DORA, NIS2, the EU AI Act), standards (ISO/IEC 27001, SOC 2, BSI C5), sovereign cloud schemes (EUCS, SecNumCloud, EC Cloud Sovereignty Framework), national regimes (KRITIS-DE, NCA, SAMA), and SWAO's own frameworks for LLM selection and application portfolio management. Each framework is a folder with two files: `framework-meta.yaml` (identity, authority, version, scoring) and `controls.yaml` (the controls).

SWAO ships **24 frameworks** plus **9 demo variants** with a small control subset for workshops and live presentations.

## How frameworks are used

1. **Discovery (workspace-wide).** SWAO picks up every framework folder in `wsp/inputs/catalogs/community/<folder>/` automatically, in addition to the bundled set. No registration is needed: copy a folder in and it appears in the framework selection of the terminal interface.
2. **Selection (per app).** You choose the frameworks for an application in the terminal interface during an assessment, or with `swao regime-select --app <id> --regimes GDPR,DORA`. The choice is stored in `apps/<id>/.swao.yml`:

   ```yaml
   assessment:
     regimes_active: [GDPR, DORA]
   ```

   A `regimes_active` list in the workspace `.swao.yml` applies to every app that has no list of its own; a list in the app always takes precedence.
3. **Evaluation.** [Pass 11 COMP](/passes/11-comp) rates every control of the selected frameworks as SATISFIED, PARTIAL, GAP, N_A, or UNKNOWN, using the signals of the run as evidence. Results appear in the report, the HTML publication, the BI export, and (service apps) the Framework Compliance sheet of the Enterprise workbook.

## Get or customise a framework

The framework sources are public. Browse and copy them from GitHub:

- [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks): the community catalogue folder
- [github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks): the bundled set, including COBIT 5, DORA, ISO/IEC 27001, SOC 2, and all demo variants

SWAO assesses against the frameworks that sit in the workspace under `wsp/inputs/catalogs/community/<folder>/`; there is no separate installation step. Inside a workspace, `swao framework install <ID>` copies a bundled framework into that folder, and `swao framework list` shows the bundled IDs (read from each folder's `framework-meta.yaml`). To adapt a framework for one engagement, edit that copy; the workspace copy takes precedence over the bundled one. To add your own framework, create a new folder with the same two files.

COBIT 5 ships again, with its control text rewritten in original SWAO wording; `swao framework install COBIT_5` copies it into the workspace like any other bundled framework. See [COBIT 5](/frameworks/cobit-5).

## Framework catalogue

| Framework | ID for `regimes_active` | Publisher | Controls | Demo variant (controls) |
|---|---|---|---|---|
| [10 Pillars of Secure AI Systems](/frameworks/ai-10-pillars) | `AI_10_PILLARS` | Alok Sharan (concept) | 11 | `AI_10_PILLARS_DEMO` (11) |
| [BSI C5:2020](/frameworks/bsi-c5) | `BSI_C5` | BSI | 62 | none |
| [BSI IT-Grundschutz Kompendium 2023](/frameworks/bsi-grundschutz-2023) | `BSI_GRUNDSCHUTZ_2023` | BSI | 105 | `BSI_GRUNDSCHUTZ_2023_DEMO` (11) |
| [COBIT 5](/frameworks/cobit-5) | `COBIT_5` | ISACA | 37 | none |
| [Digital Operational Resilience Act](/frameworks/dora) | `DORA` | European Union (Regulation 2022/2554) | 31 | `DORA_DEMO` (12) |
| [EC Cloud Sovereignty Framework v1.2.1](/frameworks/ec-csf) | `EC_CSF` | European Commission (DIGIT) | 34 | none |
| [EU Artificial Intelligence Act](/frameworks/eu-ai-act) | `EU_AI_ACT` | European Union (Regulation 2024/1689) | 37 | none |
| [EU Cyber Resilience Act](/frameworks/eu-cra) | `EU_CRA` | European Union (Regulation 2024/2847) | 35 | none |
| [EU Cloud Security Certification Scheme](/frameworks/eucs) | `EUCS` | ENISA | 66 | none |
| [General Data Protection Regulation](/frameworks/gdpr) | `GDPR` | European Parliament and Council (Regulation 2016/679) | 53 | `GDPR_DEMO` (11) |
| [ISO/IEC 27001:2022](/frameworks/iso-27001) | `ISO_27001` | ISO/IEC | 93 | `ISO_27001_DEMO` (12) |
| [KRITIS-DE](/frameworks/kritis-de) | `KRITIS_DE` | BSI | 40 | none |
| [LLM Selection Framework](/frameworks/llm-selection) | `LLM_SELECTION` | SWAO Development Team | 34 | none |
| [NCA Cloud Cybersecurity Controls: CSP](/frameworks/nca-ccc-2-2024-csp) | `NCA_CCC_CSP` | National Cybersecurity Authority, Saudi Arabia | 37 | none |
| [NCA Cloud Cybersecurity Controls: CST](/frameworks/nca-ccc-2-2024-cst) | `NCA_CCC_CST` | National Cybersecurity Authority, Saudi Arabia | 18 | none |
| [NCA Essential Cybersecurity Controls](/frameworks/nca-ecc-2-2024) | `NCA_ECC` | National Cybersecurity Authority, Saudi Arabia | 28 | `NCA_ECC_DEMO` (20) |
| [NIS2 Directive](/frameworks/nis2) | `NIS2` | European Union (Directive 2022/2555) | 46 | none |
| [HIPAA Security Rule (NIST SP 800-66r2)](/frameworks/nist-sp-800-66r2-hipaa) | `NIST_SP_800_66R2` | U.S. Department of Health and Human Services | 49 | `NIST_SP_800_66R2_DEMO` (12), `NIST_HIPAA_DEMO` (12) |
| [OpenSSF Scorecard](/frameworks/openssf-scorecard) | `OPENSSF_SCORECARD` | Open Source Security Foundation | 17 | none |
| [PCI DSS v4.0](/frameworks/pci-dss) | `PCI_DSS` | PCI Security Standards Council | 5 | none |
| [SAMA Cyber Security Framework](/frameworks/sama-csf-v1) | `SAMA_CSF` | Saudi Arabian Monetary Authority (SAMA) | 30 | none |
| [SecNumCloud v3.2](/frameworks/secnumcloud) | `SECNUMCLOUD` | ANSSI | 59 | none |
| [SOC 2 Trust Services Criteria](/frameworks/soc-2) | `SOC_2` | AICPA | 64 | `SOC_2_DEMO` (12) |
| [SWAO Application Portfolio Management](/frameworks/swao-apm) | `SWAO_APM` | SWAO Development Team | 72 | none |

Control counts are taken from each framework's `controls.yaml`. `PCI_DSS` is a starter catalogue with 5 controls. `SWAO_APM` is used by the [Service Portfolio Assessment](/service-assessment/) and `LLM_SELECTION` by the [LLM Assessment](/assessment/llm).

## Demo variants

Demo variants (`*_DEMO`) contain 11 to 20 representative controls of their parent framework. They are meant for workshops, trainings, and live presentations, where a full catalogue would make a run longer than needed. Do not use a demo variant for a formal gap assessment.

## Important notes

- SWAO automates evidence collection and a first compliance rating. It does not replace an audit, a certification, or legal advice.
- Controls that need organisational or audit evidence often remain UNKNOWN until an analyst supplies documents in the app's ingestion folders.
