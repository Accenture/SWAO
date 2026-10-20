# Service Portfolio Assessment

![Service Portfolio Assessment banner: an intake spreadsheet feeds a research radar, which produces a portfolio workbook with a TIME quadrant](/visuals/banner-service-portfolio.svg)

Service Portfolio Assessment (assessment type `service`, new in v1.4.0) assesses the applications you **buy, rent, or operate but do not build**: third-party software, commercial off-the-shelf (COTS) products, SaaS services, appliances, and legacy servers. No source code is needed. The input is the application inventory you already keep in a spreadsheet or CMDB export.

For each application SWAO researches public vulnerability and end-of-life data, analyses any installers you supply, scores the application across eleven portfolio domains, and recommends a **TIME** disposition. Across the whole portfolio it builds an integration graph, plans migration waves, finds vendor consolidation opportunities, and tracks changes between runs.

## What you can do with it

- **Triage a large estate quickly.** Turn a 300-row server or application list into a ranked, evidence-backed portfolio view in an afternoon instead of weeks of interviews.
- **Find the urgent cases.** Applications with a known-exploited vulnerability (CISA KEV), critical CVEs, or an operating system past end of life are classified **Migrate-Critical** and placed in the first migration wave after decommissioning.
- **Decide what to keep, invest in, move, or retire.** Each application receives a TIME recommendation with a plain-language reason, next to the analyst's own TIME judgement from the intake (never overwritten).
- **Plan a migration programme.** A five-wave roadmap orders applications by urgency and dependency, so integration hubs move after the applications that depend on them.
- **Prepare sovereignty and vendor decisions.** Every application is classified against the SWAO infrastructure catalogue (INFRA-CAT), which names sovereign and open-source alternatives, and vendors are grouped to show consolidation opportunities.
- **Estimate lift-and-shift cloud cost.** CPU, memory, and disk from the intake are sized to Azure and AWS virtual machine SKUs, in euro by default.
- **Report to stakeholders.** Per-app HTML pages, an engagement hub with portfolio blocks, and (Enterprise) a multi-sheet Excel workbook and star-schema export.

## What TIME means

TIME is the Gartner application portfolio model. SWAO adds one urgency level:

| Quadrant | Meaning | Typical trigger in SWAO |
|---|---|---|
| **Tolerate** | Keep running as is; no investment beyond maintenance | In support, no overriding risk |
| **Invest** | Strategic and healthy; worth developing further | Strategic fit, technical health, and vendor health all above 70 |
| **Migrate** | Move to a new platform or successor within the planning horizon | End of life within 36 months, or weak vendor or technical health with good migration readiness |
| **Migrate-Critical** | Move now; risk is already material | CISA KEV match, a critical CVE with end of life inside 12 months, or end of life passed without extended support |
| **Eliminate** | Retire the application | Decommissioned, unused, or inactive; or low strategic fit and low business criticality |

The full rule set, thresholds, and the eleven scoring domains are described in the [SWAO_APM framework reference](/service-assessment/framework).

## What you need to provide

