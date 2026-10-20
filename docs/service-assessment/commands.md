# Command reference

All Service Portfolio Assessment commands work on a SWAO workspace: a folder with a workspace `.swao.yml` and an `apps/` folder. Without `--workspace`, SWAO uses the nearest `.swao.yml` above the current directory. None of the commands prompts for input; when something is missing or ambiguous they stop with an error message, so they are safe to run in CI.

## swao service init

Scaffolds one app folder per intake row.

```bash
swao service init [--from <intake.xlsx>] [--mapping <column-map.yaml>] [--workspace <dir>] [--refresh] [--cluster-threshold <n>] [--json]
```

| Option | Meaning |
|---|---|
| `--from <xlsx>` | Intake Excel workbook. Without it SWAO uses the single `.xlsx` file in `wsp/inputs/service-intake/` of the workspace; Excel lock files (`~$...`) are ignored. When that folder holds no workbook or more than one, the command stops with an error that names what it found. |
| `--mapping <yaml>` | Column map for a layout that header detection does not cover. Without it, and when `--from` is omitted, SWAO uses a column map next to the workbook in `wsp/inputs/service-intake/` (a `.yaml` or `.yml` file whose name contains `column-map` or `columnmap`) if exactly one exists; otherwise it detects the columns from the header row. See [Column mapping](/service-assessment/column-mapping). |
| `--workspace <dir>` | Workspace root. If no `.swao.yml` exists there, one is created. |
| `--refresh` | Update existing service apps from the workbook. Only keys listed in each app's `generated_fields` are rewritten; your manual edits elsewhere are preserved. See [Editing safely](/service-assessment/configuration#editing-safely). |
| `--cluster-threshold <n>` | Minimum number of identical rows that form a cluster (default 3, or `service_portfolio.cluster_threshold`). |
| `--json` | Machine-readable result. Contains no PII values. |

What it does, in order:

1. Reads every sheet, resolves the column layout, and coerces values (numbers, booleans, capacity units such as `16 GB`).
2. Scrubs PII: contact, phone, and e-mail columns are reduced to true/false presence flags; vendor names that look like a personal name are redacted.
3. Stops with an error if two rows share an app ID (no folder is written).
4. Classifies each row against SWAO-INFRA-CAT and groups identical rows of cluster-capable categories (for example VDI workers) into one cluster app.
5. Estimates lift-and-shift cloud cost from the hardware columns.
6. Writes `apps/<id>/.swao.yml`, one empty drop folder `apps/<id>/ingestion/` per app (no further subfolders), `wsp/signals/scaffold-signals.json`, and the `service_portfolio:` block in the workspace `.swao.yml`.

The summary lists, per sheet, the recognised columns (field and column letter, and whether they came from header detection or the column map) and warns when no column was found for the operating system (end-of-life research), the app name (CVE and advisory research), or the vendor (CVE research). It then lists the SCAFFOLD signals and every app SWAO could not classify; assign `infra_category` for those manually.

