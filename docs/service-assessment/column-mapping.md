# Column mapping guide

`swao service init` needs to know which spreadsheet column holds which piece of information. There are two ways to tell it.

## Option 1: let SWAO detect the columns from the header row

If the header row (row 1 of each sheet) uses recognised names, no configuration is needed. SWAO compares the headers case-insensitively, with surrounding spaces removed and runs of whitespace read as one space, in two passes:

1. **Exact match.** A header that equals a recognised name is mapped first.
2. **Prefix match.** For fields that are still unmapped, a header that starts with a recognised name followed by a space or one of the characters `(` `[` `:` `/` `,` `;` `.` is mapped as well. For example, `OS according to the configuration file` maps to `os`, and `AMS Sovereign Cloud Ja / Nein` maps to `ams_sovereign_cloud`. `OSI layer` does not match `os`, and `Migrationsprojekt` does not match `migration`.

Each column feeds at most one field. A sheet without an identity column (none of the `id` headers) is skipped with a warning.

| Field | Recognised headers | Stored in `apps/<id>/.swao.yml` |
|---|---|---|
| `id` | `App ID`, `VM`, `ID`, `Server`, `Hostname` | `app_id` |
| `name` | `App Name`, `Application`, `Anwendung`, `Name` | `app_name` |
| `vendor_name` | `Vendor`, `Hersteller`, `Manufacturer` | `vendor.name` |
| `vendor_version` | `Version` | `vendor.version` |
| `vendor_url` | `Vendor Website`, `URL`, `Website` | `vendor.url` |
| `vendor_type` | `Assessment Type`, `Vendor Type` | `vendor_type` |
| `vendor_support_active` | `Vendor Support Active` | `vendor.support_active` |
| `contract_expiry` | `Contract Expiry`, `Vertragsende` | `vendor.contract_expiry` |
| `os` | `OS`, `Operating System`, `Betriebssystem` | `platform.os` |
| `os_eol` | `OS Support Status` | `platform.os_eol` |
| `active_memory_mb` | `Active Memory (MB)`, `Active Memory`, `Aktiver Speicher` | `hardware.active_memory_mb` |
| `memory_mb` | `Memory (MB)`, `Memory`, `RAM (MB)`, `RAM`, `Arbeitsspeicher` | `hardware.memory_mb` |
| `cpu_cores` | `CPU Cores`, `CPUs`, `CPU`, `vCPU`, `vCPUs` | `hardware.cpu_cores` |
| `disk_count` | `Disks`, `Disk Count` | `hardware.disk_count` |
| `total_disk_mib` | `Total Disk Capacity MiB`, `Total Disk (MiB)`, `Disk Capacity MiB` | `hardware.total_disk_mib` |
| `total_disk_gb` | `Total Disk (GB)`, `Disk (GB)`, `Total Disk Capacity GB` | `hardware.total_disk_gb` |
| `ip` | `IP`, `IP Address`, `IP-Adresse` | `network.ip` |
| `network_zone` | `Network Zone` | `network.zone` |
| `auth_method` | `Authentication` | `platform.auth_method` |
| `backup_enabled` | `Backup / DR`, `Backup` | `platform.backup_enabled` |
| `sla_uptime` | `SLA Uptime (%)`, `SLA Uptime` | `platform.sla_uptime` |
| `business_domain` | `Department`, `Fachbereich` | `business.domain` |
| `business_function` | `Function`, `App-Funktion`, `App Funktion` | `business.function` |
| `user_count` | `User Count` | `business.user_count` |
| `criticality` | `Criticality` | `business.criticality` |
| `annual_cost_eur` | `Annual Cost (EUR)`, `Annual Cost` | `business.annual_cost_eur` |
| `license_type` | `License Type`, `Licence Type` | `business.license_type` |
| `health_data` | `Contains Health Data` | `data.health_data` |
| `data_pii` | `Contains Personal Data (PII)`, `Contains Personal Data` | `data.pii` |
| `data_subjects` | `Data Subjects` | `data.subjects` |
| `data_categories` | `Data Categories` | `data.categories` |
| `data_classification` | `Data Classification` | `data.classification` |
| `data_residency` | `Data Residency` | `data.residency` |
| `subprocessors` | `Sub-processors`, `Subprocessors` | `data.subprocessors` |
| `gdpr_art9` | `GDPR Art.9 Health Data`, `GDPR Art.9` | `data.gdpr_art9` |
| `hipaa_phi` | `HIPAA PHI` | `data.hipaa_phi` |
| `regulatory` | `Regulatory Obligations` | `data.regulatory` |
| `mdr_class` | `MDR / IVDR Classification`, `MDR Class` | `data.mdr_class` |
| `migration_candidate` | `Migration Candidate`, `Migration` | `disposition.migration_candidate` |
| `migration_project_vendor` | `Migrationsprojekt mit Hersteller`, `Migration Project with Vendor`, `Vendor Migration Project` | `disposition.migration_project_vendor` |
| `ams_sovereign_cloud` | `AMS Sovereign Cloud` | `disposition.ams_sovereign_cloud` |
| `gartner_time` | `Gartner TIME` | `disposition.gartner_time` |
| `last_audit_date` | `Last Security Audit` | `security.last_audit_date` |
| `integrations_raw` | `Integration Dependencies`, `Integrations`, `KIS-Anbindung`, `KIS Anbindung`, `Schnittstellen` | `integrations` |

