# Landing Zone Catalog Assessment

![Landing Zone Catalog Assessment banner: the SWAO engine evaluates five provider catalogue cards and lists a pass, partial or fail verdict for each](/visuals/banner-landing-zone.svg)

The Landing Zone Catalog Assessment answers one question: **can this cloud provider
region host this application under the sovereignty requirements of my active
frameworks?** SWAO takes the platform services your application needs, looks them up
in the provider's service catalogue for the chosen region, checks the region's
sovereignty facts (operator jurisdiction, extraterritorial exposure, residency,
certifications) against the requirements declared by your frameworks, and returns a
per-service fit/gap verdict plus an overall verdict per target.

The assessment is fully deterministic. It makes no LLM calls and needs no cloud
credentials. It is available in all licence tiers.

---

## What you can do with it

- **Shortlist target platforms.** Compare several providers and regions side by side
  (for example a German sovereign cloud, a hyperscaler sovereign offering and a standard
  hyperscaler region) in one run.
- **Explain sovereignty blockers.** See exactly which requirement a region fails, for
  example "operator subject to the US CLOUD Act" or "certification not held", and
  whether the blocker is structural or a certification gap.
- **Find missing services.** See which required capabilities are not offered in a
  region, or offered only in a different version or capability profile.
- **Check a deployed landing zone.** For AWS, AWS European Sovereign Cloud and Azure you
  can supply a snapshot of the deployed landing zone and see which services are
  available but not yet enabled.
- **Feed the migration decision.** The results appear in the HTML publication and
  inform the 7R synthesis of the Application Assessment.

---

## What you need to provide

