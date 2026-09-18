---
control_id: BSI_C5_PSS-01
framework_id: BSI_C5
collected_at: 2026-07-08
collected_by: consultant
classification: client-internal
---

# Data Export Capability and Format Documentation (PSS-01) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: medium
rationale: >-
  The cloud service provides a bulk data export function accessible via the
  API. The export produces JSON output. However, the export format is not
  formally documented in the service description or customer-facing
  documentation. The export capability has not been tested end-to-end to
  validate completeness. Proprietary data structures that create migration
  dependency have not been disclosed to customers. The control partially
  satisfies PSS-01; the format documentation, completeness testing, and
  lock-in disclosure are outstanding.

## Data portability register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Export capability provided | API bulk export present | No gap |
| Export in documented format | JSON but not formally documented | Yes |
| Machine-readable format | JSON (machine-readable) | No gap |
| Export procedures documented | Not documented | Yes |
| Export capability tested | Not tested | Yes |
| Proprietary lock-in disclosed to customers | Not disclosed | Yes |

## Counter-hypothesis considered

Considered whether the existence of an API export endpoint satisfies PSS-01
without formal documentation. Rejected: PSS-01 requires that both the format
and the procedure be documented so that customers can plan data migration
without depending on undocumented behaviour. An undocumented format may
change without notice and still satisfy the technical criterion; PSS-01
requires customer-accessible documentation.

## Auditor notes

(empty)
