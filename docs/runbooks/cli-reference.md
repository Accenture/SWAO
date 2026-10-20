<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     CLI Reference
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->
# SWAO CLI Reference

This document is the **navigation guide** for the `swao` CLI. It tells
you which command to reach for at each moment of an engagement and
in what order they chain. For exact flag enumeration use the
in-binary help, which is the source of truth:

```cmd
swao --help                 :: top-level + list of subcommands
swao <subcommand> --help    :: full flag list for one command
swao assess --help          :: e.g. all flags for `assess`
```

The in-binary help is auto-generated from the command modules, so it never drifts. This
runbook does the opposite job: it explains *purpose* and *order*.

---

## Quick start (minimal engagement)

```cmd
swao init                              :: scaffold a workspace
swao health-check                            :: pre-flight environment check
swao assess --app <appId>              :: run the 14-pass pipeline
swao report --app <appId> --view auditor
swao export                            :: emit the BI bundle
```

For a portfolio (multiple apps in one engagement) jump to the
**Batch samples** section below.

---

## Engagement flow at a glance

```
+--------------+    +----------+    +----------+    +----------+    +----------+
|  init        |    | health-  |    |  assess  |    |  report  |    |  export  |
|  (or setup)  | -> |  check   | -> | (per app)| -> | (per app)| -> |  (BI)    |
+--------------+    +----------+    +----------+    +----------+    +----------+
                                          |               |
                                          v               v
                                    +----------+    +----------+
                                    |challenge |    |   menu   |
                                    | (review) |    |  (TUI)   |
                                    +----------+    +----------+
```

- **init / setup**: one-time per workspace.
- **health-check**: always before the first assess; re-run whenever the
  environment changes (new licence, new MCP install, new catalogue).
- **assess**: once per app per engagement (re-run when source
  code or imports change).
- **report**: generate stakeholder views from completed assess
  output. Cheap to re-run; no LLM calls.
- **export**: emit the BI bundle for PowerBI dashboards. Run
  after every assess if you want fresh dashboards.
- **challenge**: optional adversarial review of an assessment
  before the report goes to the client.

---

## Command catalogue

Each entry below is a one-paragraph orientation. Run
`swao <command> --help` for the full option list.

### `swao init [directory]`

**Purpose.** Scaffold a fresh SWAO workspace: `.swao.yml` engagement
spine, `apps/` skeleton, `catalogs/`, sample `imports/` content. Use
when you are starting a new engagement and don't yet have a
workspace directory. The workspace-root `.swao.yml` (the file that marks
the workspace for `swao assess` and `swao report`) is written when absent
and never overwritten; edit its `engagement:` block afterwards. Re-running
`swao init` in a workspace that lacks it adds it.

**Typical use.** First command of any engagement.

```cmd
swao init                  :: scaffold in the current directory
swao init C:\swao-acme     :: scaffold in a named directory
swao init --reconfigure    :: refresh the workspace framework mirror only
```

`--reconfigure` without `--name` refreshes the workspace-level scaffolds
(community-framework mirror, Power BI templates where licensed,
`.gitignore`) and leaves `apps/` unchanged; it scaffolds no app. With
`--name <app-id>` it also refreshes that app's scaffold without
overwriting its `.swao.yml`.

Pairs with `setup`: they overlap on functionality. `init` is the
non-interactive script-friendly path; `setup` is the guided TUI.

### `swao setup`

**Purpose.** Guided TUI wizard: workspace init + provider credentials
configuration + health-check in one walkthrough. The
operator-friendly alternative to chaining `init` + `credential set`
+ `health-check` by hand.

**Typical use.** First-time setup on a new operator machine, or
when handing the binary to a new consultant.

```cmd
swao setup
```

### `swao health-check`

**Purpose.** Pre-flight environment check. Seven probes:

1. Licence state (Community / Consultant / Enterprise tier; fingerprint)
2. Playwright / Chromium availability (for dynamic UI crawl)
3. SWAO-MCP server entry in Claude Desktop config
4. Compliance catalogues integrity (standard + overlay regimes)
5. Imports templates registration
6. Traceability coverage (rationale + FP narrative completeness)
7. BI export manifest verification

Output: `ok` / `warn` / `INFO` / `FAIL` per row. `--format text`
(default), `--format yaml`, or `--format json` for machine-readable
output. A missing credential vault is a WARN (no credentials stored yet,
the normal state of a fresh workspace); a vault that cannot be decrypted
is a FAIL.

**Typical use.** Always run before the first `assess` of an
engagement. Re-run whenever the environment changes (new MCP
install, new licence, new catalogue overlay).

