---
title: SWAO MCP Server Integration Runbook
status: accepted
purpose: Step-by-step guide to registering the SWAO MCP server in Claude Desktop and other MCP-compatible clients, so consultants can run assessments, generate reports, and run challenge sessions directly from an AI chat interface.
authors: [Accenture/SWAO]
related:
  - packages/swao/src/mcp/server.ts
  - packages/swao/src/commands/mcp.ts
last_updated: 2026-04-29
---

<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     MCP Integration
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# SWAO MCP Server Integration Runbook

## Abstract

SWAO exposes its assessment capabilities over the Model Context Protocol (MCP)
STDIO transport. Once registered, any MCP-compatible client (Claude Desktop,
Cursor, VS Code with an MCP extension, etc.) can invoke `swao_assess`,
`swao_report`, `swao_doctor`, and `swao_challenge` as native tools, and use
the `swao` entry point to show the workflow overview screen.

This runbook covers two installation modes (binary and source), per-platform
client configuration, verification, and troubleshooting.

---

## 1. Installation modes

There are two ways to run the SWAO MCP server. Choose based on whether you
have the repository cloned and Node.js installed, or only the distributed
binary files.

| Mode | What you have | Node.js required |
|---|---|---|
| **Binary** | `swao-enterprise-win.exe` / `swao-macos` / `swao-linux` from `dist-bin/` | No |
| **Source** | SWAO repository cloned, `dist/` built | Yes (20.x) |

Both modes start the server with the same `mcp` subcommand. The only
difference in the client configuration is the `command` field: the binary path
directly (binary mode) vs. `node` pointing at `dist/index.js` (source mode).

---

## 2. Binary mode: placing the files

The binary distribution ships three executables and a Windows batch launcher.
All files are found in `dist-bin/` of the SWAO repository, or delivered as a
release archive.

| File | Platform | Purpose |
|---|---|---|
| `swao-enterprise-win.exe` | Windows | Self-contained CLI and MCP server |
| `swao.bat` | Windows | Interactive menu launcher (terminal use only, not for MCP) |
| `swao-macos` | macOS | Self-contained CLI and MCP server |
| `swao-linux` | Linux | Self-contained CLI and MCP server |

### 2.1 Windows

1. Create a permanent folder for the binary, for example `C:\tools\swao\`.
   Avoid `Downloads` or any folder that may be cleared.
2. Copy `swao-enterprise-win.exe` (and optionally `swao.bat`) into that folder.
3. Optionally add `C:\tools\swao\` to your `PATH` so you can run `swao` from
   any terminal. This is not required for MCP.

Verify the binary works before registering it with any client:

```
C:\tools\swao\swao-enterprise-win.exe mcp --help
```

Expected first line:

```
Start the SWAO MCP server (stdio transport). ...
```

### 2.2 macOS

1. Copy `swao-macos` to a permanent location, for example `/usr/local/bin/swao`
   or `~/bin/swao`.
2. Mark it executable:

```bash
chmod +x /usr/local/bin/swao
```

3. Verify:

```bash
/usr/local/bin/swao mcp --help
```

### 2.3 Linux

Same steps as macOS. Recommended location: `/usr/local/bin/swao` or `~/bin/swao`.

---

## 3. Source mode: building the dist

Skip this section if you are using the binary.

### 3.1 Requirements

- Node.js 20.x (`node --version` to check)
- SWAO repository cloned

### 3.2 Build

```bash
cd packages/swao
npx tsc --project tsconfig.json
```

No output means the build is clean. The server entry point is at
`packages/swao/dist/index.js`.

### 3.3 Verify

```bash
node packages/swao/dist/index.js mcp --help
```

Expected first line:

```
Start the SWAO MCP server (stdio transport). ...
```

---

## 4. How the MCP server works

The client launches the SWAO process as a subprocess over standard I/O. The
client and server exchange a JSON-RPC handshake, after which the client may
call tools on demand. The server process stays alive for the duration of the
client session.

The server exposes five tools:

| Tool | Purpose |
|---|---|
| `swao` | Welcome screen: workflow overview, tool list, quick-start guide. Use this as the entry point. |
| `swao_assess` | Run a sovereignty assessment for one application (source scan, SBOM, egress, TF, crypto, LZR). |
| `swao_report` | Generate a report from an existing assessment. Supports role views: exec, compliance, finops, migration-manager, lzr. |
| `swao_doctor` | Health check: LLM connectivity, credential store, workspace layout, Playwright availability, licence status. |
| `swao_challenge` | Run a stakeholder challenge session against a WSP. Five agent perspectives available. |

The `swao_assess` and `swao_report` tools require two key parameters:

- `app_id`: the application folder name under `portfolio/apps/`
- `workspace_path`: absolute path to the portfolio root that contains `.swao.yml`

---

## 5. Client configuration

Each section below shows both the binary and source variants. Use whichever
matches your installation mode.

### 5.1 Claude Desktop, Windows (Store installation)

Config file path:

```
%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json
```

**Binary variant** (replace path with wherever you placed `swao-enterprise-win.exe`):

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "C:\\tools\\swao\\swao-enterprise-win.exe",
      "args": ["mcp"]
    }
  }
}
```

