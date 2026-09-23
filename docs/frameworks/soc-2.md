# SOC 2 -- Trust Services Criteria

**Framework ID:** `SOC_2` | **Authority:** AICPA | **Version:** 2017-revised (2022 update)

---

## When to use

SOC 2 is the standard attestation report for SaaS and cloud-hosted services targeting B2B enterprise buyers, particularly in the US market. Enable this framework if:

- Your customers (particularly US-based enterprise buyers) require a SOC 2 Type II report
- You operate a SaaS platform handling customer data in a cloud-hosted environment
- You need to align with trust service categories before commissioning a CPA audit

**Typical profiles:** SaaS companies, cloud-hosted B2B platforms, managed service providers, data processors.

---

## Controls summary

| Property | Value |
|---|---|
| Total controls | 64 |
| Trust Service Categories | CC (36, Security -- required), A (3, Availability), PI (5, Processing Integrity), C (2, Confidentiality), P (18, Privacy) |
| Assessment scope | `app`, `aud` |
| Scoring mode | Binary (compliant / non-compliant) |

The CC (Common Criteria) category is required for all SOC 2 reports. A, PI, C, and P categories are added based on applicable trust commitments. The P (Privacy) category requires manual audit scope and is not auto-assessed by SWAO signal passes.

---

## Cross-mapping

| Framework | Relationship |
|---|---|
| ISO 27001 | Bidirectional: CC6/CC7/CC8 map to ISO A.8 controls |
| BSI C5 | C5:2020 explicitly cross-maps to SOC 2 CC |
| GDPR | P category maps to GDPR Art. 5/6/7/13/32/33 |
| EUCS | EUCS Substantial/High overlaps CC6/CC7 |
| NIS2 | CC6.6/CC7/CC8 overlap with NIS2 Art. 21 |

---

## How to enable

Add the framework ID to your workspace `.swao.yml`:

```yaml
frameworks:
  - id: SOC_2
```

---

## Redistribution note

The AICPA Trust Services Criteria are publicly summarised at aicpa-cima.com. The full AT-C Section 205 guide is a paid AICPA publication. Control descriptions in this framework paraphrase the criteria intent; verbatim AICPA text is not reproduced. No warranty is provided; consult a licensed CPA or CISA for engagement-specific interpretation.
