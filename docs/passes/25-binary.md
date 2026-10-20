# Pass 25: Static Binary Analysis (BINARY)

| Property | Value |
|---|---|
| Pass number | 25 |
| Key | Runs automatically (not selected through `--passes`) |
| Signal prefix | `BIN` (signal codes `BINARY.*`) |
| Type | Deterministic, offline static file analysis (nothing is executed) |
| Default | On for service apps: runs before the pass loop of `swao assess` and before VirusTotal in `swao service research`; does nothing when no binaries are supplied |
| Assessment types | `service` (Service Portfolio Assessment) |
| Tier | All tiers (`service-assessment` is a Community feature) |
| Source | `packages/@swao/module-service-assessment/src/binary/`, signal catalogue `packages/@swao/core/src/binary-signals.ts` |

## What it is for

For off-the-shelf software you often have the installer but not the source code. Pass 25 answers the question: "What can we tell about this software from its files alone: is it signed, is the signature still valid, does it depend on an out-of-support runtime, and is it 32-bit only?"

These facts matter for migration planning (legacy runtimes and 32-bit binaries limit the target platforms) and for security (unsigned or invalidly signed executables). The pass also provides the installer hash used by the VirusTotal lookup in [Pass 24 RESEARCH](/passes/24-research) and the certificate data used by Pass 08 CRYPTO in service mode.

## What you need to provide

| Input | Where | Notes |
|---|---|---|
| Installers and executables | Every file in `apps/<id>/ingestion/binary/` and `apps/<id>/wsp/inputs/binary/`, plus installer and package files anywhere else in `apps/<id>/ingestion/` (`.exe`, `.dll`, `.sys`, `.msi`, `.msp`, `.msix`, `.appx`, `.jar`, `.war`, `.ear`, `.so`, `.dylib`, `.cab`, `.pkg`, `.dmg`, `.deb`, `.rpm`); subfolders included | PE files (`.exe`, `.dll` and similar) and MSI packages are analysed; other installer formats are listed as unsupported (see below), all remaining files are ignored |
| Installed program folder (optional) | `binary.local_install_path` in the app `.swao.yml`, plus environment variable `SWAO_LOCAL_BINARY_SCAN=true` | Scans an existing installation read-only. Both settings are required. |

```yaml
# apps/hosapp200/.swao.yml (optional local scan)
binary:
  local_install_path: "C:/Program Files/ExampleVendor/HosApp"
```

## How it works

1. **Collect files.** Walk `ingestion/binary/` (every file), the rest of `ingestion/` (installer and package extensions only), `wsp/inputs/binary/` and, if enabled, the local install path, up to 500 files. No hint folder is needed: `swao service init` creates only `ingestion/`. Files that SWAO itself writes there (`binary-analysis.json`, `manifest.json`) are skipped.
2. **Recognise the format.** Each file is opened with a bounded reader: every read is checked against the file size and files are never loaded whole. A file is analysed as PE if it has a valid PE header, otherwise as MSI if it is an OLE compound file with an MSI property table. Files that are neither but carry an installer or package extension that Pass 25 does not parse (`.msix`, `.msixbundle`, `.appx`, `.appxbundle`, `.jar`, `.war`, `.ear`, `.so`, `.bin`, `.deb`, `.rpm`, `.dmg`, `.pkg`) are listed in `unsupported_files` with their format, so the gap is visible. All other files are ignored.
3. **PE analysis.** Reads the machine type (x86, x64, arm64, arm), PE32 or PE32+, the compile timestamp, imported DLLs, the Visual C++ runtime vintage from the CRT import (for example `msvcr100.dll` means 2010), and for .NET assemblies the metadata version, the target framework and whether the assembly is AnyCPU.
4. **Authenticode.** If a signature is embedded, the PKCS#7 structure is walked to find the signer certificate (subject, issuer, validity) and to detect a timestamp (legacy countersignature or RFC 3161). The signature is not cryptographically verified.
5. **MSI analysis.** Reads the `Property` table without running `msiexec`: product name, version, manufacturer, product code and install directory.
6. **Hashing.** A SHA256 hash is computed in 1 MB chunks. If a file's size and modification time are unchanged since the previous run, the stored hash is reused.
7. **Derive signals** (see below) and write the results.

Malformed structures are recorded as `parse_error` for the file and never stop the pass; unreadable files are skipped.

