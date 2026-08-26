---
control_id: BSI_CON3_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-07
collected_by: consultant
classification: client-internal
---

# Backup Requirements Analysis (CON.3.A1) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  Backups are in place for the primary database and object storage. However,
  recovery point objectives (RPO) and recovery time objectives (RTO) have
  never been formally determined with the application owner. The current backup
  schedule (daily snapshots retained for 30 days) was set by the platform team
  based on operational judgement rather than a documented business impact
  analysis. No formal documentation of RPO/RTO exists, and the backup
  configuration has not been reviewed since initial deployment. The gap is the
  absence of a documented requirements analysis, not the absence of backups.

## RPO/RTO register

| Asset | Backup schedule | Retention | Documented RPO | Documented RTO | Gap |
| --- | --- | --- | --- | --- | --- |
| Patient records database (PostgreSQL) | Daily snapshot | 30 days | None | None | Yes |
| Biomarker result store (object storage) | Daily snapshot | 30 days | None | None | Yes |
| Application configuration (Kubernetes) | Not backed up | N/A | None | None | Yes |
| Infrastructure-as-code (Terraform state) | Versioned in remote backend | N/A | Implicit | Implicit | Partial |

## Counter-hypothesis considered

Considered whether the existing backup schedule implicitly satisfies a 24-hour
RPO given daily snapshots. This would only be valid if the RPO had been agreed
with the application owner and the business impact assessed. Without that
documented agreement, the backup schedule cannot be called requirements-compliant.

## Auditor notes

(empty)
