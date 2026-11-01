```
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Community Frameworks
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://accenture.github.io/SWAO/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
```

# SWAO Community Frameworks

Community frameworks for SWAO - Sovereign Workload Assessment and Onboarding.

Each framework is a pair of YAML files:

| File | Purpose |
|---|---|
| `framework-meta.yaml` | Framework identity, authority, applicability, and contributor attribution |
| `controls.yaml` | Control definitions with signal mappings and guidance |

## Available frameworks

| ID (for `regimes_active`) | Folder | Framework | Controls |
|---|---|---|---|
| `AI_10_PILLARS` | `ai-10-pillars` | 10 Pillars of Secure AI Systems | 11 |
| `BSI_C5` | `bsi-c5` | BSI Cloud Computing Compliance Criteria Catalogue (C5:2020) | 62 |
| `BSI_GRUNDSCHUTZ_2023` | `bsi-grundschutz-2023` | BSI IT-Grundschutz Kompendium Edition 2023 | 105 |
| `BSI_GRUNDSCHUTZ_PP` | `bsi-grundschutz-plus-plus` | BSI Grundschutz++ (Anwenderkatalog, BSI-Standard 300-1); BSI content under CC BY-SA 4.0 | 1000 |
| `COBIT_5` | `cobit-5` | COBIT 5: Governance and Management of Enterprise IT (original SWAO wording) | 37 |
| `EC_CSF` | `ec-csf` | EC Cloud Sovereignty Framework v1.2.1 | 34 |
| `EU_AI_ACT` | `eu-ai-act` | EU Artificial Intelligence Act | 37 |
| `EU_CRA` | `eu-cra` | EU Cyber Resilience Act (CRA) | 35 |
| `EUCS` | `eucs` | EU Cloud Security Certification Scheme (EUCS) | 66 |
| `GDPR` | `gdpr` | General Data Protection Regulation (Regulation (EU) 2016/679) | 53 |
| `KRITIS_DE` | `kritis-de` | KRITIS-DE: German Critical Infrastructure IT Security | 40 |
| `LLM_SELECTION` | `llm-selection` | LLM Selection Framework for Sovereign Deployment | 34 |
| `NCA_CCC_CSP` | `nca-ccc-2-2024-csp` | NCA Cloud Cybersecurity Controls (CCC-2:2024): Cloud Service Provider | 37 |
| `NCA_CCC_CST` | `nca-ccc-2-2024-cst` | NCA Cloud Cybersecurity Controls (CCC-2:2024): Cloud Service Tenant | 18 |
| `NCA_ECC` | `nca-ecc-2-2024` | NCA Essential Cybersecurity Controls (ECC-2:2024) | 28 |
| `NIS2` | `nis2` | NIS2: Network and Information Security Directive 2 | 46 |
| `NIST_SP_800_66R2` | `nist-sp-800-66r2-hipaa` | HIPAA Security Rule: Implementation Guidance (NIST SP 800-66 Revision 2) | 49 |
| `OPENSSF_SCORECARD` | `openssf-scorecard` | OpenSSF Security Scorecard | 17 |
| `PCI_DSS` | `pci-dss` | Payment Card Industry Data Security Standard v4.0 | 5 |
| `SAMA_CSF` | `sama-csf-v1` | SAMA Cyber Security Framework v1.0 | 30 |
| `SECNUMCLOUD` | `secnumcloud` | SecNumCloud v3.2: ANSSI Sovereign Cloud Certification | 59 |
| `SWAO_APM` | `swao-apm` | SWAO Application Portfolio Management | 72 |

There is no index file: each folder's `framework-meta.yaml` declares its framework, and
`swao framework list` builds the list from those files.

## How to use

Every framework in this directory is also bundled with the SWAO binary. SWAO assesses
against the frameworks that sit in the workspace; inside a workspace,
`swao framework install <ID>` copies a bundled framework into the workspace for you.

To add a framework by hand, for example from a download of this directory, copy the
framework directory (e.g. `gdpr/`) into the workspace at
`wsp/inputs/catalogs/community/<folder>/`:

```
my-workspace/
  wsp/
    inputs/
      catalogs/
        community/
          gdpr/
            framework-meta.yaml
            controls.yaml
```

Then enable it for an app in `apps/<app-id>/.swao.yml`:

```yaml
assessment:
  regimes_active: [GDPR]
```

The compliance pass evaluates the framework on the next assessment run of that app.

## Customising a framework

Edit `controls.yaml` inside your copied framework directory to add, remove, or adjust
controls for your context.

Controls use paraphrased language - do not reproduce verbatim text from copyrighted
standards documents. Paraphrasing is acceptable fair use; verbatim reproduction is not.

## Contributing a new framework

Open a [GitHub Issue](https://github.com/Accenture/SWAO/issues) using the
**Community Framework** template, or submit a pull request following the guide in
[CONTRIBUTING.md](../CONTRIBUTING.md#contributing-compliance-frameworks).

## Licence

Apache-2.0. See [LICENSE](../LICENSE).
