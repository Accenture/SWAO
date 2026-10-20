<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Log Event Reference
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->
# Log Event Reference

**Applies to:** SWAO v1.4.0+  
**Related issues:** #3284 (shared LLM provider request helper), #3221, #3225, #3222

SWAO writes structured events to two NDJSON log files inside the workspace:

| Scope | File |
|---|---|
| Portfolio | `<workspace>/wsp/logs/portfolio-events-<YYYY-MM>.ndjson` |
| App | `<workspace>/apps/<app-id>/wsp/logs/app-events-<YYYY-MM>.ndjson` |

Each line is one JSON object with `ts` (ISO 8601 UTC), `level` (`debug`, `info`,
`warn`, `error`, `enhancement`), `scope` (`portfolio` or `app`), `code` (dotted
event code), `message`, an optional `context` object and, for app scope, `app_id`
(`packages/@swao/core/src/log.ts`). Events at `warn` and `error` are also printed
on the terminal. Files rotate monthly.

Event context never contains prompt text, request bodies, image bytes, API keys or
tokens (CLAUDE.md section 5.7). URL userinfo is stripped at write time.

---

## 1. LLM provider events

Every LLM call, for every provider and every call kind, runs through one shared
request helper (`packages/@swao/module-llm-providers/src/llm-request.ts`,
`requestLlmWithRetry`). It applies one retry policy, one attempt count, an idle
watchdog and the provider-level concurrency limiter, and it writes the same event
set for each provider.

### 1.1 Event codes

The code is `provider.llm.<provider>.<event>`, where `<provider>` is one of:

| `<provider>` | Driver | Call kinds |
|---|---|---|
| `anthropic` | `anthropic.ts` (also gateway protocol `anthropic-messages`) | text, vision, tools |
| `openai` | `openai.ts` | text, vision |
| `ollama` | `ollama.ts` (also gateway protocol `ollama`) | text, vision |
| `open-llm-provider` | `open-llm-provider.ts` (also gateway protocol `openai-chat`) | text, vision, tools |
| `bedrock` | `bedrock.ts` (gateway protocol `bedrock`, AWS SDK) | text |

