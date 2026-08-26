# 1. Workspace Setup

The **Workspace Setup** wizard runs when you select option 1 from the SWAO main menu. It initialises your engagement folder and writes a `.swao.yml` configuration file in one guided flow.

## What the wizard configures

| Step | What it does |
|---|---|
| Workspace name | Creates the engagement folder structure under your chosen root |
| Application name | Registers the workload to be assessed |
| Compliance frameworks | Selects active frameworks (GDPR pre-selected; 14 community frameworks available) |
| LLM provider | Configures the AI provider: Anthropic, OpenAI, Ollama, or deterministic stub |
| Credentials | Stores API keys and vault references via `swao credential set` |

## CLI equivalent

```bash
swao init --name my-engagement
swao credential set anthropic-api-key
swao framework install GDPR
```

## After setup

Run a [Health Check](/health-check) to verify all seven system checks pass before starting an assessment.

See also: [How it works](/how-it-works#the-assessment-pipeline)
