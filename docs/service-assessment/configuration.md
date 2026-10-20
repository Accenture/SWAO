# Configuration reference

Service Portfolio Assessment uses the same two configuration files as every SWAO assessment. There is no separate service configuration file.

| File | Scope | Written by |
|---|---|---|
| Workspace `.swao.yml` | Whole portfolio | You; `swao service init` adds the `service_portfolio:` block |
| `apps/<id>/.swao.yml` | One application | `swao service init` (scaffold); you may edit it |

## Workspace `.swao.yml`: the `service_portfolio:` block

```yaml
service_portfolio:
  source: wsp/inputs/service-intake/portfolio.xlsx      # intake workbook (relative path)
  mapping: wsp/inputs/service-intake/column-map.yaml    # column map, or null for header detection
  imported_at: "2026-10-10"
  app_count: 214
  row_count: 309
  sheets: [Inventory]
  headers:                           # header NAMES per sheet, never cell values
    Inventory: { A: VM, I: OS, K: Hersteller Support }
  pii_columns: [K, L, N]             # columns reduced to presence flags
  cluster_threshold: 3
  cost:                              # optional: reporting currency
    currency: EUR                    # default EUR
    exchange_rates:                  # units per 1 EUR, required for other currencies
      CHF: 0.94
  glossary:                          # optional: intake term -> English term
    Sonderbereich Nord: Special Unit North
    Radiologie: Diagnostic Imaging   # overrides the product default (Radiology)
```

