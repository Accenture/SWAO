---
control_id: BSI_DER4_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-07
collected_by: consultant
classification: client-internal
---

# Business Continuity Plan (DER.4.A1) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: GAP
severity: high
rationale: >-
  No business continuity plan exists. The platform team acknowledged that in
  the event of a major infrastructure failure or loss of key personnel, there
  is no documented procedure for maintaining minimum service levels, no defined
  recovery priority order for the application components, and no communication
  plan for stakeholders during an outage. Cloud provider SLAs are in place for
  the underlying infrastructure, but these are not reflected in any internal
  continuity planning. The workload processes health data for patients; a
  prolonged outage has patient safety implications that make the absence of a
  BCP a high-severity gap. This is a full GAP with no compensating controls.

## BCP register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Business continuity plan document | None | Yes |
| IT service loss scenario covered | Not planned | Yes |
| Key personnel loss scenario covered | Not planned | Yes |
| Recovery priorities defined | None | Yes |
| Minimum service levels defined | None | Yes |
| Communication procedure for outages | Informal; no documented procedure | Yes |
| Alignment with RTO from backup requirements analysis | RPO/RTO not defined (see CON.3.A1) | Yes |
| Annual BCP test | Never performed | Yes |

## Counter-hypothesis considered

Considered whether the cloud provider's availability SLA and automatic failover
at infrastructure level constitutes a partial BCP. Rejected: infrastructure
resilience is not a substitute for an application-level business continuity
plan that addresses the business impact, recovery priorities, and stakeholder
communication requirements of DER.4.A1.

## Auditor notes

(empty)
