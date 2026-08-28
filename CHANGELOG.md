# Changelog

All notable changes to SWAO are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and SWAO adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.12.0] -- 2026-08-28

### Summary

Sprint-128 distribution security: Docker multi-tier image strategy (ADR-0056-0058),
pre-build obfuscation for Consultant/Enterprise binaries, premium package extraction to
swao-premium/ with community-source-isolation gate, TUI tier badge UX replacing [coming soon]
labels, all four go-live legal gates closed, @swao/module-iac-scan rename, Windows
grandchild PID leak fix (spawnSync + file-backed stdio + treeKillSync), and VitePress
hygiene (health-check runbook, install guide, content QA). 72pt shipped; 30pt deferred to
sprint-129 (public release infra, content scrubbing, community infrastructure, CodeQL).

### Added

- Docker multi-tier CI: Consultant, Enterprise, and Community images built from correct
  tier entry points with SWAO_BINARY_TIER set (#2125-#2130, ADR-0056-0058).
- Pre-build obfuscation scripts for Consultant and Enterprise bundles; wired into
  release-consultant + release-enterprise CI (#2131, ADR-0057).
- community-source-isolation gate (`community-source-isolation.gate.mjs`) verifies no
  premium package imports in Community bundle (#2134).
- TUI main menu tier badges: `[Enterprise]`, `[Consultant]`, `[Community+]` replace
  `[coming soon]` labels; LicenseGate blocks navigation at parse time (#2150).

### Changed

- Premium packages (`@swao/module-challenge`, `@swao/module-html-portal`,
  `@swao/module-portfolio`, `@swao/module-llm-assessment`, `@swao/module-powerbi`)
  extracted to swao-premium/ (private) with Robocopy sync exclusions updated (#2132-#2133,
  ADR-0058).
- `@swao/module-iac` renamed to `@swao/module-iac-scan` to reserve the `module-iac`
  namespace for future write modules (#2153).
- VitePress health-check runbook renamed to `health-check-output.md`; install guide
  corrected; content QA pass aligns all docs with v0.11.x (#2135-#2137).
- All four go-live legal gates closed: OSS approval, COBIT 5 licence, meshcloud SLA,
  pnpm licence audit (#2152).

### Fixed

- Windows grandchild PID leak: `spawnSync` with pipe stdio blocks indefinitely when
  grandchildren (Playwright, git, node) hold inherited write-ends. Replaced with
  file-backed stdio FDs and `treeKillSync` (`taskkill /T /F`) after each call; applied
  in binary-e2e.test.ts, MCP server.ts, and MCP smoke tests (#2011, sprint-128).
- `swao publish --edit --help` on Community exits 0 with help text instead of tier-gate
  error 2; fixed with parse-time `.on('option:edit', ...)` handler (#2040).
- `assess --workspace <path>` writes `portfolio-events` NDJSON to CWD instead of
  workspace; fixed by calling `setWorkspaceRoot(workspaceRoot)` before first
  `logPortfolio` emission (#2155).

---

## [0.11.2] -- 2026-08-24

### Summary

Sprint-124 UAT fixes: 7 PDF/TUI bugs found during v0.11.0 UAT (#2022-#2029) -- LZ report
Control ID orphan, LLM report Group score orphan, 10000% parse rate display, Stakeholder
Challenge header cascade, LZ Catalogue Update pkg spawn crash, Ingest screen auto-discovery.
SWAO_VERSION now derived from package.json at runtime (single source of truth).

### Fixed

- PDF LZ report: "Control ID" column header orphaned on new page after a target heading draws
  near the page bottom; LZ page break guard raised 40 -> 100 pt (#2024).
- PDF LLM report: "Group score" row stranded alone at page bottom; last-row guard raised
  20 -> 160 pt to clear downstream section guards (#2025).
- PDF LLM report: `parse_valid_rate` and `schema_conform_rate` displayed as 10000%;
  new `llmFmtPct100()` helper handles 0-100 scale; `parseFail` threshold corrected (#2026).
- PDF LLM report: Stakeholder Challenge column headers cascaded diagonally; captured `chdrY`
  before loop so all columns share the same baseline Y (#2027).
- TUI LZ Catalogue Update crash "Cannot find module '<cwd>/lz'" in pkg binary; set
  `PKG_EXECPATH: ''` in spawn env to suppress pkg spawn-patch (#2028).
- TUI Ingest screen: "No --app specified" error when no `appId` prop passed; added
  `discoverIngestApp()` auto-discovery reading `apps/*/ingestion/` (#2029).
- TUI main menu: Portfolio Operations item missing disabled flag and "coming soon" label;
  item 7 now renders greyed-out with tooltip (#2022).

### Refactored

- `branding.ts` derives `SWAO_VERSION` from `packages/swao/package.json` at runtime via
  `createRequire`; `bump-version.mjs` now updates only `package.json` (+ manifest.yaml).

---

## [0.11.1] -- 2026-08-24

### Summary

Sprint-123 UAT overnight fix session: 7 LLM Assessment bug fixes (heartbeat gap, Anthropic
dual-logging, leg challenge leg_id correlation, workspace clone mass-replay, token ceiling,
terminated-stream retry, zero-output-tokens retry) plus CodeQL #84 polynomial ReDoS
remediation and Black Duck nanoid CVE-2026-67213/67214 remediation.

### Fixed

- Heartbeat gap of 5 min at leg startup: orchestrator now emits `leg.start` and
  `leg.heartbeat` to app-events every 30 s from the first call (#2001).
- Anthropic leg invisible to app-events: `AnthropicLlmProvider` dual-logs via `logApp`
  when `appId` is set; factory and gateway both forward appId (#2002).
- Leg challenge events missing `leg_id` correlation: challenge event context now carries
  `{ leg_id }` (#2003).
- Mass app-events replay (52 MB growth per poll cycle): `cloneLegWorkspace` cleans up
  excluded directories post-copy; `relayLegProviderEvents` filters by timestamp (#2004).
- Pass-04-ctx false DNF on 8397 tokens: `recording-provider` uses `deps.maxTokens` as
  the ceiling; default raised from 8192 to 32768 (#2015).
- `terminated` stream error not retried: `isRetryable()` extended for
  `err.message === 'terminated'` (undici mid-stream close) (#2016).
- Zero output_tokens on HTTP 200 SSE: guard added; `isRetryable()` extended for
  zero-output-tokens case (#2019).

### Security

- CodeQL #84 polynomial ReDoS (`js/polynomial-redos`): nested quantifier
  `(?:-[a-z0-9]+)*` flattened to `[a-z0-9-]*` in `alias-resolver.ts`.
- nanoid override tightened to `>=3.3.18`; lockfile resolves 6.0.1 (CVE-2026-67213 /
  CVE-2026-67214, HIGH).

---

## [0.11.0] -- 2026-08-19

### Summary

Sprint-121 go-live QA: LZ catalogue service-dep coverage probe (15th health-check probe);
GuidanceBox always visible from assessment start (#1676); CTX pass token-ceiling truncation
detection with structured error logging and assess.log audit trail (#1677); HTML report
separates assessed certifications from CSP-declared certifications (#1615); LLM assessment
leg provider events relayed to main workspace log (#1797); call artefacts preserved from
temp leg workspaces (#1795); portfolio-level events for challenge and LZ assessment
(#1793 #1794); LLM Assessment keyboard freeze resolved via saving sub-stage (#1673).

### Added

- `[15/15] LZ catalogue coverage` health-check probe: reads all provider JSON catalogues,
  checks each region's services' fulfills[] against 4 baseline codes plus sovereignty
  alternatives (#1698).

### Fixed

- AssessScreen.tsx: GuidanceBox always shown from assessment start, not only after first
  pass begins (#1676).
- CTX pass JSON parse failure now logs structured `ctx.pass.json-parse-error` event to
  portfolio-events NDJSON; fatal pass failures write `assess.log` to run directory (#1677).
- HTML report: Provider Catalogue Details splits certifications into "assessed frameworks"
  and "CSP-Declared (not assessed)" sections; no unfiltered certifications mixed with
  assessment verdicts (#1615).
- LLM Assessment `provider.llm.*` events from leg workspaces relayed to main workspace
  app-scope log with `leg_id` context (#1797).
- Leg `call-N.json` artefacts copied from temp workspace to `runDir/calls/<legSlug>/passes/`
  before temp workspace deletion (#1795).
- `challenge.start` / `challenge.complete` events added to portfolio-scope log (#1793).
- `lz.assessment.start/provider.start/provider.complete/complete` events added to
  portfolio-scope log (#1794).
- LLM Assessment keyboard freeze on assessment completion resolved: new `saving` sub-stage
  gives Ink one event-loop tick before transitioning to `done` (#1673).
- TUI legCallLines dimColor text changed from cyan to white for readability (#1796).

## [0.10.9] -- 2026-08-17

### Summary

Sprint-119 QA batch: community framework seeding on wizard-init workspaces; PDF challenge
section page-break guard uses heightOfString pre-computation; duplicate lz assessment events
removed; LLM assessment permanent 404 model gate; community_frameworks health-check probe
rename; SBOM pass reads external XLSX/CSV and CycloneDX inputs; LLM challenge pass reuses
main-workspace combined.yaml.

### Fixed

- `scaffoldCatalogs()` guard changed from `.swao.yml` existence check to community-framework
  presence check, so SetupWizard-created workspaces receive DEMO framework seeding (#1777).
- PDF challenge section pre-computes block height via `heightOfString` before rendering each
  finding, preventing orphaned IDs at PDFKit auto-page boundaries (#1781).
- `lz.assess.start` / `lz.assess.complete` NDJSON events emitted only by CLI subprocess;
  TUI-side duplicate emissions in AssessScreen.tsx removed (#1782).
- LLM assessment screen blocks progression when model health-check returns a permanent 4xx
  (non-429) error, surfacing a descriptive message instead of silently continuing (#1783).
- `compliance_catalogues` health-check probe renamed to `community_frameworks` in all
  output formats and JSON/YAML keys; Setup Wizard suppresses it via SWAO_HC_SKIP_PROBES
  (#1780).
- `pass-05-sbom` now reads SBOM-*.xlsx.*.csv, *.sbom.csv, and *.cdx.json from
  `wsp/inputs/compliance/` in addition to package.json files (#1778).
- LLM challenge pass copies main-workspace `combined.yaml` to each leg workspace so
  `challengePassGroups` in publication-model.json is populated without a re-run (#1774).
- Security alert gate soft-passes on GitHub API 5xx server errors (transient outage).

### Closed without code change

- #1770: PDF header shows ACN-DEMO -- accepted for this engagement.
- #1776: support-bundle v2.1 -- already implemented in sprint-119.

## [0.10.8] -- 2026-08-16

### Summary

Sprint-119: stakeholder challenge metrics in LLM Assessment PDF and HTML, static-analysis
gate for challenge call sites, metric catalogue v1.2.0, secondary LLM provider step in
Setup Wizard with LLM Assessment suggestion (#1708 #1768).

### Added

- `METRIC_CATALOGUE_VERSION` bumped to `1.2.0`; new `challenge` dimension group with three
  metrics: `ch.calls` (dialogue turns, neutral), `ch.dnf` (incomplete, lower-is-better),
  `ch.duration_ms` (wall-clock time, lower-is-better). Calls/DNF/latency only per Q3
  decision; LLM-graded quality scoring deferred to sprint-120 (#1708).
- `buildChallengePassGroups()` in `@swao/module-llm-assessment/pass-groups`: converts
  per-leg challenge results into C1-namespace `PassGroup[]` entries; null-fills scored
  fields not applicable to challenge (#1708).
- LLM Assessment orchestrator now collects per-leg `ChallengePassResult` and writes
  `challengePassGroups` into `comparison/publication-model.json` (#1708).
- PDF report: "Stakeholder Challenge Results" section before Findings; per-agent rows with
  calls/dnf/latency per model column; red highlight when `dnf > 0` (#1708).
- HTML publication: C1- challenge chip rows appended to the per-pass table in
  `renderLlmPassTable`; "Stakeholder Challenge (C1)" separator row; badge-style chips (#1708).
- `call-site-registry.test.ts`: static-analysis gate that pins the 4 `.complete(` call
  sites in `module-challenge/src/challenge.ts` (Design 092 s3.4 Q5) -- fails on addition
  of new call sites until the registry is updated (#1708).
- Setup Wizard: new `llm-secondary` sub-step between LLM and Credentials; Y/N prompt to
  add a secondary LLM provider; if yes, reuses full connector/model picker; writes
  `providers.llm.secondary` block to `.swao.yml` (#1768).
- `suggestSecondaryConnector()`: reads the latest LLM Assessment `publication-model.json`
  and suggests the top-ranked non-primary connector as the secondary provider (#1768).

### Fixed

- `LlmPubData` and `LlmPdfArgs` interfaces extended with `challengePassGroups?` optional
  field; propagated through extractor and report command (#1708).

## [0.10.7] -- 2026-08-14

### Summary

Sprint-118 E2E QA batch: TUI text/screen fixes, health-check probe correctness, LZ PDF
table rendering, LLM connectivity failover with secondary provider fallback, partial-assessment
tracking (passes_failed manifest field, exit code 2 on mandatory-pass failure), LZ lifecycle
events with per-target verdicts, LLM prompt trace written per-pass to workspace (#1709),
stakeholder challenge hook in LLM Assessment orchestrator (#1708 partial), and HTML
publication performance fix (#1711).

### Added

- LLM prompt traces written per-pass to `wsp/runs/<ts>/llm-traces/<N>-<pass>-call-1.json`
  for App Assessment; `<sinkBase>/traces/` for LLM Assessment legs. Post-redaction only --
  `[REDACTED...]` markers in place of secrets. `.gitignore` pattern `llm-traces/` added by
  `swao init` (#1709).
- `UsageTrackingLlmProvider.getFirstTrace()` captures the first-call trace per pass for
  loop-heavy passes (11-comp, 12-blocks). `LlmTrace` interface exported from
  `@swao/module-llm-providers` (#1709).
- `OrchestratorDeps.spawnChallenge?` optional hook in LLM Assessment orchestrator; invoked
  per leg after assessment, before WSP discard. `ChallengePassResult` interface exported.
  Challenge results written to `<runDir>/calls/<legId>/challenge-results.json` (#1708).
- `passes_failed` array added to `RunManifest` schema (v1.5, additive). Records passes that
  degraded due to connectivity or provider error; absent when all passes complete normally
  (#1702).
- Secondary LLM provider fallback: when primary connector exhausts retries on connectivity
  failure, `assess.ts` reads `providers.llm.secondary` and reattempts the pass.
  `provider.llm.leg-failover` event emitted (#1703).
- `lz.assess.start` and `lz.assess.complete` lifecycle events emitted on every LZ Catalog
  Assessment run; `complete` context includes `overall_verdict` and `targets` array with
  per-target verdict and gap count (#1704).

### Fixed

- TUI WorkspaceReadyScreen: concatenation glitch in status message text (#1700).
- Health-check: traceability probe absent despite WSP present -- probe now runs correctly
  when WSP directory exists (#1701).
- Health-check: probe counter denominator wrong for first 13 probes; denominator now
  reflects actual probe count (#1705).
- GenerateReportScreen header: report type label was absent -- now shows "PDF Report" /
  "HTML Publication" context (#1706).
- LZ PDF report table: row word-wrap and page-break corruption fixed (#1707).
- PublishScreen: showed filesystem path instead of report type label (#1710).
- Stakeholder persona naming inconsistency across TUI and output files resolved (#1712).
- App Assessment HTML publication performance: history run scan capped at 20 runs, newest-
  first; pass YAML reads replaced with `manifest.total_signals_emitted`; reduces publication
  time from ~3 minutes to under 30 seconds for workspaces with many prior runs (#1711).
- Exit code 2 returned when mandatory passes (11-comp, 12-blocks) are absent due to LLM
  connectivity failure; exit 0 retained when only optional passes degrade (#1702).

---

## [0.10.6] -- 2026-08-11

### Summary

Sprint-117 E2E QA batch 2: spawn-bug fixes (PKG binary self-spawn in IngestScreen,
LzCatalogueUpdateScreen, ChallengeScreen, PublishScreen), TUI breadcrumb (Header
contextPrefix for App/LZ/LLM assessment flows), GuidanceBox improvements (tier
descriptions corrected, LLM running text overflow fixed), LLM publish NDJSON events
(publish.start/ok/complete/error), LZ demo framework leak fix, timestamp normalisation
for publish path resolution, and PDF page break suppression before Model Comparison Matrix.

### Added

- Header contextPrefix: assessment-type breadcrumb prefix ("Application Assessment - <Screen>",
  "LZ Assessment - <Screen>", "LLM Assessment - <Screen>") rendered in all assessment
  sub-screen headers; deduplication guard prevents double prefix (#1602).
- HTML publish pipeline emits structured NDJSON events: publish.start, publish.ok,
  publish.complete, publish.error for all publication types (app, lz, llm, hub) (#1609).
- LLM Assessment sub-screen stage-specific subtitles in header (Select Application,
  Select LLM Providers, Running, Complete, etc.) (#1602).

### Fixed

- PKG binary self-spawn fixed in IngestScreen, LzCatalogueUpdateScreen, ChallengeScreen,
  and PublishScreen: IS_PKG guard omits process.argv[1] from spawn args when running
  inside a PKG binary, preventing snapshot-path injection (#1620).
- LLM publish path mismatch: runTs ISO timestamp (colons/Z suffix) normalised to
  filesystem format (hyphens) before directory lookup in llm-extractor.ts (#1613).
- _DEMO framework leak: bundled _DEMO frameworks absent from workspace community
  directory are filtered after the workspace merge in run-lz.ts (#1601 #1614).
- Workspace LZ catalogue licence gate removed: Community tier now reads workspace
  LZ catalogues; gate restricted catalogue overlay unnecessarily (#1614).
- MultiSelect selected-not-focused item colour: cyan label shown for selected items
  regardless of cursor position (#1603).
- ChallengeScreen progress bar shows 1/N on first dispatch instead of 0/N (#1606 #1616).
- open-llm-provider throws LlmConnectivityError on exhausted transient retries so
  assess.ts degrades the pass gracefully instead of exiting (#1617).
- GuidanceBox: LLM Assessment running stage "what" text shortened to prevent layout
  overflow and text garbling on narrow terminals (#1607).
- GuidanceBox: LicenseScreen tier descriptions corrected -- Community includes all
  LLM adapters; descriptions aligned with docs/strategy/015-licensing-strategy.md (#1624).
- PDF page break suppressed before Model Comparison Matrix section (#1619).

---

## [0.10.5] -- 2026-08-11

### Summary

Sprint-117 QA batch: hono security bump, LZ report correctness and UX improvements
(collapsible providers, Service Intelligence Matrix, evidence gallery), TUI fixes
(GuidanceBox detail overflow, progress bar, stable key on running phase), LZ
catalogue provenance and bundled framework discovery, support bundle v2.0 with 8
new diagnostic artefact categories.

### Added

- Support bundle v2.0: workspace-config.json, health-check.json, workspace-structure.json,
  run-manifests.json, extended environment.json (swao_env_vars/runtime_mode/cwd_depth/node_env),
  licence-state.json, lz-catalogue-meta.json, error-context.json message_redacted;
  SupportBundleScreen confirm shows resolved path, done highlights path in GuidanceBox;
  bundle_version bumped to 2.0 (#1599).
- LZ framework picker: bundled binary frameworks discovered alongside workspace
  community frameworks; workspace overrides bundled by ID (#1584).

### Fixed

- hono bumped to >=4.13.1 via pnpm-workspace.yaml override (#1579).
- LZ report: collapsible providers, Service Intelligence Matrix, evidence gallery,
  LLM dimension column width (#1588 #1592 #1594 #1595).
- LZ report: verdict label corrections, compliance regime filtering, recommended
  actions (#1589 #1590 #1591 #1593).
- TUI GuidanceBox: detail overflow -- one entry per line, truncation indicator,
  maxRows applied to count not chars (#1580).
- LLM Assessment TUI: minimum progress at run start; stable GuidanceBox key during
  legCallLines updates (#1585 #1586).
- LZ catalogue: aws-service-meta.json excluded from provider enumeration (#1581).
- Pass 04 CTX scope fix; MAL signal prefix; LLM route; Tools menu order (#1582
  #1583 #1596 #1597 #1598).

---

## [0.10.4] -- 2026-08-10

### Summary

Sprint-116 RC-1 post-merge QA fixes: LZ framework picker reads workspace
catalogues only; CTX pass skips llm-gateway directory; LLM comparison table
shows FAILED badge for failed legs; publication CSS dark-theme variables; HTML
publication engagement header conditional rendering; Publish TUI menu consolidated
to two modes; PDF report footer context corrected.

### Fixed

- LZ framework picker: reads workspace `wsp/inputs/catalogs/community/` only;
  bundled binary frameworks are no longer surfaced in the TUI gate selector (#1552).
- CTX pass: skips `llm-gateway/` subdirectory when scanning `wsp/inputs/` to
  avoid exhausting the prompt token budget on connector YAML files (#1554).
- LLM comparison table: legs with `leg-failed` finding show "FAILED" badge and
  "--" rank instead of a numeric score (#1557).
- Open-LLM provider: improved error message for empty `choices[0].message.content`
  with hint distinguishing 0-token vs non-empty token responses (#1541).
- Engagement hub pending pill: tooltip now reads "Publish [type] report to view"
  instead of "Run [type] assessment first" (#1542).
- LLM publication: model-name column header uses `color: var(--text-primary)` so
  names are visible in light theme (#1543).
- LLM publication: findings ID column has `min-width: 48px; white-space: nowrap`
  to prevent truncation (#1544).
- Publication CSS: `--pub-red`, `--pub-red-bg`, `--pub-amber`, `--pub-amber-bg`
  defined in both `:root` and `[data-theme="dark"]` blocks (#1547).
- LZ publication: engagement name, engagement lead, and account executive fields
  render only when populated; scaffold placeholders no longer bleed into output (#1548).
- Publish TUI menu: LLM Assessment entry removed; mode 1 renamed to "Full Assessment
  Report"; mode 2 is HTML Editor; descriptions updated (#1549).
- PDF report screen: Power BI footer hint hidden when PDF generation runs; shows
  alternative HTML publish tip instead (#1551).
- Pass 06 (TF): `findFileRecursive` now skips only hidden directories (`.git`,
  `.node_modules`), not hidden files; `.env.example` is correctly detected,
  restoring TF-01 positive verdict for compliant apps (#1501 follow-up).

### Internal

- Test suite: health-check probe count updated to 14 (`wsp_metadata` probe added
  in sprint-115); `wspMetadataProbe` mock added to unit tests.
- License request email template: GitHub URL added for documentation reference.
- Tracker: issues #1535-#1540 renumbered to #1552-#1557 to avoid conflicts with
  previously-closed sprint-116 issues in the same range.
- Test suite: `cli-tui-parity` gates updated for `support-bundle` command and
  `SupportBundleScreen` (sprint-116 addition); scaffold tests updated to filter
  community-only entries in `copiedFiles` after LZ catalogue scaffolding was added.

---

## [0.10.3] -- 2026-08-10

### Summary

Sprint-117 S2+S3: PostCSS CVE-2026-69153 remediation (bump to 8.5.26) and
combined App/LZ/LLM HTML report (`swao publish --combined`, #1473, Design 092 s15).

### Added

- `swao publish --combined`: single self-contained tabbed HTML report combining
  App Assessment, Landing Zone, and LLM Assessment publications into one file
  (#1473). Reads existing `latest-*.html` pointer files; missing sections render
  as instructional placeholders. Writes `latest-combined.html` pointer and updates
  sibling type-nav bars. Available on all tiers.

### Security

- PostCSS bumped to 8.5.26 via `pnpm-workspace.yaml` override (#1533):
  remediates CVE-2026-69153 (MEDIUM; affected 8.5.14-8.5.25).
  js-yaml 4.0.9 confirmed below the BDSA-2026-21640 vulnerable floor (>=4.1.1) --
  no change required.

---

## [0.10.2] -- 2026-08-10

### Summary

Sprint-116 RC-1 QA sweep: 49 issues fixed across LLM Assessment, LZ verdict
logic, static analysis pass scoping, scaffold/init hardening, Export BI LZ
tables, TUI/UX, and HTML publication. New: support-bundle CLI + TUI tool,
LLM Assessment per-call progress display, LLM Assessment PDF report model
comparison matrix, compliance evidence ID traceability.

### Added

- `swao support-bundle` CLI + TUI Tools menu entry (key 6) (#1515):
  PII-free diagnostic bundle (event trace, error context, environment) for
  support hand-off; output to `wsp/support-diag/<timestamp>.tar.gz`.
- LLM Assessment per-call progress display (#1477): polls active leg
  app-scope event log every 1.5s; renders pass ID, call number, latency,
  retry status below the leg progress bar.
- LLM Assessment PDF report -- model comparison matrix (#1531):
  `swao report --type llm --format pdf`; five metric groups; pass-level
  breakdown; findings section; Consultant+ tier gated.
- Compliance evidence traceability (#1507): `resolveEvidenceIds` in the
  compliance evaluator maps each control finding to originating signal IDs.

### Fixed

- Sprint-116 QA sweep (#1484-#1532): LLM CTX pass prompt-size guard;
  progress bar zero during first leg (#1476); LZ verdict logic corrections;
  static analysis pass scope guards; Export BI LZ dimension tables; scaffold
  content hardening; TUI guidance-box and menu UX; HTML publication
  single-file fixes; licence flow edge cases.

## [0.10.1] -- 2026-08-09

### Summary

Sprint-115: LLM Assessment security dimension, HTML publication quality pass,
security dependency remediation. Security weight promoted from informational
(weight=0) to configurable (default 0.1). LLM comparison matrix now fully
interactive: collapsible per-pass rows, sticky first column, responsive
provider grid, group colour shading. 22 Dependabot alerts + 1 secret-scanning
alert resolved.

### Added

- TUI credential list in-process scrollable view (#1413): viewport-sized
  CredentialListView; Up/Down/PgUp/PgDn scroll; scroll indicators.
- Multi-publication HTML strategy Option B decision (#1471): design
  recorded in Design 092 s15; implementation issue #1473 filed.
- LLM HTML publication quality pass (#1478): JS expand/collapse for
  per-pass detail rows; sticky first column; CSS Grid provider tiles
  (3-col responsive); group colour shading; column tooltips; security
  dimension weighted (default 0.1, overridable in .swao.yml).
- LLM + Hub HTML quality pass round 4 (#1482): matrix/pass-table columns
  sorted by rank; pass badge links in Per-Pass Results table; header badge
  shows "Assessed N Models"; provider card stats horizontal (`pub-flex-3col-mt`);
  methodology per-dimension explanations; hub tiles as linked pills; Publication
  Links section removed; Workspace Summary moved to top; hub headline is always
  "Engagement Hub"; hub breadcrumb first item "Engagement Hub".
- 7R Verdict row in LLM quality group (#1483): `extractLegVerdict` reads
  `seven_r_label` from the leg workspace `wsp.yaml` after each leg completes;
  `verdicts` map written to `publication-model.json`; rendered as a non-weighted
  badge row at the bottom of the QUALITY section in the Model Comparison Matrix.
- Playwright responsive nav spec (`journey-j6-llm-responsive-nav.spec.ts`):
  verifies `#swao-type-nav` is sticky at 1280/1024/900/768/480px when
  `LLM_PUB_HTML` env var points to an existing HTML publication.
- BlackDuck security alert triage runbook.

### Fixed

- TUI guidance box Enter-to-close + wrap-aware ghost padding (#1412):
  GuidanceBox closes on Enter; wizard screens unguard key.return; ghost-
  padding uses physical-line estimate for long 'what' text.
- Community Docker build CWD (#1408): Dockerfile.community adds
  `cd packages/swao` before build-community.mjs.
- LLM Assessment security passes (#1463): security-pii-redaction,
  security-prompt-injection passes added; GROUP_PROP_DEFS 'security' set.
- LLM publication dark-theme tables + LZ breadcrumb label (#1474).
- resolvePublicationTitle for landing-zone-catalog returns
  'Landing Zone Assessment Report' (consistent with application type).

### Security

- Deleted stale nested lockfile that bypassed workspace overrides (#1479).
- hono bumped to 4.13.1; undici to 8.10.0; brace-expansion to 5.0.9.
- Example license key redacted from docs (secret-scanning alert #2).

## [0.10.0] -- 2026-08-07

### Summary

SWAO LLM Assessment (Design 092, sprint-114): a third Consultant/Enterprise
assessment surface that runs an already-assessed application through 2..5
(connector, model) legs and delivers a dimension-grouped comparison --
relative min/max scoring, per-pass drill-down, findings log, and an
interactive HTML publication with editor support. Includes the assessment-type
menu cleanup (3 real surfaces; audit surface removed), LZ catalogue user
extensibility (copy/new/list-with-origin, workspace override, strict
validation, doctor provenance, run-manifest hashing), and TUI polish.

### Added

- LLM Assessment surface (Design 092, #1417-#1433): leg orchestration
  (serial/parallel, temp workspaces, metric extraction), per-call recording
  decorator, comparability key + llm-assessment manifest, metric catalogue
  with registry + completeness test, comparison engine (relative min/max
  scoring, weighted final result, degenerate-spread guard, property-based
  tests), prompt-size probe (S/M/L/XL synthetic calls), and license tier
  enforcement E2E.
- LLM Assessment TUI flow (#1427): app picker (completed-assessment filter),
  leg picker (priced model picker), cost preview, no-legs graceful screen,
  run-progress view, and error stage.
- LLM Assessment publication (#1428-#1431): dimension-group blocks,
  expandable per-pass segments, interactive table with filters and anomaly
  toggle, full tooltips, HTML editor wiring, and optional LLM-written
  interpretation step.
- LZ catalogue user extensibility (#1436): `swao lz catalogue copy/new/list`
  CLI sub-commands; strict workspace schema validation (named error, no silent
  fallback); TUI screen "Manage LZ Catalogues" under Tools (Community-accessible);
  user guide runbook (adapting-lz-catalogues.md).
- LZ catalogue provenance in doctor and run manifest (#1437): doctor probe
  reports per-provider origin/hash/last_updated; run manifest `lz_catalogues`
  field carries sha256 + origin object per provider.
- ADR-0053 draft: LZ catalogue external distribution open decisions (#1386).

### Changed

- Assessment type menu streamlined to 3 real surfaces (Application /
  Landing Zone / LLM); audit surface removed (#1434 + #1435).
- LZ catalogue resolution order formalised: workspace file >
  installed-store file > bundled binary seed, evaluated per-provider (#1437).
- Tools menu expanded to 6 items; "Manage LZ Catalogues" added as item 4
  (Community+); Ingest moved to 5, Help to 6 (#1436).

### Fixed

- Publish TUI hid coming-soon entries [4-6] for v0.10.0 scope (#1439).
- LLM Assessment Publish cascade error when no runs exist resolved by
  removing double "Error: Error:" prefix from outer catch block (#1440).
- LLM Assessment TUI QA polish (#1451-#1459): "leg" terminology replaced
  with "LLM Provider" throughout; GuidanceBox collapse-width bug fixed;
  custom model input clears per provider; custom option moved to top of list.
- LLM Assessment HTML publication QA polish (#1460-#1470, #1472): inner
  sub-table headers show model short name; exec summary added to ranking;
  methodology restructured into 5 sub-sections; DNF shows green/red badge;
  metric descriptions added; breadcrumbs link to Engagement Hub; two new
  sections (LLM Provider Detail, Pass Deep-Dive); CSS block for matrix layout.
- Engagement Hub: human-readable type labels; auto-regen after LLM publish.
- Model discovery cost fields rounded to 6 sig-figs (float precision fix).

## [0.9.10] -- 2026-08-06

### Summary

SWAO LLM-Gateway (Design 090): LLM connectivity rebuilt as one uniform
connector FILE per platform. Bundled seeds (Anthropic, OpenAI, Ollama,
OpenRouter aggregator, generic vLLM/GenAI-hub), copy/paste/amend
extensibility, wizard discovery with model picker and live per-model
prices, dynamic model discovery with pricing capture, live-ping health
probe, run-manifest connector provenance, and real cost tracking.
Verified E2E against OpenRouter (Gemini + DeepSeek). Backwards
compatible: every pre-gateway .swao.yml and env-var configuration
behaves unchanged.

### Added

- LLM-Gateway connector architecture (#1393-#1399): Zod connector
  schema with secret-shape refusal, precedence-aware loader (workspace
  overrides bundled seeds), three protocol adapters (openai-chat,
  anthropic-messages, ollama), factory gateway resolution, per-connector
  credential-store integration.
- Setup wizard connector dropdown + catalogue model picker with price
  hints; selected connectors materialise into wsp/inputs/llm-gateway/
  for inspection and editing (#1400).
- assess --llm <connector[:model]>; run-manifest llm.gateway provenance
  block (connector id, sha256, origin, protocol, base_url) (#1401).
- Health-check probe 14/14: connector discovery/validation (#1402) plus
  a live connectivity ping of the active connector with actionable
  failure classification -- no credits, bad key, unknown model,
  unreachable endpoint (#1410).
- Dynamic model discovery via connector discovery_endpoint: platform
  model lists with per-million prices merged into the workspace
  connector (curated entries win); assess-time cost resolution uses the
  captured prices (#1405).
- Connector authoring runbook + workspace scaffold template (#1403).
- Grouped credential list: LLM API keys / Playwright per-app triplets
  with missing-part flags / VCS tokens / Other (#1411 Phase 1).
- Local CodeQL scan in the automated suite: scripts/codeql-scan.sh
  pinned to the GitHub default query tier, with a parity audit gate
  (#1407).

### Fixed

- TUI assessments silently ignored the gateway connector and fell back
  to the stored-key legacy provider while the banner said "Gateway:";
  fixed at all three layers (workspace-yaml fallback, child env
  wiring, factory model env) (#1409).
- Secret-shape heuristic rejected the gateway's own refreshed connector
  file: '/' removed from the unbroken-token class so long aggregator
  model ids no longer read as key material (#1414).
- Wizard catalogue refresh persisted only if the operator waited for
  the fetch; the workspace connector write is now decoupled from the
  UI lifecycle.
- Ready-screen LLM label mislabelled gateway selections as "Anthropic".
- health-check could hang for minutes in the vcs-auth probe: the git
  ls-remote grandchild survives the spawnSync timeout on Windows and
  holds the output pipes; replaced with a tree-killing async runner
  plus a 30s probe-wide ceiling (#1415).
- vcs-auth probe no longer sends the legacy catch-all vcs-token to
  arbitrary hosts, never contacts reserved documentation TLDs
  (fixture workspaces), and `credential set` warns when a token key
  receives a URL-shaped value (#1416).

### Documentation

- Design 090 (SWAO LLM-Gateway) -- new.
- Design 091 (LLM platform connection guides) -- new; OpenRouter guide
  verified end-to-end by operator walkthrough.
- Design 063 (LLM benchmark) -- gateway-era update: (connector, model)
  pairs, concurrency guarantees, fan-out mode, Golden Application
  Assessment replay.

## [0.9.9] -- 2026-08-05

### Summary

Sprint-112 QA round 2: 14 issues fixed (#1378-#1384, #1387, #1390, #1391 stage 1, #1082, #1379, #1388), operator-verified against three same-day dev binaries.

### Fixed

- `@swao/publication-render`: LZ Phase 3 audit-coverage now renders in packaged builds -- lz-catalog extractor carries coverage_warning/blocker_category/assessment_mode/sovereignty_active; bundle path candidates added for dist/_lz-catalogues and controls/cloud-provider-catalogue.yaml (#1380).
- `@swao/publication-render`: search overlay renders lzr-* result groups instead of dropping matched docs; lzr results navigate to the rendered LZ section (#1384).
- `@swao/tui-kit`: MultiSelect/SelectInput register one stable useInput listener (double-fire cursor skips fixed) and swallow terminal mouse escape sequences; wheel reports become single-step navigation (#1378, #1387, #1082).
- `@swao/module-health-check`: probe list pages with the pass-picker height budget; middle rows no longer vanish on small windows (#1390).
- `@swao/module-html-report`: `swao publish --run <lz-run>` auto-detects the lz-catalog block profile from run contents (#1383).
- `lz-catalogues`: aws-iso-e sovereignty facts corrected (US-entity operator, us_cloud_act + fisa_702 exposure, unverifiable C5 claim removed, confidence low); azure germanywestcentral C5 normalised to BSI_C5; seed sweep test enforces canonical certification vocabulary (#1381, #1382).

### Added

- Full-text publication search: every substantial rendered section is indexed and searchable via a Page Content result group with anchor navigation (#1388).
- Dynamic LZ sovereignty framework picker: gate-capable frameworks discovered from bundled + workspace framework-meta.yaml (D-LZ-07); workspace-installed gated frameworks appear without a code change (#1379).
- Terminal mouse reporting on picker screens (SGR ?1000/?1006, refcounted, exit-safe restore): mouse wheel scrolls the picker instead of the terminal scrollback (#1391 stage 1).

---
## [0.9.8] -- 2026-08-03

### Summary

Sprint-112 QA bug-fix batch (6 issues #1338 #1340 #1341 #1342 #1343 #1344).

### Fixed

- `@swao/module-challenge`: strip Markdown code fences (` ```yaml `) from LLM YAML output before js-yaml `load()` -- prevents parse failure when model wraps response in a fenced block (#1338).
- `@swao/module-health-check`: `swao doctor` now shows `[13/13] IaC toolchain` probe in text output; `probe_count` updated 12 -> 13; `buildHealthCheckLogContext` includes `iac_toolchain` status; command description updated; audit gate `doctor-probe-list` updated (#1340).
- `@swao/module-app-assessment` pass-06-tf: IaC scanner invocation now emits structured `logPortfolio` events (`pass.iac.scanner.start`, `pass.iac.scanner.complete`, `pass.iac.scanner.skipped`); bare `console.warn` in `@swao/module-iac` provider removed (#1341).
- `@swao/tui-kit` MultiSelect: `useEffect` -> `useLayoutEffect` for scroll-top sync to prevent cursor-invisible frame at scroll-window boundaries; `appLzRegionFilter` added to MultiSelect key in AssessScreen.tsx to force remount on filter change (#1342).
- `@swao/core` `scanFulfills`: strip `@version` and `+capability` qualifiers before `fulfills.includes()` -- prevents false NOT_AVAILABLE verdict when scan data uses base code and WSP requires a qualified code (#1343).
- `@swao/module-landing-zone` `computeLzFit`: emit `VERSION_MISMATCH` and `CAPABILITY_MISSING` verdicts (new LzFitVerdict union members) when base service is available but qualifier requirement is not met, instead of collapsing to `NOT_AVAILABLE_IN_REGION` (#1343).
- `@swao/publication-render` HTML LZ publication: service coverage table now groups rows by (provider, region) with per-group headers; each check item carries `provider`, `region`, and `raw_verdict` through to the renderer; remediation text distinguishes `SOVEREIGNTY_GAP`, `NOT_AVAILABLE_IN_REGION`, `VERSION_MISMATCH`, and `CAPABILITY_MISSING`; each recommendation is prefixed with its LZ identity `[provider / region]` (#1344).

---

## [0.9.7] -- 2026-07-30

### Summary

Sprint-111 design-085 IaC completion + QA sweep + security gate (19 issues #1233 #1235-#1239 #1250 #1275 #1291 #1323-#1331 #1333).

### Added

- `@swao/module-iac` `TerraformOpenTofuProvider.scanSource`: shells out checkov or kics (fallback), normalises JSON/SARIF output to `IaCFinding[]`, graceful degradation when tool absent (design 085 SS9, #1327).
- `buildIaCToolchainProbe` in `@swao/module-health-check`: detects terraform, opentofu, pulumi, checkov, kics on PATH; status `ok`/`warn` only (tools are optional), design 085 OI-05 (#1328).
- LZR semantic version + capability matching: `max_version` field on catalogue entries, `@major` qualifier, `+capability` syntax (e.g. `postgresql@15`, `postgresql+pgaudit`), `regionFulfills` upgraded, design 085 SS6.3 (#1323).
- LZR catalogue Pulumi resource types: `PULUMI_RESOURCE_TYPE_TO_SERVICE_DEP` expanded to 40+ entries covering AWS/Azure/GCP/STACKIT; Pulumi catalogue columns parity with Terraform (#1329).
- CDK for Terraform fixture: validates D-085-07 (cdktf generates standard TFv4 state, parsed by TerraformOpenTofuProvider unchanged, #1330).
- HTML publication for LZ-catalogue assessment type: `LzCatalogueSection`, per-target detail pages, landing navigation stub, multi-target extractor (#1250).
- Canonical SWAO FOSS ASCII header: applied to 510 source files (bulk sweep) + 16 remaining files (#1233).

### Fixed

- Security: postcss 8.5.15 -> 8.5.25 in standalone CLI lockfile (Dependabot #91, #1324).
- Security: CodeQL #75 -- clear-text-logging taint chain broken in `issue-license.mjs` (catch without binding + static die() message, #1325).
- Security: CodeQL #72+#76 -- polynomial ReDoS eliminated in `extractor.ts` (`[^>]*` bounded pattern) and `pass-04-ctx.ts` (fenced-block regex rewrite, #1326).
- WSP `landing_zone.primary` null despite LZ READY: prefer `lzr_run` over synthetic block, null-coalescing chain (#1237).
- STACKIT eu01 Germany not visible in LZ picker: alphabetical region sort + cursor lands on first STACKIT match (#1291).
- CTX pass 60s timeout on large prompts: context truncated at 40k chars before LLM call (#1236).
- COMP regime shows `'evaluated'` when all controls UNKNOWN: `statusToRag` maps UNKNOWN -> `not-assessed`, dynamic `not_assessed_count` (#1239).
- Anthropic retry warnings double-logged: suppress `http-error` log entry for transient 429/529 (already logged at next attempt, #1235).
- `run-manifest.json` missing `items_emitted` field in LZR pass entry (#1238).
- `fetch-azure` 429 rate-limit: `x-ms-retry-after-ms` header fallback added with unit tests (#1275).
- `@swao/module-health-check` `src/doctor/` renamed to `src/health-check/`; module-doctor ghost directory eliminated; stale `module-doctor` comment references purged (#1331).
- 5 stale closed-issue tracker files had incorrect `state: open` frontmatter (#1333).

## [0.9.6] -- 2026-07-29

### Summary

Sprint-110 IaC provider abstraction + security patch batch (22 issues #1301-#1322).

### Added

- `@swao/module-iac` new Consultant-tier package: tool-agnostic `IaCProvider` interface and registry; `TerraformOpenTofuProvider` with 17 resource class detectors (VPS/compute, k8s, object_storage, kms, postgresql, mysql, redis, queue/messaging/event_streaming, nosql_database, load_balancer, container_registry, dns, backup, vpn, serverless_compute, monitoring/audit_logging, networking/firewall); `PulumiProvider` skeleton with file-based state reader; Pulumi Cloud API ingestion (`ingestPulumiStacks`) with mock-server tests (#1301-#1322).
- `swao-yml` `iac.pulumi.stacks` schema block (`SwaoYmlIacSchema`) for Pulumi Cloud API configuration (#1322).
- `IngestPrePassOptions.pulumi` field -- assess pre-pass now calls Pulumi Cloud API when configured in `.swao.yml` (#1322).
- Pass-01 INV: `postgresql@{version}` and `postgresql+pgaudit` service_dep qualifiers extracted from Terraform state for downstream LZR evaluation (#1318).
- Design 085 (`docs/design/085-iac-provider-abstraction-and-agnostic-reader.md`).
- Tracker issue #1323 filed for LZR semantic version/capability matching (backlog).

### Fixed

- Security: brace-expansion bumped to 5.0.8 (CVE), liquidjs to 10.27.1, @fastify/static direct dep to 10.1.2, postcss in docs-site to 8.5.25, find-my-way override to 9.7.0; swao-premium and standalone CLI lockfiles patched (Dependabot alerts #86-#94).

## [0.9.5] -- 2026-07-28

### Summary

Sprint-109 QA bug-fix batch (6 issues #1278-#1281 #1285-#1286) -- MCP Setup Wizard key-scan, restart reminder, Playwright credential wizard, MCP user prompt documentation.

### Fixed

- `patchClaudeDesktopConfig` in SetupWizard.tsx now scans all `mcpServers` entries by binary filename (`SWAO_BIN_RE`) before writing. If an existing swao binary entry is found under any key name (e.g. `swao-mcp`), it is updated in-place rather than adding a duplicate `swao` key. The default key `'swao'` is only used when no existing swao binary entry is found (#1285).
- `ClaudeDesktopStep` no longer advances to the next wizard step immediately after patching. When the result is `patched`, the step now shows a "Restart Claude Desktop to load the new tool registry." message and waits for Enter before advancing (#1286).
- `CredentialScreen` now includes a dedicated Playwright three-key wizard: selecting 'playwright-[app]' triggers a multi-step flow (app ID, URL, username, password) that stores all three vault keys atomically and redirects to the list view on completion (#1281).
- Credential set-value guidance box and set-custom guidance box both include explicit Playwright key naming hints and the correct app URL format to prevent pointing the crawler at the marketing homepage (#1278 mitigation).

### Added

- `mcp-config.ts` -- extracted `patchClaudeDesktopConfig` utility with unit tests (`mcp-config.test.ts`; 6 cases covering key-scan, in-place update, already_present, and error path).
- Design 084 `docs/design/084-mcp-tool-reference-and-user-prompts.md` -- full technical registry of all 44 MCP tools in 9 categories with required/optional parameters, and minimalistic end-user prompt tables for Claude Desktop.
- `swao/docs/getting-started.md` and `swao/docs/assessment-dimension-catalogue.md` updated with MCP connector config and Claude Desktop prompt samples (visible as "Add from SWAO" resources in Claude Desktop).

### Notes

- Issue #1278 (wrong vault URL `playwright-url-sovereign-health` pointing to marketing homepage): data-only fix -- update the vault key value to `https://app.sovereignhealth.io` via Credential Management TUI or `swao credential set playwright-url-sovereign-health <url>`.
- Issue #1279 (DYN signals from marketing site): self-closes after #1278 is corrected and `swao assess` is re-run.

## [0.9.4] -- 2026-07-27

Sprint-108 QA + Dynamic Analysis Phase 2 (35 issues #1240-#1274 + #1275) -- 23 QA regressions closed; DYN-02..08 extraction signals shipped; DEMO-framework labelling, blocker taxonomy, LZR traceability, fabricated-snapshot warning added (Wave 5); Dependabot + CodeQL security gates cleared.

## [0.9.3] -- 2026-07-26

### Summary

Sprint-107 CLI E2E QA Readiness (7 issues #1153-#1158 #1197) + Licensing Consolidation (7 issues #1226-#1232) + Security fixes.

### Fixed

- `swao init`: bundled landing-zone terraform stubs now correctly found inside pkg binary -- `resolveBundledLzStubsDir()` probes a known file (`lz-azure-snapshot.json`) rather than the parent directory; pkg snapshot VFS tracks files, not intermediate directories (#1153).
- Three CodeQL alerts patched: polynomial ReDoS in pass-04-ctx.ts extension regex (alert #72), HTML comment regex in module-html-report server.ts (alert #74), incomplete URL substring sanitisation in scrape-quickbase.mjs (alert #71 / #1197).
- Five high-severity CVEs patched via pnpm overrides: js-yaml, brace-expansion, find-my-way, postcss, @fastify/static; plus two Dependabot alerts for @hono/node-server.
- Community-binary-shape audit gate: retired stale `Helvetica-Bold` marker (false-positive from pdf-parse); replaced with `renderTextReportToPdf`.

### Verified complete (code already in source; tracker issues closed)

- `regime-select --app <id>` writes to app-level `.swao.yml` (#1154).
- `swao init` exits 0 when scaffold already exists; `--force` re-scaffolds (#1155).
- `swao challenge` resolves Anthropic API key from credential vault, not env-var-only (#1156).
- `swao publish --workspace <path>` accepted without prior `cd` (#1157).
- `regime-select` exits 0 when app scaffold exists but `wsp/runs` is absent (#1158).

### Added

- Licensing consolidation: 3-tier model locked (Community / Consultant / Enterprise); COBIT 5 unbundled (D-02); `swao license admin --tier` CLI for offline license generation; `--tier` propagated through enterprise build; PDF report tier-gate moved to Consultant (#1226-#1232).
- URL hostname regression tests (7 cases including spoofed-host rejection) -- `url-hostname-validation.test.ts` (#1197).
- Binary-E2E test: `swao init` scaffolds `wsp/inputs/terraform/` with all 3 LZ snapshot stubs (#1153).

## [0.9.2] -- 2026-07-22

### Summary

Sprint-106 M33 Open LLM Provider (11 issues #1215-#1225) -- generic `open-llm-provider` driver for any OpenAI-compatible endpoint, TEI 1.8 embedding provider, multi-environment config, TUI dropdown, and PreMe-GenAI-Hub reference integration.

### Added

- `open-llm-provider` driver: OpenAI-compatible endpoint with path-prefix routing, Bearer auth, configurable `costPerToken` billing, and 3-retry backoff (#1216).
- `OpenLlmEmbeddingProvider`: TEI 1.8 `/embed` interface for on-prem embedding endpoints (#1217).
- Multi-environment config: `environments` map in `.swao.yml` + `SWAO_LLM_ENV` environment variable for run-time environment selection (#1218).
- `open-llm-provider` in TUI SetupWizard dropdown; Bearer token stored securely in the credential store (#1223).
- `preme.ts`: PreMe-GenAI-Hub environment presets (not exported from module index) (#1224).

### Changed

- `LlmProviderName` union extended with `'open-llm-provider'` (#1215).
- `ollama.ts`: `costPerToken` config wiring aligned with new provider pattern (#1219).
- `connection-string-parser`: `open-llm-provider:` prefix added; unrecognised HTTPS strings default to `'open-llm-provider'` (#1220).

### Tests

- `open-llm-provider.test.ts` + embedding tests + HTTP cassette fixture; regression gate; v0.9.2 release prep (#1221 #1222 #1225).

## [0.9.1] -- 2026-07-22

### Summary

Sprint-105 MCP QA Fixes + Security Dependency Updates (16 issues #1199-#1214).

### Added

- `swao_workspace_inventory` MCP tool: rich folder/file state surface covering workspace layout, app list, ingestion paths, run history, and context file counts (#1214).
- MCP_BUILD_ID injected into the MCP welcome screen message for at-a-glance version verification (#1213 part).
- `pnpm audit` pre-push hook gate (high-severity CVEs caught locally before reaching GitHub -- #1209).
- Multi-workspace enterprise portfolio analysis design spec (Design 081 -- #1204).

### Changed

- `swao_health_check` output reworded: all "Doctor" terminology replaced with "Health Check" for consistent naming (#1210).
- Framework MCP tools (`swao_list_frameworks`, `swao_get_framework`) extended with alias vocabulary so Claude maps "community frameworks", "regulatory frameworks", and "assessment frameworks" to the correct tool (#1199 #1200).
- `swao_passes` tool description updated with a mandate directive; list corrected to reflect all 11 passes (#1202).
- `swao_control_catalogue` description updated to prevent Claude from substituting `swao_control_detail` for catalogue-level queries (#1201).
- `swao_risk_import` description updated to include XLSX as a primary trigger so Claude uses the correct tool for remediation spreadsheets (#1205).

### Fixed

- MCP completions capability declaration: missing `completions: {}` in server capabilities caused a crash on startup when clients probed the capability (#1194 follow-up).
- `swao_workspace_inventory` replaces misleading `swao_health_check` text output that caused Claude to report incorrect workspace state (#1213).
- Compliance catalogues probe: false "no catalogs" report resolved; probe now correctly detects catalogs at `wsp/inputs/catalogs/community` (#1211).
- Context inputs probe: now checks app-level `ingestion/` directories in addition to workspace-level (#1212).
- Portfolio MCP tools: workspace resolution failure + `resolveLatestRunDir` picks incomplete run fixed (#1203).

### Security

- `adm-zip` bumped to `^0.6.0` in `@swao/module-app-assessment` (CVE-2026-39244 -- #1206).
- `brace-expansion` pnpm override set to `>=5.0.7` (CVE-2026-13149 -- #1207).
- `body-parser` pnpm override set to `>=2.3.0` (CVE-2026-12590 -- #1208).

## [0.9.0] -- 2026-07-22

### Summary

Sprint-104 Milestone M32 MCP Integration (24 issues #1172-#1195).

### Added

- WSP schema extension: `risk.status`, `risk.evidence`, `risk.override`, `risk.machine_outcome`, `risk.feedback_store` fields (additive-optional, backward-compat gate -- #1172).
- MCP de-hardcode: shared schema types imported from `@swao/core`; pass metadata reads from source rather than hard-coded strings (#1173).
- Phase 0-4 regression + E2E gates (`server.test.ts` suites expanding from 37 to 130+ assertions -- #1174 #1177 #1182 #1185 #1189 #1192).
- Pillar 1 MCP read tools: `swao_list_frameworks`, `swao_get_framework`, `swao_list_controls`, `swao_list_passes`, `swao_list_csp_regions` -- all sourced from bundled registry (#1175).
- Resource templates: `swao://app/{id}/index`, `swao://app/{id}/run/{runId}`, `swao://framework/{id}` -- app-scope discovery per Design 080 §3 (#1176).
- `swao_ingest`: capture-to-ingestion MCP tool superseding `swao_import`; supports `source_path` + roots anchoring (#1178).
- `swao_evidence_capture`: structured evidence record with deterministic linkage + chat-log support; evidence surfaced in report + HTML (#1179 #1181).
- `swao_evidence_interview` prompt: structured evidence elicitation with cross-reference propagation + MCP completions (#1180 #1194).
- `swao_risk_import`: xlsx/csv/yaml risk parser with durable overlay + mock tests (#1183).
- Derive-plan risk merge: risk overlay merged into WSP at derive-plan stage; risk status + closure rendered in CLI report and HTML publication (#1184).
- `swao_risk_override` / derive-plan override pass: machine_outcome preserved; operator override takes precedence over machine verdict (#1186).
- MCP feedback tools: `swao_add_feedback`, `swao_get_feedback`; author sourced from active licence; portfolio-scope store at `wsp/feedback-store.json` (#1187).
- Override rendering: override author/role/timestamp/rationale surfaced in HTML risk block; `dim_override` + `machine_value`/`override_value` columns in PowerBI star export (#1188).
- Portfolio index: `wsp/portfolio-index.json` built from star tables; one index read replaces per-app fan-out; staleness detection vs newest per-app run (#1190).
- Portfolio MCP tools: `swao_portfolio_query` (filters/group_by/metrics), `swao_portfolio_stats`, `swao_portfolio_risks`, `swao_portfolio_lz`; scale-tested to 400 synthetic apps (#1191).
- `swao://index` discovery resource: dynamic workspace discovery index listing all apps with latest run IDs and links (#1194).
- MCP completions (`CompleteRequestSchema` handler): `{id}` for `swao://app/{id}` + `swao://framework/{id}`; `{provider}` for `swao://catalogue/{provider}` (#1194).
- MCP logging capability (`logging: {}`): `[WARN]` lines from tool handlers forwarded via `sendLoggingMessage` to connected clients (#1194).
- Schema-consumer audit gate (`tests/audit-gates/schema-consumer-audit.gate.mjs`): static source analysis verifying Design 080 §7.1 -- every risk/override/machine_outcome WSP field must surface in CLI report, HTML block, and PowerBI star export (#1193).

## [0.8.1] -- 2026-07-19

Sprint-101 TUI QA + CLI bug fixes (#1145-#1152):
Health check wizard DoctorStep spawn now clears PKG_EXECPATH so the packaged binary
does not re-enter itself (fixes hang); line-buffering added to DoctorStep for
partial-chunk robustness. GuidanceBox ghost-padding lines now fill the terminal
width and the collapsed `what` text is padded to the box inner width -- both prevent
stale-frame bleed from prior longer frames (#1147/#1148).
`swao challenge --all-agents` no longer requires an explicit `--report` flag -- it
is implied automatically (#1149).
`swao assess` gains `--model <modelId>` to override the LLM model without patching
`.swao.yml` (#1150).
`swao report --all-views --format pdf` behaviour documented (already worked; one
PDF per stakeholder view) (#1151).
Azure LZ catalogue `regions_count` corrected from 18 to 16 (#1152).

## [0.8.0] -- 2026-07-18

### Summary

Saudi Arabia regulatory community frameworks (Sprint-100): five new frameworks added
to the community catalogue -- NCA_ECC (28 controls, ECC-2:2024), NCA_ECC_DEMO (20
controls), NCA_CCC_CST (18 controls, CCC-2:2024 Cloud Service Tenant), NCA_CCC_CSP
(37 controls, CCC-2:2024 Cloud Service Provider), and SAMA_CSF (30 controls,
SAMA Cyber Security Framework v1.0). WSP plan schema extended with two additive
optional fields: `cst_class_required` (NCA CCC data-classification tier) and
`maturity_assessment` (SAMA CSF 6-level maturity model results). DATA pass extended
to emit Saudi data-tier information when NCA CCC regimes are active. All frameworks
authored from real regulatory source material (NCA PDF, SAMA rulebook); zero
em-dashes; RegimeCatalogueSchema validated; 17 new schema tests added.

### Added

- `NCA_ECC` community framework: 28 controls from NCA Essential Cybersecurity
  Controls ECC-2:2024, 4 domains (Governance, Defense, Resilience, Third-Party/Cloud).
- `NCA_ECC_DEMO` community framework: 20-control live-presentation subset of NCA ECC.
- `NCA_CCC_CST` community framework: 18 Cloud Service Tenant controls from NCA CCC-2:2024.
- `NCA_CCC_CSP` community framework: 37 Cloud Service Provider controls from NCA CCC-2:2024.
- `SAMA_CSF` community framework: 30 controls from SAMA Cyber Security Framework v1.0,
  with maturity model rating scale (Level 0-5, minimum Level 3 required).
- `cst_class_required` optional field in WSP PlanSchema (ADR-0012 additive; values:
  qualification, class_a, class_b, class_c, or null).
- `maturity_assessment` optional block in WSP PlanSchema (ADR-0012 additive; captures
  per-domain maturity level, minimum required, and verdicts for maturity-model frameworks).
- DATA pass (#1144): `saudi_data_tier` emitted in assessment when NCA CCC regimes active;
  maps observed data sensitivity to CST licensing class.
- `sprint-100-saudi-frameworks.test.ts`: 17 schema + structure tests for all 5 new frameworks.
- `wsp-schema-v010.test.ts`: 10 new tests for CstClassRequiredSchema, MaturityAssessmentSchema,
  and PlanSchema backward-compatibility with new Saudi fields.

## [0.7.18] -- 2026-07-18

### Summary

HTML Editor layout fix (build correction): Search box, Language switcher, Dark mode toggle (in publication) now correctly appear in Publication Elements; Print button removed; dark mode binary re-compiled with all changes. Publication dark mode accessibility: 30+ missing dark-mode CSS token overrides added to `swao-pub.css` -- badge text colours, severity borders, quick-nav card surface, RAG colours, phase-immediate background, N/A segment fill -- all meeting WCAG AA >= 4.5:1 on dark backgrounds.

### Fixed

- Binary re-build now forces `@swao/module-html-report` recompile before bundling so editor layout changes (v0.7.17 source) are included.
- Added `--bg-secondary`, `--border-light`, `--colour-muted` to `:root` (were undefined, causing fallback to hardcoded light values in dark mode).
- `[data-theme="dark"]` and `@media (prefers-color-scheme: dark)` blocks extended with: `--colour-critical/high/medium/low/positive`, `--rag-fail/pass/partial`, `--colour-*-text`, `--colour-*-border`, `--colour-critical-bg-light`, `--colour-regime-text/border`, `--bg-secondary`, `--border-light`, `--colour-muted`.
- Quick-nav overview cards (`.pub-qnav-card`) now render with dark surface and correct text contrast in dark mode.
- Severity badges (HIGH, MEDIUM, LOW, CRITICAL, REGIME) now use accessible light-toned colours on dark severity-tinted backgrounds.

## [0.7.17] -- 2026-07-18

### Summary

HTML Editor UX improvements: Search box, Language switcher and Dark mode toggle (in publication) moved from Top Nav Panel to Publication Elements section; Save Elements button repositioned to bottom of its section; Print toolbar button removed; dark mode preview fixed (two-pass: regex + late DOMContentLoaded lock); broken cross-reference links hidden in exported templates via baked-in CSS; `nav.top` deep-merge in profile YAML prevents chrome-toggle saves from wiping saved nav item order.

### Changed

- Three top-bar chrome controls (Search box, Language switcher, Dark mode toggle in publication) moved from Top Nav Panel to Publication Elements sidebar section; `getTopNav()` reads by element ID so no JS changes needed.
- Save Elements button repositioned to end of Publication Elements section (was before the block-list).
- Print button removed from HTML Editor toolbar; `printPreview()` function removed.
- Dark mode preview fix: regex now handles absent `data-theme` attribute (fallback inserts the attribute); a DOMContentLoaded capture-phase script injected before `</body>` forces the attribute after the publication JS's `initDarkModeToggle` reads localStorage.
- `handleExportLevel1`: bakes `<style id="swao-disabled-links">` into exported templates, hiding cross-reference `<a href="#disabled-id">` links that would otherwise point to removed sections.
- `saveProfile()` now includes `nav: { top: { search, langSwitcher, themeToggle } }` so Save Elements also persists chrome toggle states to profile YAML.
- `handleSettingsProfile`: deep-merges `nav.top` so a chrome-toggle-only save (from Save Elements) does not overwrite `nav.top.items` saved by Save Top Nav.

## [0.7.16] -- 2026-07-18

### Summary

Profile-specific HTML template naming: Export Template now writes `publication-<profile>.html.tmpl` (e.g. `publication-application.html.tmpl`, `publication-lz-catalog.html.tmpl`) to prevent naming clash between assessment types. Renderer auto-picks the profile-specific file before falling back to the legacy `publication.html.tmpl`.

### Changed

- `handleExportLevel1` in HTML Editor server now derives the export filename from the active profile (`publication-<profile>.html.tmpl`). The profile is sent in the `exportLevel1()` POST body from `window._swaoProfile`.
- `renderModeA` in `renderer.ts` now tries `wsp/templates/html/publication-<profile>.html.tmpl` before `publication.html.tmpl`. Backward compatible: existing `publication.html.tmpl` files continue to work as a fallback.
- Export Template (Level 1) toolbar button tooltip updated to reflect profile-specific naming.

## [0.7.15] -- 2026-07-18

### Summary

HTML Editor Publication Elements simplification: two-panel nav model (assessment content driven by Top/Side Nav only), Publication Elements shows only structural meta blocks (Quick Navigation, Coverage Bar, Footer, Stakeholder Challenge), Export Level 2 Stub removed, filter controls moved to Side Nav rows, sidebar order CSS hardcodes structural slot positions.

### Changed

- `Publication Sections` panel renamed to `Publication Elements`; now shows only structural/meta slots (quick-nav, coverage-bar, stakeholder-challenge, footer) -- assessment content slots removed as they are controlled entirely by Top Nav and Side Nav panels.
- Business rule: nav-eligible slot is excluded from publication only when unchecked in BOTH Top Nav AND Side Nav; unchecking in one panel while the other remains checked keeps content included (avoids broken links).
- Side Nav Panel now excludes structural/meta slots (same `NON_NAV_SLOTS` filter as Top Nav Panel); severity filter and framework-ID filter controls moved from Publication Sections rows to their respective Side Nav rows (signal-list, compliance-framework-detail).
- `getBlocksOrder()` derives order from Side Nav Panel DOM with structural slots at fixed head/tail positions.
- `getDisabledBlocks()` uses OR rule for nav-eligible slots; non-nav slots still use their own checkbox.
- Sidebar CSS in exported template and preview now always includes hardcoded order rules for structural slots (quick-nav: 2, coverage-bar: 3, stakeholder-challenge: 998, footer: 999); nav-eligible items start at order 10.
- Export Template (Level 1) is now the sole export action; `Export Level 2 Stub` button and `exportLevel2()` function removed.

## [0.7.14] -- 2026-07-17

### Summary

Sprint-098 HTML Editor + Publication Phase 3A (#1121-#1131, 11 issues) -- HTML Editor root-cause fix (JS template literal escape), assessment type selector, BLOCK_PROFILES registry, LZ_CATALOG_TEMPLATE, engagement hub chrome, Playwright E2E with outcome assertions.

### Added

- `LZ_CATALOG_TEMPLATE` in `@swao/publication-render/src/publish/template.ts`: per-type HTML shell for landing zone catalog publications with 9 slots (cover, lzr-catalog-header, lzr-catalog-verdict, lz-catalog-services, lzr-catalog-findings, lzr-catalog-remediation, lzr-catalog-finops, evidence-gallery, run-history) and LZ-specific nav links (#1126).
- `BLOCK_PROFILES` static registry in `@swao/publication-render/src/publish/profiles.ts`: maps `application`, `lz-catalog`, `hub` to their canonical block ID lists; exported from `@swao/publication-render` (#1125).
- Assessment type selector `<select id="assessment-type-selector">` in HTML Editor Layout tab: switches editor block list and template slots between `application` and `lz-catalog` profiles via `POST /context?profile=` (#1123).
- `switchAssessmentType(profileId)` JS function in `EDITOR_HTML_FALLBACK`: re-fetches `/context?profile=<id>`, rebuilds top nav, side nav, and block list, syncs selector and profile label (#1123).
- `handleContext` now accepts `?profile=` query param; validates with `SAFE_PROFILE_RE`; picks `LZ_CATALOG_TEMPLATE` or `BUNDLED_TEMPLATE_CONTENT` based on active profile (#1123 #1127).
- Engagement hub `HUB_TEMPLATE` in `renderer.ts` updated to include full publication chrome: classification band, `site-header` with logo/nav/dark-toggle, breadcrumb bar, `page-layout` with sidebar and `main-content` wrapper (#1128).
- LZ-specific `SLOT_LABELS` entries in `EDITOR_HTML_FALLBACK`: `lzr-catalog-header`, `lzr-catalog-verdict`, `lz-catalog-services`, `lzr-catalog-findings`, `lzr-catalog-remediation`, `lzr-catalog-finops` (#1123).
- Playwright E2E harness (`html-editor-e2e.test.ts`) now uses a dedicated write server (port 4097, temp workspace) for Save Navigation and Export Template, and asserts disk outcomes (YAML written, `.tmpl` file written, srcdoc contains `site-header`). Assessment type selector test asserts block list changes: `lz-catalog-services` appears, `seven-r-card` disappears (#1130 #1131).
- Unit tests for `BLOCK_PROFILES` (profiles.test.ts) and `LZ_CATALOG_TEMPLATE` structure + hub chrome assertions (renderer.test.ts) (#1131).

### Fixed

- HTML Editor button non-response: root cause was `\'` in TypeScript template literal resolving to `'` at runtime, generating invalid JavaScript `onclick="moveNavItem('' + sid + '',-1)"` that caused a `SyntaxError` blocking the entire `<script>` block (#1121).
- `EDITOR_HTML_FALLBACK` input event listener now skips `#assessment-type-selector` selects to prevent double-preview triggers when switching profile (#1123).
- Profile label above block list is now a static `<p id="active-profile-label">` element (replacing the dynamically appended one) so `switchAssessmentType` can update it without DOM re-insertion (#1123).

## [0.7.13] -- 2026-07-17

### Summary

Sprint-097 Playwright Crawl QA + LZ Report v2 (#1100-#1120, 21 issues) -- per-stakeholder LZ PDFs, CSP/Region comparison table, Anthropic short-response overload detection unit tests, dropdown nav discovery, font consistency across all PDF types, reports-app rename.

### Added

- LZ Assessment report: `report --type landing-zone-catalog --format pdf` generates one PDF per LZCA challenge agent (`lz-lzca-ciso.pdf`, `lz-lzca-grc-compliance-officer.pdf`, etc.); falls back to `lz-report.pdf` when no challenge findings exist (#1120).
- LZ PDF: CSP/Region comparison table at the top of each report (columns: CSP, Region, Verdict, Frameworks, Services); column widths tuned so "SOVEREIGNTY_BLOCKED" never truncates (#1120).
- LZ PDF: Sovereignty Gate Checks section per target showing framework requirement items (#1120).
- LZ PDF: per-agent opening summary rendered before challenge findings (#1120).
- LZ PDF: Landing Zone header field lists all assessed targets with verdict annotation (#1120).
- `discoverDropdownNavUrls` in `playwright-driver.ts`: clicks `[aria-haspopup]` / `[aria-expanded]` / `[data-toggle="dropdown"]` triggers after each page, extracts newly revealed same-origin links, and adds them to the crawl queue without duplicates (#1101).
- `anthropic.test.ts`: 8 unit tests covering the short-response overload guard, retry behaviour, error message content, and the `output_tokens === 0` guard boundary (#1100).
- `ChallengeAgentFinding.openingSummary?` optional field in `@swao/core` report types (#1120).

### Fixed

- LZ PDF: CSP and Region table cells now render in Helvetica (FONT_BODY) matching the rest of the document; previously used Courier (FONT_MONO) (#1120).
- All PDFs: signal IDs (`LZ-AWS-EU-CENTRAL-1` etc.) no longer wrap at hyphens -- explicit x/y + `lineBreak: false` on the signal ID text call prevents PDFKit from breaking at hyphen word boundaries (#1120).
- LZ PDF: 7R classification row suppressed when `sevenRLabel === ''` (not applicable for LZ assessment) (#1120).
- Playwright: form login failure now logs `[warn] FAILED` with the actual reason; previously always logged "session is authenticated" regardless of outcome (#1102).
- Assess-done: "Pass files: 2 written" now correctly counts 3 passes; filter changed from `includes('signals emitted')` to `startsWith('[ok]  Pass ')` (#1103).
- Playwright: auth-only nav links (Settings, Affiliate) now reach the crawl queue via `firstAuthPagePriority` -- on the first post-login page, discovered links are unshifted to the front of the queue instead of being buried behind sitemap URLs (#1104).
- `crawl.max_turns` and other crawl settings ignored in vault-only credential mode; vault bootstrap now reads the YAML `crawl` block and forwards non-sensitive settings to `CrawlConfig` (#1105).
- LZ fit: `SOVEREIGNTY_BLOCKED` never set in catalogue-only runs because `items` was empty; fixed derivation path (#1106).
- LZ catalogue: `"C5"` token in `aws-esc.json` corrected to `"BSI_C5"` -- eliminates false-positive SOVEREIGNTY_BLOCKED on eusc-de-east-1 against BSI_C5 framework requirements (#1110).
- CTX pass: xlsx-extracted evidence path mismatch; CSV comment header now uses the actual CSV basename so LLM citations resolve correctly (#1111).
- DATA pass: truncated LLM response no longer hard-fails; two-step recovery (append `}}` + retry; fall back to `status: stub`) instead of aborting (#1112).
- App challenge output files now carry `AA_` prefix to match LZCA_ convention; `report.ts` and `extractor.ts` strip the prefix when deriving agentId (#1113).
- LZ assess-done: verdict missing for providers with a space in the name (e.g. "AWS ESC") (#1114).
- LZCA challenge: findings now include `severity` field (#1115).
- LZCA `opening_statement` now emitted consistently by all agents, not CISO only (#1116).
- lz-fit: `sovereignty_statement` now includes a scope caveat for READY regions in catalogue-only runs (#1117).
- lz-fit: `assessment_mode` field added to distinguish catalogue-only from full LZ runs (#1118).
- Report output directory renamed from `wsp/reports/` to `wsp/reports-app/` for app reports; LZ reports write to `wsp/reports-lz/` (#1119).
- `application-architect` view filename token changed from `report` to `technical` (#1119).

### Tests

- 86/86 pass in `module-llm-providers` (new `anthropic.test.ts`).
- 66+ pass in `swao` package `report.test.ts` (LZ report unit tests).
- E2E assertion for `LZ Comparison` table in `binary-e2e.test.ts`.

## [0.7.12] -- 2026-07-15

### Summary

Sprint-096 Application Assessment Debug (#1096-#1099) -- Pass 03/04 JSON leading-garbage recovery, LLM max_tokens now configurable, progress bar shows in-flight indicator during LLM pass, (opt-in) labels removed from Playwright/malware pass selector, error box message fits within box width.

### Fixed

- Pass 03 (data_classification) + Pass 04 (context_ingestion): strip leading non-JSON characters (stray `=`, markdown fences) before JSON.parse using the safeJsonParse pattern already used in Pass 12; prevents `LLM response is not valid JSON` failures when the model prefixes the response with garbage characters despite the system prompt (#1096).
- LLM provider: `max_tokens` is now configurable via `providers.llm.primary.max_tokens` in `.swao.yml`; flows through `LlmProviderConfig -> AnthropicLlmProvider` constructor instead of being hardcoded at 8192; existing workspaces retain 8192 as the default (#1096).
- Assessment progress bar: when `[info] Running Pass NN` is detected in stdout, `subFraction` is set to 0.5 so the bar shows non-zero progress during long-running LLM calls rather than staying at 0% until the pass completes (#1097).
- Pass selector: removed redundant `(opt-in)` suffix from Playwright crawl (pass 10) and Malware scan (pass 14) labels; all passes in the selector are opt-in by definition (#1098).
- Assessment failure error box: shortened the default fallback message from 97 chars to 89 chars so it fits within the box interior (96 chars at guidanceWidth=100) without overflowing onto the bottom border character (#1099).

## [0.7.11] -- 2026-07-14

### Summary

Sprint-093 QoL batch part 2 (#1080-#1091) -- health-check TUI line-buffer fix, framework picker rendering, Playwright authenticated crawl (vault URL, Basic Auth, CSR login timing), Anthropic retry diagnostics.

### Fixed

- Health-check TUI: line-buffer flush fix so all 12 probes render; probe numbering aligned to /12 (#1080 #1081).
- MultiSelect: labels padded to max-label width; shorter labels no longer leave Ink rendering artifacts when the scroll window shifts (#1087).
- Framework picker: key prop forces fresh mount on lens transition; idx lazy initialiser starts cursor on first pre-selected item (#1083 #1084 #1086C).
- Playwright Pass 10: vault URL (`playwright-url-<appId>`) now injected and takes precedence over YAML target_url (#1090).
- Playwright Pass 10: HTTP Basic Auth support via httpCredentials in Playwright context; staging 401 challenges handled automatically (#1090).
- Playwright Pass 10: vault username (`playwright-user-<appId>`) injected when absent from YAML; authType auto-upgraded to form when both credentials resolve (#1085).
- Playwright Pass 10: URL normalisation -- bare hostnames auto-prefixed with https:// (#1085).
- Playwright Pass 10: CSR login timing -- waitForSelector 10s before form-selector loop; per-selector timeout 500ms -> 2000ms for Next.js SPA login pages (#1086A).
- Playwright Pass 10: [info] log when httpCredentials are active; "crawl continues unauthenticated" suppressed when Basic Auth handles auth (#1091).
- Anthropic: MAX_RETRIES 3->5; AbortSignal.timeout per attempt; AbortError/TimeoutError retryable (#1086B).
- Anthropic: FETCH_TIMEOUT_MS 45s->120s; 45s was timing out large context-ingestion prompts that haiku processes in 60-80s (#1091).
- Anthropic: retry log includes actual error message for network-level failure diagnosis (#1088).

## [0.7.10] -- 2026-07-14

### Summary

Sprint-093 QoL batch part 1 (#1078-#1079) -- Pass 14 malware tool-skip diagnostics in assess.log; playwright-core post-install verification with npm prefix diagnostic.

### Fixed

- Pass 14 malware: each missing tool (gitleaks, osv-scanner, clamav, yara, ort) now emits a `console.warn` with install instructions captured in assess.log; previously the log only showed a generic `[skip]` line with no actionable guidance (#1078).
- install-playwright: after `npm install -g playwright-core`, SWAO now calls `isPlaywrightPackageInstalled()` to verify the install succeeded; if not found, reports the npm global prefix and expected install path to help diagnose non-standard npm configurations (#1079).

## [0.7.9] -- 2026-07-14

### Summary

Sprint-092 bugfix batch (7 issues #1071-#1077) -- lens pre-selection (auto-frameworks + passes), duplicate lens menu removal, Playwright health-check/assess consistency.

### Fixed

- Lens passes: selecting a lens now narrows the Pass picker to exactly the lens-prescribed passes; the previous `prev.includes('all') ? prev` guard silently discarded lens passes (#1074).
- Lens auto-frameworks: lens auto-frameworks (e.g. GDPR_DEMO for data-governance) now pre-check correctly in the Community Frameworks picker even when the framework default is 'all'; IIFE early-return on `regimes.includes('all')` removed (#1073).
- New-app flow: lens selection, auto-frameworks, and pass profile now reset when creating a new app so prior app state does not leak (#1073/#1074).
- Playwright probe: health-check in binary mode now reports 'warn' when Chromium is found but playwright-core npm package is missing; keeps health-check consistent with the assess.ts gate (#1077).

## [0.7.8] -- 2026-07-12

### Summary

Sprint-091 QA fix batch (23 issues #1041-#1070) -- runbook anchor Zod validation, display-name wizard prompt, workspace scaffold publication block + run_retention comment, image-to-PDF ingestion conversion, synthesis pass-dir race fix, duplicate-pass deduplication, and log path correctness.

### Fixed

- HTML Editor POST /preview Zod error: runbook steps now carry a generated `anchor` field satisfying `RunbookStepSchema` (#1070).
- New-app wizard: prompts for human-readable display name; `display_name` written to app `.swao.yml` separately from `app_id` (#1041).
- Workspace scaffold `.swao.yml`: adds commented `run_retention` block (#1045), distinguishing `imports_dir` comment (#1048), and commented `publication` block (#1049).
- Assess log: Pass 10 (dynamic) and Pass 23 (LZR) output paths now show run-scoped `wsp/runs/<ts>/passes/` prefix, matching all other passes (#1057).
- Ingest: JPEG and PNG files auto-wrapped as single-page PDF in `wsp/inputs/docs/` instead of rejected; manifest records `status: 'converted'`; GIF emits resave-as-PNG hint (#1062).
- Synthesis pass reads `ctx.passesDir` (run-scoped) instead of falling back to `wsp/latest.txt`; fixes zero prior signals during an active assessment run (#1055).
- Lens pass list case-normalised + deduped via `Set` to prevent duplicate pass execution (#1054).
- GDPR lens auto-resolves to GDPR_DEMO when full GDPR framework is absent (#1059).
- Challenge output uses timestamp subdirectory; `swao report` reads the latest subdir for backward compat (#1056).
- `assessment_date: ~` removed from scaffold templates; no null field written (#1043).
- cmdb-sample.csv placeholder removed from scaffold ingestion (#1044 #1064).
- `regimes_active: [all]` filtered from scaffold template; DEMO frameworks used by default when lens selected (#1042).
- Source README uses generic URL placeholder; no workspace-specific path leaked (#1051).
- `input-iter` and `input-source-path` wizard phases both show GuidanceBox (#1052).
- Challenge screen: agent text wraps with `truncate-end` within column-width guard (#1053).
- scope-probe: returns `absent` status correctly when no apps exist (#1047).
- Source VCS subdir correctly fused into `source.path` in app scaffold template (#1046).

## [0.7.7] -- 2026-07-12

### Summary

Sprint-090 HTML Editor pipeline fix and publication quality batch (28 issues #1013-#1040) -- correct coverage formula, challenge slot, LZ primary inference from catalogue, DEMO caveat, run retention, `latest-application.txt` post-assess, ingestion tip, pass-profile deduplication, executive summary redesign, full publication block configurability, framework tile compact layout, run-scoped latest.txt ordering, and engineering guardrails design document (Design 078).

### Added

- `workspace.run_retention.keep_latest` in `.swao.yml` with post-run cleanup (`rmSync` of oldest runs) and `checkRunAccumulation` probe in `swao doctor` (#1016).
- `stakeholder-challenge` slot in HTML publication template; challenge findings now embedded in single-page HTML output (#1027).
- DEMO sovereignty caveat notice in executive summary when DEMO frameworks are detected via `sovereignty_statement` (#1025).
- Ingestion folder TUI tip (`input-ingest-tip` phase) before lens selection (#1020).
- `SwaoYmlWorkspaceSchema` exported from `@swao/core/src/swao-yml.ts` (#1016).
- Design 078 -- Codebase Quality Audit: engineering guardrails (S1-S5, A1-A5, F1-F5, Q1-Q5), 75 findings across 5 categories, Open Questions section, Testing Framework Embedding plan.

### Fixed

- `computeCoverageScore`: removed erroneous `* 0.05` multiplier; formula now correctly `1.0 - (lowConf / total)` giving scores in [0, 1] not [0.95, 1.0] (#1026).
- LZ primary (`current_infra`) inferred from first READY catalogue region when `spine.landing_zone.primary` is absent (#1024).
- `latest-application.txt` written to `wspDir` after successful application assessment (#1017).
- `latest.txt` written only after run completes successfully, not at run start (#1023).
- HTML Editor: nav.top and nav.side format synced to profile schema (#1028 #1029).
- HTML Editor: content settings write path corrected + YAML key alignment (#1030).
- HTML Editor: colour token names aligned with `TIER1_TOKENS` (#1031).
- HTML Editor: block order from profile applied to slot render sequence (#1032).
- HTML publication: all blocks configurable via Block Manager (#1033 #1034).
- Remediation runbook section rendered from signals (#1035).
- Framework tiles reverted to compact multi-column grid (#1036).
- Assessment passes detail text truncation fixed (#1037).
- Executive summary redesigned: non-technical narrative, blockers callout, signal links (#1038).
- Pass profile entries deduplicated case-insensitively (#1039); `LZR` and `MAL` recognised as valid pass aliases (#1040).
- LZ region selector: CSP label uppercase, single dash separator, truncation guard (#1021).
- Challenge run signal-ID consistency: pass files not overwritten (#1022).
- `swao init` scaffold: duplicate `pass_profile` keys eliminated (#1018).
- DEMO lens pre-selected when `GDPR` is in regimes and `GDPR_DEMO` is available (#1019).
- Publication run-history links: `href` attributes populated from run manifest (#1013 #1014 #1015).

## [0.7.6] -- 2026-07-11

### Summary

Sprint-089 QA fix batch (19 issues #0991-#1011) -- lenses guidance panel, pass filtering via lens selection, LZ region country filter, health-check ingestion probe text output, rejected-file delta detection, Playwright preflight warning and skipped-pass summary, PDF layout fixes, HTML publication multi-iteration pass stats, and BSI C5 sovereignty certification requirement.

### Added

- **Lenses guidance panel (#0991)**: `GuidanceBox` in `input-lenses` phase shows per-lens description and pass set; built-in lens descriptions wired to `LensDef.description`.
- **LZ region country filter (#1000)**: `LzCatalogueRegion.country?` propagated from catalogue index; region label includes `[XX]` country code suffix so operators can filter by "DE", "AT", etc.
- **Ingestion probe text output (#0995)**: `[12/12] Ingestion folder` line added to `swao health-check` text format; `formatIngestionFolderProbeLine()` handles ok/warn/info/absent; probe count updated to 12.
- **Rejected-file manifest tracking (#0999)**: `RejectedIngestEntry` interface + `IngestManifest.rejected?` array; images and archives track SHA-256 across runs so the warning fires only on the first encounter (or when content changes).
- **Multi-iteration pass stats (#1007)**: HTML publication `pass_stats` table groups by `iter` field (Assessment Run / Challenge Run); fallback groups on first repeated `num` for manifests without `iter`.
- **HTML publish template flag (#1008)**: `--template <name>` option for `swao publish`; resolves to `wsp/templates/html/<name>.html.tmpl` or an absolute path.
- **LZ all-blocked aggregate warning (#1009)**: After the LZ target loop, `[warn] LZ Catalogue: all N target(s) SOVEREIGNTY_BLOCKED` printed when every selected region is blocked, naming the frameworks imposing the requirement.
- **BSI C5 sovereignty certification (#1011)**: `bsi-c5/framework-meta.yaml` gains `sovereignty_requirements.require_certifications: [BSI_C5]`; LZ sovereignty gate enforces BSI_C5 operator certification on regions.
- **Playwright skipped-pass summary (#1004)**: `assess-done` screen shows a "skipped pass groups" section when dynamic pass or LLM passes were skipped; parsed from structured warning lines in the run output.

### Changed

- **Lens pass filtering (#0992)**: `AssessScreen` `input-passes` MultiSelect pre-selects only the passes included in the active lens; lens selection now acts as a filter, not just a label.
- **Provider display name capitalisation (#1001)**: `providerDisplayName` helper normalises "stackit" -> "STACKIT", "gcp" -> "GCP", "aws" -> "AWS", "azure" -> "Azure" in assess output.
- **Challenge run `iter` in pass stats (#0994)**: `passStats.push()` records `iter` (1 = assessment, 2 = challenge) so the HTML report can separate tables by run phase.
- **pnpm global Playwright detection (#1003)**: `candidateDirs` in `playwright-driver.ts` includes pnpm global store paths (`%LOCALAPPDATA%/pnpm/...`, `~/.local/share/pnpm/...`).
- **DEP_WARN_FILTER in assess log (#0996)**: Node.js `[DEP0005]` deprecation warnings filtered from the TUI assess log before display.

### Fixed

- **Redaction report negative scrubbed chars (#0993)**: `Math.max(0, delta)` prevents negative `chars_scrubbed` when token estimator overshoots.
- **CTX multi-form evidence path (#0997)**: `pass-04-ctx.ts` uses both `evidence/<file>` and `evidence/interviews/<file>` lookups for form transcripts.
- **Negative evidence heuristic (#0998)**: CTX pass emits a structured `negative_evidence_ref` finding when an evidence file contains only denial phrases (no/none/not/N-A), suppressing false "unresolved reference" warnings.
- **PDF unconditional addPage (#1005)**: `report-pdf.ts` only calls `doc.addPage()` before challenge findings when there is content above the page break threshold, not unconditionally.
- **PDF severity label indentation (#1006)**: MARGIN constant unified; severity label left-edge aligns with signal body text.
- **gdpr-demo tag consistency**: `scope.chapter-v-transfer` tag removed from the Chapter V transfer control in `gdpr-demo`; it was the only `scope`-axis tag in an 11-control framework, causing the tag-consistency probe to flag it.

---

## [0.7.5] -- 2026-07-11

### Summary

Sprint-088 M31 close-out -- HTML publication component library (Phase 2 batch #0977-#0989), ingestion probe + SetupWizard hint (#0969-#0970), lens/challenge wizard integration (Design 074 #0985-#0989), Power BI DAX worst-child aggregation fix (#0984), gitignore scaffold binary + logs entries (#0968).

### Added

- **Ingestion health probe (#0970)**: `buildIngestionProbe()` (ok/warn/info/absent) wired into `HealthCheckPayload`; 5 tests.
- **SetupWizard ingestion hint (#0969)**: ReadyStep shows `apps/<app-id>/ingestion/` tip after Next Steps.
- **Lens wizard phase (#0985)**: `input-lenses` phase in AssessScreen pre-populates passes and frameworks from selected lenses (Design 074 Step 3).
- **Challenge prompt phase (#0988)**: `challenge-prompt` phase after `assess-done` runs the challenge agent on Enter.
- **Provenance: lenses_used (#0989)**: `ProvenanceSchema` gains `lenses_used?: string[]`; `assess.ts` writes active workspace lenses.
- **LZ verdict guide in methodology (#0983)**: Landing Zone Verdict Guide and 7R Migration Guide tables in the publication methodology section.

### Changed

- **Exec summary: 6 findings + narrative (#0980)**: Top findings expanded from 3 to 6; narrative paragraph prepends 7R label and SYNTH-01 derivation excerpt.
- **Engagement hub: card-grid layout (#0982)**: App list uses `swao-card pub-card hub-app-card` cards; workspace summary gains a third stat column and `last_updated`.
- **DEMO framework label (#0977)**: `GDPR_DEMO` displayed as `GDPR (Demo)` in the regime picker.
- **gitignore scaffold: binary + logs entries (#0968)**: `ensureGitignore()` merge path now includes `swao-win-x64.exe`, `swao-community-win.exe`, `swao.bat`, `wsp/logs/`, `apps/*/wsp/logs/`.

### Fixed

- **Power BI blind-spot category aggregation (#0984)**: DAX measure `Category Coverage` (SWITCH/COUNTROWS/FILTER) replaces raw `coverage` column; collapsed categories show worst child verdict. Updated `.pbit` propagated to all locations.

---

## [0.7.4] -- 2026-07-11

### Summary

Sprint-088 M31 Ingestion Layer -- Pass 00 rewrite: content-based routing, SHA-256 delta detection, binary text extraction, cleanup of removed sources, unmanaged file warnings, simplified scaffold, and `swao ingest` CLI + TUI screen (6 issues #0962-#0967).

### Added

- **Content-based routing (#0963)**: `resolveIngestSubdir()` delegates to the classifier to route ingested files into typed subfolders (`architecture/`, `compliance/`, `operations/`, `workshops/`, `structured/`, `terraform/`, `docs/`, `intake/`, `other/`) instead of using raw file-extension heuristics.
- **SHA-256 delta detection (#0962)**: Pass 00 reads the prior `ingestion/ingestion-manifest.json` and skips files whose SHA-256 hash and target path are unchanged; re-copies only modified or new files.
- **Cleanup of removed sources (#0962)**: When a source file is removed from `ingestion/`, its derived copy in `wsp/inputs/` is deleted automatically on the next pass run.
- **Binary text extraction (#0966)**: PDF -> `.extracted.txt` (pdf-parse); DOCX/DOC -> `.extracted.md` (mammoth); XLSX -> per-sheet `.csv` (exceljs); PPTX -> `.extracted.txt` (adm-zip + XML regex). Files >10 MB and `.xls` emit warnings without extraction.
- **Unmanaged file warnings (#0965)**: After each run, Pass 00 scans non-reserved subfolders in `wsp/inputs/` and warns for any files not tracked in the manifest; reserved subfolders (`cmdb`, `source`, `catalogs`, `terraform`, `yara-rules`, `checklists`, `evidence`, `interviews`) are never scanned or deleted.
- **`swao ingest` CLI command (#0967)**: Standalone pre-processor (`registerIngest(program)` in `bootstrap.ts`) that resolves the workspace and calls `runIngestPrePass`; options: `--workspace`, `--app`.
- **IngestScreen TUI screen (#0967)**: Tools submenu item 7 -- spawns `swao ingest` as a child process, streams output, returns to Tools on Enter/Esc/Q.

### Changed

- **Scaffold simplified (#0964)**: `scaffoldImports()` now creates only the load-bearing `wsp/inputs/cmdb/cmdb-sample.csv`; generic subfolder stubs (finops, incidents, architecture, workshops, ops) and their READMEs are no longer generated; the ingestion README is updated to describe the new routing, extraction, and delta detection features.
- **Manifest location**: `ingestion-manifest.json` is now written to `ingestion/ingestion-manifest.json` (previously `wsp/inputs/ingestion-manifest.json`).
- **`runIngestPrePass` is now async** (returns `Promise<IngestManifest | null>`); `assess.ts` awaits it.

---

## [0.7.3] -- 2026-07-11

### Summary

Sprint-088 M31 HTML Publication Component Library -- Phase 2 (Steps 0-11, D1-D3, profile variants, 19 commits, 164 tests passing).

### Added

- **D1 (#0930)**: `ci.yaml` as canonical Tier 1 CSS token store -- renderer reads `wsp/templates/styles/ci.yaml` at publish time and injects `<style>:root{...}</style>` before `swao-pub.css`; HTML Editor writes only Tier 1 tokens.
- **D2 (#0931)**: Single canonical `BUNDLED_TEMPLATE` consolidated to `@swao/publication-render`; editor preview and production render use identical chrome.
- **D3 (#0932)**: HTML Editor Save Content Settings button -- `POST /settings/content` writes `logo_name`, `logo_sub`, `classification_band`, `github_url`, `docs_url` to `.swao.yml`.
- **D4 Phase 2 (#0942)**: HTML Editor branding panel -- colour picker + theme presets (default, dark-pro, minimal, client-red); writes Tier 1 tokens to `ci.yaml` via `POST /settings/branding`; block profile written via `POST /settings/profile`.
- **Profile variant system (#0945)**: Multiple named config variants per assessment type (`<profileId>-<variant>.yaml`); `--profile-variant` CLI flag; `POST /settings/variant`; `listProfileVariants()` + `resolveProfilePath()` in `@swao/publication-render`.
- **Component Library registry (#0944, Step 1)**: Zod OptionSchemas for `swao-table`, `swao-tiles-compliance`, `swao-chart-donut`, `swao-chart-severity-bar`, `swao-rag-badge`; `componentOptions(name)` auto-generates HTML Editor form inputs.
- **`profiles.ts` + YAML workspace override layer (#0943, Step 10)**: 6 base block profiles (application, lz-catalog, lz-customer, audit, llm, hub) as TypeScript constants; `loadProfileOverride()` merges YAML delta from `wsp/templates/profiles/<id>.yaml`.
- **Component helpers (Steps 2-6, #0946-#0950)**: `renderComplianceTileGrid`, `renderChartDonut`, `renderChartSeverityBar`, `swaoTooltip`, `swaoRagBadge`, `swaoProgressBar` extracted as named component helpers; 23 new unit tests (164 total).
- **Configurable top nav (Step 7, #0951)**: `NAV_LABEL_MAP` + `buildNavHtml()` in `renderer-core.ts`; `profile.nav.top` drives server-side nav injection at assembly; 2 new tests.
- **Error handling E1-E5 (#0935-#0938)**: `logger.warn` for missing CSS asset, unknown block, portal load failure; editor render error reports block name.

### Changed

- **CSS normalization (Steps 0a/0b, #0939-#0940)**: `swao-pub.css` restructured into 7 named sections (§1-§7) with three-tier token hierarchy; inline hex values in `blocks.ts` replaced with CSS variable references.
- **`blocks.ts` domain split (Step 9, #0953)**: 2877-line monolith split into 7 domain files under `blocks/` (`assessment.ts`, `compliance.ts`, `risk.ts`, `meta.ts`, `lz.ts`, `hub.ts`, `helpers.ts`); `blocks.ts` is now a 201-line barrel + dispatcher.

### Fixed

- **#0807-P3**: `PKG_EXECPATH=''` in child process env prevents pkg spawn-patch bootstrap error when binary spawns itself.

---

## [0.7.2] -- 2026-07-10

### Summary

Sprint-088 fixes (4 issues #0926-#0929): NIST_SP_800_66R2_DEMO rename, Playwright machine-level package detection, assess-done block summary + Stakeholder Challenge shortcut, publication HTML V8 crash fix (control cap + old-format challenge YAML support).

### Fixed

- **#0926** -- `NIST_HIPAA_DEMO` renamed to `NIST_SP_800_66R2_DEMO` (folder `nist-sp-800-66r2-demo/`); `signal_prefix` unchanged (`HIPAA_DEMO`); init scaffold and test fixtures updated.
- **#0927** -- `isPlaywrightPackageInstalled()` now searches pnpm, Volta, nvm, nvm-windows, fnm, `NODE_PATH`, system-installer paths and 3 ancestor dirs -- no more false "not installed" warning when switching workspace folders.
- **#0928** -- `assess-done` screen now shows block assessment verdicts (observability / licence / testing / architecture / db / integration / IAM / DR) read from `12-blocks.yaml`; `C` key navigates to Stakeholder Challenge.
- **#0929A** -- `renderComplianceRequirements` caps visible controls at 50 per framework with a `<details>` expander for the remainder; eliminates V8 string-rope crash when 9+ large frameworks are active.
- **#0929B** -- Publication extractor promotes `challenge_report.findings` (old pre-v0.7.1 format) to top-level `findings` before schema parse; challenge block no longer shows 0 findings for old-format files.

---

## [0.7.1] -- 2026-07-10

### Summary

Sprint-087 QA fix batch (18 issues #0908-#0925): ChallengeScreen polish, publication challenge block, run-context audit fields, LZ catalogue events, crawl/assess log path fixes, Playwright hub credential reuse, sovereignty gate fix, LensesScreen width.

### Fixed

- AssessScreen: Playwright credential reuse prompt correctly appears when re-entering URL in the hub flow; origin state tracks wizard vs hub context for correct back-navigation (#0908)
- AssessScreen: `assess.log` pointer written to `latest-landing-zone-catalog.txt` for LZ runs, not `latest.txt` (#0909)
- `lzr_input_type` audit field now records `'catalogue'` when the inline LZ catalogue path runs during a full application assessment (#0910)
- RunContext extended with optional `excluded_passes`, `lz_targets`, and `active_frameworks` fields for per-run observability (#0911)
- LzCatalogueUpdateScreen: live progress bar tracks provider completion count during `lz catalogue update` (#0912)
- LzCatalogueUpdateScreen: output section shows individual provider lines and summary on completion (#0913)
- `lz catalogue update`: `index.json generated_at` updated to today and original date preserved as `seed_generated_at` (#0914)
- ChallengeScreen: header shows "Stakeholder Challenge" (without "(Enterprise)" suffix) (#0915)
- ChallengeScreen: guidance box visible in running and done phases, showing agent descriptions (#0916)
- ChallengeScreen: progress bar added, advances per agent, turns green on success (#0917)
- ChallengeScreen: agent list uses `wrap="truncate-end"` and is width-constrained to terminal width (#0918)
- Challenge YAML envelope normalised: `schema_version`, `workload_id`, `reviewed_at`, `assessment_status` always present; legacy `review_date`/`review_timestamp` fields removed; finding severities uppercased (#0919)
- Stakeholder Challenge included in HTML publication: `ChallengeAgentReportSchema` in publication model, extractor reads `wsp/challenge/*.yaml`, `renderChallengeBlock()` renders expandable agent panels + findings table (#0920)
- Log events added: `swao.run.complete` after assessment, `challenge.start`/`challenge.session.start`/`challenge.session.complete`, `lz.catalogue.update.start`/`lz.catalogue.update.complete` (#0921)
- LensesScreen: pass union box width capped to terminal width minus 2 (no overflow on narrow terminals) (#0922)
- LZ assessment TUI: multi-target display shows all selected CSP/region combinations (#0923)
- Sovereignty gate: `sovereignty_requirements` lookup falls back to `regimes_active` when `frameworks` key is absent, matching the documented `.swao.yml` schema (#0924)
- Assess done screen: current-infra label rendered correctly (#0925)

## [0.7.0] -- 2026-07-09

### Summary

Sprint-084 QA Fix Batch (24 issues #0880-#0903) + Sprint-085 LZ Catalogue Fixes (4 issues #0904-#0907).

### Fixed

- `lz catalogue update` crashed with ENOENT when writing to pkg snapshot read-only VFS; now uses `findWorkspace()` and writes to `<workspace>/wsp/inputs/catalogs/lz-catalogues/` (#0905)
- Azure Retail Prices API 429 aborted catalogue update mid-pagination; retry-with-backoff added (reads `Retry-After` header, 5-retry-per-page budget, caps wait at 300s) (#0906)
- `swao lz catalogue list` and `swao lz catalogue show` resolved bundled snapshot instead of workspace-refreshed catalogue; both now call `findWorkspace(cwd())` and pass `workspaceRoot` (#0907)
- Playwright crawl login never submitted -- missing `.com` domain suffix, HTML5 validation block, SPA networkidle timing (#0893 #0896)
- Crawl followed static asset links (CSS, JS, images, manifests); extension filter added to `extractSameOriginLinks()` (#0892)
- `lz catalogue update` command missing from Enterprise binary (`index.ts` never called `registerLzCatalogueUpdate`) (#0898)
- LZ catalogue mode rated available-not-enabled services as SUPPORTED; AVAILABLE_NOT_ENABLED verdict tier added (#0897)
- Unknown pass profile caused hard `process.exit(1)` with no TUI recovery; pre-flight validation added, unknown entries warn and are dropped (#0890)
- Default pass selection included Playwright and Malware passes silently; `initialPassProfile` defaults to `['static']` (#0901)
- Challenge exited code 1 with 5 copies of error when no LLM provider configured; pre-flight check added (#0902)
- GuidanceBox focus ownership blocked SelectInput when overlay was open (#0884)
- Playwright Chromium detection probe not re-evaluated on screen re-entry (#0887)
- LZ region selector cursor not at first item on initial render (#0888)
- Pass 14 selection did not auto-write `passes.malware` block to `.swao.yml` (#0886)
- SetupWizard unconditionally wrote `redactor.type: gitleaks` without PATH check (#0881)
- Challenge `validateCombinedReport()` structural validation + log reporting (#0904)
- Assess type-selector indent and LZ label overflow (#0882 #0883)
- STACKIT capitalisation and eu02 GA status (#0889)
- Doctor Prerequisites WARN showed generic SSH/HTTPS action for malware tools (#0880)
- Help screen overflowed terminal window; pagination added (#0903)
- Credential store did not offer matching existing credentials on URL re-entry (#0885)
- Tab pages not captured as separate parity entries in Playwright crawl (#0900)
- AssessScreen status bar hidden on first render; multi-line layout for narrow terminals (#0895)
- Sitemap.xml pre-seeding added to crawl queue initialisation (#0894)

### Added

- LZ catalogue multi-CSP multi-region selection in TUI + backend dispatch (#0899)

## [0.6.0] -- 2026-07-08

### Summary

Sprint-083 BSI Frameworks + E2E Test Suite Foundation: 18 issues closed (#0873-#0879, #0525-#0530, #0688, #0734-#0735, #0751, #0776).

### Added

- `BSI_GRUNDSCHUTZ_2023` v0.2.0: expanded from 72 to 105 controls (72 Basis + 33 Standard tier requirements across 27 Bausteine); 66 evidence template files (#0873 #0874)
- `BSI_C5` 1.0.0: expanded from 5 to 62 controls across all 17 C5:2020 domains (OIS, INF, RB, SIS, ID, SCM, CSI, BC, SEC, DEV, HRS, OP, TAM, PRY, SLM, INM, DSI); `signal_prefix: C5`, cross-mapping hints, redistribution note (#0875)
- E2E helpers: `startEditorServer`, `loadReport`, `validateStarSchema`, `runMcpTool`, `resolveLatestPublication` in `tests/e2e/helpers.ts` (#0525)
- E2E golden fixture: 17 star-schema CSVs under `examples/portfolio-workspace/portfolio/apps/sovereign-health/wsp/exports/star/` (#0525)
- CI `e2e` job in `.github/workflows/ci.yml` (`continue-on-error: true`) (#0525)
- Playwright E2E journey specs: `journey-j6-html-pub.spec.ts` (UC-01 to UC-05), `journey-j4-prism.spec.ts` (JP-01 to JP-05), `journey-j5-bi-export.spec.ts` (J5-01 to J5-06), `journey-j6-persona-views.spec.ts` (J6-01 to J6-07), `journey-j7-html-editor.spec.ts` (J7-01 to J7-07) (#0523 #0526 #0527 #0528 #0529)
- 26 TUI ink tests: `assess.test.tsx` (TU-01 TU-02 TU-07), `publish.test.tsx` (TU-03 TU-04), `doctor.test.tsx` (TU-05 TU-06), `lz-catalogue-update.test.tsx` (TU-08) (#0530)
- Azure live catalogue transport: `fetchAzureCatalogue()` via Retail Prices API in `module-landing-zone` (#0688)
- OneDrive/Graph audit-evidence adapter: `fetch-onedrive.ts` in `module-audit-assessment` (#0688)
- `ExportBiScreen`: Step 1/2 done-powerbi structure, SWAOWorkspaceRoot label, advanced-options gate (#0734 #0735)
- G2 inline Playwright login: username/password TextInput sub-steps in `input-playwright-url` phase of AssessScreen (#0776)
- `swao report --format html`: wires `renderModeA` from `@swao/module-html-report` into the report command; output path logged to stdout (#0877)
- `pass_profile` / `lenses` enforcement: unknown lens key now exits 1 with a clear error; `listLenses()` used for validation (#0878)
- `--malware-fail-on-detection` flag: exits 5 when any MAL-01 or MAL-03 finding is present after the malware pass (#0879)
- `swao doctor` warn probes for Gitleaks, OSV-Scanner, ClamAV, YARA -- status `warn` when absent; message links to install instructions (#0879)
- `.swao.yml` `passes.malware.tools` config block fully wired: per-tool `enabled` flags, `gitleaks.config_file`, `yara.rules_dir`, `ort.rules_file` configurable (#0879)
- `malware` added to `security-focus` built-in lens and `controls/lenses/security-focus.yaml` (#0879)
- `swao/docs/malware-scanning.md`: user guide covering prerequisites, invocation, configuration, signal IDs, and known limitations (#0879)
- YAML round-trip tests for `providers.llm` and `crawl` blocks; `// written by` annotations at YAML read sites (#0751)
- `assess-yaml-roundtrip.test.ts`: 10 round-trip tests (#0751)

### Changed

- `BSI_GRUNDSCHUTZ_2023` `catalogue_version` bumped to `"0.2.0"`; `assessment_type_scope` set to `[app, aud]` (#0874)
- `_registry.yaml`: BSI_GRUNDSCHUTZ_2023 version updated to `0.2.0`; BSI_C5 promoted to `1.0.0` (#0874 #0875)
- `--passes` help text now lists `malware` as an opt-in extra key with install hint (#0879)

## [0.5.17] -- 2026-07-07

### Summary

Sprint-082 LZ catalogue adapter batch: 4 issues closed (#0869-#0872).

### Added

- `fetch-azure.ts`: `normalizeAzureProducts()` normaliser; `AzureAvailabilityRow` / `AzureRegionOverlay` types
- `lz-premium.ts`: `fetchAzureRetailPrices()` (500-page cap); `AZURE_SERVICE_FULFILLS` (76 service name mappings);
  `AZURE_SOVEREIGNTY_OVERLAY` (55 `armRegionName` -> sovereignty-facts entries); `buildAzureCatalogue()`
  builder with per-service `fulfills` + `key_custody` enrichment; `--azure-prices-path` override option;
  `'azure'` entry in `PARTITION_CONFIG`; Azure fetch + process sections in action handler (#0869)
- `fetch-gcp.ts`: `normalizeGcpProducts()` from GoogleCloudPlatform/region-picker `products.json` boolean matrix (#0870)
- `fetch-stackit.ts`: `normalizeStackitSkus()` from STACKIT PIM API `pim.api.stackit.cloud/v1/skus` (#0871)
- `LzCatalogueUpdateScreen.tsx`: TUI tool screen covering all 4 providers + dry-run toggle + live progress (#0872)
- `mergeRetiredServices()`: retired-service preservation -- services absent from fresh data are kept with
  `status: 'retired'` and a stable `retired_at` date across subsequent refreshes
- `refresh-lz-catalogue-azure.mjs`, `refresh-lz-catalogue-gcp.mjs`, `refresh-lz-catalogue-stackit.mjs`:
  standalone dev-refresh scripts for each new provider
- `azure.json` seed: 16 regions, 272 active services (initial; refresh via `swao lz catalogue update --provider azure`)
- `gcp.json` seed: 42 regions, 2,884 active services (initial; refresh via `swao lz catalogue update --provider gcp`)
- `stackit.json` updated: eu01 44 services, eu02 24 services (PIM API data)
- `LzServiceSchema.retired_at`: YYYY-MM-DD optional field, only set when `status === 'retired'`
- `LzCatalogueMetaSchema.source.mode`: added `'pim-api-stackit'` variant; `source_note` optional field

## [0.5.16] -- 2026-07-07

### Summary

Sprint-082 QA bug fix batch: 9 issues closed (#0860-#0868).

### Fixed

- `scripts/sprint-close.sh`: add `git add` after frontmatter flip and
  `last-sync.json` counter bump so state changes are staged atomically (#0860)
- `@swao/tui-kit` `SelectInput`: add JSDoc to `onSelect` and `onCursorChange`
  props clarifying when each fires (#0861)
- `docs/design/015`: add `lzVerdict` lowercase note distinguishing it from
  Layer C LZ-FIT uppercase verdicts (#0862)
- STACKIT capitalisation: `StackIT` -> `STACKIT` across 8 files (#0863)
- `challenge.ts`: wrap async action handler in outer try/catch; unhandled
  exceptions now produce `[challenge] Fatal error: ...` and `exit 1` instead
  of `exit 7` (Node.js unhandled rejection) (#0865)
- `ChallengeScreen.tsx`: update error hint from "often the Enterprise-licence
  gate" to "see the output above for details" (#0865)
- `CredentialScreen.tsx`: add `GuidanceBox` to `set-value` (with per-credential
  format hints), `set-running`, and `list` sub-screens (#0866)
- `HelpScreen.tsx`: move `GuidanceBox` to top of screen (always visible);
  refactor `TROUBLESHOOTING` entries from single long strings to `string[]`
  arrays to prevent terminal wrap / garbled layout on 80-column terminals (#0867)
- `report-pdf.ts`: remove `width` option from footer `doc.text()` calls --
  pdfkit triggers its page-break guard when `width` is combined with an
  explicit y coordinate past the bottom-margin boundary, producing spurious
  trailing pages. Removing `width` eliminates the bug across all five report
  views (#0868)
- `report-pdf.test.ts`: add 5 page-count regression tests (one per view) that
  assert exactly 1 page in the output PDF for a standard fixture (#0868)

### Notes

- Issue #0864 (challenge agent picker shows single-select in v0.5.14 binary):
  self-resolved -- source already uses `MultiSelect` via #0854; rebuild
  produces correct binary.

## [0.5.15] -- 2026-07-07

### Summary

Sprint-081 QA fix batch: 21 issues closed (#0839-#0859). HIGH priority fixes: SetupWizard
retired catalog entry removed (#0840); COBIT-5-demo removed from Enterprise init scaffold (#0842);
GuidanceBox auto-open on phase mount (#0845); challenge command reads LLM config from .swao.yml
(#0847); LensesScreen converted to MultiSelect (#0849); ChallengeScreen multi-agent sequential
execution (#0852); AssessScreen LLM config from .swao.yml (#0855); swao.bat full ASCII header
(#0858). Enhancement: challenge `--report` canonical output path + challenge findings in PDF
report (#0851); binary host playwright-core loader via createRequire (#0859).

### Added

- `ChallengeAgentFinding` and `ChallengeFindingEntry` types in `@swao/core/report-types.ts` --
  `ReportData.challengeFindings` optional field for PDF renderer (#0851)
- `wsp/challenge/<agentId>.yaml` canonical default output path for `swao challenge --report`
  (#0851)
- `generateReport()` scans `wsp/challenge/*.yaml` and populates `challengeFindings` (#0851)
- "Stakeholder Challenge" section in PDF report when challenge findings are present (#0851)
- `tryLoadHostPlaywrightCore()` in `playwright-driver.ts` -- loads host playwright-core from
  global npm locations at runtime via `createRequire`; enables Pass 10 in binary when host
  Playwright is installed (#0859)
- `isHostPlaywrightAvailable` exported from `playwright-driver.ts` (#0859)

### Changed

- `assess.ts`: Pass 10 skip in binary now checks for host playwright-core first; logs info if
  found, warning + skip only if neither bundled nor host playwright is available (#0859)
- LensesScreen: single `SelectInput` replaced with `MultiSelect`; status message includes
  navigation hint (#0849 #0856)
- ChallengeScreen: MultiSelect agent picker; sequential multi-agent execution via `agentIndex`
  state (#0852 #0854)
- GuidanceBox: auto-opens on phase mount; width capped at 98 columns; text colour `white`
  on dark background (#0845 #0857 #0853)
- `swao init` scaffold version read from bundled package.json at runtime (#0841)
- Pass stats table column renamed "Items"; uses `items_emitted ?? signals_emitted` (#0846)

### Fixed

- SetupWizard: retired `builtin:/catalogs/standard` reference removed (#0840)
- COBIT-5-demo removed from Enterprise binary init scaffold (#0842)
- App LZ region MultiSelect pre-selects first entry to prevent empty-selection deadlock (#0843)
- Pass 10 upfront skip in binary with clear warning (#0844, updated by #0859)
- LZ catalog single-region auto-advances directly to running phase (#0848)
- Evidence URL input screen: layout, placeholder, and GuidanceBox wired correctly (#0850)
- Challenge command reads LLM config from app `.swao.yml` (#0847)
- AssessScreen passes LLM config from app `.swao.yml` to assess process (#0855)
- `swao.bat` + `swao-community.bat` expanded to full SWAO ASCII header (#0839 #0858)

---

## [0.5.14] -- 2026-07-07

### Summary

Sprint-080: safeReadYaml call-site audit (#0826); demo-framework star-export fixture test
asserting 47 controls (#0827); design doc 069 mapping LLM vs rule-engine evaluator output
locations (#0828); QA batch -- `swao.bat` Windows launcher docs + startup message (#0830);
credential screen key remap + badge fix (#0831); LZ region auto-advance removed (#0832);
Playwright detection warning phase (#0833); LZ verdict lowercase fix + GuidanceBox conditional
text (#0834); `regimes_active` added to sovereign-health `.swao.yml` (#0835); evidence gallery
`--evidence-base-url` flag + `input-evidence-url` TUI phase (#0836); top-findings severity sort
(#0837); coverage bar segments + legend items clickable (#0838).

### Added

- `--evidence-base-url <url>` flag on `swao publish` -- prefixes evidence file hrefs with a
  portable base URL (SharePoint, GitHub, etc.); falls back to relative `../inputs/` when absent
  (#0836)
- `input-evidence-url` TUI phase in `PublishScreen.tsx` -- optional URL entry after app
  selection; Enter skips; integrated with `buildArgs` (#0836)
- `PublicationConfigSchema.evidence_base_url` optional field in `publication-render` model
  (#0836)
- `playwright-warn` phase in `AssessScreen.tsx` -- `findInstalledChromium()` scans
  `%LOCALAPPDATA%\ms-playwright`; warns before proceeding if Chromium is absent (#0833)
- Design doc `docs/design/069-llm-vs-rule-engine-evaluator-output-locations.md` -- maps LLM
  evaluator path (`assessment.regimes` in pass YAML) vs rule engine path (`compliance.regimes`
  in `wsp-plan.yaml`) (#0828)
- Demo-framework fixture test: `demo-framework-export.test.ts` asserts `fact_controls.csv` has
  47 rows for a full GDPR star-schema export (#0827)
- Windows launch entry in `docs/runbooks/troubleshooting.md` -- `swao.bat` documented as
  mandated Windows interactive entry point; `swao-win-x64.exe` for scripted/MCP use (#0830)
- `assessment.regimes_active: [GDPR, AI_10_PILLARS, COBIT_5, NIST_SP_800_66R2]` added to
  `examples/portfolio-workspace/.../sovereign-health/.swao.yml` (#0835)

### Fixed

- `safeReadYaml` audit: `SwaoYmlSchema` in `@swao/core` extended with `publication` field;
  all 9 call sites verified typed to full schema (#0826)
- LZ verdict string comparisons corrected from uppercase (`'READY'`) to lowercase (`'ready'`,
  `'blocked'`, `'advisory'`) matching CLI output; `GuidanceBox` what-text now verdict-conditional
  (#0834)
- LZ region auto-advance removed -- pre-selects first option but requires explicit Enter,
  preventing silent skip of user's intended selection (#0832)
- `AssessScreen.tsx` credential screen: shortcut keys remapped (T->A, P->T, W->P); badge text
  width corrected (#0831)
- Startup blank screen (Blank 2): `run-app.ts` writes `"Starting SWAO..."` to stdout before
  `ENTER_ALT_SCREEN` so the terminal is never fully blank (#0830)
- Evidence Gallery note updated: shows configured base URL when `--evidence-base-url` is set;
  instructs operator to use the flag when absent (#0836)
- `top_findings` sorted by severity (critical > high > medium > low > informational > positive)
  before slicing top 3 in `extractor.ts` (#0837)
- Coverage bar segments and legend items wrapped in `<a>` tags -- clicking scrolls to and
  activates the severity filter chip (#0838)

## [0.5.13] -- 2026-07-06

### Summary

Sprint-079: TUI per-app wizard (E key edit-only mode, pass-profile persistence, per-app LLM
override via L key) (#0800); CLI assess E2E covering Layer 3 binary path (#0807-P2); MCP assess
E2E covering Layer 6 JSON-RPC HTTP path (#0807-P3); star-schema exporter reads `assessment.regimes`
from pass files -- demo frameworks now export 47 real controls (was 0) (#0823); Power BI decimal
locale fix (`Table.TransformColumnTypes "en-US"`) (#0821); Scope Coverage Ratio DAX corrected
to `DIVIDE(closed+partial, total, 0)` (was open/closed, showing 300%) (#0822); `display_name`
+ `description` added to SwaoYmlAssessmentSchema.

### Added

- Per-app LLM override phase (`input-app-llm`): L key from credential hub selects workspace-
  default / anthropic / openai / ollama; stored in app `.swao.yml`; merged into `buildChildEnv`
  over workspace config (#0800)
- Edit-only mode in assessment flow: E key on highlighted app opens credential hub without
  starting assessment; returns to app list on Enter/S (#0800)
- Pass profile persistence: `readAppPassProfile` / `writeAppPassProfile` read and write
  `assessment.pass_profile` in app `.swao.yml`; `input-passes` initialises from stored profile
  (#0800)
- `SelectInput onCursorChange` prop: cursor-position callback fires on mount (initial value)
  and arrow-key movement; used by parent to track highlighted app (#0800)
- `display_name` and `description` fields added to `SwaoYmlAssessmentSchema` in `@swao/core`
  (#0800)
- CLI assess E2E test: `binary-e2e.test.ts` asserts `run-manifest.json` written with
  `passes_executed` containing `'inv'` after `swao assess --passes inv --no-crawl` (#0807-P2)
- MCP assess E2E test (`mcp-assess-e2e.test.ts`): starts community binary as MCP HTTP server,
  performs JSON-RPC 2.0 handshake, calls `swao_assess` with `workspace_path` + `passes: 'inv'`,
  asserts 200 and pass-completion output; skips when binary absent (#0807-P3)

### Fixed

- Star-schema exporter reads `assessment.regimes[].controls[]` from pass YAML files (typed as
  `RawPassFile` not `{ signals? }`); demo frameworks now produce real control rows with IDs,
  titles, rationale, and remediation instead of synthetic derivation rows (#0823)
- Power BI decimal separator: `Table.TransformColumnTypes(..., "en-US")` on all CSV-sourced
  tables; fixes 9,900% coverage and 1.8E+16 LLM cost on European locale installs (#0821)
- Power BI Scope Coverage Ratio DAX: `DIVIDE(closed + partial, total, 0)` replaces the
  inverted `open / closed` formula (was showing 300% for 2 closed of 10 total) (#0822)

## [0.5.12] -- 2026-07-06

### Summary

Sprint-078/079 QA batch: per-app credential hub in assessment flow (VCS URL + token + Playwright
URL/user/password/MFA seed, per-app keys, optimistic status dots, LZ-only filtering) (#0814);
PDF report formatting and layout fixes (#0817); HTML publication signal chip tooltips and
derivation rendering (#0818 #0819); HTML editor per-item sidebar nav (#0820); Power BI
compliance controls populated for Demo frameworks via derivation-string parse (#0823);
partnership lead email no longer redacted from wsp.yaml by scrubRunDirectory (#0824);
GuidanceBox Ctrl+G systemic wiring audit complete -- all 22 TSX screens correctly wired
(#0798 #0810 #0813); launcher script (swao.bat) writes ASCII banner before binary starts to
cover V8 snapshot load delay (#0808 #0812); TUI crash stale-closure fix in MainMenu navigation
(#0816); test gate pins updated: swao_hub tool + lz_cat_targets MCP parameter.

### Added

- Per-app credential hub in assessment flow: VCS URL (vcs-url-APP), VCS token (vcs-token-APP),
  Playwright URL/username/password/MFA-seed stored per-app in credential store (#0814)
- Launcher script swao.bat writes ASCII banner immediately before PKG binary starts so the
  banner remains visible during V8 snapshot decompression (#0808)

### Fixed

- PDF report page X/Y reset, doc.x reset after multi-column render, running header, view
  narrative rendering (#0817)
- HTML publication signal chip data-signal-derivation attribute enables tooltip popups (#0818)
- HTML publication signals table full-width layout and evidence gallery links (#0819)
- HTML editor side navigation: per-item toggle and reorder (#0820)
- Power BI fact_controls.csv now populated for Demo framework assessments (COMP signal
  derivation parsed into synthetic per-outcome rows) (#0823)
- wsp.yaml excluded from scrubRunDirectory so partnership_lead email is not redacted (#0824)
- GuidanceBox onOpenChange wired in all 22 TSX screens -- Ctrl+G toggles correctly on every
  screen (#0798 #0810 #0813)
- MainMenu idxRef guard prevents stale-closure crash on rapid key presses (#0816)
- Banner delay extended from 1500ms to 3500ms for readability (#0812)
- MCP completeness gate: swao_hub added to EXPECTED_TOOLS
- MCP three-surface-sync gate: lz_cat_targets added to swao_assess expected params

## [0.5.11] -- 2026-07-04

### Summary

Sprint-078: multi-type run resolver fix (#0786) -- `resolveSourceWspRun` in star.ts now prefers
`latest-application.txt` over `latest.txt` preventing LZ catalog runs from shadowing application
pass data for BI export and portfolio; ExportBiScreen + PortfolioScreen eligibility updated with
backward-compatible logic; RunContextPicker utilities exported and covered by 13 new unit tests
in @swao/tui-kit; MCP tool-set pin (`swao_hub`) and publish parameter pin (`block_profile`)
updated for sprint-076 additions; 3 resolver regression tests added to module-powerbi.

## [0.5.10] -- 2026-07-04

### Summary

Sprint-076 final batch: optional LZ target step in app assessment TUI (provider + region picker,
Esc to skip) wired to inline catalogue fit via `--lz-cat-provider`/`--lz-cat-region` (#0732);
`landing_zone.primary` = null (real CSP ID) / `landing_zone.status` = LLM synthesis slug --
schema separation per #0732 AC6; extractor produces `lzr.overall = 'Not Assessed'` when no
lz-catalogue-fit.yaml exists; blocks.ts renders "No landing zone target selected" message;
engagement hub block profile generator: `engagement-hub.html` with workspace-level aggregation
and cross-app links (#0794 #0795); engagement metadata fields in SetupWizard (#0722); assessor
pre-fill from stored credentials (#0723); community catalog regime-resolution probe in doctor
(#0724); PDF color coding + compliance table + 2-line footer (#0729); Anthropic 529 retry with
backoff (#0716); risk register source signal field (#0731); HTML editor profile context filter
(#0792); block profile CLI/MCP flag parity gate (#0793); router token rename
`landing-zone` -> `landing-zone-catalog` (#0781).

### Added

- `--lz-cat-provider` / `--lz-cat-region` CLI flags for `swao assess` (app type)
- `landing_zone.status` field in wsp.yaml spine (LLM synthesis recommendation)
- `lz_status` field in LZRSummary publication model
- `input-app-lz-provider` / `input-app-lz-region` TUI phases in AssessScreen
- Engagement hub block profile (`engagement-hub`) with `engagement-hub.html` generator
- Hub workspace aggregation: app count, signal totals, cross-app publication links
- Community catalog probe in `swao doctor` (regime-resolution warning)
- Engagement lead and assessor fields in SetupWizard + wsp.yaml

### Fixed

- `landing_zone.primary` was populated with LLM slug; now null for new runs (backward compat)
- LZR section showed misleading LLM slug as "Unknown" label; now "Not Assessed"
- PDF color-coded 7R label, coverage score, signal severity strip
- PDF compliance control table in `-compliance.pdf` view
- Anthropic 529 fetch errors now retry with backoff rather than aborting
- Risk register `platform_impact` and signal source fields populated
- HTML editor contexts filter scoped to active profile

## [0.5.9] -- 2026-07-04

### Summary

Sprint-076 close: PDF styled renderer with structured sections, severity badges, and signal
cards (#0710); VitePress runbooks section with 13 EN + 13 DE operational runbooks (#0797 --
sidebar fully wired) (#0679); binary E2E expanded to all CLI commands, TUI component tests
for 10 screens via Ink Testing Library, coverage floor gate (lines 55%, functions 45%) (#0670);
type-to-filter consistent helper for large lists: app selector and LZ region picker (#0796);
demo framework catalogue_version semver fix -- 1.0-demo replaced with 1.0.0 (#0797);
new-app flow Playwright crawl URL phase added to AssessScreen (#0776-C partial).

### Added

- **VitePress runbooks (#0679)**: 13 EN runbooks (Installation: Windows/macOS/Linux/Docker;
  Configuration: LLM provider swap/licence/workspace; Integration: MCP/CI-CD;
  Operations: CLI reference/doctor/updating/troubleshooting) + 13 DE translations;
  sidebar wired in both EN and DE locales; `docs:build` clean.
- **TUI component tests (#0670 Ph3)**: 10 TUI screens tested via Ink Testing Library
  (`tui-components.test.tsx`): MainMenu, HelpScreen, ToolsMenu, LicenseScreen, GuidanceBox,
  CredentialScreen, RegimeSelectorScreen, LensesScreen, ReportScreen, SetupWizard;
  38 tests total.
- **Binary E2E coverage (#0670 Ph1)**: all CLI commands covered in `binary-e2e.test.ts`
  including `setup`, `export`, `mcp`, `menu`, `migrate-workspace`, `regime-select`,
  `generate-tf`, `log`, `lenses`, `normalize`, `diff`, `accept`, `audit`, `lz`, `challenge`,
  `install-playwright`; export CSV and publish HTML smoke tests added.
- **Coverage floor gate (#0670 Ph5)**: `vitest.config.ts` thresholds (lines 55%, functions
  45%, branches 40%); `pnpm test:coverage` wired in CI `check` job.
- **Binary smoke CI job (#0670 Ph2)**: `smoke` job in ci.yml builds Linux x64 community binary
  and runs `pnpm test:smoke`.
- **type-to-filter helper (#0796)**: `list-filter.ts` with `filterList<T>`, `FILTER_THRESHOLD`,
  `SHOW_ALL`; app selector and LZ region picker both use it; 13 unit tests.
- **Playwright URL phase (#0776-C)**: `input-playwright-url` phase in AssessScreen new-app
  flow writes `crawl.target_url` to `.swao.yml` on submit (Enter to skip).
- **Multi-assessment strategy (#0781-0795)**: ADRs 0051/0052, Designs 067/068 for M30
  per-type run contexts and LZ catalog publication.

### Fixed

- **PDF renderer (#0710)**: `report-pdf.ts` already used structured `ReportData` fields;
  size-assertion threshold anchored to measured output (3500 bytes minimum for rich content).
- **Demo framework semver (#0797)**: `catalogue_version: "1.0-demo"` failed
  `SemverSchema` regex; fixed to `"1.0.0"` in all four demo framework source files.

## [0.5.8] -- 2026-07-04

### Summary

Sprint-076/077 QA batch: GuidanceBox Escape conflict fixed across all SetupWizard screens,
app list filter for large workspaces, regimes field path mismatch fix, LZ Catalog Assessment
rename, crash handler + NDJSON crash log, HealthCheck engagement info, GuidanceBox added
to HelpScreen/HealthCheckScreen/ServeScreen, LZ Catalog sync stub, and 14 QA issues closed.

### Fixed

- **GuidanceBox Escape conflict (#0760)**: module-level `_wizardGuidanceOpen` flag prevents
  SetupWizard root `useInput` Escape from firing while any GuidanceBox is expanded; all 19
  GuidanceBox instances in SetupWizard now carry `onOpenChange={setWizardGuidanceOpen}`;
  `ConfirmContinue`, `ConfirmOrEdit`, `ReadyStep`, and `ClaudeDesktopStep` useInput handlers
  similarly guarded
- **App list filter (#0763)**: workspaces with >10 apps show a filter TextInput step first;
  filtered SelectInput follows with `apps/` prefix on all labels (#0762)
- **Regimes field mismatch (#0755)**: `init.ts` now writes `assessment.regimes_active` (not
  top-level `regimes`); `readAppRegimes` in AssessScreen falls back to top-level `regimes`
  for backward compatibility
- **LZ Catalog Assessment rename (#0764)**: "Landing Zone Assessment" renamed to "Landing Zone
  Catalog Assessment" throughout TUI; "Customer Landing Zone Assessment (Coming Soon)" added
  to AssessmentTypeScreen
- **Process crash handler + NDJSON log (#0766)**: `uncaughtException` and `unhandledRejection`
  handlers registered in `runTuiInAltScreen`; crash written to `wsp/logs/crash.ndjson`;
  alt-screen restored before exit
- **LZ telemetry (#0766)**: `lz.assess.start`, `lz.assess.complete`, `lz.assess.error` events
  logged via `logApp` in AssessScreen LZ assessment flow
- **PlaywrightStep verbosity (#0761)**: main area reduced to 3 lines; install instructions
  moved to GuidanceBox `details`; Playwright step Escape conflict also resolved via
  `playwrightGuidanceOpen` ref
- **SetupWizard `writeAndUpdate` redundant condition (#0758)**: removed `&& !url` guard that
  prevented clearing the crawl URL on explicit blank submission

### Added

- **HealthCheck engagement info (#0756)**: HealthCheckScreen reads `.swao.yml` and displays
  engagement name, client code, and lead email above the probe list
- **GuidanceBox in HelpScreen, HealthCheckScreen, ServeScreen (#0759)**: Ctrl+G guidance
  panels added to all three screens; Escape handlers guarded against panel-open state
- **LZ Catalog sync stub (#0765)**: `input-lz-provider` phase shows catalog status line
  pointing users to `swao lz catalogue update` for manual refresh; auto-sync planned

### Closed issues

\#0721, \#0725, \#0739, \#0746, \#0747, \#0754, \#0755, \#0756, \#0757, \#0758, \#0759,
\#0760, \#0761, \#0762, \#0763, \#0764, \#0765, \#0766

---

## [0.5.7] -- 2026-07-03

### Summary

Sprint-076 continuation: compliance multi-regime fix, LicenseScreen UX cleanup,
CMDB naming convention, expanded TUI regression tests (all 5 screens covered),
testing strategy strengthened with mandatory round-trip and menu-content rules,
and hardcoded YAML field path audit issue raised.

### Fixed

- **Compliance GDPR-only bug (#0748)**: `compliance-evaluator.ts` was reading
  `yml?.regimes` (top-level, never written) instead of `yml?.assessment?.regimes_active`
  (the field written by `regime-picker.ts`); all 4 bundled frameworks now appear in
  the HTML publication Compliance section when all are selected
- **LicenseScreen Activate option removed**: "Activate a license key" removed from
  the TUI licence menu (activation is handled by the operator tool); menu now shows
  3 items only: Show status, Request upgrade, Back
- **LicenseScreen header missing (#0748)**: SWAO header bar (`S W A O` + subtitle
  "Licence Management") now reliably renders on all LicenseScreen sub-screens
- **LicenseScreen request-details GuidanceBoxes**: each of the 5 request-detail steps
  (name, email, org name, org ID, EVB-IT ref) now wraps its TextInput in a GuidanceBox
  explaining the field purpose
- **CMDB sample file naming**: scaffold now creates `wsp/inputs/cmdb/cmdb-sample.csv`
  (consistent with `finops-sample.csv`, `incidents-sample.csv`, `architecture-sample.md`,
  etc.) instead of `cmdb.csv`; `.swao.yml` context_inputs path updated accordingly

### Added

- **TUI regression tests -- all screens (design 064 Section 10.8)**: component tests
  added for `CredentialScreen`, `RegimeSelectorScreen`, `LensesScreen`, `ReportScreen`,
  and `SetupWizard`; 39 TUI tests now cover every main-menu screen for: renders without
  crash, SWAO header visible, key menu items present/absent, Escape fires onBack
- **Testing strategy rules (design 064 Sections 10.7-10.9)**: YAML field-path round-trip
  test mandate (every YAML reader must test the exact nested field path), TUI menu-content
  regression test mandate (every menu change requires a test update), and bug-regression
  test mandate (every bug fix PR must include a failing test that passes after the fix)
- **Issue #0751 -- hardcoded YAML field path audit**: tracks systematic scan of all
  `.swao.yml` field accesses to ensure round-trip test coverage

---

## [0.5.6] -- 2026-07-03

### Summary

Sprint 076 QA patch: TUI bleedthrough fixes, assessment-complete log viewer key,
PDF layout fixes, HTML evidence links, GuidanceBox width alignment, startup
banner with version/tier, license UX redesign (guided request form + token
field embedding), license-tui operator tool improvements, PKG binary shell-open
fix, and Design 066 demo-framework specification.

### Fixed

- **SetupWizard Ready screen bleedthrough (#0712)**: clearScreen() before setStep('ready')
  in the playwright step's onNext callback; surplus lines from the taller Step 6 no longer
  survive above the SWAO header on the Ready screen
- **AssessScreen double-header bleedthrough (#0713)**: clearScreen() before setPhase('input-passes')
  in the regimes MultiSelect onConfirm handler; "Community Frameworks" header no longer
  bleeds through above "Application Assessment" header
- **Assessment complete log viewer (#0715)**: logFilePath lifted out of child.on('close')
  local scope into component state; L key opens assess.log in the OS default viewer;
  assess-done screen shows "L -- view log" hint when log file is available
- **PKG binary shell-open (L/A/P keys) (#0726, #0733)**: shell-actions.ts detects
  process.pkg and routes HTML paths through `cmd /c start <file:// URL>` and
  non-HTML paths through `cmd /c start <path>`; avoids the silent failure caused
  by spawning process.execPath in a PKG bundle
- **PDF summary table column layout (#0727, #0728)**: replaced `continued: true`
  (which inherits the label column width for the value) with explicit x,y coordinates
  in drawSummaryTable and drawNextStepsList; value column now wraps at the correct
  remaining width
- **HTML evidence links open in new tab (#0730)**: added `target="_blank"
  rel="noopener"` to the anchor tag in the publication renderer's evidence-link block
- **Main Menu item 8 disabled (TF Modules, #0736)**: marked as `disabled: true`
  with `[coming soon]` label; arrow navigation skips it; Enter and shortcut keys
  blocked; rendered with dimColor
- **GuidanceBox width matches header (#0737, #0741)**: both collapsed and expanded
  states use a `useStdout()` resize listener with the same formula as the header
  (`Math.min(100, Math.max(63, cols - 2))`); collapsed state now shows the `what`
  preview line below the Ctrl+G hint row
- **Startup banner version + tier (#0738)**: run-app.ts reads LicenseGuard.load()
  at startup and prints `S W A O -- Sovereign Workload Assessment and Onboarding
  vX.Y.Z (Edition)` before the TUI mounts; init.ts swaoFileHeader() includes the
  version and edition in generated workspace file headers
- **CredentialScreen GuidanceBox (#0740)**: set-pick and delete-pick sub-screens
  now show a GuidanceBox with encryption and token-type guidance
- **LicenseScreen Ink bleedthrough (#0742)**: added `key={sub}` to the root Box
  so Ink fully remounts on sub-screen changes; previous sub-screen content no
  longer bleeds through
- **License activate error message (#0743)**: malformed-key error now explains the
  `<payload>.<signature>` format and distinguishes a request token (base64url,
  no dots) from the signed activation key; activate TextInput placeholder updated
  to the correct format; `swao license request` output appends two NOTE lines
  explaining that the token is not the activation key
- **License token redesign -- user fields embedded (#0744)**: RequestTokenExtras
  extended with `licensee`, `email`, `orgName`, `orgId`, `evbItOrderRef`; these
  are Base64url-encoded into the request token; LicenseScreen adds a `request-details`
  multi-step form (name, email, org, org-id, EVB-IT ref) between tier selection and
  the `license request` CLI call so the operator receives pre-filled data
- **license-tui.mjs + issue-license.mjs validation (#0745)**: evb-it-order-ref
  removed from required-field check (now optional for both tiers); issue-license.mjs
  validates YYYY-MM-DD format before invoking the SWAO binary; license-tui.mjs
  decodes the request token to pre-fill fields and uses a validated date prompt

### Added

- **Design 066 -- Demo Community Frameworks**: specification for 4 demo-sized framework
  variants (12 controls each, cross-regime coverage selected) + demo workspace config
  + speed-optimisation runbook for 20-minute live presentations

---

## [0.5.1] -- 2026-07-01

### Summary

Sprint 075: Test Foundation + OSS Release Prep + UX Batch 2/3 + bug fixes.
Ships MCP HTTP smoke tests, TXT report formatting consistency, three-tier
release workflow symmetry, pass selector improvements, assessment-type scope
filtering, cross-regime matrix chip tooltips, evidence gallery file links,
inline signal linkifier, and LLM_SELECTION framework rename.

### Added

- **MCP HTTP smoke test suite (#0670 Phase 2)**: `mcp-http-smoke.test.ts`
  spawns `swao mcp --http` as a child process, verifies `initialize` handshake
  (200 + `mcp-session-id` header), and confirms `tools/list` returns at least
  20 tools each with a name and description
- **CLI smoke + pass smoke tests (#0670 Phase 1)**: shipped in PR #564
- **Three-tier release workflow symmetry (#0678)**: community/consultant/enterprise
  release jobs align on version tagging and artefact naming conventions

### Fixed

- **Health-check label in TUI main menu (#0690)**: item 2 detail line corrected
  from `swao doctor` to `swao health-check`
- **TXT report formatting consistency (#0697)**: section headers capitalised;
  `----` separators; `normalizeDashes()` strips U+2014/U+2013 from report text;
  `wrapLines()` word-wraps next-steps and signal descriptions at 100 chars;
  `severityLabel()` produces fixed-width 8-char severity tags; Top Findings
  deduplicates IDs already listed in Migration Blockers
- **Pass selector missing scope/malware/dynamic passes (#0692)**: all 14 passes
  now available in the TUI pass selector
- **Pass selector labels include pass numbers (#0693)**: consistent `N. Name`
  format throughout
- **Pass selector Esc/Ctrl+G (#0694)**: keyboard shortcuts work as expected
- **Assessment type scope filter (#0696)**: assessment type correctly filters
  available passes to those applicable for the selected surface
- **LLM_SELECTION framework rename (#0695)**: framework ID and references updated
  throughout
- **Cross-regime matrix chip tooltips (#0698)**: chips show control descriptions
  on hover
- **LZ label detected vs target (#0700)**: landing zone assessment correctly
  distinguishes detected services from target services in output
- **Global chip tooltip + resolved signal navigation (#0701)**: signal links
  navigate to the correct signal with highlight-all for multi-signal controls
- **Evidence gallery file links (#0702)**: links open correct evidence files
- **Inline signal linkifier (#0703)**: signal IDs in report text are
  auto-linked to their detail sections
- **Licence screen compact (#0707)**: licence screen layout tightened
- **Publish uses OS default browser (#0699)**: `swao publish` opens the
  generated HTML in the system default browser on all platforms

### Distribution

- Security scan artefacts updated to v0.5.1 (SBOM + Trivy; CodeQL/Dependabot
  require elevated PAT scope and are documented as infrastructure limitations)

---

## [0.5.0] -- 2026-07-01

### Summary

Sprint 074: OSS Gate + Architecture Publication + Bug Fixes + MALWARE Phase 2.
Ships Pass 14 MALWARE Phases 2+3, architecture publication v0.4.9, legal intake
questionnaire for OSS review, phantom regimes TUI bug fix, and source validation
improvements across the CLI, health-check probe, and setup wizard.

### Added

- **Pass 14 MALWARE Phase 2 (ClamAV + YARA)**: ClamAV and YARA rule invocations
  added to the malware scanning pass; skip cleanly when tools not installed;
  EICAR test string fixture verifies detection (#0681)
- **Pass 14 MALWARE Phase 3 (ORT feature flag)**: OSS Review Toolkit integration
  skeleton with feature flag; copyleft licence fixture test (#0681)
- **Health-check source accessibility probe**: `checkSourceAccessibility()` in
  `@swao/module-health-check`; warns when source path is unconfigured, missing,
  or contains only README files; wired into `HealthCheckPayload` (#0516 AC#3)
- **Automated testing strategy**: `docs/design/064-automated-testing-strategy.md`
  -- 9-layer stack (L0 audit gates through L9 Playwright browser), three ASCII
  architecture diagrams, 5-phase 36pt implementation plan for sprints 075-079 (#0670)

### Fixed

- **TUI phantom regimes bug (#0689)**: framework selection screen now passes the
  user's chosen IDs through `onConfirm`; `readAppRegimes()` result filtered against
  the explicit selection; hardcoded `['GDPR']` fallback removed
- **Empty-source guard in `swao assess` (#0516 AC#1)**: `checkSourceNonEmpty()`
  check before any pass runs; exits with a descriptive error if source directory
  contains no source files beyond README
- **Setup wizard git URL as primary input (#0516 AC#2)**: Step 1 label and
  placeholder are git-URL focused; ambiguous inputs (neither URL nor absolute path)
  are blocked with an inline yellow warning; GuidanceBox lists GitHub / Azure DevOps
  / GitLab / SSH / local path examples

### Changed

- Architecture publication `docs/publications/0003-architecture-overview-EN/index.html`
  updated to v0.4.9: 10 bundled frameworks, 22 MCP tools, Community/Consultant/Enterprise
  tier model, WSP spine schema v0.11, legal notice 2026-06-30 (#0684)

### Distribution

- SEA binary VirusTotal baseline documented in `docs/releases/`; mammoth static-import
  prerequisite fix verified (#0683)
- Legal intake questionnaire (`docs/legal/legal-approval/`) completed for Accenture IP
  review; companion `questionnaire-answers-draft.md` lists `** CONFIRM **` markers (#0684)

---

## [1.0.0] -- 2026-06-30

### Summary

SWAO v1.0.0 is the first public Community Edition release under Apache-2.0.
It ships a production-quality cloud workload assessment CLI with a 14-pass
analysis engine, nine bundled compliance frameworks, a full TUI, an MCP
server, and a complete HTML publication engine.

### Added

**Three-tier edition model (Community, Consultant, Enterprise)**
- Community Edition: full assessment engine under Apache-2.0, no registration,
  no machine binding, unlimited use
- Consultant and Enterprise tiers: add PDF reports, BI templates, portfolio
  assessment, and engagement tooling (commercial licence, issued by Accenture)
- Runtime tier enforcement via `requireTier` guards (ADR-0049)
- Per-tier binary builds (`swao-community-*`, `swao-consultant-*`, `swao-win-x64.exe`)

**Modular architecture (@swao/core + @swao/module-* packages)**
- Host-injected module pattern: CLI host injects premium modules at startup;
  Community build ships without premium code paths in the bundle
- `@swao/core`: shared types, LicenseGuard, provider interfaces
- `@swao/tui-kit`: presentational licence-gate component (leaf package, no
  circular dependencies)
- `@swao/module-mcp`, `@swao/module-pdf-report`, `@swao/module-portfolio`,
  `@swao/module-challenge`: premium feature modules

**14 analysis passes**
- Pass 01 Inventory: language, framework, dependency tree
- Pass 02 Statefulness: data persistence, session, cache topology
- Pass 03 Data Classification: PII, PHI, financial data signals
- Pass 04 Context Ingestion: CMDB / ServiceNow / FinOps / transcript inputs
- Pass 05 SBOM CVE: vulnerability scan via OSV API
- Pass 06 12-Factor: twelve-factor app compliance check
- Pass 07 Egress: third-party API call surface and data flows
- Pass 08 Cryptography Posture: cipher suite, key management signals
- Pass 09 Synthesis: LLM-assisted 7R classification and migration recommendation
- Pass 10 Dynamic Analysis: opt-in Playwright browser crawl
- Pass 11 Compliance Evaluation: per-control assessment for all active frameworks
- Pass 12 Block Assessments: migration blockers with remediation guidance
- Pass 13 Scope Coverage: blind-spot detection and coverage scoring
- Pass 23 Landing Zone Readiness: LZ fit assessment (application, hybrid, lz types)

**Nine bundled compliance frameworks (Apache-2.0)**
- GDPR 2016/679
- NIST SP 800-66r2 (HIPAA Security Rule guidance)
- PCI DSS 4.0.1
- ISO/IEC 27001:2022
- AICPA SOC 2 Trust Services Criteria
- BSI Cloud Computing Compliance Criteria Catalogue (C5) 2020
- DORA (Digital Operational Resilience Act) 2022/2554
- AI 10 Pillars (Accenture Responsible AI framework)
- COBIT 5 IT Governance Framework

**TUI (interactive terminal UI)**
- Assessment type picker (Application, Landing Zone, Hybrid)
- App selector, pass selector, LLM provider toggle
- Live output viewport (bounded, Ctrl+G for guidance collapse)
- BI export panel with Power BI Desktop shortcuts
- First-time setup guidance for new workspaces

**MCP server**
- HTTP transport on `localhost:3737` (ADR-0045)
- Tools: `swao_assess`, `swao_report`, `swao_signal_inspect`
- `--type` forwarding for landing zone and hybrid assessment types
- Compatible with Claude Desktop and Claude Code

**HTML Publication Engine**
- Mode A: single self-contained HTML file per assessment
- Publication block library: compliance-framework-detail, signal matrix,
  egress map, migration recommendation, coverage heatmap, auditor evidence
- Compliance framework detail block with full hierarchy and signal links
- Dark mode, mobile-responsive, offline-capable

**BI Export Bundle**
- CSV star schema + NDJSON + XLSX output via `swao export`
- Four Power BI `.pbit` templates: App Report, Portfolio Overview, Auditor
  View, Compliance Matrix
- Single `SWAOWorkspaceRoot` parameter -- all derived paths auto-computed

**`swao doctor` (10-probe pre-flight)**
- Probes: licence, Playwright, MCP, compliance catalogues, imports,
  traceability, BI export, scope, prerequisites, vcs-auth
- Expiry warning for licence keys nearing end of validity

**Community framework authoring**
- `framework-meta.yaml` + `controls.yaml` schema (ADR-0035)
- `swao framework install <id>` -- workspace-local installation
- LicenseGuard does NOT gate framework catalog access -- all tiers can use
  all bundled community frameworks

**Distribution and security**
- Multi-platform binaries: linux-x64, darwin-x64, darwin-arm64, win-x64
- Multi-arch Docker image: `ghcr.io/accenture/swao:v1.0.0` (amd64 + arm64)
- SHA-256 checksums published alongside every release
- VirusTotal hash lookup gate in release CI
- SBOM (CycloneDX) generated at release time

**Pluggable provider interfaces (§15a)**
- LLM: Anthropic (recommended), OpenAI, Ollama (air-gapped), stub (CI)
- VCS: GitHub, GitLab, Azure DevOps (read-only clone scopes)
- Redactor: pre-LLM secret scan with PII/credential detection
- Air-gapped profile: full pipeline against local Ollama with no outbound

**Licensing system**
- Ed25519 offline-verified licence keys, machine-bound, no call-home
- `swao license issue --json` for operator licence issuance
- `swao credential set` for LLM API key management

### Changed

- Binary renamed to `swao-win-x64.exe` (from `swao.exe`) for clarity
- All assessment types (app, audit, landing-zone, llm, hybrid) reachable
  from TUI
- LLM cache disabled by default (opt-in with `--cache`)
- GDPR framework enabled by default on `swao init`
- Compliance filter chips for all frameworks in HTML publication
- Cross-regime coverage matrix control IDs are clickable
- Power BI templates use single `SWAOWorkspaceRoot` parameter

### Security

- xlsx replaced by exceljs in premium tier (CVE-2023-30533, CVE-2024-22363)
- uuid overridden to >=11.1.1 (CVE-2026-41907)
- SBOM + VirusTotal hash gate added to release workflow
- Playwright Chromium excluded from all binary builds
- Pre-LLM redaction verified on every provider call; failure aborts the run

---

For issues and questions: https://github.com/Accenture/SWAO/discussions
For bugs: https://github.com/Accenture/SWAO/issues
