---
control_id: BSI_C5_INM-03
framework_id: BSI_C5
collected_at: 2026-07-08
collected_by: consultant
classification: client-internal
---

# Notification to BSI for Significant Cloud Security Incidents (INM-03) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: NOT_MET
severity: high
rationale: >-
  There is no documented process for determining when a cloud security incident
  triggers reporting obligations to the BSI under applicable regulatory
  requirements. The incident response plan does not reference BSI notification.
  No notification template or escalation path to the responsible person for
  regulatory reporting exists. The control is not met; the regulatory reporting
  obligation and the associated process must be defined from scratch.

## BSI notification register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Process for determining notification obligation | Not defined | Yes |
| Escalation path to notification owner | Not defined | Yes |
| Notification template prepared | Not present | Yes |
| Notification owner assigned | Not assigned | Yes |
| BSI notification included in IRP | Not referenced | Yes |
| Process tested in exercises | Not tested | Yes |

## Counter-hypothesis considered

Considered whether the general incident escalation process implicitly covers
BSI notification through the legal team. Rejected: INM-03 requires an
explicit and documented process for cloud-specific regulatory notification.
The absence of a decision tree distinguishing notifiable from non-notifiable
incidents means the legal team has no structured basis to make the call in
a time-pressured incident response.

## Auditor notes

Regulatory context: BSI IT-Sicherheitsgesetz 2.0 (IT-SiG 2.0) and
NIS2 Directive impose notification obligations for KRITIS operators. Where
the service provider processes workloads for KRITIS operators or public
sector customers, the notification obligations may extend to the provider.
Legal counsel should be engaged to scope the obligation before the
notification process is authored.
