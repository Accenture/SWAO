---
title: Using SWAO from an AI client
status: accepted
purpose: How to connect SWAO to an AI client over MCP (Claude Code, Kilo, Claude Desktop, Cursor, VS Code), choose a tool profile, install the client entry and lean agent with one command, size SWAO for small local models, and avoid the known client pitfalls.
authors: [Accenture/SWAO]
related: [runbooks/mcp-integration.md]
last_updated: 2026-10-24
---

<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Using SWAO from an AI client
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# Using SWAO from an AI client

<Badge type="warning" text="Enterprise"/> The SWAO MCP server is part of the Enterprise edition.

This page is the short path: pick a transport and a profile, run one install command for your client,
verify, and start asking. The [MCP server runbook](./mcp-integration.md) has the full reference
(installation modes, every tool, manual configuration, troubleshooting).

## 1. stdio or HTTP

| Transport | Start | Use when |
|---|---|---|
| stdio (default) | the client starts `swao mcp` itself | Claude Desktop, Kilo, Cursor, VS Code on the same machine |
| HTTP | you start `swao mcp --http` and leave it running | Claude Code in a managed environment, containerised clients, several clients at once |

HTTP options:

- `--port <port>`: port, default `3737`. The client URL is `http://localhost:3737/mcp`.
- `--host <addr>`: bind address, default `localhost` (IPv4 and IPv6 loopback). A non-loopback address
  needs `--allow-remote`; the server has no authentication.
- `--replace`: stop the SWAO MCP server already running on the port and start in its place. It never stops
  a process that is not a SWAO MCP server. Without it, a busy port ends with exit code 1.
- `--workspace <path>`: pin the workspace (also `SWAO_WORKSPACE`). A pinned server hides the
  `workspace_path` tool parameter.

Clients that use HTTP do not start the server: start `swao mcp --http` first, then the client.

## 2. Profiles

Every MCP client sends the whole tool list with every model request, so the profile decides how much of
the model's context SWAO uses.

| Profile | Tools | Use for |
|---|---|---|
| `starter` | 5: overview, health check, workspace inventory, frameworks, passes | First contact, demos, local models with 8k to 16k context |
| `assess` | 14: `starter` plus assessment, report, signals, controls, risks, publish, landing zone explanation, costs | Single-app assessment on 16k to 32k local models |
| `full` | every tool | Hosted models, portfolio and service work |

Choose with `swao mcp --profile <name>` or an exact list with `swao mcp --tools <names>`. Without a flag the
server reads `SWAO_MCP_PROFILE` or `SWAO_MCP_TOOLS`, then the workspace `.swao.yml`:

```yaml
mcp:
  profile: starter        # starter | assess | full
```

then uses `full`. `swao mcp profiles` prints every profile with its tools and measured size. A tool outside
the profile is not listed, and a call to it returns an error that names the profile.

## 3. Install for your client

`swao mcp install --client <name>` writes the SWAO entry into the client's configuration and, for Kilo and
Claude Code, a lean agent file. It is safe to re-run:

- a file that is not valid JSON (including JSON with comments) is never rewritten: the command names the
  file and the error and exits with code 2;
- only the SWAO entry changes; other servers, keys and the file layout stay as they were;
- an existing entry named `swao` or `SWAO` is updated in place under its own name;
- the original is copied to `<file>.swao-backup-<timestamp>` before any write;
- a second identical run reports "no change";
- `--dry-run` prints the change as a diff and writes nothing;
- `--uninstall` removes exactly the SWAO entry (and the generated agent file), with a backup.

Options (`--profile` and `--workspace` are the `swao mcp` options and work here too):

| Option | Meaning |
|---|---|
| `--client <name>` | `claude-code`, `kilo`, `claude-desktop`, `cursor` or `vscode` |
| `--scope user` or `--scope project` | user configuration (default) or the configuration in the current folder |
| `--transport stdio` or `--transport http` | default `http` for Claude Code, `stdio` otherwise |
| `--url <url>` | with `--transport http`: server URL, default `http://localhost:3737/mcp` |
| `--agent`, `--no-agent` | write the lean agent file (default for Kilo and Claude Code) or not |
| `--profile <name>` | default `starter` with an agent, `full` without |
| `--workspace <path>` | workspace written into stdio entries (default: the workspace SWAO finds) |
| `--dry-run` | show the diff, write nothing |
| `--uninstall` | remove the SWAO entry and the generated agent file |

