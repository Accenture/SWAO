# EU Cloud Security Certification Scheme (EUCS)

This page describes the community framework `EUCS` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `EUCS` |
| Authority / publisher | European Union Agency for Cybersecurity (ENISA) |
| Version | candidate-2024 |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 1.0.0 |
| Total controls | 66 |
| Scoring mode | `binary` (declared) |
| Assessment types (metadata) | `app`, `aud` |
| Licence and redistribution | Published by ENISA under EU open publication terms. Descriptions paraphrase the candidate scheme, which may change before formal adoption. Consult an ENISA-recognised conformity assessment body for certification guidance. |
| Last reviewed | 2026-09-21 |
| Folder | `eucs` |

## What it is

EUCS is ENISA's candidate cybersecurity certification scheme for cloud services under the EU Cybersecurity Act (Regulation (EU) 2019/881). The candidate scheme was published in December 2020 and, according to the catalogue, is being prepared as a delegated act by the European Commission. It defines three assurance levels: Basic, Substantial and High (the latter for sensitive EU data). EUCS is not yet a mandatory regulation; the catalogue recommends framing its use as certification preparation.

The SWAO catalogue contains 66 controls in 12 domains. Each control carries a tag with its minimum assurance level (`eucs:basic`, `eucs:substantial` or `eucs:high`).

## Who should use it in SWAO and when

- Cloud service providers (IaaS, PaaS, SaaS) preparing to certify their offerings for EU customers and authorities (catalogue hints: `eu_cloud_provider`, `iaas_provider`, `paas_provider`, `saas_provider`, `cloud_certification`).
- Cloud customers who want to evaluate a provider's certification status or sovereign-cloud readiness (`eu_sovereign_cloud`, `eu_regulated`).

## What SWAO checks

Controls are evaluated in [Pass 11 (compliance evaluation)](/passes/11-comp). The pass reads the `assessment.regimes_active` list from the app's `.swao.yml`, loads the catalogue and sends the controls in batches of 20 to the configured LLM. For each control the LLM receives the ID, title, description and default severity, together with all signals that the earlier passes of the run produced. It returns one of five outcomes per control:

| Outcome | Meaning |
|---|---|
| `SATISFIED` | Signals confirm the control is met. |
| `PARTIAL` | Some elements are present, but gaps remain. |
| `GAP` | Signals show the control is not met. |
| `UNKNOWN` | No signal addresses the control either way. |
| `N_A` | The control does not apply to this workload (with justification). |

Cited signal IDs are checked against the signals that actually exist; invented IDs are dropped. Without a configured LLM provider every control is reported as `UNKNOWN`.

### What evidence the controls expect

Each control declares in its `evidence_basis` field what kind of evidence it relies on. This tells the reviewer what evidence is expected; the outcome itself is decided by the LLM from the signals. For this framework the split is:

| Evidence type | Controls |
|---|---|
| Code and configuration signals only (`signal_prefix`, `local_signal_regex`) | 19 |
| Signals and documents combined | 2 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 45 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 26 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 6 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `IAM` | 7 | evidence area identity and access; no SWAO analysis pass emits signals with this prefix |
| `CRYPTO` | 5 | [Pass 08 (CRYPTO)](/passes/08-crypto) |
| `EGR` | 4 | [Pass 07 (EGR)](/passes/07-egr) |
| `TF` | 4 | [Pass 06 (TF)](/passes/06-tf) |
| `OBS` | 4 | evidence area observability, logging and monitoring; no SWAO analysis pass emits signals with this prefix |
| `SBOM` | 1 | [Pass 05 (SBOM)](/passes/05-sbom) |

### Examples

Controls with code or configuration evidence:

- `EUCS_IAM_2` User account lifecycle management (`IAM`)
- `EUCS_IAM_3` Multi-factor authentication for administrative access (`IAM`)
- `EUCS_IAM_4` Privileged access management (`IAM`)

Controls that need documents:

- `EUCS_GRC_1` Information security policy
- `EUCS_GRC_2` Risk management framework

Examples of audit-only controls: `EUCS_GRC_3`, `EUCS_GRC_4`, `EUCS_GRC_5`.

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

