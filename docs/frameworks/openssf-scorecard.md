# OpenSSF Security Scorecard

**Framework ID:** `OPENSSF_SCORECARD` | **Authority:** Open Source Security Foundation (OpenSSF) -- Linux Foundation | **Version:** v4.13 / v5.0-rc (2024)

---

## When to use

OpenSSF Scorecard is an automated security scoring tool for open-source projects and their dependencies. Enable this framework if:

- Your application depends on open-source packages and you want to assess OSS supply-chain risk
- You maintain an open-source or inner-source project and need a security posture benchmark
- You need to evidence software supply chain security for NIS2 SCM, EU CRA, or NIST SSDF compliance
- You want to apply the same checks SWAO uses to assess its own public repository

**Typical profiles:** OSS project maintainers, platform engineering teams managing OSS dependencies, DevSecOps teams, organisations using CNCF or Linux Foundation projects.

---

## Controls summary

| Property | Value |
|---|---|
| Total controls | 17 |
| Domains | Code and Repository Integrity (OSS-INT, 5), Vulnerability Management (OSS-VLN, 3), Supply Chain Security (OSS-SCH, 4), Operational Security (OSS-OPS, 3), Community Health (OSS-CMH, 2) |
| Assessment scope | `app`, `aud` |
| Scoring mode | Weighted (0-10 per check; published check weights) |

Scorecard results for public GitHub repositories are queryable via the public API at `api.securityscorecards.dev`. SWAO's own public repository targets a score of 8+.

---

## Cross-mapping

| Framework | Relationship |
|---|---|
| EU CRA | CRA Annex I Part II vulnerability handling + binary artefact controls align with OSS-VLN |
| NIS2 | NIS2 SCM (supply chain) + VHR (vulnerability) management overlap |
| ISO 27001 | ISO A.8.28 (secure coding), A.8.8 (vulnerability management), A.5.19 (supply chain) |
| GDPR | Dependency hygiene indirectly supports GDPR Art. 32 technical measures |

---

## How to enable

Add the framework ID to your workspace `.swao.yml`:

```yaml
frameworks:
  - id: OPENSSF_SCORECARD
```