Without `--client`, `swao mcp install` keeps its old behaviour: it updates the Claude Desktop
configuration. The Setup Wizard MCP step offers the same choice (Claude Desktop, Claude Code, Kilo).

### 3.1 Claude Code

```bash
swao mcp install --client claude-code
swao mcp --http --profile starter
```

The first command runs `claude mcp add --transport http --scope user swao http://localhost:3737/mcp` when
the `claude` CLI is on the PATH (an existing `SWAO` entry is replaced under its own name), and writes
`~/.claude/agents/swao.md`. Without the `claude` CLI, or with `--scope project`, it writes the project
`.mcp.json` and `.claude/agents/swao.md` instead. The second command starts the server; keep it running.
In a managed environment Claude Code accepts only HTTP servers on `http://localhost` (ADR-0045); use
`--transport stdio` only on an unmanaged machine.

### 3.2 Kilo

```bash
swao mcp install --client kilo
```

Writes `~/.config/kilo/kilo.json` (project: `./kilo.json` or `.kilo/kilo.json`) with a local entry that
starts the absolute SWAO binary with `mcp --workspace <path> --profile starter`, and the agent file
`~/.config/kilo/agents/swao.md` (project: `.kilo/agents/swao.md`). For a containerised Kilo, use
`--transport http --url http://<gateway address>:3737/mcp` and run `swao mcp --http` on the host.

### 3.3 Claude Desktop

```bash
swao mcp install --client claude-desktop --profile starter
```

Updates the Claude Desktop configuration (both the Store and the direct installation when present) and
adds `--profile` only when you give it. Claude Desktop has no agent file.

### 3.4 Cursor

```bash
swao mcp install --client cursor --profile assess
```

Writes `~/.cursor/mcp.json` (project: `.cursor/mcp.json`). The profile limits the tools Cursor sees.

### 3.5 VS Code

```bash
swao mcp install --client vscode --scope project --profile assess
```

Writes `.vscode/mcp.json` in the current folder. Only `--scope project` is supported, and no chat mode or
agent file is written.

## 4. Verify

- Claude Code: `claude mcp list` shows `swao` (or `SWAO`) as connected while `swao mcp --http` runs.
- Kilo: `kilo mcp list` shows `swao`.
- Claude Desktop, Cursor, VS Code: restart the client and look for the SWAO tools in its tool or MCP view.
- Ask "show the swao welcome screen". The answer must show the SWAO build version.

## 5. Small local models

- Use `--profile starter` and the lean agent (the install default). Together they target fewer than 4,000
  prompt tokens per request (Design 116 section 8.3); a client's own default coding agent can cost 14,000
  to 15,000 tokens by itself (Design 116 F-12).
- Start with the `start` prompt: Claude Code `/mcp__swao__start`, Kilo `/swao:start`. It returns the SWAO
  main menu without a tool call.
- Ask exact questions that name one tool: "run the swao health check", "list the swao compliance
  frameworks". Avoid open questions that make a small model guess.
- Switch to `assess` for an assessment and to `full` with a hosted model.

## 6. Request log

`swao mcp` logs every request as one JSON line (method, tool name, duration, status; never the arguments
or results) to `<workspace>/wsp/logs/mcp-server.log`; when no workspace is found, to `wsp/logs/` next to
the SWAO binary. The log rotates at 10 MB and keeps five files.
`--log-file <path>` chooses another file (`-` writes to the error stream only) and `--log-level` sets
`error`, `warn`, `info` (default) or `debug`.

## 7. Client pitfalls

- **Kilo: a `tools` map hides MCP tools.** `tools: {"*": false, ...}` removes the SWAO tools from the
  request even when the permission view shows them as allowed. Restrict tools with `permission:` and
  `"*": deny` followed by one `allow` per tool, as the generated agent does.
- **Kilo permission rules are last-match-wins.** Put broad patterns first and specific ones after.
- **Kilo tool names** are `<server name>_<tool>`, for example `swao_swao_health_check`.
- **Kilo shows truncation only as "101%" context** in the sidebar; the visible symptom is SWAO answering
  the wrong question. Use a smaller profile.
- **Kilo skills cost a round trip and context.** Use the `start` prompt instead of a skill that holds the
  menu.
- **Containerised clients** cannot start the host binary over stdio. Use `--transport http` with a URL the
  container can reach (host networking, or the container gateway address with `--url`).
- **Claude Code in a managed environment** accepts only `http://localhost` servers and blocks stdio servers
  by name (ADR-0045). Start `swao mcp --http` before use; Claude Code does not start it.
