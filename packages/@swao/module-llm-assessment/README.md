=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-llm-assessment -- LLM Assessment (multi-leg orchestrator)

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Consultant

Implements the LLM Sovereignty Assessment: orchestrates multi-leg AI analysis using Playwright live-crawl or static input, runs vision and reasoning passes, and produces a per-model sovereignty verdict. One of the three core assessment types in SWAO v1.0. Requires a Consultant or Enterprise licence and an active LLM connector.

## Install

```bash
pnpm add @swao/module-llm-assessment
```

## Key API

- `registerLlmAssessment(host) -- register LLM assessment command`
- `LlmLegOrchestrator -- multi-leg run coordinator`
- `LlmAssessmentResult -- per-leg verdict with evidence chain`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO