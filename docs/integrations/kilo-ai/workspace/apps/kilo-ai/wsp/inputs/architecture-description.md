# kilo.ai Architecture Description

## Deployment model

Self-hosted, on-premise deployment. No kilo.ai cloud services are used. The kilo.ai
application runs on a server within the partner data centre.

## Components

- **kilo.ai server**: Electron/Node.js application, served locally on port 3000 (default).
- **MCP server**: Exposes SWAO tools to kilo.ai via the Model Context Protocol on port 3737.
- **PREME DEV Qwen backend**: Remote API endpoint for LLM inference. All inference requests
  are routed to this endpoint. No data is sent to kilo.ai cloud infrastructure.

## Data flows

1. Developer query --> kilo.ai client --> kilo.ai server (local)
2. kilo.ai server --> PREME DEV Qwen API (HTTPS, external) -- inference only; no code sent unless explicitly included in prompt
3. kilo.ai server --> MCP server (localhost:3737) -- SWAO tool invocations
4. MCP server --> SWAO CLI -- assessment execution, results returned to kilo.ai

## EU AI Act classification

kilo.ai is an AI system under Art. 3(1) EU AI Act. It is used as a general-purpose
coding assistant and does not fall within Annex III high-risk categories. Preliminary
classification: LIMITED RISK (Art. 50 transparency obligations apply).

## Data residency

- Code context sent to PREME DEV Qwen: governed by PREME DEV data processing agreement.
- No persistent storage of prompts or completions outside the partner environment.
- kilo.ai server logs stored locally on-premise.

## Supply chain

Dependency inventory: see package.json in this directory.
SBOM: obtain from kilo.ai release artefacts at https://github.com/kilocode-ai/kilocode/releases
(replace with actual SBOM path when available; add sbom.cdx.json to this directory).
