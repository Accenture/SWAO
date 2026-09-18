---
control_id: GDPR_Art_22
framework_id: GDPR
collected_at: 2026-05-22
collected_by: consultant
classification: client-internal
---

# Automated Individual Decision-Making (Art 22) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: SATISFIED
severity: critical
rationale: >-
  Two processes in the workload qualify as decisions based solely on
  automated processing that produce legal effects or similarly
  significantly affect data subjects: the AI underwriting classifier v3.2
  (insurance decisions) and the fraud-detection v4.1 (transaction holds).
  Both rest on Art 22(2)(a) (necessary for performance of a contract) and
  Art 22(2)(c) (explicit consent) respectively, with the safeguards
  required by Art 22(3): right to obtain human intervention, right to
  express the data subject's point of view, right to contest the decision.
  Recital 71 elaborates: the data subject is provided with meaningful
  information about the logic involved, as well as the significance and
  the envisaged consequences of such processing (delivered via Art 13(2)(f)
  / Art 14(2)(g) notices and the model-card excerpt at the decision
  surface).

## Solely-automated decisions in scope

| Use case | Art 22(2) ground | Human-in-the-loop step | Override authority |
| --- | --- | --- | --- |
| Underwriting classifier v3.2 | (a) contract | Post-decision review for all declines and edge cases | Senior underwriter |
| Fraud-detection v4.1 | (c) explicit consent (signup) | Post-decision review for severity >= 3 | Fraud-handler manager |

## Meaningful information about the logic

A "data-subject-facing model card" is published per use case at the
decision surface, covering: purpose; high-level logic; the categories of
inputs; the typical reasons a decline / hold may occur; how to request
human review; how to express a counter-narrative.

## Recital references applied

- Recital 71 (automated decisions including profiling -- safeguards)
- Recital 72 (consent or contract as the basis)

## Counter-hypothesis considered

Considered whether the fraud-detection step counts as "solely automated"
given the analyst review for severity >= 3; concluded that the lower-
severity holds (severity 1-2) are released or escalated without human
involvement and therefore the workflow as a whole must meet Art 22(3)
safeguards; documented accordingly.

## Auditor notes

(empty)
