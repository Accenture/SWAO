<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     LLM Provider Swap
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->
# Runbook: LLM Provider Swap (Anthropic <-> Ollama)

**Applies to:** SWAO v0.0.1+  
**SPEC criterion:** SC-24 -- at least one LLM provider switch demonstrated end-to-end  
**Related issues:** #0117 (OllamaLlmProvider), #0118 (credential store), #0126 (this runbook)

---

## Overview

SWAO routes all LLM calls through a single factory function (`createLlmProvider()` in
`src/providers/llm/factory.ts`). The active provider is selected by the `SWAO_LLM_PROVIDER`
environment variable. Swapping providers requires no code changes -- only a variable change
and credential setup.

Supported providers:

| Value | Provider | Requires |
|---|---|---|
| `anthropic` | Anthropic Claude API | `SWAO_CREDENTIAL_ANTHROPIC_API_KEY` |
| `openai` | OpenAI API | `SWAO_CREDENTIAL_OPENAI_API_KEY` |
| `ollama` | Local Ollama instance | Ollama running on `localhost:11434` |
| `open-llm-provider` | Any OpenAI-compatible endpoint (vLLM, LiteLLM, etc.) | `baseUrl` + `model` in `.swao.yml`; token in credential store `open-llm-api-key-{env}` |

> **No `stub` provider.** The `StubLlmProvider` was removed in #0473 (and the
> orphaned class fully deleted in #0601). There is no default provider: an unset
> `SWAO_LLM_PROVIDER` and no `.swao.yml` provider block is an error. For offline /
> CI runs use cassette replay (`LlmCacheLayer` with committed fixture cassettes) or
> `FixedLlmProvider` in tests, not a stub provider.

---

## Factory routing

`createLlmProvider()` reads `process.env['SWAO_LLM_PROVIDER']` at call time:

```
SWAO_LLM_PROVIDER=anthropic          -->  AnthropicLlmProvider
SWAO_LLM_PROVIDER=openai             -->  OpenAiLlmProvider
SWAO_LLM_PROVIDER=ollama             -->  OllamaLlmProvider
SWAO_LLM_PROVIDER=open-llm-provider  -->  OpenLlmProvider (requires baseUrl in .swao.yml)
SWAO_LLM_PROVIDER=stub               -->  throws (stub removed, #0473)
(unset, no config)                    -->  throws (no provider configured)
```

For deterministic offline runs, seed cassettes and replay them through
`LlmCacheLayer`; the bundled pass fixtures under
`src/passes/fixtures/llm-stubs/<app_id>/` are consumed by the test suite, not by a
runtime stub provider.

---

## Provider setup

### Anthropic

1. Obtain an Anthropic API key from `console.anthropic.com`.
2. Store it with the credential store:

```bash
swao credential set anthropic-api-key <your-key>
```

3. Confirm it is stored:

```bash
swao credential get anthropic-api-key
```

4. Set the provider:

```bash
export SWAO_LLM_PROVIDER=anthropic
```

5. Verify:

```bash
swao assess --app sovereign-health --passes synth
```

### Ollama

1. Install Ollama from `ollama.com`.
2. Pull a supported model:

```bash
ollama pull llama3.2
```

3. Confirm the model is available:

```bash
ollama list
```

4. Start the Ollama server (if not already running as a service):

```bash
ollama serve
```

5. Confirm it is reachable:

```bash
curl http://localhost:11434/api/tags
```

6. Set the provider:

```bash
export SWAO_LLM_PROVIDER=ollama
```

7. Verify:

```bash
swao assess --app sovereign-health --passes synth
```

### Open LLM Provider (Design 082 §4)

For any OpenAI-compatible endpoint (vLLM, LiteLLM, enterprise AI platforms).

1. Add the provider block to `.swao.yml` (no token in the file):

```yaml
providers:
  llm:
    primary:
      type: open-llm-provider
      baseUrl: https://your-llm.example.com
      model: YourModel-Name
      temperature: 0
```

