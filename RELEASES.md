=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Release Notes

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# SWAO Releases

All stable releases of SWAO with binary download links and SHA-256 hashes.

For the full changelog see [CHANGELOG.md](CHANGELOG.md).

---

## v0.11.2 -- 2026-08-25

Release tag: [v0.11.2](https://github.com/Accenture/SWAO/releases/tag/v0.11.2)

**Highlights**

- LLM Assessment: stable (14 analysis passes, all assessment types unlocked)
- Three-tier licensing: Community (Apache 2.0), Consultant, Enterprise
- 11 community compliance frameworks: GDPR, AI 10 Pillars, BSI C5,
  BSI IT-Grundschutz 2023, HIPAA / NIST SP 800-66r2, LLM Selection,
  NCA CCC 2024 CSP, NCA CCC 2024 CST, NCA ECC 2024, PCI-DSS v4, SAMA CSF v1
- LLM-Gateway connector authoring (Design 090): any OpenAI-compatible endpoint
- MCP HTTP server for AI-assistant integration (Enterprise)
- TUI and CLI parity

**Downloads**

| Platform | Tier | File | SHA-256 |
|---|---|---|---|
| Windows 64-bit | Community | swao-community-win.exe | `4611bde20ea0d444672bef966c740507ca10b5e2cf4061a54fb0e8d9b0de2141` |
| Windows 64-bit | Consultant | swao-consultant-win.exe | `7f6c9b88908deeaa1362b5281551fb17fcc575feb430a504a82983d960ed25b9` |
| Windows 64-bit | Enterprise | swao-enterprise-win.exe | `7372a861ba5e37eee8a48b73e51a7504d735e3139ba0b206efadcc2b7b8016e8` |
| Linux 64-bit | Enterprise | swao-linux-x64 | `4f68e6ef29afa98dd3dd6b4bbc3fa39069b051e7b1fd3845aa87cabb42ef9c36` |
| macOS Intel | Enterprise | swao-darwin-x64 | `269e563508b7b04961ac866064068b57d3058b5aad00aa67687ab9f7c298d6d5` |
| macOS Apple Silicon | Enterprise | swao-darwin-arm64 | `175f9455a2ea25b537b6e3274552deae74096e1e53aae4e799bc294d648c5167` |

**Verifying a download**

Linux / macOS:

```bash
sha256sum swao-enterprise-win.exe
# or
shasum -a 256 swao-darwin-arm64
```

Windows:

```powershell
certutil -hashfile swao-enterprise-win.exe SHA256
```

Compare the output against the hash in the table above. The `SHA256SUMS` file
in `dist-bin/` contains all hashes in machine-readable format for scripted
verification.

---

## v0.11.1 -- 2026-08-24

Patch release: E2E QA fixes, LLM Assessment reliability improvements,
CodeQL and BlackDuck security remediations.

Release tag: [v0.11.1](https://github.com/Accenture/SWAO/releases/tag/v0.11.1)

---

## v0.11.0 -- 2026-08-19

Major release: three-tier licensing model, LLM Assessment (all passes),
Stakeholder Challenge Agents, Custom LZ Catalogue, multi-CSP comparison,
and 19 additional assessment improvements.

Release tag: [v0.11.0](https://github.com/Accenture/SWAO/releases/tag/v0.11.0)

---

For older releases see the [GitHub Releases page](https://github.com/Accenture/SWAO/releases).
