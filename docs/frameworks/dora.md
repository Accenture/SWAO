# DORA -- Digital Operational Resilience Act

**Framework ID:** `DORA` | **Authority:** European Union (Regulation EU 2022/2554) | **Version:** 2025-01-17

---

## When to use

DORA applies to financial entities operating in the EU. It became mandatory on 17 January 2025. Enable this framework if:

- Your organisation is a bank, insurer, investment firm, payment institution, or crypto-asset service provider operating in the EU
- You are an ICT third-party provider (TPP) to EU financial entities and need to demonstrate ICT risk alignment
- You need to map ICT resilience controls for a DORA readiness or gap assessment

**Typical profiles:** EU banks, insurers, payment institutions, trading platforms, central counterparties, ICT TPPs.

---

## Controls summary

| Property | Value |
|---|---|
| Total controls | 31 |
| Pillars | ICT-RM (18, Art. 5-14), INCIDENT (4, Art. 15-19), DORT (3, Art. 24-26), TPP (5, Art. 28-31), SHARING (1, Art. 45) |
| Assessment scope | `app`, `aud` |
| Scoring mode | Binary (compliant / non-compliant) |

Controls scoped to `aud` require manual audit evidence or regulatory submission; SWAO signals can surface indicators but cannot auto-resolve these controls.

---

## Cross-mapping

| Framework | Relationship |
|---|---|
| ISO 27001 | Extensive overlap -- Art. 5-14 maps to A.5/A.8 themes |
| NIS2 | NIS2 Art. 21 essential entity requirements parallel DORA Pillars 1-2 |
| BSI C5 | OPS/AVL/INM domains overlap DORA Pillars 1-2 |
| SOC 2 | CC6/CC7/CC8 overlap DORA Art. 7-10 |
| GDPR | Art. 32 technical measures; Art. 33-34 breach notification |

---

## How to enable

Add the framework ID to your workspace `.swao.yml`:

```yaml
frameworks:
  - id: DORA
```