The list fields `data_subjects`, `data_categories`, `subprocessors`, and `regulatory` are split on `,`, and `business_domain` on `/`.

Headers that look like personal data are always PII columns, whatever else they would match: headers containing phone, Telefon, Telefonnummer, Tel, mobile, Mobil, e-mail, email, mail, contact, Kontakt, or Ansprechpartner, and the header `Hersteller Support`. Their values are never stored: SWAO records only whether a value is present (`support_contact_present`, `support_phone_present`, `support_email_present` in the `vendor` block). This check runs before the field matching, so `Hersteller Support` never becomes the vendor name.

When the sheet has an ID column but no separate name column (none of the `name` headers), the ID column is read as the combined `ID (Name) notes` form; see [How SWAO reads the identity cell](#how-swao-reads-the-identity-cell).

After `swao service init`, the summary shows per sheet which columns were recognised, and warns when the operating system, the app name, or the vendor is missing, because research needs them:

```text
  Columns (Inventory, header detection): 5 recognised: id_name_combined A, os B, cpu_cores C, memory_mb D, integrations_raw E
  [warn] Not in the intake: vendor name (CVE research). Add the column (or a column map) for better research, or fill the values in apps/<id>/.swao.yml.
```

## How SWAO reads the identity cell

The identity column holds the app ID and often more: a name in brackets, an operational flag, or free-text notes. SWAO applies the same rules to a combined `ID (Name) notes` cell (`id_name_combined`) and to a separate ID column (`id`):

- **App ID**: the text before the first `(` (or the `split_on` character), cut at the first operational flag phrase and at a dash with a space on both sides. The remaining words stay part of the ID, so `FILESRV 2020` becomes `filesrv-2020` and stays distinct from `FILESRV (Linux Fileserver)`, which becomes `filesrv`.
- **Folder-safe form**: lower case; `ä`, `ö`, `ü`, and `ß` become `ae`, `oe`, `ue`, and `ss`; every other character outside `a-z`, `0-9`, `.`, `_`, and `-` becomes a dash; runs of dashes collapse into one; leading and trailing dashes are removed.
- **App name**: the text inside the brackets, up to the last `)`, cut before a flag phrase; URL-encoded characters such as `%2f` are decoded. Without brackets the name is empty. A mapped name column takes precedence.
- **Notes**: text after the closing bracket or after a flag phrase never reaches the ID or the name, because notes can name a member of staff.
- **Operational flag**: the first flag phrase anywhere in the cell, including inside the brackets, sets `disposition.operational_status`. Matching ignores case.

| Phrase in the cell | Operational status |
|---|---|
| `nicht starten & nicht löschen` (also with `und`, or written `loeschen`) | `restricted` (keep, do not start) |
| `Alt Abgeschaltet`, `decommissioned` | `decommissioned` |
| `Ungenutzte Ressource` (also when followed by `Nicht starten`) | `unused` |
| `nicht starten` or `nicht löschen` on its own | `restricted` |

A row without a flag is `active`, or `inactive` when its memory or active memory is 0. Apps that are `decommissioned`, `unused`, or `inactive` are classified Eliminate; `restricted` apps are not.

| Cell | App ID | App name | Operational status |
|---|---|---|---|
| `HOSAPP133 (Imaging Viewer)` | `hosapp133` | Imaging Viewer | `active` |
| `HOSAPP145 (Archive4) NICHT LÖSCHEN ...` | `hosapp145` | Archive4 | `restricted` |
| `HOSAPP146 (Old Archive) Alt Abgeschaltet` | `hosapp146` | Old Archive | `decommissioned` |
| `HOSAPP051 (Spare VM) Ungenutzte Ressource. Nicht starten` | `hosapp051` | Spare VM | `unused` |
| `HOSAPP047 (Spare nicht starten)` | `hosapp047` | Spare | `restricted` |
| `FILESRV 2020` | `filesrv-2020` | (empty) | `active` |
| `HOSAPP200 - Imaging Router` | `hosapp200` | (empty) | `active` |
| `Prüf-Server` | `pruef-server` | (empty) | `active` |

If a newer SWAO version derives the IDs differently from an earlier scaffold, `swao service init` lists the existing service apps that the intake no longer produces and leaves them untouched. Delete those app folders, or scaffold into a fresh workspace.

## Option 2: provide a column map

For any other layout, write a column map YAML file. Pass it with `--mapping`, or place it next to the workbook in `wsp/inputs/service-intake/` (for example as `column-map.yaml`): when `--from` is omitted and exactly one such file exists, `swao service init` uses it automatically.

```bash
swao service init --from server-list.xlsx --mapping column-map.yaml
```

Template for an export whose first column combines ID, name, and notes (for example `HOSAPP145 (Archive4) NICHT LÖSCHEN ...`). The header names in `note:` are for orientation only; SWAO maps by column letter. Adjust the letters to your sheet and delete the lines for columns you do not have, but keep the identity and `os`:

```yaml
# wsp/inputs/service-intake/column-map.yaml
version: "1.0"
source:
  sheet: 1                # sheet name or 1-based number; default: every sheet
  header_row: 1
  data_start_row: 2
fields:
  # Column A "Server (Application)": ID before "(", name inside the brackets
  id_name_combined:    { col: A, split_on: "(", strip_closing: ")", strip_flags: true }
  os:                  { col: B, note: "Operating System / Betriebssystem" }
  vendor_name:         { col: C, note: "Vendor / Hersteller" }
  vendor_version:      { col: D, note: "Version" }
  cpu_cores:           { col: E, type: integer, note: "vCPU" }
  memory_mb:           { col: F, unit: mb, note: "Memory (MB) / Arbeitsspeicher" }
  active_memory_mb:    { col: G, unit: mb, note: "Active Memory (MB) / Aktiver Speicher" }
  total_disk_gb:       { col: H, unit: gb, note: "Disk (GB) / Festplatte (GB)" }
  integrations_raw:    { col: I, multi_value_separator: ",", note: "Integrations / Schnittstellen" }
  business_domain:     { col: J, multi_value_separator: "/", note: "Department / Fachbereich" }
  business_function:   { col: K, note: "Function / Funktion" }
  migration_candidate: { col: L, true_values: ["Yes", "Ja"], false_values: ["No", "Nein"], note: "Migration candidate / Migrationskandidat" }
pii_columns:              # values reduced to true/false, never stored
  - { col: M, reason: support_contact }
  - { col: N, reason: support_phone }
  - { col: O, reason: support_email }
```

### Field options

| Option | Meaning |
|---|---|
| `col` | Column letter (`A` to `AZ`) or 1-based column number |
| `required` | Documents that the column is expected; accepted for readability, not enforced per cell (rows without an identity are always skipped with a SCAFFOLD.MANDATORY_FIELD_MISSING signal) |
| `type` | `string`, `integer`, `number`, `boolean`, or `list` (defaults per field) |
| `unit` | `mb`, `mib`, or `gb` for capacity columns; values such as `16 GB` are converted |
| `true_values`, `false_values`, `null_values` | Words that mean yes, no, or empty in your sheet |
| `multi_value_separator` | Split one cell into a list (list fields) |
| `split_on` | Separator between ID and name in a combined identity cell |
| `strip_closing`, `strip_flags` | Clean combined identity cells: remove a closing character, and strip operational status flags (on by default; the flag is still used to set the operational status) |
| `app_id_pattern` | For `integrations_raw`: regular expression that recognises app IDs among the cell tokens (other text is kept as integration notes) |
| `note` | Free text for your own documentation |

### Rules SWAO enforces

- An identity is mandatory: map either `id_name_combined`, or `id` (optionally with `name`), not both.
- `os` is mandatory in a custom map: it drives the end-of-life research, the most valuable signal per row.
- A column listed in `pii_columns` cannot also be mapped to a field.
- Unknown field names are rejected with the list of supported fields.
- Headers that look like personal data but are not declared in `pii_columns` produce a warning; `swao health-check` probe 17 reports them as well.

### Supported fields

`id_name_combined`, `id`, `name`, `vendor_type`, `vendor_name`, `vendor_version`, `vendor_url`, `vendor_support_active`, `contract_expiry`, `os`, `os_eol`, `auth_method`, `backup_enabled`, `sla_uptime`, `cpu_cores`, `memory_mb`, `active_memory_mb`, `disk_count`, `total_disk_mib`, `total_disk_gb`, `ip`, `network_zone`, `integrations_raw`, `business_function`, `business_domain`, `user_count`, `criticality`, `annual_cost_eur`, `license_type`, `health_data`, `data_pii`, `data_subjects`, `data_categories`, `data_classification`, `data_residency`, `subprocessors`, `gdpr_art9`, `hipaa_phi`, `regulatory`, `mdr_class`, `migration_candidate`, `gartner_time`, `migration_project_vendor`, `ams_sovereign_cloud`, `last_audit_date`.

## Which columns matter most

| Priority | Columns | Why |
|---|---|---|
| Mandatory | App ID (and name) | Without an identity no app folder can be created |
| Strongly recommended | Operating system, migration candidate, vendor | End-of-life research, TIME classification, CVE research |
| Recommended | CPU, memory, disks, integrations, department, business function | Cloud cost estimate, integration graph, grouping, research context |
| Optional | IP, URL, migration project, sovereign cloud programme flag | Network context, strategic context |

## Where the mapping is recorded

The workspace `.swao.yml` keeps a `service_portfolio:` block with the source file, the column map path, header names per sheet, the PII column letters, and the cluster threshold. It contains header names only, never cell values. Each app's `.swao.yml` also lists in `intake.fields` which fields the layout mapped; SWAO_APM uses this list to tell an empty value from a missing column.
