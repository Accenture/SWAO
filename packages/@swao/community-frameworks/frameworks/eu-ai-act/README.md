# EU AI Act -- SWAO Community Framework

**Framework ID:** `EU_AI_ACT`
**Signal prefix:** `AIACT`
**Authority:** European Union (Regulation EU 2024/1689)
**Version:** 2024-08-01
**Catalogue version:** 1.0.0
**Last reviewed:** 2026-09-22

---

## Overview

The EU Artificial Intelligence Act (Regulation EU 2024/1689) is the world's first comprehensive legal
framework governing artificial intelligence. Adopted by the European Parliament on 13 March 2024 and
published in the Official Journal on 12 July 2024, it applies a risk-based regulatory approach to AI
systems placed on or put into service in the EU market.

This SWAO community framework provides 37 controls across 4 parts, covering the full compliance
lifecycle from initial risk classification through to conformity assessment and post-market monitoring.

**Contributor:** SWAO Development Team (Accenture)

---

## Timeline

| Date | Event |
|---|---|
| 2024-08-01 | Regulation in force |
| 2025-02-02 | Prohibited AI practices (Art. 5) apply |
| 2026-08-02 | GPAI model obligations (Art. 51-55) apply |
| 2027-08-02 | High-risk AI system obligations (Annex III) apply |

---

## Framework structure

| Part | Domain | Controls | Scope |
|---|---|---|---|
| RC | Risk Classification | 5 | Unconditional -- assess for all AI systems |
| HR | High-Risk Requirements | 18 | Conditional -- applies when RC-02 = high-risk |
| TR | Transparency Obligations | 5 | Conditional -- applies when RC-03 = limited-risk or higher |
| GP | GPAI Model Obligations | 9 | Conditional -- applies when RC-04 = GPAI model on EU market |
| **Total** | | **37** | |

### Conditional applicability

The EU AI Act uses a tiered approach. Part RC controls gate which subsequent control groups apply:

- **RC-01** (prohibited practices): always assessed -- any finding = critical non-compliance
- **RC-02** (high-risk identification): if verdict is `high-risk`, all Part HR controls apply
- **RC-03** (limited-risk flag): if verdict is `limited-risk` or `high-risk`, Part TR controls apply
- **RC-04** (GPAI model identification): if verdict is `gpai-model`, Part GP controls apply
- **RC-05** (risk classification documentation): always assessed for systems that have been classified

---

## Assessment scope

| Scope | Meaning |
|---|---|
| `app` | Application-level controls -- system design, AI outputs, user-facing disclosures |
| `aud` | Audit/evidence controls -- documentation, conformity assessments, reporting obligations |

This framework targets organisations deploying, developing, or placing AI systems on the EU market.
It does not cover pure research or personal/non-professional use (Art. 2(6)).

---

## Applicability hints

Enable this framework if your workload involves any of:

- `ai_system` -- any AI system deployed in or for the EU market
- `high_risk_ai` -- systems in sectors listed in Annex III (biometrics, infrastructure, education,
  employment, essential services, law enforcement, migration, justice, democratic processes)
- `gpai_provider` -- organisations providing general-purpose AI models (LLMs, foundation models)
- `automated_decisioning` -- systems making or assisting decisions with legal or significant effects
- `eu_market` -- any service or product offered to users in the EU

---

## Cross-mapping

| Target framework | Overlap areas |
|---|---|
| GDPR | Art. 10 training data governance -- GDPR Art. 5 purpose limitation; Art. 22 automated decisions |
| EU_CRA | Art. 15 AI system cybersecurity -- CRA Annex I secure-by-design requirements |
| NIS2 | Art. 9 risk management + Art. 15 cybersecurity -- NIS2 Art. 21 security measures |
| AI_10_PILLARS | Deep overlap across data governance, model security, and output guardrail pillars |

---

## How to enable in `.swao.yml`

```yaml
compliance:
  frameworks:
    - EU_AI_ACT
```

For GPAI providers also include `AI_10_PILLARS` for comprehensive AI governance coverage:

```yaml
compliance:
  frameworks:
    - EU_AI_ACT
    - AI_10_PILLARS
    - GDPR
```

---

## Key requirements by part

### Part RC -- Risk Classification

All organisations must complete the risk classification before any other part applies. The
classification determines which downstream control groups are active.

Document your classification in a technical file (Annex IV) -- this is required regardless
of whether the system qualifies as high-risk.

### Part HR -- High-Risk Requirements (Art. 9-17, 47-48, 72-73)

High-risk AI systems face the most extensive obligations:

- Risk management system (Art. 9): lifecycle risk assessment with annual review
- Data governance (Art. 10): training data representativeness, bias detection, lineage documentation
- Technical documentation (Art. 11 + Annex IV): comprehensive technical file
- Automatic logging (Art. 12): logs of AI system operation; minimum 12-month retention
- Transparency to deployers (Art. 13): instructions for use including limitations and misuse scenarios
- Human oversight (Art. 14): stop/override capability; operator training requirements
- Accuracy and robustness (Art. 15): declared metrics; adversarial testing; cybersecurity measures
- Post-market monitoring (Art. 72): systematic performance data collection post-deployment
- Serious incident reporting (Art. 73): report to national competent authority within 15 days

### Part TR -- Transparency Obligations (Art. 50)

Systems that interact directly with users must disclose their AI nature. Key requirements:

- Chatbots must identify themselves as AI at the start of interaction
- Emotion recognition systems must disclose operation before inference
- Deepfakes and AI-generated content must be labelled in machine-readable format
- Deployers of high-risk systems must inform affected persons of AI involvement

### Part GP -- GPAI Model Obligations (Art. 51-56)

Providers placing general-purpose AI models on the EU market must:

- Maintain technical documentation (training methodology, capabilities, limitations)
- Publish a model capability summary and training data copyright compliance policy
- For systemic-risk models (training compute >= 10^25 FLOPs): conduct adversarial testing,
  implement cybersecurity protections, report serious incidents to the AI Office, and report
  energy consumption annually

---

## Redistribution note

EU Regulation 2024/1689 (AI Act) is an EU legislative act published in the Official Journal and
available in the public domain per EUR-Lex terms of reuse. Control descriptions in this framework
paraphrase the regulation's requirements; they do not constitute legal advice. Consult qualified
legal counsel and your national competent authority for jurisdiction-specific implementation guidance.

---

## References

- EU Regulation 2024/1689 (AI Act): https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202401689
- European Commission AI Office: https://commission.europa.eu/priorities/digital-decade/artificial-intelligence
- SWAO issue: #0441
