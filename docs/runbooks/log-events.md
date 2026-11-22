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
| `attempt` | info | An attempt is sent (after a concurrency slot was granted) | common fields, `endpoint`, `prompt_chars`, `idle_timeout_ms`, `idle_limit_ms` (the idle limit of this attempt, grows after a body idle timeout of a non-streaming call, #4471), `idle_limit_base_ms` (only when grown), `queued_ms`; tools: `iteration`, `max_iterations`, `tool_count` |
| `waiting` | info, or warn when no data arrived for 60 s on a streaming response or in the body phase | Every 60 s while an attempt is outstanding | common fields, `phase` (`headers` or `body`), `elapsed_ms`, `ms_since_data`, `bytes_received`, `idle_timeout_ms`, `idle_limit_ms` (#4471), `streaming` |
| `timeout` | warn | The idle or total limit ended the attempt; the request is aborted and retried | common fields, `phase`, `limit` (`idle` or `total`), `limit_ms`, `elapsed_ms`, `bytes_received` |
| `http-error` | warn when transient or re-sent at once; error when final (`open-llm-provider`: warn, #1896) | A non-2xx response | common fields, `http_status`, `reason`, `latency_ms`, `body_excerpt` (API error body, max 500 characters, PII fields removed for `open-llm-provider`), `transient`, `retry_now`; Anthropic: `temperature_deprecated`; open-llm: `token_refreshed` |
| `retry` | warn | Before the back-off sleep of the next attempt | common fields, `attempt` (the attempt that failed), `next_attempt`, `reason`, `delay_ms` |
| `ok` | info | The attempt succeeded | common fields, `http_status`, `latency_ms`, `tokens_in`, `tokens_out`, `cost_usd`; open-llm: `tokens_reasoning`, `content_source`; Anthropic tools: `stop_reason` |
| `error` | error | A non-retryable, non-HTTP failure (for example a missing response field) | common fields, `reason` (`non_retryable`), `error_name`, `error_message` (max 300 characters), `latency_ms` |
| `connectivity-failure` | error | Every attempt failed; the call throws a connectivity error and the pass degrades or fails over (#1703) | `provider`, `model`, `kind`, `image_count` (vision), `max_attempts`, `reason`, `last_error` (max 300 characters) |

Common fields: `provider`, `model`, `kind` (`text`, `vision` or `tools`),
`image_count` (vision only), `attempt`, `max_attempts`. A call made for a known
caller also carries `caller` (for example `service.research.vendor-profile`) and
`app_id` when it is made for an app (#4270, `withLlmCallContext` in
`@swao/core/src/llm-call-context.ts`); the caller sums the `cost_usd` of its ok
events into its own `llm_calls` and `cost_usd`.

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
| `provider.llm.gateway.alias-*` | warn | Model alias resolution (`alias-resolved`, `alias-no-match`, `alias-no-discovery`, `alias-discovery-failed`; `alias-batch-model` no longer occurs: batch-only ids are never picked, #4500) | `gateway/alias-resolver.ts` |

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
| Growing body idle limit (#4471) | 120, 240, 360 s | A non-streaming call receives its body only when the model has finished, so the body idle limit works as a limit on the generation time. After a body idle timeout the next attempt of the same call waits one more base limit (`SWAO_LLM_IDLE_TIMEOUT_MS` times the body idle timeouts plus one), capped at 360 s (`LLM_IDLE_GROWTH_CAP_MS`, never below the base). Streaming calls keep the base limit. The limit in use is `idle_limit_ms` on the `attempt` and `waiting` events. |
| Retry counter (#4469) | none | The request helper counts every attempt and back-off retry in the `@swao/core` retry counter (`withLlmRetryCounter`); the LLM Assessment recorder reads it, so a call record's `reliability.retries` is the real retry count (5 after 6 attempts). |
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

Codes and meaning, sourced from code. Paths are under `swao/packages/`. Every event message is dash-normalised when written (`@swao/core` `log.ts`, #4462): no em dash, en dash or spaced double hyphen.

| Family | Codes | Meaning | Source |
|---|---|---|---|
| `swao.run.*` | `start`, `complete`, `aborted` | One assessment run of an app: start and end. `complete` carries `status` (`complete`, `partial`, `failed` or `aborted`, as in `run-status.json`) and `exit_code` on every exit path, including gate exits (`--fail-on`) and errors (#3283); `aborted` is emitted for SIGINT, SIGTERM and uncaught exceptions only | `swao/src/commands/assess.ts`, `run-lifecycle.ts` |
| `assessment.*` | `pass.start`, `pass.complete`, `pass.connectivity-failure`, `pass.provider-error`, `pass.invalid-llm-response`, `pass.fatal`, `heartbeat` | Per-pass lifecycle of the assess engine, LLM failures per pass, periodic heartbeat | `swao/src/commands/assess.ts` |
| `assess.post_run.*` | `<step>.start`, `<step>.complete`, `<step>.failed` | Timed post-pass steps (`file_counts`, `run_manifest`, `run_context`, `scope_coverage`, `portfolio_summary`, `plan_derivation`, `findings`, `pii_scrub`, `assessment_counter`, `run_retention`); `complete` (level info, `status: ok`) and `failed` (level warn, `status: error`, plus `error`) carry `duration_ms`. A step logs one or the other, never both. A failed step is non-fatal; `assessment_counter.failed` also prints one operator warning and the run is not counted (one write attempt, no retry, so no double count) (#3440). The LLM Assessment and landing-zone catalogue flows have no post-run timer: there `assessment_counter.failed` is logged alone, without `.start` (expected, not an anomaly) | `swao/src/commands/post-run-timing.ts` |
| `assess.pass.*` | `challenge.start/.skip/.complete`, `challenge-lz.start/.skip/.complete`, `sbom.external-inputs-found` | Challenge passes and SBOM inputs | `swao/src/commands/assess.ts`, `@swao/module-app-assessment/src/passes/pass-05-sbom.ts` |
| `assess.app.*`, `assess.lz.*` | `start`, `pass.start`, `pass.complete`, `complete`, `select.confirmed`, `provider.selected`, `region.selected`, `frameworks.selected` | TUI assessment screens | `@swao/module-app-assessment/src/tui/assess/` |
| `assess.preflight.*` | `llm.ping.ok`, `llm.ping.fail` | TUI LLM preflight ping | `@swao/module-app-assessment/src/tui/assess/shared/PreflightLlmPhase.tsx` |
| `lz.assessment.*` | `start`, `target.resolved`, `provider.start`, `provider.complete`, `provider.error` | Landing zone assessment per provider and region target | `swao/src/commands/assess.ts`, `lz-run-lifecycle.ts`, `lz-target-config.ts` |
| `lz.live.probe` | one per scope and probe call | Landing zone read-only probe (#4265): `lz_id`, `scope_id`, `caller` (`lz.probe`, `lz.connect`, `health-check.lz_connections`, `wizard.lz-live.probe`), `read_only`, `reason` and `detected_permissions` (masked, no native ids), `overrides`, `proceed`, `override_hint` (only when the scope is stopped), `accepted` (true for a write-capable login accepted for the run; the message then reads `<lz>/<scope> write-capable, accepted for this run`, #4460; a probe (`lz.probe`, `wizard.lz-live.probe`, `lz.connect`) never reads "stopped": a write-capable login reads `<lz>/<scope> write-capable, needs a confirmation per run`); a scope that cannot be probed logs `<lz>/<scope> not probed` (warn) with `read_only` `login-failed` or `not-probed`, `http_status` for a refused sign-in, the masked first error line as `reason` and `display_level` `fail` (#4496), `duration_ms`; warn when stopped | `@swao/module-landing-zone/src/live/session.ts` |
| `lz.credentials.refresh` | one per refresh | `swao lz credentials refresh` and the TUI action "Refresh the AWS SSO session" (#4459): `lz`, `scope`, `profile` (the AWS profile name), `outcome`, and on success `expires_at` and `fields`; never a key, token, client secret or device code | `@swao/module-landing-zone/src/live/aws/aws-sso-scope.ts` |
| `service.intake.import.*` | `start`, `complete` | `swao service init` (#4270): exactly one of each; `complete` carries `status` (`ok`, `refused`, `failed`), `source` (workspace-relative, else the file name), `rows_read`, `apps_created`, `apps_updated`, `apps_skipped`, `apps_rejected`, `apps_not_in_intake`, `duration_ms` | `@swao/module-service-assessment/src/scaffold/init.ts` |
| `service.research.*` | `prepare.start`, `prepare.phase`, `prepare.complete`, `estimate`, `start`, `app.complete`, `app.failed`, `complete` | `swao service research` (#4270): `prepare.start` as the first line of the research child, one `prepare.phase` per preparation step (`step`, `duration_ms`) and `prepare.complete` (`duration_ms` since `prepare.start`) before `start` (#4485); `estimate` (expected LLM calls and cost, `above_threshold` against `service_portfolio.cost_confirm_usd`; One service counts the cached topics of that app, #4497), one `app.complete` or `app.failed` per app (`index`, `total`, topics written, `signals`, `llm_calls`, `cost_usd`, `duration_ms`; a failed app does not stop the batch), `complete` with `apps_ok`, `apps_failed`, `llm_calls`, `cost_usd`, `duration_ms` and `skipped_reasons` per topic (`no_api_key`, `no_binary_hash`, `no_input`, ...) | `@swao/module-service-assessment/src/research/research.ts`, `swao/src/commands/service-batch-log.ts` |
| `service.assess.batch.*` | `start`, `progress`, `complete`, `cancel` | Service assessment of N apps (#4273), CLI `swao service assess` and the TUI Service Portfolio Assessment: one `start` (`apps_total`, `selection`, `caller`), N `progress` (`index`, `total`, `app_id`, `status`, `exit_code`, `duration_ms`, `cost_usd`, and from sprint 158 `model` and `llm_calls` of the app run, used for the per-model estimate, #4457), one `complete` (`ok`, `failed`, `skipped`, `duration_ms`, `cost_usd`, `llm_calls`) or `cancel` (`last_completed_index`) | `swao/src/commands/service-batch-log.ts` |
| `assess.service.*` | `start`, `complete` | TUI Service Portfolio Assessment screen, analogous to `assess.app.*` (#4273): `start` when a run or re-run is confirmed, `complete` with `ok`, `exit_code`, `duration_ms`, `llm_calls` (= `llm_calls_research` + `llm_calls_assess`, #4457); its message names the imported and the assessed app count | `swao/src/tui/screens/ServiceInitScreen.tsx` |
| `service.pipeline.step.*` | `start`, `progress`, `complete` | TUI Service Portfolio Assessment pipeline steps (#4457): one `start` and one `complete` (`duration_ms`) per step (`discover`, `scaffold`, `research`, `rank`, `assess`, `export`), a `progress` line every 15 s while a step runs | `swao/src/commands/service-batch-log.ts`, `swao/src/tui/screens/ServiceInitScreen.tsx` |
| `service.export.*` | `start`, `complete` | Service portfolio export step as a whole (#4457, timedServiceStep) | `swao/src/commands/service.ts` |
| `assess.post_run.portfolio_summary.phase`, `assess.post_run.portfolio_summary.phase.start` | `phase`, `phase.start` | A rebuild step of 1 s or more logs `phase` with `phase` and `duration_ms`; each cross-app step (`integration_graph`, `waves`, `vendors`, `write`) logs `phase.start` when it begins and then always its `phase` line (#4412). The premium export logs the same as `service.export.portfolio_summary.phase` and `.phase.start` | `swao/src/commands/post-run-timing.ts`, `swao-premium/.../module-service-export/src/portfolio-export.ts` |
| `service.research.portfolio_summary.*`, `service.research.portfolio_delta.*` | `start`, `complete` | Portfolio summary rebuild and delta inside the research child (#4457, #4412); the summary `complete` carries `steps_ms` (the parts of setup and write) and `bytes` | `swao/src/commands/service.ts` (timedServiceStep), `@swao/core/src/portfolio-summary.ts` |
| `lz.catalogue.*` | `update.start` | LZ catalogue update | `@swao/module-landing-zone/src/commands/lz-premium.ts` |
| `dynamic.*` | `start`, `complete`, `skip`, `error`, `playwright-absent`, `vision.start/.complete/.skipped/.cloud/.baseline/.baseline.error` | Dynamic analysis (Pass 10) and screenshot vision analysis | `swao/src/commands/assess.ts` |
| `ctx.pass.*` | `ceiling-risk`, `truncation-detected`, `json-parse-error` | Context pass (Pass 04) output limits | `@swao/module-app-assessment/src/passes/pass-04-ctx.ts` |
| `pass.iac.*`, `pass.malware.*` | `scanner.start/.complete/.skipped`, `tools.missing` | IaC scanner and malware tools | `@swao/module-app-assessment/src/passes/` |
| `provider.vcs.*` | `clone-start`, `clone-ok` | Source repository clone | `swao/src/commands/assess.ts` |
| `llm-assessment.*`, `leg.*`, `swao.llm.run.*` | `start`, `refused`, `pass.start`, `pass.complete`; `leg.start/.heartbeat/.stall/.failed/.error/.complete`; `run.start`, `run.synthesis.progress`, `run.complete` | LLM Assessment (model comparison) orchestration and legs; see section 3.1 for the leg events of sprint 158 | `swao/src/commands/assess.ts`, `@swao/module-llm-assessment/src/orchestrator.ts` |
| `health-check.*` | `start`, `prefetch.start`, `prefetch.complete`, `prefetch.tools.complete`, `prefetch.failed`, `probe.start`, `probe.complete`, `lz-catalogue-provenance` | `swao health-check` probes. From sprint 158 `probe.complete` carries `cpu_ms`, `files_read`, `bytes_read`, `slowest_step` and, above 10 s, `slow_cause` (CPU or waiting, #4461); `prefetch.tools.complete` (warn when a check timed out) carries per tool version check `ms`, `outcome` (`found`, `not_found`, `timeout`, `error`), `retry_ms` and `timed_out`, and the prerequisites probe repeats them as `detect_ms`, `detect_outcome`, `detect_retry_ms`, `detect_timed_out` (#4487, #4488); the Playwright probe adds `reason` (`not_found`, `package_missing`, `timeout`, `launch_error`), `message`, `error_detail` (the raw launch error, log only, Design 126), `launch_ms` and `close_ms` (#4451) | `@swao/module-health-check/src/commands/health-check.ts` |
| `report.generate.*` | `start`, `ok`, `complete`, `error` | `swao report` | `swao/src/commands/report.ts` |
| `publish.*` | `start`, `ok`, `complete`, `error`, `precondition.missing` (warn: no live run or no portfolio merge yet, after `start`, #4125), `editor.start/.stop`, `template.export` | HTML publication | `@swao/module-html-report/src/` |
| `publish.evidence.unresolved`, `publish.secrets.masked` | one each per application or landing zone live page (#4468) | The publish warnings as events, app and portfolio log, written after `publish.ok` without a console mirror (the WARN line is printed already). `publish.evidence.unresolved`: `signals`, `risk_register`, `compliance` (refs that did not resolve to an Evidence Gallery entry, expected 0), `total`, `not_in_inputs` (refs naming a file the app inputs do not contain, rendered "file not in inputs"), `type`, `app`, `file`; warn when `total` or `not_in_inputs` is above 0, else info. `publish.secrets.masked`: `count` of secret-shaped values the output guard masked; warn above 0, else info. Never a value | `@swao/module-html-report/src/commands/publish-report-events.ts` |
| `export.*` | `start`, `complete`, `error` | Power BI export | `@swao/module-powerbi/src/export.ts` |
| `ingest.*` | `start`, `complete`, `error` | Context ingestion | `swao/src/commands/ingest.ts` |
| `credential.*` | `stored`, `deleted`, `store.error`, `export`, `import` | Credential store (names only, never values) | `@swao/core/src/credential-store.ts`, `swao/src/commands/credential.ts` |
| `licence.*` | `load`, `activate`, `remove`, `expired`, `invalid`, `upgrade_request`, `*.error`, `state.corrupt` | Licence lifecycle and tier gates. `state.corrupt` (level error, portfolio scope): the licence state file (assessment counter, fingerprint) is not valid JSON or not the expected shape; it is not reset, its bytes are kept as `<state>.corrupt-<hash>` and the command stops with recovery guidance (#3440) | `swao/src/commands/license.ts`, `swao/src/lib/license-gate-error.ts`, `swao/src/tui/screens/LicenseScreen.tsx`, `@swao/core/src/license-guard.ts` |
| `wizard.*`, `setup.*`, `wsp.setup.*`, `playwright.check.*` | `step.complete` (one per step, with the step key and the step's context), `step.cancelled`, `credentials.llm.ping.ok/.fail`, `llm.model-check.ok/.skipped/.fail` (the test call of the chosen model in the LLM step, #4500), `llm.connector-update` (the connector file update offer, #4491), `health-check.start/.complete/.empty`, `abort`, ... (`llm.configured`, `llm.secondary.configured` and `integrations.mcp.complete` were retired by #4275: they duplicated `step.complete` of the same step) | Setup wizard steps | `swao/src/tui/screens/SetupWizard.tsx`, `swao/src/tui/screens/wizard/steps/` |
| `challenge.*` | `session.start`, `session.complete`, `agent.start`, `agent.complete`, `agent.error`, `auth_failed`, `output.invalid`, `error` | App Stakeholder Challenge and LZ Sovereignty Challenge, one family with `type` (`app` or `lz`) (#4275, Design 074 section 5.3): one line per transition; `agent.complete` carries `agent_id`, `role`, `output`, `duration_ms`, `llm_calls`, `cost_usd`; `session.complete` carries `agents_total`, `agents_ok`, `agents_failed`, `duration_ms` (CLI runs also `llm_calls`, `cost_usd`), app and portfolio log. Retired, no alias emitted: `challenge.start` / `challenge.complete` (per app agent and combined report), `challenge.stakeholder.start` / `.complete` and `challenge-lz.complete` (per LZ agent); read them as `challenge.agent.*` and `challenge.session.*` in logs written before sprint 158 | challenge module, `challenge/events.ts` |
| `support.bundle.*` | `start`, `created` | `swao support-bundle` | `swao/src/commands/support-bundle.ts` |
| `swao.log.file-large` | warn | A log file passed the size threshold | `@swao/core/src/log.ts` |

### 3.1 LLM Assessment leg events in the run log (sprint 158)

Written to `llm-assessments/swao/<run>/log.ndjson` (Design 092 section 5.7).

| Code | Level | When | Context fields |
|---|---|---|---|
| `leg.heartbeat` | info | Every 30 s while a leg runs (`SWAO_LEG_HEARTBEAT_MS`) | `leg_id`, `elapsed_ms`, `calls_so_far`; from #4469 also `pass` (current pass, "03 data_classification"), and while a call retries `attempt`, `max_attempts`, `last_error` (retry reason, for example `timeout_idle_body`) |
| `leg.pass.start`, `leg.pass.complete` | info | A pass of the leg starts or completes, forwarded from the leg's own event log while the leg runs (#4469) | `leg_id`, `pass`, `pass_id`; complete: `wall_clock_ms` |
| `leg.pass.degraded` | warn | Every LLM attempt of a pass failed (the pass degrades, #4469) | `leg_id`, `pass`, `pass_id` |
| `leg.llm.retry` | warn | A leg call retries; message `leg <id>: pass 03 ...: retry 1 of 5 after a body timeout, attempt 2 of 6 in 3 s` (#4469) | `leg_id`, `pass` or `caller` (challenge calls), `provider`, `model`, `attempt`, `next_attempt`, `max_attempts`, `reason`, `delay_ms` |
| `leg.llm.timeout` | warn | A leg call attempt timed out (#4469) | `leg_id`, `pass`, `provider`, `attempt`, `max_attempts`, `phase`, `limit`, `limit_ms`, `elapsed_ms` |
| `leg.llm.http-error`, `leg.llm.connectivity-failure` | warn | A leg call got an HTTP error, or all its attempts failed (#4469) | `leg_id`, `pass`, `provider`, `attempt` / `max_attempts`, `http_status` or `reason` |
| `leg.stall` | warn | A leg limit fired (#4470): `limit: stall` = no leg activity for `SWAO_LEG_STALL_TIMEOUT_MS` (default 30 min; activity = a pass event, an LLM attempt / waiting / ok / retry event, a heartbeat with a new pass, or a new call record), `limit: total` = the leg ran `SWAO_LEG_MAX_MS` (default 3 h). The leg process tree is killed by PID | `leg_id`, `limit`, `timeout_ms`, `idle_ms`, `elapsed_ms`, `calls_so_far`, `pass`, `attempt`, `pid` |
| `leg.failed` | error | A leg failed | `leg_id`, `status`, `exit`, `calls`, `reason`, `last_phase`, `wall_clock_ms`, `spawn_ms`, `stderr_log`, `stderr_tail`, `workspace`; from #4470 `last_pass`, `limit`, `killed: true` and `exited` (the process ended within `SWAO_LEG_KILL_GRACE_MS`, default 15 s) after a fired limit, `pid` |
| `leg.challenge.stall`, `leg.challenge-lz.stall` | warn | A challenge limit fired (#4478): `limit: stall` = no challenge activity for `SWAO_CHALLENGE_STALL_TIMEOUT_MS` (default 30 min; activity = a new event in the leg's event log or a new call record in the leg sink), `limit: total` = the challenge ran `SWAO_CHALLENGE_MAX_MS` (default 2 h). The challenge process tree is killed by PID; the leg result stays and the run goes on | `leg_id`, `llm_run_id`, `limit`, `timeout_ms`, `idle_ms`, `elapsed_ms`, `calls_so_far`, `pid` |
| `leg.challenge.complete`, `leg.challenge-lz.complete` | info / warn | A leg challenge ended; warn with a non-zero exit (#4323) or when the orchestrator ended it (#4478: message `leg ... challenge failed: <reason>`) | `leg_id`, `llm_run_id`, `agents`, `exit_code`, `stderr_tail`; from #4478 after a fired limit or a cancel `failure_reason`, `limit` and `killed: true` (or `cancelled: true`), `exited` (the process ended within `SWAO_LEG_KILL_GRACE_MS`), `pid` |
| `run.synthesis.progress` | info | Each synthesis step (`tick: false`) and every 15 s while it runs (`tick: true`, `SWAO_LLM_STATUS_TICK_MS`) (#4472) | `step`, `elapsed_ms`, `tick` |

---

## 4. Reading the logs

```bash
# All provider events of today's runs, newest last
grep '"code":"provider.llm.' wsp/logs/portfolio-events-2026-10.ndjson | tail -50

# Calls that waited for a concurrency slot
grep '"code":"provider.llm.[a-z-]*.attempt"' wsp/logs/portfolio-events-2026-10.ndjson | grep -v '"queued_ms":0'
```

`swao support-bundle` collects both log scopes for a support case.
