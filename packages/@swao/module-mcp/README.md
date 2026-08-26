=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-mcp -- MCP (Model Context Protocol) server

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Community

Implements the SWAO MCP server exposing assessment capabilities as MCP tools for AI assistants (Claude Code, Claude Desktop). Supports HTTP transport (localhost:3737) and stdio transport. Documented in ADR-0045.

## Install

```bash
pnpm add @swao/module-mcp
```

## Key API

- `registerMcp(host) -- register swao mcp command`
- `startMcpServer(opts) -- start HTTP or stdio MCP server`
- `mcpTools -- tool definitions (swao_assess, swao_report, swao_health_check)`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO