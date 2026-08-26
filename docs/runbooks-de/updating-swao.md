=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Runbook: SWAO aktualisieren

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# SWAO aktualisieren

Dieses Runbook beschreibt das Herunterladen eines neün SWAO-Releases, die Integritätsprüfung, das Ersetzen der alten Binary und die Prüfung auf Konfigurationsänderungen, die eventüll Handlungsbedarf erfordern.

---

## 1. Aktüllstes Release finden

Release-Binaries und Prüfsummen sind veröffentlicht unter:

```
https://github.com/Accenture/SWAO/releases
```

Jede Release-Seite enthält:

- Versionierte Binaries für jede Plattform (`swao-enterprise-win.exe`, `swao-linux-x64`, `swao-linux-arm64`, `swao-darwin-x64`, `swao-darwin-arm64`)
- `sha256sums.txt` -- SHA-256-Prüfsummen für jede Binary
- `CHANGELOG.md`-Auszug -- Zusammenfassung der Änderungen seit dem vorherigen Release

Die aktüll installierte Version vor dem Upgrade notieren:

```bash
swao --version
# Example: 0.4.9
```

---

## 2. Binary herunterladen und verifizieren

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

Bei einer Prüfsummen-Diskrepanz die Installation nicht fortsetzen.

---

## 3. Alte Binary ersetzen

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

## 4. Neü Version bestätigen

```bash
swao --version
swao doctor
```

`swao doctor` führt alle Umgebungsprüfungen einschliesslich der Schema-Version durch. Wenn der Schema-Prüfpunkt nach dem Upgrade rot wird, ist zwischen den Versionen eine brechende WSP-Schema-Änderung erfolgt -- siehe Abschnitt 5.

---

## 5. Auf Breaking Changes prüfen

Das Changelog für die neü Version vor dem Einsatz in gemeinsam genutzten oder produktiven Workspaces lesen:

```
https://github.com/Accenture/SWAO/releases/tag/v<version>
```

### WSP-Schema-Änderungen

Die WSP-Schema-Version wird in `schema_version` in der `run-manifest.json` jedes Laufs getrackt. Wenn die Binary eine neüre Schema-Version erwartet als die `.swao.yml` des Workspaces deklariert, meldet `swao doctor` eine Schema-Diskrepanz.

Behebung mit dem Konfigurations-Migrations-Befehl:

```bash
# Preview changes (dry run)
swao migrate-config --dry-run

# Apply
swao migrate-config

# Verify
swao doctor
```

### Pass-Konfigurationsänderungen

Wenn ein neür Pass-Schlüssel eingeführt wird (z. B. ein neüs Analysemodul), überspringen bestehende `.swao.yml`-Dateien, die ihn nicht auflisten, den neün Pass. Ihn bei Bedarf zu `passes.enabled` in `.swao.yml` hinzufügen.

---

## 6. Rollback

Falls die neü Version Regressionen verursacht, die alte Binary bis zur Beheibung des Problems behalten. Das vorherige Release mit denselben Schritten unter Angabe des älteren Versions-Tags herunterladen.

Es gibt keinen eingebauten Rollback-Befehl. Der Austausch der Binary ist der Rollback-Mechanismus.
