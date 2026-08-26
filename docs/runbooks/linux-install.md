=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Runbook: Linux Installation

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Linux: Install SWAO

This runbook covers installing the SWAO binary on Linux, setting up PATH for both root and non-root users, and configuring an optional systemd service unit for server deployments.

---

## Prerequisites

- A 64-bit Linux distribution (x86_64 or arm64)
- `curl` or `wget` to download the binary
- `sudo` access if installing to system-wide paths (optional)

---

## 1. Download the binary

```bash
# Replace <version> with the target release tag (e.g. v0.5.1)
VERSION="<version>"

# x86_64 (most common)
curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/${VERSION}/swao-linux-x64"

# arm64
curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/${VERSION}/swao-linux-arm64"
```

Verify the checksum before installing:

```bash
# Download the SHA-256 manifest
curl -Lo /tmp/sha256sums.txt \
  "https://github.com/Accenture/SWAO/releases/download/${VERSION}/sha256sums.txt"

# Verify
sha256sum /tmp/swao
grep "swao-linux-x64" /tmp/sha256sums.txt
# The first column of each output must match
```

---

## 2. System-wide install (requires sudo)

```bash
chmod +x /tmp/swao
sudo mv /tmp/swao /usr/local/bin/swao

# Confirm it is on PATH
which swao
swao --version
```

`/usr/local/bin` is included in `$PATH` by default on most Linux distributions. If it is absent, see section 4.

---

## 3. Non-root install to ~/.local/bin

For shared servers or environments where `sudo` is unavailable:

```bash
mkdir -p ~/.local/bin
chmod +x /tmp/swao
mv /tmp/swao ~/.local/bin/swao
```

Then ensure `~/.local/bin` is on your PATH (see section 4).

---

## 4. PATH setup

Check whether the install directory is on PATH:

```bash
echo $PATH | tr ':' '\n'
```

If `/usr/local/bin` or `~/.local/bin` is missing, add it to your shell profile:

```bash
# For bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# For zsh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

## 5. Optional systemd service unit

For server deployments running SWAO as a long-running MCP server or scheduled assessment runner, create a systemd unit:

```ini
# /etc/systemd/system/swao-mcp.service
[Unit]
Description=SWAO MCP HTTP server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/swao mcp --http
Restart=on-failure
RestartSec=5
User=swao
Group=swao
WorkingDirectory=/opt/swao/workspace
Environment=ANTHROPIC_API_KEY=<key>
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
# Create a dedicated system user (optional but recommended)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin swao

# Reload systemd and enable the service
sudo systemctl daemon-reload
sudo systemctl enable swao-mcp
sudo systemctl start swao-mcp

# Check status
sudo systemctl status swao-mcp
journalctl -u swao-mcp -f
```

Store the `ANTHROPIC_API_KEY` value via a drop-in environment file rather than hardcoding it in the unit:

```bash
# /etc/systemd/system/swao-mcp.service.d/env.conf
[Service]
EnvironmentFile=/etc/swao/env
```

```bash
# /etc/swao/env  (mode 0600, owned by root)
ANTHROPIC_API_KEY=sk-...
```

---

## 6. Verify installation

```bash
swao --version
swao health-check
```

All `swao health-check` probes should return green. Yellow on the Playwright probe is expected if a browser is not installed on the server; it only affects the `swao publish` command.

---

## 7. Upgrading

Download the new binary to `/tmp/swao`, verify its checksum, then replace the old binary:

```bash
# Stop the service if running
sudo systemctl stop swao-mcp

chmod +x /tmp/swao
sudo mv /tmp/swao /usr/local/bin/swao

# Restart and verify
sudo systemctl start swao-mcp
swao --version
swao health-check
```
