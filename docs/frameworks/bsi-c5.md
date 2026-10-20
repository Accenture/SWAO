# BSI Cloud Computing Compliance Criteria Catalogue C5:2020 (BSI_C5)

This page describes the community framework `BSI_C5` as shipped with SWAO: what it covers, when to use it, what SWAO checks, and how to enable it.

## Summary

| Property | Value |
|---|---|
| Framework ID (for `regimes_active`) | `BSI_C5` |
| Authority / publisher | Bundesamt für Sicherheit in der Informationstechnik (BSI), Germany |
| Version | 2020 |
| Status | Not declared in the catalogue |
| SWAO catalogue version | 1.0.0 |
| Total controls | 62 |
| Scoring mode | `binary` (schema default; not declared) |
| Assessment types (metadata) | `app`, `aud` |
| Licence and redistribution | BSI C5:2020 is freely available under the BSI terms of use. The control texts paraphrase the Basic Criteria; reviewers verify a control by locating the cited domain and criterion in the BSI publication. No legal advice. |
| Last reviewed | 2026-07-08 |
| Folder | `bsi-c5` |

## What it is

C5 (Cloud Computing Compliance Criteria Catalogue) is the BSI catalogue of minimum requirements for the secure use and operation of cloud services. The 2020 revision defines Basic Criteria and Additional Criteria across 17 domains. According to the catalogue metadata, C5 is the mandatory baseline for German public-sector cloud usage and is strongly recommended for KRITIS-regulated sectors. C5 itself is a criteria catalogue that cloud providers are audited against (C5 attestation); it is not a law.

The SWAO catalogue covers 62 Basic Criteria controls in 16 domains (OIS to PI). Additional Criteria are not included.

## Who should use it in SWAO and when

- Migrations of German public-sector workloads to cloud, and engagements for KRITIS operators (catalogue hints: `de_sovereign`, `public_sector`, `cloud`, `kritis`, `german_regulated`, `bsi_c5_attested`).
- Cloud-provider selection where the target provider must hold a C5 attestation.
- Together with BSI_GRUNDSCHUTZ_2023 (organisation-wide ISMS view) and KRITIS_DE (sector obligations).

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
| Code and configuration signals only (`signal_prefix`, `local_signal_regex`) | 21 |
| Signals and documents combined | 7 |
| Documents or questionnaires only (`context_input`, `manual_questionnaire`) | 34 |
| Marked as audit-only (`assessment_type_scope: [aud]`) | 0 |
| Marked as the cloud provider's responsibility (`csp_inherited: true`) | 0 |

### Signal areas referenced

| Prefix | Controls | Source |
|---|---|---|
| `IAM` | 7 | evidence area identity and access; no SWAO analysis pass emits signals with this prefix |
| `TF` | 7 | [Pass 06 (TF)](/passes/06-tf) |
| `OBS` | 7 | evidence area observability, logging and monitoring; no SWAO analysis pass emits signals with this prefix |
| `CRYPTO` | 6 | [Pass 08 (CRYPTO)](/passes/08-crypto) |
| `DATA` | 4 | [Pass 03 (DATA)](/passes/03-data) |
| `SBOM` | 2 | [Pass 05 (SBOM)](/passes/05-sbom) |
| `INV` | 1 | [Pass 01 (INV)](/passes/01-inv) |
| `EGR` | 1 | [Pass 07 (EGR)](/passes/07-egr) |

### Examples

Controls with code or configuration evidence:

- `BSI_C5_IDM-01` Identity and access management policies (`IAM`)
- `BSI_C5_IDM-02` Multi-factor authentication for privileged access (`IAM`)
- `BSI_C5_IDM-03` Access rights review and recertification (`IAM`)

Controls that need documents:

- `BSI_C5_OIS-01` Information security policy documented and communicated
- `BSI_C5_OIS-02` Information security roles and responsibilities defined

Place documents in `apps/<app-id>/wsp/inputs/` so that [Pass 04 (CTX)](/passes/04-ctx) reads them and turns them into signals; see also [Workspace setup](/workspace-setup). Without them, expect `UNKNOWN` for document-based controls.

### Sovereignty requirements in the landing-zone assessment

The framework metadata declares sovereignty requirements that the [landing-zone assessment](/assessment/landing-zone) reads when BSI_C5 is selected: forbidden exposure to `us_cloud_act` and `fisa_702`, operator jurisdiction `EU-entity`, and required certification `BSI_C5`. These requirements act on the landing-zone fit, independently of the control evaluation.

## Control structure

