# Pass 23: Landing Zone Readiness (LZR)

| Property | Value |
|---|---|
| Pass number | 23 |
| Key | Run with `--lzr <landingZoneId>` (not selected through `--passes`) |
| Signal prefix | `LZR` |
| Type | Deterministic (rule engine on Terraform state or JSON plans; no LLM) |
| Default | Optional: runs only when `--lzr` is given |
| Assessment types | `application` |
| Tier | All tiers for a single app; the portfolio variant (`--portfolio --lzr`) is an Enterprise feature |
| Source | `packages/@swao/module-app-assessment/src/passes/pass-23-lzr.ts`, checks catalogue `controls/landing-zone-checks-catalogue.yaml` |

## What it is for

Pass 23 answers the question: "Is the target landing zone actually ready to receive this application, or is something missing that would block the migration?"

It reads Terraform state files or JSON plans and checks whether the managed services and settings the application needs (for example a Kubernetes cluster, a managed PostgreSQL instance or encryption at rest) are present. The result is a verdict of `ready`, `advisory` or `blocked`, with lists of blockers and warnings and remediation advice.

Pass 23 is different from the **landing zone catalogue fit**, which compares the services an application needs with a cloud provider's published service catalogue for a region. The catalogue fit runs inline in an application assessment when `assessment.landing_zone.provider` and `region` are set, or with `--lz-cat-provider`, `--lz-cat-region` or `--lz-cat-targets`. See [Landing zone assessment](/assessment/landing-zone).

## What you need to provide

| Input | Where | Notes |
|---|---|---|
| Terraform state or plan files | `apps/<app>/wsp/inputs/terraform/*.tfstate` or `*.tfplan` | At least one file is required, otherwise the command exits with an error. A `.tfplan` file must hold the JSON form of the plan (`terraform show -json <plan> > <name>.tfplan`); the binary file written by `terraform plan -out` cannot be read. |
| Landing zone ID | `--lzr <landingZoneId>` | Recorded in the result and used to derive the target provider, for example `lz-stackit-prod` or `lz-aws-eu-central-1` |
| Target provider (optional) | `assessment.landing_zone.provider` in `.swao.yml`, or `--lz-cat-provider` | Used when the landing zone ID names no provider |

Numbered copies created by ingestion (for example `12 terraform-prod.tfstate`) are de-duplicated; the file without the number prefix wins.

## How it works

