# Pass 05: Dependencies and Vulnerabilities (SBOM)

| Property | Value |
|---|---|
| Pass number | 05 |
| Key | `sbom` |
| Pass name in output | `sbom_cve` |
| Signal prefix | `SBOM` |
| Type | Deterministic (rule engine) with an optional online vulnerability lookup, no LLM |
| Default | On |
| Assessment types | `application`; `llm` (inside each leg); `service` (conditional: runs when a CycloneDX or SPDX SBOM is supplied with the binaries). Not run for `landing-zone-catalog`. |
| Tier | Not tier-gated (Community and above) |

## What it is for

Third-party packages carry known vulnerabilities and maintenance risk into any target platform. Pass 05 answers: **"Do the application's dependencies contain known vulnerabilities or abandoned packages, and is the runtime still supported?"**

It is a quick pre-assessment check, not a full software composition analysis. It spot-checks dependencies against the public OSV vulnerability database, flags packages known to be unmaintained, reports the Node.js runtime support status, and always records that a complete SBOM scan is required as a pre-migration gate.

## What you need to provide

- The application source tree with one or more `package.json` files, and/or
- An external SBOM placed directly in `wsp/inputs/compliance/` (not in a subfolder):
  - CycloneDX JSON: `*.cdx.json`
  - Spreadsheet exports: `SBOM-*.xlsx.*.csv` (the per-sheet CSV that [Pass 00](/passes/00-ingest) creates from an `SBOM-*.xlsx` file placed directly in `ingestion/`) or `*.sbom.csv`. The CSV needs a header with a name column (`packageName`, `name` or `component`) and optionally a version column (`version` or `ver`); comma and semicolon separators are both accepted.
  To route a CycloneDX file through [Pass 00](/passes/00-ingest), give it a name containing `sbom` or `bom` (for example `app-sbom.cdx.json`) and place it directly in `ingestion/`, not in a subfolder; otherwise it lands in `structured/` and this pass does not read it.
- Or an SBOM inside the source tree: CycloneDX (`*.cdx.json`, `bom.json`, `sbom.json`) or SPDX (`*.spdx.json`, or tag-value `*.spdx`), up to three folder levels below the source root (at most 20 files; `node_modules` and hidden folders are skipped). In a [Service Portfolio Assessment](/service-assessment/) the source root is the binary input folder, so an SBOM supplied with the installers is read there.
- Network access to `https://api.osv.dev` for the vulnerability lookup, or a reachable OSV-compatible mirror. Without it the pass still runs and records that the lookup was skipped.

## How it works

1. **Read external SBOMs** from the top level of `wsp/inputs/compliance/` and the CycloneDX and SPDX files in the source tree, and collect component names and versions.
2. **Find `package.json` files.** If one exists at the source root, only that file is used. Otherwise the pass searches up to four directory levels (skipping `node_modules` and hidden folders) and uses at most five files, which covers typical monorepos.
3. **Merge dependencies.** `dependencies` and `devDependencies` from all files are merged; the runtime `dependencies` are kept separately. External SBOM components are added to the merged list.
4. **Spot-check vulnerabilities.** The **first ten runtime dependencies** are queried one by one at the OSV API (`POST /v1/query`, ecosystem `npm`, version with range prefixes such as `^` or `~` removed, 3-second timeout per query). External SBOM components are not queried, to avoid cross-ecosystem lookups. Each OSV entry is then classified by severity: first by the advisory database rating (`CRITICAL`, `HIGH`, `MODERATE`, `LOW`), otherwise by a numeric score, otherwise by computing the base score from a CVSS v3 vector (9.0 and above critical, 7.0 high, 4.0 medium, above 0 low). An entry with none of these is `unknown`.
5. **Check for unmaintained packages** in the merged list against a built-in list of six packages: `alphavantage`, `left-pad`, `event-stream`, `node-uuid`, `csurf`, `request`.
6. **Assess the runtime** from the first `engines.node` value found: major version 22 or later is `active_lts`, 20 to 21 is `maintenance_lts`, below 20 is `eol`.

## How it is measured

