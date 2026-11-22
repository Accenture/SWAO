# Client LZ Policy Baseline (CLIENT_LZ_POLICY_BASELINE)

This page describes the community framework `CLIENT_LZ_POLICY_BASELINE` as shipped with SWAO: what it is, which policies it ships with which defaults, and how a client turns it into its own landing zone rules. The workflow (copy, edit, health check, assess, evidence references, publish, reading the comparison) is in the [Landing Zone Live Assessment](/assessment/landing-zone-live#client-lz-policy-baseline) guide.

## Summary

| Property | Value |
|---|---|
| Framework ID | `CLIENT_LZ_POLICY_BASELINE` |
| Display name | Client LZ Policy Baseline (German public agency default) |
| Authority / publisher | SWAO default for a German public agency; not an official publication |
| SWAO catalogue version | 1.0.0 |
| Policies and controls | 20 policies, one control each, in 11 categories |
| Assessment types | `app` (Application Assessment) and `lz` (Landing Zone Live Assessment) |
| Decided by | Rules on landing zone evidence; never sent to an LLM |
| Tier | Community (copy, edit, validate); evaluation tiers in the guide |
| Folder | `client-lz-policy-baseline` |

## What it is

A client organisation has its own landing zone rules, for example "data may only be stored in German data centres" or "managed PostgreSQL is not allowed". The baseline writes such rules down once, as normalised policies that apply to every provider (T Cloud Public, AWS, Azure, STACKIT). SWAO measures each landing zone against the same rules and shows where each provider fits and where it does not. SWAO only reads; it never enforces a policy in a tenant.

The shipped default is a standard ruleset for a German public agency: data residency in Germany, BSI C5 and IT-Grundschutz oriented controls, customer-managed keys, no public exposure by default, logging and retention, and a restricted service list where sovereignty requires it. It is fully populated, so it works as delivered. No agency is named and the values are generic. Every default either cites the SWAO control it derives from or is marked as an **assumption**.

## Files

What sets this framework apart is `policy-baseline.yaml`, the file of policies the client edits. The folder holds:

| File | Content |
|---|---|
| `framework-meta.yaml` | Framework identity and scope |
| `controls.yaml` | One control per policy: text, severity, `maps_to` to the source controls, remediation |
| `policy-baseline.yaml` | The policies: kind, category, control, `state`, `params`, `default_source`. **The client edits this file** in its workspace copy |
| `service-controls.yaml` | Capability tags to `CPB-*` controls, for the per-service light column |
| `policy-guidance.yaml` | Per policy the deciding question and the options with pros, cons and a source, for the guided consultation (read from the copy SWAO ships, never from the client copy) |
| `README.md` | Copy, edit and validate; every assumption default |

## Policy kinds

Each policy has a kind with its own parameters. A client adds policies of these kinds only; a new kind needs a SWAO release.

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

| Policy | Kind | Default state | Default parameters | Default source |
|---|---|---|---|---|
| CPB-RES-01 | `region_residency` | enabled | `allowed_countries: [DE]` | BSI_C5_DAT-02, BSI_OPS22_A3; assumption in part |
| CPB-RES-02 | `region_residency` | enabled | `allowed_operator_jurisdictions: [EU-entity]`, `forbid_exposure: [us_cloud_act, fisa_702]` | SWAO BSI C5 sovereignty gate; assumption in part |
| CPB-RES-03 | `region_residency` | enabled | `required_certifications: [BSI_C5]` | BSI_C5_COM-03; assumption in part |
| CPB-SVC-01 | `service_deny` | disabled | `capabilities: [managed_llm, ml_inference, ml_training, ml_speech, ml_translation, ml_vision, ml_nlp]` | assumption |
| CPB-SVC-02 | `service_allow_list` | disabled | example allow-list of 26 capabilities (listed in the README) | assumption |
| CPB-SVC-03 | `service_deny` | disabled | `capabilities: [postgresql]` | assumption |
| CPB-ENC-01 | `encryption_at_rest` | enabled | `min_key_custody: customer-managed`, `applies_to: [object_storage, block_storage, file_storage, postgresql, mysql, nosql_database]` | BSI_C5_CRY-01, BSI_C5_CRY-02, BSI_CON1_A2, BSI_CON1_A4; assumption in part |
| CPB-ENC-02 | `encryption_in_transit` | enabled | `min_tls_version: "1.2"`, `applies_to: [load_balancer, api_gateway, cdn]` | BSI_C5_PI-03; assumption in part |
| CPB-NET-01 | `no_public_exposure` | enabled | `allow_capabilities: [load_balancer, waf, api_gateway]` | BSI_C5_COS-01, BSI_NET11_A2 |
| CPB-NET-02 | `no_open_admin_ingress` | enabled | `ports: [22, 3389]`, `forbidden_sources: ["0.0.0.0/0", "::/0"]` | BSI_C5_COS-02, BSI_C5_COS-03, BSI_NET32_A1; assumption in part |
| CPB-NET-03 | `no_open_admin_ingress` | enabled | `ports: [1433, 3306, 5432, 6379, 27017]`, `forbidden_sources: ["0.0.0.0/0", "::/0"]` | sources of CPB-NET-02, BSI_APP43_A1; assumption in part |
| CPB-IAM-01 | `privileged_mfa` | enabled | none | BSI_C5_IDM-02 |
| CPB-IAM-02 | `credential_age` | enabled | `max_age_days: 90` | BSI_C5_IDM-05, BSI_C5_CRY-03; assumption in part |
| CPB-LOG-01 | `audit_trail` | enabled | `all_regions: true` | BSI_C5_OPS-06, BSI_C5_SIM-01, BSI_DER1_A2 |
| CPB-LOG-02 | `log_retention` | enabled | `min_days: 180` | sources of CPB-LOG-01; assumption in part |
| CPB-TAG-01 | `required_tags` | enabled | `keys: [owner, data-classification]` | BSI_C5_OPS-04, BSI_C5_DAT-01; assumption in part |
| CPB-AVL-01 | `min_availability_zones` | enabled | `min: 2` | BSI_C5_AVL-03; assumption in part |
| CPB-BCK-01 | `backup_configured` | enabled | `applies_to: [block_storage, postgresql, mysql, nosql_database, file_storage]` | BSI_C5_AVL-04, BSI_CON3_A2 |
| CPB-COST-01 | `budget_alerts` | enabled | `required: true` | assumption |
| CPB-PRT-01 | `documented_exit` | enabled | none (always a manual evidence item) | BSI_C5_PSS-01, BSI_C5_BCP-02 |

The control ids in the source column are SWAO's paraphrases of BSI C5:2020 and BSI IT-Grundschutz 2023; reviewers check the official text. "Assumption in part" means that a value of the row has no source in the repository (for example the port list, 90 days, 180 days or the TLS floor 1.2). The README of the framework lists every assumed value; the baseline summary of the publication lists every policy whose default is an assumption. Assumptions are accepted defaults, not official requirements: review them for your organisation.

CPB-SVC-01 to CPB-SVC-03 ship disabled. They are demonstration sets: enable CPB-SVC-03 for the example "managed PostgreSQL is not allowed".

## Generic examples

**Data only in German data centres.** This is the shipped default of CPB-RES-01 (`allowed_countries: [DE]`). In a Landing Zone Live Assessment, a region outside Germany that the landing zone uses fails the policy, and every service offered in a non-German region is red in the baseline light column. Changing the value to `[EU]` accepts the 27 EU member states.

**Managed PostgreSQL forbidden.** Set `state: enabled` on CPB-SVC-03 (`capabilities: [postgresql]`). The offering verdict is `READY` when PostgreSQL is restricted or not offered in the landing zone and `READY_WITH_CHANGES` when it is enabled; the estate check fails when a PostgreSQL instance is deployed. An application that needs PostgreSQL gets `BLOCKED_BY_POLICY` with the evidence `baseline:CPB-SVC-03` and a `GAP` on the control.

**Your own rule.** A policy of an existing kind with an id of the form `X-<PREFIX>-<CAT>-NN`, every parameter of its kind and a matching control in `controls.yaml`:

```yaml
  - id: X-ORG-TAG-01
    kind: required_tags
    category: tagging
    control: X-ORG-TAG-01
    state: enabled
    params:
      keys: [cost-centre]
    default_source: "Internal tagging standard"
```

## How SWAO decides the controls

The controls of this framework are never sent to an LLM. In a Landing Zone Live Assessment each enabled policy gets an offering verdict and an estate status per scope. In an Application Assessment, Pass 11 (compliance evaluation) decides each control by rule from the landing zone evidence the user chose (static catalogue or live results): `SATISFIED`, `PARTIAL`, `GAP`, `UNKNOWN` or `N_A`, worst-of over the targets or scopes, with the ranked contributions kept. The [guide](/assessment/landing-zone-live#client-lz-policy-baseline) explains both.

## How to enable it

Copy the folder `client-lz-policy-baseline` from the [GitHub repository](https://github.com/Accenture/SWAO/tree/main/community-frameworks) into `wsp/inputs/catalogs/community/client-lz-policy-baseline/` in the workspace. Edit `policy-baseline.yaml` in that copy with a text editor, or with an AI chat or agent (for example SWAO Chat). For a second baseline, copy the folder under another name and give it its own id (`framework.id` in `framework-meta.yaml`, `regime_meta.id` in `controls.yaml`, `framework:` in `policy-baseline.yaml` and `service-controls.yaml`), keeping `baseline_of`. Then:

```bash
swao framework list
swao health-check
# Landing Zone Live Assessment
swao assess --type landing-zone-live --lz otc-prod --frameworks client-lz-policy-baseline
# Application Assessment
swao regime-select --app app-crm-01 --regimes CLIENT_LZ_POLICY_BASELINE
swao assess --app app-crm-01 --lz-cat-targets otc:eu-de
```

## Guided consultation over MCP (Enterprise)

An MCP client (SWAO Chat, Claude Desktop, Claude Code, Kilo, Cursor or VS Code) can walk the client and its stakeholders through the baseline with the prompt `swao_baseline_consult` (optionally per category, for example `logging`). Per policy it explains what the policy means, asks the deciding question, shows the options with their pros, cons and sources, and, on request, the effect of a candidate value on the stored Landing Zone Live results (counts per landing zone, re-evaluated from the last run, not a new live read). It then proposes the edit as a diff of `policy-baseline.yaml`.

Nothing is written until the user confirms. The client asks for the confirmation in its own dialog where it supports MCP elicitation; a client without it writes only when the workspace opts in with `mcp.baseline_write: client-approval` in `.swao.yml` (`disabled` turns writing off). SWAO keeps a backup of the previous file under `wsp/backups/policy-baseline/`, validates the result with the health-check rules and logs the write with counts only. An optional short rationale per value is stored in the file as a decision record (`policy-baseline.yaml` schema 0.2). The guidance text is a draft pending review; it is not legal or official advice.

## Important notes

- The shipped baseline is a generic default, not an official publication of any authority. It does not replace an audit or legal advice.
- A client baseline is workspace data: it lives in the client's workspace copy and is never bundled or published.
- SWAO never updates the client's copy (owner decision 2026-11-08): there is no automatic and no command-driven upgrade. The health check reports a stale copy; a newer version is taken from the GitHub repository by hand.
- Policy results carry counts, pseudonymised labels and evidence references; native resource ids and tag values never reach a publication.
- When several frameworks are selected, their residency requirements are merged as a union, so a framework that accepts `EU` widens a Germany-only rule. The requirement provenance block of the publication shows which framework contributed which value.
