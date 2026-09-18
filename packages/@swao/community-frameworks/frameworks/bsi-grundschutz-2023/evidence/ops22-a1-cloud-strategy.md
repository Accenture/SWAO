---
control_id: BSI_OPS22_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-07
collected_by: consultant
classification: client-internal
---

# Cloud Usage Strategy (OPS.2.2.A1) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  The workload is deployed on a hyperscaler cloud platform. The decision to
  use cloud infrastructure was made at product inception and is implicitly
  understood by the team, but no documented cloud usage strategy exists. The
  permissible data types for cloud processing have never been formally
  assessed: the platform processes health data (special-category personal data
  under GDPR Art. 9) in cloud regions that have not been reviewed for data
  residency compliance. Sovereignty requirements arising from applicable
  health sector regulations have not been mapped to the cloud service
  configuration. Management has not formally approved the cloud deployment
  model.

## Cloud strategy register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Documented cloud usage strategy | None | Yes |
| Permitted data types for cloud processing defined | Not documented | Yes |
| Permissible cloud service / deployment models defined | Not documented | Yes |
| Data residency requirements identified | GDPR covered; sector law not assessed | Partial |
| Sovereignty requirements assessed | Not performed | Yes |
| Management approval of cloud deployment model | Not documented | Yes |
| Strategy review cadence defined | None | Yes |

## Counter-hypothesis considered

Considered whether the existence of a signed cloud provider DPA implicitly
defines the cloud usage strategy. Rejected: a DPA governs the processor
relationship but does not constitute an institutional strategy defining which
data types, workloads, and processes may be processed in cloud environments
or which residency constraints apply.

## Auditor notes

(empty)