## How it is measured

| Signal | Code | Rule | Severity |
|---|---|---|---|
| `BIN-01` | `BINARY.UNSIGNED` | PE files without an embedded Authenticode signature | medium |
| `BIN-02` | `BINARY.EXPIRED_CERT` | PE files whose signer certificate has expired. One signal per run covers both cases and lists them separately: without a timestamp the signature is no longer valid; with a timestamp it remains valid | high if at least one affected file has no timestamp, otherwise informational |
| `BIN-03` | `BINARY.LEGACY_RUNTIME` | .NET Framework target below 4.6.2, or .NET metadata version below 4 (2.0 to 3.5) without a target framework, or a Visual C++ runtime older than 2015 | high |
| `BIN-04` | `BINARY.LEGACY_ARCH` | 32-bit x86 executables that are not AnyCPU | low |
| `BIN-05` | `BINARY.COMPILATION_DATE_ANOMALY` | PE timestamp more than one day in the future (often a reproducible-build value, occasionally tampering) | low (confidence low) |

Only PE files that parsed without error are evaluated. Each signal aggregates all affected files and lists up to 20 file paths as evidence; file contents are never copied. Every signal appears at most once per run. Informational signals carry the outcome `neutral`, all others `negative`.

Note that system files signed through a Windows catalogue rather than an embedded signature also appear as unsigned to static analysis.

### How the results are used

- **Pass 08 CRYPTO (service mode)** reports expired, untimestamped signer certificates as a high-severity finding.
- **APM scoring** sets the rule `binary_runtime_current` to 20 when `BINARY.LEGACY_RUNTIME` is present and to 100 otherwise (no score when no binaries were analysed).
- **Pass 24 RESEARCH** looks up the first SHA256 on VirusTotal.
- **Pass 11 COMP** reads `binary-signals.json` as evidence alongside the signals of the run.
- The portfolio exports include the binary signals.

## Third-party modules, tools and external services

| Name | Purpose | Licence | Bundled or optional | When missing or offline |
|---|---|---|---|---|
| Node.js `crypto` (`X509Certificate`, SHA256) | Certificate parsing and hashing | Node.js (MIT) | Built in | - |
| SWAO PE, Authenticode and MSI readers | Format parsing | SWAO | Bundled | - |
| `js-yaml`, `zod` | Read `.swao.yml`, validate the signal file | MIT | Bundled | - |

No external tools, no network access and no execution of the analysed files.

## Outputs

| File | Content |
|---|---|
| `apps/<id>/wsp/inputs/binary/binary-analysis.json` | `generated_at`, `app_id`, one entry per recognised file (path, SHA256, size, kind, PE or MSI details, certificates), `unsupported_files` (path and format of each installer that was found but not parsed), `skipped_reason: no_binary_inputs` when nothing was found, `msi_skipped_reason: no_msi_inputs` when no MSI was found, and the `local_scan` settings |
| `apps/<id>/wsp/signals/binary-signals.json` | The `BIN-NN` signals |

File paths are relative to the app folder; files from the local install path are prefixed with `local:`. The signals are kept in this separate file and are not part of the run's `passes/` folder; Pass 11 COMP reads them from there.

## Configuration and limitations

| Setting | Effect |
|---|---|
| Installers anywhere in `ingestion/`, files in `ingestion/binary/` or `wsp/inputs/binary/` | Inputs |
| `binary.local_install_path` plus `SWAO_LOCAL_BINARY_SCAN=true` | Adds a live installed folder (read-only) |

Known limitations:

- Only PE and MSI files are parsed. MSIX and APPX packages, JAR files, Linux binaries and other package formats are not analysed by this pass; they are listed in `unsupported_files`. MSIX, APPX, JAR and `.so` files (and `.bin` files under `ingestion/binary/`) still count as binary inputs for the service pass plan, so [Pass 14 MALWARE](/passes/14-malware) scans them (for example with ClamAV) when it is requested.
- Authenticode signatures are read but not verified; a tampered file with an intact-looking signature block is not detected.
- At most 500 files per app are analysed.
- The runtime rules cover .NET Framework and the Visual C++ runtime only.

See also [Service Portfolio Assessment](/service-assessment/) and [Malware scanning](/malware-scanning) (Pass 14 can scan the same binaries).
