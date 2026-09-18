---
control_id: BSI_DER21_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-07
collected_by: consultant
classification: client-internal
---

# Incident Management Concept (DER.2.1.A1) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  The platform team handles security incidents reactively. There is a Slack
  channel (`#incidents`) and the team uses ServiceNow for ticket tracking.
  However, no formal incident management concept exists: security incident
  classification criteria are not documented, escalation paths have not been
  defined, and the team has no documented procedure for identifying and
  handling personal data breaches within the 72-hour GDPR notification window.
  ServiceNow tickets reviewed during discovery show incidents are resolved
  without a structured root-cause record. No tabletop exercise has been
  conducted. The informal process is functional for low-severity operational
  issues but insufficient for a health data platform where a breach notification
  obligation may arise.

## Incident management register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Documented incident management concept | None | Yes |
| Security incident classification criteria | Not documented | Yes |
| Roles and responsibilities for response | Informal (platform team lead) | Yes |
| Escalation procedures | Not defined | Yes |
| GDPR breach notification procedure (72 h) | Not documented | Yes |
| Communication procedure (internal + regulatory) | Not defined | Yes |
| Incident closure criteria | Not defined | Yes |
| Tabletop exercise history | None | Yes |

## Counter-hypothesis considered

Considered whether the ServiceNow ticketing practice plus the `#incidents`
Slack channel constitutes a de facto incident management process. Accepted as
a partial compensating control for detection and tracking, but not for the
classification, escalation, breach-notification, and closure requirements of
DER.2.1.A1.

## Auditor notes

(empty)