```cmd
swao health-check
swao health-check --format json   :: machine-readable for CI
```

### `swao assess`

**Purpose.** Run the full 14-pass pipeline against one app:

| # | Pass | Purpose |
|---|---|---|
| 01 | inv | inventory (manifest, languages, frameworks) |
| 02 | state | statefulness |
| 03 | data | data classification (LLM) |
| 04 | ctx | context ingestion (CMDB, finops, incidents) |
| 05 | sbom | SBOM and CVE scan |
| 06 | tf | twelve-factor compliance |
| 07 | egr | egress / 3rd-party SDK surface |
| 08 | crypto | cryptographic posture |
| 09 | synth | 7R verdict synthesis (LLM) |
| 11 | comp | compliance evaluation per regime (LLM) |
| 12 | blocks | block-level assessments (LLM) |

Pass 10 (dynamic UI crawl) is opt-in via `--crawl`. Landing zone readiness is opt-in via `--lzr <landingZoneId>`.

**Typical use.** Once per app per assessment iteration. Re-run after
source code or imports change. Real-LLM cost is ~0.05 to 0.20 USD
per app on Anthropic; `--skip-llm` runs the pipeline against
deterministic fixtures for free.

```cmd
swao assess --app my-app
swao assess --app my-app --skip-llm          :: free dry run
swao assess --app my-app --crawl             :: include dynamic crawl
swao assess --portfolio                      :: all apps (Enterprise)
```

### `swao report`

**Purpose.** Generate stakeholder-facing reports from completed
assess output. Six views ship today:

- `technical` (default): full signal listing for engineers
- `exec`: one-page disposition + blockers for executives
- `compliance`: regime-by-regime breakdown for GRC
- `finops`: portability and egress cost view
- `migration-manager`: runbook + risk register for programme leads
- `auditor`: traceability coverage with FP narratives
- `lzr`: landing zone readiness focused view

Three formats on every tier: `text` (default), `yaml`, `json`. `pdf` and
`html` require a Consultant or Enterprise licence. `--view auditor --format json` produces a
Zod-validated payload for CI / ETL consumers.

**Typical use.** After every assess. Cheap (no LLM calls); regenerate
freely as views are tuned for stakeholder feedback.

```cmd
swao report --app my-app --view auditor
swao report --app my-app --view exec --format yaml
swao report --app my-app --all-views    :: write all views to wsp/reports/
swao report --app my-app --run 2026-10-18T21-36-25   :: report that run, not the latest
```

`--run <id>` (also accepted as `runs/<id>`) selects `wsp/runs/<id>` for the
data, every view, the challenge pairing and the output file name, for
application and `--type landing-zone-catalog` reports. A malformed id, a
missing run or a run of another assessment type exits 1 with an `[error]`
line instead of falling back to the latest run.

### `swao export`

**Purpose.** Emit the BI export bundle: 19-table star schema in
CSV + NDJSON + XLSX, with the `swao-report.pbit` and
`swao-portfolio.pbit` PowerBI templates ready for refresh against
the bundle. Bundle path is printed on completion: paste it into
PowerBI Desktop's SWAOExportPath parameter.

**Typical use.** After every assess (single-app) or after the last
assess of a portfolio (run with `--portfolio` to roll up). The
operator workflow is `assess` -> `assess` -> ... -> `export`.

```cmd
swao export                       :: single-app bundle (auto-detects)
swao export --app my-app          :: explicit single-app
swao export --portfolio           :: portfolio bundle (Enterprise)
```

### `swao challenge`

**Purpose.** Adversarial review of an assessment by a simulated
stakeholder agent (legal-counsel, programme-board, security-lead,
risk-officer, CFO, etc.). Each agent reads the assessment output
and produces a structured critique with concrete pushback. Output
lands in `wsp/challenges/<agent>-<ts>.yaml`.

**Typical use.** Run before sending the report to a client; the
agent catches gaps that the assessment passes did not surface.
Enterprise tier required.

```cmd
swao challenge --app my-app --agent legal-counsel
swao challenge --app my-app --agent programme-board --report
```

### `swao menu`

**Purpose.** Full-screen TUI for operators who prefer interactive
navigation over flag composition. Same features as the CLI:
assess, report, export, license, credential management, setup
wizard, regime picker, portfolio operations.

**Typical use.** When demonstrating SWAO to a client, or when the
operator wants progressive disclosure of options instead of
remembering flag syntax.

```cmd
swao menu
```

### `swao license`