| Event | Level | When | Context fields |
|---|---|---|---|
| `attempt` | info | An attempt is sent (after a concurrency slot was granted) | common fields, `endpoint`, `prompt_chars`, `idle_timeout_ms`, `queued_ms`; text/vision: `api_key_suffix` (last 4 characters only, where a key is used); tools: `iteration`, `max_iterations`, `tool_count` |
| `waiting` | info, or warn when no data arrived for 60 s on a streaming response or in the body phase | Every 60 s while an attempt is outstanding | common fields, `phase` (`headers` or `body`), `elapsed_ms`, `ms_since_data`, `bytes_received`, `idle_timeout_ms`, `streaming` |
| `timeout` | warn | The idle or total limit ended the attempt; the request is aborted and retried | common fields, `phase`, `limit` (`idle` or `total`), `limit_ms`, `elapsed_ms`, `bytes_received` |
| `http-error` | warn when transient or re-sent at once; error when final (`open-llm-provider`: warn, #1896) | A non-2xx response | common fields, `http_status`, `reason`, `latency_ms`, `body_excerpt` (API error body, max 500 characters, PII fields removed for `open-llm-provider`), `transient`, `retry_now`; Anthropic: `temperature_deprecated`; open-llm: `token_refreshed` |
| `retry` | warn | Before the back-off sleep of the next attempt | common fields, `attempt` (the attempt that failed), `next_attempt`, `reason`, `delay_ms` |
| `ok` | info | The attempt succeeded | common fields, `http_status`, `latency_ms`, `tokens_in`, `tokens_out`, `cost_usd`; open-llm: `tokens_reasoning`, `content_source`; Anthropic tools: `stop_reason` |
| `error` | error | A non-retryable, non-HTTP failure (for example a missing response field) | common fields, `reason` (`non_retryable`), `error_name`, `error_message` (max 300 characters), `latency_ms` |
| `connectivity-failure` | error | Every attempt failed; the call throws a connectivity error and the pass degrades or fails over (#1703) | `provider`, `model`, `kind`, `image_count` (vision), `max_attempts`, `reason`, `last_error` (max 300 characters) |

Common fields: `provider`, `model`, `kind` (`text`, `vision` or `tools`),
`image_count` (vision only), `attempt`, `max_attempts`.

Every message counts attempts the same way: `attempt N/6`. A retry line reads
`attempt 1/6 failed (...), retrying in 3s as attempt 2/6`.

`reason` values: `bad_request`, `auth`, `not_found`, `request_timeout`,
`payload_too_large`, `rate_limited`, `overloaded`, `server_error`, `client_error`
(HTTP statuses), `timeout_idle_headers`, `timeout_idle_body`,
`timeout_total_headers`, `timeout_total_body` (watchdog),
`network_or_malformed_response` (network failure or a malformed or truncated
response), `non_retryable`.

### 1.2 Portfolio and app scope

Every event above is written to the portfolio log. When the call runs in an app
context (an assessment of one app), the same event with the same code and context
is also written to that app's log. The app copy of a final `http-error` uses level
warn. The app copy is not printed on the terminal a second time.

### 1.3 Other provider events

| Code | Level | Meaning | Source |
|---|---|---|---|
| `provider.llm.anthropic.temperature-retry` | info | The model rejected the `temperature` field; the request is re-sent without it (no attempt consumed) | `anthropic.ts` |
| `provider.llm.anthropic.tool-result` | info | An MCP tool returned a result in a chat tool loop (`tool`, `raw_chars`, `scrubbed_chars`) | `anthropic.ts` |
| `provider.llm.open-llm-provider.empty-response` | warn | The response carried neither `content` nor `reasoning_content` (`completion_tokens`, `hint`); portfolio and app scope | `open-llm-provider.ts` |
| `provider.open-llm.init` | info | `OpenLlmProvider` built (`model`, `hasProxy`, `tlsSkip`) | `open-llm-provider.ts` |
| `provider.llm.egress.redacted` | info | Pre-LLM redaction replaced content before egress (counts only) | `egress-redaction.ts` |
| `provider.llm.unknown` | error | Unknown legacy provider type | `factory.ts` |
| `provider.llm.max-concurrency-invalid` | warn | `providers.llm.max_concurrency` is not an integer from 1 to 64; the default applies | `factory.ts` |
| `provider.llm.leg-failover` | warn | The primary provider failed with a connectivity error; the secondary provider takes over | `packages/swao/src/commands/assess.ts` |
| `provider.llm.gateway.model-not-in-catalogue` | warn | Configured model is not in the connector catalogue (advisory) | `gateway/resolve.ts` |
| `provider.llm.gateway.token-command-executed`, `.token-command-failed` | info, warn | Connector `auth.token_command` ran (the token is never logged) | `gateway/resolve.ts` |
| `provider.llm.gateway.tls-reject-unauthorized-disabled`, `.tls-ca-bundle-not-found` | warn | Connector TLS overrides | `gateway/resolve.ts` |
| `provider.llm.gateway.alias-*` | warn | Model alias resolution (`alias-resolved`, `alias-no-match`, `alias-no-discovery`, `alias-discovery-failed`, `alias-batch-model`) | `gateway/alias-resolver.ts` |

Paths without a package are under `packages/@swao/module-llm-providers/src/`.

### 1.4 Codes replaced in v1.4.0 (#3284)

| Old code | New code |
|---|---|
| `provider.bedrock.retry` | `provider.llm.bedrock.retry` (plus the full event set) |
| `provider.llm.anthropic.tool-call-attempt` | `provider.llm.anthropic.attempt` with `kind: tools` and `iteration` |
| `provider.llm.gateway.ok` (app scope) | `provider.llm.open-llm-provider.ok` (portfolio and app scope) |
| `provider.llm.gateway.http-error` (app scope) | `provider.llm.open-llm-provider.http-error` |
| `provider.llm.gateway.empty-response` (app scope) | `provider.llm.open-llm-provider.empty-response` |

---

## 2. Timeouts, retries and concurrency

| Setting | Default | Meaning |
|---|---|---|
| Attempts per call | 6 | One initial attempt and up to 5 retries for every provider and call kind. Back-off 3, 6, 12, 24, 48 s. The health-check live ping uses 4 attempts so it answers within its 35 s ceiling. |
| Transient HTTP statuses | 408, 429, 5xx (including 529) | Retried with back-off. Other statuses fail at once. |
| `SWAO_LLM_IDLE_TIMEOUT_MS` | 120000 | Per-attempt idle timeout in ms: the wait for response headers and every gap between body chunks. `SWAO_ANTHROPIC_IDLE_TIMEOUT_MS` is still accepted as an alias; the provider-neutral name wins when both are set. |
| Non-streaming headers floor | 300000 | OpenAI, Ollama, open-LLM, Bedrock and tool calls do not stream, so no data arrives until the model has finished. Their headers phase uses the larger of the idle timeout and 300 s. |
| Total cap per attempt | 600000 | Hard limit for one attempt, headers and body together. |
| `providers.llm.max_concurrency` | 4 | Maximum LLM requests in flight per endpoint (provider and endpoint origin), shared by all passes of the process. Integer from 1 to 64. Set it in the workspace `.swao.yml`. |
| Connector `max_concurrency` | none | A gateway connector file may set its own limit. It applies when `.swao.yml` sets none. |

```yaml
# .swao.yml
providers:
  llm:
    max_concurrency: 2        # client gateway allows two parallel requests
    primary:
      connector: my-gateway
```

Pass 11 (compliance) sends its batch prompts concurrently and sizes its fan-out
from the same limit. A request waiting for a slot is not counted against the idle
timeout; the wait is reported as `queued_ms` on the `attempt` event.

---

## 3. Other event families

Codes and meaning, sourced from code. Paths are under `swao/packages/`.

| Family | Codes | Meaning | Source |
|---|---|---|---|
| `swao.run.*` | `start`, `complete`, `aborted` | One assessment run of an app: start and end. `complete` carries `status` (`complete`, `partial`, `failed` or `aborted`, as in `run-status.json`) and `exit_code` on every exit path, including gate exits (`--fail-on`) and errors (#3283); `aborted` is emitted for SIGINT, SIGTERM and uncaught exceptions only | `swao/src/commands/assess.ts`, `run-lifecycle.ts` |
| `assessment.*` | `pass.start`, `pass.complete`, `pass.connectivity-failure`, `pass.provider-error`, `pass.invalid-llm-response`, `pass.fatal`, `heartbeat` | Per-pass lifecycle of the assess engine, LLM failures per pass, periodic heartbeat | `swao/src/commands/assess.ts` |
| `assess.post_run.*` | `<step>.start`, `<step>.complete` | Timed post-pass steps (`file_counts`, `run_manifest`, `run_context`, `scope_coverage`, `portfolio_summary`, `plan_derivation`, `findings`, `pii_scrub`, `assessment_counter`, `run_retention`); `complete` carries `duration_ms` and `status` | `swao/src/commands/post-run-timing.ts` |
| `assess.pass.*` | `challenge.start/.skip/.complete`, `challenge-lz.start/.skip/.complete`, `sbom.external-inputs-found` | Challenge passes and SBOM inputs | `swao/src/commands/assess.ts`, `@swao/module-app-assessment/src/passes/pass-05-sbom.ts` |
| `assess.app.*`, `assess.lz.*` | `start`, `pass.start`, `pass.complete`, `complete`, `select.confirmed`, `provider.selected`, `region.selected`, `frameworks.selected` | TUI assessment screens | `@swao/module-app-assessment/src/tui/assess/` |
| `assess.preflight.*` | `llm.ping.ok`, `llm.ping.fail` | TUI LLM preflight ping | `@swao/module-app-assessment/src/tui/assess/shared/PreflightLlmPhase.tsx` |
| `lz.assessment.*` | `start`, `target.resolved`, `provider.start`, `provider.complete`, `provider.error` | Landing zone assessment per provider and region target | `swao/src/commands/assess.ts`, `lz-run-lifecycle.ts`, `lz-target-config.ts` |
| `lz.catalogue.*` | `update.start` | LZ catalogue update | `@swao/module-landing-zone/src/commands/lz-premium.ts` |
| `dynamic.*` | `start`, `complete`, `skip`, `error`, `playwright-absent`, `vision.start/.complete/.skipped/.cloud/.baseline/.baseline.error` | Dynamic analysis (Pass 10) and screenshot vision analysis | `swao/src/commands/assess.ts` |
| `ctx.pass.*` | `ceiling-risk`, `truncation-detected`, `json-parse-error` | Context pass (Pass 04) output limits | `@swao/module-app-assessment/src/passes/pass-04-ctx.ts` |
| `pass.iac.*`, `pass.malware.*` | `scanner.start/.complete/.skipped`, `tools.missing` | IaC scanner and malware tools | `@swao/module-app-assessment/src/passes/` |
| `provider.vcs.*` | `clone-start`, `clone-ok` | Source repository clone | `swao/src/commands/assess.ts` |
| `llm-assessment.*`, `leg.*`, `swao.llm.run.*` | `start`, `refused`, `pass.start`, `pass.complete`; `leg.start/.heartbeat/.stall/.error/.complete`; `run.start`, `run.complete` | LLM Assessment (model comparison) orchestration and legs | `swao/src/commands/assess.ts`, `@swao/module-llm-assessment/src/orchestrator.ts` |
| `health-check.*` | `start`, `probe.start`, `probe.complete`, `lz-catalogue-provenance` | `swao health-check` probes | `@swao/module-health-check/src/commands/health-check.ts` |
| `report.generate.*` | `start`, `ok`, `complete`, `error` | `swao report` | `swao/src/commands/report.ts` |
| `publish.*` | `start`, `ok`, `complete`, `error`, `editor.start/.stop`, `template.export` | HTML publication | `@swao/module-html-report/src/` |
| `export.*` | `start`, `complete`, `error` | Power BI export | `@swao/module-powerbi/src/export.ts` |
| `ingest.*` | `start`, `complete`, `error` | Context ingestion | `swao/src/commands/ingest.ts` |
| `credential.*` | `stored`, `deleted`, `store.error`, `export`, `import` | Credential store (names only, never values) | `@swao/core/src/credential-store.ts`, `swao/src/commands/credential.ts` |
| `licence.*` | `load`, `activate`, `remove`, `expired`, `invalid`, `upgrade_request`, `*.error` | Licence lifecycle and tier gates | `swao/src/commands/license.ts`, `swao/src/lib/license-gate-error.ts`, `swao/src/tui/screens/LicenseScreen.tsx` |
| `wizard.*`, `setup.*`, `wsp.setup.*`, `playwright.check.*` | `step.complete`, `llm.configured`, `credentials.llm.ping.ok/.fail`, `health-check.start/.complete/.empty`, `abort`, ... | Setup wizard steps | `swao/src/tui/screens/SetupWizard.tsx`, `swao/src/tui/screens/wizard/steps/` |
| `support.bundle.*` | `start`, `created` | `swao support-bundle` | `swao/src/commands/support-bundle.ts` |
| `swao.log.file-large` | warn | A log file passed the size threshold | `@swao/core/src/log.ts` |

---

## 4. Reading the logs

```bash
# All provider events of today's runs, newest last
grep '"code":"provider.llm.' wsp/logs/portfolio-events-2026-10.ndjson | tail -50

# Calls that waited for a concurrency slot
grep '"code":"provider.llm.[a-z-]*.attempt"' wsp/logs/portfolio-events-2026-10.ndjson | grep -v '"queued_ms":0'
```

`swao support-bundle` collects both log scopes for a support case.
