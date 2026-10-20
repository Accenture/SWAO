<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Log Event Reference (DE)
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->
# Referenz der Log-Ereignisse

**Gilt für:** SWAO v1.4.0+  
**Zugehörige Issues:** #3284 (gemeinsamer LLM-Request-Helper), #3221, #3225, #3222

SWAO schreibt strukturierte Ereignisse in zwei NDJSON-Logdateien im Workspace:

| Bereich | Datei |
|---|---|
| Portfolio | `<workspace>/wsp/logs/portfolio-events-<YYYY-MM>.ndjson` |
| App | `<workspace>/apps/<app-id>/wsp/logs/app-events-<YYYY-MM>.ndjson` |

Jede Zeile ist ein JSON-Objekt mit `ts` (ISO 8601 UTC), `level` (`debug`, `info`,
`warn`, `error`, `enhancement`), `scope` (`portfolio` oder `app`), `code`
(Ereigniscode mit Punkten), `message`, einem optionalen `context`-Objekt und im
App-Bereich `app_id` (`packages/@swao/core/src/log.ts`). Ereignisse der Stufen
`warn` und `error` erscheinen zusätzlich im Terminal. Die Dateien rotieren monatlich.

Der Kontext enthält nie Prompt-Text, Request-Bodies, Bilddaten, API-Schlüssel oder
Tokens (CLAUDE.md Abschnitt 5.7). Benutzerangaben in URLs werden beim Schreiben entfernt.

---

## 1. Ereignisse der LLM-Provider

Jeder LLM-Aufruf läuft für jeden Provider und jede Aufrufart über einen
gemeinsamen Request-Helper (`packages/@swao/module-llm-providers/src/llm-request.ts`,
`requestLlmWithRetry`). Er wendet eine Retry-Regel, eine Zählweise der Versuche,
einen Idle-Watchdog und den Concurrency-Limiter auf Provider-Ebene an und
schreibt für jeden Provider dieselben Ereignisse.

### 1.1 Ereigniscodes

Der Code lautet `provider.llm.<provider>.<event>`; `<provider>` ist einer von:

| `<provider>` | Treiber | Aufrufarten |
|---|---|---|
| `anthropic` | `anthropic.ts` (auch Gateway-Protokoll `anthropic-messages`) | text, vision, tools |
| `openai` | `openai.ts` | text, vision |
| `ollama` | `ollama.ts` (auch Gateway-Protokoll `ollama`) | text, vision |
| `open-llm-provider` | `open-llm-provider.ts` (auch Gateway-Protokoll `openai-chat`) | text, vision, tools |
| `bedrock` | `bedrock.ts` (Gateway-Protokoll `bedrock`, AWS SDK) | text |

