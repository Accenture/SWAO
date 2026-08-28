# SWAO Community Frameworks

Community compliance frameworks for SWAO -- Sovereign Workload Assessment and Onboarding.

Each framework is a pair of YAML files:

| File | Purpose |
|---|---|
| `framework-meta.yaml` | Framework identity, authority, applicability, and contributor attribution |
| `controls.yaml` | Control definitions with signal mappings and guidance |

## Available frameworks

| ID | Framework | Authority |
|---|---|---|
| `AI_10_PILLARS` | AI 10 Pillars -- responsible AI assessment | Accenture |
| `BSI_C5` | BSI Cloud Computing Compliance Criteria Catalogue 2020 | BSI, Germany |
| `BSI_IT_GRUNDSCHUTZ_2023` | BSI IT-Grundschutz 2023 | BSI, Germany |
| `GDPR` | General Data Protection Regulation 2016/679 | EU |
| `LLM_SELECTION` | LLM Selection -- sovereignty benchmarking for AI providers | Accenture |
| `NCA_CCC_2_2024_CSP` | NCA Cloud Cybersecurity Controls 2.0 (Cloud Service Provider) | NCA, Saudi Arabia |
| `NCA_CCC_2_2024_CST` | NCA Cloud Cybersecurity Controls 2.0 (Cloud Service Tenant) | NCA, Saudi Arabia |
| `NCA_ECC_2_2024` | NCA Essential Cybersecurity Controls 2.0 | NCA, Saudi Arabia |
| `NIST_SP_800_66R2` | NIST SP 800-66r2 / HIPAA Security Rule guidance | NIST, US |
| `PCI_DSS` | PCI DSS 4.0.1 -- Payment Card Industry Data Security Standard | PCI SSC, global |
| `SAMA_CSF_V1` | SAMA Cyber Security Framework v1.0 | SAMA, Saudi Arabia |

## How to use

Install a framework into your assessment workspace:

```bash
swao framework install GDPR
swao framework install BSI_C5
swao framework list   # show all installed and available frameworks
```

## Customising a framework

Copy a framework directory into your workspace `catalogs/community/<slug>/` and edit
`controls.yaml` to add, remove, or adjust controls for your context.

Controls use paraphrased language -- do not reproduce verbatim text from copyrighted
standards documents. Paraphrasing is acceptable fair use; verbatim reproduction is not.

## Contributing a new framework

Open a [GitHub Issue](https://github.com/Accenture/SWAO/issues) using the
**Community Framework** template, or submit a pull request following the guide in
[CONTRIBUTING.md](../CONTRIBUTING.md#contributing-compliance-frameworks).

## Licence

Apache-2.0. See [LICENSE](../LICENSE).
