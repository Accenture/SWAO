---
title: MCP-Server
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->

# MCP-Server

SWAO stellt einen [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)-Server bereit,
der es KI-Clients wie Claude Code oder Cursor ermoglicht, die SWAO-Compliance-Engine direkt
aus einer Programmiersitzung heraus abzufragen.

> Diese Seite ist auf Englisch vollstandig verfugbar: [MCP Server](/en/reference/mcp)

## Server starten

```bash
swao mcp --http
```

Standardmassig lauscht der Server auf `http://localhost:3737`.

## Claude Code verbinden

Fuge folgendes in `~/.claude/settings.json` ein:

```json
{
  "mcpServers": {
    "swao": {
      "type": "http",
      "url": "http://localhost:3737"
    }
  }
}
```

Vollstandige Dokumentation auf Englisch: [MCP Server](/en/reference/mcp)
