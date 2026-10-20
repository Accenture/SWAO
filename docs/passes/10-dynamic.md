# Pass 10: Dynamic Analysis (DYNAMIC)

| Property | Value |
|---|---|
| Pass number | 10 |
| Key (`--passes`) | `dynamic` (alias `dyn` in `--passes` and lens profiles) |
| Signal prefix | `DYN` |
| Type | Dynamic (headless browser crawl) plus deterministic rules; optional LLM vision step |
| Default | In the default `--passes` list, but only produces crawl results when a target URL is configured and Playwright with Chromium is available |
| Assessment types | `application`; `service` only when the analyst configured a crawl for a `saas` or `hybrid` vendor portal |
| Tier | All tiers (no licence gate) |
| Source | `packages/@swao/module-app-assessment/src/passes/pass-10-dynamic.ts`, `.../passes/phase2/`, crawler in `packages/swao/src/crawl/` |

## What it is for

Static passes read code and documents. Pass 10 looks at the application while it is running. It answers the question: "What does this application actually do in a browser, which external hosts does it contact, and what does a user see on screen?"

Typical findings are calls to third-party analytics or tracking hosts, missing cookie consent, HTTP errors behind the user interface, the visible authentication surface, and form fields that handle personal data without the expected browser attributes. These findings feed the sovereignty and data-protection view of the assessment (for example GDPR Art. 44 transfer risk).

## What you need to provide

| Input | Where | Notes |
|---|---|---|
| Target URL of the running application | SWAO credential vault key `playwright-url-<app>` | Required for a live crawl. A bare host name is accepted; `https://` is added automatically. |
| Login user name and password (optional) | Vault keys `playwright-user-<app>` and `playwright-pass-<app>` | When both are present and no `auth_type` is set, SWAO uses form login. The same credentials are also offered for HTTP Basic authentication challenges. |
| TOTP seed for MFA (optional) | Vault key `playwright-mfa-<app>` | Used to fill a one-time-password field during login. |
| Chromium and the Playwright package | Installed with `swao install-playwright` | Without them the live crawl is skipped (see below). |
| An LLM provider (optional) | `providers.llm` in `.swao.yml` | Only needed for the vision step. |

Store credentials with the TUI assessment setup or with `swao credential set <name> <value>`. The older `crawl.target_url`, `crawl.username` and `crawl.password` keys in `.swao.yml` are still read for backward compatibility, but the schema marks them as legacy: do not write credentials into `.swao.yml`.

Non-sensitive crawl settings can stay in the app `.swao.yml`:

```yaml
crawl:
  auth_type: form          # none | basic | form
  max_turns: 60            # maximum screens visited (default 60)
  screenshot_quality: 80   # JPEG quality 0-100 (default 80)
  viewport_width: 1280     # browser width in pixels (default 1280)
  exclude_patterns: ["/logout", "/admin/delete"]
```

## How it works

1. **Pre-checks.** In the packaged binary SWAO checks that the Playwright package and a Chromium build are installed. If not, it prints a warning and skips the live crawl; the vision fallback (step 6) can still run.
2. **Crawl configuration.** SWAO builds the crawl configuration from the vault keys and the `crawl:` block. Without a target URL the live crawl is skipped.
3. **Live crawl.** Headless Chromium opens the target URL, pre-seeds the queue from `sitemap.xml` (capped at twice `max_turns`), logs in if credentials exist, and follows same-origin links until `max_turns` screens are captured. For each screen it records a full-page JPEG screenshot, the DOM, an accessibility snapshot, the network log and the browser console log.
4. **Parity baseline.** Every screen is written to `apps/<app>/parity-baseline/<NNN-slug>/` (`screenshot.jpg`, `dom.html`, `a11y.json`, `meta.json`).
5. **Rule evaluation.** Phase 1 rules summarise the crawl, accessibility indicators and console errors. Phase 2 rules read `parity-baseline/` and evaluate external hosts, API endpoints, HTTP errors, authentication endpoints, personal-data form fields, third-party scripts and cookie consent. All rules are deterministic.
6. **Vision step (optional).** When an LLM is configured, up to `assessment.vision_max_screens` screenshots (default 5) are sent to the model with a fixed auditor prompt. The model returns a JSON list of findings, one signal per finding. Cloud LLM connectors are blocked unless `assessment.allow_cloud_vision: true` is set, because screenshots of authenticated screens can contain personal data. A local Ollama connector is always allowed. If no live crawl ran but an earlier `parity-baseline/` exists, SWAO uses those stored screenshots for the vision step.
7. **Write results.** The pass file is written to `wsp/runs/<ts>/passes/10-dynamic.yaml`. A failure of the crawl is logged as a warning and does not stop the assessment.

## How it is measured

All Pass 10 signals carry `source: dynamic_analysis` and `category: application`.

| Signal | Meaning | Severity | Emitted when |
|---|---|---|---|
| `DYN-01` (crawl summary) | Number of screens crawled, external hosts, accessibility indicators and console errors | informational | Always, when the pass runs |
| `DYN-09` Accessibility indicator | Screens with accessibility problems (first five as evidence) | low | At least one screen has an indicator (see note) |
| `DYN-11` Console errors | JavaScript `error` entries in the browser console (first five as evidence) | low | At least one console error |
| `DYN-02` External hosts | Distinct external hosts contacted (private and loopback addresses excluded) | high if any host was called with resource type `fetch`, otherwise medium | At least one external host |
| `DYN-03` API surface | Distinct fetch endpoint patterns seen at runtime | informational | At least one endpoint |
| `DYN-04` HTTP errors | URLs that returned error status codes | high for any 5xx, medium for 404, otherwise low | At least one error response |
| `DYN-05` Personal-data form fields | Password fields without `autocomplete="current-password"` or `"new-password"`, e-mail fields without `autocomplete="email"`, fields named like personal data (for example `dob`, `phone`, `address`, `surname`) without any `autocomplete` | medium | At least one field |
| `DYN-06` Third-party scripts | External script hosts, classified against the analytics blocklist | high if any host is analytics, social pixel, advertising or tag manager, or unknown while the blocklist is loaded; otherwise medium | At least one external script |
| `DYN-07` Authentication surface | Calls to paths such as `/auth/`, `/login`, `/session`, `/token`, `/oauth`, `/oidc` and the share of screens that use them | low if no auth calls were seen; informational at 100 % coverage; medium below 100 % | At least one screen processed |
| `DYN-08` Cookie consent absent | No consent banner (OneTrust, Cookiebot, Usercentrics, CookieYes or generic consent/cookie markup) on any screen | medium (confidence low) | No consent element found |
| `DYN-VIS-<screen>-<n>` | One finding from the vision model: `pii_exposure`, `missing_label`, `version_leakage`, `missing_consent`, `third_party_widget` or `other` | As returned by the model | Vision step ran and returned findings |

The accessibility indicator is a heuristic: it counts nodes with role `alert` in the accessibility snapshot and, if none are found, elements with `aria-invalid="true"` or `role="alert"`. It is not a WCAG audit; the signal text recommends a dedicated tool for remediation.

The pass also writes summary figures to `assessment:` in the pass file: `screens_captured`, `crawl_duration_ms`, `external_hosts`, `external_host_count`, `a11y_violations_total`, `console_errors_total`, `api_endpoints_observed`, `http_errors_total`, `pii_form_fields_flagged`, `third_party_scripts_total`, `cookie_consent_present`, `vision_screens_analysed` and `vision_signals_emitted`.

## Third-party modules, tools and external services

| Name | Purpose | Licence | Bundled or optional | When missing or offline |
|---|---|---|---|---|
| Playwright (`playwright`, `playwright-core`) | Drives headless Chromium | Apache-2.0 | Bundled in the SWAO build | Live crawl skipped with a warning |
| Chromium browser | Renders the application | Chromium licence (BSD-style) | Optional download via `swao install-playwright` | Live crawl skipped; vision fallback on stored screenshots only |
| Analytics blocklist `controls/dynamic-analysis/analytics-domains.yaml` | 22 known analytics, support-chat, CDN, error-tracking, social-pixel, tag-manager and advertising domains | SWAO | Bundled | All external scripts rated medium |
| LLM provider with vision support | Screenshot review | Depends on the provider | Optional | Vision step skipped |
| The target application | Crawled over the network | - | Provided by you | Crawl error logged; assessment continues |
| `js-yaml`, `zod` | Parse and validate YAML | MIT | Bundled | - |

## Outputs

| File | Content |
|---|---|
| `apps/<app>/wsp/runs/<ts>/passes/10-dynamic.yaml` | Pass header, signals and summary figures |
| `apps/<app>/parity-baseline/<NNN-slug>/screenshot.jpg`, `dom.html`, `a11y.json`, `meta.json` | Per-screen crawl artefacts (overwritten by every live crawl) |
| `apps/<app>/wsp/runs/<ts>/passes/10-dynamic-vision-screen-NN-call-1.yaml` | Prompt, raw model response and parse counts for each screen sent to the vision model |

## Configuration and limitations

| Setting | Effect |
|---|---|
| `--passes ...,dynamic,...` | Includes the pass (it is part of the default list) |
| `--no-crawl` | Skips the live crawl; vision on stored screenshots can still run |
| Vault keys `playwright-url-<app>`, `playwright-user-<app>`, `playwright-pass-<app>`, `playwright-mfa-<app>` | Target and login credentials |
| `crawl.auth_type`, `crawl.max_turns`, `crawl.screenshot_quality`, `crawl.viewport_width`, `crawl.exclude_patterns` | Crawl behaviour |
| `assessment.vision_max_screens` | Maximum screenshots sent to the vision model (default 5) |
| `assessment.allow_cloud_vision: true` | Allows screenshots to be sent to a cloud LLM connector |
| `--skip-llm` | Turns off the vision step; the crawl and the deterministic rules still run |
| `SWAO_DEBUG` | Prints a stack trace when the crawl fails |

Known limitations:

- There is no visual regression check between crawls: each live crawl overwrites `parity-baseline/`, and the ID `DYN-10` is reserved for a future screenshot comparison and is not emitted.
- When no live crawl runs but a stored `parity-baseline/` exists and an LLM is configured, the fallback also re-runs the Phase 2 rules on the stored DOM and network logs. Those findings describe the earlier crawl, not the current state of the application.
- The crawl covers at most `max_turns` screens reachable from the start page and sitemap; flows behind complex interactions may be missed.
- Personal-data form detection relies on field names and `autocomplete` attributes only.

See also [Application assessment](/assessment/application) and [Pass 11: Compliance evaluation](/passes/11-comp).
