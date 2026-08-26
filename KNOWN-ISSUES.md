=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Known Issues -- v1.0.0

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# SWAO v1.0.0 -- Known Issues

This document lists confirmed limitations and open issues in the v1.0.0 release.
These are known, non-blocking items retained in the backlog. Workarounds are noted
where available.

For bugs found after release, please open an issue at
https://github.com/Accenture/SWAO/issues.

---

## LLM Assessment

### TUI hardcodes --no-crawl (LlmAssessmentScreen)

**Impact:** Low. LlmAssessmentScreen.tsx hard-codes the `--no-crawl` flag, so the
Playwright live-crawl path is not accessible from the TUI. It is accessible via the
CLI: `swao assess --llm <id> --passes dynamic`.

**Workaround:** Use the CLI for live-crawl LLM Assessment runs.

### OpenRouter vision relay not verified

**Impact:** Low. The `dynamic.vision.*` configuration path for OpenRouter has not been
end-to-end verified. The `openai` and `anthropic` protocol adapters are confirmed working.

**Workaround:** Use the `openai` or `anthropic` protocol for vision passes.

### Vision token estimation is char-based on zero-output providers

**Impact:** Low. When an LLM provider returns `tokens.completion = 0` for vision calls,
SWAO substitutes a character-count-based estimate. The estimate is approximate. Affected
call records include `estimated: true` on the token field.

---

## Publishing

### publication-model.json has no top-level vision key

**Impact:** Low. The publication model JSON does not expose a top-level `vision` summary
block. Raw vision call records are present in the leg NDJSON but not surfaced in the
structured publication model.

### signals.yaml not written by default

**Impact:** Low. The assessment run does not write a `signals.yaml` summary file.
Raw signal data is in the WSP NDJSON log. A future release will add the summary file.

---

---

## Docker

### Docker implementation not smoke-tested against live workloads

**Impact:** Low. The Docker images build and start correctly, but have not been tested
against a full assessment run with a real workspace volume. The binary-based distribution
is the primary supported path for v1.0.

---

## Support

Community support: https://github.com/Accenture/SWAO/discussions

Consultant and Enterprise licensees with an active M&E contract:
swao-tool@accenture.com
