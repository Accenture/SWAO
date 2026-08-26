# 9. Tools

The Tools menu (option 9 in the main menu) groups utility commands that manage your SWAO installation, workspace, and credentials.

## Available tools

| Tool | CLI command | Description |
|---|---|---|
| Lenses | `swao lens list` / `swao lens apply` | Switch between pre-configured analysis lenses (security-focused, data-governance, cloud-migration) |
| Licence | `swao licence show` / `swao licence activate` | Display current edition and activate a licence key |
| Credentials | `swao credential set` / `swao credential list` | Store and manage API keys and vault references |
| Framework install | `swao framework install <name>` | Install additional community frameworks |
| Catalogue update | `swao catalogue update` | Pull the latest LZ provider catalogue and framework updates |
| Help | `swao --help` / `swao <command> --help` | Full CLI reference |

## Lenses

Lenses are pre-configured sets of enabled analysis passes, signal weights, and framework filters. Three community lenses ship with every edition:

| Lens | Focus |
|---|---|
| `cloud-migration` | 7R migration verdict, dependency mapping, wave planning |
| `security-focus` | Security posture, secrets detection, cryptography, SAST |
| `data-governance` | PII classification, data residency, egress analysis, GDPR controls |

Apply a lens before running an assessment:

```bash
swao lens apply security-focus
swao assess --app my-app
```

See also: [Workspace Setup](/workspace-setup) | [CLI reference](/runbooks/cli-reference)
