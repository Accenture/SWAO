```
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Releases
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
```

# SWAO Releases

Binary downloads, SHA-256 checksums, and SBOM for every stable release.

For full release notes see [CHANGELOG.md](CHANGELOG.md).
For the complete release history see the [GitHub Releases page](https://github.com/Accenture/SWAO/releases).

---

## v1.0.0 -- 2026-09-04

First public stable release -- Community Edition.

Release page: [github.com/Accenture/SWAO/releases/tag/v1.0.0](https://github.com/Accenture/SWAO/releases/tag/v1.0.0)

**Community Edition downloads** (Apache-2.0, no licence key required)

| Platform | File | SHA-256 |
|---|---|---|
| Windows 64-bit | `swao-community-win-x64.exe` | See `SHA256SUMS` on the release page |
| Linux 64-bit | `swao-community-linux-x64` | See `SHA256SUMS` on the release page |
| macOS Intel | `swao-community-macos-x64` | See `SHA256SUMS` on the release page |
| macOS Apple Silicon | `swao-community-macos-arm64` | See `SHA256SUMS` on the release page |

Consultant and Enterprise Edition binaries are available through Accenture.

**Verifying a download**

Linux / macOS:
```bash
sha256sum swao-community-linux-x64
# compare against SHA256SUMS on the release page
```

Windows:
```powershell
certutil -hashfile swao-community-win-x64.exe SHA256
```

**SBOM**

A CycloneDX SBOM (`swao-v1.0.0-community-sbom.cdx.json`) is attached to the
release page. Verify using any CycloneDX-compatible tool.

---

For older releases see the [GitHub Releases page](https://github.com/Accenture/SWAO/releases).