2. Store the Bearer token in the credential store:

```bash
# Key name: open-llm-api-key-{env} where env = SWAO_LLM_ENV | prod
swao credential set open-llm-api-key-prod <your-bearer-token>
```

3. Verify:

```bash
swao assess --app sovereign-health --passes synth
```

**Multi-environment config** (dev/preprod/prod in one file):

```yaml
providers:
  llm:
    activeEnv: dev
    environments:
      dev:
        type: open-llm-provider
        baseUrl: https://dev.your-llm.example.com
        model: DevModel
      prod:
        type: open-llm-provider
        baseUrl: https://your-llm.example.com
        model: ProdModel
```

Switch active environment at run time:

```bash
SWAO_LLM_ENV=prod swao assess --app sovereign-health
```

---

## Swap procedure: Anthropic -> Ollama

```bash
# 1. Stop any in-progress assessment
# 2. Switch provider
export SWAO_LLM_PROVIDER=ollama

# 3. Confirm Ollama is running
curl -s http://localhost:11434/api/tags | node -e "process.stdin.resume(); process.stdin.on('data', d => console.log('Ollama OK:', JSON.parse(d).models.length, 'model(s)'))"

# 4. Run a single-pass assessment to confirm routing
swao assess --app sovereign-health --passes synth

# 5. Check providers_used field in the WSP artefact
cat apps/sovereign-health/artifacts/providers-used.yaml
```

## Swap procedure: Ollama -> Anthropic

```bash
# 1. Confirm credential is present
swao credential get anthropic-api-key

# 2. Switch provider
export SWAO_LLM_PROVIDER=anthropic

# 3. Run a single-pass assessment
swao assess --app sovereign-health --passes synth

# 4. Check providers_used field
cat apps/sovereign-health/artifacts/providers-used.yaml
```

---

## WSP providers_used field

Every assessment writes `artifacts/providers-used.yaml` in the app directory.
This records which LLM provider was active during each pass:

```yaml
# apps/<app_id>/artifacts/providers-used.yaml
assessment_id: iter-01-...
passes:
  - pass: data_classification
    provider: anthropic
    model: claude-opus-4-7
  - pass: seven_r_synthesis
    provider: anthropic
    model: claude-opus-4-7
```

This field is machine-readable and is used by meshStack outputs (`wsp_url` artefact).

---

## Automated validation

Run `scripts/validate-llm-swap.sh` to check all configured providers:

```bash
bash scripts/validate-llm-swap.sh
```

- Validates Anthropic only if `SWAO_CREDENTIAL_ANTHROPIC_API_KEY` is set.
- Validates Ollama only if `localhost:11434` is reachable.
- Exits 0 if all configured providers pass; exits 1 on any failure.

> Note: `scripts/validate-llm-swap.sh`, `scripts/demo.sh`, and `scripts/demo-docker.sh`
> still pass a `--llm-stub` flag that the current `swao assess` no longer defines (the
> stub was removed in #0473). Those scripts need refreshing to use cassette replay; tracked
> separately, not part of #0601.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `credential not found: anthropic-api-key` | Key not stored | `swao credential set anthropic-api-key <key>` |
| `connect ECONNREFUSED 127.0.0.1:11434` | Ollama not running | `ollama serve` |
| `model not found` | Model not pulled | `ollama pull llama3.2` |
| `401 Unauthorized` | Invalid Anthropic key | Re-run `swao credential set` with correct key |
| `429 Too Many Requests` | Anthropic rate limit | Wait or switch to Ollama for development |
| `No LLM provider configured` | `SWAO_LLM_PROVIDER` not exported and no `.swao.yml` provider block | `export SWAO_LLM_PROVIDER=anthropic` (not just `set`), or set `providers.llm.primary.type` |
| `Unknown LLM provider 'stub'` | Stale config/script using the removed stub | Use `anthropic`/`openai`/`ollama`, or cassette replay for offline runs (#0473) |
