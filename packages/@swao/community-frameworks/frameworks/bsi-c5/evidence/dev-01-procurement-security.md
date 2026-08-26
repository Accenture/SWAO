---
control_id: BSI_C5_DEV-01
framework_id: BSI_C5
collected_at: 2026-07-08
collected_by: consultant
classification: client-internal
---

# Security Requirements in Software Procurement (DEV-01) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  Security requirements are referenced in the standard procurement contract
  template as a generic clause ("the supplier must comply with applicable
  security standards"). However, there is no defined process for identifying
  specific security requirements before a procurement decision, and no
  supplier assessment process exists for critical software components.
  The contract template clause does not constitute documented security
  requirements tailored to the specific procurement. The control partially
  satisfies DEV-01; the pre-procurement requirements identification process
  and supplier assessment are outstanding.

## Procurement security register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Security requirements identified before procurement | Not defined | Yes |
| Security requirements documented per procurement | Generic contract clause only | Yes |
| Suppliers demonstrate meeting requirements | No assessment process | Yes |
| Security clauses in contracts | Generic clause present | Partial |
| Vendor security assessments for critical components | Not performed | Yes |

## Counter-hypothesis considered

Considered whether the generic security clause in the contract template
satisfies DEV-01. Rejected: the criterion requires that security requirements
be identified and documented for each procurement before the procurement
decision. A generic compliance clause applied after the fact does not
constitute a requirements-driven process.

## Auditor notes

(empty)
