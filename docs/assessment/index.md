# Run Assessment

SWAO offers four assessment types. Each one answers a different question, needs
different input from you, and produces its own set of results. All four use the same
workspace layout (a portfolio workspace with one folder per application under `apps/`),
the same community frameworks, and the same publication and export tooling.

This page gives you the overview: what each type is for, what you need to provide,
what you get back, and how the types combine in a typical engagement.

---

## The four assessment types at a glance

| | [Application Assessment](/assessment/application) | [Service Portfolio Assessment](/service-assessment/) | [Landing Zone Catalog Assessment](/assessment/landing-zone) | [LLM Assessment for SWAO](/assessment/llm) |
|---|---|---|---|---|
| **Type ID** | `application` (default) | `service` | `landing-zone-catalog` | `llm` |
| **Question answered** | What is the sovereignty, compliance and migration posture of this application? | What should we do with each third-party, SaaS or COTS application in this portfolio? | Can this cloud provider and region host this application under the active frameworks? | Which LLM runs SWAO's assessment work best on my application? |
| **What you provide** | Source code (local path or Git repository), optional context documents, optional running URL for the crawl | An Excel inventory of the applications (one row per app), optional binaries, SBOMs and configuration files | A target provider and region from the bundled catalogues, plus (ideally) a completed Application Assessment | A completed Application Assessment and 2 to 5 LLM connector/model pairs |
| **Key outputs** | Signals per pass, compliance verdicts, 7R migration verdict, run manifest, HTML publication, BI export | One scaffolded app per row, research stubs (CVE, end of life, vendor status), TIME quadrant, risk and health scores, migration waves, Enterprise portfolio workbook | Per-service fit/gap verdicts, an overall landing zone verdict per target, LZ signals, narratives | A dimension-grouped model comparison (quality, performance, cost, reliability, reasoning, security), a weighted final ranking, a findings log |
| **Command** | `swao assess --app <id>` | `swao service init`, `swao service research`, `swao assess --app <id>`, `swao service export` | `swao assess --type landing-zone-catalog --app <id> ...` | `swao assess --type llm --app <id>` |
| **LLM** | Recommended. Static passes run without one; `data`, `ctx`, `synth`, `comp` and `blocks` need it | Recommended for the context, synthesis and compliance passes; intake, research and scoring are deterministic | Not used. The fit is fully deterministic | Required: the LLMs under comparison are the subject of the assessment |
| **Licence tier** | All tiers. Portfolio-wide runs (`--portfolio`) are Enterprise | All tiers. The portfolio workbook (`swao service export`) is Enterprise | All tiers. `swao lz catalogue update` is Consultant and above | All tiers (see the [LLM page](/assessment/llm#licence-tier)) |

SWAO does not publish fixed durations for any type. Run time depends on the size of the
source tree or portfolio, the passes you select, the LLM provider and its rate limits.
`swao assess --stats` prints a per-pass timing table after each run so you can plan
repeat runs.

---

## Which assessment do I need?

Work through the questions in order.

1. **Do you have the application's source code?**
   - Yes: start with the [Application Assessment](/assessment/application). It is the
     foundation for the Landing Zone and LLM assessments.
   - No, the application is a vendor product, a SaaS service or an installed binary:
     use the [Service Portfolio Assessment](/service-assessment/).
2. **Are you assessing many applications from an inventory spreadsheet?**
   - Yes: the Service Portfolio Assessment scaffolds one workspace app per spreadsheet
     row and rolls everything up into a portfolio view with migration waves.
3. **Do you need to know whether a specific cloud provider and region can host the
   workload under your sovereignty requirements?**
   - Yes: add a [Landing Zone Catalog Assessment](/assessment/landing-zone). You can run
     it standalone or inline as part of the Application Assessment.
4. **Do you need to choose which LLM to use for SWAO assessments (for example a
   self-hosted model versus a cloud API)?**
   - Yes: run the [LLM Assessment for SWAO](/assessment/llm) once you have at least one
     completed Application Assessment for the app.

---

## How the types combine

**Application plus Landing Zone (the standard migration engagement).** Run the
Application Assessment first. It detects which platform capabilities the application
needs (for example Kubernetes, object storage, key management). The Landing Zone Catalog
Assessment then checks those needs against one or more provider regions and the
sovereignty requirements of your active frameworks. You can do both in one command by
adding `--lz-cat-targets` to `swao assess --app <id>`.

**Service Portfolio for applications without source code.** Hospitals, public
authorities and large enterprises typically run many third-party products: clinical
systems, document management, vendor portals, SaaS tools. You cannot scan their source,
but you can still assess them from an inventory export, vendor documentation, installed
binaries and public vulnerability data. The Service Portfolio Assessment reuses the
same pass engine and frameworks, skips the passes that need source code, and adds
internet research and binary analysis.

**Mixed portfolios.** A workspace can hold both kinds of app side by side. Custom-built
applications are assessed with `type: application`, vendor products with `type: service`.
The portfolio views (Enterprise) aggregate both.

**LLM Assessment as a tuning step.** The LLM Assessment does not change your
application results. It re-runs the assessment of one app with several models in
isolated copies of the workspace and tells you which model gives you the best balance of
quality, cost, speed and reliability. Use it before a large engagement to choose the
model for the remaining runs.

---

## Service Portfolio Assessment in brief

The Service Portfolio Assessment (new in v1.4.0) is designed for portfolios of
third-party, SaaS and COTS (commercial off-the-shelf) applications where no source code
is available. The detailed pages live under [Service Portfolio Assessment](/service-assessment/).

**What you provide.** An Excel workbook with one row per application: name, vendor,
product, version, operating system, hosting model, criticality and similar columns. A
non-standard workbook layout can be mapped with a column-map YAML
([column mapping](/service-assessment/column-mapping)). Optionally, you add installer
files, SBOMs, configuration files or vendor documents per app.

**What SWAO does.**

1. `swao service init --from <workbook.xlsx>` parses the workbook and creates one
   workspace app per row with `assessment.type: service`. Contact, phone and e-mail
   columns are scrubbed at intake: SWAO keeps only a presence flag (for example
   `support_email_present: true`) and never writes the personal values into the
   workspace. Each app is classified against the SWAO IT infrastructure catalogue
   ([SWAO-INFRA-CAT](/service-assessment/infra-cat)), and groups of identical rows are
   detected as clusters (default threshold: 3 rows).
2. `swao service research` (Pass 24, [RESEARCH](/passes/24-research)) queries public
   sources for each app: the NIST NVD CVE API, endoflife.date, the CISA Known Exploited
   Vulnerabilities feed, OSV.dev, the BSI CERT-Bund advisory feed, and optionally
   VirusTotal for installer hashes (needs an API key; see
   [API keys](/service-assessment/api-keys)). Outbound requests carry only vendor,
   product, version, OS and installer hashes, never app IDs, sites or other intake data.
   Results are written as research stubs that analysts can review and promote.
3. `swao assess --app <id>` runs the service pass profile. Passes that need source
   code ([inventory](/passes/01-inv), [state](/passes/02-state),
   [twelve-factor](/passes/06-tf), [egress](/passes/07-egr)) are skipped with a stated
   reason. [Context](/passes/04-ctx), [synthesis](/passes/09-synth),
   [compliance](/passes/11-comp), [blocks](/passes/12-blocks) and
   [scope](/passes/13-scope) always run. [Data](/passes/03-data), [SBOM](/passes/05-sbom),
   [crypto](/passes/08-crypto), [dynamic](/passes/10-dynamic) and
   [malware](/passes/14-malware) run only when you supply the matching inputs.
   Pass 25 ([BINARY](/passes/25-binary)) analyses supplied installer and binary files
   before the pass loop.
4. Scoring against the SWAO application portfolio framework
   ([SWAO_APM](/frameworks/swao-apm), 72 controls in 11 domains: strategic fit, vendor
   health, technical health, security posture, data governance, sovereignty readiness,
   business criticality, hardware and cost, integration complexity, migration readiness,
   compliance obligations) produces a health score per domain, a weighted risk score and
   a TIME quadrant per app. See the [framework page](/service-assessment/framework).
5. Apps are scheduled into five [migration waves](/service-assessment/migration-waves).
   `swao service export` (Enterprise) writes the portfolio workbook
   (`wsp/reports/swao-portfolio-YYYYMMDD.xlsx`) and a star schema.

---

## Two decision vocabularies: TIME and 7R

SWAO uses two established vocabularies. They answer different questions and are not one
scale.

### TIME (portfolio disposition)

TIME is the Gartner model for deciding what to do with an application in a portfolio.
The Service Portfolio Assessment assigns each service app one TIME quadrant from its
evidence:

| Quadrant | Plain-language meaning | Typical trigger in SWAO |
|---|---|---|
| **Tolerate** | Keep it running, monitor, do not invest | In vendor support, no overriding risk |
| **Invest** | Strategic and healthy: develop further | Active, strategically important, technically sound, strong vendor |
| **Migrate** | Move it to a new platform or version within a planned window | End of life approaching (for example within 18 months) |
| **Migrate-Critical** | SWAO extension: migrate urgently | A CISA KEV match, a critical CVE with end of life within 12 months, or end of life already passed without extended support |
| **Eliminate** | Retire it | Decommissioned, unused or inactive |

The quadrants feed the migration waves: wave 1 Eliminate (now), wave 2 Migrate-Critical
(next 3 months), wave 3 standard Migrate (3 to 12 months), wave 4 Invest (12 to 24
months), wave 5 Tolerate (monitor). A Migrate app that handles health data or special
category data, or whose end-of-life signal is blocked, is promoted to wave 2. The
analyst's own TIME value from the workbook is kept as an input to strategic fit and is
never overwritten. Details: [TIME framework](/service-assessment/framework).

### 7R (migration strategy)

The 7R model describes *how* a workload moves to the target platform. The
[synthesis pass](/passes/09-synth) of the Application Assessment emits exactly one 7R
label per app:

| Strategy | Plain-language meaning |
|---|---|
| **Retire** | Switch the application off; its function is no longer needed |
| **Retain** | Keep it where it is for now |
| **Rehost** | Lift and shift: move it unchanged to new infrastructure |
| **Replatform** | Move it with targeted platform changes (for example a managed database) |
| **Repurchase** | Replace it with a different product, often SaaS |
| **Refactor** | Change the code to use the target platform properly |
| **Re-architect** | Redesign the architecture substantially |

Alongside the 7R label, the synthesis pass also records a strategic disposition
(`modernization_position`, for example `invest_modernize_now`, `migrate_stabilize`,
`tolerate_contain`, `retire_replace`) and a portability score. When a landing zone
readiness check (Pass 23, [LZR](/passes/23-lzr)) reports the target as blocked, the 7R
verdict is adjusted and the adjustment is recorded. See the [pass reference](/passes/)
for all passes.

---

## Common flags

| Flag | Applies to | Description |
|---|---|---|
| `--app <id>` | all single-app runs | Application ID under `apps/` in the workspace |
| `--type <type>` | all | `application` (default), `service`, `landing-zone-catalog`, `llm`. Overrides `assessment.type` in `.swao.yml`. `landing-zone` is accepted as a deprecated alias |
| `--workspace <path>` | all | Portfolio workspace directory (default: found by walking up from the current directory) |
| `--passes <list>` | application, service | Comma-separated pass keys (default: the 13 standard passes) |
| `--skip-llm` | application, service | Drop the `ctx`, `comp` and `blocks` passes |
| `--no-crawl` | application | Skip the Playwright crawl |
| `--portfolio` | application, service | Assess every app in the workspace (Enterprise) |
| `--force` | all | Run even when an accepted-run lock exists for the app |
| `--stats` | application, service | Print a per-pass timing table |

Run `swao assess --help` for the full option list, or see the
[CLI reference](/runbooks/cli-reference).

---

## In the terminal interface (TUI)

Run `swao` without arguments and choose **3 Run Assessment**. The type menu lists the
four surfaces in this order:

```
  [1] Application Assessment            swao assess - static + LLM pass suite
  [2] Service Portfolio Assessment      swao service - third-party apps, SaaS, COTS from an Excel intake
  [3] Landing Zone Catalog Assessment   swao assess --type landing-zone-catalog - CSP service catalog fit/gap
  [4] LLM Assessment for SWAO           swao assess --type llm - compare up to 5 LLMs on your assessed app
```

Each entry shows a short explanation of what it does before you confirm. The type pages
describe the individual TUI steps.

---

## Further reading

- [Workspace setup](/workspace-setup) and [workspace configuration](/runbooks/workspace-config)
- [Health check](/health-check): verify the workspace before the first run
- [Generate report](/generate-report), [Publish HTML](/publish-html), [Export BI](/export-bi)
- [Portfolio operations](/portfolio) (Enterprise)
- [Community frameworks](/frameworks/) and [assessment dimension catalogue](/assessment-dimension-catalogue)
- [Features and editions](/features)
