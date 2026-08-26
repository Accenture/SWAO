---
control_id: GDPR_Art_35_b
framework_id: GDPR
collected_at: 2026-05-22
collected_by: consultant
classification: client-internal
---

# DPIA Content (Art 35(7)) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  The workload has executed a DPIA per the template `governance/dpia/`
  for each processing operation tagged "high risk" by the Art 35(a)
  threshold check. The DPIA template covers Art 35(7)(a)-(d). Open gap:
  one of the four currently-active DPIAs (the AI-driven underwriting
  classifier v3.2) carries an out-of-date risk assessment because the
  model was retrained in 2026-04 without triggering an Art 35(c) DPIA
  review. Tracker DPIA-2026-Q2-011 owns the refresh; target 2026-06-15.

## DPIA coverage at 2026-05-22

| Use case | DPIA filed | Last reviewed | State |
| --- | --- | --- | --- |
| Customer onboarding (KYC + special-category) | 2024-08-12 | 2026-Q1 | up to date |
| Marketing-segmentation analytics | 2025-02-04 | 2026-Q1 | up to date |
| Cross-border data export to backup region | 2025-11-30 | 2026-Q2 | up to date |
| AI underwriting classifier v3.2 | 2025-07-08 | 2025-Q3 | review pending (post-retrain) |

## Template elements (Art 35(7))

- (a) Systematic description of envisaged processing operations
- (b) Necessity and proportionality assessment
- (c) Risk to rights and freedoms
- (d) Measures envisaged to address the risks

## Recital references applied

- Recital 84 (DPIA purpose)
- Recital 89-90 (DPIA scope and content)
- Recital 91 (likelihood and severity of risk)

## Counter-hypothesis considered

Considered whether a programme-level DPIA could cover all use cases;
rejected because each use case carries distinct data subjects, purposes
and risks, and Art 35 anticipates per-operation assessment.

## Auditor notes

(empty)
