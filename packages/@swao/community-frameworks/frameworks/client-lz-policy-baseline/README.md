<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Client LZ Policy Baseline - Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# Client LZ Policy Baseline (German public agency default)

**Framework ID:** `CLIENT_LZ_POLICY_BASELINE`
**Folder:** `client-lz-policy-baseline`
**Version:** 1.0.0 (`catalogue_version` of `policy-baseline.yaml`)
**Authority:** SWAO default for a German public agency; not an official publication
**SWAO tier:** Community (frameworks are ungated)
**Assessment types:** Application Assessment and Landing Zone Live Assessment
**Controls:** 20, one per policy

## What this framework is

A client organisation has its own landing zone rules, for example "data may only be stored in
German data centres" or "managed PostgreSQL is not allowed". This framework writes such rules
down as a normalised, cross-CSP **policy baseline**, so that SWAO measures the landing zones of
several CSPs against the same rules and shows where each CSP fits and where it does not.

The shipped default is a standard ruleset for a German public agency (federal or state
authority context): data residency in Germany, BSI C5 and IT-Grundschutz oriented controls,
customer-managed keys, no public exposure by default, logging and retention, and a restricted
service list where sovereignty requires it. It is fully populated: every category has a policy
with every parameter filled in, so the framework works as delivered. No agency is named; the
values are generic.

SWAO only reads. It never enforces a policy in a tenant and never writes to a tenant.

## Files

| File | Content |
|---|---|
| `framework-meta.yaml` | Framework identity and scope |
| `controls.yaml` | One control per policy: text, severity, `maps_to` to the source controls, remediation |
| `policy-baseline.yaml` | The policies: kind, category, control, `state`, `params`, `default_source`. **This is the file you edit** |
| `service-controls.yaml` | Capability tags to `CPB-*` controls for the per-service lights |
| `README.md` | This file |

## How to use it

The full workflow (assess, read the comparison, evidence references, publish) is in the
Landing Zone Live Assessment user guide, section "Client LZ Policy Baseline"
(`docs/assessment/landing-zone-live.md`), and on the framework page
`docs/frameworks/client-lz-policy-baseline.md`.