**Purpose.** Licence management. Three subcommands:

- `status`: show current tier + fingerprint + usage counters
- `request`: generate a licence-request email template
  pre-filled with the machine fingerprint
- `activate <key>`: install a licence key received by email

**Typical use.** Upgrade from Community to Consultant or Enterprise when
the engagement needs portfolio mode, PDF export, Terraform
generation, or `--challenge`. Enterprise / Consultant limits are
machine-bound.

```cmd
swao license status
swao license request
swao license activate <key-from-email>
```

### `swao mcp`

**Purpose.** Start the SWAO MCP server, on the stdio transport by default.
Exposes `swao_assess`, `swao_report`, `swao_health_check`, and
`swao_challenge` as MCP tools for Claude Desktop, Claude.ai web,
or any MCP-compatible client.

Service Portfolio Assessment tools (#3213): `swao_service_portfolio`,
`swao_service_app`, `swao_service_research`, `swao_service_waves`,
`swao_service_vendors`, `swao_service_delta`, `swao_service_scaffold`,
`swao_service_runs` (read; gate `service-assessment`, Community) and
`swao_service_init`, `swao_service_research_run`, `swao_service_export`
(export: Enterprise), the MCP
counterparts of `swao service`. See the MCP integration runbook, section 4.1.

```
swao mcp [options]
swao mcp install
```

| Flag | Description |
|---|---|
| `--http` | Use the HTTP transport instead of stdio (optional) |
| `--port <port>` | Listening port (default: 3737, only with `--http`) |
| `--workspace <path>` | Pin the workspace root path (overrides cwd-based detection) |

**Typical use.** Not invoked directly by operators. Called by
Claude Desktop based on the `mcpServers` entry in its config file.
Surface in `health-check` under `SWAO-MCP`.

**Claude Desktop config locations (Windows).**

- Microsoft Store (MSIX) installation:
  `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json`
  (considered only when that folder exists, that is after Claude Desktop
  has run at least once)
- Direct .exe (classic) installation:
  `%APPDATA%\Claude\claude_desktop_config.json`

Claude Desktop reads the Store (MSIX) config when it exists; otherwise it
reads the `%APPDATA%` config. On macOS the config is
`~/Library/Application Support/Claude/claude_desktop_config.json`.

**Registering SWAO.** `swao mcp install`, `swao init --mcp` and the
MCP Client step of the Setup Wizard apply the same rule: they update the
config Claude Desktop reads (created if needed) plus every other config
that already holds a SWAO entry, and list each file with its result. A
config without a SWAO entry is not created or changed while the Store
config is the one Claude Desktop reads. All three register the same
binary: a stable copy in the folder of the running binary, so a rebuild or
upgrade of the downloaded binary is not blocked by Claude Desktop holding
the registered file open. The copy is named for the running binary's own
tier on every platform (`swao-<tier>-<os>-<arch>[.exe]`; the Enterprise
Windows binary registers `swao-enterprise-win-x64.exe`), so a release
binary is registered under its own name and a binary of one tier never
overwrites a binary of another tier. Registering the MCP server is an
Enterprise feature: from the Community or Consultant binary, or without an
Enterprise licence, all three refuse with the `[LICENSE]` message (the CLI
exits 1) before anything is copied or written. The copy is made only when the running
binary is a SWAO release binary: when SWAO runs from source
(`node dist/index.js`), nothing is copied and the entry registers `node`
with the script path and `mcp` as arguments. An existing SWAO entry is
recognised under any key, whether it registers a SWAO binary or `node` with
a SWAO script, and is updated in place. After each
upgrade, quit Claude Desktop fully via the system tray icon (Quit, not just
close the window), run `swao mcp install`, then start Claude Desktop again.
While Claude Desktop runs it holds the stable copy open, so the copy cannot
be refreshed: `swao mcp install` then prints a warning and keeps the
previous copy registered.

```cmd
swao mcp           :: typically auto-launched by Claude Desktop
swao mcp --http --port 3737   :: HTTP transport on localhost for Claude Code
swao mcp install   :: write or refresh the SWAO entry in the Claude Desktop config(s)
```

### `swao credential`

**Purpose.** Store provider API keys in the OS keychain (Windows
Credential Manager / macOS Keychain / libsecret). Avoids putting
secrets into `.swao.yml`, environment variables persisted to disk,
or process arguments.

Subcommands: `set`, `get`, `list`, `delete`. Keys supported include
`anthropic-api-key`, AWS adapter keys, Azure adapter keys, and
meshStack adapter keys (for the LZR pass).

**Typical use.** First-time setup on each operator machine. Run
`set anthropic-api-key` once; subsequent assess calls pick the key
up from the keychain.

```cmd
swao credential set anthropic-api-key
swao credential list
```

### `swao regime-select`

**Purpose.** Pick the compliance regimes to evaluate against an
existing workspace. Interactive picker (TUI) by default;
`--regimes` for non-interactive batch use. Updates the `regimes:`
list in `.swao.yml`; pass 11 reads from this list on the next
assess.

**Typical use.** When an engagement adds a new regulatory scope
mid-flight (e.g. an existing DORA workspace adds GDPR).

```cmd
swao regime-select
swao regime-select --regimes BSI_C5,DORA,GDPR
```

### `swao migrate-workspace [directory]`

**Purpose.** Migrate a legacy workspace to the
`wsp/inputs/` layout. Moves each app's `imports/` and `source/`
folders under `wsp/inputs/` and rewrites `.swao.yml` paths to
match. Idempotent.

**Typical use.** Run once per legacy workspace before the first
v0.0.27+ assess. New workspaces scaffolded by `init` already use
the current layout and don't need migration.

```cmd
swao migrate-workspace             :: current directory
swao migrate-workspace C:\old-ws   :: explicit path
```

### `swao install-playwright`

**Purpose.** Download the Chromium browser bundle that Pass 10
(dynamic UI crawl) requires. Saves to the standard Playwright
cache directory so it survives binary upgrades.

**Typical use.** First time you plan to run `assess --crawl`.
`health-check` warns when Chromium is missing and points you here.

```cmd
swao install-playwright
```

### `swao generate-tf`

**Purpose.** Emit Terraform modules for a sovereign landing zone
based on the wsp-plan output. Reads the assess pipeline's selected
landing-zone catalogue entry and renders HCL ready for `terraform
apply`. Enterprise roadmap: the Enterprise binary prints a coming-soon
notice; lower tiers print the Enterprise `[LICENSE]` block and exit 2.

**Typical use.** After assess completes and the 7R verdict is
Rehost / Replatform / Refactor / Re-architect (any disposition
that lands on cloud). Skip for Retain / Retire.

```cmd
swao generate-tf --app my-app
```

---

## Common workflows

### Single app, one operator, one engagement

```cmd
swao init
swao credential set anthropic-api-key
swao health-check
swao assess --app my-app
swao report --app my-app --view auditor
swao export
```

### Portfolio (multiple apps in one engagement)

```cmd
swao init
swao credential set anthropic-api-key
swao health-check
swao assess --app app-one
swao assess --app app-two
swao assess --app app-three
swao report --app app-one --view auditor
swao report --app app-two --view auditor
swao report --app app-three --view auditor
swao export --portfolio
```

For a scripted version of this loop see **Batch samples** below.

### Iterating after operator-driven edits

```cmd
:: edit imports/cmdb.csv or .swao.yml regimes...
swao assess --app my-app    :: re-run to pick up changes
swao export                 :: refresh BI bundle
```

### Iterating without paying for LLM calls

```cmd
swao assess --app my-app --skip-llm
swao report --app my-app --view technical
```

---

## Batch samples

Ready-to-edit batch scripts for the common multi-app + portfolio
workflow live under `examples/batch-samples/`:

- `assess-portfolio.cmd`: Windows; iterates a configurable app
  list, runs `health-check` as a pre-flight gate, halts on any failure,
  finishes with `export --portfolio`.
- `assess-portfolio.sh`: POSIX equivalent (macOS / Linux / Git Bash).
- `README.md`: operator instructions: what variables to edit,
  how to run, how to interpret the exit codes.

Copy the script to the operator's workspace, edit the three
variables at the top (binary path, workspace, app list), and run.
Both samples halt on the first error so partial bundles are not
emitted silently.

---

## Discovering details: always go to `--help`

Every flag, default value, and option enumeration shipped in the
binary lives behind `--help`. This runbook is updated when the
*shape* of an engagement changes; flag-level changes flow through
the in-binary help automatically.

```cmd
swao --help
swao assess --help
swao report --help
swao export --help
swao health-check --help
```

If something in this runbook contradicts `swao <cmd> --help`, the
help is correct: file a docs fix.

---

## Further information

- Online manual (VitePress): Full flag reference available via `swao <subcommand> --help`.
- Project landing page: https://accenture.github.io/SWAO/en/
- Issues: https://github.com/Accenture/SWAO/issues
- Discussions: https://github.com/Accenture/SWAO/discussions
