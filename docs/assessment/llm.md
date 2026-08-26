=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    LLM Assessment

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# LLM Assessment

LLM Assessment benchmarks multiple AI provider connectors side by side against the
same sovereignty criteria that govern the assessed application. Where an Application
Assessment evaluates a workload's source code, LLM Assessment evaluates the AI
providers that workload might use -- their data residency posture, transparency,
safety characteristics, and sovereignty fit.

---

## What LLM Assessment adds

An Application Assessment produces compliance signals derived from source code and
operational context. LLM Assessment adds a second layer: it subjects each configured
AI provider connector to the same compliance controls, using the application's full
evidence set as context. The result is a ranked comparison of providers against the
active frameworks.

LLM Assessment requires a completed Application Assessment for the same app.

---

## How it works

LLM Assessment orchestrates parallel or serial "legs". Each leg is one LLM connector
(for example, Anthropic Claude via the `anthropic` connector, or Mistral via `openrouter`).
Every leg runs the same set of sovereignty passes against the same workload context and
produces an independent result. SWAO aggregates the results, ranks the legs by sovereignty
score, and writes the combined output to a WSP payload.

### Vision pass

When Playwright is available, SWAO captures screenshots of the running application during
the dynamic analysis pass of the parent Application Assessment. These screenshots are
sent to the LLM configured for each leg using a multimodal (vision) prompt. The vision
pass evaluates the UI for data-handling disclosures, consent UI completeness, and
jurisdiction markers visible to end users.

The vision pass is included automatically when:

- The parent Application Assessment ran with Playwright enabled (no `--no-crawl`).
- The connector for the leg supports multimodal input (images in the prompt).

Connectors without multimodal support skip the vision pass and note the omission in the
leg result.

---

## Configuration

LLM Assessment is configured in the portfolio-level `.swao.yml` under the `llm_assessment`
block.

### Minimum configuration (two legs)

```yaml
llm_assessment:
  legs:
    - connector: anthropic
      model: claude-sonnet-4-6
      primary: true
    - connector: openai
      model: gpt-4o
```

- `connector` -- the LLM-Gateway connector ID (must match a connector in `wsp/inputs/llm-gateway/` or the bundled seeds).
- `model` -- the model to use for this leg. Omit to use the connector's default model.
- `primary: true` -- marks the primary leg for tiebreaking and report emphasis (first leg is primary by default).

### Execution mode

```yaml
llm_assessment:
  execution: serial   # or 'parallel' (default: serial)
  repeat: 1           # number of repetitions per leg (default: 1)
  legs:
    - connector: anthropic
      model: claude-sonnet-4-6
      primary: true
    - connector: openrouter
      model: deepseek/deepseek-v4-flash
    - connector: ollama
      model: llama3.3
```

- `execution: serial` -- legs run one after another (safer for rate-limited providers).
- `execution: parallel` -- legs run concurrently (faster; requires sufficient API quota).
- `repeat` -- run each leg multiple times and average results (useful for non-deterministic models).

SWAO accepts 2 to 5 legs per LLM Assessment run.

---

## Connector reference

SWAO ships five bundled connector seeds. Drop a YAML file into
`wsp/inputs/llm-gateway/` to add a custom connector.

| Connector ID | Protocol | Provider | Data residency | Vision support |
|---|---|---|---|---|
| `anthropic` | `anthropic-messages` | Anthropic (api.anthropic.com) | US/EU (account-dependent) | Yes (Claude 3 and later models) |
| `openai` | `openai-chat` | OpenAI (api.openai.com) | US (global endpoints) | Yes (gpt-4o and gpt-5 family) |
| `openrouter` | `openai-chat` | OpenRouter aggregator | Global routing | Depends on model |
| `ollama` | `ollama` | Local Ollama daemon | Local (zero egress) | Depends on model |
| `vllm-generic` | `openai-chat` | Self-hosted vLLM | Local or on-premise | Depends on model |

Each connector seed is a YAML file at `swao/llm-gateway/<id>.yaml` (bundled) or
`wsp/inputs/llm-gateway/<id>.yaml` (workspace-level). The schema is:

```yaml
schema_version: "1.0"
connector:
  id: my-connector
  name: My LLM Provider
  protocol: openai-chat          # anthropic-messages | openai-chat | ollama
  base_url: https://llm.example.internal/v1
  auth:
    credential_key: my-api-key   # key name in swao credential store
    env_var: MY_API_KEY          # fallback environment variable
  models:
    default: my-model-id
  defaults:
    temperature: 0
    max_tokens: 32768
  sovereignty:
    data_residency: EU (on-premise)
    zero_retention: true
    notes: Fully local inference.
```

Store the API key in the SWAO credential store:

```bash
swao credential set my-api-key
```

---

## Running LLM Assessment

### Prerequisites

1. A completed Application Assessment for the target app.
2. At least two connectors configured (bundled seeds or workspace YAML files).
3. The `llm_assessment` block present in the portfolio-level `.swao.yml`.

### Command

```bash
swao assess --type llm --app my-app
```

To override the LLM-Gateway connector for the primary leg only:

```bash
swao assess --type llm --app my-app --llm anthropic:claude-opus-4-7
```

To run only static passes inside each leg (skip vision and Playwright):

```bash
swao assess --type llm --app my-app --no-crawl
```

---

## Output artefacts

LLM Assessment writes to:

```
wsp/
+-- llm-assessment/<timestamp>/
|   +-- legs/
|   |   +-- <connector>--<model>/
|   |   |   +-- pass-groups.json    per-pass challenge results for this leg
|   |   |   +-- score.json         sovereignty score and rank
|   +-- aggregate.json             cross-leg comparison and ranking
|   +-- wsp.json                   WSP payload (schema: llm-assessment/1.1)
+-- llm-assessment/latest.txt      pointer to the most recent run timestamp
```

The WSP payload (`wsp.json`) carries:

- `wsp_version: "llm-assessment/1.1"` -- schema identifier
- `legs` -- array of leg results, each with `connector`, `model`, `score`, `rank`, and `pass_groups`
- `aggregate` -- ranked summary across all legs
- `primary_leg` -- the leg marked `primary: true` in configuration
- `assessed_at` -- ISO 8601 timestamp
- `findings_count` -- total number of findings across all legs

### Publishing the results

```bash
swao publish --app my-app
```

The HTML publication includes an "LLM Assessment" tab when LLM Assessment output is
present. The tab shows the per-leg score, a side-by-side comparison table, and a
sovereignty ranking.

---

## Sovereignty note

LLM Assessment results reflect the declared sovereignty posture of each provider at
the time of assessment. The connector YAML files carry a `sovereignty` block with
`data_residency`, `zero_retention`, and free-text notes. These are inputs to the
compliance evaluation, not a substitute for reviewing the provider's Data Processing
Addendum and applicable terms.

---

## Further reading

- [LLM provider swap](/runbooks/llm-provider-swap) -- change connectors and test connectivity
- [Application Assessment](./application) -- required before running LLM Assessment
- [Licence management](/runbooks/licence-management) -- LLM Assessment is available in all tiers
