# macOS: Install SWAO

macOS Gatekeeper blocks unsigned or newly distributed binaries by default. This runbook covers downloading the SWAO binary, bypassing the quarantine attribute, and adding SWAO to your shell PATH.

---

## Prerequisites

- macOS 12 (Monterey) or later
- Terminal access (zsh or bash)
- `curl` or a browser to download the binary

---

## 1. Download the binary

```bash
# Download the latest release (replace <version> with the target version)
curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/<version>/swao-darwin-arm64"

# For Intel Macs use swao-darwin-x64
curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/<version>/swao-darwin-x64"
```

Verify the SHA-256 checksum against the published `sha256sums.txt`:

```bash
shasum -a 256 /tmp/swao
```

Compare the output against the matching entry in the release's `sha256sums.txt` before proceeding.

---

## 2. Install to /usr/local/bin

```bash
# Make the binary executable and move to a directory on PATH
chmod +x /tmp/swao
sudo mv /tmp/swao /usr/local/bin/swao
```

If `/usr/local/bin` does not exist on your machine:

```bash
sudo mkdir -p /usr/local/bin
sudo mv /tmp/swao /usr/local/bin/swao
```

---

## 3. Remove the Gatekeeper quarantine attribute

macOS applies a `com.apple.quarantine` extended attribute to files downloaded from the internet. Removing it authorises the binary for execution without a Gatekeeper prompt.

```bash
# Remove the quarantine attribute
xattr -dr com.apple.quarantine /usr/local/bin/swao

# Confirm the attribute is gone (no output = success)
xattr -l /usr/local/bin/swao
```

If you skip this step and attempt to run `swao`, macOS displays: "swao cannot be opened because the developer cannot be verified." After removing the quarantine attribute, no prompt appears.

---

## 4. Permanent trust via System Settings

As an alternative to the command-line approach, or if `xattr` does not permanently resolve the block:

1. Attempt to run `swao --version` in Terminal. The Gatekeeper dialog appears.
2. Open **System Settings** (macOS 13+) or **System Preferences** (macOS 12).
3. Navigate to **Privacy and Security**.
4. Scroll to the Security section. You should see a message: "swao was blocked from use because it is not from an identified developer."
5. Click **Allow Anyway**.
6. Run `swao --version` again. A final confirmation dialog appears; click **Open**.

This trust decision is stored per-binary-path. Re-running `xattr` is the faster approach for scripted deployments.

---

## 5. Add to PATH in ~/.zshrc

If `/usr/local/bin` is already on your PATH (it is by default on most macOS systems), no further action is needed. Verify:

```bash
echo $PATH | tr ':' '\n' | grep /usr/local/bin
```

If the directory is missing from PATH, add it:

```bash
# Append to ~/.zshrc
echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.zshrc

# Apply immediately in the current session
source ~/.zshrc
```

For bash users, replace `~/.zshrc` with `~/.bash_profile` or `~/.bashrc` as appropriate.

---

## 6. Per-version upgrade note

The quarantine attribute must be removed each time you replace the binary with a new version, because the download creates a new file with a fresh quarantine attribute. Wrap the upgrade steps in a shell function or script:

```bash
#!/usr/bin/env bash
# save as ~/bin/upgrade-swao.sh
set -euo pipefail
VERSION="${1:?usage: upgrade-swao.sh <version>}"
ARCH=$(uname -m)
SUFFIX="darwin-arm64"
if [ "$ARCH" = "x86_64" ]; then SUFFIX="darwin-x64"; fi

curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/${VERSION}/swao-${SUFFIX}"
chmod +x /tmp/swao
sudo mv /tmp/swao /usr/local/bin/swao
xattr -dr com.apple.quarantine /usr/local/bin/swao
swao --version
```

---

## 7. Verify installation

```bash
swao --version
swao health-check
```

A clean `swao health-check` result with all probes showing green confirms the installation is complete.