| Ereignis | Stufe | Wann | Kontextfelder |
|---|---|---|---|
| `attempt` | info | Ein Versuch wird gesendet (nachdem ein Concurrency-Slot frei war) | gemeinsame Felder, `endpoint`, `prompt_chars`, `idle_timeout_ms`, `queued_ms`; text/vision: `api_key_suffix` (nur die letzten 4 Zeichen, falls ein Schlüssel genutzt wird); tools: `iteration`, `max_iterations`, `tool_count` |
| `waiting` | info, oder warn, wenn bei einer Streaming-Antwort oder in der Body-Phase 60 s keine Daten kamen | Alle 60 s, solange ein Versuch offen ist | gemeinsame Felder, `phase` (`headers` oder `body`), `elapsed_ms`, `ms_since_data`, `bytes_received`, `idle_timeout_ms`, `streaming` |
| `timeout` | warn | Das Idle- oder Gesamtlimit hat den Versuch beendet; der Request wird abgebrochen und wiederholt | gemeinsame Felder, `phase`, `limit` (`idle` oder `total`), `limit_ms`, `elapsed_ms`, `bytes_received` |
| `http-error` | warn bei transienten oder sofort neu gesendeten Antworten; error bei endgültigen (`open-llm-provider`: warn, #1896) | Eine Antwort außerhalb von 2xx | gemeinsame Felder, `http_status`, `reason`, `latency_ms`, `body_excerpt` (Fehlertext der API, max. 500 Zeichen, bei `open-llm-provider` ohne PII-Felder), `transient`, `retry_now`; Anthropic: `temperature_deprecated`; open-llm: `token_refreshed` |
| `retry` | warn | Vor der Wartezeit bis zum nächsten Versuch | gemeinsame Felder, `attempt` (der fehlgeschlagene Versuch), `next_attempt`, `reason`, `delay_ms` |
| `ok` | info | Der Versuch war erfolgreich | gemeinsame Felder, `http_status`, `latency_ms`, `tokens_in`, `tokens_out`, `cost_usd`; open-llm: `tokens_reasoning`, `content_source`; Anthropic tools: `stop_reason` |
| `error` | error | Ein nicht wiederholbarer Fehler ohne HTTP-Status (zum Beispiel ein fehlendes Antwortfeld) | gemeinsame Felder, `reason` (`non_retryable`), `error_name`, `error_message` (max. 300 Zeichen), `latency_ms` |
| `connectivity-failure` | error | Alle Versuche sind fehlgeschlagen; der Aufruf meldet einen Verbindungsfehler, der Pass degradiert oder wechselt auf den Sekundär-Provider (#1703) | `provider`, `model`, `kind`, `image_count` (vision), `max_attempts`, `reason`, `last_error` (max. 300 Zeichen) |

Gemeinsame Felder: `provider`, `model`, `kind` (`text`, `vision` oder `tools`),
`image_count` (nur vision), `attempt`, `max_attempts`.

Alle Meldungen zählen Versuche gleich: `attempt N/6`. Eine Retry-Zeile lautet
`attempt 1/6 failed (...), retrying in 3s as attempt 2/6`.

Werte von `reason`: `bad_request`, `auth`, `not_found`, `request_timeout`,
`payload_too_large`, `rate_limited`, `overloaded`, `server_error`, `client_error`
(HTTP-Status), `timeout_idle_headers`, `timeout_idle_body`,
`timeout_total_headers`, `timeout_total_body` (Watchdog),
`network_or_malformed_response` (Netzwerkfehler oder fehlerhafte bzw. abgeschnittene
Antwort), `non_retryable`.

### 1.2 Portfolio- und App-Bereich

Jedes der obigen Ereignisse wird ins Portfolio-Log geschrieben. Läuft der Aufruf
im Kontext einer App (Assessment einer Anwendung), wird dasselbe Ereignis mit
demselben Code und Kontext zusätzlich ins Log dieser App geschrieben. Die App-Kopie
eines endgültigen `http-error` hat die Stufe warn. Die App-Kopie erscheint nicht ein
zweites Mal im Terminal.

### 1.3 Weitere Provider-Ereignisse

| Code | Stufe | Bedeutung | Quelle |
|---|---|---|---|
| `provider.llm.anthropic.temperature-retry` | info | Das Modell lehnt das Feld `temperature` ab; der Request wird ohne das Feld neu gesendet (zählt nicht als Versuch) | `anthropic.ts` |
| `provider.llm.anthropic.tool-result` | info | Ein MCP-Tool hat im Chat-Tool-Loop ein Ergebnis geliefert (`tool`, `raw_chars`, `scrubbed_chars`) | `anthropic.ts` |
| `provider.llm.open-llm-provider.empty-response` | warn | Die Antwort enthielt weder `content` noch `reasoning_content` (`completion_tokens`, `hint`); Portfolio- und App-Bereich | `open-llm-provider.ts` |
| `provider.open-llm.init` | info | `OpenLlmProvider` erstellt (`model`, `hasProxy`, `tlsSkip`) | `open-llm-provider.ts` |
| `provider.llm.egress.redacted` | info | Die Redaktion vor dem LLM-Aufruf hat Inhalte ersetzt (nur Zähler) | `egress-redaction.ts` |
| `provider.llm.unknown` | error | Unbekannter Provider-Typ (Legacy-Pfad) | `factory.ts` |
| `provider.llm.max-concurrency-invalid` | warn | `providers.llm.max_concurrency` ist keine ganze Zahl von 1 bis 64; der Standardwert gilt | `factory.ts` |
| `provider.llm.leg-failover` | warn | Der Primär-Provider meldet einen Verbindungsfehler; der Sekundär-Provider übernimmt | `packages/swao/src/commands/assess.ts` |
| `provider.llm.gateway.model-not-in-catalogue` | warn | Das konfigurierte Modell steht nicht im Katalog des Connectors (Hinweis) | `gateway/resolve.ts` |
| `provider.llm.gateway.token-command-executed`, `.token-command-failed` | info, warn | `auth.token_command` des Connectors wurde ausgeführt (das Token wird nie protokolliert) | `gateway/resolve.ts` |
| `provider.llm.gateway.tls-reject-unauthorized-disabled`, `.tls-ca-bundle-not-found` | warn | TLS-Einstellungen des Connectors | `gateway/resolve.ts` |
| `provider.llm.gateway.alias-*` | warn | Auflösung von Modell-Aliasen (`alias-resolved`, `alias-no-match`, `alias-no-discovery`, `alias-discovery-failed`, `alias-batch-model`) | `gateway/alias-resolver.ts` |

Pfade ohne Paketangabe liegen unter `packages/@swao/module-llm-providers/src/`.

### 1.4 In v1.4.0 ersetzte Codes (#3284)

| Alter Code | Neuer Code |
|---|---|
| `provider.bedrock.retry` | `provider.llm.bedrock.retry` (plus alle Ereignisse aus 1.1) |
| `provider.llm.anthropic.tool-call-attempt` | `provider.llm.anthropic.attempt` mit `kind: tools` und `iteration` |
| `provider.llm.gateway.ok` (App-Bereich) | `provider.llm.open-llm-provider.ok` (Portfolio- und App-Bereich) |
| `provider.llm.gateway.http-error` (App-Bereich) | `provider.llm.open-llm-provider.http-error` |
| `provider.llm.gateway.empty-response` (App-Bereich) | `provider.llm.open-llm-provider.empty-response` |

---

## 2. Timeouts, Wiederholungen und Parallelität

| Einstellung | Standard | Bedeutung |
|---|---|---|
| Versuche pro Aufruf | 6 | Ein erster Versuch und bis zu 5 Wiederholungen für jeden Provider und jede Aufrufart. Wartezeiten 3, 6, 12, 24, 48 s. Der Live-Ping von `swao health-check` nutzt 4 Versuche, damit er innerhalb seiner Grenze von 35 s antwortet. |
| Transiente HTTP-Status | 408, 429, 5xx (inklusive 529) | Werden mit Wartezeit wiederholt. Andere Status schlagen sofort fehl. |
| `SWAO_LLM_IDLE_TIMEOUT_MS` | 120000 | Idle-Timeout pro Versuch in ms: Warten auf die Antwort-Header und jede Lücke zwischen Body-Daten. `SWAO_ANTHROPIC_IDLE_TIMEOUT_MS` gilt weiterhin als Alias; sind beide gesetzt, gewinnt der Provider-neutrale Name. |
| Mindestwartezeit auf Header ohne Streaming | 300000 | OpenAI, Ollama, open-LLM, Bedrock und Tool-Aufrufe streamen nicht; Daten kommen erst, wenn das Modell fertig ist. Ihre Header-Phase nutzt den größeren Wert aus Idle-Timeout und 300 s. |
| Gesamtgrenze pro Versuch | 600000 | Harte Grenze für einen Versuch, Header und Body zusammen. |
| `providers.llm.max_concurrency` | 4 | Maximal gleichzeitig offene LLM-Requests pro Endpunkt (Provider und Endpunkt-Origin), gemeinsam für alle Passes des Prozesses. Ganze Zahl von 1 bis 64. Wird in der Workspace-`.swao.yml` gesetzt. |
| `max_concurrency` im Connector | keiner | Eine Gateway-Connector-Datei kann ein eigenes Limit setzen. Es gilt, wenn `.swao.yml` keines setzt. |

```yaml
# .swao.yml
providers:
  llm:
    max_concurrency: 2        # client gateway allows two parallel requests
    primary:
      connector: my-gateway
```

Pass 11 (Compliance) sendet seine Batch-Prompts parallel und bemisst die Anzahl am
selben Limit. Die Wartezeit auf einen freien Slot zählt nicht zum Idle-Timeout; sie
steht als `queued_ms` im Ereignis `attempt`.

---

## 3. Weitere Ereignisfamilien

Codes und Bedeutung, aus dem Code abgeleitet. Pfade liegen unter `swao/packages/`.

| Familie | Codes | Bedeutung | Quelle |
|---|---|---|---|
| `swao.run.*` | `start`, `complete`, `aborted` | Ein Assessment-Lauf einer App: Start und Ende. `complete` trägt auf jedem Ausgangspfad `status` (`complete`, `partial`, `failed` oder `aborted`, wie in `run-status.json`) und `exit_code`, auch bei Gate-Abbrüchen (`--fail-on`) und Fehlern (#3283); `aborted` wird nur bei SIGINT, SIGTERM und nicht abgefangenen Ausnahmen ausgegeben | `swao/src/commands/assess.ts`, `run-lifecycle.ts` |
| `assessment.*` | `pass.start`, `pass.complete`, `pass.connectivity-failure`, `pass.provider-error`, `pass.invalid-llm-response`, `pass.fatal`, `heartbeat` | Lebenszyklus der Passes, LLM-Fehler pro Pass, regelmäßiger Heartbeat | `swao/src/commands/assess.ts` |
| `assess.post_run.*` | `<step>.start`, `<step>.complete` | Gemessene Schritte nach den Passes (`file_counts`, `run_manifest`, `run_context`, `scope_coverage`, `portfolio_summary`, `plan_derivation`, `findings`, `pii_scrub`, `assessment_counter`, `run_retention`); `complete` enthält `duration_ms` und `status` | `swao/src/commands/post-run-timing.ts` |
| `assess.pass.*` | `challenge.start/.skip/.complete`, `challenge-lz.start/.skip/.complete`, `sbom.external-inputs-found` | Challenge-Passes und SBOM-Eingaben | `swao/src/commands/assess.ts`, `@swao/module-app-assessment/src/passes/pass-05-sbom.ts` |
| `assess.app.*`, `assess.lz.*` | `start`, `pass.start`, `pass.complete`, `complete`, `select.confirmed`, `provider.selected`, `region.selected`, `frameworks.selected` | Assessment-Bildschirme der TUI | `@swao/module-app-assessment/src/tui/assess/` |
| `assess.preflight.*` | `llm.ping.ok`, `llm.ping.fail` | LLM-Preflight-Ping der TUI | `@swao/module-app-assessment/src/tui/assess/shared/PreflightLlmPhase.tsx` |
| `lz.assessment.*` | `start`, `target.resolved`, `provider.start`, `provider.complete`, `provider.error` | Landing-Zone-Assessment pro Provider und Region | `swao/src/commands/assess.ts`, `lz-run-lifecycle.ts`, `lz-target-config.ts` |
| `lz.catalogue.*` | `update.start` | Aktualisierung des LZ-Katalogs | `@swao/module-landing-zone/src/commands/lz-premium.ts` |
| `dynamic.*` | `start`, `complete`, `skip`, `error`, `playwright-absent`, `vision.start/.complete/.skipped/.cloud/.baseline/.baseline.error` | Dynamische Analyse (Pass 10) und Screenshot-Analyse | `swao/src/commands/assess.ts` |
| `ctx.pass.*` | `ceiling-risk`, `truncation-detected`, `json-parse-error` | Ausgabegrenzen des Kontext-Pass (Pass 04) | `@swao/module-app-assessment/src/passes/pass-04-ctx.ts` |
| `pass.iac.*`, `pass.malware.*` | `scanner.start/.complete/.skipped`, `tools.missing` | IaC-Scanner und Malware-Werkzeuge | `@swao/module-app-assessment/src/passes/` |
| `provider.vcs.*` | `clone-start`, `clone-ok` | Klonen des Quell-Repositorys | `swao/src/commands/assess.ts` |
| `llm-assessment.*`, `leg.*`, `swao.llm.run.*` | `start`, `refused`, `pass.start`, `pass.complete`; `leg.start/.heartbeat/.stall/.error/.complete`; `run.start`, `run.complete` | Orchestrierung des LLM Assessment (Modellvergleich) und seiner Legs | `swao/src/commands/assess.ts`, `@swao/module-llm-assessment/src/orchestrator.ts` |
| `health-check.*` | `start`, `probe.start`, `probe.complete`, `lz-catalogue-provenance` | Prüfungen von `swao health-check` | `@swao/module-health-check/src/commands/health-check.ts` |
| `report.generate.*` | `start`, `ok`, `complete`, `error` | `swao report` | `swao/src/commands/report.ts` |
| `publish.*` | `start`, `ok`, `complete`, `error`, `editor.start/.stop`, `template.export` | HTML-Publikation | `@swao/module-html-report/src/` |
| `export.*` | `start`, `complete`, `error` | Power-BI-Export | `@swao/module-powerbi/src/export.ts` |
| `ingest.*` | `start`, `complete`, `error` | Kontext-Ingestion | `swao/src/commands/ingest.ts` |
| `credential.*` | `stored`, `deleted`, `store.error`, `export`, `import` | Credential Store (nur Namen, nie Werte) | `@swao/core/src/credential-store.ts`, `swao/src/commands/credential.ts` |
| `licence.*` | `load`, `activate`, `remove`, `expired`, `invalid`, `upgrade_request`, `*.error` | Lizenz-Lebenszyklus und Tier-Gates | `swao/src/commands/license.ts`, `swao/src/lib/license-gate-error.ts`, `swao/src/tui/screens/LicenseScreen.tsx` |
| `wizard.*`, `setup.*`, `wsp.setup.*`, `playwright.check.*` | `step.complete`, `llm.configured`, `credentials.llm.ping.ok/.fail`, `health-check.start/.complete/.empty`, `abort`, ... | Schritte des Setup-Assistenten | `swao/src/tui/screens/SetupWizard.tsx`, `swao/src/tui/screens/wizard/steps/` |
| `support.bundle.*` | `start`, `created` | `swao support-bundle` | `swao/src/commands/support-bundle.ts` |
| `swao.log.file-large` | warn | Eine Logdatei hat die Größengrenze überschritten | `@swao/core/src/log.ts` |

---

## 4. Logs auswerten

```bash
# All provider events of today's runs, newest last
grep '"code":"provider.llm.' wsp/logs/portfolio-events-2026-10.ndjson | tail -50

# Calls that waited for a concurrency slot
grep '"code":"provider.llm.[a-z-]*.attempt"' wsp/logs/portfolio-events-2026-10.ndjson | grep -v '"queued_ms":0'
```

`swao support-bundle` sammelt beide Log-Bereiche für einen Supportfall.
