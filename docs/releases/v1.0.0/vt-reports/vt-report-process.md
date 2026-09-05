# VirusTotal Report Process - SWAO Releases

This document describes how to generate and archive VirusTotal sandbox analysis reports
for each SWAO binary release. Follow this process for every v*.*.* release.

---

## Why sandbox reports

Binary releases (PKG-packaged Node.js executables) are submitted to VirusTotal as part of
the release security gate. The sandbox analysis provides:

- Evidence that flagged detections are false positives (documented per release)
- MITRE ATT&CK behavioural mapping for security reviewers
- An audit trail for Accenture Legal / client due diligence requests

---

## What to collect

For each binary, collect one CAPE Sandbox HTML report. This is the primary artefact.

Zenbox is an alternative sandbox available on the same VT page; use it if CAPE is unavailable.
The JSON export is gated behind a VirusTotal Enterprise subscription - use the HTML report
instead. The HTML contains all the same data (hashes, MITRE, network, dropped files, payloads).

Do NOT collect EVTX (raw Windows Event Log) or Memdump - these are forensic artefacts
not needed for release documentation.

---

## Step-by-step process

### 1. Upload the binary to VirusTotal

Go to https://www.virustotal.com and upload the binary (community/consultant/enterprise,
each platform). Wait for the full analysis to complete (typically 5-10 minutes).

### 2. Navigate to the Behavior tab

On the file's VT page, click the "Behavior" tab. Wait for sandbox results to appear.
CAPE Sandbox is the preferred sandbox. Zenbox is an alternative.

### 3. Download the CAPE Sandbox HTML report

Click "Full Reports" (bottom right of the Behavior tab) - "CAPE Sandbox".
This opens a signed Google Cloud Storage URL containing the full HTML report.

Copy the URL from the browser address bar. Then fetch and save it with PowerShell:

```powershell
$url = '<paste the signed URL here>'
$out = 'C:\Projects\accenture\315556_swao\docs\releases\v<VERSION>\vt-reports\vt-<tier>-<platform>-cape-sandbox.html'
$content = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 60).Content
[System.IO.File]::WriteAllText($out, $content, [System.Text.UTF8Encoding]::new($false))
```

Note: Use `Invoke-WebRequest` not `curl.exe` for this URL - `curl.exe` on Windows mishandles
the `+` characters in the GCS signature parameter, producing a 400 Bad Request.

The signed URL expires after approximately one year (the `Expires` parameter is a Unix
timestamp). Copy and save it in the summary .md file as a reference before it expires.

### 4. Create the summary .md file

Copy `vt-community-win-x64-summary.md` from the previous release as a template.
Update: file identity section, analysis date, sandbox report URL, and any new findings.

The false positive analysis section changes rarely - review it against the new report's
detections and update only if new signatures or techniques appear.

Name the file: `vt-<tier>-<platform>-summary.md`
Examples:
- vt-community-win-x64-summary.md
- vt-consultant-win-x64-summary.md
- vt-enterprise-win-x64-summary.md

### 5. Commit to the release folder

```
git add docs/releases/v<VERSION>/vt-reports/
git commit -m "chore(release): add VT sandbox reports for v<VERSION> <tier> binaries"
```

---

## File naming convention

```
docs/releases/v<VERSION>/vt-reports/
  vt-<tier>-<platform>-cape-sandbox.html   # raw HTML from CAPE Sandbox Full Report
  vt-<tier>-<platform>-summary.md          # parsed summary + false positive analysis
  vt-report-process.md                     # this file (update if process changes)
```

Examples for v1.0.0:

```
docs/releases/v1.0.0/vt-reports/
  vt-community-win-x64-cape-sandbox.html
  vt-community-win-x64-summary.md
  vt-consultant-win-x64-cape-sandbox.html
  vt-consultant-win-x64-summary.md
  vt-enterprise-win-x64-cape-sandbox.html
  vt-enterprise-win-x64-summary.md
  vt-report-process.md
```

For macOS and Linux binaries: only collect reports if VT's sandbox runs them (sandbox
coverage for ELF and Mach-O is more limited than PE). If CAPE does not analyse them,
note "Sandbox did not execute (non-Windows platform)" in the summary.

---

## Interpreting results for PKG binaries

SWAO binaries are produced by `pkg` (Node.js to single executable). This packaging format
consistently triggers the following false positives across all sandboxes and releases:

| Signal | Why it fires | Why it is a false positive |
|---|---|---|
| WinosStager / overlay YARA | PKG appends Node.js V8 snapshot as EXE overlay | Documented PKG boot mechanism, not malware append-and-execute |
| Registers VEH | Node.js V8 registers Vectored Exception Handler | Present in every Node.js binary worldwide |
| Reads own binary | PKG reads snapshot from EXE at startup | Documented PKG boot mechanism |
| Checks available memory | Node.js V8 heap initialisation | Standard Node.js startup |
| wmic UUID query | SWAO licence fingerprinting | Documented in ADR-0056, runs once per invocation |
| Creates hidden window | Node.js console process | Standard Node.js on Windows |
| Extracts shellcode | V8 JIT-compiled stub captured by CAPE unpacker | 45-byte JIT fragment, not shellcode |

A detection count of 3-5 out of 60 engines is the expected baseline for PKG-packaged
Node.js binaries. A count above 10 warrants investigation before release.

---

## Known limitations

- JSON export requires VirusTotal Enterprise subscription. Use HTML Full Reports instead.
- Signed GCS URLs expire after approximately one year. Download and archive the HTML
  immediately after obtaining the URL; do not rely on the URL remaining valid.
- The Zenbox signed URL may fail with HTTP 400 if the `+` characters in the Signature
  parameter are decoded differently by the HTTP client. `Invoke-WebRequest` handles this
  correctly; `curl.exe` on Windows does not.
