=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Real LLM Smoke Tests

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Real-LLM smoke harness

Operator-run smoke that verifies the SWAO assess pipeline end-to-end against **real** LLM provider APIs (Anthropic + OpenAI). Closes the test-coverage gap that mocked unit tests cannot fill: API contract drift, key validity, model name mismatches, rate-limit retry behaviour against a live endpoint, and the run-manifest's `llm.provider` + `llm.model` recording.

**Not in CI.** This harness costs real API tokens on each run; CI's mocked driver tests in `src/providers/llm/{anthropic,openai}.test.ts` are the per-PR safety net.

## Cadence

Run **before every `v*` tag** AND **once per sprint close**. The Phase G `release-tag` step in `docs/design/026-sprint-process.md` §8.4 references this harness; the release.yml workflow does NOT trigger it (operator-only).

## Pre-flight

- `swao-enterprise-win.exe` (or `dist/bundle.cjs` via `node`) is built and version-aligned with `package.json`.
- API keys loaded into the credential store OR exported as env vars:
  ```bash
  swao credential set anthropic-api-key sk-ant-...
  swao credential set openai-api-key sk-...
  # or
  export SWAO_ANTHROPIC_API_KEY=sk-ant-...
  export SWAO_OPENAI_API_KEY=sk-...
  ```
- A workspace fixture: the bundled `examples/portfolio-workspace/portfolio/` works; `sovereign-health` is the canonical app.

## Run

From the `swao/packages/swao/` directory:

```bash
bash tests/real-llm-smoke/run-smoke.sh
```

The script loops `SWAO_LLM_PROVIDER` through `anthropic` and `openai`, runs `swao assess --app sovereign-health --passes inv,synth` against the example workspace, and asserts:

1. Exit code 0.
2. `wsp/runs/<latest>/run-manifest.json` has the right `llm.provider` recorded.
3. Pass 09 synthesis produces at least 1 signal (proves a real LLM call happened).
4. `llm.cost_usd` in the manifest is > 0 (proves the cost-table lookup hit the configured model).

Pass + fail summary written to stdout. Non-zero exit on any provider failure; first failure wins (script does not continue past a failed provider).

## Output

- `tests/real-llm-smoke/last-run/<provider>/run-manifest.json` -- per-provider copy of the manifest for post-hoc inspection.
- `tests/real-llm-smoke/last-run/summary.txt` -- one-line pass/fail per provider + total cost.

## What this does NOT cover

- The TUI / interactive screens (operator can verify those manually).
- The MCP server path (separate smoke under `docs/runbooks/mcp-claude-desktop.md`).
- The Playwright crawl (Pass 10) -- separate smoke per `npm run test:crawl`.
- The Ollama provider -- requires a local ollama server; out of scope here.

## Why not in CI

API tokens cost real money; running this on every push burns ~$0.01-$0.10 per run depending on the prompt complexity. The mocked unit tests catch wire-protocol regressions; the smoke catches contract drift on the API side (key revocation, model deprecation, pricing changes).

## #0322 Part C closure

This harness + the cadence policy below close `#0322 Part C` per the sprint-036 plan acceptance criteria. The cadence is also referenced from `docs/runbooks/RELEASE.md` Pre-flight gate #8.