1. Copy the baseline into the workspace: copy this folder from the GitHub repository
   (https://github.com/Accenture/SWAO/tree/main/community-frameworks) into
   `wsp/inputs/catalogs/community/client-lz-policy-baseline/`. SWAO reads
   only the workspace copy; you may rename the copy's folder, because discovery goes by the
   `framework.id` in `framework-meta.yaml`.

2. Edit `policy-baseline.yaml` in the copy. Per policy set `state` (`enabled`, `disabled` or
   `not_set`) and the `params` of its kind. Values you leave out take the shipped default.
   Edit with a text editor, or with an AI chat or agent (for example SWAO Chat).

3. Validate the copy with the workspace health check (`swao health-check`). Schema errors
   fail the framework line; `not_set` policies, capability tags that no resolved landing
   zone catalogue uses and a stale copy are reported as warnings.

4. Select the framework:

   - **Landing Zone Live Assessment:** `--frameworks CLIENT_LZ_POLICY_BASELINE` on
     `swao assess --type landing-zone-live --lz <lz-id>`, else the workspace
     `assessment.frameworks` or `assessment.regimes_active`. The folder name
     `client-lz-policy-baseline` is accepted too; a renamed copy is selected by its id.
     One baseline per run.
   - **Application Assessment:** `assessment.regimes_active` in `apps/<app-id>/.swao.yml`,
     written by `swao regime-select --app <app-id> --regimes CLIENT_LZ_POLICY_BASELINE`.
     An app run refuses `--frameworks` (exit 1). The baseline controls of an app are
     decided by rule from the landing zone evidence, never by an LLM.

### Adding your own policies

Add a policy of an existing kind with an id of the form `X-<PREFIX>-<CAT>-NN` (for example
`X-ORG-SVC-01`), give every parameter of its kind, and add a control with the same id to
`controls.yaml`. The `CPB-` prefix is reserved for shipped policies, so your own ids never
collide with shipped ones. New kinds need a SWAO release.

### Several baselines in one workspace

Copy the folder under another name (for example `client-lz-policy-baseline-high/`) and give
the copy its own id, for example `CLIENT_LZ_POLICY_BASELINE_HIGH`: change `framework.id` in
`framework-meta.yaml`, `regime_meta.id` in `controls.yaml` and `framework:` in
`policy-baseline.yaml` and `service-controls.yaml`; keep
`baseline_of: CLIENT_LZ_POLICY_BASELINE`. Different ids never collide.

### Newer versions

SWAO never updates a community framework, and so never updates your copy: there is no
automatic and no command-driven upgrade (owner decision 2026-11-08). Your copy keeps its
`catalogue_version`; the health check warns when it is older than the shipped one and names
the shipped policies missing from the copy. If you want a newer version, take it from the
GitHub repository by hand and carry your settings over; add new shipped policies with
`state: not_set` until you have reviewed them.

## Policy kinds

| Category | Kind | Parameters |
|---|---|---|
| `data_residency` | `region_residency` | `allowed_countries` (ISO 3166-1 alpha-2 or `EU`), `allowed_operator_jurisdictions`, `forbid_exposure`, `required_certifications` |
| `service_control` | `service_deny`, `service_allow_list` | `capabilities` (SWAO capability tags) |
| `encryption` | `encryption_at_rest` | `min_key_custody` (`provider-managed`, `customer-managed`, `byok`, `hyok`), `applies_to` |
| `encryption` | `encryption_in_transit` | `min_tls_version` (`"1.2"` or `"1.3"`, quoted), `applies_to` |
| `network_exposure` | `no_public_exposure` | `allow_capabilities` |
| `network_exposure` | `no_open_admin_ingress` | `ports`, `forbidden_sources` (CIDR) |
| `identity` | `privileged_mfa` | none |
| `identity` | `credential_age` | `max_age_days` |
| `logging` | `audit_trail` | `all_regions` |
| `logging` | `log_retention` | `min_days` |
| `tagging` | `required_tags` | `keys` |
| `availability` | `min_availability_zones` | `min` |
| `resilience` | `backup_configured` | `applies_to` |
| `cost` | `budget_alerts` | `required` |
| `portability` | `documented_exit` | none |

## Shipped policies

| Policy | Kind | Default state | Default parameters |
|---|---|---|---|
| CPB-RES-01 | `region_residency` | enabled | `allowed_countries: [DE]` |
| CPB-RES-02 | `region_residency` | enabled | `allowed_operator_jurisdictions: [EU-entity]`, `forbid_exposure: [us_cloud_act, fisa_702]` |
| CPB-RES-03 | `region_residency` | enabled | `required_certifications: [BSI_C5]` |
| CPB-SVC-01 | `service_deny` | disabled | managed AI and ML capabilities |
| CPB-SVC-02 | `service_allow_list` | disabled | example allow-list of 26 capabilities |
| CPB-SVC-03 | `service_deny` | disabled | `capabilities: [postgresql]` |
| CPB-ENC-01 | `encryption_at_rest` | enabled | `min_key_custody: customer-managed` for storage and databases |
| CPB-ENC-02 | `encryption_in_transit` | enabled | `min_tls_version: "1.2"` for load balancer, API gateway, CDN |
| CPB-NET-01 | `no_public_exposure` | enabled | allowed: load balancer, WAF, API gateway |
| CPB-NET-02 | `no_open_admin_ingress` | enabled | ports 22 and 3389 from `0.0.0.0/0` and `::/0` |
| CPB-NET-03 | `no_open_admin_ingress` | enabled | database ports 1433, 3306, 5432, 6379, 27017 from the internet |
| CPB-IAM-01 | `privileged_mfa` | enabled | none |
| CPB-IAM-02 | `credential_age` | enabled | `max_age_days: 90` |
| CPB-LOG-01 | `audit_trail` | enabled | `all_regions: true` |
| CPB-LOG-02 | `log_retention` | enabled | `min_days: 180` |
| CPB-TAG-01 | `required_tags` | enabled | `keys: [owner, data-classification]` |
| CPB-AVL-01 | `min_availability_zones` | enabled | `min: 2` |
| CPB-BCK-01 | `backup_configured` | enabled | block storage, databases, file storage |
| CPB-COST-01 | `budget_alerts` | enabled | `required: true` |
| CPB-PRT-01 | `documented_exit` | enabled | none (always a manual evidence item) |

## Sourced defaults and assumptions

Each default names the shipped SWAO control ids it derives from (`default_source` in
`policy-baseline.yaml`, `maps_to` in `controls.yaml`). The shipped ids are SWAO paraphrases of
BSI C5:2020 and BSI IT-Grundschutz 2023; reviewers check the official text. A value without a
source in the repository is marked **assumption**. Assumptions are accepted defaults, not
official requirements; review them for your organisation. The tables below list every
policy whose `default_source` contains an assumption, with the assumed default value.

Where a DORA article covers the same subject, `default_source` also names the DORA control and
article (#4058), for example DORA_Art_28_5 exit strategies for CPB-PRT-01. This is a reference
for financial entities under Regulation (EU) 2022/2554; it changes no default and no policy logic.

**Demonstration values** (pure assumptions, `default_source: assumption`, shipped so the
framework works in a presentation; CPB-SVC-01 to CPB-SVC-03 ship disabled):

| Policy | State | Assumed default value |
|---|---|---|
| CPB-SVC-01 | disabled | `capabilities: [managed_llm, ml_inference, ml_training, ml_speech, ml_translation, ml_vision, ml_nlp]` (managed AI and ML services denied) |
| CPB-SVC-02 | disabled | `capabilities: [vm_compute, kubernetes, container_orchestration, object_storage, block_storage, file_storage, postgresql, mysql, redis, key_vault, secrets_management, load_balancer, dns, vpn, vpc_networking, waf, network_firewall, identity_management, certificate_management, container_registry, audit_logging, monitoring, log_management, metrics, ci_cd, iac]` (example allow-list, 26 capabilities) |
| CPB-SVC-03 | disabled | `capabilities: [postgresql]` (managed PostgreSQL forbidden; demonstration of a client rule) |
| CPB-COST-01 | enabled | `required: true` (a budget alert is required; common public-sector budget rule, no security source) |

**Sourced defaults with an assumed part:**

| Policy | Source | Assumed part | Default value |
|---|---|---|---|
| CPB-RES-01 | BSI_C5_DAT-02, BSI_OPS22_A3 | Place of processing fixed by the buyer under EVB-IT Cloud (clause text not in the repository) | `allowed_countries: [DE]` |
| CPB-RES-02 | SWAO BSI C5 sovereignty gate (`bsi-c5/framework-meta.yaml`) | That it applies to every public agency workload | `allowed_operator_jurisdictions: [EU-entity]`, `forbid_exposure: [us_cloud_act, fisa_702]` |
| CPB-RES-03 | BSI_C5_COM-03 | Deutsche Verwaltungscloud-Strategie as the basis for C5 as the entry criterion | `required_certifications: [BSI_C5]` |
| CPB-ENC-01 | BSI_C5_CRY-01, BSI_C5_CRY-02, BSI_CON1_A2, BSI_CON1_A4 | `customer-managed` rather than `byok` or `hyok` | `min_key_custody: customer-managed`, `applies_to: [object_storage, block_storage, file_storage, postgresql, mysql, nosql_database]` |
| CPB-ENC-02 | BSI_C5_PI-03 | TLS floor 1.2 following BSI TR-02102-2 (TR not in the repository) | `min_tls_version: "1.2"`, `applies_to: [load_balancer, api_gateway, cdn]` |
| CPB-NET-02 | BSI_C5_COS-02, BSI_C5_COS-03, BSI_NET32_A1 | The port list | `ports: [22, 3389]`, `forbidden_sources: ["0.0.0.0/0", "::/0"]` |
| CPB-NET-03 | Sources of CPB-NET-02, BSI_APP43_A1 | The port list | `ports: [1433, 3306, 5432, 6379, 27017]`, `forbidden_sources: ["0.0.0.0/0", "::/0"]` |
| CPB-IAM-02 | BSI_C5_IDM-05, BSI_C5_CRY-03 | 90 days | `max_age_days: 90` |
| CPB-LOG-02 | Sources of CPB-LOG-01 | 180 days | `min_days: 180` |
| CPB-TAG-01 | BSI_C5_OPS-04, BSI_C5_DAT-01 | The key names | `keys: [owner, data-classification]` |
| CPB-AVL-01 | BSI_C5_AVL-03 | The number 2 | `min: 2` |

**Fully sourced:** CPB-NET-01, CPB-IAM-01, CPB-LOG-01, CPB-BCK-01, CPB-PRT-01.

## Licence

Apache-2.0. The control texts are original SWAO wording.
