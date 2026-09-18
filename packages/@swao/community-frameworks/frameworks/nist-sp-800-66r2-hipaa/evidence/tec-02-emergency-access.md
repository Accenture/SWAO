---
control_id: HIPAA-TEC-02
framework_id: NIST_SP_800_66R2
collected_at: 2026-05-23
collected_by: consultant
classification: regulatory
---

# HIPAA-TEC-02 -- Emergency Access Procedure (Required) -- 164.312(a)(2)(ii)

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  Break-glass access is provisioned for the EHR and the clinical
  imaging system: named clinicians hold standby credentials in a sealed
  PAM vault; invocation requires a paper-form pre-auth from the on-call
  CMO. Each invocation emits a high-priority SIEM alert and triggers an
  after-action review within 5 business days. Gap: the lab-results
  interface, the patient portal and the billing system have no
  documented break-glass procedure -- emergency clinical access to lab
  results currently routes through the EHR which is acceptable, but
  emergency access to the lab-results interface itself (for an EHR
  outage) is undefined. Treatment open under INC-CLIN-0203, target
  close 2026-Q3. Two break-glass invocations in 2026-Q1, both
  legitimate clinical emergencies, both reviewed and closed.

## Evidence references

- Break-glass Procedure v1.7 -- EHR and imaging systems
- PAM vault audit log 2026-Q1 -- 2 break-glass invocations
- INC-CLIN-0203 -- extend break-glass to lab-interface, portal, billing
- After-action reports BG-2026-01 and BG-2026-02

## Counter-hypothesis considered

Considered whether the billing system needs a documented emergency
procedure (it does not directly impact clinical care); ruled out as
"informational only" -- but the IT auditor's view is that the absence
of a procedure for a major ePHI-handling system is itself a finding
regardless of the operational impact. The treatment plan addresses
this.

## Auditor notes

(empty -- filled in at sign-off)
