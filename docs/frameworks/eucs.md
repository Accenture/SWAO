# EUCS -- EU Cloud Security Certification Scheme

**Framework ID:** `EUCS` | **Authority:** European Union Agency for Cybersecurity (ENISA) | **Version:** candidate-2024

---

## When to use

EUCS is the EU-wide cloud security certification scheme under the EU Cybersecurity Act (Regulation EU 2019/881). Enable this framework if:

- You are a cloud service provider (IaaS, PaaS, SaaS) offering services to EU customers or authorities
- Your customers operate in regulated EU sectors and require a certified cloud environment
- You are mapping your security posture against EUCS Basic, Substantial, or High assurance levels
- You pursue SecNumCloud qualification or want to understand the relationship between both schemes

**Note:** EUCS is currently a candidate scheme (not yet a formal regulation). Final adoption expected via the European Commission.

**Typical profiles:** IaaS/PaaS/SaaS providers targeting EU government, defence, health, financial, or critical infrastructure customers.

---

## Controls summary

| Property | Value |
|---|---|
| Total controls | 66 |
| Domains | 12 domains (GRC, HRS, IVM, LGO, OPS, CRY, IAM, NWS, DMS, PSY, DEV, DCS) |
| Assurance levels | Basic, Substantial, High (each control tagged with minimum required level) |
| Assessment scope | `lz`, `aud` |
| Scoring mode | Binary (compliant / non-compliant) |

EUCS controls are partitioned by assurance level -- a control tagged `eucs:substantial` is required at Substantial and High but not Basic. The `multi_domain_axes: true` flag on this framework reflects this intentional per-level assignment.

---

## Cross-mapping

| Framework | Relationship |
|---|---|
| SecNumCloud | SecNumCloud is the primary reference for EUCS High tier data sovereignty |
| ISO 27001 | EUCS Substantial/High baseline references ISO 27001:2022 |
| BSI C5 | EUCS aligns with BSI C5:2020 trust criteria |
| NIS2 | Digital infrastructure essential entities may face concurrent NIS2 + EUCS obligations |
| GDPR | EUCS CRY/DMS controls support GDPR Art. 32 technical measures |

---

## How to enable

Add the framework ID to your workspace `.swao.yml`:

```yaml
frameworks:
  - id: EUCS
```
