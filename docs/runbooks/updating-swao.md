=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Runbook: Updating SWAO

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Updating SWAO

This runbook explains how to download a new SWAO release, verify its integrity, replace the old binary, and check for configuration changes that may require action.

---

## 1. Find the latest release

Release binaries and checksums are published at:

```
https://github.com/Accenture/SWAO/releases
```

Each release page lists:

- Versioned binaries for each platform (`swao-enterprise-win.exe`, `swao-linux-x64`, `swao-linux-arm64`, `swao-darwin-x64`, `swao-darwin-arm64`)
- `sha256sums.txt` -- SHA-256 checksums for every binary
- `CHANGELOG.md` excerpt -- summary of changes since the previous release

Note the current installed version before upgrading:

```bash
swao --version
# Example: 0.4.9
```

---

## 2. Download and verify the binary

### Linux / macOS

```bash
VERSION="0.5.1"   # replace with the target version
PLATFORM="linux-x64"   # adjust to your platform

curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/v${VERSION}/swao-${PLATFORM}"

# Download the checksum file
curl -Lo /tmp/sha256sums.txt \
  "https://github.com/Accenture/SWAO/releases/download/v${VERSION}/sha256sums.txt"

# Verify
sha256sum /tmp/swao
grep "swao-${PLATFORM}" /tmp/sha256sums.txt
# The first column of each line must match exactly
```

### Windows (PowerShell)

```powershell
$Version = "0.5.1"
$BinaryUrl = "https://github.com/Accenture/SWAO/releases/download/v${Version}/swao-enterprise-win.exe"
$ChecksumUrl = "https://github.com/Accenture/SWAO/releases/download/v${Version}/sha256sums.txt"

Invoke-WebRequest -Uri $BinaryUrl -OutFile "$env:TEMP\swao-new.exe"
Invoke-WebRequest -Uri $ChecksumUrl -OutFile "$env:TEMP\sha256sums.txt"

# Compute hash of downloaded binary
$Hash = (Get-FileHash -Path "$env:TEMP\swao-new.exe" -Algorithm SHA256).Hash.ToLower()

# Read expected hash from checksum file
$Expected = (Select-String -Path "$env:TEMP\sha256sums.txt" -Pattern "swao-enterprise-win.exe").Line.Split(" ")[0]

if ($Hash -eq $Expected) {
    Write-Host "Checksum verified: $Hash"
} else {
    Write-Error "Checksum mismatch. Do not install this binary."
    exit 1
}
```

Do not proceed with installation if the checksum does not match.

---

## 3. Replace the old binary

### Linux / macOS

```bash
chmod +x /tmp/swao
sudo mv /tmp/swao /usr/local/bin/swao

# macOS only: remove quarantine attribute
xattr -dr com.apple.quarantine /usr/local/bin/swao
```

### Windows (PowerShell)

```powershell
# Stop any running SWAO processes first
Stop-Process -Name "swao-win-x64" -ErrorAction SilentlyContinue

# Replace the binary
Move-Item -Force "$env:TEMP\swao-new.exe" "C:\Tools\swao\swao-enterprise-win.exe"

# Re-unblock after replacement
Unblock-File -Path "C:\Tools\swao\swao-enterprise-win.exe"
```

---

## 4. Confirm the new version

```bash
swao --version
swao health-check
```

`swao health-check` runs all environment probes including schema version. If the schema probe turns red after upgrading, a breaking WSP schema change occurred between versions -- see section 5.

---

## 5. Check for breaking changes

Read the CHANGELOG for the new version before deploying to shared or production workspaces:

```
https://github.com/Accenture/SWAO/releases/tag/v<version>
```

### WSP schema changes

The WSP schema version is tracked in `schema_version` inside each run's `run-manifest.json`. When the binary expects a newer schema than your workspace `.swao.yml` declares, `swao health-check` reports a schema mismatch.

Resolve it by running the config migration command:

```bash
# Preview changes (dry run)
swao migrate-config --dry-run

# Apply
swao migrate-config

# Verify
swao health-check
```

### Pass configuration changes

If a new pass key is introduced (e.g. a new analysis module), existing `.swao.yml` files that do not list it will skip the new pass. Add it to `passes.enabled` in `.swao.yml` if you want it to run.

---

## 6. Rollback

If the new version causes regressions, keep the old binary until the issue is resolved. Download the previous release using the same steps above, substituting the older version tag.

There is no in-tool rollback command. Binary replacement is the rollback mechanism.
