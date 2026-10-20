# 1. Workspace Setup

<iframe
  width="100%"
  style="aspect-ratio: 16/9; border: none; border-radius: 8px;"
  src="https://www.youtube.com/embed/J-4LXaI3mqU"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen>
</iframe>

The **Workspace Setup** wizard runs when you select option 1 from the SWAO main menu. It initialises your engagement folder and writes a `.swao.yml` configuration file in one guided flow.

## What the wizard configures

| Step | What it does |
|---|---|
| Workspace | Engagement name, client code, owner, and directory; creates the engagement folder structure |
| LLM provider | Configures the AI provider: Anthropic, OpenAI, Amazon Bedrock Gateway, Ollama |
| Credentials | Stores API keys and vault references via `swao credential set` |
| LZ targets | Optional: pick landing zone catalogue providers, then per provider one or more geographies (for example `europe`, shown with its default region) or region ids. Writes `assessment.landing_zone.targets` to the workspace `.swao.yml`; every application run then fits these targets. Press `S` to skip |
| Health check | Runs the pre-flight probes once |
| Claude Desktop, Playwright | Optional integrations: MCP server configuration and the browser for dynamic analysis |

New workspaces contain four demo frameworks. Further community frameworks are copied into the workspace with
`swao framework install <ID>` and chosen per app when you run an assessment.

## CLI equivalent

```bash
swao init my-engagement --name app-crm-01
swao credential set anthropic-api-key <your-api-key>
swao framework install GDPR
swao regime-select --app app-crm-01 --regimes GDPR
# LZ targets: pass them per run, or set assessment.landing_zone.targets in .swao.yml
swao assess --app app-crm-01 --lz-cat-targets azure:europe,stackit:eu01
```

An app `.swao.yml` and `--lz-cat-targets` override the workspace targets. A geography resolves to its default region at run time; the application run records requested, resolved and skipped targets in `run-status.json`, and a skipped target marks the run as `partial`. The text report (`swao report`) lists them under **Landing Zone Catalogue Fit**.

## After setup

Run a [Health Check](/health-check) to verify that all pre-flight probes pass before starting an assessment.

See also: [How it works](/how-it-works#the-assessment-pipeline)