Existing service apps that this intake no longer produces are listed and left untouched. This happens when rows were removed from the workbook, or when a newer SWAO version derives the app IDs differently (see [How SWAO reads the identity cell](/service-assessment/column-mapping#how-swao-reads-the-identity-cell)). Delete those app folders, or scaffold into a fresh workspace, so that the portfolio holds one generation of apps.

## swao service research

Runs Pass 24 RESEARCH for all service apps (or one) and then rebuilds the portfolio summary.

```bash
swao service research [--app <id>] [--workspace <dir>] [--refresh] [--dry-run] [--skip-llm] [--json]
```

| Option | Meaning |
|---|---|
| `--app <id>` | Research one app only |
| `--refresh` | Re-query every source even when cached results are still fresh. Stubs marked as reviewed by an analyst are never rewritten. |
| `--dry-run` | Show which stubs would be created or refreshed; no requests, no writes |
| `--skip-llm` | Skip the four LLM topics for this run: no LLM call, and the configured provider is not built. Topics without earlier findings are written as `skipped` with `skipped_by_user`; earlier LLM findings for the same vendor, product and version are kept. The terminal interface asks the same question before the scope question. |
| `--json` | Print the result as JSON |

Sources and cache periods: NVD (7 days), CISA KEV (1 day), OSV.dev (7 days), BSI CERT-Bund (1 day), endoflife.date (30 days), VirusTotal (7 days), workspace LLM (30 days). Details in [Pass 24 RESEARCH](/passes/24-research). API keys: [Optional API keys](/service-assessment/api-keys).

After research SWAO prints the composite confidence distribution (the weakest topic per app; apps with nothing to look up are counted separately), one line per topic (`cve-summary`, `eol-status`, `virustotal`, and the four LLM topics when an LLM researched them), the LLM provider and model used (or why the LLM topics were skipped), and the number of RESEARCH signals. It then rebuilds `wsp/portfolio-summary.json`, the integration graph and the wave report, names the top integration hubs, and writes a delta report against the previous snapshot.

A topic with nothing to look up (CVE research without vendor, product name, and OSV package; end-of-life research without an operating system) is recorded as `skipped`, not as a low-confidence result. CVE research in NVD needs a vendor name: if the intake has no vendor column, fill `vendor.name` in `apps/<id>/.swao.yml` (see [Editing safely](/service-assessment/configuration#editing-safely)) and run `swao service research --app <id> --refresh`.

**LLM-augmented research (all tiers).** With an LLM configured for the workspace (`providers.llm` in `.swao.yml`, or `SWAO_LLM_CONNECTOR` / `SWAO_LLM_PROVIDER`, as for `swao assess`), the command also researches `vendor-profile`, `certifications`, `data-residency` and `breach-history`. Each finding carries the source URLs the model cited, marked as not verified, and a confidence; the topic confidence is at most `medium` until an analyst reviews the stub. Only vendor name, product name, version and the INFRA-CAT category are sent, and the prompt passes the same PII redaction as every other LLM call. Without an LLM these topics are written as `skipped` with `no_llm_configured`; with `--skip-llm` as `skipped_by_user`. Breach-history findings that report an incident produce the RESEARCH signal `RES-09` (`VENDOR.BREACH_HISTORY`); explicit facts from prompt version 1.1 produce `RES-10` to `RES-14` (slow patch cadence, no EU entity, no GDPR Art. 9 DPA, MDR class not published, not in the BfArM database), all at most medium and marked as model-cited and unverified. Stubs written with prompt version 1.0 gain these facts after `--refresh` or when they expire. See [Pass 24 RESEARCH](/passes/24-research).

For air-gapped environments, the source endpoints can be redirected to internal mirrors with `SWAO_NVD_BASE_URL`, `SWAO_EOL_BASE_URL`, `SWAO_KEV_URL`, `SWAO_BSI_RSS_URL`, `SWAO_OSV_BASE_URL`, and `SWAO_VT_BASE_URL`.

## swao service rank

Lists the service apps in the order in which to assess them. Read-only.

```bash
swao service rank [--top <n>] [--workspace <dir>] [--json]
```

| Option | Meaning |
|---|---|
| `--top <n>` | Only the first n apps |
| `--json` | Print the ranked apps (ID, name, risk score, fan-in, TIME quadrant, operational status, evidence) as JSON |

The order is the highest SWAO_APM risk score first (apps without a score last), then the higher integration fan-in, then the app ID. Apps without a service assessment run keep their place but are marked `[not assessed]` (JSON: `evidence: not_assessed`): their risk score and TIME come from the intake and research only. Apps with the operational status `decommissioned`, `unused`, or `inactive` are left out; they are Eliminate candidates without an assessment. The ranking reads `wsp/portfolio-summary.json`, so it is meaningful after `swao service research`; without a summary all service apps are listed in ID order. The terminal interface uses the same ranking for its "top 20" scope. In CI, loop over the result and run `swao assess --app <id> --type service` for each app:

```bash
for id in $(swao service rank --top 20 --json | jq -r '.apps[].id'); do
  swao assess --app "$id" --type service
done
```

## swao assess --type service

Runs the service pass profile for one app (or all apps with `--portfolio`, Enterprise).

```bash
swao assess --app <id> --type service
```

Source-code passes are skipped and recorded as UNKNOWN in the scope coverage, not as failures. Pass 25 BINARY runs first when installers are present; data, cryptography (on binaries and configuration), compliance, and block assessment run as in an application assessment. The run updates `apps/<id>/wsp/latest-service.txt` and the portfolio summary. An application assessment (`swao assess --app <id>`) rebuilds `wsp/portfolio-summary.json` as well, so application apps appear in the combined portfolio view with their latest run. The rebuild happens after a run that finished complete or partial; if it fails, SWAO prints a warning and the run result is unchanged. See the [pass overview](/passes/) for which passes run in service mode.

After you add documents or installers to `apps/<id>/ingestion/`, run the command again: Pass 00 INGEST picks up new and changed files and reports how many documents are new, changed, or unchanged. See [Adding documents and installers](/service-assessment/#adding-documents-and-installers).

## swao service export (Enterprise)

```bash
swao service export [--workspace <dir>] [--json]
```

Rebuilds the portfolio summary and writes:

- `wsp/reports/swao-portfolio-YYYYMMDD.xlsx`: 14 sheets (Portfolio Overview, Hardware Inventory, CVE Register, EoL Calendar, Framework Compliance, Data Register, Cost vs Risk, Integration Map, Migration Candidates, Migration Waves, Vendor Consolidation, Action Register, DORA ICT Register, Source Data)
- `wsp/star-schema/portfolio-*.json`: 9 tables for BI tools

Requires an Enterprise licence (`service-excel` and `bi-export` features). The PowerBI templates in SWAO cover Application Assessment data only; use the workbook or the star schema for service portfolio data.

## swao health-check

Probes 17 to 25 check a service workspace: intake mapping, SWAO_APM weights, workspace structure, research freshness, Tier 2 catalogue, clusters, a PII scrub audit, snapshots, and the SWAO_APM control set. See [Health check](/health-check).

## swao support-bundle

On a service workspace the support bundle additionally contains scaffold signals, the portfolio summary, the column map, Tier 2 catalogue files, research stub front-matter, confidence files, and binary analysis, after a second PII redaction pass documented in `redaction-log.txt`.
