# SWAO MCP Integration Guide for kilo.ai (On-Premise)

Design 107 documents the full BA integration story. This guide covers Phase 1:
connecting kilo.ai to the SWAO MCP server so BA developers can invoke assessment
tools without leaving the IDE.

## Prerequisites

- SWAO Enterprise binary installed and licensed
- kilo.ai on-premise installation (VS Code extension or desktop app)
- Network access to `localhost` from the kilo.ai IDE process

## Step 1: Start the SWAO MCP server

From a terminal in your workspace directory:

```
swao-enterprise-win-x64.exe mcp --http --port 3737
```

Keep the terminal open. The server listens on `http://localhost:3737/mcp` (MCP streamable-HTTP transport, JSON-RPC 2.0 over SSE).

## Step 2: Place `.kilorc` in your workspace root

Copy the `.kilorc` file from this directory into the root of your project workspace
(the directory kilo.ai opens as its workspace). The file declares the SWAO MCP server
as a context resource for kilo.ai.

If your on-premise kilo.ai installation uses a different workspace config path, consult
your kilo.ai administrator.

## Step 3: Verify connectivity

In the kilo.ai IDE, open the MCP server list. You should see "swao" listed with three
tools:

- `swao_health_check`
- `swao_assess`
- `swao_report`

If the tools do not appear, verify the MCP server is running and that the port in
`.kilorc` matches.

## Step 4: Configure the LLM backend (recommended)

For full data sovereignty, configure kilo.ai to use PREME DEV Qwen as its model
backend. The `.kilorc` file references the environment variables
`PREME_GENAI_HUB_BASE_URL` and `PREME_GENAI_HUB_API_KEY`. These should be set from
BA's internal credential store (the same keys SWAO uses for its PREME connector).

With this configuration, all AI inference for both coding assistance (kilo.ai) and
cloud assessment (SWAO) runs on PREME DEV within Accenture's EU sovereign zone. No
code, assessment context, or model responses cross to external LLM providers.

## Using SWAO tools from inside kilo.ai

Once connected, you can invoke SWAO tools directly from the kilo.ai chat interface:

```
Run swao_health_check to check workspace readiness
Run swao_assess for my sovereign-health application
Run swao_report for sovereign-health
```

SWAO findings appear as structured tool output inside the kilo.ai context window. You
can ask kilo.ai to generate code that satisfies the sovereignty constraints surfaced
by SWAO.

## Troubleshooting

**Tools not visible**: Ensure the MCP server is running (`swao mcp --http --port 3737`)
and that `.kilorc` is in the workspace root.

**Connection refused**: The MCP server binds to `localhost` only. Ensure the kilo.ai
process runs on the same machine.

**Assessment not starting**: Run `swao health-check` from the terminal to verify the
workspace is configured correctly before using MCP.

## Notes

- Phase 1 live test is tracked in #2969. MCP server connectivity via kilo.ai should
  be verified before the BA demo.
- SWAO MCP server is implemented as of v1.2.4. No new SWAO code is required for the
  core integration.
- Distribution: provide this directory (`swao/docs/integrations/kilo-ai/`) to BA via
  BA's internal developer tooling. No Kilo Marketplace submission is needed for
  on-premise installations.
- See Design 107 (`docs/design/107-kilo-ai-swao-integration.md`) for the full BA
  integration roadmap (Phases 2-4 tracked in #3020, #3021, #3022).
