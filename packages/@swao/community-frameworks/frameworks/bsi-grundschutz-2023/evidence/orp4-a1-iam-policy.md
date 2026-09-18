---
control_id: BSI_ORP4_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-07
collected_by: consultant
classification: client-internal
---

# Identity and Access Management Policy (ORP.4.A1) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: GAP
severity: high
rationale: >-
  No formal identity and access management (IAM) policy exists. Access to
  production systems is managed through GitHub Teams and cloud-provider IAM
  roles, with provisioning handled informally by the platform team lead.
  There is no documented policy covering account lifecycle (joiner/mover/leaver),
  privileged access procedures, authentication strength requirements, or the
  handling of service accounts. Several long-lived service account tokens with
  broad permissions were identified during the technical walk-through. The team
  has not performed an access review in the past 12 months.
  This is a GAP: the requirement calls for a governing policy document; none exists.

## IAM posture register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Written IAM policy | None | Yes |
| Account lifecycle process | Informal | Yes |
| Privileged access procedure | None; ad hoc | Yes |
| MFA enforcement | Enforced for GitHub/cloud console | No gap |
| Service account inventory | Not maintained | Yes |
| Access review cadence | No scheduled reviews | Yes |
| Authentication strength requirements | Implicit (SSO enforced) | Partial |

## Counter-hypothesis considered

Considered whether the enforced SSO and MFA on cloud console access
partially satisfies ORP.4.A1. Assessment remains GAP because the control
explicitly requires a governing policy document -- individual technical
controls (SSO, MFA) do not substitute for the policy that governs the
overall IAM programme lifecycle.

## Auditor notes

(empty)