| Input | Required | Purpose |
|---|---|---|
| Intake Excel workbook (`.xlsx`) | Yes | One row per application or server, placed in `wsp/inputs/service-intake/` of the workspace (or passed with `--from`). Only an ID column and an operating system column are strictly needed; every additional column improves the result. See [Column mapping](/service-assessment/column-mapping). |
| Column map YAML | Only when header detection is not enough | Tells SWAO which spreadsheet column holds which field; picked up automatically when it lies next to the workbook in `wsp/inputs/service-intake/` |
| Internet access to public sources | Recommended | NVD, endoflife.date, CISA KEV, BSI CERT-Bund, OSV.dev. Without it, research fields stay empty and scores fall back to the intake data. |
| NVD and VirusTotal API keys | Optional | Faster NVD research; VirusTotal lookups of installer hashes. See [Optional API keys](/service-assessment/api-keys). |
| Installers or binaries per app | Optional | Dropped into `apps/<id>/ingestion/`: signature, certificate, runtime, and architecture analysis (Pass 25 BINARY), cryptography and malware checks, VirusTotal lookup of the installer hash |
| Contracts, certificates, manuals, data-flow diagrams, SBOMs | Optional | Dropped into `apps/<id>/ingestion/` (in any subfolder or none); Pass 00 INGEST extracts the text and routes the files to the context-driven passes. See [Adding documents and installers](#adding-documents-and-installers). |

Contact person, phone, and e-mail columns are **never stored as values**. SWAO records only whether a support contact exists (true or false). This is enforced at intake and checked again by `swao health-check` and in support bundles.

## Quick start

```bash
# 1. Put the intake workbook (and an optional column map) into the workspace:
#    wsp/inputs/service-intake/portfolio.xlsx

# 2. Scaffold one app folder per intake row (creates the workspace if needed)
swao service init                  # or: swao service init --from portfolio.xlsx

# 3. Check the workspace (service probes 17 to 25)
swao health-check

# 4. Research CVEs, end of life, advisories; builds the portfolio summary
swao service research

# 5. Optional: list the apps by risk and run the service pass profile for the first ones
swao service rank --top 20
swao assess --app hosapp200 --type service

# 6. Publish HTML (Consultant) and export the workbook (Enterprise)
swao publish --app hosapp200
swao service export
```

Create the folder `wsp/inputs/service-intake/` yourself; SWAO does not create it. Without `--from`, `swao service init` uses the single `.xlsx` in that folder. No command of the service flow prompts for input, so the same commands run unattended in CI.

In the terminal interface choose **Run Assessment**, then **2. Service Portfolio Assessment**. The screen asks three questions: the intake workbook (pre-filled when one lies in `wsp/inputs/service-intake/`), the column map (pre-filled when one lies next to the workbook; Enter detects the columns from the header row), and the scope: assess the top 20 apps by risk, assess every app, or scaffold and research only. After that, the scaffold, the research of all apps, the assessment of the chosen apps, and (with an Enterprise licence) the portfolio export run without further questions. Progress bars show the stage, the research progress, and the current app with elapsed time and an estimated time remaining. Esc cancels; apps assessed so far are kept.

## Adding documents and installers

`swao service init` creates one empty drop folder per app, `apps/<id>/ingestion/`, and no other folders. Put whatever you have for that application into it, in any subfolder or none:

- **Documents** (PDF, Word, Excel, PowerPoint, Markdown, text, CSV, JSON, YAML) are picked up by [Pass 00 INGEST](/passes/00-ingest) at the start of the next service assessment. Pass 00 compares each file's SHA-256 hash with `ingestion/ingestion-manifest.json`, copies new or changed files into `wsp/inputs/<category>/` (the category follows from the file name and type), extracts the text of PDF, DOCX, XLSX, and PPTX files, and reports `N new, M changed, K unchanged document(s) in ingestion/`.
- **Installers and packages** (`.exe`, `.msi`, `.msp`, `.msix`, `.appx`, `.dll`, `.sys`, `.jar`, `.war`, `.ear`, `.so`, `.dylib`, `.cab`, `.pkg`, `.dmg`, `.deb`, `.rpm`) are recognised anywhere under `ingestion/`. They are not copied. [Pass 25 BINARY](/passes/25-binary) analyses PE files and MSI packages in place and lists MSIX, APPX, JAR, ELF, DEB, RPM, DMG, and PKG files as unsupported; other formats (for example `.msp`, `.cab`, `.dylib`) are only referenced.

Hint folders such as `ingestion/binary/` or `ingestion/data-flow/` created by earlier versions keep working.

| What you drop into `ingestion/` | What it feeds |
|---|---|
| Installers and executables that Pass 25 parses (PE files such as `.exe`, `.dll`, `.sys`; `.msi` packages) | Pass 25 BINARY (signature, certificate, runtime, architecture), Pass 08 CRYPTO in service mode, Pass 14 MALWARE when requested, and the VirusTotal lookup of the installer hash in `swao service research` |
| Other packages (`.msix`, `.appx`, `.jar`, `.so`) | Listed by Pass 25 as `unsupported_files` (no hash, so no VirusTotal lookup); Pass 14 MALWARE scans them when requested |
| SBOM (`*.cdx.json`, `*.spdx.json`, `*.spdx`, `bom.json`, `sbom.json`) | Pass 05 SBOM |
| Configuration files (for example `.ini`, `.xml`, `.conf`, `.config`, `.properties`) next to an installer or SBOM | Pass 08 CRYPTO in service mode (weak algorithms, cleartext endpoints, hard-coded credentials) |
| Data-flow diagrams, contracts, certificates, manuals, and other documents | Pass 03 DATA in service mode, and context for Pass 04 CTX, whose signals Pass 11 COMP uses as evidence for framework controls |

After adding material, run `swao assess --app <id> --type service` again. To re-query the public sources as well, for example after you filled in a vendor name, run `swao service research --app <id> --refresh`.

## What you get

| Output | Location |
|---|---|
| One configuration per app | `apps/<id>/.swao.yml` (`assessment.type: service`) |
| Scaffold signals (duplicates, clusters, unknown categories, scrubbed PII columns) | `wsp/signals/scaffold-signals.json` |
| Research stubs per topic, with confidence and provenance | `apps/<id>/wsp/inputs/research/*.md`, `confidence.json` |
| Portfolio summary: TIME, risk score, domain scores, waves, vendors | `wsp/portfolio-summary.json` |
| Integration graph | `wsp/inputs/integration-graph.json` |
| Migration wave report | `wsp/reports/migration-waves-YYYYMMDD.md` and `.csv` |
| Delta report and snapshots | `wsp/reports/portfolio-delta-YYYYMMDD.md`, `wsp/snapshots/` |
| Per-app HTML publication (Consultant) | `apps/<id>/wsp/publications/latest-service.html` |
| Enterprise workbook and star schema | `wsp/reports/swao-portfolio-YYYYMMDD.xlsx`, `wsp/star-schema/portfolio-*.json` |

## Licence tiers

Service Portfolio Assessment itself is **Community** tier: `swao service init`, `swao service research` (including VirusTotal with your own key), the SWAO_APM framework, and per-app results need no paid licence. Richer outputs follow the normal tier model: HTML publication is Consultant, the Excel workbook and portfolio star schema are Enterprise.

## Further reading

- [Command reference](/service-assessment/commands)
- [Column mapping guide](/service-assessment/column-mapping)
- [INFRA-CAT reference](/service-assessment/infra-cat)
- [Configuration reference](/service-assessment/configuration)
- [Optional API keys](/service-assessment/api-keys)
- [SWAO_APM framework reference](/service-assessment/framework)
- [Migration wave generator](/service-assessment/migration-waves)
- [Analysis passes](/passes/), in particular [Pass 24 RESEARCH](/passes/24-research) and [Pass 25 BINARY](/passes/25-binary)
