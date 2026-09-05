# Code Signing Runbook

**Classification:** Accenture Internal -- Confidential

---

## Overview

SWAO Windows binaries (`swao-*-win-x64.exe`) are self-contained executables built with
`@yao-pkg/pkg`. Unsigned executables trigger SmartScreen warnings on Windows and may
produce one or more detections from ML-based antivirus engines (notably Trapmine). This
runbook documents the Authenticode signing process required before v1.0.0-GA.

**Current status (v1.0.0-rc.1):** unsigned; one Trapmine ML heuristic detection on
VirusTotal is documented and accepted for the RC phase (see issue #2182).

---

## 1. Certificate Options

Three procurement paths in order of preference for an internal Accenture tool:

### 1.1 Accenture IT shared certificate

Check with Accenture IT Security / DevSecOps whether a shared Authenticode OV or EV
certificate exists for signing internal tools distributed outside Accenture. If yes:

- Request signing as a CI pipeline step via the Accenture signing service
- No procurement cost; covered by existing enterprise agreement
- Contact: your regional DevSecOps / Platform Engineering team lead

### 1.2 Independent OV certificate (recommended if Accenture IT cannot provide)

An Organisation Validation (OV) certificate from a trusted CA suffices for SmartScreen
acceptance after the binary accumulates download reputation.

| CA | Estimated cost | Notes |
|---|---|---|
| DigiCert | USD 400-600/year | Widely supported; strong CI tooling |
| Sectigo (Comodo) | USD 300-500/year | Lower cost; comparable support |

Purchase process:
1. Domain/org validation by the CA (2-5 business days)
2. Receive a PKCS#12 (`.pfx`) file containing the certificate + private key
3. Store the `.pfx` in the Accenture shared password manager under `swao/code-signing`

### 1.3 EV certificate

An Extended Validation (EV) certificate grants immediate SmartScreen reputation
(no accumulation required). Costs USD 700-1200/year. Requires hardware HSM or a
cloud HSM service (DigiCert KeyLocker, SSL.com eSigner). More operationally complex.
Recommended only if SmartScreen warnings after release become a customer blocker.

---

## 2. Signing the Binary in GitHub Actions

Add the following step to `release.yml` after the `pkg` build step and before the
binary is uploaded as a release asset:

```yaml
- name: Sign Windows binary (Authenticode)
  if: runner.os == 'Windows'
  shell: pwsh
  env:
    CODESIGN_PFX_B64: ${{ secrets.CODESIGN_PFX_B64 }}
    CODESIGN_PFX_PASSWORD: ${{ secrets.CODESIGN_PFX_PASSWORD }}
  run: |
    # Decode PFX from base64 secret
    $pfxBytes = [System.Convert]::FromBase64String($env:CODESIGN_PFX_B64)
    $pfxPath = Join-Path $env:RUNNER_TEMP 'swao-codesign.pfx'
    [System.IO.File]::WriteAllBytes($pfxPath, $pfxBytes)

    # Sign using signtool (available on Windows Server 2022 GitHub runners)
    & 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe' sign `
      /fd SHA256 `
      /tr http://timestamp.digicert.com `
      /td SHA256 `
      /f $pfxPath `
      /p $env:CODESIGN_PFX_PASSWORD `
      dist-bin\swao-enterprise-win.exe `
      dist-bin\swao-consultant-win.exe `
      dist-bin\swao-community-win-x64.exe

    # Verify
    & 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe' verify `
      /pa dist-bin\swao-enterprise-win.exe
```

GitHub Actions secrets required:
- `CODESIGN_PFX_B64` -- base64-encoded PKCS#12 certificate file
- `CODESIGN_PFX_PASSWORD` -- PFX password

To base64-encode the PFX for the secret:
```powershell
[System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes('swao-codesign.pfx')) | Set-Clipboard
```

---

## 3. Expected VirusTotal Result After Signing

- **OV certificate, day 1:** SmartScreen "Unknown publisher" warning; VirusTotal
  detections typically drop to 0/72 (Trapmine ML heuristic is neutralised by the
  Authenticode signature).
- **OV certificate, after ~10 000 downloads:** SmartScreen reputation established;
  warning disappears on subsequent runs.
- **EV certificate, day 1:** SmartScreen trust granted immediately; VirusTotal 0/72.

Run a fresh VirusTotal scan after signing and update `docs/releases/v1.0.0-vt-baseline.md`.

---

## 4. Windows Binary Allowlisting (until code signing is in place)

Enterprise Windows environments with AppLocker or Windows Defender Application Control
(WDAC) may block unsigned executables. Refer to
`docs/runbooks/windows-binary-allowlisting.md` for the hash-pinning approach used
until Authenticode signing is in place.

---

## 5. GPG Signing of Release Checksums

Authenticode signs the Windows binary itself. GPG signing is a separate, complementary
step that lets users verify the integrity of release artefacts (all binaries, not just Windows)
by signing the SHA256SUMS file.

**Status (v1.0.0-rc.1):** GPG public key published; checksums not yet GPG-signed.

### 5.1 Key details

| Field | Value |
|---|---|
| Key type | Ed25519 + Cv25519 |
| UID | SWAO Security (SWAO Project Security Key) |
| Email | swao-tool@accenture.com |
| Fingerprint | 7F50A63D2884751B902ED453F876CFFED7D95A7A |
| Expires | 2028-09-04 |
| Public key file | `swao/swao-security.asc` (committed to the public repo) |
| Private key location | Accenture password manager, entry "SWAO GPG Private Key" |

### 5.2 Signing SHA256SUMS for a release

After all binaries are built and `SHA256SUMS` is generated locally:

```powershell
# Import the private key from the password manager if not already in the local keyring
& "C:\Program Files\GnuPG\bin\gpg.exe" --import swao-security-PRIVATE.asc

# Sign the checksum file
& "C:\Program Files\GnuPG\bin\gpg.exe" --armor --detach-sign --local-user 7F50A63D2884751B902ED453F876CFFED7D95A7A SHA256SUMS
# Produces SHA256SUMS.asc
```

Upload both `SHA256SUMS` and `SHA256SUMS.asc` as release assets.

### 5.3 User verification instructions

Add to the release notes and `docs/runbooks/verify-download.md`:

```bash
# Import the SWAO signing key (one-time)
gpg --import swao-security.asc

# Verify the checksum signature
gpg --verify SHA256SUMS.asc SHA256SUMS

# Verify your binary's checksum
sha256sum -c SHA256SUMS --ignore-missing
```

---

## 7. References

- Issue #2181 (this runbook is the deliverable)
- Issue #2182 (VirusTotal baseline rebuild after signing)
- `docs/runbooks/windows-binary-allowlisting.md` -- interim approach
- ADR-0057 -- pre-build obfuscation for Premium tiers (separate from signing)
- `swao/swao-security.asc` -- published GPG public key
