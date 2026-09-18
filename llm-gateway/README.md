```
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     LLM Gateway Configurations
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://accenture.github.io/SWAO/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
```

# SWAO LLM Gateway Configurations

Pre-built gateway configuration files for connecting SWAO to LLM providers.

Each YAML file defines how SWAO communicates with a specific LLM provider or
gateway, including endpoint, model selection, and any sovereign-specific settings.

## Download

Browse and download configurations from GitHub:
**https://github.com/Accenture/SWAO/tree/main/llm-gateway**

## Available configurations

| File | Provider |
|---|---|
| `anthropic.yaml` | Anthropic Claude (API) |
| `bedrock.yaml` | Amazon Bedrock Gateway |
| `ollama.yaml` | Ollama (self-hosted, local models) |
| `openai.yaml` | OpenAI (API) |
| `openrouter.yaml` | OpenRouter (multi-provider proxy) |
| `vllm-generic.yaml` | vLLM (self-hosted, generic endpoint) |
| `_template.yaml` | Template for custom gateway configurations |

## Usage

Copy the relevant YAML file into your workspace and reference it in your
`.swao.yml` configuration under the `llm.gateway` key. For example:

```yaml
llm:
  gateway: ./llm-gateway/anthropic.yaml
```

See the [LLM Assessment documentation](/llm-assessment) for full configuration options.

## Licence

Apache-2.0. See [LICENSE](../LICENSE).
