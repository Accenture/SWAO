---
control_id: BSI_SYS16_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-07
collected_by: consultant
classification: client-internal
---

# Container Security Planning (SYS.1.6.A1) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  Container workloads are running in production. No container security concept
  document has been produced before or after the production rollout. The
  platform team applies operational security practices informally (images are
  pulled from Docker Hub and a private registry without a consistent policy
  on trusted sources, and container builds use a standard Node base image
  with no hardening applied). Multi-stage builds are not consistently used.
  The absence of a formal security concept before production rollout is the
  primary gap; the team's novice-level Kubernetes proficiency increases the
  risk from undocumented configuration drift. SYS.1.6.A1 overrides APP.4.4.A1
  where both apply; this evidence is read together with the APP.4.4.A1
  evidence file.

## Container lifecycle register

| Lifecycle phase | Current state | Gap |
| --- | --- | --- |
| Security concept documented before production | Not produced | Yes |
| Build: multi-stage builds used | Inconsistent | Partial |
| Build: non-root USER enforced in Dockerfile | Not enforced | Yes |
| Ship: trusted registry policy | Mixed (Docker Hub + private) | Partial |
| Run: orchestration platform configuration reviewed | Not reviewed post-setup | Yes |
| Run: network isolation between containers | No network policies | Yes |
| Run: secrets management | Kubernetes Secrets (base64) | Yes |
| Review trigger on platform or base image change | Not defined | Yes |

## Counter-hypothesis considered

Considered whether the use of a managed Kubernetes service from a certified
cloud provider satisfies the security concept requirement. Rejected: the
managed service provides control-plane security; the SYS.1.6.A1 requirement
is for a workload-level security concept covering the full container lifecycle,
which is independent of the platform provider.

## Auditor notes

(empty)
