# KRITIS-DE -- German Critical Infrastructure IT Security

**Framework ID:** `KRITIS_DE` | **Authority:** BSI (Federal Office for Information Security) | **Version:** 2024

---

## When to use

KRITIS-DE covers IT security obligations for German critical infrastructure operators under BSIG Section 8a and the KRITIS-DachG (2023). Enable this framework if:

- Your organisation operates critical infrastructure in Germany (energy, water, health, transport, finance, ICT, or space sectors)
- You are a digital infrastructure provider meeting the KRITIS threshold (BSI-KritisV sector annexes)
- You need to prepare for a §8a audit by a BSI-approved auditor (proof of measures -- "Nachweis")

**Typical profiles:** German energy grid operators, water utilities, hospital networks, payment system operators, major cloud/colocation providers above the KRITIS threshold.

---

## Controls summary

| Property | Value |
|---|---|
| Total controls | 40 |
| Domains | Governance (KRIT-GOV, 6), Asset Inventory (KRIT-AST, 5), Incident Detection and Reporting (KRIT-INC, 6), Access Control (KRIT-IDM, 5), Resilience and Continuity (KRIT-BCM, 7), Supply Chain (KRIT-SCM, 5), Sector-Specific (KRIT-SEC, 6) |
| Assessment scope | `app`, `aud` |
| Scoring mode | Binary (compliant / non-compliant) |

Controls in KRIT-INC (incident reporting) and KRIT-SEC (sector authority requirements) include `aud`-scoped items requiring BSI-certified auditor sign-off.

---

## Cross-mapping

| Framework | Relationship |
|---|---|
| BSI C5 | Cloud-hosted KRITIS systems require C5 Type 2 attestation |
| BSI IT-Grundschutz 2023 | ISMS methodology baseline for KRITIS operators |
| ISO 27001 | BNetzA IT-Sicherheitskatalog mandates ISO 27001 for energy/water |
| DORA | Finance + ICT sectors have dual KRITIS + DORA obligation |
| NIS2 | NIS2 Art. 21 essential entity requirements overlap KRITIS §8a |

---

## How to enable

Add the framework ID to your workspace `.swao.yml`:

```yaml
frameworks:
  - id: KRITIS_DE
```