**Source variant** (replace `<repo-root>` with the absolute path to the cloned
repository, e.g. `C:\Projects\accenture\swao`):

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "<repo-root>\\packages\\swao\\dist\\index.js",
        "mcp"
      ]
    }
  }
}
```

If the config already contains a `preferences` block, add `mcpServers` as a
sibling key:

```json
{
  "preferences": { ... },
  "mcpServers": {
    "SWAO": { ... }
  }
}
```

Quit Claude Desktop fully via the system tray icon (Quit, not just close the
window) and reopen it.

### 5.2 Claude Desktop, Windows (direct .exe installation)

Config file path:

```
%APPDATA%\Claude\claude_desktop_config.json
```

The JSON block is identical to Section 5.1. The only difference is the file
location.

### 5.3 Claude Desktop, macOS

Config file path:

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Binary variant:**

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "/usr/local/bin/swao",
      "args": ["mcp"]
    }
  }
}
```

**Source variant** (find the correct Node path with `which node`; common
locations: `/usr/local/bin/node` for Homebrew Intel,
`/opt/homebrew/bin/node` for Apple Silicon, `~/.nvm/versions/node/<v>/bin/node`
for nvm):

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "/usr/local/bin/node",
      "args": [
        "/path/to/swao/packages/swao/dist/index.js",
        "mcp"
      ]
    }
  }
}
```

Use the full absolute path to `node`. The app's PATH differs from the shell's.

### 5.4 Cursor

Cursor reads MCP configuration from `.cursor/mcp.json` in the project root
or from `~/.cursor/mcp.json` globally.

**Binary variant:**

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "/usr/local/bin/swao",
      "args": ["mcp"]
    }
  }
}
```

**Source variant:**

```json
{
  "mcpServers": {
    "SWAO": {
      "command": "node",
      "args": [
        "/path/to/swao/packages/swao/dist/index.js",
        "mcp"
      ]
    }
  }
}
```

Reload the Cursor window after saving.

### 5.5 VS Code with an MCP extension

Place the configuration in `.vscode/mcp.json` in the workspace root or in the
global user settings under `mcp.servers`, depending on the extension. The
command and args format is identical to the examples above.

### 5.6 Other MCP-compatible clients

Any client that supports STDIO transport can run SWAO. The invariant is:

- **Binary mode:** `command` is the absolute path to `swao-enterprise-win.exe` / `swao-macos` / `swao-linux`; `args` is `["mcp"]`
- **Source mode:** `command` is the absolute path to `node`; `args` is `["<absolute-path>/dist/index.js", "mcp"]`
- **Transport:** stdio (not SSE or HTTP)

The server name key (`"SWAO"`) is a display label only; choose whatever
appears clearly in the client UI.

---

## 6. Verification

After restarting the client:

1. Open a new conversation.
2. Type: `swao`
3. The client calls the `swao` tool and returns the SWAO workflow overview
   screen with the tool list and quick-start guide.

If the welcome screen appears, the server is connected and all tools are
available. To verify assessment tools specifically, ask:

```
Run swao_doctor
```

Expected: a health report listing LLM, credential, workspace, and licence
probes with pass/fail status for each.

---

## 7. Troubleshooting

### 7.1 Tools do not appear after restart

Check the MCP server log. On Windows Store installation:

```
%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\logs\mcp-server-SWAO.log
```

On macOS:

```
~/Library/Logs/Claude/mcp-server-SWAO.log
```

A successful startup ends with:

```
Server started and connected successfully
```

followed by a `tools/list` exchange that lists all five tools.

### 7.2 "command not found" or spawn error

**Binary mode:** confirm the path to `swao-enterprise-win.exe` / `swao-macos` is correct
and the file exists. Run it directly in a terminal first (Section 2).

**Source mode:** use the full absolute path to `node`. Bare `node` in the
command field only works if the client inherits a PATH that contains it, which
is not guaranteed on any platform. Find the path with `where node` (Windows)
or `which node` (macOS/Linux).

### 7.3 Binary exits immediately with no error

This can happen if the binary is in `Downloads` or another folder with
restricted execution policy. Move it to a permanent location (e.g.
`C:\tools\swao\`) and try again. On macOS, you may need to clear the
quarantine flag: `xattr -d com.apple.quarantine /usr/local/bin/swao`.

### 7.4 Build errors or missing dist/index.js (source mode only)

Rebuild from `packages/swao/`:

```bash
npx tsc --project tsconfig.json
```

Fix any TypeScript errors before retrying.

### 7.5 Server starts but tools time out

The SWAO CLI spawns subprocesses for each tool call. If `swao_assess` or
`swao_report` time out, the most common cause is a missing or unreachable LLM
provider. Run `swao_doctor` first to check connectivity, then set credentials
via `swao credential set` in a terminal.

### 7.6 JSON parse error in config file

The config file must be valid JSON. Common mistakes: trailing commas, single
quotes, missing comma between an existing block and the new `mcpServers` block.
Validate with any JSON linter, or with:

```
node -e "JSON.parse(require('fs').readFileSync('<path-to-config>', 'utf8'))"
```

No output means the file is valid.

---

## 8. Rebuilding after source changes (source mode only)

Any change to `packages/swao/src/mcp/server.ts` or files it imports requires
a rebuild:

```bash
cd packages/swao
npx tsc --project tsconfig.json
```

After rebuilding, fully restart the client. MCP servers are launched once at
client startup; they are not reloaded on reconnect.
