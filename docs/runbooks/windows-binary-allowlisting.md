<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Windows Allowlisting
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->
# Windows Binary Allowlisting Guide

**Applies to:** `swao-enterprise-win.exe` distributed via GitHub Releases or operator channels.

SWAO's Windows binary is packaged using `@yao-pkg/pkg` (Node.js runtime + bundled
application). Some security tools flag pkg-packaged binaries via heuristics because they
self-extract a temporary snapshot at startup. This is not malware -- it is a packaging
artefact. The extractions go to `%TEMP%\pkg-<hash>\` and are cleaned up on exit.

---

## Step 1 -- Verify the SHA-256 hash

Download `SHA256SUMS` from the GitHub Release page alongside the binary:

```
https://github.com/Accenture/SWAO/releases/download/vX.Y.Z/SHA256SUMS
```

Compute the local hash on Windows (PowerShell):
```powershell
Get-FileHash swao-enterprise-win.exe -Algorithm SHA256 | Select-Object Hash
```

Or Command Prompt:
```cmd
certutil -hashfile swao-enterprise-win.exe SHA256
```

Compare against the `swao-vX.Y.Z-win-x64.exe` line in SHA256SUMS. If hashes match,
the binary is unmodified from the CI build. If they do not match, do not run the binary.

---

## Step 2 -- Check the VirusTotal report

Each GitHub Release includes a VirusTotal scan permalink in the release notes.
The scan uses hash-lookup (binary content is not uploaded to VirusTotal).

If the scan shows detections, check whether they are:
- **Heuristic / generic** (e.g. "packed binary", "temp-dir dropper"): expected for
  pkg-packaged binaries. Submit a false-positive report to each vendor.
- **Signature match** to a known malware family: contact Accenture before proceeding.

---

## Step 3 -- Add to endpoint-protection allowlist

### Windows Defender (manual)

```powershell
Add-MpPreference -ExclusionPath "C:\path\to\swao-enterprise-win.exe"
```

Or by SHA-256 hash (preferred -- hash survives rename):
```powershell
Add-MpPreference -ExclusionProcess "swao-enterprise-win.exe"
```

### Enterprise GPO (Windows Defender)

1. Open `Group Policy Management` > your target OU.
2. `Computer Configuration` > `Administrative Templates` > `Windows Defender Antivirus`
   > `Exclusions` > `Path Exclusions`.
3. Add the full path to `swao-enterprise-win.exe`.

Or use Defender ATP / Intune custom indicator (hash-based):
- Navigate to `Security Center` > `Settings` > `Endpoints` > `Indicators`.
- Add SHA-256 hash. Action: `Allow`. Scope: your deployment group.

### CrowdStrike

Submit a Machine Learning (ML) exclusion or IOA exclusion via the CrowdStrike console:
- `Configuration` > `Prevention Policy` > `Machine Learning` > `Add exclusion`.
- Use full path or SHA-256.

---

## Step 4 -- SmartScreen (first-run dialog)

If Windows SmartScreen shows "Windows protected your PC":

1. Click **More info**.
2. Click **Run anyway**.

This is expected for binaries that are not yet in Microsoft's reputation database.
Code signing (planned post-PoC) will eliminate this dialog.

---

## Communication template

> **Subject:** SWAO binary allowlisting -- action required before first use
>
> Please add the attached SWAO binary (`swao-enterprise-win.exe`) to your endpoint-protection
> allowlist before deploying. The binary is packaged using Node.js pkg and triggers
> heuristic false positives in some AV engines.
>
> **SHA-256:** `<paste from SHA256SUMS>`
> **VirusTotal report:** `<paste link from GitHub Release>`
>
> All detections are heuristic (no signature match). Steps to allowlist are at:
> `docs/runbooks/windows-binary-allowlisting.md` in the SWAO repository.
>
> Contact: https://github.com/Accenture/SWAO/issues
