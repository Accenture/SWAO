<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     AI 10 Pillars -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# 10 Pillars of Secure AI Systems -- SWAO Community Framework

**Framework ID:** `AI_10_PILLARS`
**Version:** 2026-Q2
**Authority:** Community framework -- contributed by Alok Sharan
**SWAO tier:** Community (install required -- `swao framework install AI_10_PILLARS`)
**Controls:** 55 sub-controls across 10 pillars

## What this framework evaluates

AI_10_PILLARS evaluates the security posture of an AI application: a workload that uses
LLMs, RAG pipelines, agentic systems, or foundation model APIs. Controls cover the full
AI system surface: how inputs are validated, how identities are managed, how data is
protected in transit and at rest, how the model itself is secured, how prompts are
hardened against injection, how retrieved context is scoped, how tool calls and external
APIs are sandboxed, how outputs are filtered, how the system is monitored, and how
governance and compliance obligations are met.

This framework is suitable for any AI workload regardless of cloud target. It is
especially relevant for sovereign deployments where prompt data contains personal or
regulated data.

## How to activate in SWAO

AI_10_PILLARS is pre-installed. Add to your workspace `.swao.yml`:

```yaml
compliance:
  frameworks: [AI_10_PILLARS]
```

Or run a one-off assessment:

```bash
swao assess --framework AI_10_PILLARS
```

## Control pillars

| Pillar | Prefix | Focus |
|---|---|---|
| 1 -- Input Security | INP | Prompt injection, content filtering, input validation |
| 2 -- Identity and Access | IAM | Authentication, authorisation, multi-tenant isolation |
| 3 -- Data Protection | DATA | Encryption, data classification, retention, PII handling |
| 4 -- Model Security | MOD | Model signing, access control, training data governance |
| 5 -- Prompt Security | PRM | System prompt hardening, indirect injection, jailbreak resistance |
| 6 -- Retrieval Security | RAG | Vector store access, document ACLs, context scoping |
| 7 -- Tool and API Security | TLS | Tool sandboxing, API rate limits, capability scoping |
| 8 -- Output Guardrails | OUT | Hallucination detection, output filtering, PII redaction |
| 9 -- Monitoring and Detection | MON | Observability, anomaly detection, audit logging |
| 10 -- Governance | GOV | AI inventory, risk assessment, regulatory mapping, human oversight |

## Evidence sources

Controls draw from automated code analysis (IAM, CRYPTO, EGR passes), SARIF output from
red-team scanners (Garak, Promptfoo, NeMo Guardrails) placed in `imports/`, and
consultant-furnished governance documents (AI inventory, risk assessment questionnaires).

## Customising this framework

Install a local copy to override specific controls:

```bash
swao framework install AI_10_PILLARS
```

The installed copy at `catalogs/community/ai-10-pillars/controls.yaml` overrides the
bundled version for all assessments in that workspace. See `CONTRIBUTING.md` for the full
authoring guide.

## Contributor

Alok Sharan (framework concept); Helmut Schindlwick / Accenture SWAO team (SWAO packaging)
https://github.com/Accenture/SWAO
