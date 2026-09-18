---
control_id: HIPAA-ADM-16
framework_id: NIST_SP_800_66R2
collected_at: 2026-05-23
collected_by: consultant
classification: regulatory
---

# HIPAA-ADM-16 -- Response and Reporting (Required) -- 164.308(a)(6)(ii)

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  An incident response plan exists (IRP v3.2, approved 2025-11-20) and
  covers detection, triage, containment, eradication, recovery and
  post-incident review. The SIEM feeds incidents into a 24x7 SOC queue.
  Two incidents in 2026 (one phishing-led credential compromise, one
  ransomware attempt blocked at the perimeter) followed the plan and
  closed within SLA. Gap: the IRP does not yet codify the HHS / OCR
  breach-notification timeline (60 calendar days post-discovery for
  individual notice; concurrent media notice for >500 individuals;
  annual notice to HHS for <500). Treatment open under INC-LEGAL-0091
  with target close 2026-Q3.

## Evidence references

- IRP v3.2 (2025-11-20) -- in the GRC tool
- SIEM incident export 2026-Q1 -- 14 incidents, all SLA-compliant
- INC-LEGAL-0091 -- breach-notification timeline gap tracker
- 2026-02 phishing tabletop after-action report

## Counter-hypothesis considered

Considered whether the breach-notification gap is informational (legal
already operates the timeline outside the IRP); confirmed with general
counsel -- the practice exists but is not codified in a runbook the
SOC follows, so a SOC-only-staffed weekend incident would miss the
clock-start.

## Auditor notes

(empty -- filled in at sign-off)
