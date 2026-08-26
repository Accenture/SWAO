---
control_id: GDPR_Art_46
framework_id: GDPR
collected_at: 2026-05-22
collected_by: consultant
classification: client-internal
---

# Appropriate Safeguards for Third-Country Transfers (Art 46) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: critical
rationale: >-
  The workload's cross-border transfer register lists six third-country
  transfers (US x4; India x1; Brazil x1). Four transfers (US x3, India x1)
  use the European Commission SCCs adopted under Decision 2021/914 with
  documented transfer-impact assessments (TIAs) per Schrems II / EDPB
  Recommendations 01/2020. Two transfers carry partial documentation: the
  Brazil transfer (processor) has the SCCs executed but the TIA is still
  awaiting input from the Brazilian processor (BR-LGPD adequacy decision
  is pending and will if granted simplify the safeguard). One US transfer
  (the customer-support tooling vendor) used the EU-U.S. Data Privacy
  Framework as the safeguard but the vendor has not yet self-certified to
  the post-Schrems-II framework refresh; revert to SCCs in flight.

## Transfer register (extract)

| Recipient | Country | Role | Safeguard | TIA | Status |
| --- | --- | --- | --- | --- | --- |
| Foundation-model-vendor X | US | Processor (inference) | SCC 2021/914 Module 2 + supplementary measures | TIA-2024-008 (v2 2026-Q1) | SATISFIED |
| CDN provider Y | US (multi-region) | Processor (caching) | SCC 2021/914 Module 2 | TIA-2024-009 | SATISFIED |
| Customer-support tool Z | US | Processor | Reverting from EU-U.S. DPF to SCC 2021/914 | TIA in draft | PARTIAL |
| Backup region | US | Processor (storage) | SCC 2021/914 Module 2 + EU-managed KMS | TIA-2025-001 | SATISFIED |
| Tax-reporting partner | India | Processor | SCC 2021/914 Module 2 | TIA-2024-014 | SATISFIED |
| Customer-service partner | Brazil | Processor | SCC 2021/914 Module 2 | TIA pending | PARTIAL |

## Recital references applied

- Recital 108 (appropriate safeguards menu)
- Recital 109 (SCC suitability)
- Recital 110 (BCR option)

## Counter-hypothesis considered

Considered whether the EU-U.S. Data Privacy Framework (post-Schrems-II
2023 decision) should be the primary safeguard for US transfers;
mitigated by the dual-track approach (DPF where available, SCCs as
fall-back) because the underlying CJEU jurisprudence shows the framework
is litigation-vulnerable.

## Auditor notes

(empty)