| Signal | Emitted when | Severity | Meaning |
|---|---|---|---|
| `SBOM-01` (early exit) | No `package.json` anywhere and no external SBOM | high | Dependency scan impossible; the pass stops here with `scan_type: skipped` |
| `SBOM-00` | At least one dependency was to be queried, and OSV could not be reached for any of them or `SWAO_OSV_OFFLINE=true` is set | low | CVE data not verified; a manual SBOM scan is required before production |
| `SBOM-01` | Normal run | high when a checked package has at least one high or critical OSV entry; medium when packages have only lower or unclassified entries; informational when no runtime dependency was checked (for example input from an SBOM only), because nothing was verified; otherwise positive | Spot-check result: number of dependencies checked, lookup status, number of affected packages, reminder that a full scan is a pre-migration gate |
| `SBOM-02` onwards | One per unmaintained package found | medium | Package is unmaintained (CWE-1104, use of unmaintained third-party components); replace before production |
| Next number after the unmaintained packages | Always in a normal run | high (`eol`), low (`maintenance_lts`), positive otherwise | Node.js runtime support status |

Numbering is dynamic: with two unmaintained packages, they are `SBOM-02` and `SBOM-03` and the runtime signal is `SBOM-04`.

The `assessment` block records `scan_type` (`osv_spot_check` or `static_analysis`), `cve_lookup` (`completed` or `skipped`), `full_scan_required: true`, `full_scan_gate: pre_migration`, `critical_cves_found` (number of checked packages with at least one high or critical OSV entry), `vulnerable_packages_found` (checked packages with any OSV entry), `known_vulnerabilities_found` (total OSV entries), `dependency_count`, `unmaintained_packages`, `external_sbom_files`, `external_sbom_component_count`, `runtime`, `node_constraint` and `node_eol_status`.

**How results feed later passes.** SBOM signals are evidence for supply-chain and vulnerability management controls evaluated by Pass 11 (COMP) (for example under NIS2, DORA or the EU Cyber Resilience Act when active in `assessment.regimes_active`) and for [Pass 09 (SYNTH)](/passes/09-synth). A high `SBOM-01` becomes a derived security finding. For a full vulnerability and secret scan use the opt-in malware pass described in [Malware scanning](/malware-scanning).

## Third-party modules and tools

| Name | Purpose in this pass | Licence (package metadata) | Bundled or external | When missing |
|---|---|---|---|---|
| OSV API (`api.osv.dev`) | Vulnerability lookup for the first ten runtime dependencies | External service; licence not recorded in repo | External, network access | `SBOM-00` (low) is emitted; `cve_lookup: skipped` |

The pass uses Node.js built-in `fetch` and its own CSV, CycloneDX JSON and SPDX (JSON and tag-value) readers. It does not invoke OSV-Scanner, Syft, Trivy or any other command-line tool.

## Outputs

- `wsp/runs/<ts>/passes/05-sbom.yaml` with header (`id: 5`, `name: sbom_cve`), signals and `assessment`.
- An `assess.pass.sbom.external-inputs-found` entry in the app event log when external SBOM files were loaded.

## Configuration and limitations

**Configuration**

| Setting | Effect |
|---|---|
| `SWAO_OSV_BASE_URL` | Base URL of an OSV-compatible mirror for air-gapped or sovereign environments (default `https://api.osv.dev`) |
| `SWAO_OSV_OFFLINE=true` | Skip all OSV queries; `SBOM-00` explains the skip |
| `--passes sbom` | Run the pass alone |

**Limitations and known gaps**

- Only ten runtime dependencies are checked, and only in the npm ecosystem. This is a sample, not a full scan; the pass says so in every result.
- External SBOM components are checked only against the unmaintained list, not against OSV. Python, Java, Go or Rust manifests are not read.
- The runtime signal assumes Node.js. When no `engines.node` constraint exists, the status is `unknown` but the signal severity is `positive`; read the derivation text rather than the severity in that case.
- SPDX files are read from the source tree only; in `wsp/inputs/compliance/` only CycloneDX JSON and the CSV exports are read.
- No licence classification is performed by this pass.
