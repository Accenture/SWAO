# NIS2 -- Network and Information Security Directive 2

**Framework ID:** `NIS2` | **Authority:** European Union (Directive 2022/2555) | **Version:** 2022-12-27

---

## When to use

NIS2 replaced NIS1 with a wider scope and stricter enforcement regime, with transposition deadline 17 October 2024 in EU member states. Enable this framework if:

- Your organisation is classified as an Essential Entity (EE) or Important Entity (IE) under NIS2 in any of the 18 regulated sectors
- You operate digital infrastructure, ICT managed services, or cloud infrastructure in the EU
- You need to map against NIS2 Art. 21 (ten minimum security measures) and Art. 23 (incident reporting)

**Sectors covered:** energy, transport, banking, financial market infrastructure, health, drinking water, wastewater, digital infrastructure, ICT service management (MSPs), public administration, space, and eight additional "important entity" sectors.

**Typical profiles:** EU utilities, hospitals, banks, large cloud providers, managed service providers (MSPs), DNS providers, public administration.

---

## Controls summary

| Property | Value |
|---|---|
| Total controls | 46 |
| Domains | 10 domains mapping NIS2 Art. 20 (governance) and Art. 21 (security measures) |
| Assessment scope | `app`, `aud` |
| Scoring mode | Binary (compliant / non-compliant) |

Incident reporting controls (Art. 23) follow a three-tier timeline: 24h early warning, 72h notification, 1-month final report. These are `aud`-scoped and require verified evidence.

---

## Cross-mapping

| Framework | Relationship |
|---|---|
| ISO 27001 | NIS2 Art. 21 measures align extensively with ISO 27001:2022 |
| DORA | Financial sector essential entities have dual NIS2 + DORA obligation |
| GDPR | GDPR Art. 32 technical measures overlap NIS2 Art. 21(2)(a-j) |
| EU CRA | Entities that manufacture products also face CRA obligations |
| KRITIS-DE | German NIS2UmsuCG overlaps with BSIG §8a for KRITIS operators |
| BSI IT-Grundschutz 2023 | German NIS2 transposition references BSI methodology |
| EUCS | Digital infrastructure EE may also pursue EUCS certification |

---

## How to enable

Add the framework ID to your workspace `.swao.yml`:

```yaml
frameworks:
  - id: NIS2
```
