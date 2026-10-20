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

In portfolio mode (`swao assess --portfolio --lzr <id>`, Enterprise) SWAO picks an adapter per app: snapshot files `lz-meshstack-snapshot.json`, `lz-aws-snapshot.json` or `lz-azure-snapshot.json` in `wsp/inputs/terraform/` are evaluated by the meshStack, AWS or Azure adapters; otherwise the Terraform route above is used. The summary is written to `lzr-summary.json` in the portfolio run directory.

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
| `--portfolio --lzr <id>` | Portfolio-wide readiness (Enterprise) |

`lzr` in `--passes` or in a lens does not run this pass; without `--lzr`, SWAO prints a note that Pass 23 needs `--lzr <landingZoneId>`.

Known limitations:

- Provider-specific checks exist only for STACKIT (`LZC-STACKIT-01` to `-05`). For other providers only the generic checks apply, and of those only `LZC-GEN-01` (security group and firewall rules for AWS, Azure and Google Cloud) and `LZC-GEN-03` (data tier) can be decided from Terraform input.
- `LZC-GEN-02` needs an IaC policy scan and `LZC-GEN-04` and `LZC-GEN-05` need quota data; they are always `not_evaluated` in this pass.
- Binary plan files from `terraform plan -out` are not read; export them as JSON first.
- Snapshot files (`lz-*-snapshot.json`) are read only in portfolio mode.

See also [Landing zone assessment](/assessment/landing-zone) and [Portfolio](/portfolio).
