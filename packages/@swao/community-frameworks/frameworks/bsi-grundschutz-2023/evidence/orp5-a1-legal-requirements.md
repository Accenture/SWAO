---
control_id: BSI_ORP5_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-07
collected_by: consultant
classification: client-internal
---

# Identification of Legal and Regulatory Requirements (ORP.5.A1) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  GDPR obligations have been identified and are tracked in the legal team's
  register. However, the compliance register does not extend to the full set
  of applicable requirements: sector-specific health data obligations under
  national law (notably the German PDSG and DiGA regulation for digital health
  applications) have not been documented with their implications assessed.
  Contractual security obligations from the cloud provider DPA and two key
  B2B customer contracts have not been mapped to technical controls. The
  register is accurate for what it covers but the coverage is incomplete
  relative to the actual regulatory environment the workload operates in.

## Compliance register coverage

| Requirement category | Coverage | Owner | Gap |
| --- | --- | --- | --- |
| GDPR (EU 2016/679) | Documented | Legal | No gap |
| BSI IT-Grundschutz (applicable as per sector) | Not assessed | None | Yes |
| National health data law (PDSG / DiGA) | Not documented | None | Yes |
| Cloud provider DPA obligations | Not mapped to controls | Legal / Ops | Partial |
| Customer contractual security obligations | Not systematically tracked | None | Yes |
| NIS2 applicability assessment | Not performed | None | Yes |

## Counter-hypothesis considered

Considered whether the GDPR-only register is sufficient given that GDPR is
the primary data protection obligation. Rejected: ORP.5.A1 requires all legal,
regulatory, and contractual requirements to be identified. A health workload
operating in the EU has obligations beyond GDPR that must be documented and
assessed before the Basis requirement is satisfied.

## Auditor notes

(empty)
