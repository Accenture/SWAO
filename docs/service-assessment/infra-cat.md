# INFRA-CAT reference

SWAO-INFRA-CAT is the infrastructure and application category catalogue that Service Portfolio Assessment uses to classify every intake row. A category tells SWAO what kind of system an application is (for example a PACS, a domain controller, or a VDI farm), which vendors and product names indicate it, how to look up its end of life and vulnerabilities, and which sovereign or open-source alternatives exist.

Classification feeds the SWAO_APM scoring (sovereignty and migration domains), vendor consolidation, the effort model of the [migration wave generator](/service-assessment/migration-waves), and the per-app HTML page.

## Tier 1: built-in categories

The built-in catalogue ships with SWAO in `controls/infra-catalogue/` (5 files, 25 categories). `swao service init` loads it automatically.

Each built-in file declares its own `id`, `name` and `load_order` at the top; there is no registry file. SWAO loads every `*.yaml` in the directory in ascending `load_order` (platform 10, infrastructure 20, workplace 30, security 40, healthcare 50); a later file wins when two files define the same category ID. A file with missing or invalid metadata is skipped with a warning. Tier 2 files below need none of this metadata.

| Group | Category ID | Name | Sovereign alternatives named |
|---|---|---|---|
| Infrastructure | `INFRA_INFRASTRUCTURE_DIRECTORY` | Directory Service / Domain Controller | Samba Active Directory, FreeIPA |
| Infrastructure | `INFRA_INFRASTRUCTURE_DHCP_DNS` | DHCP / DNS | ISC Kea |
| Infrastructure | `INFRA_INFRASTRUCTURE_FILE` | File Server / NAS | Nextcloud, Samba |
| Infrastructure | `INFRA_INFRASTRUCTURE_BACKUP` | Backup and Recovery | Bareos |
| Infrastructure | `INFRA_INFRASTRUCTURE_MAIL` | Mail Server | Open-Xchange |
| Infrastructure | `INFRA_INFRASTRUCTURE_PKI` | Certificate Authority / PKI | EJBCA Community |
| Healthcare | `INFRA_MEDIZIN_KIS` | Clinical Information System (KIS / EPR) | GNU Health, openEHR-based systems |
| Healthcare | `INFRA_MEDIZIN_PACS` | Picture Archiving and Communication System | Orthanc |
| Healthcare | `INFRA_MEDIZIN_LIS` | Laboratory Information System | SENAITE LIMS |
| Healthcare | `INFRA_MEDIZIN_PDMS` | Patient Data Management System (ICU) | none catalogued |
| Healthcare | `INFRA_MEDIZIN_DOSE` | Radiation Dose Management | none catalogued |
| Healthcare | `INFRA_MEDIZIN_TELEMATIK` | Telematics Infrastructure (TI) | none catalogued |
| Platform | `INFRA_PLATFORM_OS_WINDOWS_SERVER` | Windows Server | Debian GNU/Linux, Ubuntu Server (LTS), openSUSE Leap |
| Platform | `INFRA_PLATFORM_OS_LINUX_DEBIAN` | Debian GNU/Linux | none catalogued (open source) |
| Platform | `INFRA_PLATFORM_OS_LINUX_UBUNTU` | Ubuntu Linux | none catalogued (open source) |
| Platform | `INFRA_PLATFORM_OS_LINUX_SUSE` | SUSE Linux Enterprise Server | none catalogued |
| Platform | `INFRA_PLATFORM_OS_LINUX_RHEL` | Red Hat Enterprise Linux family | none catalogued |
| Platform | `INFRA_PLATFORM_OS_SOLARIS` | Oracle Solaris | none catalogued |
| Platform | `INFRA_PLATFORM_DATABASE` | Standalone Database Server | PostgreSQL, MariaDB |
| Security | `INFRA_SECURITY_ENDPOINT` | Endpoint Protection / EDR | none catalogued |
| Security | `INFRA_SECURITY_NAC` | Network Access Control | PacketFence |
| Security | `INFRA_SECURITY_SIEM` | SIEM / Log Management | Wazuh |
| Workplace | `INFRA_WORKPLACE_VDI` | VDI / Virtual Desktop Infrastructure (cluster-capable) | OpenStack + Apache Guacamole |
| Workplace | `INFRA_WORKPLACE_PRINT` | Print Services | CUPS |
| Workplace | `INFRA_WORKPLACE_THIN_CLIENT` | Thin Client Management | none catalogued |

