=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-llm-providers -- LLM provider drivers

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Community (driver library); LLM API keys required for use

LLM provider driver implementations for OpenAI, Anthropic, Ollama, and custom REST APIs. Used by module-llm-assessment for LLM-powered analysis passes. The driver library itself is Community; using it requires an active LLM API subscription.

## Install

```bash
pnpm add @swao/module-llm-providers
```

## Key API

- `openaiDriver(config) -- OpenAI / Azure OpenAI driver`
- `anthropicDriver(config) -- Anthropic Claude driver`
- `ollamaDriver(config) -- local Ollama driver`
- `customDriver(config) -- custom REST adapter`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO