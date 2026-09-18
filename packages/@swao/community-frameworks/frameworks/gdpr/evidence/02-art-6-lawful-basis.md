---
control_id: GDPR_Art_6
framework_id: GDPR
collected_at: 2026-05-22
collected_by: consultant
classification: client-internal
---

# Lawful Basis Register (Art 6) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: critical
rationale: >-
  The workload's processing operations are listed in the purpose registry
  (`governance/purposes.yaml`) with a chosen Art 6 lawful basis per purpose.
  Six of the seven listed operations rest on a defensible legal basis with
  a documented assessment. The seventh (marketing analytics) currently rests
  on legitimate interest (Art 6(1)(f)) but the legitimate-interest
  assessment (LIA) has not been documented to the depth EDPB guidance 1/2020
  expects. Tracker LEGAL-2026-018 owns the LIA refresh; target 2026-Q3.

## Lawful-basis register (extract)

| Processing operation | Art 6 basis | Documentation | Status |
| --- | --- | --- | --- |
| Customer account creation | (b) Contract | Terms of service v3.2 | SATISFIED |
| Identity verification (KYC) | (c) Legal obligation (AML) | AML policy v4.1 | SATISFIED |
| Service delivery (transactions) | (b) Contract | Terms of service v3.2 | SATISFIED |
| Customer support (case handling) | (b) Contract | Terms of service v3.2 | SATISFIED |
| Service-improvement analytics (aggregated) | (f) Legitimate interest | LIA-2024-007 | SATISFIED |
| Fraud detection | (f) Legitimate interest | LIA-2024-008 | SATISFIED |
| Marketing analytics (segmented) | (f) Legitimate interest | LIA pending refresh | PARTIAL |

## Recital references applied

- Recital 39 (lawfulness / transparency principle)
- Recital 40 (lawful basis menu)
- Recital 42 (consent specificity)
- Recital 47 (legitimate interest balancing test)

## Counter-hypothesis considered

Considered whether the marketing analytics could fall back to consent
(Art 6(1)(a)) for the EU resident population; rejected because the
existing customer base predates the consent collection mechanism and
re-permissioning would breach the existing relationship more than the
LIA refresh.

## Auditor notes

(empty)
