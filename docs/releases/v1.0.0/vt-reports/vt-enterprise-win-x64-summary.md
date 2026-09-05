# VirusTotal / CAPE Sandbox Report -- swao-enterprise-win-x64.exe (v1.0.0)

## File Identity

| Field | Value |
|---|---|
| File name | swao-enterprise-win-x64.exe |
| Version | 1.0.0 |
| SHA256 | f623992785c9710b3c77d4f3548c7dbb60ce3d30e33ae8093915ff58665b3365 |
| Analysis date | 2026-09-05 18:53:44 UTC |
| Analysis engine | CAPE Sandbox (analysis ID 7305, machine win10_4 / cape3 / KVM) |
| Analysis duration | 230 seconds |

## CAPE Detection Label

CAPE emitted one detection badge: **WinosStager** (rendered as a red/danger badge in the report UI).

**Assessment: false positive.** See rationale below.

## Behavioral Signatures

| Severity | Signature | Notes |
|---|---|---|
| INFO | Checks available memory | Node.js runtime startup probe |
| INFO | SetUnhandledExceptionFilter detected (possible anti-debug) | Node.js registers this exception handler; standard V8 behaviour |
| INFO | Checks system language via registry key (possible geofencing) | V8/Node.js locale detection |
| WARNING | Registers a vectored exception handler (VEH), possibly to hijack execution flow | V8 JIT compiler installs VEH for signal/exception handling; expected |
| WARNING | Reads data out of its own binary image | pkg embeds all runtime assets (controls, frameworks, templates) inside the EXE; self-reads are by design |
| WARNING | Performs some HTTP requests | OCSP certificate validation only (see Network section) |

## MITRE ATT&CK Mappings (sandbox-assigned)

| Technique | Name | Actual cause |
|---|---|---|
| T1082 | System Information Discovery | Node.js probing OS version and locale |
| T1055 | Process Injection | V8 JIT + VEH registration, not injection |
| T1071 | Application Layer Protocol | HTTP OCSP requests during certificate chain validation |
| T1574 | Hijack Execution Flow | VEH + SetUnhandledExceptionFilter; standard Node.js pattern |

## Network Activity

All network activity was initiated by the Windows OS itself or by certificate validation, not by SWAO application code.

### Hosts contacted

| IP Address | Attribution |
|---|---|
| 168.61.215.74 | Microsoft Azure (Windows telemetry) |
| 135.233.95.135 | Microsoft (Update/CDN infrastructure) |
| 20.165.94.63 | Microsoft (Update/CDN infrastructure) |
| 23.39.149.115 | Akamai CDN (Windows Update distribution) |
| 199.232.210.172 | Fastly CDN (windowsupdate.com) |

### DNS lookups

All domains are standard Windows sandbox or Microsoft infrastructure:

- `dns.msftncsi.com` -- Windows network connectivity indicator
- `ctldl.windowsupdate.com` -- Certificate Trust List download (Windows CryptoAPI)
- `ocsp.digicert.com` -- OCSP stapling for the code-signing certificate
- `oneocsp.microsoft.com` -- Microsoft OCSP
- `time.windows.com` -- NTP
- `settings-win.data.microsoft.com` -- Windows diagnostics
- `slscr.update.microsoft.com`, `fe3cr.delivery.mp.microsoft.com` -- Windows Update

### HTTP requests

Three HTTP GET requests, all initiated by `Microsoft-CryptoAPI/10.0`, not by SWAO:

1. `GET ctldl.windowsupdate.com/.../disallowedcertstl.cab` -- revoked certificate list refresh
2. `GET ocsp.digicert.com/...` -- OCSP check for SWAO's code-signing certificate
3. `GET oneocsp.microsoft.com/...` -- OCSP check for Microsoft intermediate CA

SWAO itself made no outbound HTTP requests during the sandboxed run (no LLM backend configured, no workspace assessed).

## False Positive Rationale

The `WinosStager` CAPE YARA rule fires on obfuscated packed executables in general. SWAO Enterprise is built with three obfuscation-adjacent technologies that trigger this rule class:

1. **javascript-obfuscator**: transforms the JavaScript bundle using string-array encoding, control-flow flattening, and identifier mangling. These transformations match patterns that YARA rules intended for stagers and loaders also match.
2. **pkg (yao-pkg)**: packs the Node.js runtime, the V8 JIT engine, and all application code into a single self-contained EXE. The self-read behaviour (pkg reads embedded assets from its own binary at runtime) matches the "reads from own image" heuristic.
3. **V8 JIT + exception handling**: Node.js installs a VEH and SetUnhandledExceptionFilter during startup. These are standard Windows patterns for JIT engines but match sandbox anti-debug heuristics.

No malicious behaviour was observed. SWAO made no outbound connections independent of Windows OS infrastructure. No shellcode, no lateral movement, no persistence mechanism.

## Comparison with Community Tier

The Community binary (non-obfuscated) is expected to produce fewer CAPE signatures because it lacks the javascript-obfuscator transformation. The WinosStager detection is specific to the obfuscated bundles (Consultant and Enterprise tiers). See `vt-report-process.md` for the full three-tier submission process.

## Recommended Disclosure

This report should accompany the v1.0.0 release in `docs/releases/v1.0.0/security-scan/` or be linked from the release notes. The false positive classification and rationale above should be included in the public-facing release security section if required by the Accenture OSS policy checklist.

---

_Parsed from CAPE Sandbox HTML report (analysis ID 7305). Source HTML archived at `vt-enterprise-win-x64-cape-sandbox.html`._
_Authored: 2026-09-05. Author: Helmut Schindlwick + Claude (AI pair-programmer)._