| Key | Meaning |
|---|---|
| `source`, `mapping`, `imported_at`, `app_count`, `row_count`, `sheets`, `headers`, `pii_columns` | Intake metadata recorded by the scaffold. `swao health-check` probe 17 uses it. |
| `cluster_threshold` | Minimum identical rows that form a cluster (integer, at least 2). |
| `cost.currency` | Reporting currency for cost estimates. Default `EUR`; `USD` works out of the box (ECB reference rate). |
| `cost.exchange_rates` | Extra currencies as units per 1 EUR. A currency without a rate stops the scaffold with a clear error. Prices come from the VM price table, see [Cost prices](#cost-prices). |
| `glossary` | Optional. Maps intake department and function terms to English terms (source term -> English term). See [Intake terms in English](#intake-terms-in-english). |

`swao service init` rewrites only the intake metadata keys of this block. Keys you add, `cost` and `glossary`, are kept when you run the scaffold again.

The presence of the `service_portfolio:` block marks the workspace as a service workspace: health-check probes 19 to 25, the support bundle service artefacts, and the TIME, CVE, and EoL badges on the engagement hub depend on it.

Compliance frameworks work in two steps. **Discovery** is workspace-wide: every framework folder in `wsp/inputs/catalogs/community/<folder>/` (for example one copied from [GitHub](https://github.com/Accenture/SWAO/tree/main/community-frameworks)) is picked up automatically and offered in the framework selection of the terminal interface. **Selection** is per app: the chosen frameworks are stored in `apps/<id>/.swao.yml` as `assessment.regimes_active`, which the scaffold pre-fills with `[SWAO_APM]`, and the compliance pass ([Pass 11 COMP](/passes/11-comp)) evaluates exactly that list. You can also edit the list by hand or use `swao regime-select --app <id> --regimes SWAO_APM,DORA`:

```yaml
# apps/<id>/.swao.yml
assessment:
  type: service
  regimes_active: [SWAO_APM, DORA]
```

When `DORA` or `NIS2` is active on an app (or listed in the workspace `.swao.yml`), the Enterprise workbook fills its DORA ICT Register sheet. The sheet lists only apps with a third-party vendor, that is apps whose `.swao.yml` names one in `vendor.name`; application apps without a vendor are left out.

## Per-app `apps/<id>/.swao.yml`

The scaffold writes one file per application. All blocks are validated against the service app schema.

```yaml
wsp_version: "0.9"
app_id: hosapp200
app_name: Imaging Viewer
assessment:
  type: service
  regimes_active: [SWAO_APM]
vendor_type: on-premises            # on-premises | saas | hybrid | legacy
site: Main campus
infra_category: INFRA_MEDIZIN_PACS  # or UNKNOWN
os_class: INFRA_PLATFORM_OS_WINDOWS_SERVER
sovereign_rating: proprietary       # open-source | open-standard | proprietary
sovereign_alternatives:
  - { id: orthanc, name: Orthanc, sovereign_rating: open-source }
cluster: false
vendor:
  name: Example Imaging Vendor
  version: "7.2"
  support_active: true
  contract_expiry: "2028-06-30"
  support_contact_present: true     # booleans only: values are never stored
  support_phone_present: false
  support_email_present: true
platform: { os: Windows Server 2019, os_eol: null, auth_method: null, backup_enabled: true, sla_uptime: null }
hardware: { cpu_cores: 2, memory_mb: 8192, disk_count: 1, total_disk_gb: 100, est_cloud_cost_eur_mo: 77.8 }
business: { function: Image viewing, domain: Radiology, criticality: high, user_count: 120, annual_cost_eur: 18000 }
data: { health_data: true, pii: true, gdpr_art9: true, residency: DE, subprocessors: [], regulatory: [MDR] }
disposition:
  operational_status: active        # active | restricted | decommissioned | unused | inactive
  migration_candidate: false
  gartner_time: Tolerate            # the analyst's own TIME judgement from the intake
integrations: [hosapp900]           # app IDs this app depends on
cost:
  currency: EUR
  monthly_estimate: 77.8
generated_fields: [app_name, vendor, platform, hardware, ...]
generated_at: "2026-10-10T08:00:00.000Z"
intake: { sheet: Inventory, row: 12, fields: [business_domain, business_function, cpu_cores, id_name_combined, integrations_raw, memory_mb, os, vendor_name, ...] }
```

### Blocks

| Block | What it holds |
|---|---|
| `assessment` | `type: service` and the active frameworks (`regimes_active`, default `[SWAO_APM]`) |
| `vendor_type`, `site`, `infra_category`, `os_class`, `sovereign_rating`, `sovereign_alternatives` | Classification from [INFRA-CAT](/service-assessment/infra-cat) |
| `cluster`, `cluster_id`, `cluster_member_count`, `cluster_members` | Cluster consolidation (cluster apps only) |
| `vendor` | Vendor, version, support, contract; contact, phone, and e-mail as booleans only |
| `platform` | Operating system, OS support status, authentication, backup, SLA |
| `hardware` | CPU, memory, disks, and the euro cloud estimate |
| `network` | IP and network zone (optional) |
| `business` | Function, department, criticality, users, annual cost, licence type |
| `data` | Health data, personal data, GDPR Art. 9, HIPAA PHI, classification, residency, sub-processors, regulatory obligations, MDR class |
| `disposition` | Operational status, migration candidate flag, analyst TIME, migration project, sovereign cloud programme flag |
| `integrations`, `integrations_notes` | Dependencies (app IDs) and any free-text integration notes, kept in the client's wording |
| `security` | Date of the last security audit |
| `cost` | Lift-and-shift estimate in the reporting currency (Azure and AWS SKU, monthly estimate, exchange rate source) |
| `intake` | Sheet and row the app came from; `fields`: the intake fields the column layout mapped (used by SWAO_APM to tell an empty value from a missing column); `source_text_fields`: free-text fields carried verbatim in the client's wording (today `integrations_notes`) |
| `generated_fields`, `generated_at` | Keys owned by the scaffold |

### Cost prices

The lift-and-shift estimate prices each server with on-demand (pay-as-you-go) list prices per hour from the providers' public price APIs: the Azure Retail Prices API (region `germanywestcentral`) and the AWS Price List API (region `eu-central-1`). Each size has a Linux price and a Windows price with the Windows Server licence included; a Windows server (INFRA-CAT `os_class` or the intake OS text) is sized and priced with the Windows price.

The prices come from the VM price table `prices/vm-prices.json`. `swao lz catalogue update` (CLI, or Update LZ catalogue in the terminal interface) refreshes it in the same run as the LZ catalogues and writes `wsp/inputs/catalogs/lz-catalogues/prices/vm-prices.json`; the scaffold uses that workspace copy in preference to the table bundled with SWAO. The table records the API, URL, region, currency and retrieval date of each source, and the `cost.basis` text names them.

| Key in `cost` | Meaning |
|---|---|
| `price_os` | `windows` when both providers were priced with a Windows price, otherwise `linux` |
| `azure.price_os`, `aws.price_os` | OS of the price used for that provider |
| `windows_priced_as_linux` | Set only when a Windows server's size has no Windows price in the table, so the Linux price stands in (the licence is then not included) |
| `provider_parity_assumed` | Set only when one provider has no price for its size; that provider's estimate takes the other provider's price (`price_from_provider` names it) |
| `skipped_reason: prices_unavailable` | No price for either provider (for example no price table); there is no estimate |

Equal Azure and AWS estimates are not an assumption: the list prices of Azure D/E v3 and AWS m5/r5 are equal in the two regions (retrieved 2026-10-17).

### Intake terms in English

Intake workbooks are often German or mixed. `swao service init` writes English canonical values into `apps/<id>/.swao.yml` and keeps the client's wording next to them, so nothing is lost:

```yaml
business:
  domain: Radiology
  domain_source: Radiologie          # original intake value
  function: Diagnostic Reporting
  function_source: Befundung
  criticality: high
  criticality_source: Hoch
data:
  classification: Confidential
  classification_source: Vertraulich
disposition:
  gartner_time: Invest
  gartner_time_source: Investieren
```

| Field | English values from | `*_source` field |
|---|---|---|
| `business.domain`, `business.domains` | Product glossary, then `service_portfolio.glossary` | `domain_source`, `domains_source` (list) |
| `business.function` | Product glossary, then `service_portfolio.glossary` | `function_source` |
| `business.criticality` | Fixed scale: `critical`, `high`, `medium`, `low` (for example `Hoch` -> `high`) | `criticality_source` |
| `data.classification` | Fixed labels: `Public`, `Internal`, `Confidential`, `Strictly Confidential`, `Secret` | `classification_source` |
| `disposition.gartner_time` | Fixed labels: `Tolerate`, `Invest`, `Migrate`, `Eliminate` | `gartner_time_source` |

Rules:

- A `*_source` field is written only when the intake wording differs from the English value. An English intake gets no `*_source` fields.
- Matching ignores case and extra spaces. Yes and no columns accept `Ja`, `Nein`, `wahr`, `falsch`; `N/A`, `n.a.`, `k.A.` and `keine Angabe` mean "not specified".
- `service_portfolio.glossary` in the workspace `.swao.yml` extends the product glossary of department and function terms (for example `Radiologie` -> `Radiology`, `Labor` -> `Laboratory`, `Verwaltung` -> `Administration`). Your entry wins over a product entry with the same source term. The glossary does not change the fixed criticality, classification and TIME scales.
- A value with no English term is kept verbatim. `swao service init` prints one warning per field that lists the unmapped values; add them to `service_portfolio.glossary` and run `swao service init --refresh`.
- Free-text notes (`integrations_notes`) are never translated; `intake.source_text_fields` labels them as the client's text.
- The HTML publication, the Enterprise workbook and the star schema (`dim_service_app`) show the English values; the workbook Source Data sheet also has the `*_source` columns. `--lang de` translates SWAO's own labels, not client data.

### Editing safely

`swao service init --refresh` rewrites only the top-level keys listed in `generated_fields`. The scaffold lists `app_id`, `app_name`, `assessment`, `vendor_type`, `site`, `infra_category`, `os_class`, `sovereign_rating`, `sovereign_alternatives`, `cluster`, `cluster_id`, `cluster_member_count`, `cluster_members`, `vendor`, `platform`, `hardware`, `network`, `business`, `data`, `disposition`, `integrations`, `integrations_notes`, `security`, `intake`, and `cost`. Everything else in `apps/<id>/.swao.yml` is kept, for example a `binary:` or `crawl:` block that you added. Of the `assessment` block the refresh sets only `type: service`; `regimes_active` and any other keys you added stay as they are.

A listed key is replaced as a whole block. If you fill in a value inside a listed block, for example `vendor.name` because the intake has no vendor column, remove that key (here `vendor`) from `generated_fields`; otherwise the next refresh overwrites it with the intake value. Results (TIME, scores, CVEs) are never written into this file; they live in `wsp/portfolio-summary.json` and the run folders.

Operational status matters: `decommissioned`, `unused`, and `inactive` apps are classified Eliminate; `restricted` (keep, do not start) is deliberately not.

## SWAO_APM framework configuration

The scoring framework is the community framework `SWAO_APM`. To adjust it for one engagement, copy the bundled framework folder (both `framework-meta.yaml` and `controls.yaml`) to `wsp/inputs/catalogs/community/swao-apm/` in the workspace; SWAO then reads both files from the workspace copy.

| Key in `framework-meta.yaml` | Meaning |
|---|---|
| `framework.domain_weights` | Weight per domain for the risk score; integers that must sum to exactly 100 (health-check probe 18) |
| `framework.time_rules` | Thresholds of the TIME classification (operational statuses, CVE, end of life, domain thresholds) |
| `framework.status`, `framework.version` | Framework metadata |

Details and the default values: [SWAO_APM framework reference](/service-assessment/framework).
