---
control_id: BSI_CON6_A2
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-08
collected_by: assessor
classification: client-internal
---

# Secure Software Deployment (CON.6.A2) -- evidence template

## Purpose

Software and configuration changes must be deployed through a documented, authorised process; deployments must be tested in a non-production environment, authorised, capable of rollback, and deployment logs retained for a defined minimum period.

## Evidence required

- Documented deployment process or CI/CD pipeline configuration showing the required steps and gates
- Evidence of a non-production staging environment used before production deployment (environment inventory or pipeline configuration)
- Authorisation log for a sample of recent production deployments, showing the approver and approval timestamp
- Rollback procedure and evidence that a rollback has been tested or exercised, including the test record
- Deployment audit log retention configuration showing the defined retention period and storage location

## Reference

https://www.bsi.bund.de/dok/CON-6
