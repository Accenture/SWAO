---
control_id: BSI_OPS112_A3
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-08
collected_by: assessor
classification: client-internal
---

# Secure Change Testing (OPS.1.1.2.A3) -- evidence template

## Purpose

All changes must be tested in an environment representative of production before deployment; security regression tests must be included for changes to security-relevant components, with test results documented and linked to the change record.

## Evidence required

- Staging environment inventory or configuration confirming it mirrors production in architecture and scale
- Test sign-off records linked to recent change records, showing approval before production deployment
- Evidence that the automated test suite includes security regression tests for security-relevant components
- Change record linking test evidence to a recent production deployment
- Confirmation that security regression tests are triggered automatically for changes to security-relevant components

## Reference

https://www.bsi.bund.de/dok/OPS-1-1-2
