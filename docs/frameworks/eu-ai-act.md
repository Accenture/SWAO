# EU Artificial Intelligence Act

**Framework ID:** `EU_AI_ACT` | **Authority:** European Union (Regulation EU 2024/1689) | **Version:** 2024-08-01

---

## When to use

The EU AI Act establishes a risk-based regulatory framework for AI systems placed on or put into service in the EU market. Enable this framework if:

- Your application uses AI or machine learning components that interact with users or produce consequential outputs in the EU
- You need to determine whether your AI system is classified as prohibited, high-risk, limited-risk, or minimal-risk (the Risk Classification pass is the entry point)
- Your organisation develops or deploys general-purpose AI (GPAI) models (e.g. LLMs) and needs to assess Art. 51-56 obligations
- You want to evidence compliance with the prohibited-practices prohibition that has been in force since 2025-02-02

**Key dates:**
- Prohibited practices (Art. 5, RC-03): in force 2025-02-02
- GPAI model obligations (Art. 51-56): in force 2025-08-02
- High-risk AI system obligations (Annex III): apply from 2027-08-02

**Typical profiles:** AI application developers, LLM/foundation model providers, automated decisioning systems (credit scoring, HR, safety systems), EU-market AI vendors.

---

## Controls summary

| Property | Value |
|---|---|
| Total controls | 37 |
| Parts | RC -- Risk Classification (5), HR -- High-Risk Requirements (18), TR -- Transparency Obligations (5), GP -- GPAI Model Obligations (9) |
| Assessment scope | `app`, `aud` |
| Scoring mode | Binary (compliant / non-compliant) |

**Conditional applicability:** RC controls determine which downstream groups are assessed. RC-02 verdict (`high-risk`) gates the HR part; RC-04 verdict (`gpai-model`) gates the GP part. TR controls apply for limited-risk and above. This conditional structure is evaluated by the SWAO engine `applies_when` logic.

---

## Cross-mapping

| Framework | Relationship |
|---|---|
| GDPR | Art. 10 training data maps to GDPR Art. 5 purpose limitation; Art. 22 automated decisions |
| EU CRA | Art. 15 cybersecurity requirements overlap with CRA Annex I |
| NIS2 | Art. 9 risk management and Art. 15 cybersecurity align with NIS2 Art. 21 |
| AI 10 Pillars | Deep overlap across data governance, model security, and output guardrail pillars |

---

## How to enable

Add the framework ID to your workspace `.swao.yml`:

```yaml
frameworks:
  - id: EU_AI_ACT
```