| Group | Controls | Example controls |
|---|---|---|
| OIS: Organisational Information Security | 5 | `BSI_C5_OIS-01` Information security policy documented and communicated; `BSI_C5_OIS-02` Information security roles and responsibilities defined |
| PRY: Physical Security | 4 | `BSI_C5_PRY-01` Physical access control to data centre and server rooms; `BSI_C5_PRY-02` Environmental controls for data centre facilities |
| HRS: Human Resources Security | 4 | `BSI_C5_HRS-01` Background verification for staff in sensitive roles; `BSI_C5_HRS-02` Security awareness training programme |
| IDM: Identity and Access Management | 6 | `BSI_C5_IDM-01` Identity and access management policies; `BSI_C5_IDM-02` Multi-factor authentication for privileged access |
| CRY: Cryptography | 4 | `BSI_C5_CRY-01` Cryptography policies and key management; `BSI_C5_CRY-02` Encryption of data at rest for sensitive and personal data |
| COS: Communication Security | 4 | `BSI_C5_COS-01` Network segmentation and zone architecture; `BSI_C5_COS-02` Firewall management and rule review process |
| OPS: Operations | 6 | `BSI_C5_OPS-01` Change management process for cloud infrastructure; `BSI_C5_OPS-02` Patch and vulnerability management |
| AVL: Availability and Resilience | 4 | `BSI_C5_AVL-01` Business continuity plan covering cloud services; `BSI_C5_AVL-02` Recovery time and recovery point objectives defined and tested |
| DEV: Procurement and Development | 4 | `BSI_C5_DEV-01` Security requirements in software procurement; `BSI_C5_DEV-02` Secure software development lifecycle |
| INM: Incident Management | 4 | `BSI_C5_INM-01` Incident response plan and team defined; `BSI_C5_INM-02` Incident classification and escalation procedure |
| SIM: Security Incident Management | 3 | `BSI_C5_SIM-01` Security event monitoring and alerting; `BSI_C5_SIM-02` Forensic capability and evidence preservation |
| COM: Compliance | 3 | `BSI_C5_COM-01` Legal and regulatory compliance register; `BSI_C5_COM-02` Internal audit programme covering C5 criteria |
| PSS: Portability and Interoperability | 2 | `BSI_C5_PSS-01` Data export capability and format documentation; `BSI_C5_PSS-02` Service termination and data return or deletion |
| BCP: Business Continuity Planning | 2 | `BSI_C5_BCP-01` Crisis communication plan for cloud service disruption; `BSI_C5_BCP-02` Supplier dependency mapping and exit strategy |
| DAT: Data Security | 4 | `BSI_C5_DAT-01` Data security: classification and protection; `BSI_C5_DAT-02` Data residency controls and documentation |
| PI: Personal Information / Privacy | 3 | `BSI_C5_PI-01` Privacy by design in cloud service architecture; `BSI_C5_PI-02` Data subject rights fulfilment process |
| **Total** | **62** | |

Default severities: critical 4, high 38, medium 20.

## Cross-mapping to other frameworks

62 of 62 controls carry `maps_to` references to controls of other frameworks. The table counts the references per target framework. "Resolved" means the target ID exists as a control in a bundled SWAO catalogue; "unresolved" means the reference points at article or clause level, or uses an ID spelling that no catalogue contains.

| Target framework | Resolved references | Unresolved references |
|---|---|---|
| `ISO_27001` | 97 | 0 |
| `BSI_GRUNDSCHUTZ_2023` | 44 | 0 |
| `GDPR` | 17 | 0 |

In the other direction, controls of these frameworks reference BSI_C5 controls: `EUCS` (55), `KRITIS_DE` (22).

In addition, the metadata (`cross_mapping_hints`) names these related frameworks: `BSI_GRUNDSCHUTZ_2023`, `ISO_27001`, `GDPR`, `SOC_2`, `EUCS`, `DORA`. This list indicates thematic overlap; it is not a control-level mapping.

## Get or customise this framework

- Source to view and copy: [github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-c5](https://github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-c5)
- Overview of all community frameworks: [github.com/Accenture/SWAO/tree/main/community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks)

To customise the framework for one engagement, copy the `bsi-c5` folder (with `framework-meta.yaml` and `controls.yaml`) into the workspace at `wsp/inputs/catalogs/community/bsi-c5/` and edit the copy there. SWAO reads catalogues for the compliance evaluation from this directory, so the workspace copy is the one that counts. Keep the `id` in `regime_meta` unchanged so that `regimes_active` still finds it, and check the copy afterwards with the [health check](/health-check).

## How to enable

1. Make sure the `bsi-c5` folder is present under `wsp/inputs/catalogs/community/` in the workspace (see above). After `swao init`, new workspaces contain only the demo frameworks `gdpr-demo`, `ai-10-pillars-demo`, `nist-sp-800-66r2-demo` and `bsi-grundschutz-2023-demo`.
2. Add the framework ID to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

   ```yaml
   assessment:
     regimes_active: [BSI_C5]
   ```

   List several frameworks to evaluate them together, for example `regimes_active: [BSI_C5, GDPR]`. Alternatively, `swao regime-select --app app-crm-01 --regimes "BSI_C5"` writes the same entry.
3. Run the [application assessment](/assessment/application) with an LLM configured.

Pass 11 reads `regimes_active` from the app's `.swao.yml`. When the app has no list, it uses the list in the workspace-root `.swao.yml` (which `swao regime-select` writes when `--app` is omitted); a list in the app always takes precedence. If the catalogue is missing, Pass 11 emits a `COMP-NN` signal stating that no catalogue was found.

## Limitations and notes

- SWAO assesses a workload, not a cloud provider. Domains such as PRY (physical security) and HRS (human resources) describe provider or organisational duties; for these SWAO depends on documents you supply or on the provider's own C5 attestation.
- The catalogue covers Basic Criteria only. An official C5 attestation is issued by an auditor, not by SWAO.
- Outcomes come from an LLM that interprets signals and documents. They are a structured starting point for expert review, not an audit opinion or a certification.
- Control texts are paraphrased summaries. The publisher's official source is always authoritative.
- This page and SWAO results are not legal advice.

## Related pages

- [Frameworks overview](/frameworks/)
- [Pass 11: compliance evaluation](/passes/11-comp)
- [Application assessment](/assessment/application)
