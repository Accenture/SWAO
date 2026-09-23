# EU Cyber Resilience Act (CRA)

**Framework ID:** `EU_CRA` | **Authority:** European Union (Regulation EU 2024/2847) | **Version:** 2024-12-11

---

## When to use

The EU CRA applies to manufacturers of "products with digital elements" (PDE) placed on the EU market -- both hardware and software with network connectivity. Enable this framework if:

- Your organisation manufactures or distributes connected software or hardware products in the EU market
- You produce IoT devices, embedded software, network equipment, or desktop/server software
- You need to implement mandatory SBOM (Art. 13) and vulnerability reporting (Art. 14) obligations
- You assess whether your cloud product includes CRA-scope components

**Out of scope:** SaaS (cloud-hosted services), medical devices (MDR/IVDR), aviation (EASA), automotive (UNECE WP.29), national security products.

**Key deadlines:** In force 10 December 2024; most Art. 21 obligations apply from 11 December 2027; Art. 14 (actively exploited vulnerability reporting) applies from September 2026.

**Typical profiles:** IoT device manufacturers, on-premise software vendors, edge computing vendors, network equipment providers.

---

## Controls summary

| Property | Value |
|---|---|
| Total controls | 35 |
| Domains | Security by Design (12, Annex I Part I), Vulnerability Handling (8, Annex I Part II), Critical Products (5, Annex II Class I/II), Conformity Assessment (4), Market Surveillance (3), SBOM (3) |
| Assessment scope | `app`, `aud` |
| Scoring mode | Binary (compliant / non-compliant) |

Mandatory SBOM in machine-readable format (Art. 13) and 24h ENISA notification for actively exploited vulnerabilities (Art. 14) are high-priority early obligations.

---

## Cross-mapping

| Framework | Relationship |
|---|---|
| NIS2 | Essential entities that also manufacture PDE face NIS2 + CRA dual obligation |
| ISO 27001 | CRA security-by-design requirements map to ISO A.8 secure development controls |
| GDPR | CRA Art. 13 SBOM + data minimisation map to GDPR Art. 25 (privacy by design) |
| EUCS | Cloud-delivered PDE components overlap EUCS IAM/CRY/DEV domains |
| DORA | Financial sector PDE vendors face CRA + DORA dual obligation |
| OpenSSF Scorecard | CRA Annex I Part II vulnerability handling aligns with OSS-VLN controls |

---

## How to enable

Add the framework ID to your workspace `.swao.yml`:

```yaml
frameworks:
  - id: EU_CRA
```
