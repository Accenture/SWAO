---
control_id: BSI_C5_HRS-01
framework_id: BSI_C5
collected_at: 2026-07-08
collected_by: consultant
classification: client-internal
---

# Background Verification for Staff in Sensitive Roles (HRS-01) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  Background checks are conducted for permanent employees joining roles with
  access to production infrastructure. The HR process mandates criminal record
  checks and reference verification. However, contractor and third-party
  personnel accessing the cloud service management plane are not subject to
  the same screening regime. Additionally, there is no defined interval for
  re-screening staff in highly sensitive roles. The control partially satisfies
  HRS-01; coverage of non-permanent personnel and periodic re-screening are
  outstanding.

## Background verification register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Checks conducted proportionate to role sensitivity | Yes, for permanent staff | No gap |
| Applicable legal requirements observed | GDPR-compliant HR process | No gap |
| Covers all personnel with production infrastructure access | Permanent staff only | Yes |
| Covers all personnel with customer data access | Permanent staff only | Yes |
| Covers contractors and third parties | Not addressed | Yes |
| Periodic re-screening for highly sensitive roles | Not defined | Yes |
| Screening records maintained | Present for permanent hires | Partial |

## Counter-hypothesis considered

Considered whether contractual security obligations placed on third-party
firms satisfy the individual screening requirement. Rejected: OIS-05 covers
supplier-level obligations; HRS-01 applies at the individual level. A
supplier contract requiring screening is not equivalent to the provider
having evidence that screening was actually performed for individuals with
access.

## Auditor notes

(empty)
