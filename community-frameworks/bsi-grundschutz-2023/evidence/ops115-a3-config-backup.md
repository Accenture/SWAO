---
control_id: BSI_OPS115_A3
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-08
collected_by: assessor
classification: client-internal
---

# Backup of Key Configuration Data (OPS.1.1.5.A3) -- evidence template

## Purpose

Configuration data essential for system recovery -- application configuration, infrastructure-as-code definitions, secrets references, and certificate metadata -- must be backed up separately from application data and tested as part of recovery drills.

## Evidence required

- Version-control repository containing infrastructure-as-code and application configuration, with access controls evidenced
- Evidence that configuration backup is separate from application data backup (distinct backup jobs or storage targets)
- Restore runbook covering configuration recovery, with step-by-step procedure and expected outcomes
- Evidence that configuration restore is tested as part of recovery drills, with dated test records
- Confirmation that secrets references (not secrets themselves) and certificate metadata are included in the configuration backup scope

## Reference

https://www.bsi.bund.de/dok/OPS-1-1-5
