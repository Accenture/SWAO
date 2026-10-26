# Pass 26: Code Health (QUALITY)

| Property | Value |
|---|---|
| Pass number | 26 |
| Key (`--passes`) | `quality` |
| Signal prefix | `QUAL` |
| Type | Deterministic (built-in metrics, no LLM, no network); optional lizard / jscpd enrichment, off by default |
| Default | On (part of the default `--passes` list) |
| Assessment types | `application` (skipped in service assessments: no source code) |
| Tier | All tiers (no licence gate) |
| Source | `packages/@swao/module-app-assessment/src/passes/pass-26-quality.ts`, `code-health-metrics.ts`, `code-health-tools.ts`; endpoint scanner `packages/@swao/core/src/endpoint-scanner.ts`; tool location and runner `packages/@swao/core/src/code-health-tools.ts`, `tool-runner.ts` |

## What it is for

Pass 26 answers the question: "Which files should developers fix first, and how healthy is the code overall?" It produces a file-level worklist, ranked by a transparent composite score, that can be handed straight to a development team, plus four KPIs per app that the portfolio engagement hub compares across apps.

Same input, same scores: the pass reads only the source files and uses no clock, locale or LLM. No external tool runs unless you opt in (see "Optional tool enrichment"); tool results are kept apart and never change the built-in scores.

## What you need to provide

Nothing beyond the source tree. When the repository has a `CODEOWNERS` file (`.github/`, root, `docs/` or `.gitlab/`), each worklist entry names the owning team.

