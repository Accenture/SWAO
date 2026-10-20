# Pass 07: Egress Analysis (EGR)

| Property | Value |
|---|---|
| Pass number | 07 |
| Key | `egr` |
| Pass name in output | `egress` |
| Signal prefix | `EGR` |
| Type | Deterministic (rule engine), no LLM |
| Default | On |
| Assessment types | `application`; `llm` (inside each leg). Skipped for `service` (no egress graph without source code). Not run for `landing-zone-catalog`. |
| Tier | Not tier-gated (Community and above) |

## What it is for

A workload is only as sovereign as the services it calls. Moving an application to a sovereign landing zone does not help if it still sends data to a US-based API. Pass 07 answers: **"Which external services outside the target jurisdiction does this application send data to, and which of them block a data residency requirement?"**

It finds outbound destinations from known client packages and from domain names in the source code, records their jurisdiction and whether standard contractual clauses (SCC) are in place, and marks destinations that block DE-only or EU-only residency.

## What you need to provide

- The application source tree with `package.json` and JavaScript or TypeScript source files.

No credentials, network access or LLM are needed.

## How it works

1. **Package check.** `dependencies` and `devDependencies` in the root `package.json` are compared with three known client packages:

   | Package | Destination |
   |---|---|
   | `alphavantage` | `api.alphavantage.co` |
   | `yahoo-finance2` | `query1.finance.yahoo.com` |
   | `@aws-sdk/client-comprehendmedical` | `comprehendmedical.amazonaws.com` |

2. **Source scan.** All `.ts`, `.js`, `.mjs` and `.cjs` files (excluding `node_modules`, `dist` and `fixtures` folders) are searched for the seven catalogued domain names:

   | Domain | Jurisdiction | SCC | Blocks DE-only / EU-only |
   |---|---|---|---|
   | `api.alphavantage.co` | US | no | yes |
   | `query1.finance.yahoo.com` | US | no | yes |
   | `query2.finance.yahoo.com` | US | no | yes |
   | `api.rapidapi.com` | US | no | yes |
   | `comprehendmedical.amazonaws.com` | US | no | yes |
   | `s3.amazonaws.com` | US (region-dependent) | no | no |
   | `api.coingecko.com` | uncertain | no | no |

   A domain found both ways is reported once, with the package and the source file as evidence.
3. **Allowlist guard.** If the folder `apps/api/src/services/data-provider/` exists, the pass checks `data-provider.service.ts` for an allowlist or blocklist (`allowlist`, `allowedDomains`, `sovereignProviders`, `blocklist`). A missing guard is reported, because new providers could then be added without sovereignty control.
4. **Sovereign service availability.** The pass reads `controls/sovereign-service-catalogue.yaml` (31 SaaS and cloud services, each with a `portability_verdict` of `available`, `partial` or `unavailable`, a `sovereign_evidence` class, a `verdict_confidence` of `verified` or `unverified`, the public `sources` the verdict rests on with their review dates, and a `blocks_migration` flag). The catalogue header defines one verdict rule for every entry: a vendor whose parent is a US company (US CLOUD Act exposure) is never `available`; with a documented EU data residency option it is `partial`, without one `unavailable`. `blocks_migration` is set exactly when a verdict is `unavailable` and `verified`. A service counts as used when one of its client packages appears in a `package.json`, `requirements*.txt`, `pyproject.toml` or `Pipfile` anywhere in the source tree (up to four folder levels; `node_modules`, `dist`, `build`, `target`, `vendor` and virtual environments are skipped), or when one of its API host names appears in a JavaScript or TypeScript file. Examples: `@sentry/*` or `sentry.io` (Sentry), `stripe` (Stripe), `firebase` or `firebaseio.com` (Firebase), `@anthropic-ai/sdk` or `api.anthropic.com` (Anthropic API), `@slack/*` or `hooks.slack.com` (Slack), `@aws-sdk/client-cognito-identity-provider` (AWS Cognito). The mapping from packages and host names to catalogue entries is fixed in the pass (`SOVEREIGN_SERVICE_DETECTION`); the verdicts come from the catalogue.

## How it is measured

