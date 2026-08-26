---
control_id: BSI_CON8_A2
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-08
collected_by: assessor
classification: client-internal
---

# Software Acceptance and Release Process (CON.8.A2) -- evidence template

## Purpose

Software must pass defined security acceptance criteria before release to production, including security tests, vulnerability scans, and code review; any deviation must be risk-accepted by a named authority and documented.

## Evidence required

- Release checklist showing the security acceptance gate and the criteria that must be satisfied before production deployment
- Security test results or scan reports attached to at least one recent release, confirming the gate was exercised
- Named security sign-off authority and a sample sign-off record showing the approver, date, and release identifier
- Deviation or risk acceptance register for any releases where acceptance criteria were not fully met, including the risk owner and acceptance rationale
- Confirmation that the acceptance gate is enforced before production deployment, such as a pipeline configuration or gated workflow record

## Reference

https://www.bsi.bund.de/dok/CON-8
