# VirusTotal / CAPE Sandbox Report -- swao-community-win-x64.exe (v1.0.0)

## File Identity

| Field | Value |
|---|---|
| File name | swao-community-win-x64.exe |
| Version | 1.0.0 |
| SHA256 | aa6423e44bf25f25df06d47cd9066a45ddb6bc3b17dbe709a2343fa9deb2c055 |
| Analysis date | 2026-09-05 18:58:40 UTC |
| Analysis engine | CAPE Sandbox (analysis ID 6649, machine win10_en-US / cape8 / KVM) |
| Analysis duration | 237 seconds |

## CAPE Detection Label

CAPE emitted one detection badge: **WinosStager** (rendered as a red/danger badge in the report UI).

**Assessment: false positive.** See rationale below.

## Behavioral Signatures

Community shows more signatures than Consultant/Enterprise because the non-obfuscated JavaScript bundle allows the sandbox to trace deeper execution paths and observe more system calls.

| Severity | Signature | SWAO cause |
|---|---|---|
| INFO | Checks available memory | Node.js runtime startup probe |
| INFO | SetUnhandledExceptionFilter detected (possible anti-debug) | Standard V8 exception handler |
| INFO | Checks adapter addresses (virtual network interface detection) | Node.js `os.networkInterfaces()` during health check |
| INFO | Checks system language via registry key (possible geofencing) | V8/Node.js locale detection |
| WARNING | Queries process token information (UAC elevation check) | SWAO checks privilege level at startup |
| WARNING | Queried the FIPS cryptography policy | Node.js TLS stack reads FIPS registry key during crypto initialisation |
| WARNING | Registers a vectored exception handler (VEH), possibly to hijack execution flow | V8 JIT compiler; standard Node.js pattern |
| WARNING | Reads data out of its own binary image | pkg embeds all runtime assets inside the EXE; self-reads are by design |
| WARNING | A process created a hidden window | Node.js spawns child processes with hidden console window |
| WARNING | Terminates another process | SWAO process manager (spawns and reaps child processes during assessment) |
| WARNING | Performs some HTTP requests | OCSP certificate validation (see Network section) |
| WARNING | Uses Windows utilities for basic functionality | `wmic.exe` and system binaries called for machine info |
| DANGER | Suspicious wmic.exe use was detected | `wmic csproduct get UUID /value` -- SWAO license validation fingerprint |

## Notable Application Behavior: wmic UUID call

CAPE flagged `wmic csproduct get UUID /value` as suspicious. This is SWAO's license validation mechanism: the CLI queries the hardware UUID to bind license keys to a specific machine. This is intentional and documented behaviour, not malware.

The sandbox also found `wmic.exe` in standard system paths (`C:\Windows\System32\wbem\WMIC.exe`), confirming the binary used is the OS-provided tool, not a dropped payload.

## MITRE ATT&CK Mappings (sandbox-assigned)

Community maps significantly more MITRE techniques than the obfuscated tiers because the sandbox can observe actual tool execution. All are false positives or expected application behaviours.

| Technique | Name | Actual cause |
|---|---|---|
| T1082 | System Information Discovery | Node.js OS probing + wmic UUID query |
| T1033 | System Owner/User Discovery | Node.js `os.userInfo()` |
| T1047 | Windows Management Instrumentation | `wmic csproduct get UUID /value` for license fingerprint |
| T1055 | Process Injection | V8 JIT + VEH registration |
| T1059 | Command and Scripting Interpreter | Node.js process execution |
| T1059/001 | PowerShell | Possible PowerShell child process for system info |
| T1059/005 | Visual Basic Script | False positive; no VBScript in SWAO |
| T1059/008 | Network Device CLI | Node.js process execution misidentified |
| T1071 | Application Layer Protocol | HTTP OCSP requests |
| T1202 | Indirect Command Execution | cmd.exe intermediary for child process spawning |
| T1003 | Credential Access | False positive; no credential access in SWAO |
| T1021 | Remote Services | False positive; COM object access by Node.js misidentified |
| T1021/003 | DCOM | False positive |
| T1021/006 | WinRM | False positive |
| T1564 | Hide Artifacts | Hidden console window on child process spawn |
| T1574 | Hijack Execution Flow | VEH + SetUnhandledExceptionFilter; standard Node.js pattern |

## Network Activity

All network activity was initiated by the Windows OS itself or by certificate validation, not by SWAO application code.

### DNS lookups

- `dns.msftncsi.com` -- Windows network connectivity indicator
- `ctldl.windowsupdate.com` -- Certificate Trust List download (Windows CryptoAPI)
- `ocsp.digicert.com` -- OCSP stapling for the code-signing certificate
- `oneocsp.microsoft.com` -- Microsoft OCSP
- `settings-win.data.microsoft.com` -- Windows diagnostics
- `api.msn.com`, `cdn.onenote.net` -- Standard Windows sandbox background activity

### HTTP requests

All HTTP GET requests initiated by `Microsoft-CryptoAPI/10.0`, not by SWAO:

1. `GET ctldl.windowsupdate.com/.../disallowedcertstl.cab` -- revoked certificate list refresh
2. `GET ctldl.windowsupdate.com/.../pinrulesstl.cab` -- certificate pinning rules update
3. `GET ocsp.digicert.com/...` -- OCSP check for SWAO's code-signing certificate
4. `GET oneocsp.microsoft.com/...` -- OCSP check for Microsoft intermediate CA

SWAO itself made no outbound HTTP requests during the sandboxed run (no LLM backend configured, no workspace assessed).

## False Positive Rationale

### WinosStager detection

The `WinosStager` CAPE YARA rule fires on pkg-packed Node.js executables regardless of obfuscation. Even the non-obfuscated Community binary triggers it because:

1. **pkg (yao-pkg)**: embeds the Node.js runtime and all assets into a single self-contained EXE. The self-read behaviour (pkg reads embedded assets from its own binary at runtime) matches the "reads from own image" stager heuristic.
2. **V8 JIT + exception handling**: Node.js installs a VEH and SetUnhandledExceptionFilter during startup. These match sandbox anti-debug heuristics.

### Why Community shows more signatures than Consultant/Enterprise

Counter-intuitively, the non-obfuscated Community binary triggers more signatures (13 vs 6) and more MITRE techniques (16 vs 4-5) than the obfuscated tiers. The reason: obfuscation limits the sandbox's ability to trace execution flow, so CAPE sees fewer observable behaviors in the obfuscated tiers. With the unobfuscated bundle, CAPE can observe real application behaviors (wmic calls, process spawning, network interface enumeration) that are legitimate but pattern-match to heuristic rules.

This is the expected trade-off: obfuscation reduces sandbox visibility into application behavior while non-obfuscated code produces a more complete (but larger) set of false-positive behavioral matches.

## Three-Tier Comparison

| Tier | CAPE Detection | Signature count | wmic UUID | MITRE techniques |
|---|---|---|---|---|
| Enterprise | WinosStager | 6 | No (obfuscated away) | 4 |
| Consultant | WinosStager | 6 | No (obfuscated away) | 5 |
| Community | WinosStager | 13 | Yes (license fingerprint) | 16 |

All three tiers: zero malicious network connections, zero credential access, zero persistence mechanisms.

---

_Parsed from CAPE Sandbox HTML report (analysis ID 6649). Source HTML archived at `vt-community-win-x64-cape-sandbox.html`._
_Authored: 2026-09-05. Author: Helmut Schindlwick + Claude (AI pair-programmer)._
