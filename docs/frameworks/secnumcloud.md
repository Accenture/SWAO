# SecNumCloud v3.2 -- ANSSI Sovereign Cloud Certification

**Framework ID:** `SECNUMCLOUD` | **Authority:** ANSSI (Agence nationale de la securite des systemes d'information, France) | **Version:** 3.2

---

## When to use

SecNumCloud is the ANSSI qualification framework for cloud service providers handling sensitive French and EU institutional data. Enable this framework if:

- Your organisation seeks or maintains SecNumCloud qualification for cloud services offered to French government, defence, or critical infrastructure customers
- Your cloud landing zone handles data classified at Diffusion Restreinte (DR) or equivalent EU sensitivity levels
- You need to map your infrastructure posture against the sovereign cloud requirements that underpin the EUCS High tier
- You are assessing a cloud provider against French public sector procurement requirements

**Qualified providers (as of July 2026):** OVHcloud, S3NS (Thales/Google), Orange Business, Outscale (Dassault), and 5 others.

**Typical profiles:** IaaS/PaaS cloud providers targeting French government, EU institutions, or EU-regulated sectors with sovereignty requirements.

---

## Controls summary

| Property | Value |
|---|---|
| Total controls | 65 |
| Chapters | 19 chapters: governance (CH01-CH03), physical security (CH04), access control (CH05), cryptography (CH06), network (CH07-CH08), operations (CH09-CH11), supply chain (CH14), compliance (CH12), data sovereignty (CH17), reversibility (CH18-CH19), and others |
| Assessment scope | `lz`, `aud` |
| Scoring mode | Binary (compliant / non-compliant) |

Assessment scope is landing zone (`lz`) and audit/governance (`aud`) -- SecNumCloud assesses the cloud infrastructure and provider governance posture, not application-layer code.

---

## Cross-mapping

| Framework | Relationship |
|---|---|
| EUCS | SecNumCloud is the primary reference for EUCS High tier data sovereignty requirements |
| BSI C5 | Chapter-level alignment with BSI C5 trust criteria |
| ISO 27001 | ISO 27001 Annex A controls map across all 19 chapters |
| GDPR | Chapters 17 (sovereignty) and 12 (compliance) directly address GDPR Art. 44-46 |
| NIS2 | Chapters 10 (incident) and 11 (continuity) align with NIS2 Art. 21 |

---

## How to enable

Add the framework ID to your workspace `.swao.yml`:

```yaml
frameworks:
  - id: SECNUMCLOUD
```

---

## Redistribution note

SecNumCloud v3.2 is published by ANSSI under French sovereign authority. Control descriptions in this framework paraphrase the published requirements for assessment purposes; they do not constitute legal advice. For authoritative interpretation, consult ANSSI directly or an accredited SecNumCloud audit body (PASSI).
