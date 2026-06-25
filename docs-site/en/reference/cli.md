---
title: CLI Reference
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->

# CLI Reference

All SWAO commands follow the pattern `swao <command> [flags]`.

## Commands

### `swao doctor`

Verifies that the environment is correctly configured and all required dependencies are reachable.

| Flag | Description |
|------|-------------|
| `--json` | Emit results as JSON instead of the default table |

**Example:**

```bash
swao doctor
```

---

### `swao assess`

Runs a compliance assessment for a configured application.

| Flag | Description |
|------|-------------|
| `--app <name>` | Application identifier as defined in `.swao.yml` |
| `--framework <id>` | Override the framework declared in the config file |
| `--interactive` | Launch the TUI after the assessment completes |
| `--output <path>` | Write the report to a custom output path |
| `--quiet` | Suppress progress output; print only the final summary |

**Example:**

```bash
swao assess --app my-app --framework gdpr
```

---

### `swao report`

Generates or re-opens the HTML report for the most recent assessment.

| Flag | Description |
|------|-------------|
| `--open` | Open the report in the default browser after generation |
| `--output <path>` | Write the HTML file to a custom path |

**Example:**

```bash
swao report --open
```

---

### `swao framework list`

Lists all compliance frameworks available in the current installation.

| Flag | Description |
|------|-------------|
| `--json` | Emit the list as JSON |

**Example:**

```bash
swao framework list
```

---

### `swao mcp`

Starts the SWAO Model Context Protocol server, exposing SWAO tools to compatible AI clients.

| Flag | Description |
|------|-------------|
| `--http` | Listen on HTTP transport (default: `http://localhost:3737`) |
| `--port <n>` | Override the default port |

**Example:**

```bash
swao mcp --http --port 3737
```

---

## Global Flags

These flags are accepted by every command:

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help for the current command |
| `--version`, `-v` | Print the SWAO version and exit |
| `--config <path>` | Use a config file other than `.swao.yml` in the current directory |