Rows that match nothing are classified `UNKNOWN` and raise a `SCAFFOLD.CATEGORY_UNKNOWN` signal. The scaffold summary lists them; set `infra_category` in `apps/<id>/.swao.yml` by hand or add a Tier 2 category.

## How a row is classified

SWAO tries three strategies in a fixed priority order. Within a strategy, the first category in load order wins.

1. **`id_prefix_hints`**: the leading letters of the app ID (for example `hospacs` from `HOSPACS004`) match a hint.
2. **`vendor_patterns`**: the vendor cell contains one of the patterns (case-insensitive substring match).
3. **`product_name_patterns`**: a regular expression matches the app name (case-insensitive).

Independently, `os_string_patterns` on platform categories set the app's `os_class` from the operating system cell, and site prefixes set `site`.

## Clusters

Categories with `cluster_hint: true` (built-in: VDI) let the scaffold consolidate identical rows. When at least `cluster_threshold` rows (default 3) share the same ID prefix and category, they become one cluster app (for example `hoscix-cluster` for `HOSCIX001` to `HOSCIX005`) that lists its `cluster_members`. A 30-worker VDI farm is then assessed once, not thirty times.

## Tier 2: engagement-specific categories

Add or override categories for one engagement by placing YAML files in `wsp/inputs/catalogs/infra-cat/` in the workspace. Tier 2 is optional.

- A Tier 2 category with a **new ID** is added after the built-in ones.
- A Tier 2 category with the **same ID** as a built-in one replaces it for this workspace.
- Files are loaded in alphabetical order; when the same ID appears in two Tier 2 files the last one wins, and `swao health-check` probe 21 warns about it.

```yaml
# wsp/inputs/catalogs/infra-cat/engagement.yaml
id: INFRA_ENGAGEMENT
name: "Engagement-specific categories"
services:
  - id: INFRA_CUSTOM_LAB_ANALYSER
    name: "Laboratory analyser middleware"
    sovereign_rating: proprietary
    id_prefix_hints: [labmw]
    vendor_patterns: ["Example Lab Systems"]
    product_name_patterns: ["\\bAnalyser\\b", "\\bLabor\\b"]
    eol_product_ids: [windows-server]
    sovereign_alternatives:
      - { id: senaite, name: "SENAITE LIMS", sovereign_rating: open-source }
sites:
  - { prefix: anx, site: "Annex building" }
```

### Category keys

| Key | Meaning |
|---|---|
| `id` | `INFRA_` followed by upper-case letters, digits, underscores |
| `name`, `short` | Display name and short label |
| `sovereign_rating` | `open-source`, `open-standard`, or `proprietary` |
| `id_prefix_hints` | App ID prefixes that indicate the category |
| `vendor_patterns` | Vendor name substrings (case-insensitive) |
| `vendor_canonical_name` | Normalised vendor name for consolidation grouping |
| `product_name_patterns` | Regular expressions on the app name; must compile (probe 21 checks) |
| `os_string_patterns` | Substrings of the OS cell that set `os_class` |
| `cluster_hint`, `cluster_by` | Allow cluster consolidation (`cluster_by: id_prefix`) |
| `eol_product_ids` | endoflife.date product IDs to query for this category |
| `osv_package` | `{ name, ecosystem }` for OSV.dev lookups of open-source products |
| `data_health_implied`, `regulatory` | Defaults for health data and regulatory obligations |
| `sovereign_alternatives` | List of `{ id, name, sovereign_rating }` |

Tier 2 files are included, after PII redaction, in `swao support-bundle`.
