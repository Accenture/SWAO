=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Runbook: LLM Gateway Connector Authoring

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Runbook: Authoring an LLM-Gateway connector

Design 090 makes SWAO's LLM connectivity file-based: one YAML connector per
platform. This runbook shows how to connect any LLM platform to SWAO without
a code change or rebuild.

## 1. The three-step flow

1. Copy `wsp/inputs/llm-gateway/_template.yaml` (created by `swao init` /
   setup) or any bundled connector to `wsp/inputs/llm-gateway/<your-id>.yaml`.
2. Amend `id`, `name`, `protocol`, `base_url`, `auth`, and `models.default`.
3. Re-run `swao setup` (or use `swao assess --llm <your-id>` directly). The
   connector is discovered automatically; `swao health-check` probe 14 confirms it
   validated.

## 2. Choosing the protocol

| Your platform speaks | protocol value |
|---|---|
| OpenAI Chat Completions (`/v1/chat/completions`) -- vLLM, internal GenAI hubs, OpenRouter, LLMGateway, most aggregators | `openai-chat` |
| Anthropic Messages (`/v1/messages`) | `anthropic-messages` |
| Local Ollama daemon | `ollama` |

## 3. Worked example: internal GenAI hub

A company hub exposing several models behind one OpenAI-compatible endpoint
with per-environment URLs:

```yaml
schema_version: "1.0"
connector:
  id: genai-hub
  name: Internal GenAI Hub
  protocol: openai-chat
  base_url: https://genai-hub.example.internal
  auth:
    credential_key: genai-hub-api-key       # stored via `swao credential`
    env_var: SWAO_GENAI_HUB_API_KEY         # fallback
  models:
    default: Mistral-Small-24B-Instruct
    catalogue:
      - id: Mistral-Small-24B-Instruct
      - id: Llama-3.3-70B-Instruct
  environments:
    prod: {}
    dev:
      base_url: https://genai-hub-dev.example.internal
  defaults:
    temperature: 0
  cost_per_token: { input_per_million: 0, output_per_million: 0 }
  sovereignty:
    data_residency: self-hosted
    zero_retention: true
```

Select the environment with `SWAO_LLM_ENV=dev` or `env:` in `.swao.yml`.

## 4. Aggregators (one key, many vendors)

OpenRouter, a self-hosted LLMGateway, or any multi-vendor gateway is just a
connector whose catalogue spans vendors. The bundled `openrouter` seed shows
the pattern, including:

- `models.discovery_endpoint: /v1/models` -- SWAO can refresh the model
  list AND capture per-model prices from the platform; refreshes are
  written to your workspace copy, bundled seeds are never modified.
- `headers:` for static attribution or routing headers.
- `request_overrides:` for vendor extensions such as
  `reasoning: {enabled: true}` (reserved keys model/messages/stream are
  protected).

## 5. Selecting a connector

- `.swao.yml`: `providers.llm.primary: { connector: genai-hub, model: Llama-3.3-70B-Instruct }`
- CLI: `swao assess --app <app> --llm genai-hub:Llama-3.3-70B-Instruct`
- Env: `SWAO_LLM_CONNECTOR=genai-hub`

Every run records the connector id, file hash, and model in
`run-manifest.json` (`llm.gateway`) for provenance.

## 6. Rules and safety

- NEVER put key material in a connector file. `auth` names WHERE the key
  lives; SWAO refuses files containing secret-shaped values.
- Legacy `type: anthropic|openai|ollama|open-llm-provider` configurations
  keep working unchanged; migration is opt-in.
- Sovereignty facts in the connector are facts, not verdicts -- they feed
  the provider eligibility checks of the LLM benchmark (Design 063).