1. **Find and parse inputs.** List `.tfstate` and `.tfplan` files in `wsp/inputs/terraform/`. State files are read as Terraform state. Plan files are read in the JSON plan format (`planned_values.root_module`, including nested child modules; only managed resources); a plan file that already holds a state document is read as state. Files that cannot be read, such as a binary plan, are listed in `input_files_unparsed` with the reason (for a binary plan, a hint to export it with `terraform show -json`).
2. **Index resources.** Collect all resource types and instances from the parsed files.
3. **Derive the target provider.** The provider is taken, in this order, from the landing zone ID (an exact provider ID from the SWAO cloud provider catalogue, or a vendor token such as `stackit`, `aws`, `azure`, `gcp`, `otc`, `ionos` or `hetzner` in an ID like `lz-aws-eu-central-1`; `aws` together with `esc`, `eusc` or `sovereign` means the AWS European Sovereign Cloud), from `--lz-cat-provider` or `assessment.landing_zone.provider`, and from the provider prefix that most resources in the Terraform input carry (for example `aws_`, `azurerm_`, `google_`, `stackit_`). If none of these names a provider, SWAO falls back to `stackit_de_sovereign` and prints a warning. The source is recorded as `provider_id_source` (`landing_zone_id`, `configuration`, `terraform_resources` or `default`).
4. **Select checks.** Load the checks catalogue (version `2026-04`, 10 checks) and keep the checks for the derived provider plus the generic checks.
5. **Choose the mode.**
   - **Target mode:** the input contains resources of the target provider (resource types starting with the provider's prefix, for example `stackit_`). Each check looks for its Terraform resource types.
   - **Source mode:** the input contains no target-provider resources but does contain source-environment resources, such as `docker_container`. SWAO infers the services in use (for example PostgreSQL from the image name or `POSTGRES_*` environment variables) and checks them against each check's service codes.
6. **Evaluate.** Each check ends as `pass`, `fail`, `not_applicable` or `not_evaluated` (see below). A check that cannot be decided from Terraform input is never dropped silently: it is listed in `checks_not_evaluated` with a reason.
7. **Verdict.** Any failed blocker check makes the overall verdict `blocked`. Otherwise any failed warning check makes it `advisory`. Otherwise it is `ready`.

## How it is measured

### The checks catalogue

| Check ID | Name | Category | Severity | Provider | Terraform resource types | Source service codes |
|---|---|---|---|---|---|---|
| `LZC-STACKIT-01` | SKE (Sovereign Kubernetes Engine) provisioned | service | blocker | `stackit_de_sovereign` | `stackit_ske_cluster` | `kubernetes`, `container_runtime` |
| `LZC-STACKIT-02` | PostgreSQL Flex provisioned | service | blocker | `stackit_de_sovereign` | `stackit_postgresflex_instance`, `stackit_postgresql_instance` | `postgresql` |
| `LZC-STACKIT-03` | Redis (Object Cache) provisioned | service | warning | `stackit_de_sovereign` | `stackit_redis_instance`, `stackit_objectcache_instance` | `redis` |
| `LZC-STACKIT-04` | BSI C5 encryption-at-rest enabled on managed storage | compliance | blocker | `stackit_de_sovereign` | `stackit_objectstorage_bucket`, `stackit_postgresflex_instance` | - |
| `LZC-STACKIT-05` | Object Storage provisioned | service | warning | `stackit_de_sovereign` | `stackit_objectstorage_bucket` | `object_storage`, `s3` |
| `LZC-GEN-01` | Egress to required external endpoints allowed | network | blocker | all | `azurerm_network_security_rule`, `aws_security_group_rule`, `google_compute_firewall` | - |
| `LZC-GEN-02` | TLS termination for ingress traffic | policy | warning | all | - | - |
| `LZC-GEN-03` | Private network (no public IP on data tier) | network | blocker | all | - | - |
| `LZC-GEN-04` | vCPU / compute quota sufficient for workload | quota | warning | all | - | - |
| `LZC-GEN-05` | Object storage quota sufficient | quota | warning | all | - | - |

### Check outcomes

| Mode | Outcome rule |
|---|---|
| Target | `pass` if at least one of the check's resource types (filtered to the provider prefix) is in the input. For `LZC-STACKIT-04` every object storage bucket must also have `server_side_encryption.enabled`; otherwise `fail`. If none is found, the check is `fail`, for blocker and warning checks alike. `LZC-GEN-03` is decided from the attributes of managed database resources: `fail` when one has a public endpoint (for example `publicly_accessible = true` on AWS, `public_network_access_enabled = true` on Azure, `ipv4_enabled` on Cloud SQL, or an ACL with `0.0.0.0/0` on STACKIT database instances), `pass` when all found are private. A check without resource types for this provider, a check that needs an IaC policy scan (`LZC-GEN-02`), the quota checks (`LZC-GEN-04`, `LZC-GEN-05`) and `LZC-GEN-03` without any database resource are `not_evaluated`, each with its reason. |
| Source | `fail` for a blocker or warning check whose service code was detected in the source environment (the service must be provisioned in the target); `not_applicable` when none of its service codes was detected; `not_evaluated` for checks without service codes, because they need target landing zone resources. |

### Signals

Signals are numbered `LZR-01`, `LZR-02` and so on in the order they are produced.

| Signal content | Severity | Emitted when |
|---|---|---|
| Source service detected (with `implies: service_dep:<code>`) | informational | Source mode, one per detected service |
| Check passed, with the resources found | positive | A check passes |
| Required resource not found, with the check description | high | A blocker check fails |
| "advisory, requirement not met", with the check description | medium | A warning check fails |

Failed blocker checks are also listed in `lzrResult.blockers` and failed warning checks in `lzrResult.warnings`, both with remediation text. Service checks are listed in `lzrResult.service_checks` with status `ready`, `blocked` or `warning`; policy and network checks in `policy_checks` and `network_checks` with status `pass`, `fail` or `skipped` (not evaluated, with the reason as note). `quota_checks` stays empty, because quotas are not recorded in Terraform state.

## Third-party modules, tools and external services

| Name | Purpose | Licence | Bundled or optional | When missing or offline |
|---|---|---|---|---|
| Terraform state parser (`@swao/module-iac-scan`) | Reads `.tfstate` JSON | SWAO | Bundled | - |
| JSON plan reader (in Pass 23) | Reads `.tfplan` files in the format of `terraform show -json` | SWAO | Bundled | - |
| Landing zone checks catalogue | Check definitions | SWAO | Bundled | Pass cannot run |
| `js-yaml`, `zod` | Parse and validate the catalogue | MIT | Bundled | - |

Pass 23 does not call Terraform, a cloud API or the network. You produce the state file yourself (for example with `terraform state pull`).

In portfolio mode (`swao assess --portfolio --lzr <label>`, Enterprise) SWAO can also read landing zone snapshots; see the next section. The summary is written to `lzr-summary.json` in the portfolio run directory.

## Landing zone snapshots

A landing zone snapshot is an export of the client's target landing zone: the clusters, databases, caches, quotas and policy compliance that are already deployed there. Portfolio Landing Zone Readiness (Portfolio Operations, Landing Zone Readiness in the TUI, or `swao assess --portfolio --lzr <label>`) evaluates it offline, without a connection to the provider.

### Which file is evaluated

The snapshot files live in `apps/<app>/wsp/inputs/terraform/`. The label picks the file:

| Label | File | Adapter | Provider shown |
|---|---|---|---|
| `lz-meshstack-01` | `lz-meshstack-snapshot.json` | meshStack | meshStack platform with the cloud it manages (first token of `platform_id`, for example STACKIT) |
| `lz-aws-01` | `lz-aws-snapshot.json` | AWS | AWS |
| `lz-azure-01` | `lz-azure-snapshot.json` | Azure | Azure |
| `lz-terraform-01` | any `*.tfstate` or `*.tfplan` | Terraform route (this pass) | derived as described above |

The CLI also accepts the file stem (`lz-azure`) or the file name (`lz-azure-snapshot.json`). An app that does not have the picked file is reported as `skipped` with the missing file name; it is never evaluated on another file. A label that names no snapshot kind (for example `lz-stackit-de-01`) uses the first file found in the order meshStack, AWS, Azure, Terraform.

Each row of `lzr-summary.json` records `source_snapshot` (the file), `picker_label`, `provider_id` (machine key), `provider_map_id` and `provider_label` (the provider name from the central name map), `platform: meshstack` for a meshStack snapshot, and `lzr_snapshot_fabricated` for a sample file. The text report (`swao report --portfolio --view lzr`) shows the provider, the source file and the sample flag per app.

### Sample files

`swao init` seeds the three files with `"sample": true` (and the legacy `"fabricated": true`) so the pass can be demonstrated. Their results are marked `[SIM]`. Replace a sample with an export of the client's target landing zone in the same format before relying on the result.

### Field list per provider

All fields are optional; a missing list counts as empty. `snapshot_generated_at` (ISO timestamp) and `sample` are accepted in every file.

**`lz-aws-snapshot.json`**

| Field | Type | Source in the account |
|---|---|---|
| `eks_clusters[]` | `name`, `status` (`ACTIVE`), `version` | `aws eks list-clusters` and `aws eks describe-cluster` |
| `rds_instances[]` | `identifier`, `engine` (`postgres`), `status` (`available`), `engineVersion` | `aws rds describe-db-instances` |
| `elasticache_groups[]` | `id`, `status` (`available`) | `aws elasticache describe-replication-groups` |
| `config_compliance.non_compliant_rules[]` | `rule`, `resource` | AWS Config, `aws configservice describe-compliance-by-config-rule` |
| `vpc_count` | number | `aws ec2 describe-vpcs` |
| `service_quota_eks_remaining`, `service_quota_rds_remaining` | number | Service Quotas, limit minus usage |

**`lz-azure-snapshot.json`**

| Field | Type | Source in the subscription |
|---|---|---|
| `aks_clusters[]` | `name`, `provisioningState` (`Succeeded`), `kubernetesVersion` | `az aks list` |
| `postgresql_servers[]` | `name`, `state` (`Ready`), `version` | `az postgres flexible-server list` |
| `redis_instances[]` | `name`, `provisioningState` (`Succeeded`) | `az redis list` |
| `keyvault_vaults[]` | `name` | `az keyvault list` |
| `vnet_count` | number | `az network vnet list` |
| `aks_quota_remaining` | number | compute quota of the region, limit minus usage |
| `policy_non_compliant_count`, `policy_violations[]` | number; `policyDefinitionName`, `resourceId` | `az policy state summarize` and `az policy state list` |

**`lz-meshstack-snapshot.json`**

| Field | Type | Source in meshStack |
|---|---|---|
| `platform_id` | string, for example `stackit-de-01`; the first token names the managed cloud | the meshStack platform of the target landing zone |
| `tenant_exists` | boolean | whether the project tenant exists on the platform |
| `building_block_definitions[]` | `identifier`, `displayName`, `status` (`ACTIVE`) | building block definitions of the platform |
| `building_block_instances[]` | `definitionIdentifier`, `state` (`SUCCEEDED`), `displayName` | building block instances of the project |
| `quota_supported` | boolean | whether the platform reports quotas |

**Terraform state or plan:** `terraform state pull > <name>.tfstate`, or `terraform show -json <plan> > <name>.tfplan` for a plan (see "What you need to provide").

### An LZ Live run as the source

When a registered landing zone has an LZ Live run, the picker also lists that run (`live:<landing zone id>`, with the provider and the finish time). `swao assess --portfolio --lzr live:otc-prod` reads the newest usable run of `otc-prod` from `landing-zones/otc-prod/wsp/runs/` (the run named in `latest-lz-live.txt`, else the newest run with a merged view; a failed run is never read). Nothing is fetched from the provider: LZR reads the stored run only. The run belongs to the landing zone, so every app is evaluated against it.

| LZR field | Read from the LZ Live run |
|---|---|
| Kubernetes clusters, databases, caches | resource types of the merged view (`eks.cluster`, `cce.clusters`, `rds.instances`, `dcs.instances`, `postgres-flex.instance` and others); presence only |
| Quotas | the quotas of the scope scans: remaining, or limit minus usage |
| Policy compliance | the guardrails of the merged view (pass, fail, unknown) and the baseline checks |
| Network | VPC and network resources of the merged view |

A field the run does not record is shown as "not recorded by LZ Live" and never as passed, so such a run reads ADVISORY, not READY. A field read only in part, for example guardrails when an application scope login cannot read the organisation policies, or quotas of one region, is shown as partial and never passes either. Not recorded today: the state of a resource (running, available), quota usage on AWS (Service Quotas reports limits only), quotas on T Cloud Public and Azure, guardrails on STACKIT, and Kubernetes clusters and caches on STACKIT. A run served by a mock CSP environment is marked `[SIM]`; a partial run adds a warning. The summary row records `source_kind: lz-live-run`, `live_run` (landing zone, run, status, finish time, folder) and `not_recorded`.

### How LZR differs from the other landing zone checks

| Check | Reads | Where |
|---|---|---|
| LZ catalogue fit | what a provider offers in a region (the landing zone catalogue); no client landing zone | inside the Application Assessment, `lz-catalogue-fit.yaml`; see [Landing zone assessment](/assessment/landing-zone) |
| LZ Live Assessment | the client tenant through the provider API | its own run per registered landing zone; see [Landing zone live assessment](/assessment/landing-zone-live) |
| Landing Zone Readiness (this pass) | an exported snapshot or Terraform state of the target landing zone, offline | `--lzr`; portfolio mode with snapshots or a stored LZ Live run |

## Outputs

| File | Content |
|---|---|
| `apps/<app>/wsp/runs/<ts>/passes/23-lzr.yaml` | Pass header, `LZR-NN` signals, `assessment` summary (`provider_id`, `provider_id_source`, mode, number of input files, `input_files_unparsed`, resource types found, `checks_run`, `checks_not_evaluated` with reasons, `blockers_count`, `warnings_count`, verdict) and the full `lzrResult` |
| `lzr-summary.json` (portfolio run only) | Verdict counts and one entry per app |

The run manifest records the input type used (`terraform`, `snapshot`, `live_api` or `catalogue`).

## Configuration and limitations

| Setting | Effect |
|---|---|
| `--lzr <landingZoneId>` | Runs Pass 23 inside the pass loop, after the static passes, DYNAMIC, SCOPE and MALWARE and before COMP and SYNTH, so that [Pass 09 SYNTH](/passes/09-synth) uses the verdict of the same run |
| `--lz-cat-provider`, `assessment.landing_zone.provider` | Name the target provider when the landing zone ID does not |
| `--lzr-fail-on-blocked` | Exits with code 4 when the verdict is `blocked` (after all passes have run) |
| `--portfolio --lzr <label>` | Portfolio-wide readiness (Enterprise); the label picks the snapshot (see "Landing zone snapshots") |

`lzr` in `--passes` or in a lens does not run this pass; without `--lzr`, SWAO prints a note that Pass 23 needs `--lzr <landingZoneId>`.

Known limitations:

- Provider-specific checks exist only for STACKIT (`LZC-STACKIT-01` to `-05`). For other providers only the generic checks apply, and of those only `LZC-GEN-01` (security group and firewall rules for AWS, Azure and Google Cloud) and `LZC-GEN-03` (data tier) can be decided from Terraform input.
- `LZC-GEN-02` needs an IaC policy scan and `LZC-GEN-04` and `LZC-GEN-05` need quota data; they are always `not_evaluated` in this pass.
- Binary plan files from `terraform plan -out` are not read; export them as JSON first.
- Snapshot files (`lz-*-snapshot.json`) are read only in portfolio mode.

See also [Landing zone assessment](/assessment/landing-zone) and [Portfolio](/portfolio).
