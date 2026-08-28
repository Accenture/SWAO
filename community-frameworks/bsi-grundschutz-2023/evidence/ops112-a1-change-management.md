---
control_id: BSI_OPS112_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-07
collected_by: consultant
classification: client-internal
---

# Change Management Concept (OPS.1.1.2.A1) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  All changes to the production environment are deployed through a CI/CD
  pipeline requiring a pull-request approval before merge, which provides
  a basic change control gate. However, there is no documented change
  management concept: risk assessment is not performed on changes, there
  is no classification of standard versus normal versus emergency changes,
  and post-implementation review is not practised. Emergency changes are
  deployed directly by the platform team lead without a defined procedure.
  The pipeline-enforced approval is a compensating control that partially
  addresses the intent of OPS.1.1.2.A1, but the documented process and
  risk-assessment requirement are not met.

## Change management register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Documented change management concept | None | Yes |
| Change categories (standard / normal / emergency) | Not defined | Yes |
| Risk assessment per change | Not performed | Yes |
| Deployment authorisation gate | PR approval required (CI/CD) | No gap |
| Post-implementation review | Not practised | Yes |
| Emergency change procedure | None; ad hoc by platform lead | Yes |
| Change log retention | Git history only | Partial |

## Counter-hypothesis considered

Considered whether the CI/CD pipeline with mandatory PR review and automated
test gates is equivalent to a documented change management process. Partially
accepted for the authorisation gate, but the absence of risk assessment,
change categorisation, and emergency-change procedures means the overall
control is PARTIAL, not SATISFIED.

## Auditor notes

(empty)