Optional settings in `.swao.yml` (#3487; app file first per key, then the workspace file):

```yaml
assessment:
  code_health:
    top_n: 25                     # worklist length, 1 to 500 (default 25)
    endpoint_allowlist:           # hosts not counted as hard-coded endpoints
      - api.partner.example       # exact host
      - .corp.example             # the domain and every subdomain
      - 10.20.30.40               # IPv4 or IPv6 literal
    tools: [lizard, jscpd]        # opt-in tool enrichment (default: none)
    tool_timeout_seconds: 300     # ceiling per tool run (default 300)
```

The allowlist applies to Pass 26 only; Pass 07 (egress) and the TF-01 configuration evidence still report allowlisted hosts.

## How it works

1. List the production files of the central source scope (test and generated files are counted, not measured; build output, dependencies and dot-directories are never listed).
2. Measure every code file: non-comment lines (NLOC), decision points, nesting depth, TODO / FIXME / HACK / XXX markers.
3. Detect duplicated blocks: six consecutive normalised code lines that occur more than once in the app.
4. Scan code and configuration (Java, TS/JS, YAML incl. Helm values, `.properties`, Dockerfiles, `.env`, Terraform) for hard-coded IP addresses and URLs.
5. Score every file, rank the worklist, compute the app KPIs and emit the `QUAL` signals.

## How it is measured

### Per-file score components (0 to 100, higher = more urgent)

| Component | Formula |
|---|---|
| Complexity | max(decision points x 100 / 150, 20 x (nesting depth - 3)) |
| Size | (NLOC - 200) x 100 / 800, so 0 at 200 NLOC and 100 at 1,000 NLOC |
| Duplication | % of the file's lines inside a repeated 6-line block |
| Hard-coded endpoints | 20 per IP address + 10 per URL |
| Markers | 10 per TODO / FIXME / HACK / XXX |

Worklist score = 0.30 complexity + 0.25 size + 0.20 duplication + 0.15 endpoints + 0.10 markers (rounded). The top 25 files are listed (`assessment.code_health.top_n` changes the length); ties are ordered by path. The weights are provisional pending owner confirmation.

### App KPIs (0 to 100, higher = healthier)

| KPI | Formula |
|---|---|
| Complexity | 100 - 4 x (decision points per 100 NLOC - 15) |
| Maintainability | 100 - % of NLOC in hotspot files (score 50 or more, or above 1,000 NLOC) - min(20, 2 x markers per 1,000 NLOC) |
| Duplication | 100 - 2 x % duplicated lines |
| Configuration hygiene | 100 - 10 x (URLs + 2 x IPs) per 1,000 NLOC |
| Overall | mean of the four |

### What counts as a hard-coded endpoint

Excluded: loopback (`127.x`, `::1`, `localhost`), `0.0.0.0`, link-local addresses, documentation ranges (RFC 5737, RFC 3849), reserved names (`example.com`, `.test`, `.invalid`), XML namespace and licence URLs, templated values (`${DB_HOST}`, <code v-pre>{{ .Values.host }}</code>), netmasks, four-part version numbers and comment-only lines (licence headers, Javadoc, YAML comments). A literal default inside a placeholder (`${DB_HOST:10.0.0.1}`) still counts. Hosts on the operator allowlist (`assessment.code_health.endpoint_allowlist`) are not counted.

## Optional tool enrichment

When `assessment.code_health.tools` lists them, two external tools add detail the built-in proxies cannot give:

| Tool | Adds | Supported version | Install |
|---|---|---|---|
| lizard | per-function cyclomatic complexity (CCN), functions above CCN 15 | 1.17.x | `pip install "lizard>=1.17,<1.18"` |
| jscpd | token-based clone detection: clone pairs, duplicated lines, top files | 4.x | `npm install -g jscpd@4` |

- lizard reads exactly the production files Pass 26 measured; jscpd scans the source root and its results are filtered to the same files (clones between two production files).
- Both run without a shell, with a fixed argument list, in a temporary working directory, with a timeout that stops the whole process tree. Configuration files in the scanned repository (`.jscpd.json`, `whitelizard.txt`) are not read.
- Results are stored under `assessment.code_health.tools` and summarised in `QUAL-08`. The built-in metrics, KPIs, worklist and `QUAL-01` to `QUAL-07` are identical with and without tool results. jscpd code fragments are never stored.
- A missing tool, a version outside the supported range, a failure or a timeout is recorded (`absent`, `unsupported_version`, `failed`, `timed_out`) and named in `QUAL-08`, which also gives the install command. The run continues. An unsupported version is not run, because an untested output format could be misread.
- `swao health-check` lists both tools under Prerequisites with their version, "unsupported" or "not found"; they never change the probe status.

## Outputs

- `passes/26-quality.yaml`: `assessment.code_health` with `kpis`, `totals`, `languages`, `owner_source`, `weights`, `top_n`, `worklist` (top 25 by default) and `hardcoded_endpoints` (first 200); `endpoint_allowlist` (`hosts`, `allowlisted_hits`) and `tools` (`requested`, `lizard`, `jscpd`) only when configured.
- Signals: `QUAL-01` KPI summary; `QUAL-02` complexity hotspots; `QUAL-03` bulky files; `QUAL-04` duplication; `QUAL-05` hard-coded IP addresses; `QUAL-06` hard-coded URLs; `QUAL-07` TODO markers; `QUAL-08` tool enrichment summary (informational, only with `tools` configured); `QUAL-00` when there is no measurable production code. Every signal cites `file:line` evidence; severity is at most medium.
- `blocks` pass (Pass 12): `architecture_assessment` and `testing_maturity` read `assessment.code_health` as evidence (prompt context and a `code_health_evidence` object).
- Publication: section "Code Health" with KPI tiles, the worklist (sortable, CSV export, per-file drill-down) and the endpoint table (CSV export); formulas in the methodology section.
- `wsp/portfolio-summary.json`: `code_health` KPIs per application app, shown in the engagement hub portfolio table.

## Limitations

- Built-in complexity is a file-level proxy (sum of decision points and nesting depth), not per-function cyclomatic complexity; built-in duplication is line-window based, not token-based clone detection. The optional lizard and jscpd enrichment adds both, without changing the built-in scores.
- PMD (CPD and rule hits) is not integrated; it needs a Java runtime and is left for a later round.
- Measured languages: Java, Kotlin, Groovy, Scala, TypeScript, JavaScript, Vue, Svelte, Go, C#, C, C++, Rust, Swift, PHP, Python, Ruby, Shell, PowerShell, SQL, VB.NET. The `languages` block lists what was measured, so gaps are visible.
- Files above 1 MiB are not read; they count as bulky.
- A stored `assessment.pass_profile` that does not list `quality` leaves the pass out; the publication then lists it under "Passes not executed".

Design: Design 117 (`docs/design/117-code-health-pass-and-endpoint-scanner.md`).
