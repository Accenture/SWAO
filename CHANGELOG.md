```
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Changelog
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
```

# Changelog

All notable changes to SWAO are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and SWAO adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-09-04

First public stable release of SWAO Community Edition.

### What is SWAO?

SWAO (Sovereign Workload Assessment and Onboarding) is an open-source CLI tool
that assesses cloud workloads for sovereign readiness and cloud-native maturity.
It analyses source code, infrastructure definitions, and runtime signals to
produce actionable migration plans and compliance evidence.

### Included in this release

**Assessment engine**

- 14 automated assessment passes: static analysis (AST, IaC, dependencies),
  LLM-assisted classification (7R migration label, compliance verdicts, cloud-native
  maturity, portability scoring), dynamic analysis (Playwright-driven UI traces),
  security scanning (credential detection, entropy analysis, SAST integration).
- Coverage score reporting: Assessment Coverage, Cloud-Native Score, and Portability
  Score computed per application and aggregated across a portfolio.
- 11 community frameworks: GDPR, AI 10 Pillars, BSI C5, BSI IT-Grundschutz
  2023, HIPAA/NIST SP 800-66r2, LLM Selection, NCA CCC 2024, NCA ECC 2024,
  PCI-DSS v4, SAMA CSF v1.
- Landing zone catalogue assessment against AWS, Azure, GCP, StackIT, and AWS
  sovereign landing zones.

**Outputs**

- Workload Sovereignty Profile (WSP) - structured YAML assessment record per
  application run.
- HTML publication with interactive coverage tiles, migration rationale prose,
  severity breakdown chart, and per-finding tables.
- Text, YAML, and JSON report formats for CI integration.
- SBOM generation (CycloneDX) included.

**CLI and TUI**

- `swao assess` - run a full assessment against an application workspace.
- `swao report` - generate reports from an existing WSP.
- `swao publish` - produce the HTML publication from a WSP.
- `swao health-check` - verify environment readiness (LLM provider, Playwright,
  community frameworks, licence).
- `swao init` - scaffold a new SWAO workspace interactively.
- Interactive TUI menu (`swao menu`) for guided operation.

**Platform**

- Binaries available for Windows (x64), Linux (x64), macOS (x64), macOS (Apple Silicon).
- Docker image: `ghcr.io/accenture/swao:1.0.0`.
- Node.js >= 20 required if running from source.

### Added (OSS launch)

- 11 community frameworks available at `community-frameworks/` for
  standalone download and customisation.
- Structured GitHub Issue forms: bug report, feature request, community framework,
  provider driver.
- CODEOWNERS file assigning default review to the `swao-maintainers` team.
- Dependabot weekly schedule for GitHub Actions dependencies.
- CodeQL default-setup code scanning on push and pull request.

### Known Limitations

- LZ Stakeholder Challenge findings are not yet shown in the HTML publication.
  The CLI text report (`swao report-lz`) reads the YAML files correctly; the HTML
  block is scheduled for the next release. See #2701.
- Authenticode (Windows code signing) is not yet applied to the Windows binary.
  The unsigned PE may trigger AV heuristics on some systems. See the VirusTotal
  baseline at `docs/releases/v1.0.0-vt-baseline.md` for the current detection
  profile. Code signing is planned for v1.1.0.
- **MCP server WSP read coverage (Enterprise).** The MCP integration already
  surfaces signals, stakeholder challenge YAMLs, reports, costs, risks, feedback
  annotations, workspace inventory, portfolio views, and landing zone selection
  rationale. The following artefact types are in active development under milestone
  MCP-1.1 and will be available in the next minor release: ingested input file
  listing, assessment run history, WSP verdict summary (7R label, coverage score,
  recommended landing zone), saved report retrieval, and per-provider LZ fit score
  matrix. All written artefacts are preserved to disk in the interim and accessible
  via the CLI or existing MCP read tools.

---

## [0.12.3] - 2026-09-02

### Fixed

- License guard `_paths.legacyLicencePath` exported so test suites can redirect migration source and prevent real-system licence pollution (#2596 test isolation)
- GuidanceBox TU-GB-06 test updated to match #2559 Esc-collapse behaviour
- screens-contract SupportBundleScreen import converted to static to prevent 5 s timeout under full-suite load
- workspace-setup-e2e PowerBI scaffolder test mocks Enterprise tier so tier-gated `scaffoldPowerBiTemplates` (#2566) is exercised
- Auditor-view DATA-02 test expectation aligned to Layer 4 report standardisation (drill-down restricted to high/critical; medium-severity verified via coverage table)
- 62 closed issue files updated to `state: closed` frontmatter (tracker integrity)
- Export BI progress bar colour set to cyan; "Output" section label corrected (#2603 #2604)
- TUI main-menu tier-gated items always rendered; dim applied only to comingSoon items not locked by tier (#2605)
- TUI LLM assessment running-stage progress bar label shortened for narrow terminals (#2597)
- LLM assessment onProgress messages logged to NDJSON and poll filter extended (#2598)
- LZ Catalog Assessment TUI logs tui.output NDJSON events (#2599)
- ReportScreen "all" format label corrected; LLM CLI report handler registered; Export BI hint hidden at Community tier (#2600 #2601)
- LicenseScreen explains binary-tier cap when effective tier is lower than the licence tier (#2608)
- Licence request form pre-populates email from system context (#2609)
- `LicenseStatusLine` "previous licence (inactive)" label for manually-removed keys; avoids implying natural expiry (#2607)
- `SupportBundleScreen` replaces text spinner with `ProgressBar` for consistency with other long-running screens (#2610)

## [0.12.2] - 2026-09-01

### Fixed

- LZ catalog report missing verdict sections for cloud readiness, compliance, and migration (#2434)
- TUI content width no longer overflows narrow terminals; line-wrap capped at column 100 (#2563)
- GuidanceBox ESC key now closes the panel correctly (#2559)
- PKG_EXECPATH cleared in all child spawns preventing double-binary-init hang (#2542)
- NDJSON portfolio event errors on license request and LLM saving stage (#2543, #2562)
- Auditor report renamed to `auditor.yaml` / `auditor.json`; `schema_version: '1.0'` added (#2556)
- Auditor drilldown filtered to critical/high signals only (was including medium, #2550)
- ReportScreen "all" format option generates text + yaml + json in one step (#2553-#2555)
- BI export dual LZ-fit file structure (passes/lz-fit.yaml vs run-root lz-catalogue-fit-*.yaml) (#2557)
- `swao init` PowerBI template scaffolding gated to Consultant/Enterprise tiers (#2566)
- LZ assessment run writes `findings.yaml` placeholder at run root (#2503)
- MainMenu tier badges visible for Community / Consultant / Enterprise (#2560)
- LicenseScreen email placeholder is now static; PII no longer leaks into NDJSON events (#2561)

## [0.12.1] - 2026-08-29

### Fixed

- LLM report `--format text/yaml/json` now renders correctly (was restricted to PDF only)
- LLM HTML publication filename preserves ISO 8601 T separator (was all-dash)
- LZ PDF service items display readable labels instead of raw enum (AVAILABLE_NOT_ENABLED)
- Export BI Tableau label no longer shows internal tracker issue number
- Portfolio `--portfolio` failure now prints per-app stderr/stdout diagnostic
- `swao init` PowerBI template path resolves correctly in pkg binary
- Support bundle `health-check.json` includes full probe array on failure
- Support bundle machine fingerprint matches licence system fingerprint
- `swao doctor` CLI alias removed; use `swao health-check`
- GuidanceBox UX: MCP Client step, HTML editor step, LLM report type, PDF-locked phase