### Assurance-level tags

| Tag | Controls |
|---|---|
| `eucs:basic` | 9 |
| `eucs:substantial` | 29 |
| `eucs:high` | 28 |

The tags are carried into the plan and the report so you can filter controls by level. SWAO does not filter controls by level automatically; all 66 are evaluated.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| EUCS-GRC: Governance and Risk Management | 8 | `EUCS_GRC_1` Information security policy; `EUCS_GRC_2` Risk management framework |
| EUCS-HRS: Human Resources Security | 4 | `EUCS_HRS_1` Pre-employment screening; `EUCS_HRS_2` Mandatory security awareness training |
| EUCS-ASM: Asset Management | 5 | `EUCS_ASM_1` Cloud service asset inventory; `EUCS_ASM_2` Customer data classification scheme |
| EUCS-IAM: Access Control | 8 | `EUCS_IAM_1` Access control policy; `EUCS_IAM_2` User account lifecycle management |
| EUCS-CRY: Cryptography and Key Management | 6 | `EUCS_CRY_1` Encryption of customer data at rest; `EUCS_CRY_2` Encryption of data in transit |
| EUCS-PHY: Physical and Environmental Security | 5 | `EUCS_PHY_1` Physical access controls and multi-zone perimeter; `EUCS_PHY_2` Environmental monitoring and alerting |
| EUCS-OPS: Operations Management | 8 | `EUCS_OPS_1` Change management process; `EUCS_OPS_2` Vulnerability management and patching |
| EUCS-BCP: Business Continuity and Resilience | 5 | `EUCS_BCP_1` Business continuity plan for cloud services; `EUCS_BCP_2` Disaster recovery capabilities and geographic redundancy |
| EUCS-INC: Incident Management | 4 | `EUCS_INC_1` Incident management process; `EUCS_INC_2` Customer incident notification |
| EUCS-DEV: Secure Development and Supply Chain | 5 | `EUCS_DEV_1` Secure software development lifecycle (SSDLC); `EUCS_DEV_2` Software composition analysis and SBOM |
| EUCS-DPI: Data Portability and Interoperability | 4 | `EUCS_DPI_1` Customer data portability and export; `EUCS_DPI_2` Secure data deletion on contract termination |
| EUCS-AUD: Transparency and Audit | 4 | `EUCS_AUD_1` Third-party security attestation; `EUCS_AUD_2` Customer audit rights |
| **Total** | **66** | |

Default severities: critical 5, high 45, medium 16.

## Cross-mapping to other frameworks

61 of 66 controls carry `maps_to` references to controls of other frameworks. The table counts the references per target framework. "Resolved" means the target ID exists as a control in a bundled SWAO catalogue; "unresolved" means the reference points at article or clause level, or uses an ID spelling that no catalogue contains.

| Target framework | Resolved references | Unresolved references |
|---|---|---|
| `BSI_C5` | 55 | 0 |
| `ISO_27001` | 50 | 0 |

In addition, the metadata (`cross_mapping_hints`) names these related frameworks: `BSI_C5`, `ISO_27001`, `SOC_2`, `GDPR`, `KRITIS_DE`, `DORA`. This list indicates thematic overlap; it is not a control-level mapping.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/community-frameworks/eucs](https://github.com/Accenture/SWAO/tree/main/community-frameworks/eucs)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

To customise the framework for one engagement, copy the `eucs` folder (with `framework-meta.yaml` and `controls.yaml`) into the workspace at `wsp/inputs/catalogs/community/eucs/` and edit the copy there. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Make sure the `eucs` folder is present under `wsp/inputs/catalogs/community/` in the workspace (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [EUCS]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [EUCS, GDPR]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "EUCS"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

## Limitations and notes

- EUCS is a candidate scheme; the final adopted scheme may differ from this catalogue.
- Six controls (physical security and hardware integrity) are marked `csp_inherited`: the responsibility lies with the cloud provider. 26 controls are marked `aud`.
- Formal certification is issued by an accredited conformity assessment body, never by SWAO.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The publisher's official source is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
