# EC Cloud Sovereignty Framework v1.2.1 -- SWAO Community Framework

**Framework ID:** `EC_CSF`
**Signal prefix:** `ECCSF`
**Authority:** European Commission -- Directorate-General for Informatics (DIGIT)
**Version:** 1.2.1
**Catalogue version:** 1.0.0
**Last reviewed:** 2026-09-22

---

## Overview

The EC Cloud Sovereignty Framework (CSF) v1.2.1 was published by the European Commission
in October 2025 as a procurement and assessment instrument for EU institutional cloud services.
It defines 8 Sovereignty Objectives (SOV domains) scored via a 5-level maturity system
(SEAL-0 to SEAL-4 -- Sovereignty Effectiveness Assurance Level). The framework was used in
the EUR 180M EU institutional cloud procurement awarded in April 2026.

This SWAO community framework provides 40 controls across all 8 SOV domains, with severity
mapped from SEAL level requirements.

**Contributor:** SWAO Development Team (Accenture)

---

## SEAL maturity levels

| SEAL | Level | Meaning |
|---|---|---|
| SEAL-0 | Absent | No sovereignty controls in place |
| SEAL-1 | Initial | Ad-hoc controls; not systematically managed |
| SEAL-2 | Managed | Controls documented and consistently applied |
| SEAL-3 | Defined | Controls audited; continuous improvement in place |
| SEAL-4 | Optimised | Fully automated; independently verified; demonstrably sovereign |

SWAO severity mapping: SEAL-3/4 requirements -> `high`; SEAL-1/2 -> `medium`.

---

## Framework structure

| Domain | Description | Controls |
|---|---|---|
| SOV-1 | Strategic Sovereignty | 4 |
| SOV-2 | Legal Sovereignty | 4 |
| SOV-3 | Data Sovereignty | 5 |
| SOV-4 | Operational Sovereignty | 4 |
| SOV-5 | Supply Chain Sovereignty | 4 |
| SOV-6 | Technology Sovereignty | 4 |
| SOV-7 | Security Sovereignty | 5 |
| SOV-8 | Environmental Sovereignty | 4 |
| **Total** | | **40** |

---

## Assessment scope

| Scope | Meaning |
|---|---|
| `lz` | Landing-zone controls -- infrastructure architecture, encryption, residency enforcement |
| `aud` | Audit/evidence controls -- documentation, certifications, governance posture |

---

## Applicability hints

Enable this framework if your workload involves any of:

- `sovereign_cloud` -- cloud workloads requiring EU sovereignty assurance
- `eu_institutional` -- services procured for EU institutions or member state governments
- `cloud_service_provider` -- organisations delivering IaaS, PaaS, or SaaS to EU public sector
- `eu_procurement` -- participation in EU framework agreements or public tenders
- `digital_sovereignty` -- digital sovereignty strategy assessments

---

## Relationship to SecNumCloud

EC CSF and SecNumCloud v3.2 are complementary frameworks used together in EU sovereign cloud
assessment:

| Aspect | EC CSF | SecNumCloud v3.2 |
|---|---|---|
| Authority | European Commission | ANSSI (France) |
| Focus | Maturity-based sovereignty objectives | Mandatory qualification requirements |
| Scope | [lz, aud] | [lz, aud] |
| Maturity model | SEAL-0 to SEAL-4 | Pass/fail per chapter |
| Legal jurisdiction | All EU member states | France + EU equivalents |
| Certification body | EU institutional procurement | ANSSI via PASSI auditors |

Together they form the primary assessment model for EU institutional sovereign cloud.

---

## Cross-mapping

| Target framework | Overlap areas |
|---|---|
| SECNUMCLOUD | SOV-2 legal = SecNumCloud Chapter 17 extraterritoriality; SOV-3 data = Chapter 6 encryption |
| EUCS | SOV-7 security maps to EUCS High tier security controls |
| ISO_27001 | SOV-7 security and SOV-3 data align with ISO 27001:2022 Annex A |
| GDPR | SOV-2 legal and SOV-3 data directly address GDPR Art. 44-46 and Art. 32 |
| NIS2 | SOV-7 security aligns with NIS2 Art. 21 security measures |

---

## How to enable in `.swao.yml`

```yaml
compliance:
  frameworks:
    - EC_CSF
```

For comprehensive EU sovereign cloud assessment, combine with SecNumCloud:

```yaml
compliance:
  frameworks:
    - EC_CSF
    - SECNUMCLOUD
    - GDPR
```

---

## Redistribution note

The EC Cloud Sovereignty Framework v1.2.1 is published by the European Commission and
available under the Commission's reuse policy for EU institutional publications. Control
descriptions paraphrase the framework's sovereignty objectives for assessment purposes;
they do not constitute legal advice or procurement guidance. For authoritative interpretation,
consult the European Commission DIGIT or an accredited CSF assessor.

---

## References

- EC CSF PDF: https://commission.europa.eu/document/download/09579818-64a6-4dd5-9577-446ab6219113_en
- EC announcement: https://commission.europa.eu/news-and-media/news/sovereign-cloud-framework-explained-2026-06-01_en
- Companion framework: #0425 SecNumCloud v3.2
- SWAO issue: #2847
