# SecNumCloud v3.2 -- SWAO Community Framework

**Framework ID:** `SECNUMCLOUD`
**Signal prefix:** `SECNUM`
**Authority:** ANSSI -- Agence nationale de la securite des systemes d'information (France)
**Version:** 3.2
**Catalogue version:** 1.0.0
**Last reviewed:** 2026-09-22

---

## Overview

SecNumCloud v3.2 is the French National Cybersecurity Agency (ANSSI) qualification framework
for cloud service providers handling sensitive data. It is the primary sovereign cloud
certification in the EU institutional ecosystem and the de facto reference model for data
sovereignty in French public sector cloud procurement.

As of July 2026, 9 providers hold SecNumCloud qualification, including OVHcloud, S3NS
(Thales-Google), Orange Business Services, and Outscale.

This SWAO community framework provides 61 controls across 19 chapters, covering the full
qualification scope from governance through to environmental management.

**Contributor:** SWAO Development Team (Accenture)

---

## Framework structure

| Chapter | Domain | Controls |
|---|---|---|
| 1 | Governance and Risk Management | 3 |
| 2 | Human Resources Security | 3 |
| 3 | Physical and Environmental Security | 3 |
| 4 | Asset Management and Lifecycle | 3 |
| 5 | Access Control and Authentication | 4 |
| 6 | Cryptography | 3 |
| 7 | Network Security and Filtering | 4 |
| 8 | Secure Development | 3 |
| 9 | Patch Management and Vulnerability Management | 3 |
| 10 | Incident Management | 3 |
| 11 | Business Continuity | 3 |
| 12 | Compliance and Legal Requirements | 2 |
| 13 | Audit and Logging | 4 |
| 14 | Cloud Configuration Management | 3 |
| 15 | Supply Chain and Third-Party Management | 3 |
| 16 | Reversibility and Portability | 3 |
| 17 | Data Sovereignty and Extraterritoriality | 3 |
| 18 | Transparency and Certification | 3 |
| 19 | Environmental and Energy Management | 3 |
| **Total** | | **61** |

---

## Assessment scope

| Scope | Meaning |
|---|---|
| `lz` | Landing-zone controls -- infrastructure configuration, network architecture, encryption |
| `aud` | Audit/evidence controls -- documentation, certification, governance posture |

This framework targets cloud service providers seeking SecNumCloud qualification, and
organisations assessing potential CSP partners for sovereign cloud workloads.

---

## Applicability hints

Enable this framework if your workload involves any of:

- `sovereign_cloud` -- cloud workloads requiring EU sovereign certification
- `french_public_sector` -- French government or public sector cloud services
- `eu_restricted_data` -- data classified at DR (Diffusion Restreinte) or equivalent sensitivity
- `cloud_service_provider` -- organisation delivering IaaS, PaaS, or SaaS cloud services
- `diffusion_restreinte` -- handling data at the French administrative sensitivity level

---

## Key differentiators from EUCS

SecNumCloud v3.2 is stricter than the EUCS High tier in three areas:

1. **Extraterritoriality immunity (Chapter 17):** The CSP must not be subject to non-EU laws
   (CLOUD Act, FISA 702). EUCS High tier dropped this requirement in the 2024 ECCG draft.
2. **Staff access restriction (Chapter 17):** Only EU-based personnel may access customer
   data without explicit approval. EUCS has no equivalent mandatory control.
3. **ANSSI audit by PASSI (Chapter 18):** Qualification requires an on-site audit by an
   ANSSI-accredited auditor (PASSI). EUCS operates through ENISA-accredited national bodies.

---

## Cross-mapping

| Target framework | Overlap areas |
|---|---|
| EUCS | Chapter 17 (sovereignty) is the key differentiator; Chapters 5-13 map closely to EUCS High tier |
| BSI_C5 | Chapter-level alignment with BSI C5 trust criteria (particularly physical security and supply chain) |
| ISO_27001 | All 19 chapters map to ISO 27001:2022 Annex A controls |
| GDPR | Chapter 17 addresses Art. 44-46 data transfer safeguards; Chapter 12 covers Art. 5 compliance |
| NIS2 | Chapter 10 (incident) and Chapter 11 (continuity) align with NIS2 Art. 21 security measures |

---

## How to enable in `.swao.yml`

```yaml
compliance:
  frameworks:
    - SECNUMCLOUD
```

For comprehensive EU sovereign cloud coverage, combine with EC CSF:

```yaml
compliance:
  frameworks:
    - SECNUMCLOUD
    - EC_CSF
    - GDPR
```

---

## Sources

- **French authoritative:** https://www.ssi.gouv.fr/entreprise/qualifications/prestataires-de-services-de-confiance/prestataires-de-service-informatique-en-nuage-secnumcloud/
- **English translation (v3.2.a, ITIF):** https://www2.itif.org/2021-secnumcloud-3.2.a-english-version.pdf
- **Qualified providers list:** https://www.ssi.gouv.fr/en/actualite/secnumcloud-list-of-qualified-providers/

---

## Redistribution note

SecNumCloud v3.2 is published by ANSSI under French sovereign authority. The English
translation (v3.2.a) is hosted by the Information Technology and Innovation Foundation
(ITIF). Control descriptions in this framework paraphrase the published requirements for
assessment purposes; they do not constitute legal advice. For authoritative interpretation,
consult ANSSI directly or an accredited SecNumCloud audit body (PASSI).

---

## References

- ANSSI SecNumCloud programme: https://www.ssi.gouv.fr/en/qualification/secnumcloud/
- SWAO issue: #0425
