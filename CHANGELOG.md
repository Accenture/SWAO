# Changelog

All notable changes to SWAO are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and SWAO adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.4.2] - 2026-10-21

Patch release from a field test of 1.4.1 on a corporate network with a self-hosted,
OpenAI-compatible LLM gateway behind a self-signed certificate chain.

### Fixed

- Assessment start check (application and landing-zone assessments): calls
  `{base_url}/v1/chat/completions` like the provider (a `base_url` ending in `/v1` is
  kept), pings the model configured for the run instead of the connector default, and
  honours `tls.reject_unauthorized: false` of the connector. It no longer reports
  HTTP 404 for OpenAI-compatible connectors whose `base_url` has no `/v1` (#3385)
- Setup wizard connectivity check: pings the model selected in the LLM step and uses
  the connector's TLS and proxy settings (#3381)
- LLM requests that fail on an untrusted TLS certificate are no longer retried six
  times; they fail at once and name the fix (`tls.reject_unauthorized: false` or
  `tls.ca_bundle` in the connector file, or `NODE_EXTRA_CA_CERTS`) (#3384)
- Setup wizard Init step uses the folder SWAO was started in as the portfolio root
  instead of asking for a directory; a workspace created in a sub-folder was not found
  by the health check and the support bundle (#3373)
- Health check: no configured LLM is reported as WARN ("LLM passes will be skipped")
  instead of OK and does not count as a failed probe; a missing `git` is WARN unless
  an app declares a VCS source (#3375)
- Setup wizard: MCP Client step hint lines no longer render side by side (#3386);
  step headers no longer show a hard-coded step number that disagreed with the
  stepper (#3377)
- Terminal screens that stream child output (assessments, stakeholder challenge) no
  longer show Node process warnings; the "TLS certificate verification disabled"
  warning is logged once per connector instead of on every LLM call (#3387)

### Security

- Bedrock provider: the "model does not support tool use" detection no longer uses a
  backtracking regular expression on provider error messages (CodeQL
  js/polynomial-redos, #3394)
- Documentation site build dependency `vite` updated to 6.4.5

---

## [1.4.1] - 2026-10-20

First public release of the 1.4 line; v1.4.0 was an internal build and was not published.
Contains everything listed under 1.4.0 below.

### Fixed

- Pass support catalogues are found inside the bundled release binaries; Pass 03,
  05, 08 and 21 no longer fall back to "catalogue not found" (#3358)

---

## [1.4.0] - 2026-10-19

Minor release: Service Portfolio Assessment, a new assessment type that assesses
third-party, SaaS, and COTS application portfolios from an Excel inventory with no
source code required (sprint-150), plus the sprint-151 hardening round:
licence tiers aligned across the three editions, a Community binary without Consultant
or Enterprise content, one request layer with retries, timeouts, and a concurrency limit
for every LLM provider, one run-status lifecycle for every run type, landing-zone targets
in `.swao.yml`, and validated, workspace-confined MCP tools.

### Added

- Pass support catalogues with a two-tier model: product defaults in
  `pass-catalogs/` (PII patterns for Pass 03, runtime end-of-life data for
  Pass 05, crypto algorithms for Pass 08, IAM providers for Pass 21), merged
  with workspace overrides in `wsp/inputs/pass-catalogs/`; on an id collision
  the workspace entry wins (#3062-#3066)
- Pass 21 IAM detection (opt-in): recognises German public eID and identity
  providers such as BundID and ELSTER from imports, configuration keys and
  environment variables (#3062)
- Pass 08 detects weak or deprecated algorithms from the catalogue in Java,
  Python, .NET, Go and Kotlin sources as well as JavaScript and TypeScript (#3063)
- Pass 03 deterministic PII pre-pass for German social-law and health-data
  identifiers when no LLM is configured (`DATA` signals) (#3064)
- Pass 05 runtime end-of-life detection from build files (Gradle, Maven,
  pyproject, `.nvmrc`, Dockerfile) (#3065)
- Community frameworks SGBX_DE (social data protection, SGB X sections 67-85)
  and BSI_TR_03107 (eID trust levels and qualified signatures) (#3061)
- Portfolio hub publication: cross-link grid to every app publication (#3059)
- `service` assessment type registered in the assessment type router, with a
  Community tier feature gate (`service-assessment`) (#3071, #3074)
- TUI Select Assessment Type lists Service Portfolio Assessment as entry [2]
  (#3073); selecting it opens the intake screen (#3075)
- `swao service init --from intake.xlsx [--mapping column-map.yaml]`: scaffolds one
  `apps/<id>/.swao.yml` per intake row with `assessment.type: service` (#3075, #3077)
- Custom intake column mapping with Zod validation (#3076)
- Combined ID/name cell parsing and operational flags (restricted, decommissioned,
  unused, inactive) (#3082)
- PII guardrail: contact, phone, and email columns are stored as presence booleans
  only; personal-name vendor values are redacted (#3081)
- SWAO-INFRA-CAT Tier 1 catalogue under `controls/infra-catalogue/` with
  prefix, vendor, and product-name classification plus workspace Tier 2 overrides
  and site mapping (#3079)
- Cluster detection consolidates identical rows into one assessment (#3080)
- SCAFFOLD signal catalogue written to `wsp/signals/scaffold-signals.json` (#3083)
- Health check probe 17/17: intake column-mapping validation (#3084)
- `swao service research [--app <id>] [--refresh] [--dry-run]` (Pass 24 RESEARCH): hydrates
  per-app research stubs from NVD, endoflife.date, CISA KEV, BSI WID / CERT-Bund, OSV.dev,
  and VirusTotal (own `VT_API_KEY`), with rate limits, cache periods, and per-topic
  confidence plus `confidence.json`; only vendor, product, version, and OS data are sent
  (#3086-#3092)
- `swao assess` runs service apps (`assessment.type: service`) through the service pass
  profile: INV, STATE, TF, and EGR are skipped (no source code), DATA, SBOM, CRYPTO,
  DYNAMIC, and MALWARE run only when their inputs exist, with service-mode DATA and CRYPTO
  runners for intake data fields, data-flow documents, and config files; runs record
  `assessment_type: service`, `latest-service.txt`, and `scope-coverage.json` (#3093-#3098)
- SWAO_APM community framework (approved, closes #2811): 11 domains, 72 controls,
  `domain_weights` and TIME rules in `framework-meta.yaml`; deterministic per-app health and
  risk scores, a TIME recommendation (Tolerate / Invest / Migrate / Migrate-Critical /
  Eliminate), and `wsp/portfolio-summary.json` rebuilt after each service assessment or
  research run (#3099-#3101, #3103)
- Health check probe 18/18: SWAO_APM domain_weights integrity (#3102)
- Pass 25 BINARY: offline static analysis of supplied installers (PE headers,
  architecture, .NET and Visual C++ runtime vintage, Authenticode signer and timestamp,
  MSI Property table) with BINARY.* signals (UNSIGNED, EXPIRED_CERT, LEGACY_RUNTIME,
  LEGACY_ARCH, COMPILATION_DATE_ANOMALY); feeds VirusTotal, service CRYPTO, and SWAO_APM;
  no new dependencies (#3104-#3107)
- Lift-and-shift cloud cost estimate per service app (cheapest fitting Azure / AWS
  general-purpose size from an embedded, dated price table); reported in EUR by default,
  other currencies via `service_portfolio.cost.currency` and `exchange_rates` in the
  workspace `.swao.yml`; unit-suffixed memory and disk values in the intake are
  normalised (#3108-#3110)
- Portfolio analytics in `wsp/portfolio-summary.json`: integration graph with fan-in and
  blast-radius tiers (`wsp/inputs/integration-graph.json`), a 5-wave migration plan
  (`wsp/reports/migration-waves-YYYYMMDD.md` / `.csv`), and vendor consolidation groups
  with opportunity scores; `swao service research` records a delta report against the
  previous snapshot (`wsp/reports/portfolio-delta-YYYYMMDD.md`, 4 snapshots kept)
  (#3111-#3115)
- `swao service export` (Enterprise, `service-excel` + `bi-export`): 14-sheet portfolio
  workbook `wsp/reports/swao-portfolio-YYYYMMDD.xlsx` and 9 star-schema tables
  `wsp/star-schema/portfolio-*.json` with Zod row schemas; the PowerBI templates stay
  Application Assessment only (#3116-#3119)
- HTML publication for service apps: section guards per assessment type, service blocks,
  Integration Hubs, Migration Roadmap, and Vendor Landscape blocks; engagement hub cards
  show TIME, CVE, and end-of-life status (#3120-#3126)
- Health check probes 19-25 for service workspaces (service workspace, research cache,
  vendor catalogue, cluster detection, PII scrub audit, delta snapshots, SWAO_APM
  controls); 25 probes in total (#3127-#3134)
- Support bundle for service workspaces: service artefacts plus a second PII redaction
  pass documented in `redaction-log.txt`; phone-number redaction in core (#3135, #3136)
- TUI: run the service assessment from the Service Portfolio screen and show the skipped
  pass count (#3144)
- Documentation (EN + DE, VitePress): Service Portfolio Assessment (8 pages), the four
  assessment types, all analysis passes (overview plus one page per pass), the community
  frameworks (overview plus one page per framework), v1.4.0 release notes; sidebar
  numbered like the TUI (#3137-#3140, #3147, #3151, #3156)
- Service intake location `wsp/inputs/service-intake/`: without `--from`, `swao service
  init` uses the single `.xlsx` there (Excel lock files ignored) and a `*column-map*.yaml`
  next to it as the column map; no workbook or several workbooks stop the command with an
  error that names what was found, never a prompt (#3211)
- `swao service init` prints the recognised intake columns (field and column letter) and
  warns when the OS, app name, or vendor column is missing (#3168)
- `swao service rank [--top <n>] [--json]`: service apps in assessment priority order
  (SWAO_APM risk, then integration fan-in, then ID; decommissioned, unused, and inactive
  apps left out) for top-N runs and CI loops over `swao assess --app <id> --type service`
  (#3165)
- `wsp/portfolio-summary.json` records per app `assessed`, `evidence` (`sufficient` or
  `insufficient`), and `evidence_missing`, plus `assessed_count` and
  `insufficient_evidence_count`; engagement hub cards show "Not assessed" and "Evidence:
  insufficient" badges (#3196, #3197)
- LLM egress redaction logs a `provider.llm.egress.redacted` event with provider, model,
  and counts only, never text or values (#3173)
- `swao service init` normalises German and mixed-language intake terms (criticality, TIME,
  classification, department and function names) to English values and keeps the
  client's wording next to them; `service_portfolio.glossary` in the workspace `.swao.yml`
  overrides the built-in glossary (#3210)
- MCP tools for Service Portfolio Assessment: eight read tools (`swao_service_portfolio`,
  app, research, waves, vendors, delta, scaffold, runs) and three write tools (init,
  research run, and the Enterprise export) (#3213, #3303)
- LLM-augmented service research in every tier for vendor profile, certifications, data
  residency, and breach history: answers are validated, model-cited sources are marked
  unverified, topic confidence is capped at medium, and structured findings raise the
  RES-10 to RES-14 and `VENDOR.BREACH_HISTORY` signals; `swao service research
  --skip-llm` turns it off (#3289, #3304, #3308)
- Combined portfolio view: `wsp/portfolio-summary.json` lists application apps next to
  service apps with `assessment_type`; application apps are scored from their latest
  usable run with a TIME label from the 7R recommendation, and waves, integration graph,
  and vendor consolidation cover both types (#3280)
- Service cost estimate prices from the Azure Retail Prices API and the AWS Price List
  API with Linux and Windows prices (`lz-catalogues/prices/vm-prices.json`), refreshed by
  `swao lz catalogue update` (`--skip-prices` skips it) (#3242, #3288)
- Landing-zone targets in `.swao.yml`: `assessment.landing_zone.targets` in the workspace
  or app file (`<provider>:<region>` or `<provider>:<geography>`, one geography model for
  every catalogue) drives the LZ Catalog run, the inline fit of an Application Assessment,
  and the TUI; the Setup Wizard has an LZ target step (#3281, #3306)
- `run-status.json` in every application, service, and LZ catalogue run folder: `started`,
  then `complete`, `partial` (skipped LZ targets or failed passes), `failed`, or `aborted`
  (also on Ctrl+C, termination, and unexpected exit), with the targets of the run; readers
  skip unusable runs (#3245, #3283, #3306)
- `swao report --run <id>` for application and landing-zone-catalog reports; an unknown,
  malformed, or wrong-type run id exits 1 without writing a report (#3343, #3346)
- `providers.llm.max_concurrency` (default 4, 1 to 64) limits LLM requests in flight per
  endpoint; the app `.swao.yml` wins over the workspace file and the connector. Pass 11
  sends its batch prompts concurrently within that limit (#3222, #3284)
- Health check probe 15 validates the bundled and workspace LZ catalogues (metadata,
  structure, age, geography coverage) and the configured targets (#3282)
- Tool calling for the Ollama and Bedrock providers in SWAO Chat (#3311)
- The five reference catalogues under `controls/` (vendor SDK, database compatibility,
  legacy indicators, licence risk, sovereign service) are read by the passes; a missing
  or invalid catalogue is recorded as skipped (#3160)
- COBIT 5 community framework re-authored in original wording and shipped again (#3292)
- `swao assess` logs every post-pass step with its duration
  (`assess.post_run.<step>.start` / `.complete`) and rebuilds the portfolio summary after
  each complete or partial run (#3224, #3309)

### Changed

- TUI main menu and Help screen describe the four active assessment types:
  Application / Service Portfolio / Landing Zone Catalog / LLM (#3073)
- Passes run in one canonical order: COMP sees DYNAMIC, SCOPE, MALWARE, and the current
  LZR result; LZR runs before SYNTH; BLOCKS runs last with this run's SYNTH context. The
  LZR advisory verdict can now shift the 7R recommendation (#3152)
- `--skip-llm` guarantees that no LLM call is made; an unusable LLM answer degrades the
  pass (`invalid_llm_response`, SYNTH-00) instead of aborting the run (#3158)
- Pass 11 COMP uses the workspace `assessment.regimes_active` list when an app has none;
  the app list always wins (#3148)
- `swao framework install` copies into `wsp/inputs/catalogs/community/`, the folder
  Pass 11 reads (#3149)
- Publications without a configured `publication.classification_band` show the product
  name in the classification band instead of an internal company label
- Service Portfolio TUI: the intake path is pre-filled from `wsp/inputs/service-intake/`,
  the column-map question says that Enter detects the columns from the header row, and one
  scope question (top 20 by risk, every app, or scaffold and research only) is followed by
  init, research, assessment, and the Enterprise export without further prompts, with
  shared progress bars, elapsed time, ETA, capped live output, and Esc to cancel (finished
  apps are kept) (#3164, #3165, #3166, #3169)
- Service apps get one empty `apps/<id>/ingestion/` drop folder instead of hint
  subfolders. Pass 00 reports new, changed, and unchanged documents and, in every
  assessment type, references installers anywhere under `ingestion/` instead of copying
  them; Pass 25 BINARY analyses them in place. Documents enable service DATA; installers
  and SBOMs enable CRYPTO, SBOM, and MALWARE; existing hint folders keep working (#3212)
- Research topics with nothing to look up (CVE without vendor, product name, and OSV
  package; end of life without OS) are recorded as `skipped` with `skipped_reason:
  no_input` and `missing_inputs` instead of low confidence; the research summary prints
  the composite confidence and one line per topic (#3168)
- SWAO_APM: a TIME label without end-of-life and CVE evidence, and not decided by the
  operational status, carries the reason prefix "insufficient evidence" and is left out of
  the portfolio risk mean; `bsi_advisories` scores only a completed feed match, and an
  empty integration list counts only when the intake had an integration column (#3196,
  #3197)
- Licence tiers aligned for every entry point (CLI, TUI, MCP): SWAO Chat, the MCP server,
  and MCP registration (`swao mcp install`, `swao init --mcp`, Setup Wizard step) are
  Enterprise; `swao generate-tf` is Enterprise; `swao publish --portfolio` is Enterprise
  (coming soon). A missing licence prints a `[LICENSE]` message and exits non-zero
  instead of a stack trace or a hang (#3314, #3318, #3321, #3322, #3341)
- HTML publications are Consultant+ for every assessment type (`swao publish --app`,
  `--lz`, `--llm`, `--combined`, `--block-profile`, and `swao report --format html`);
  running assessments of every type stays Community (#3320, #3338)
- Power BI `.pbit` templates are Consultant+: the Community binary does not package them
  and Community `swao init` does not write them; `swao export` still writes the star
  schema in every tier; `swao service export` stays Enterprise; Community `swao lz
  catalogue update` prints a Consultant licence message (#3323, #3324, #3338)
- Community binary packages no Consultant or Enterprise content (Power BI templates,
  premium frameworks, PDF renderer data) and no internal text; the Enterprise service
  export is not part of the Community and Consultant builds; licence messages and help
  texts match the runtime gates (#3325, #3339, #3352, #3353)
- MCP registration copies only SWAO binaries, uses the platform's stable binary name of
  the running tier, and never overwrites a binary of another tier; probe 3 recognises
  node-registered entries (#3217, #3286, #3295, #3341)
- Every LLM provider (Anthropic, OpenAI, Ollama, open-LLM gateway, Bedrock) uses one
  request layer: 6 attempts with 3 to 48 s back-off on 408, 429, and 5xx, a per-attempt
  idle timeout (`SWAO_LLM_IDLE_TIMEOUT_MS`, default 120 s), a 600 s cap per attempt, and a
  `waiting` event every 60 s; SWAO Chat uses at most 3 attempts; usage and cost are
  returned per call (#3221, #3225, #3284, #3301)
- Replaced event codes (see `docs/runbooks/log-events.md`): `provider.bedrock.retry` is now
  `provider.llm.bedrock.retry`; `provider.llm.anthropic.tool-call-attempt` is now
  `provider.llm.anthropic.attempt` with `kind: tools`; the app-scope
  `provider.llm.gateway.ok`, `provider.llm.gateway.http-error`, and
  `provider.llm.gateway.empty-response` are now `provider.llm.open-llm-provider.ok`,
  `.http-error`, and `.empty-response`. Every provider writes
  `provider.llm.<provider>.attempt|waiting|timeout|http-error|retry|ok|error|connectivity-failure`
  to the portfolio log and, in an app context, to the app log (#3284)
- An LZ catalogue run continues past a failing target (for example an unknown region),
  logs it, and closes as `partial`; skipped targets are shown in the LZ report, the HTML
  publication, and the engagement hub. `assessment.lz_cat_targets` is deprecated and
  still read (#3223, #3281)
- The community framework list, the SWAO-INFRA-CAT built-in list, and the LZ catalogue
  list are built from each artefact's own metadata; `_registry.yaml` and
  `lz-catalogues/index.json` are retired (#3297, #3298, #3299)
- `swao init` writes the workspace `.swao.yml` when it is missing and never overwrites it;
  `swao init --reconfigure` without `--name` reconfigures the workspace only and creates
  no app (#3344, #3347)
- Health check: a missing credential vault is a WARN; the SWAO MCP probe reports a slow
  binary separately from an unreachable one (#3333, #3344)
- MCP: all 55 tools validate their input with one schema each and advertise the
  `inputSchema` generated from it; `serverInfo` reports the build version (#3307, #3332)
- Service portfolio headline figures (risk score, TIME distribution) cover assessed apps
  only; `swao service rank` and the wave views mark not-assessed apps; the DORA ICT
  register lists apps with a third-party vendor only (#3241, #3290, #3309)
- Sourced reference data: sovereign-service verdicts with vendor sources and review dates,
  LZ residency pins from provider documentation, LZ catalogue certification vocabulary
  (#3287, #3296, #3302)
- Support bundle records challenge iteration statistics for application and LZ
  challenges (#3339)
- `pnpm test` runs the workspace packages one at a time and process-spawning tests in a
  sequential project, with a 20 s default test timeout (#3317)

### Fixed

- Licence check caches the machine hardware id per process, so test runs no
  longer spawn the hardware lookup once per test (#3070)
- EC_CSF and SECNUMCLOUD catalogues load again (evidence `signal:` key accepted); every
  bundled catalogue is loaded in a test (#3150)
- Pass 23 LZR derives the provider from the selected landing zone, reports warning-level
  results, and parses JSON plans; synthetic fixtures replace the deleted examples (#3142,
  #3153)
- Pass 00 references installers instead of copying them into the intake folder (#3145)
- Pass 10 DYNAMIC signal IDs are unique; Pass 05 OSV severity, Pass 06 nested Terraform
  roots, Pass 08 AES-GCM signal and no-primitive fallback, Pass 09 current-run LZR
  verdict (#3152, #3158)
- Pass 24 RESEARCH and Pass 25 BINARY signal and parsing gaps (#3154)
- Landing-zone fit uses workspace catalogue copies; C5 certification naming aligned; `lz
  catalogue list` shows workspace-only providers (#3155)
- `swao service init` keeps the full identity text as the app ID when the cell has no
  `(`, so distinct rows no longer collide on a duplicate ID (#3162)
- Test infrastructure: hidden core tests run again, a synthetic demo run replaces the
  deleted example run, provider tests no longer reach the network (#3143, #3146, #3159)
- Intake header detection without a column map: exact aliases first, then prefixes at a
  word boundary (long OS or programme headers are recognised, "Migrationsprojekt" is not
  "migration"); phone, e-mail, contact, and "Hersteller Support" headers are always
  presence-only PII columns and never the vendor name; "Active Memory" maps to
  `active_memory_mb`; without a separate name column the identity column is read as the
  combined `ID (Name) notes` form (#3167, #3168)
- Identity cells: the app ID is the code before `(`, cut at the first operational flag
  phrase and at a spaced dash; the name is the bracket text; note text never reaches the
  ID or the name; single "nicht starten" or "nicht löschen" phrases and flags inside the
  brackets are recognised; umlauts are transliterated and dash runs collapsed.
  `swao service init` lists existing service apps that the intake no longer produces and
  leaves them untouched (#3167)
- The setup wizard, `swao init --mcp`, `swao mcp install`, and health-check probe 3 update
  every Claude Desktop config that already has a SWAO entry, not only one (#3163)
- Health check: one failure definition drives the NDJSON event, the exit codes, and the
  setup wizard summary (#3170); the service probes log `probe.start` before each
  `probe.complete` and time each probe on its own (#3171); the IaC toolchain probe prints
  the Terraform version correctly (#3172)
- `swao assess` without a provider key warns and skips the LLM passes instead of hanging
  (#3340)
- The LZ Sovereignty Challenge reads single-target fit results; a run without fit
  results is reported as not applicable without an LLM call (#3342)
- Reports, publications, MCP `swao_read_challenge`, the support bundle, and the Publish
  screen embed only the challenge of the reported run (#3330, #3336)
- The Enterprise and Consultant text reports no longer claim Community Edition when no
  challenge was run; the note names the required tier (#3345, #3346)
- `swao assess --portfolio` and `swao report --portfolio` run every app in the binary,
  and the binary no longer spawns itself with `node -e` (#3319, #3335)
- `swao export --no-bom` and `--no-templates` take effect (#3324, #3337)
- SWAO Chat shows MCP errors instead of empty results; a failing tool call is returned
  to the model instead of ending the turn (#3312, #3315)
- `health-check --json` runs each probe once (#3215)
- Reports, publications, and the engagement hub normalise dashes at every text sink and
  show a localised `n/a` placeholder for missing data (#3240, #3244, #3291, #3305)
- Service runs apply Kubernetes and service-mesh blind spots only with container
  evidence (#3246)

### Security

- Pre-LLM redaction runs in every LLM driver, including Ollama and the gateway path,
  through one `scrubForEgress` helper; the audit gate checks all five network drivers
  (#3157)
- JSON embedded in publication `<script>` tags escapes `<`
- MCP file tools read only inside the workspace root; a caller-supplied
  `workspace_path` must be a SWAO workspace root; `app_id` is validated on every tool;
  one credential exclusion list applies to source paths; service init inputs are
  checked (#3313, #3316)
- MCP `swao_portal_query` runs in-process, accepts loopback hosts only, and follows no
  redirects (#3335, #3339)
- The support bundle replaces the home directory, user name, and host name in every
  file it writes (#3331)
- Console log lines strip line breaks and control characters (log injection) (#3340)

### Known issues

- An unexpected internal error in a short-lived Enterprise command writes a crash log
  but can leave the process running; stop it with Ctrl+C (#3354)

---

## [1.3.1] - 2026-10-09

Patch release: challenge-pass YAML parse fix, Community Docker binary-wrap, GPG release
signatures, fast-jwt CVE fix, license request Ctrl+C fix, BlackDuck stale-scan
documentation (sprint-148).

### Fixed

- LLM-assessment challenge pass: relax YAML block-sequence heuristic so claude-sonnet
  correctly parses C1 application-agent responses; parse_valid_rate was 0 on all 5 C1
  passes (#3030)
- release-community.yml Docker publish: apply binary-wrap pattern to Dockerfile.community
  so the container uses the pre-built binary instead of running pnpm install in a no-op
  environment (#3031)
- TUI license request: write output to file on success; previously Ctrl+C closed the app
  instead of copying the request payload (#3048)

### Security

- GPG detached signatures (.asc) added to all release binary artefacts in
  release-enterprise.yml, release-community.yml, and release-consultant.yml (#3049)
- fast-jwt upgraded to 6.3.4 via pnpm override to fix CRITICAL CVE-2026-34950
  (RSA to HS256 algorithm confusion via non-whitespace key prefix) and MODERATE
  GHSA-687g-22h4-j4w4 (clockTolerance bypass); transitive via module-html-portal

---

## [1.3.0] - 2026-10-08

Minor release: support bundle v2.3, kilo.ai MCP integration (Phase 1), duration_ms
observability, --fail-on exit-code gate, kilo-context export, LZ verdict fix,
NODE_ENV production flag (sprint-147).

### Added

- Support bundle v2.3: NDJSON activity cache, connector metadata inventory,
  challenge-agent registry, 7-day error-context retention; `swao support-bundle`
  command (#3014, #3015, #3016, #3019)
- kilo.ai MCP integration Phase 1: `.kilorc` descriptor, install guide, MCP
  streamable-HTTP endpoint at `/mcp`; client workspace scaffold for kilo.ai Phase 2
  assessment (#2969, #3020, #3021)
- `swao export --format kilo-context`: emit WSP as kilo.ai context YAML for
  in-IDE sovereignty queries (#3021)
- `--fail-on` flag: exit non-zero when assessment findings meet severity threshold;
  enables CI/CD gate use of SWAO output (#3022)
- `duration_ms` field on all assessment events alongside existing `elapsed_ms`;
  aligns with Design 098 event schema (#2970)
- Startup heartbeat in `open-llm-provider` for cold-start observability (#3013)

### Fixed

- LZ verdict sections missing from catalog output; `regionSummaries.length > 0`
  guard corrected (#2993)
- Binary entry point sets `NODE_ENV=production` to suppress dev-mode warnings
  and enable production optimisations (#3018)

### Changed

- SWAO CI/CD runbook updated with MCP smoke-test checkpoint (#3012)

---

## [1.2.4] - 2026-10-05

Patch release: security patches (Dependabot, CodeQL), client PoC connector fixes
(sprint-144).

### Fixed

- `buildFetchDispatcher` and inline class dispatcher now honour `NODE_TLS_REJECT_UNAUTHORIZED=0`
  env var; undici `ProxyAgent` does not read that env var via its own TLS stack (#2934)
- `parseConnectorYaml` accepts YAML with a leading UTF-8 BOM; `js-yaml` strips it per YAML 1.2
  spec; BOM-prefixed connector YAML written by `SWAO-Session-Setup.ps1` pre-v1.10 silently
  failed to resolve the connector -- v1.11 writes BOM-free (#2935, #2937)
- CodeQL `js/double-escaping`: `decodeXmlEntities` (transformer.ts) now uses a single-pass
  regex switch; eliminates double-unescaping of `&amp;lt;` chains (#2933)
- CodeQL `js/polynomial-redos`: `gateway-probe.ts` token-expiry check replaced `access
  token.*expired` regex with two `lc.includes()` calls; linear time, ReDoS-safe (#2933)
- `undici` override raised to `>=8.10.2` in scripts/; installed 8.11.2 (10 Dependabot alerts)
- `brace-expansion` raised to 5.0.12 in swao-premium lockfile (3 Dependabot alerts) (#2932)
- `proxy-addr` raised to `>=2.0.8` (CRITICAL GHSA-jqcg-44mw-7w3h via MCP SDK>express) (#2932)
- `source-map-js` raised to `>=1.2.2` (HIGH GHSA-68fv-2mgg-jv7q via vitest>postcss) (#2932)
- `sprintf-js` and `braces` (no patch available) added to `auditConfig.ignoreGhsas`; dev-only
  transitive deps, not shipped in binaries (#2932)

### Added

- TLS env var test suite for `buildFetchDispatcher` covering no-proxy, proxy, and regression
  cases; added to `open-llm-provider.test.ts` (#2934)
- BOM connector YAML test confirming `parseConnectorYaml` accepts BOM-prefixed input (#2937)

### Changed

- `SWAO-Session-Setup.ps1` v1.11: BOM-free connector YAML write; client-neutral naming (#2935)
- `SWAO-Assess.ps1` v1.7: client-neutral naming throughout (#2935)

---

## [1.2.3] - 2026-10-04

Patch release: SWAO Chat UX, MCP stability, smoke and test infrastructure, observability gaps
(sprint-143).

### Fixed

- SWAO Chat message history pane overflows terminal when > 5 messages exchanged; sliding-window
  line cap applied in `ChatScreen.tsx` to keep input prompt always visible (#2912)
- `swao_challenge` MCP tool returned only the challenge directory path, not the file content;
  `handleChallenge()` now reads and returns the YAML text (#2721)
- `binary-e2e.test.ts` referenced stale binary name without `-x64` suffix; all E2E tests
  silently skipped; correct name applied (#2706)
- Health-check [4/16] `community-frameworks` probe shows "no catalogs at ..." INFO when
  frameworks are bundled in the binary; `bundled_count` field added to probe result; formatter
  now shows "ok -- N bundled frameworks available" when `bundled_count > 0` (#2910)
- Smoke G2 diff compared cross-run-type pairs (app vs. LZ) and emitted spurious "Provider
  changed" warning; now captures run IDs after C1 and C3 steps and passes `--run1 / --run2`
  explicitly for same-type comparison (#2907, #2911)
- Smoke OpenRouter leg used deprecated model; updated to `meta-llama/llama-3.3-70b-instruct`
  (#2906)

### Added

- `build-community.mjs` runs `--version` + JSON-parse smoke check on the finished bundle
  before script exits; silent bundle breakage is now caught at build time (#2705)
- SWAO Chat `fetchPortfolioContext` pre-loads challenge findings via `swao_read_challenge` as
  the 8th MCP tool; challenge data is available in the chat system prompt from session start
  (#2913)
- `SetupWizard` emits `setup.wizard.step.*` events at each observable phase (#2714)
- `AppAssessmentScreen` emits `assess.app.select.confirmed` event when the user confirms the
  application selection (#2715)
- `LzAssessmentScreen` emits `assess.lz.frameworks.confirmed` and `assess.lz.region.confirmed`
  events at framework and region selection steps (#2716)
- App persona reports (technical, exec, compliance, finops, migration-manager) now include a
  per-persona "Challenge Assessment" intro section and a conditional "Stakeholder Challenge
  Findings" section rendered from `combined.yaml` (new) or individual `AA_*.yaml` challenge
  files; section fully omitted when no challenge was run -- no empty pages (#2916)

### Changed

- TUI header version sourced from `SWAO_VERSION` exported by `branding.ts`; no version
  literals remain in render code (#2914)

---

## [1.2.2] - 2026-10-03

Patch release: 31 field bug fixes from the client PoC run + smoke script improvements
(sprint-142).

### Fixed

- Connector `open-llm` not registered in v1.2.1 -- use `openai` connector with `base_url` (#2889)
- `.swao.yml` `base_url` silently ignored when `connector:` key is also set (#2893)
- `swao chat` reports "No LLM connector configured" even when `.swao.yml` has connector (#2895)
- TUI Setup Wizard sets connector `vllm-generic` for custom OpenAI-compatible endpoint (#2886)
- TUI connectivity check shows "endpoint unreachable (timeout)" on TLS certificate error;
  now surfaces TLS cause within 2 s with actionable fix hint (#2894)
- `tls.reject_unauthorized: false` connector YAML field added to scope TLS bypass per
  connector without process-wide `NODE_TLS_REJECT_UNAUTHORIZED=0` (#2894)
- `open-llm-provider` `fetch()` ignores `HTTPS_PROXY` / `HTTP_PROXY` env vars; now
  passes undici `ProxyAgent` dispatcher when proxy env vars are set (#2891)
- SWAO Node.js binary does not inherit Windows system proxy on corporate network; three-tier
  proxy detection added to `SWAO-Session-Setup.ps1` (#2890)
- `open-llm-provider` URL construction produces double `/v1` when `base_url` ends in `/v1`
  and model id has leading slash (#2892)
- Expired ADFS JWT 401 during assessment recorded as WSP finding instead of connectivity
  error; now throws `ConnectivityFailureError` with `reason: auth` (#2899)
- `swao health-check` LLM gateway probe reports "authentication failed" when token env var
  is absent; now distinguishes missing token from wrong token (#2897)
- `swao health-check` MCP config path probe uses stale hardcoded username (#2898)
- `swao health-check` Node.js prerequisites probe reports garbled module path (#2896)
- Challenge subprocess DNF when ADFS token expires mid-assess run; gateway probe now
  classifies JWT expiry and surfaces actionable message (#2901)
- ADFS Bearer token pasted in cleartext in `SWAO-Session-Setup.ps1` terminal output (#2888)
- Model-not-in-catalogue warning fires once per pass per leg instead of once per run (#2900)
- OpenRouter `google/gemini-flash-1.5` deprecated (404); removed from smoke and docs (#2867)
- `swao diff` false "Provider changed: X -> unknown" when comparing cross-run-type runs (#2868)
- DOCX extraction fails with `DOMParser.parseFromString: mimeType undefined` on
  structurally non-conformant DOCX files; fallback to raw ZIP XML extraction added (#2869)
- Community binary "Previous licence expired" wording shown when higher-tier licence is
  present; tier precedence check corrected (#2664)
- LZ HTML publication missing Stakeholder Challenge block -- LZCA findings not rendered (#2701)
- GRC report control count mismatch; coverage/scope inconsistency in multi-regime runs (#2722)
- MCP server binary stale after workspace upgrade; Claude Desktop config not refreshed (#2877)
- Connector dynamic ADFS token refresh for short-lived tokens (#2743)

### Added

- `tls.ca_bundle` connector YAML field (schema reserved for future use) (#2894)
- Smoke script: `--ExpectedVersion` parameter + binary version assertion (#2871)
- Smoke script: G2 diff now compares same-type runs (app-vs-app) rather than cross-type (#2872)
- Smoke script: Community binary functional assessment phase (Phase H) (#2873)
- Smoke script: compliance-regime assessment step (BSI C5 / GDPR lens) (#2874)
- Smoke script: E5 portal step OK assertion after publication (#2875)
- Smoke script: challenge steps use `-AllowFail` and empty-dir guard (#2879)
- `SHA256SUMS-security.txt` generation added to release workflow (#2876)

### Security

- `SWAO-Session-Setup.ps1` ADFS token no longer echoed to terminal (#2888)
- BlackDuck SCA: `express@5.2.1` (via MCP SDK) flagged CRITICAL (8 BDSA advisories);
  no patch available at time of release -- deferred pending upstream fix (#2902)

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
- Design 100 status updated to Delivered (client PoC seed shipped; native implementation
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

Patch release: SC-001 client PoC on-site bug fixes.

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
  blocking client GenAI gateway configuration via wizard (#2742).
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

