# Changelog

All notable changes to SWAO are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and SWAO adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.2.1] - 2026-09-24

Patch release: Docker CI binary-wrap approach + 11 bug fixes (sprint-140).

### Fixed

- Docker image publish: pnpm workspace install no-op in Docker resolved by
  binary-wrap approach -- pkg binary copied directly into debian:bookworm-slim
- `swao assess --type landing-zone-catalog` silently ran wrong assessment type (#2591)
- GCP LZ catalogue Zod crash on regions with `area` field (#2850)
- OpenRouter `~google/gemini-flash-latest` alias resolves to invalid model (#2863)
- `swao diff` shows `unknown` provider and false "Provider changed" warning (#2864)
- MCP welcome string used hardcoded sprint-tagged version (#2718)
- `CHALLENGE_ALIAS_MAP` not applied in `handleReadChallenge` (#2720)
- Enterprise tier gate missing before MCP server start (#2725)
- `SWAO_BIN_RE` regex did not match tier-named Unix release binaries (#2713)
- LZ catalog HTML publication missing verdict sections -- #2434 regression (#2592)
- `findings.yaml` always written as empty array (#2674)
- `swao init` did not persist default workspace path for MCP (#2719)

### Changed

- Docker images now use binary-wrap approach (arm64 images use native linux-arm64 binary)
- GHA actions upgraded to Node.js 24-compatible versions (#2851, #2865)

---

## [1.2.0] - 2026-09-22

Minor release: 22 community frameworks, EU AI Act + SecNumCloud + EC CSF, VitePress
documentation, framework test suite, Dynamic Vision Intelligence, MCP file access
(sprints 135-139).

### Added

- EU AI Act framework (37 controls, RC/HR/TR/GP parts, conditional applicability)
  (#0441, sprint-139).
- SecNumCloud v3.2 framework (65 controls, 19 ANSSI chapters, [lz, aud] scope)
  (#0425, sprint-139).
- EC Cloud Sovereignty Framework v1.2.1 (40 controls, 8 SOV domains, SEAL maturity)
  (#2847, sprint-139).
- EUCS deepened to 66 controls across 12 domains at Basic/Substantial/High assurance
  levels (#2803, sprint-138).
- ISO 27001:2022 deepened to 93 controls (4 themes, 11 new 2022 controls, 14
  csp_inherited physical controls) (#2807, sprint-138).
- SOC 2 deepened to 64 controls (5 TSC categories) (#2808, sprint-138).
- DORA deepened to 31 controls (5 pillars) (#2801, sprint-138).
- KRITIS-DE framework (40 controls, 7 domains, BSIG §8a obligations) (#2802).
- NIS2 framework (46 controls, Art. 21 measures + Art. 23 incident reporting) (#2804).
- EU CRA framework (35 controls, Annex I/II, mandatory SBOM, Art. 14 reporting) (#2804).
- OpenSSF Security Scorecard framework (17 controls, weighted mode) (#2805).
- Community frameworks test suite: 124 tests (A1-A6 structural + registry + round-trip)
  (#1332, sprint-139).
- VitePress: 11 community framework reference pages and "Community Frameworks" sidebar
  section (#2845, sprint-139).
- YouTube Quick Start embed in quick-start.md (#2846, sprint-139).
- Dynamic vision pass: `DYN-VIS-<screen>-<N>` signals from LLM screenshot analysis
  (#2814, sprint-136).
- MCP tools `swao_read_file` and `swao_list_directory` for LLM workspace file access
  (#2792, sprint-136).
- `vision_max_screens` config key; SetupWizard Playwright step (#2815, sprint-136).
- GCP and OCI Middle East lz-catalog regions (#2799 #2800, sprint-136).

### Changed

- EUCS `multi_domain_axes: true` in regime_meta; gdpr-demo ART44 tag corrected (#1564).
- Community framework count: 14 -> 22.
- SWAO Chat session init primes LLM context via `swao_list_directory` +
  `swao_read_file` (#2792, sprint-136).

### Security

- `@nestjs/core`, `@nestjs/common`, `@angular/core` bumped in ghostfolio test fixture
  to clear Dependabot alerts #143-#145 (#2844, sprint-139).
- `fast-uri` 3.x -> 4.1.5 (BDSA-2026-32596) (#2790, sprint-135).
- `fastify` -> 5.12.5 (CVE-2026-76169/84428/84469/84504) (#2790, sprint-135).
- `liquidjs` override -> >=10.29.0 (CVE-2026-61556/69222) (#2790, sprint-135).

---

## [1.1.0] - 2026-09-17

Minor release: SWAO Chat, Enterprise-gated multi-turn portfolio chat.

### Added

- `swao chat` CLI command: interactive multi-turn LLM conversation about portfolio
  assessment results (#2779). Enterprise licence required; blocks at runtime for
  Community and Consultant tiers via `LicenseGuard.requireTier('enterprise')`.
- ChatScreen TUI (#2780): Ink-based terminal chat interface with spinner animation,
  conversation history display, input field, MCP availability badge, and token counter.
  Accessible from Tools menu (key 9, then key 6).
- `useChatSession` React hook (#2781, #2782): state machine (init -> mcp-probe ->
  mcp-tools -> ready <-> thinking), MCP auto-start via `swao mcp --http`, graceful
  degradation when MCP server is unavailable (falls back to generic system prompt).
- Chat history persistence (#2782): each turn appended as NDJSON to
  `wsp/chat/<sessionTs>.ndjson`; token budget guard warns at 80% of connector
  `defaults.max_tokens` (default 8192).
- MCP HTTP context fetching: probes localhost:3737 and calls five tools
  (`swao_workspace_inventory`, `swao_hub`, `swao_signals`, `swao_risks`,
  `swao_lz_fit`) to build a portfolio context string for the LLM system prompt.
- `[Enterprise]` badge in Tools menu for chat entry when Enterprise licence is absent.
- `swao chat` and `ChatScreen` entries added to CLI/TUI parity gate (#2778).

### Changed

- Tools menu key 6 reassigned from Help to Chat; Help moved to key 7.
- Design 011 status updated to Delivered; version references corrected to v1.1.0.
- Design 100 status updated to Delivered (BA PoC seed shipped; native implementation
  delivered in this release).

### Security

- `fast-uri` upgraded from 3.1.0 (3.x branch) to 4.1.5: resolves BDSA-2026-32596
  (MEDIUM). Root cause: a conflicting npm-style `overrides` block in
  `packages/swao/package.json` was silently pinning the 3.x branch despite the
  pnpm-workspace.yaml override targeting 4.x. The stale overrides block has been
  removed; `pnpm-workspace.yaml` is now the single source of truth (#2790).
- `fastify` upgraded from 5.12.1 to 5.12.5: resolves CVE-2026-76169,
  CVE-2026-84428, CVE-2026-84469, CVE-2026-84504 (HIGH), CVE-2026-16732,
  CVE-2026-18504 (MEDIUM). pnpm-workspace.yaml override raised to `>=5.12.4`
  (#2790).
- `liquidjs` override raised to `>=10.29.0`: resolves CVE-2026-61556,
  CVE-2026-69222 (HIGH) defensively. LiquidJS is not a direct dependency in the
  current release but is an indirect transitive risk; the guard is retained for
  future package additions (#2790).

### Triaged (no action required)

- `qs` already at 6.16.0 (CVE-2026-82417/82562 -- not affected)
- `nanoid` already at 6.0.1 (CVE-2026-73086 -- not affected)
- `@xmldom/xmldom` already at 0.9.12; alert showed net-zero vulnerability delta
- `browserslist`, `postcss-selector-parser` -- not installed in current tree
- `next.js` 16.2.3 -- Black Duck false positive; SWAO does not use Next.js

---

## [1.0.2] - 2026-09-17

Patch release: SC-001 BA PREME PoC client-site bug fixes.

### Fixed

- TUI assessment type menu displayed `--type lz-catalog` (invalid alias); corrected to
  `--type landing-zone-catalog` (#2754).
- Health-check TUI showed "No probes detected" alongside "All probes passed" for empty
  probe output; contradictory summary suppressed when zero probes parsed (#2744).
- LLM gateway live ping misclassified HTTP 503 as "endpoint unreachable" when the
  open-llm-provider retry back-off (3 s + 6 s + 12 s) exceeded the previous 20 s
  ping timeout; timeout raised to 35 s and 503 classifier added (#2751).
- `swao health-check` false-warned "no LLM configured" when a gateway connector was
  the active provider (not a direct LLM type) (#2752).
- Connector schema rejected `meta.source: workspace` preventing workspace-seeded
  connector definitions from loading (#2747).
- Setup wizard hid the Open LLM Provider option when gateway connectors were present,
  blocking PREME GenAI Hub configuration via wizard (#2742).
- Assessment limit defaults in all licence tiers removed; all tiers are now unlimited
  per the v1.0 tier model (#2741).
- YAML indentation mismatch in primary block rewrite corrupted `.swao.yml` after wizard
  reconfiguration (#2746).
- Corporate proxy support: `git_proxy` and `ssl_verify` fields added to VCS provider
  configuration (#2749).
- Enterprise binary PKI: enterprise internal CA certificates now trusted in pkg-bundled
  binary (#2748).
- Missing git binary now detected with a clear hint to install the portable Git
  distribution (#2750).
- `lz-catalog` assessment type now reads `.swao.yml` LZ region configuration correctly
  instead of falling back to defaults (#2755).

---

## [1.0.1] - 2026-09-06

Patch release: obfuscated binary startup hang.

### Fixed

- Consultant and Enterprise binaries hung indefinitely on startup with no
  output. `selfDefending: true` and `controlFlowFlattening: true` in
  `scripts/obfuscate.mjs` were incompatible with `@yao-pkg/pkg`'s module
  loader. Both options disabled; stringArray encoding and identifier renaming
  remain active.

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

