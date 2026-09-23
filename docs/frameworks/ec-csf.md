# EC Cloud Sovereignty Framework v1.2.1

**Framework ID:** `EC_CSF` | **Authority:** European Commission -- Directorate-General for Informatics (DIGIT) | **Version:** 1.2.1

---

## When to use

The EC Cloud Sovereignty Framework (CSF) defines sovereignty objectives for cloud services procured by EU institutions. It was used in the EUR 180 million EU institutional cloud procurement awarded in April 2026. Enable this framework if:

- You are a cloud provider bidding for EU institutional or public sector procurement
- Your organisation needs to assess cloud sovereignty posture across strategic, legal, and operational dimensions
- You want to map your landing zone against the SEAL maturity model (SEAL-0 to SEAL-4) to demonstrate sovereignty effectiveness
- You are deploying a sovereign cloud architecture and need to align with both EC CSF and SecNumCloud

**Typical profiles:** EU-institutional cloud providers, digital sovereignty programme leads, cloud architects designing sovereign landing zones, procurement assessors for public sector cloud.

---

## Controls summary

| Property | Value |
|---|---|
| Total controls | 40 |
| SOV domains | Strategic (SOV-1), Legal (SOV-2), Data (SOV-3), Operational (SOV-4), Supply Chain (SOV-5), Technology (SOV-6), Security (SOV-7), Environmental (SOV-8) |
| Maturity levels | SEAL-0 (none) to SEAL-4 (full sovereignty effectiveness assurance) |
| Assessment scope | `lz`, `aud` |
| Scoring mode | Binary (compliant / non-compliant) |

The SEAL maturity system allows incremental sovereignty improvement across the 8 domains. SOV-7 (Security) and SOV-2 (Legal) are typically the most demanding domains in EU institutional procurement.

---

## Cross-mapping

| Framework | Relationship |
|---|---|
| SecNumCloud | SOV-2 (legal) = SecNumCloud extraterritoriality; SOV-3 (data) = SecNumCloud data protection |
| EUCS | SOV-7 (security) maps to EUCS High tier security controls |
| ISO 27001 | SOV-7 and SOV-3 domains align with ISO 27001 Annex A |
| GDPR | SOV-2 (legal) and SOV-3 (data) directly address GDPR Art. 44-46 and Art. 32 |
| NIS2 | SOV-7 (security) aligns with NIS2 Art. 21 security measures |

---

## How to enable

Add the framework ID to your workspace `.swao.yml`:

```yaml
frameworks:
  - id: EC_CSF
```

---

## Redistribution note

The EC Cloud Sovereignty Framework v1.2.1 is published by the European Commission under the Commission's reuse policy for EU institutional publications. Control descriptions paraphrase the framework's sovereignty objectives for assessment purposes; they do not constitute legal advice or procurement guidance. For authoritative interpretation, consult the European Commission DIGIT or an accredited CSF assessor.