| Input | Required | Notes |
|---|---|---|
| One or more targets (`provider:region`) | Yes | From the bundled catalogues below or from a workspace copy (see [Adapting and extending catalogues](#adapting-and-extending-catalogues)). Run `swao lz catalogue list` and `swao lz catalogue show <provider>` to see valid IDs |
| A completed Application Assessment for the app | Strongly recommended | The required services are read from the app's latest run (signals of the form `service_dep:<capability>`). Without them SWAO warns and reports catalogue and sovereignty availability only |
| Active frameworks | Recommended | `--lz-frameworks`, or `assessment.frameworks` / `assessment.regimes_active` in the app's `.swao.yml`. Sovereignty gates apply only for frameworks that declare `sovereignty_requirements` |
| Deployed landing zone snapshot | Optional | `apps/<id>/wsp/inputs/terraform/lz-<provider>-snapshot.json`. Snapshot readers exist for `aws`, `aws-esc` and `azure` |

### Which frameworks drive the sovereignty gate

Among the bundled community frameworks, three currently declare sovereignty
requirements for the landing zone fit:

| Framework | Requirement applied to the region |
|---|---|
| [BSI C5](/frameworks/bsi-c5) | No exposure to `us_cloud_act` or `fisa_702`; operator must be an `EU-entity`; certification `BSI_C5` held |
| [GDPR](/frameworks/gdpr) | Operator must be an `EU-entity`; key management (`key_vault`) is always added to the required services |
| [HIPAA / NIST SP 800-66r2](/frameworks/nist-sp-800-66r2-hipaa) | Certification `HIPAA` held |

When several frameworks are active, SWAO combines their requirements. If no active
framework declares requirements, the report states that no sovereignty gates were
exercised (`sovereignty_active: false`), so a READY verdict is not mistaken for a
sovereignty clearance.

---

## Shipped landing zone catalogues

SWAO ships ten provider catalogues (one `<provider>.json` per provider in `lz-catalogues/`,
generated 2026-09-04). There is no index file: the list is built from each file's own
`meta` block (name, date, source, confidence, region count), so a catalogue file added to
the folder is listed without further registration. `ionos` and `ovhcloud` are listed as
coming soon in `lz-catalogues/_coming-soon.json`, the only place that list lives.
Sovereignty is stored as facts only;
verdicts always come from your active frameworks.

| Provider ID | Platform | Regions | Distinct services | Operator jurisdiction | Extraterritorial exposure | Catalogue date | Source, confidence |
|---|---|---|---|---|---|---|---|
| `stackit` | STACKIT | 2: `eu01` (Germany), `eu02` (Austria) | 46 (eu01: 46, eu02: 29) | EU entity | none recorded | 2026-09-04 | STACKIT PIM API, medium |
| `otc` | Open Telekom Cloud / T Cloud Public | 2: `eu-de` (Germany), `eu-nl` (Netherlands) | 56 (eu-de: 56, eu-nl: 34) | EU entity | none recorded | 2026-08-11 | curated, medium |
| `delos` | Delos Cloud (Germany-only) | 1: `de` | 43 | EU entity | none recorded | 2026-08-11 | curated, low |
| `aws-esc` | AWS European Sovereign Cloud | 1: `eusc-de-east-1` (Germany) | 113 | EU entity | none recorded | 2026-09-04 | botocore endpoints, high |
| `aws-iso-e` | AWS ISOE Europe (classified) | 1: `eu-isoe-west-1` | 83 | US entity (conservative, unverified) | CLOUD Act, FISA 702 | 2026-09-04 | botocore endpoints, low (sovereignty facts unsubstantiated) |
| `azure-local` | Azure Local (on-premises HCI) | 2: `connected` (Arc-connected customer site), `disconnected` | 17 (connected: 16, disconnected: 6) | operator site | `connected`: US CLOUD Act, FISA 702; `disconnected`: none | 2026-08-11 | curated, medium |
| `oci` | Oracle Cloud Infrastructure | 6: `eu-frankfurt-1`, `eu-amsterdam-1`, `eu-frankfurt-2` and `eu-madrid-2` (EU Sovereign Cloud), `me-dubai-1`, `me-jeddah-1` | 54 | US entity; EU entity for the two EU Sovereign Cloud regions | US CLOUD Act and FISA 702; EU Sovereign Cloud regions: US CLOUD Act | 2026-09-20 | curated, medium |
| `aws` | Amazon Web Services | 34 (for example `eu-central-1` Frankfurt, `eu-west-1` Ireland, `eu-north-1` Stockholm) | 288 | US entity | US CLOUD Act, FISA 702 | 2026-09-04 | botocore endpoints, high |
| `azure` | Microsoft Azure | 87 (for example `germanywestcentral`, `westeurope`, `francecentral`) | 143 | US entity | US CLOUD Act, FISA 702 | 2026-09-04 | Azure Retail Prices API, high |
| `gcp` | Google Cloud Platform | 42 (for example `europe-west3` Frankfurt, `europe-west10` Berlin, `europe-west4` Netherlands) | 110 | US entity | US CLOUD Act, FISA 702 | 2026-09-04 | region-picker products list, medium |

Certifications recorded per region (examples):

| Provider | Region | Certifications in the catalogue |
|---|---|---|
| `stackit` | `eu01` / `eu02` | `BSI_C5`, `ISO_27001` / `ISO_27001` |
| `otc` | `eu-de`, `eu-nl` | `BSI_C5`, `ISO_27001`, `SOC_2` |
| `oci` | `eu-frankfurt-1`, `eu-frankfurt-2` | `BSI_C5`, `ISO_27001`, `SOC_2` |
| `aws-esc` | `eusc-de-east-1` | `BSI_C5`, `ISO_27001` |
| `aws` | `eu-central-1` | `BSI_C5`, `ISO_27001`, `SOC_2`, `PCI_DSS` |
| `azure` | `germanywestcentral` | `BSI_C5`, `ISO_27001`, `SOC_2` |
| `gcp` | `europe-west3` | `BSI_C5`, `ISO_27001`, `SOC_2`, `PCI_DSS` |
| `delos`, `azure-local` | all | none recorded |

Certification names are compared without regard to case or separators, and `C5` and
`BSI_C5` count as the same BSI C5 attestation. A workspace catalogue that records `C5`
therefore satisfies a framework that requires `BSI_C5`.

Each service entry records its code and name, status, the abstract capabilities it
fulfils (for example `kubernetes`, `block_storage`, `ml_inference`), supported key
custody models (`provider-managed`, `byok`, ...) and the date it was last verified.

`swao health-check` reports how many catalogues it found and whether each comes from
the bundle or from your workspace.

### Readiness checks for `--lzr`

The landing zone readiness pass ([Pass 23, LZR](/passes/23-lzr)) uses a separate
checks catalogue, `controls/landing-zone-checks-catalogue.yaml` (version 2026-04). It
contains 10 checks: 5 specific to the STACKIT sovereign profile and 5 that apply to all
providers. 5 are blockers and 5 are warnings, across the categories service (4),
network (2), quota (2), compliance (1) and policy (1).

### Provider capability catalogue

`controls/cloud-provider-catalogue.yaml` (version 2026-04, last updated 2026-04-28)
describes 16 cloud and hosting providers at company level (type, certification status,
compliance regime coverage, cost tier, sovereign score, vendor lock-in). It is used by
the synthesis pass of the Application Assessment for landing zone matching, not by the
catalogue fit described on this page. `controls/sovereign-service-catalogue.yaml` (31
SaaS and PaaS services, 9 rated available, 17 partial and 5 unavailable in an EU
sovereign form) supports the sovereign-service availability check on the application's
outbound dependencies.

---

## Choosing targets

SWAO resolves the targets in this order; the first source that yields a target wins:

1. `--lz-cat-targets "provider:region,provider:region"`
2. `--lz-provider` together with `--lz-region` (for the inline fit: `--lz-cat-provider`
   and `--lz-cat-region`); a missing half is taken from `.swao.yml`
3. `assessment.landing_zone.targets` in the app `.swao.yml` (written by the TUI when you
   confirm targets)
4. `assessment.lz_cat_targets` in the app `.swao.yml` (deprecated comma-separated form,
   still read)
5. `assessment.landing_zone.provider` and `assessment.landing_zone.region` in the app
   `.swao.yml`
6. the same three keys in the workspace `.swao.yml`, so one list can serve every app

The command line always wins over the configuration, and an app `.swao.yml` wins over
the workspace `.swao.yml`. No extra configuration file is involved.

The frameworks are resolved from `--lz-frameworks`, then `assessment.frameworks`, then
`assessment.regimes_active`.

```yaml
# apps/app-crm-01/.swao.yml
assessment:
  regimes_active: [GDPR, BSI_C5]
  landing_zone:
    targets:
      - stackit:eu01
      - aws-esc:eusc-de-east-1
      - azure:germanywestcentral
```

Each entry has the form `<provider>:<region>`. `.swao.yml` validation rejects an entry
without a colon:
`[error] .swao.yml validation failed: ... must have the form <provider>:<region>`.
The single `provider` + `region` pair stays supported; `provider`
on its own only names the provider for Pass 23 (LZR).

### Geographies

A target may name a geography instead of a region id, for example `azure:Europe`. SWAO
uses one geography model for every catalogue (bundled and workspace):

| Geography | Accepted spellings | Residency countries |
|---|---|---|
| `germany` | Germany, DE, Deutschland | DE |
| `eu` | EU, European Union | the 27 EU member states, plus `EU` (EU-wide residency) |
| `europe` | Europe | the `eu` countries plus IS, LI, NO, CH, GB |
| `north-america` | North America | US, CA, MX |
| `south-america` | South America, LATAM, Latin America | BR, CL, AR, CO, PE, UY |
| `asia-pacific` | Asia Pacific, APAC | AU, NZ, JP, KR, CN, HK, TW, SG, MY, ID, IN, TH, PH, VN |
| `middle-east` | Middle East | AE, BH, IL, QA, SA, KW, OM, JO |
| `africa` | Africa | ZA, EG, KE, NG, MA |

The rules are the same for every provider:

- A region belongs to a geography when its `sovereignty.residency_country` (or, if that
  is missing, its `country`) is in the list above. Regions with an `UNKNOWN` residency
  country, and the operator-site regions of `azure-local` (`OPERATOR_SITE`: the customer
  chooses the site), belong to no geography.
- A region id always wins: `delos:de` is the Delos region `de`, not the geography.
- Default region: among the provider's regions in the geography, SWAO prefers residency
  country DE (SWAO's German sovereign context), then the region with the most catalogue
  services, then the lowest region id. With the bundled catalogues, `Europe` resolves to
  `aws:eu-central-1`, `aws-esc:eusc-de-east-1`, `aws-iso-e:eu-isoe-west-1`,
  `azure:germanywestcentral`, `gcp:europe-west3`, `stackit:eu01`, `delos:de`,
  `otc:eu-de` and `oci:eu-frankfurt-1`.
- The resolution is printed as `[info] LZ target azure:Europe names a geography; using the
  default region azure:germanywestcentral` and logged as `lz.assessment.target.resolved`.
  The run records it in `run-status.json` (`resolved_targets`), and the reports list it.
  Set the region id explicitly to make the choice yourself.
- A value that is neither a region id nor a geography with a matching region (for example
  `azure:Atlantis`, or `azure-local:Europe`) is skipped with a hint of valid region ids;
  see [Partial runs](#partial-runs).

`swao health-check` checks configured targets the same way: a geography is reported as
info naming the resolved region (`target-geography`), an unknown value as a warning with
the hint (`target-invalid`). The `geography-coverage` catalogue rule fails when a
catalogue uses a residency country outside the model.

---

## Step by step (CLI)

1. **Run the Application Assessment first** so that the required services are known:

   ```bash
   swao assess --app app-crm-01
   ```

2. **Look up the target IDs:**

   ```bash
   swao lz catalogue list
   swao lz catalogue show stackit
   ```

3. **Run the catalogue assessment** against one or more targets:

   ```bash
   # Single target
   swao assess --type landing-zone-catalog --app app-crm-01 \
     --lz-provider stackit --lz-region eu01

   # Several targets in one run
   swao assess --type landing-zone-catalog --app app-crm-01 \
     --lz-cat-targets "stackit:eu01,otc:eu-de,aws-esc:eusc-de-east-1,azure:germanywestcentral"

   # Explicit frameworks for the sovereignty gate
   swao assess --type landing-zone-catalog --app app-crm-01 \
     --lz-cat-targets "stackit:eu01,aws:eu-central-1" --lz-frameworks "GDPR,BSI_C5"
   ```

4. **Publish the result** as an HTML report (available in all tiers):

   ```bash
   swao publish --app app-crm-01 --lz
   ```

### Inline during an Application Assessment

Add the target flags to a normal assessment and the fit runs at the end of the same
run, using that run's signals:

```bash
swao assess --app app-crm-01 --lz-cat-provider stackit --lz-cat-region eu01
swao assess --app app-crm-01 --lz-cat-targets "stackit:eu01,aws-esc:eusc-de-east-1"
```

The inline fit also runs automatically when targets are configured in `.swao.yml`
(`assessment.landing_zone.targets`, or `provider` and `region`), in the app or the
workspace file, resolved as described in [Choosing targets](#choosing-targets).

---

## Step by step (TUI)

1. Run `swao`, choose **3 Run Assessment**, then **[3] Landing Zone Catalog Assessment**.
2. Select the application.
3. Choose the **Cloud Service Provider**.
4. **Filter regions** if the provider has many, then select one or more
   **Target Regions**.
5. Confirm. SWAO writes the chosen targets to `assessment.landing_zone.targets` in the
   app `.swao.yml` (the key the CLI reads) and runs the fit; the completion screen shows
   the verdict per target. When targets are already configured (app or workspace
   `.swao.yml`), the provider and region pickers start with them selected.

The Application Assessment screen offers the same provider and region picker as an
optional **Target Landing Zone** step for the inline fit.

---

## What you get

A standalone run writes a normal run folder for the app:

```
apps/<id>/wsp/
+-- latest-landing-zone-catalog.txt         pointer to the most recent LZ run
+-- runs/<timestamp>/
    +-- passes/lz-fit.yaml                  single target
    +-- passes/lz-fit-<provider>-<region>.yaml          one per target (several targets)
    +-- lz-catalogue-fit.yaml               fit report (single target)
    +-- lz-catalogue-fit-<provider>-<region>.yaml       one per target (several targets)
    +-- lz-narratives.json                  plain-language summary per target
    +-- run-manifest.json                   includes catalogue origin and SHA-256 per provider
    +-- run-context.yaml
    +-- run-status.json                     started, complete, partial, failed or aborted
```

### Partial runs

A target that cannot be assessed (an unknown region, or a fit that fails) does not stop
the run. SWAO prints a `[warning]` with up to ten valid region ids, logs
`lz.assessment.provider.error`, and continues with the remaining targets. `run-status.json`
in the run folder records the outcome:

| Status | Meaning |
|---|---|
| `started` | The run is in progress, or it stopped without closing (for example a killed process) |
| `complete` | Every target was assessed |
| `partial` | At least one target was assessed and at least one was skipped; `failed_targets` lists each skipped target with the reason |
| `failed` | Every target failed (exit code 1); no `run-manifest.json` and no `latest-*` pointer are written |
| `aborted` | The run was interrupted (SIGINT or SIGTERM) |

The LZ text report (`swao report --app <id> --type landing-zone-catalog`), the HTML publication and the
engagement hub show the skipped targets of a `partial` run with the reason, so a result
is never mistaken for a full comparison.

### Verdicts per service

| Verdict | Meaning |
|---|---|
| `SUPPORTED` | The region offers the capability (in catalogue-only mode, availability counts as a match) |
| `AVAILABLE_NOT_ENABLED` | Offered in the region, but not enabled in the deployed landing zone snapshot |
| `MISCONFIGURED` | Enabled, but the snapshot shows a configuration problem |
| `NOT_AVAILABLE_IN_REGION` | Not offered in this region |
| `VERSION_MISMATCH` | Offered, but not in the required version |
| `CAPABILITY_MISSING` | Offered, but without a required capability |
| `SOVEREIGNTY_GAP` | The region fails a sovereignty requirement of the active frameworks |

Each non-supported item also becomes an `LZ-NN` signal. Severity: `SOVEREIGNTY_GAP`
is critical; `NOT_AVAILABLE_IN_REGION` and `MISCONFIGURED` are high;
`AVAILABLE_NOT_ENABLED` is medium.

### Overall verdict per target

| Overall verdict | When |
|---|---|
| `SOVEREIGNTY_BLOCKED` <span class="swao-badge fail">FAIL</span> | Any sovereignty failure. `blocker_category` says whether it is structural (jurisdiction, exposure), a certification gap, or mixed |
| `BLOCKED` <span class="swao-badge fail">FAIL</span> | A required service is not available, or is available only in the wrong version or without a required capability, and the requirement has evidence beyond documentation (build files, compose, Kubernetes, configuration or an earlier signal) |
| `READY_WITH_CHANGES` <span class="swao-badge partial">PARTIAL</span> | Everything is available, but services must be enabled or fixed in the deployed landing zone |
| `NEEDS_VERIFICATION` <span class="swao-badge partial">PARTIAL</span> | Would be READY, but no required services were found or a baseline category (compute, network, key management, storage) was not covered; or the only missing services are requirements evidenced by documentation alone (low confidence), which need confirming before they count as blockers |
| `READY` <span class="swao-badge pass">PASS</span> | All required services are supported and all sovereignty gates pass |

When at least one target in a multi-target run is READY, the remediation text of every
sovereignty-blocked target names it as a sovereign-compliant alternative.

---

## Landing zone readiness from Terraform (`--lzr`)

`--lzr <landingZoneId>` is a different check. Instead of a provider catalogue, it reads
the Terraform state or plan files of an existing landing zone from
`apps/<id>/wsp/inputs/terraform/` and evaluates the readiness checks catalogue against
them. The result is written to `passes/23-lzr.yaml` with an overall verdict of `ready`
or `blocked`, and it feeds the 7R adjustment in the synthesis pass.

```bash
swao assess --app app-crm-01 --lzr lz-prod
swao assess --app app-crm-01 --lzr lz-prod --lzr-fail-on-blocked   # exit 4 when blocked
```

With `--portfolio --lzr <id>` (Enterprise) SWAO runs the readiness check for every app
in the workspace and writes `wsp/runs/<timestamp>/lzr-summary.json` at workspace level.
In portfolio mode each app's `wsp/inputs/terraform/` folder is searched for
`lz-meshstack-snapshot.json`, `lz-aws-snapshot.json`, `lz-azure-snapshot.json` or
Terraform files, in that order of priority, so a meshStack platform export can serve as
the input.

---

## Adapting and extending catalogues

The bundled catalogues are point-in-time seeds. You can refresh them, copy them into
the workspace and edit them, or create a catalogue for a private cloud:

```bash
# Refresh from the providers' public sources (Consultant and above; no credentials)
swao lz catalogue update --provider all          # aws, aws-esc, aws-iso-e, stackit, gcp, azure

# Copy a bundled catalogue into the workspace for editing
swao lz catalogue copy stackit
# -> wsp/inputs/catalogs/lz-catalogues/stackit/index.json

# Start an empty catalogue for a private or regional cloud
swao lz catalogue new my-private-cloud

# Show where each catalogue comes from (workspace or bundled)
swao lz catalogue list --origin
swao lz catalogue show stackit                   # prints "origin workspace: <file>" or "origin bundled: <file>"
```

`swao lz catalogue copy <provider>` and `swao lz catalogue new <provider>` both write
`wsp/inputs/catalogs/lz-catalogues/<provider>/index.json` in the workspace. Once that
file exists, the catalogue fit (standalone and inline) uses it instead of the bundled
catalogue for that provider; other providers keep using the bundled catalogue. The run
manifest records which one was used. If a workspace copy is not valid JSON or fails
the catalogue schema, the fit stops with an error rather than falling back to the
bundled catalogue. A catalogue created with `new` contains only a placeholder region
(`example-region`) without services or sovereignty facts, so add real regions before
you use it as a target.

The catalogue files and the template `_lz-catalogue-template.json` are published in the
public repository, where you can copy them from:
[github.com/Accenture/SWAO/tree/main/lz-catalogues](https://github.com/Accenture/SWAO/tree/main/lz-catalogues).
The community frameworks that drive the sovereignty gate are at
[github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks).

See [Adapting LZ catalogues](/runbooks/adapting-lz-catalogues) for the full workflow:
adding regions, correcting facts and creating private-cloud entries.

---

## Limitations

- Catalogue facts are point-in-time. Check the catalogue date and the `confidence`
  value, and refresh before an engagement. `delos` is marked low confidence.
- Catalogue-only mode (no deployed landing zone snapshot) can show availability, not
  whether a service is provisioned. Snapshot readers exist only for `aws`, `aws-esc`
  and `azure`.
- Certifications are matched by name (apart from case, separators and the `C5` /
  `BSI_C5` equivalence). A certification recorded under a different name in a
  workspace catalogue is not recognised, so review a certification-only blocker
  against the catalogue entry before reporting it.
- `--lzr` currently evaluates the checks for the STACKIT sovereign profile only.
- The fit is only as complete as the required services detected by the Application
  Assessment. Watch for `NEEDS_VERIFICATION` and coverage warnings.
- Sovereignty facts are not legal advice. Review the provider's contracts and data
  processing terms.

---

## Live example report

A Landing Zone Catalog Assessment publication for the Sovereign Health demo workspace:

[Open live report](https://htmlpreview.github.io/?https://github.com/Accenture/SWAO/blob/main/examples/publications/2026-08-24T11-36-12-sovereign-health-lz.html)

It shows the fit/gap analysis across EU sovereign and hyperscaler providers, with a
verdict per provider.

---

## Further reading

- [Assessment overview](/assessment/)
- [Application Assessment](/assessment/application), which detects the required services
- [Pass 23, landing zone readiness](/passes/23-lzr)
- [Adapting LZ catalogues](/runbooks/adapting-lz-catalogues) and the [CLI reference](/runbooks/cli-reference)
