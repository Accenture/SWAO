# SWAO Pre-built Binaries

Binaries are published as **GitHub Release assets** and are not committed to this repository.
Download from the [latest release](https://github.com/Accenture/SWAO/releases/latest).

---

## Available binaries

12 binaries ship with every release -- three licence tiers for four platforms:

### Community Edition (Apache-2.0, no licence key required)

| Platform | File |
|---|---|
| Windows x64 | `swao-community-win-x64.exe` |
| Linux x64 | `swao-community-linux-x64` |
| macOS Intel (x64) | `swao-community-macos-x64` |
| macOS Apple Silicon (arm64) | `swao-community-macos-arm64` |

### Consultant Edition (licence key required)

| Platform | File |
|---|---|
| Windows x64 | `swao-consultant-win-x64.exe` |
| Linux x64 | `swao-consultant-linux-x64` |
| macOS Intel (x64) | `swao-consultant-macos-x64` |
| macOS Apple Silicon (arm64) | `swao-consultant-macos-arm64` |

### Enterprise Edition (licence key required)

| Platform | File |
|---|---|
| Windows x64 | `swao-enterprise-win-x64.exe` |
| Linux x64 | `swao-enterprise-linux-x64` |
| macOS Intel (x64) | `swao-enterprise-macos-x64` |
| macOS Apple Silicon (arm64) | `swao-enterprise-macos-arm64` |

---

## Integrity verification

Every release ships a `SHA256SUMS` file. Verify your download:

```bash
# Linux / macOS
sha256sum --check SHA256SUMS

# Windows (PowerShell)
Get-FileHash swao-enterprise-win-x64.exe -Algorithm SHA256
```

---

## Choosing an edition

| Feature | Community | Consultant | Enterprise |
|---|---|---|---|
| Core assessment (static + compliance passes) | Yes | Yes | Yes |
| LLM assessment pass | Yes | Yes | Yes |
| PDF reports | No | Yes | Yes |
| HTML portal | No | Yes | Yes |
| Terraform landing-zone analysis | No | Yes | Yes |
| Portfolio management | No | No | Yes |
| Challenge management | No | No | Yes |
| Licence required | No | Yes | Yes |

Contact [swao-tool@accenture.com](mailto:swao-tool@accenture.com) to obtain a Consultant or Enterprise licence.

---

## Installation

See [docs/runbooks/install.md](../docs/runbooks/install.md) for platform-specific installation instructions.
