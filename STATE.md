# SWAO Project State

**Current version:** v1.0.0
**Branch model:** GitHub Flow -- `main` only; sprint PRs squash-merge
**Active sprint:** sprint-133 (not yet opened)
**Last closed sprint:** sprint-132 (all artefacts done; v1.0.0 live on Accenture/SWAO 2026-09-05)
**Target release:** v1.0.1 (next patch; Authenticode signing + GRC report fixes)

---

## Go-live readiness checklist (v1.0.0)

### OSS hygiene

| # | Check | Status | Issue |
|---|---|---|---|
| H-01 | Internal Accenture refs removed from swao/ source | done | #2166 |
| H-02 | SPEC.md: internal references stripped | done | #2167 |
| H-03 | CONTRIBUTING.md: DCO block present, no internal reviewer refs | done | #2168 |
| H-04 | CODE_OF_CONDUCT.md: Contributor Covenant v2.1 | done | #2169 |
| H-05 | GitHub issue templates (bug, feature, provider driver, framework) | done | #2170 |
| H-06 | CODEOWNERS and Dependabot config | done | #2171 |
| H-07 | install.md runbook: correct binary names and checksums filename | done | #2172 |
| H-08 | CodeQL default-setup enabled on Accenture/SWAO (manual Helmut step) | done | #2173 |
| H-09 | STATE.md recreated with go-live tracking | done | #2175 |

### Release infrastructure

| # | Check | Status | Issue |
|---|---|---|---|
| R-01 | Binary-only public release: packages/ excluded, README explains source | done | #2139 |
| R-02 | SBOM + checksums mirrored to public release | done | #2148 |
| R-03 | hotfix-release.sh created | done | #2176 |
| R-04 | check-changelog-sync.sh created | done | #2177 |
| R-05 | cut-release.sh created | done | #2178 |
| R-06 | GH Actions secrets verified in Accenture/SWAO (manual Helmut step) | backlog | #2180 |
| R-07 | Authenticode signing plan documented | backlog | #2181 |

### Code fixes

| # | Check | Status | Issue |
|---|---|---|---|
| C-01 | swao llm command registered | open | #1558 |
| C-02 | assess --skip-llm: Pass 10 exit 255 | open | #2154 |
| C-03 | health-check community_count probe | open | #1564 |
| C-04 | Tier-absent commands show upgrade guidance | open | #1565 |
| C-05 | MainMenu item 7 coming-soon flag | open | #2022 |
| C-06 | LZ Catalogue Update in pkg binary | open | #2028 |

### Testing

| # | Check | Status |
|---|---|---|
| T-01 | Community tier E2E clean (fresh workspace) | pending Helmut |
| T-02 | Consultant tier E2E clean | pending Helmut |
| T-03 | Enterprise tier E2E clean | pending Helmut |
| T-04 | Bedrock gateway smoke (Community tier) | pending Helmut |
| T-05 | Docker Community image smoke | pending Helmut |
| T-06 | QA agents: zero open issues after full run | pending |

---

## Release cadence (post-1.0.0)

| Type | Script | Notes |
|---|---|---|
| Sprint release | `scripts/sprint-close.sh` then `scripts/cut-release.sh` | Standard path |
| Hotfix | `scripts/hotfix-release.sh` | Out-of-sprint patch |
| Pre-release (RC) | `git tag vX.Y.Z-rc.N && git push origin vX.Y.Z-rc.N` | Follow rc1-public-release-checklist.md |
| CHANGELOG gate | `scripts/check-changelog-sync.sh` | Runs in pre-commit + CI |
| Pre-push gate | `node scripts/dry-run-public-release.mjs` | 6 gates; must exit 0 |

---

## Known deferred items (not blocking v1.0.0-rc.1)

| Item | Target | Issue |
|---|---|---|
| Production website URL (steady-echo-yp4z.here.now placeholder) | v1.0.0-GA | #1486 |
| Authenticode code signing (EV/OV cert procurement) | v1.0.0-GA | #2181 |
| VirusTotal clean scan | After signing | #2182 |
| EVB-IT licence contract signing | Legal track | separate |
| Community source code on Accenture/SWAO | After OSS legal approval | #2139 |
