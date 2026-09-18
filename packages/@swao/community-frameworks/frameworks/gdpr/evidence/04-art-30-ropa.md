---
control_id: GDPR_Art_30
framework_id: GDPR
collected_at: 2026-05-22
collected_by: consultant
classification: client-internal
---

# Records of Processing Activities (ROPA) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: SATISFIED
severity: high
rationale: >-
  The controller ROPA is maintained in `governance/ropa-controller.yaml`
  with one entry per processing operation. Each entry carries every Art
  30(1)(a)-(g) element: controller / DPO contact; purposes; categories of
  data subjects and data; recipient categories including third countries;
  transfer safeguards; retention; general description of Art 32 security
  measures. The processor ROPA (`governance/ropa-processor.yaml`) is
  maintained where the workload acts as processor for partner clients
  (Art 30(2)). The latest review was 2026-05-08; the next quarterly
  review is scheduled for 2026-08-15.

## Coverage

| Item | Count | Coverage |
| --- | ---: | --- |
| Total processing operations | 23 | controller role |
| Total processing operations | 4 | processor role |
| Cross-border transfers | 6 | each with documented Art 46 safeguard |
| Special-category processing (Art 9) | 2 | each with documented Art 9(2) exception |
| Criminal-conviction processing (Art 10) | 0 | n/a |

## Evidence references

- `governance/ropa-controller.yaml` (23 entries)
- `governance/ropa-processor.yaml` (4 entries)
- DPO review log -- last review 2026-05-08
- Tracker ROPA-2026-Q2-005 (next quarterly review schedule)

## Counter-hypothesis considered

Considered whether the 250-employee exemption (Art 30(5)) applies; rejected
because the workload processes special categories (Art 9) and engages in
regular and systematic monitoring of data subjects -- both of which void
the exemption regardless of headcount.

## Auditor notes

(empty)
