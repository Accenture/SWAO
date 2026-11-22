# Landing Zone Live Assessment

The Landing Zone Live Assessment reads a **deployed** landing zone through the cloud
provider's own read-only APIs. It reports what the landing zone actually offers and
contains: regions, enabled services, guardrails, resources, quotas and recent activity.
The [Landing Zone Catalog Assessment](/assessment/landing-zone) asks whether a provider
region *could* host an application. The live assessment answers *what is there now* in
one of your tenants, and how it compares with the last run.

SWAO only reads. Every request passes a read-only gate before it is sent, and credentials
stay in the SWAO credential vault.

---

## Supported providers

| Provider | Driver id | Authentication (`--auth`) | Collected |
|---|---|---|---|
| T Cloud Public (formerly Open Telekom Cloud) | `otc` | `iam-password-token` (fields `username`, `password`, `domain`) or `aksk` (fields `access-key-id`, `secret-access-key`, optional `session-token` for a temporary key) | Regions, services (token catalogue, resource registry, public price list), guardrails (CTS tracker), resources (RMS), activity (CTS traces). Quotas are not collected yet |
| Amazon Web Services | `aws` | `session-keys` (fields `access-key-id`, `secret-access-key`, optional `session-token`, `expires-at`) | Regions, services (from the bundled AWS catalogue), guardrails (Organizations, CloudTrail, Config), resources (tagging API), quotas (Service Quotas), activity (CloudTrail) |
| Microsoft Azure | `azure` | `service-principal-secret` (`tenant-id`, `client-id`, `client-secret`) or `service-principal-certificate` (`tenant-id`, `client-id`, `client-certificate`) | Regions, services (resource providers, policy restrictions), guardrails (policy), resources (Resource Graph). Quotas and activity are not collected yet |
| STACKIT | `stackit` | `key-flow` (field `service-account-key`, the key JSON) | Regions, services (Service Enablement), resources, quotas. Guardrails and activity are not collected yet |

Azure managed identity is not supported. The minimal read roles per provider are listed
in the driver's `ROLES.md`, next to the driver source in
`packages/@swao/module-landing-zone/src/live/<provider>/`.

**T Cloud Public access keys (`aksk`).** Requests are signed with the access key (AK/SK, the
`SDK-HMAC-SHA256` scheme of the T Cloud Public SDKs); the driver sends read requests only and never
records the key, the signature or the token. Use a **temporary** access key with its
`session-token` (for example one issued for 15 minutes from your operator login); never
create a permanent access key for SWAO on a tenant. The user behind a temporary key cannot
be looked up, so its probe result is `unverifiable` and a run needs
`--accept-unverified-read-only`. `scripts/lz-credentials-to-vault.mjs --csp otc --auth aksk`
stores the access key and the secret key only; store the `session-token` with
`swao lz connect --credentials-file` or `swao credential set`.

A source that cannot be read is not a failure of the run: it is listed as
`not_collected` with the reason (for example the HTTP status), and the rest of the scope
is still collected.

### Which drivers a build offers

A driver is offered once it has been verified against a live tenant: `otc`, `aws` and
`stackit` are offered in every build. `azure` is not yet verified and is offered only when
you name it in the environment variable `SWAO_LZ_UNVERIFIED_DRIVERS` (comma separated, for
example `SWAO_LZ_UNVERIFIED_DRIVERS=azure`). The variable is read from the environment
only, never from `.swao.yml`. The verification covers the driver against a live tenant;
the minimal role set in each `ROLES.md` is still unverified, so check the probe result of
your own role. When no driver is offered,
`swao lz list` reports `no live driver for this provider in this build`, and the TUI
shows the same.

---

## Licence tiers

