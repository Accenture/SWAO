---
control_id: BSI_APP44_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-07
collected_by: consultant
classification: client-internal
---

# Container Orchestration Security Policy (APP.4.4.A1) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  The workload runs on Kubernetes (team skill: novice level, 2 of 8 engineers).
  No formal container orchestration security policy exists. Role-based access
  control (RBAC) is enabled on the cluster but the role assignments have not
  been reviewed since initial setup; the default service account is used by
  several workloads rather than per-workload dedicated accounts. Network policies
  have not been deployed, allowing unrestricted pod-to-pod communication within
  the namespace. Secrets are stored in Kubernetes Secrets (base64-encoded) rather
  than an external secrets manager. No pod security standard has been applied.
  The team's novice-level Kubernetes knowledge is a contributing factor to the
  configuration gaps.

## Orchestration security register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Container orchestration security policy | None | Yes |
| RBAC configured | Yes; not reviewed | Partial |
| Network policies deployed | None | Yes |
| Pod security standard applied | None (Privileged effective) | Yes |
| Image provenance controls | No signing enforced | Yes |
| Secrets management | Kubernetes Secrets (base64) | Yes |
| Default service account disabled for workloads | Not enforced | Yes |
| Insecure default configurations overridden | Partially (RBAC enabled) | Partial |

## Counter-hypothesis considered

Considered whether the enabled RBAC and managed Kubernetes service (cloud
provider handles control-plane hardening) collectively satisfy the policy
requirement. Rejected: APP.4.4.A1 requires a documented policy; the managed
service provides infrastructure hardening but does not substitute for the
workload-level security policy and the explicit configuration requirements
the control mandates.

## Auditor notes

(empty)
