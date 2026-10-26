# 9. Tools

The Tools menu (option 9 in the main menu) groups utility commands that manage your SWAO installation, workspace, and credentials.

## Available tools

| Tool | CLI command | Description |
|---|---|---|
| Lenses | `swao lenses list` / `swao lenses set <ids>` | Switch between preconfigured analysis lenses (pass selection profiles) |
| Licence | `swao license status` / `swao license activate <key>` | Display current edition and activate a licence key |
| Credentials | `swao credential set` / `swao credential list` | Store and manage API keys and vault references |
| Framework | `swao framework list` / `swao framework install <id>` | Copy additional bundled community frameworks into the workspace (`wsp/inputs/catalogs/community/<folder>/`); or [download from GitHub](https://github.com/Accenture/SWAO/tree/main/community-frameworks) and copy the folder there |
| Catalogue update | `swao lz catalogue update` | Refresh the LZ provider service catalogues from the providers' public sources, and the VM prices of the service cost model from the Azure and AWS price APIs (Consultant and above) |
| LLM gateway update | `swao llm-gateway update` | Refresh the workspace LLM gateway connectors (`wsp/inputs/llm-gateway/`, the single source) from the packaged seeds: unchanged seeds are updated, connectors you edited are kept, new connectors are added. Run after upgrading the binary. `--dry-run` previews the changes |
| SWAO Chat | `swao chat` | Multi-turn LLM conversation about portfolio assessment results (Enterprise) |
| Help | `swao --help` / `swao <command> --help` | Full CLI reference |

## Lenses

Lenses are preconfigured pass selection profiles; some also activate matching frameworks. Three lenses ship with SWAO (`swao lenses list`):

| Lens | Passes | Frameworks activated automatically |
|---|---|---|
| `cloud-migration` (default) | INV, STATE, DATA, CTX, SBOM, TF, EGR, CRYPTO, SYNTH, LZR, COMP, SCOPE | none |
| `security-focus` | SBOM, CRYPTO, EGR, MAL | KRITIS, NIS2 |
| `data-governance` | DATA, CTX | GDPR |

Set a lens before an assessment:

```bash
swao lenses set security-focus
swao assess --app my-app
```

See also: [Workspace Setup](/workspace-setup) | [CLI reference](/runbooks/cli-reference)
