```
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     VirusTotal Baseline -- v1.0.0
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
```

# SWAO v1.0.0 VirusTotal Baseline

**Date:** 2026-09-04
**Version:** v1.0.0
**Release manager:** SWAO Development Team
**Build method:** `@yao-pkg/pkg` -- `node20-*` targets
**Signing status:** Unsigned (Authenticode signing planned for v1.1.0 -- see #2701)

> Raw VT JSON reports are stored in `docs/releases/v1.0.0/vt-reports/` (private repo only).
> This summary is published publicly at `Accenture/SWAO`.
> Run `node scripts/build-vt-baseline.mjs` to regenerate this table from the JSON reports.

---

## Community Edition binaries (publicly submitted)

Only Community Edition binaries are submitted to VirusTotal for public baseline
purposes. Consultant and Enterprise binaries are scanned internally but not published.

| Binary | Platform | SHA-256 | Engines | Detections | VT permalink |
|---|---|---|---|---|---|
| swao-community-win-x64.exe | Windows x64 | TBD | TBD | TBD | TBD |
| swao-community-linux-x64 | Linux x64 | TBD | TBD | TBD | TBD |
| swao-community-macos-x64 | macOS Intel | TBD | TBD | TBD | TBD |
| swao-community-macos-arm64 | macOS Apple Silicon | TBD | TBD | TBD | TBD |

## Consultant Edition binaries (internal scan only)

| Binary | Platform | SHA-256 | Engines | Detections | VT permalink |
|---|---|---|---|---|---|
| swao-consultant-win-x64.exe | Windows x64 | TBD | TBD | TBD | TBD |
| swao-consultant-linux-x64 | Linux x64 | TBD | TBD | TBD | TBD |
| swao-consultant-macos-x64 | macOS Intel | TBD | TBD | TBD | TBD |
| swao-consultant-macos-arm64 | macOS Apple Silicon | TBD | TBD | TBD | TBD |

## Enterprise Edition binaries (internal scan only)

| Binary | Platform | SHA-256 | Engines | Detections | VT permalink |
|---|---|---|---|---|---|
| swao-enterprise-win-x64.exe | Windows x64 | TBD | TBD | TBD | TBD |
| swao-enterprise-linux-x64 | Linux x64 | TBD | TBD | TBD | TBD |
| swao-enterprise-macos-x64 | macOS Intel | TBD | TBD | TBD | TBD |
| swao-enterprise-macos-arm64 | macOS Apple Silicon | TBD | TBD | TBD | TBD |

---

## Expected false-positive context

SWAO binaries are built with `@yao-pkg/pkg`. Unsigned PE executables and Node.js
SEA-style binaries consistently produce heuristic detections on ML-based AV engines.
The following categories are expected false positives:

| Category | Root cause |
|---|---|
| ML heuristic (unsigned PE) | No Authenticode signature; planned for v1.1.0 |
| Self-extraction heuristic | pkg bundles Node.js runtime; not a dropper |
| System info discovery | Licence fingerprint reads hostname + Windows version from registry |
| Application layer protocol | LLM provider URLs are string literals -- no live traffic at scan time |

Any detection beyond these categories warrants investigation before release.

---

## Sandbox behaviour (CAPE / any.run)

If a sandbox behavioural analysis is run, record findings here. Reference:
`docs/releases/v1.0.0-vt-baseline.md` (SEA binary analysis from sprint-074) for
the MITRE ATT&CK false-positive breakdown and expected process tree.

---

## SHA-256 checksums

SHA-256 checksums for all release binaries are published in `dist-bin/SHA256SUMS`
and attached to the GitHub Release at `https://github.com/Accenture/SWAO/releases/tag/v1.0.0`.

---

## References

- RC-1 checklist: `docs/releases/rc1-public-release-checklist.md`
- Prior SEA binary analysis: `docs/releases/v1.0.0-vt-baseline.md`
- Design: `docs/design/047-malware-scanning-binary-security-and-assessment-pass.md`
- Security scan results: `docs/security/scan-results/v1.0.0-2026-09-04/scan-summary.md`