| Signal | Emitted when | Severity | Meaning |
|---|---|---|---|
| `EGR-01` onwards | One per destination found | critical (blocks DE-only or EU-only residency), medium (jurisdiction uncertain), high (other) | Destination, jurisdiction, SCC status, detection method; blocking destinations state `blocks_migration: true` for DE-only and EU-only residency |
| Next number | Data-provider folder exists without allowlist or blocklist | high | No provider-sovereignty allowlist or geographic routing guard |
| Next numbers | One per sovereign service catalogue entry found (step 4) that is not already an egress destination above | verified verdicts: critical (`unavailable` and `blocks_migration: true`), high (`unavailable`), medium (`partial`), low (`available`); unverified verdicts: at most medium and never blocking; confidence high when found by package, medium when found by host name | Service, vendor, catalogue verdict and its confidence, evidence class, review date and `blocks_migration`, with a reminder to confirm the configured region and contract; `implies: sovereign_service:<id>` |
| `EGR-01` (fallback) | Nothing found | informational, confidence low | No known egress domains or packages detected; manual review recommended |

The `assessment` block records:

- `egress_destinations`: one entry per destination with `domain`, `jurisdiction`, `scc`, `blocks_migration`, `detected_via` (`package` or `source_scan`) and `signal_ref`; or `note: none_detected`
- `migration_blockers`: number of destinations that block DE-only or EU-only residency
- `sovereignty_claim_verified`: always `false` (static analysis cannot verify contractual or routing claims)
- `sovereign_services`: one entry per catalogue service found with `service_id`, `name`, `category`, `portability_verdict`, `verdict_confidence`, `sovereign_evidence`, `blocks_migration` (the effective value: false for an unverified verdict), `detected_via`, `last_reviewed` and `signal_ref`; `merged_with_egress_destination` names the egress domain when the service was reported in that destination's signal
- `sovereign_service_blockers`: number of services found whose effective `blocks_migration` is true (counted separately from `migration_blockers`)
- `sovereign_services_merged_with_egress`: number of services reported in an egress destination's signal instead of their own
- `sovereign_service_check`: `matched`, `no_match`, or `skipped: <reason>` when the catalogue is missing or invalid

**How results feed later passes.** EGR signals are listed explicitly in the prompt of [Pass 09 (SYNTH)](/passes/09-synth). Its `portability_score` is defined as the share of egress destinations with a sovereign-cloud equivalent: (available + 0.5 × partial) / total egress, with 0.70 as the sovereign-ready threshold. EGR signals are also evidence for data transfer and third-country controls in Pass 11 (COMP), for example under GDPR when active in `assessment.regimes_active`. Critical signals feed the derived findings, where critical severity marks a finding as blocking migration.

## Third-party modules and tools

None. The catalogue of egress domains and packages is built into the pass; the sovereign service verdicts are read from `controls/sovereign-service-catalogue.yaml`, which ships with SWAO. Matching uses plain text search.

## Outputs

- `wsp/runs/<ts>/passes/07-egr.yaml` with header (`id: 7`, `name: egress`), signals and `assessment`.

## Configuration and limitations

**Configuration**

- `--passes egr` runs the pass alone. There are no pass-specific settings.

**Limitations and known gaps**

- The egress catalogue is small and fixed in code: seven domains and three packages. Beyond it, only the 31 services of the sovereign service catalogue are recognised (step 4); any other external service (for example a SaaS API, a telemetry endpoint or an LLM API) is not detected. Treat a clean result as "nothing from the known list", not as "no egress".
- Only JavaScript and TypeScript source files are scanned for host names; configuration files, environment templates and other languages are not. Sovereign service packages are read from npm and Python manifests only.
- A sovereign service signal reflects the catalogue verdict, not the configuration of the application: a service with an EU region option (for example Sentry or Datadog) is reported with its catalogue verdict whether or not the EU region is used. Check `last_reviewed` in the signal; verdicts are only as current as the catalogue.
- When an egress destination and a sovereign service catalogue entry name the same service (for example AWS Comprehend Medical), the pass emits one signal: the egress signal carries the catalogue verdict, and a verified verdict sets its severity and `blocks_migration`. Both kinds of signal carry `implies: sovereign_service:<id>`, and derive-plan keeps one security finding and one risk per service even for runs written before this rule (#3296).
- The blocking flag is derived from the catalogue entry; the pass does not read the residency requirement of the application.
- The allowlist check only applies to one specific folder layout (`apps/api/src/services/data-provider/`).
- Runtime traffic is not observed. Use [Pass 10 (dynamic analysis)](/passes/10-dynamic) and context documents for a fuller picture.