| Capability | Commands | Tier |
|---|---|---|
| Connect and probe | `swao lz connect`, `swao lz probe`, `swao lz list`, `swao lz remove` | Community and above |
| Live scan, assessment and run comparison | `swao lz scan`, `swao assess --type landing-zone-live`, `swao lz diff` | Consultant and above |
| Publication | `swao publish --lz-live <lz-id>` | Consultant and above |
| Catalogue update from a live run | `swao lz catalogue update --source live` | Consultant and above |
| Portfolio merge and publication | `swao assess --portfolio --type landing-zone-live`, `swao publish --portfolio --block-profile lz-live-portfolio` | Enterprise |
| Client LZ Policy Baseline: copy, edit, validate | Copy the folder from the [GitHub repository](https://github.com/Accenture/SWAO/tree/main/community-frameworks) into `wsp/inputs/catalogs/community/`, edit `policy-baseline.yaml`, `swao health-check` | Community and above |
| Client LZ Policy Baseline: evaluation and evidence references | `swao assess --type landing-zone-live --frameworks client-lz-policy-baseline`, `swao lz evidence`, `swao lz hierarchy` | Consultant and above |
| Client LZ Policy Baseline: comparison of landing zones | `swao publish --portfolio --block-profile lz-live-baseline-comparison` | Enterprise |

---

## Concepts

- **Landing zone.** One tenant of one provider, registered in the workspace `.swao.yml`
  under `landing_zones:` with a kebab-case id, for example `otc-prod`.
- **Scope.** The part of the landing zone one credential can read. A scope has a kind:
  `platform` (the shared foundation; at most one per landing zone) or `application` (one
  application's account, project or subscription, optionally linked to `apps/<app-id>`).
  A scope names its authentication method, its regions and, where the provider needs it,
  a target such as `project`, `subscription`, `account`, `resource_group` or `folder`.
- **Read-only probe.** Before a scope is read, SWAO checks what the credential is
  allowed to do. The result is one of `verified`, `unverifiable` or `refused` (see
  [Read-only probe](#read-only-probe)).

The registration in `.swao.yml` looks like this (written by `swao lz connect`; you rarely
edit it by hand):

```yaml
landing_zones:
  - id: otc-prod
    provider: otc
    display: T Cloud Public production
    scopes:
      - id: platform
        kind: platform
        auth: iam-password-token
        regions: [eu-de, eu-nl]
      - id: crm
        kind: application
        auth: iam-password-token
        regions: [eu-de]
        app: app-crm-01
```

`.swao.yml` never holds a credential. A secret-shaped value under `landing_zones:` is
refused when the file is read, and the accept flags described below cannot be stored in
it either.

---

## Credentials

Credentials live in the SWAO credential vault under the key
`lz:<lz-id>:<scope-id>:<field>`, for example `lz:otc-prod:platform:password`. The field
names are the ones listed per provider above. Values are never printed, logged or written
to a file by SWAO.

You can provide them in three ways:

- **With `swao lz connect`.** Use `--credentials-file <path>` (a file with
  `<field>=<value>` lines) or `--credentials-stdin` (the same lines on standard input),
  so that no value appears on the command line. Delete the file afterwards.
- **From another landing zone.** The SWAO vault is per user (shared by every
  workspace) and keyed by landing zone and scope, so a new landing zone does not see
  the credentials stored for another one.
  `swao lz connect <lz-id> ... --credentials-from <other-lz-id>:<scope-id>`
  copies a stored set of the same provider and auth method to the new scope; the source keys stay. Landing Zone Connections lists these sets (landing
  zone, scope and auth method names, never a value) to confirm one or to enter new
  credentials.
- **Per field.** Run `swao credential set lz:<lz-id>:<scope-id>:<field> -` and type or
  pipe the value.
- **As an environment variable** for automation. Use `SWAO_CREDENTIAL_` followed by the
  key in upper case, with `:` written as `__` and `-` as `_`. For example,
  `SWAO_CREDENTIAL_LZ__OTC_PROD__PLATFORM__PASSWORD`.

Short-lived credentials carry an `expires-at` field (ISO 8601, for example
`2026-11-02T19:59:25+00:00`). It is checked before any request. An expired token stops
the scope with the message `the token for <key> has expired; refresh it`. `swao lz probe`
then exits with code 2, and an assessment records the scope as `failed`.
For AWS IAM Identity Center (SSO), refresh with `aws sso login`, then store the new
session keys again.

Landing zone readiness (Pass 23) used separate `aws-*` and `azure-*` vault keys. Move
them to a scope once with `swao lz connect ... --move-legacy-credentials`. The old keys
are no longer read.

---

## Step by step (CLI)

```bash
# 1. Register a landing zone and its platform scope, store the credentials, probe
swao lz connect otc-prod --provider otc --scope platform --kind platform \
  --auth iam-password-token --region eu-de --region eu-nl \
  --display "T Cloud Public production" --credentials-file ./otc-prod.creds

# 2. Check the registration and the connection state (field names only, never values)
swao lz list

# 3. Probe again at any time: identity, read-only result, readable sources
swao lz probe otc-prod

# 4. Run the assessment of all scopes (Consultant and above)
swao assess --type landing-zone-live --lz otc-prod --frameworks bsi-c5,nis2

# 5. Publish it (Consultant and above)
swao publish --lz-live otc-prod
```

### Command reference

**`swao lz connect <lz-id>`** registers a landing zone scope, stores its credentials and
runs the read-only probe. You must give `--provider`, `--scope`, `--kind`
(`platform` or `application`) and `--auth`. The optional flags are:

- `--region <region>`, repeatable.
- `--target <key=value>`, repeatable, where the key is `project`, `subscription`,
  `account`, `resource_group` or `folder`.
- `--app <app-id>`.
- `--display <name>`.
- `--credentials-file <path>`, `--credentials-stdin` or `--credentials-from <lz-id>:<scope-id>`, one of them.
- `--move-legacy-credentials`.
- `--no-probe`, to register and store only.
- `--accept-unverified-read-only` and `--accept-write-capable-credentials`.
- `--identity-label <label>`, the recording label, default `operator`.

The exit code is that of the probe (0 with `--no-probe`).

**`swao lz probe <lz-id> [--scope <scope-id>]`** prints, per scope, the identity, the
read-only result, the readable and unreadable sources and any endpoint override. It exits
1 when a scope may not proceed.

**`swao lz list`** lists every registered landing zone and scope with its connection
state:

- `credentials stored (N field(s))`
- `credentials missing: ...`
- `token expired, refresh it before a run`
- `the driver has no auth method ...`
- `not checked (no driver)`

**`swao lz remove <lz-id> [--scope <scope-id>]`** removes a scope (the last scope removes
the landing zone) and deletes its credentials from the vault. Earlier run data under
`landing-zones/<lz-id>/` is kept.

**`swao lz scan <lz-id> --mode live --out <dir>`** (Consultant) reads the scopes into a
folder of your choice. It writes `<lz-id>.<scope-id>.lz-live-scan.json`,
`lz-live-merged.yaml` and `lz-live-catalogue.json`. The optional flags are:

- `--scope`.
- `--days <n>`, the activity window, default 7.
- `--stale-days <n>`, default 7. Older scans in `--out` are reported as stale in the
  merge.
- The two accept flags.

`--out` must not be a landing zone catalogue folder.

**`swao assess --type landing-zone-live --lz <lz-id>`** (Consultant) is the full
assessment. The optional flags are:

- `--scope <scope-id>`, repeatable. All scopes by default.
- `--frameworks <ids>`, the community frameworks to evaluate. When omitted, the
  workspace's `assessment.frameworks` or `assessment.regimes_active` is used. The
  frameworks must be installed in the workspace; SWAO never fetches a framework during a
  live assessment.
- The two accept flags.

It exits 0 when every scope is complete, and 1 when a scope is partial, failed or
refused, or the input is invalid.

### Comparing runs

**`swao lz diff <lz-id>`** (Consultant) compares two live runs of a landing zone, scope
by scope:

- `--from <ts>`: the earlier run (default: for each scope, the newest earlier run with a
  scan of it).
- `--to <ts>`: the later run (default: `latest-lz-live.txt`, else the newest run).
- `--scope <scope-id>`: compare one scope only.

A run is named by its folder name or an ISO time. The output lists, per scope, the new
and removed regions, services and resource counts, and every service status change:

```
scope platform: 2026-11-03T08-00-00 -> 2026-11-04T08-00-00
  new: regions none; services cce; resources 3
  removed: regions none; services none; resources 1
  status change: rds in eu-nl: available_not_enabled -> enabled
```

It exits 0 when something was compared and 1 when there is nothing to compare (no run,
an unknown run or scope, or only first scans). In the TUI the done screen of a Landing
Zone Live Assessment offers "Diff vs previous run".

A live command refused by the licence tier prints the `[LICENSE]` block, naming the
required licence, and exits 2, like every licence gate of SWAO (an invalid licence file
exits 3).

---

## Read-only probe

| Result | Meaning | What happens |
|---|---|---|
| `verified` | The credential can only read | The scope is read |
| `unverifiable` | SWAO could not prove that the credential is read-only (for example, the permission check itself is not allowed) | The scope stops with exit code 1, unless you pass `--accept-unverified-read-only` for this run |
| `refused` | The credential can write | The scope stops with exit code 1, unless you pass `--accept-write-capable-credentials` for this run |

An accept flag applies to one run only. It is stamped into the scan
(`read_only_overrides`) and the run manifest, so the publication shows that the operator
accepted it. **An accept flag never changes what SWAO sends.** The HTTP layer allows only
`GET` and `HEAD` over https, plus the few read-type `POST` calls a driver lists (for
example a token request). Anything else is refused before it is sent with the message
`request refused before sending ... SWAO only reads from a landing zone.`

Use a dedicated read-only identity where the provider allows it (see the driver's
`ROLES.md`). Some providers cannot express a read-only login that also allows the probe;
the `ROLES.md` of the driver says which result to expect for each role.

---

## Authentication failures and throttling during a run

- **A token rejected during a run stops the scope at once.** When the provider answers
  `401` to a read request (for example because the token expired or was revoked during
  the run), SWAO stops that scope with
  `authentication failed (HTTP 401): the access token was refused on <route> (expired or revoked during the run)`
  instead of recording every remaining source as not collected. `swao lz scan` and
  `swao lz probe` exit 1; an assessment records the scope as `failed`, runs the other
  scopes, and exits 1. Run again with a fresh token. A `403` is not an authentication
  failure: the source is recorded as `not_collected` and the run goes on.
- **Throttling is retried a few times.** On `429` (and on `503` with a `Retry-After`
  header) SWAO waits as the provider asks (`Retry-After` in seconds or as a date; without
  it 1, 2 and 4 seconds) and retries up to 3 times, at most 30 seconds per wait and 60
  seconds per request. When the provider still refuses, the source is recorded as
  `not_collected` with HTTP status 429; SWAO never waits without limit. The AWS driver
  additionally retries the AWS throttling error codes with its own back-off.

---

## What you get

A run of `swao assess --type landing-zone-live` writes to
`landing-zones/<lz-id>/wsp/runs/<run-id>/` in the workspace:

| File | Content |
|---|---|
| `<lz-id>.<scope-id>.lz-live-scan.json` | One scan per scope: metadata (identity, read-only result and overrides, coverage, sources), offering (regions, services with a status per region, framework lights), estate (resources, guardrails, quotas, activity summary, checks) and the difference to the previous run |
| `lz-live-merged.yaml` | All scopes of the landing zone merged into one view. Each scope is `merged`, `stale` or `missing` |
| `lz-live-catalogue.json` | The observed offering in the landing zone catalogue format, the source for a catalogue update |
| `manifest.json` | Run manifest: frameworks with their checksums, per-scope read-only stamp, coverage, endpoint overrides, the simulated flag |
| `run-status.json` | Overall status and the status per scope (`complete`, `refused`, `failed`) |
| `<lz-id>.<scope-id>.lz-baseline.json` | Only when a [Client LZ Policy Baseline](#client-lz-policy-baseline) is selected: per policy the offering verdict, estate status and observability, the policies not reviewed and disabled, the overall verdict and the baseline hash |
| `evidence-refs.json` | The local evidence map: per `ev:` reference the native id, region, setting and console link. Workspace data only, never published (see "Evidence references" under Client LZ Policy Baseline) |
| `lz-organisational.json` | Only when a selected framework has organisational controls: the controls decided from the documents in `landing-zones/<lz-id>/ingestion/`, with expected, found and missing input names and `ev:` references, never file names (see [Organisational controls](#organisational-controls-ingestion-folder)) |

`landing-zones/<lz-id>/wsp/latest-lz-live.txt` points to the latest run that did not fail.

The service status per region is one of `enabled`, `available_not_enabled`, `restricted`,
`not_offered` or `unknown`. Every value carries its evidence (the API or catalogue it came
from).

Resource tags are pseudonymised per landing zone. The pseudonym salt is kept in the vault
and is not deleted by `swao lz remove`, so pseudonyms stay stable across runs.

### Publication

`swao publish --lz-live <lz-id>` (Consultant; in the TUI **Publish HTML**, mode 4
"Landing Zone Live View") renders the latest run as an HTML publication. The publication
contains:

- the summary, regions and services;
- the estate, checks and findings;
- the run history.

The main blocks:

| Block | Content |
|---|---|
| Summary | Scopes merged, regions, services enabled, resources, failed checks, high findings |
| Regions | One card per country with each region's status and availability zones (available of total), then a service matrix per category with services enabled / observed per region |
| Services | One row per service with its category and capability tags, a status per region, the framework light, and optionally the IaC level and the lowest observed price (`from <amount> <currency> / <unit> (<region>)`). The block options filter by category and IaC level and choose the columns |
| Estate | Resources, guardrails, workloads by kind, quotas (limit, used, remaining), tag coverage (share of tagged resources and number of tag keys; keys and values are not published), and what is new or removed since the previous run, with service status changes |
| Checks and findings | The landing zone checks and the findings per scope |

The service categories are compute, containers, storage, database, cache, messaging,
network, security, analytics, AI and ML, operations, developer, other and unmapped. A
service takes the category of its first capability tag.

With `--out`, the file is named `<lz-id>-lz-live.html`. In the HTML Editor, Export
Template starts from the template of the landing zone live profile, so an exported
template keeps its blocks.

## Organisational controls (ingestion folder)

Some framework controls are organisational: a policy, a plan, a register or minutes of the
management body (`layer: governance` in the framework's `controls.yaml`). No cloud API can
show them. A landing zone run decides those that the catalogue scopes to landing zone
assessments from documents you put into the landing zone's ingestion folder:

```
landing-zones/<lz-id>/ingestion/
```

No configuration is needed. Create the folder and put the documents in it. Each run routes
them as an application assessment routes its `ingestion/` folder:

- the files are copied into `landing-zones/<lz-id>/wsp/inputs/<category>/`;
- text is extracted from PDF, DOCX, XLSX and PPTX.

Then the run evaluates the organisational controls of the selected frameworks. These are the
controls with `layer: governance` and the assessment type `lz`. DORA 2.0.0 has 35
organisational controls, and 8 of them carry `lz` (DORA_Art_5_1, 5_2, 6, 6_3, 9_7, 11_1,
11_4 and 16_1). The other 27 are scoped to application and audit assessments, which decide
them from the content. The run counts them as out of scope and does not decide them.

**Naming.** A document counts for an expected document of a control when its file name
contains the expected input name, ignoring case and separators.
`ICT-Risk-Management-Framework_v3.pdf` works for `ict_risk_management_framework`. A generic
name such as `policies.pdf` works for none. The framework README lists the expected input
names (for DORA: `community-frameworks/dora/README.md`, "Evidence").

**Outcome per control:**

| Outcome | When |
|---|---|
| Documented (SATISFIED) | Every expected document is present and has text |
| Partly documented (PARTIAL) | Some, not all, expected documents are present |
| Not evaluated (UNKNOWN) | No document in the folder, none named after an expected input, only documents without text (a scanned image), or the control names no expected document |
| N/A | `applies_when` does not match `framework_context` in the workspace `.swao.yml` (for example `dora_tlpt_required: "true"`) |

SWAO checks the names and the readability of the documents, not their content. A
documented control still needs a reviewer to confirm the content. A missing document leaves
a control not evaluated; it never fails it. An application assessment decides the same
controls from the content (Pass 04 and Pass 11).

**Where the results appear:**

- `lz-organisational.json` in the run folder;
- the progress line `organisational controls DORA: ...` of the run;
- the **Organisational Controls** block of the `lz-live` publication;
- the governance matrix of the portfolio view;
- the MCP tools `swao_lz_live_posture` and `swao_lz_live_runs`.

Document file names are client content, so they appear in none of these. Each document gets
an `ev:<run>:document:Ref-<hex>` reference instead, and `swao lz evidence <ref>` shows the
file locally. `swao lz scan` does not read the folder.

---

## Catalogue update from a live run

A live run can refresh a landing zone catalogue with what the tenant actually offers:

```bash
# Update the catalogue of one provider from the latest live run of a landing zone
swao lz catalogue update --source live --lz otc-prod --provider otc --dry-run
swao lz catalogue update --source live --lz otc-prod --provider otc

# Use a specific run instead of the latest one
swao lz catalogue update --source live --lz otc-prod --provider otc --run 2026-11-04T08-00-00

# Build a new catalogue for a provider or private cloud that has none yet
swao lz catalogue update --source live --lz my-cloud-prod --new my-cloud
```

The update only adds what the run observed. It never retires a service that was not
seen, and it never raises the catalogue's confidence value. Use `--dry-run` to review the
difference first. In the TUI, **Tools > Update LZ Catalogue** offers the live source once
a landing zone is registered. You pick the landing zone and the run, review the dry-run
difference, then write the catalogue.

A simulated run (see below) never updates a catalogue.

---

## Step by step (TUI)

- **Landing Zone Connections**, reached from the setup of the Landing Zone Live
  Assessment ([Workspace Setup](/workspace-setup)) and from the Landing Zone Live
  Assessment (entry "Add or manage landing zones" in the first step), lets you:
  - add a landing zone (provider, display name);
  - add a scope with its credentials (entered masked and passed to SWAO on standard
    input, never written to a file or shown);
  - probe a scope;
  - migrate legacy landing zone readiness keys;
  - remove a scope or a landing zone.

  The probe result screen explains an `unverifiable` or `refused` result. Accept flags
  are never set from this screen.
- **Run Assessment > Landing Zone Live Assessment** (Consultant) asks for the landing
  zone, the scopes and the frameworks. It shows the probe, and asks for a per-run
  confirmation when a scope needs an accept flag. When the run is done, "Diff vs previous
  run" shows `swao lz diff` for it. With a Client LZ Policy Baseline selected, the results
  step also shows the baseline summary per scope, "Tenant hierarchy" and "Evidence
  references (resolve locally)". The frameworks step names the folder
  `landing-zones/<lz-id>/ingestion/` for organisational documents. The results step shows
  the organisational controls per framework (documented, partly, not evaluated, n/a).
- **Publish HTML > Landing Zone Live View** publishes the latest run.

---

## Portfolio view (Enterprise)

```bash
# Merge the latest live run of every registered landing zone
swao assess --portfolio --type landing-zone-live

# Publish the multi-cloud governance view of that merge
swao publish --portfolio --block-profile lz-live-portfolio
```

The merge writes `wsp/lz-live-portfolio/runs/<run-id>/lz-live-portfolio.yaml` and
updates `wsp/lz-live-portfolio/latest.txt`. Its landing zones also appear in the
portfolio summary. The publication (`lz-live-portfolio.html`) contains:

- governance per landing zone;
- a capability finder across landing zones;
- an estate overview;
- drift between runs;
- the run history.

**Observed landing zone fit of linked applications.** An application scope linked to
an application (`--kind application --app <app-id>`, `app:` in `.swao.yml`) gives that
application an *observed* landing zone fit in the merge: SWAO takes the services the
application's latest assessment needs and checks them against what the scope actually
offers in its regions (the registered regions, else the regions seen enabled). The merge
prints one line per fit
(`app <app> (scope <scope>) in <region>: <verdict>, <n> blocker(s), confidence observed`),
writes it to `app_fits` in the merge file and to `lz_fit` of the application in the
portfolio summary (`confidence: observed`), and the hub publication shows it as its own
row `<provider> / <region> (observed)`, never mixed with the catalogue fit. An application
without assessed signals, a scope that was not merged and a region without sovereignty
facts give no observed fit. Simulated scopes count only with `--include-simulated` and
are marked `[SIM]`.

In the TUI the portfolio screen offers the same two steps as "Landing Zone Live
Assessment (all LZs)" and "Multi-Cloud Governance (HTML)". Simulated runs are left out of
the merge unless you pass `--include-simulated`; they are then marked `[SIM]`.

---

## Client LZ Policy Baseline

A client organisation usually has its own landing zone rules, for example "data may only be
stored in German data centres" or "managed PostgreSQL is not allowed". The **Client LZ
Policy Baseline** is a community framework that writes such rules down once, as a
normalised policy set that applies to every provider. SWAO then measures each landing zone
against the same rules and shows where each provider fits and where it does not. SWAO only
reads: it never enforces a policy in a tenant.

The shipped framework (folder `client-lz-policy-baseline`, id `CLIENT_LZ_POLICY_BASELINE`)
is a fully populated default for a German public agency: 20 policies in 11 categories,
each with a cited source or marked as an assumption. The policies, their parameters and
every assumed default are listed on the framework page
[Client LZ Policy Baseline](/frameworks/client-lz-policy-baseline).

| Capability | Tier |
|---|---|
| Copy, edit and validate the baseline | Community and above |
| Application Assessment against the baseline with the static LZ catalogue | Community and above |
| Baseline evaluation in a Landing Zone Live Assessment, the `lz-live` publication, evidence references | Consultant and above |
| Application Assessment against the baseline with live LZ results | Consultant and above |
| Comparison of several landing zones, the `lz-live-baseline-comparison` publication | Enterprise |

### 1. Get the baseline

Copy the folder `client-lz-policy-baseline` from the
[GitHub repository](https://github.com/Accenture/SWAO/tree/main/community-frameworks) into
`wsp/inputs/catalogs/community/client-lz-policy-baseline/` in your workspace. That copy is
your baseline: SWAO evaluates only the workspace copy. You may rename the copy's folder,
because SWAO finds a framework by the `framework.id` in its `framework-meta.yaml`.
`swao framework list` lists the frameworks in the workspace.

For a second baseline in the same workspace (for example one per protection class), copy
the folder under another name (for example `client-lz-policy-baseline-high/`) and give it
its own id: change `framework.id` in `framework-meta.yaml`, `regime_meta.id` in
`controls.yaml` and `framework:` in `policy-baseline.yaml` and `service-controls.yaml` to,
for example,
`CLIENT_LZ_POLICY_BASELINE_HIGH`, and keep `baseline_of: CLIENT_LZ_POLICY_BASELINE`.

### 2. Edit `policy-baseline.yaml`

Each policy has a `state` (`enabled` is evaluated, `disabled` is listed but not evaluated,
`not_set` is not reviewed yet and not evaluated) and the `params` of its kind. A parameter
you leave out takes the shipped default. Two generic examples:

```yaml
policies:
  # Data may only be stored in German data centres (the shipped default)
  - id: CPB-RES-01
    kind: region_residency
    category: data_residency
    control: CPB-RES-01
    state: enabled
    params:
      allowed_countries: [DE]      # [EU] accepts the 27 member states
    default_source: "..."
  # Managed PostgreSQL is not allowed (ships disabled; enable it)
  - id: CPB-SVC-03
    kind: service_deny
    category: service_control
    control: CPB-SVC-03
    state: enabled
    params:
      capabilities: [postgresql]
    default_source: assumption
```

Your own policies use an existing kind, an id of the form `X-<PREFIX>-<CAT>-NN` (for
example `X-ORG-SVC-01`), every parameter of the kind, and a control with the same id in
`controls.yaml`. The `CPB-` prefix is reserved for shipped policies.

You edit the settings in the YAML file with a text editor, or with an AI chat or agent
(for example SWAO Chat). Run the health check afterwards (next section).

### 3. Health check

`swao health-check` validates `policy-baseline.yaml` in every community framework folder
that has one. A schema error (for example an unknown kind, a wrong parameter type, an
unknown control, a duplicate id, a `CPB-` id that SWAO does not ship or a secret-shaped
value) fails the framework line. Warnings are:

- policies with `state: not_set` (not evaluated until reviewed);
- capability tags that no resolved landing zone catalogue uses;
- a stale copy: its `catalogue_version` is lower than the shipped one; the warning names
  the shipped policies missing from the copy.

See [Health check](/health-check).

### 4. Newer shipped versions

SWAO never changes your copy: there is no automatic and no command-driven upgrade. The
health check reports a stale copy and names the shipped policies it lacks. If you want a
newer version, take it from the [GitHub repository](https://github.com/Accenture/SWAO/tree/main/community-frameworks) by hand
and carry your settings over; add new shipped policies with `state: not_set` until you
have reviewed them.

### 5. Assess

**Landing Zone Live Assessment.** Select the baseline like any framework:

```bash
swao assess --type landing-zone-live --lz otc-prod --frameworks client-lz-policy-baseline
```

`--frameworks` accepts the id (`CLIENT_LZ_POLICY_BASELINE`) or the folder name; a renamed
copy is selected by its id. One baseline per run: a run with two selected baselines, or
with an invalid `policy-baseline.yaml`, is refused before any request is sent. Every
enabled policy is answered twice per scope:

- **Offering:** can this provider meet the policy here? `READY`, `READY_WITH_CHANGES` (the
  tenant has to configure it), `BLOCKED`, `SOVEREIGNTY_BLOCKED` (residency fails in every
  offered region) or `NEEDS_VERIFICATION`.
- **Estate:** is the tenant compliant now? `pass`, `fail`, `warn`, `na` (nothing the policy
  applies to) or `unverified`, each with its observability: `observed`, `catalogue`,
  `not_collected` (the source could not be read) or `not_observable` (no read-only API
  answers it, for example a documented exit plan; such a policy is a manual evidence item).

The baseline also gets its own light column per service. With the Germany-only default,
every service offered in a non-German region of the scope is red in that column. The TUI
results step shows one line per scope with the overall verdict and the estate counts.

**Application Assessment.** Select the baseline for the app; the app is measured against
the static LZ catalogue. Live landing zone data is used only by the Landing Zone Live
Assessment (`swao assess --type landing-zone-live`), never by an Application Assessment:

```bash
swao regime-select --app app-crm-01 --regimes CLIENT_LZ_POLICY_BASELINE

# Static LZ catalogue; targets as provider:region or provider/region
swao assess --app app-crm-01 --lz-source catalogue --lz-cat-targets otc:eu-de,stackit/eu01
```

- An app run refuses `--frameworks` (exit 1); the app's frameworks come from
  `assessment.regimes_active` in `apps/app-crm-01/.swao.yml`.
- `--lz-cat-targets` accepts `provider:region` and the `provider/region` form SWAO prints,
  so a printed target can be passed back. An entry that names no target is refused with
  exit 1.
- `--lz-source live`, `--lz` and `--scope` on an app run are refused with exit 1 before any
  pass, with a pointer to `swao assess --type landing-zone-live --lz <lz-id>`.
- **Linked apps.** An app named in `landing_zones[].scopes[].app` is assessed against the
  static catalogue on every tier, with the warning "live landing-zone data is used only by
  the Landing Zone Live Assessment; assessed against the static LZ catalogue", the linked
  landing zone and scope, and the command for live results; exit 0. `run-context.yaml`
  records `lz_source: catalogue` and the reason (`lz_source_reason`, reason
  `lz-live-assessment-only`). Without configured targets, SWAO seeds them from the scope
  regions of the link in `.swao.yml`; a live run is never read. The link stays for the
  Landing Zone Live Assessment and its publications.

The baseline controls of an app are decided by rule from that evidence, never by an LLM:
`SATISFIED` (policy met), `GAP` (failed), `PARTIAL` (achievable by configuration),
`UNKNOWN` (not verified) or `N_A` (does not apply). A disabled policy is `N_A`, a `not_set`
policy `UNKNOWN`. With the static catalogue only residency, the service rules and
`encryption_at_rest` can be decided; every other policy is `UNKNOWN` ("static catalogue has
no tenant state"). A needed capability that an enabled `service_deny` forbids also makes
the LZ fit item `BLOCKED_BY_POLICY` with the evidence `baseline:<policy-id>`, for example
`baseline:CPB-SVC-03` for an app that needs PostgreSQL.

**Worst-of with ranked contributions.** When an app is measured against several catalogue
targets or live scopes, a control takes the worst outcome, in the order `GAP`, `UNKNOWN`,
`PARTIAL`, `SATISFIED`, `N_A`. The other targets or scopes stay visible: each decision lists
its contributions worst first, so the second and third worst can be reported. A
contribution is labelled with the target (`otc/eu-de`) or with the scope and its provider
(`scope crm (T Cloud Public)`). Contributions exist for residency and `encryption_at_rest`
on the catalogue and for every policy on the live source; the service rules decide on the
app's needs and have none. They are written to `baseline-decisions.json` in the app run
folder and to `11-comp.yaml`, and shown in the TUI results step. The compliance and
controls tables of the publication show them in the row detail as
`Ranked per target or scope: 1. ...; 2. ...`.

The portfolio comparison (below) decides governance policies (residency, service rules,
audit trail, log retention, MFA, credential age, budget alerts) on the landing zone's
platform scope, whereas the app takes the worst over every scope it uses. The two can
therefore differ; the platform scope's contribution is the portfolio's value.

### 6. Evidence references

Every finding of a live run carries a reference of the form
`ev:<run>:<check or block>:Ref-<10 hex>`. The reference holds no native id, so it can
appear in a shared publication. The native id, the region, the setting and a console link
stay in the run's local `evidence-refs.json`, which is never published or synced.

```bash
# List the references of the latest run (no native ids)
swao lz evidence --lz otc-prod

# Resolve one: native id, type, region, setting and the console link
swao lz evidence "ev:2026-11-06T08-00-00:CPB-NET-02:Ref-0123456789" --open
```

`--open` opens the console link in the default browser; the console login decides access.
Console links follow only the URL patterns the provider documents, so they open a service
page or the console root, and the printed native id finds the item. `--run <ts>` lists
another run; `--run-dir <dir>` resolves from a `swao lz scan --out` folder. The exit code
is 0 when resolved or listed, 1 when neither a reference nor a landing zone is named, and
2 for a malformed, unknown or foreign-run reference, a run without an evidence map or a
tier refusal. In the TUI the results step offers "Evidence references (resolve locally)":
Enter resolves, `o` opens the console link. The HTML Editor resolves a clicked reference in
its local preview.

`swao lz hierarchy otc-prod` prints the tenant tree of the latest run with pseudonymised
node names and the baseline `fail` and `unverified` counts per node (TUI: "Tenant
hierarchy").

### 7. Publish

```bash
# One landing zone: baseline summary, policies, manual evidence, requirement provenance
swao publish --lz-live otc-prod

# Several landing zones against one baseline (Enterprise)
swao assess --portfolio --type landing-zone-live
swao publish --portfolio --block-profile lz-live-baseline-comparison
```

The `lz-live` publication shows the baseline blocks only when the run selected a baseline.
The comparison writes `wsp/publications/latest-lz-live-baseline-comparison.html`; the
portfolio screen of the TUI offers it as "Client Policy Baseline Comparison (HTML)", and
the HTML Editor lists the profile too.

### 8. Read the comparison

The portfolio merge prints one line per landing zone, for example (illustrative values):

```
baseline CLIENT_LZ_POLICY_BASELINE 1.0.0 (sha256 3f2a9c0d1e4b): 17 policies compared across 3 landing zone(s)
  stackit-prod (STACKIT): READY_WITH_CHANGES; fit 9/17 READY, 5 with changes, 3 need verification, 0 blocked, rank 1
  otc-prod (T Cloud Public): BLOCKED; fit 8/17 READY, 5 with changes, 3 need verification, 1 blocked, rank 2
  aws-prod (AWS): SOVEREIGNTY_BLOCKED; different baseline (sha256 9b8e7d6c5a41), not ranked
  not met by any landing zone: CPB-PRT-01
```

- **Fit** is the number of enabled policies the landing zone meets as offered (`READY`)
  out of all enabled policies. `NEEDS_VERIFICATION` is counted separately, never as fit.
- **Rank** orders landing zones by fit, then by fewer blocked policies. A landing zone
  without any `READY` policy is not ranked.
- **Same baseline only.** A comparison is valid only when every landing zone was assessed
  with the same `policy-baseline.yaml` (same hash). A landing zone assessed with other
  settings is shown as "different baseline", keeps its cells and is not ranked. Run its
  live assessment again with the current baseline to compare it.
- **Not met by any landing zone** lists the policies that no comparable landing zone meets
  as offered.
- **Per landing zone**, a policy takes the platform scope's result for governance policies
  and the worst result over the scopes for everything else; a `fail` in any scope is a
  `fail` for the landing zone.
- **Requirement provenance.** All selected frameworks are merged as a union. A framework
  that accepts `EU` therefore lets regions in other EU countries pass residency even when
  the baseline says `DE` only. The requirement provenance block lists every merged value
  with the frameworks that contributed it, so you see which framework widened a rule.
- **Assumptions.** The baseline summary lists every policy whose default is an assumption,
  the policies not reviewed (`not_set`) with their shipped default, and the disabled ones.

---

## Health check

The health check (`swao health-check`) includes probe 26, **LZ connections**. It makes no
call to the provider: it shows the last read-only probe of every registered scope (the
probe of `swao lz probe`, of the Probe step of the Landing Zone Live setup, of
`swao lz connect` or of the last run) and the last run. For each scope it prints two lines: the probe outcome
in words (read-only verified; write-capable, accepted for this run; unverifiable; login
failed; not probed yet; credentials incomplete; token expired) and the facts (coverage,
time of the probe, the credential field names stored, and the services and resources the
last run read). A probe older than 7 days is marked stale; probe again to refresh it. It
reports:

- `ok` when every scope has a read-only verified probe that is not stale.
- A warning that names its causes, for example "1 scope with a write-capable login (a run
  asks for confirmation)", when a scope is write-capable, unverifiable, not probed, has
  missing credentials or an expired token, has no driver in the build, or its probe is
  stale.
- Information only, when no landing zone is registered.

The probe never fails the health check. See [Health check](/health-check).

---

## Simulated environments

SWAO can be run against a simulated cloud provider for development and testing. A run is
marked as simulated when its responses carry the simulation header or token claim, or
when an endpoint override was used. The endpoint override is the environment variable
`SWAO_LZ_MOCK_ENDPOINTS`; it accepts only https loopback addresses and is never read from
`.swao.yml`. A simulated run is:

- marked in the scan (`meta.simulated`) and in the run manifest;
- printed as `simulated environment (...)` in the CLI output;
- published with a **Simulated environment** banner stating that the data is
  development and test evidence only and never client evidence;
- refused as the source of a catalogue update;
- left out of the portfolio merge unless `--include-simulated` is passed.

### Simulated cloud provider models

The SWAO team maintains simulated models of T Cloud Public, STACKIT, AWS and Azure. Each
model answers the read-only API calls of the live drivers with the provider's wire
format and offers scenarios such as a full reader, a write-capable identity, missing
permissions, an expired token, throttling, a partial outage and a region gap. The Azure
model is derived from the published API specification only.

The models and their data are not distributed with SWAO. For a demo, training or test
setup with a simulated model, contact the SWAO team at swao-tool@accenture.com.

With a model provided by the SWAO team, the run uses the normal commands. The model comes
with an endpoints file, a local CA certificate and a test identity:

```bash
export SWAO_LZ_MOCK_ENDPOINTS=<endpoints file of the model>
export NODE_EXTRA_CA_CERTS=<CA certificate of the model>

swao lz connect <lz-id> ...        # with the test identity of the model
swao lz probe <lz-id>
swao assess --type landing-zone-live --lz <lz-id> --frameworks client-lz-policy-baseline
swao publish --lz-live <lz-id>      # carries the Simulated environment banner
swao assess --portfolio --type landing-zone-live --include-simulated
```

Unset both variables before a run against a real provider. A simulated run is never
evidence about a client estate.

---

## Automation (cron and CI)

The live assessment runs unattended when the credentials come from the vault or from
`SWAO_CREDENTIAL_*` variables:

```bash
swao assess --type landing-zone-live --lz otc-prod --frameworks bsi-c5
echo "exit $?"   # 0 complete, 1 partial, failed, refused or invalid input
```

- Short-lived credentials (for example AWS session keys) must be refreshed before each
  run. An expired token fails that scope, and the run then exits 1.
- The accept flags are meant for a person who has reviewed the probe result. They apply
  to one run and cannot be stored in `.swao.yml`. In a pipeline, add them to the command
  only on purpose.
- Always check the exit code. A scope stopped by the read-only gate is recorded as
  `refused` in `run-status.json`.

---

## Recording live runs (advanced)

To capture the provider's responses for analysis, set `SWAO_LZ_RECORD` to an absolute
folder outside every repository, workspace and `wsp` folder. SWAO refuses any other
location with exit code 2, because recordings can hold tenant data. A recording holds:

- `run.json`;
- one line per request in `requests.ndjson`;
- the response bodies in `bodies/`.

Request headers, request bodies, credentials and OAuth tokens are never recorded.

---

## Limitations

- Not every source is available for every provider yet (see the table at the top).
  Missing sources appear as `not_collected` in the scan.
- The read-only probe of some providers cannot verify a least-privilege login, which
  then needs `--accept-unverified-read-only`.
- The live assessment reads the configuration and inventory, not the data inside
  resources.
- The results describe the landing zone at the time of the run. Compare runs, or use the
  portfolio drift view, to follow changes.

---

## Further reading

- [Landing Zone Catalog Assessment](/assessment/landing-zone)
- [Client LZ Policy Baseline framework](/frameworks/client-lz-policy-baseline)
- [Assessment overview](/assessment/)
- [Health check](/health-check), [Tools](/tools) and [Portfolio](/portfolio)
- [Publish HTML](/publish-html)
