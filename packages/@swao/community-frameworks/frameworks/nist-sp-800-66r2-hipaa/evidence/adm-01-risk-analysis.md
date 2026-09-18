---
control_id: HIPAA-ADM-01
framework_id: NIST_SP_800_66R2
collected_at: 2026-05-23
collected_by: consultant
classification: regulatory
---

# HIPAA-ADM-01 -- Risk Analysis (Required) -- 164.308(a)(1)(ii)(A)

## Verdict (consultant-asserted)

outcome: SATISFIED
severity: critical
rationale: >-
  A documented risk analysis covers every system that creates, receives,
  maintains or transmits ePHI: the EHR, the lab-results interface, the
  patient portal, the billing system, and the file-share used for
  release-of-information workflows. The 2026-Q1 analysis applied the
  NIST SP 800-30r1 methodology, scoped to 47 information systems and
  142 associated workforce roles. Threats were rated against likelihood
  and impact; 12 high-risk findings entered the risk-treatment plan
  tracked under HIPAA-ADM-02. The analysis is refreshed annually and on
  material change (acquisition of a new EHR module, change of cloud
  provider for backups).

## Evidence references

- Risk Analysis Report 2026-Q1 (in DMS, classification: confidential)
- Scoping inventory -- 47 ePHI-handling systems (CMDB export 2026-01-15)
- NIST SP 800-30r1 -- methodology applied
- Risk register 2026-Q1 -- 12 high-risk findings transferred to HIPAA-ADM-02

## Counter-hypothesis considered

Considered whether the scope omits non-clinical systems that may handle
ePHI incidentally (a shared inbox, an HR-onboarding spreadsheet);
checked the data-classification inventory -- both candidates were
out-of-policy and remediated through retention rules in 2025-Q4.
Workforce was retrained on the channels where ePHI is permitted.

## Auditor notes

(empty -- filled in at sign-off)
