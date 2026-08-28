# Installation

SWAO is available as a self-contained binary and a Docker image. Pick the option that suits your environment.

---

## System requirements

| Item | Requirement |
|---|---|
| Operating system | Windows 10+ x64, macOS 12+ (Intel or Apple Silicon), Linux x64 (Ubuntu 22.04+ recommended) |
| Git | Required for workspace management (`swao init` clones framework catalogs) |
| Node.js | Required only when building from source (v20 LTS or later) |
| Docker | Required only for the Docker install path |

---

## Option A -- Binary download (recommended)

Download the latest Community binary from the GitHub Releases page:

**https://github.com/Accenture/SWAO/releases/latest**

| Platform | File to download |
|---|---|
| Windows x64 | `swao-community-win.exe` |
| macOS Apple Silicon (M1/M2/M3) | `swao-community-darwin-arm64` |
| macOS Intel | `swao-community-darwin-x64` |
| Linux x64 | `swao-community-linux-x64` |

Always verify the download against `SHA256SUMS` (included in the release):

```bash
# macOS / Linux
sha256sum --check SHA256SUMS

# Windows (PowerShell)
Get-FileHash swao-community-win.exe -Algorithm SHA256
# Compare against the value in SHA256SUMS
```

### Windows

```powershell
# Rename and add to PATH
Rename-Item swao-community-win.exe swao.exe
# Move to a directory already on your PATH, e.g.:
Move-Item swao.exe C:\Windows\System32\swao.exe

# Verify
swao health-check
```

### macOS and Linux

```bash
# Make executable and move to PATH
chmod +x swao-community-macos-arm64      # or swao-community-macos-x64 / swao-community-linux-x64
mv swao-community-macos-arm64 /usr/local/bin/swao

# Verify
swao health-check
```

On macOS, the first run may be blocked by Gatekeeper. To approve:

```bash
xattr -d com.apple.quarantine /usr/local/bin/swao
```

---

## Option B -- Docker

```bash
# Pull the latest Community image
docker pull ghcr.io/accenture/swao:latest

# Run against a local workspace directory
docker run --rm \
  -v "$(pwd):/workspace" \
  -e ANTHROPIC_API_KEY=your-key-here \
  ghcr.io/accenture/swao:latest \
  assess --workspace /workspace

# Health check
docker run --rm ghcr.io/accenture/swao:latest health-check
```

See the [Docker deployment runbook](docker-deployment.md) for full configuration options including
LLM provider setup, air-gapped usage, and licence file mounting.

---

## Option C -- Build from source

Community Edition source publication is in progress as part of the SWAO open-source initiative.
Subscribe to [SWAO Releases](https://github.com/Accenture/SWAO/releases) to be notified
when source packages become available.

Until then, use Option A (binary) or Option B (Docker).

---

## First run

After installation:

```bash
# Run the interactive setup wizard
swao init

# Verify your workspace and configuration
swao health-check

# Run your first assessment
swao assess --app <your-app-name>
```

---

## Consultant and Enterprise editions

Consultant and Enterprise binaries include additional features such as PDF reports,
HTML portal publication, Terraform module generation, Power BI integration, and the
stakeholder challenge workflow.

Contact [swao-tool@accenture.com](mailto:swao-tool@accenture.com) to request a licence.

See the [Features & Editions](/features) page for a full breakdown of what each tier includes.

---

## Updating SWAO

Download the new binary from the latest GitHub Release and replace the old one. SWAO has
no built-in auto-update mechanism.

For Docker: `docker pull ghcr.io/accenture/swao:latest`.
