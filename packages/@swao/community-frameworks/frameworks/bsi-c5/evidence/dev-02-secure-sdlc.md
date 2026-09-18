---
control_id: BSI_C5_DEV-02
framework_id: BSI_C5
collected_at: 2026-07-08
collected_by: consultant
classification: client-internal
---

# Secure Software Development Lifecycle (DEV-02) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  The development team follows an Agile process with code reviews enforced
  via pull request policies and a CI pipeline that runs unit tests and
  dependency scanning. Security requirements are not systematically captured
  at the design phase and threat modelling is not part of the standard
  process. SAST is configured in the pipeline but findings are not classified
  as blocking by severity. There is no documented SSDLC policy. The control
  partially satisfies DEV-02; the formal SSDLC documentation, threat
  modelling, and blocking-gate enforcement are outstanding.

## SSDLC register

| Requirement | Current state | Gap |
| --- | --- | --- |
| SSDLC process applied to cloud service development | Agile + CI present | Partial |
| Security requirements captured at design | Not systematically | Yes |
| Threat modelling integrated | Not performed | Yes |
| Security testing integrated into development | SAST present (non-blocking) | Partial |
| Code review mandatory | Present via PR policy | No gap |
| SSDLC policy documented | Not documented | Yes |
| Developers trained on secure coding | No formal training | Yes |

## Counter-hypothesis considered

Considered whether the combination of PR review and dependency scanning
constitutes a sufficient SSDLC for a cloud service. Rejected: DEV-02
requires security to be addressed from design through deployment, which
explicitly includes requirements capture and threat modelling. The existing
controls are build-phase only; design-phase security is absent.

## Auditor notes

(empty)
