# VirusTotal / CAPE Sandbox Report -- swao-consultant-win-x64.exe (v1.0.0)

## File Identity

| Field | Value |
|---|---|
| File name | swao-consultant-win-x64.exe |
| Version | 1.0.0 |
| SHA256 | 8cf0dfddbf0409a67f13e43686f5e33ee5e907ad13950998d3c1c923f0dc756f |
| Analysis date | 2026-09-05 18:58:27 UTC |
| Analysis engine | CAPE Sandbox (analysis ID 13935, machine win10_2 / cape1 / KVM) |
| Analysis duration | 226 seconds |

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
| T1059/008 | Command and Scripting Interpreter: Network Device CLI | Node.js process execution model misidentified |
| T1071 | Application Layer Protocol | HTTP OCSP requests during certificate chain validation |
| T1574 | Hijack Execution Flow | VEH + SetUnhandledExceptionFilter; standard Node.js pattern |

## Network Activity

All network activity was initiated by the Windows OS itself or by certificate validation, not by SWAO application code.

### Hosts contacted

| IP Address | Attribution |
|---|---|
| 168.61.215.74 | Microsoft Azure (Windows telemetry) |
| 135.233.95.135 | Microsoft (Update/CDN infrastructure) |
| 199.232.210.172 | Fastly CDN (windowsupdate.com) |
| 173.223.0.212, 23.216.5.149/151 | Akamai CDN (Windows Update distribution) |
| 57.155.104.224, 74.178.240.61/204 | Akamai (Microsoft CDN) |

### DNS lookups

All domains are standard Windows sandbox or Microsoft infrastructure:

- `dns.msftncsi.com` -- Windows network connectivity indicator
- `ctldl.windowsupdate.com` -- Certificate Trust List download (Windows CryptoAPI)
- `ocsp.digicert.com` -- OCSP stapling for the code-signing certificate
- `oneocsp.microsoft.com` -- Microsoft OCSP
- `settings-win.data.microsoft.com` -- Windows diagnostics
- `api.msn.com`, `cdn.onenote.net` -- Standard Windows sandbox background activity

### HTTP requests

All HTTP requests initiated by `Microsoft-CryptoAPI/10.0`, not by SWAO:

1. `GET ctldl.windowsupdate.com/.../disallowedcertstl.cab` -- revoked certificate list refresh (multiple requests)
2. `GET ctldl.windowsupdate.com/.../pinrulesstl.cab` -- certificate pinning rules update
3. `GET ocsp.digicert.com/...` -- OCSP check for SWAO's code-signing certificate
4. `GET oneocsp.microsoft.com/...` -- OCSP check for Microsoft intermediate CA

SWAO itself made no outbound HTTP requests during the sandboxed run (no LLM backend configured, no workspace assessed).

## False Positive Rationale

The `WinosStager` CAPE YARA rule fires on obfuscated packed executables in general. SWAO Consultant is built with two obfuscation-adjacent technologies that trigger this rule class:

1. **javascript-obfuscator**: transforms the JavaScript bundle using string-array encoding, control-flow flattening, and identifier mangling. These transformations match patterns that YARA rules intended for stagers and loaders also match.
2. **pkg (yao-pkg)**: packs the Node.js runtime, the V8 JIT engine, and all application code into a single self-contained EXE. The self-read behaviour (pkg reads embedded assets from its own binary at runtime) matches the "reads from own image" heuristic.
3. **V8 JIT + exception handling**: Node.js installs a VEH and SetUnhandledExceptionFilter during startup. These are standard Windows patterns for JIT engines but match sandbox anti-debug heuristics.

The Consultant tier applies the same obfuscation pipeline as the Enterprise tier. Both produce identical CAPE signature sets. This is consistent with the obfuscation being the sole trigger source.

No malicious behaviour was observed. SWAO made no outbound connections independent of Windows OS infrastructure. No shellcode, no lateral movement, no persistence mechanism.

## Comparison Across Tiers

| Tier | CAPE Detection | Signatures | Rationale |
|---|---|---|---|
| Enterprise | WinosStager | Same 6 signatures | Obfuscated (javascript-obfuscator + pkg) |
| Consultant | WinosStager | Same 6 signatures | Obfuscated (javascript-obfuscator + pkg) |
| Community | Pending | Fewer expected | Non-obfuscated; only pkg self-read heuristic |

---

_Parsed from CAPE Sandbox HTML report (analysis ID 13935). Source HTML archived at `vt-consultant-win-x64-cape-sandbox.html`._
_Authored: 2026-09-05. Author: Helmut Schindlwick + Claude (AI pair-programmer)._
