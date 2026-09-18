---
control_id: GDPR_Art_28
framework_id: GDPR
collected_at: 2026-05-22
collected_by: consultant
classification: client-internal
---

# Processor Agreements (Art 28 DPA) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  Of the 17 processors in scope (vendor register
  `governance/processors.yaml`), 15 have a written Art 28 contract
  (typically the standard DPA template aligned with EDPB Guidelines
  07/2020) covering the eight Art 28(3) clauses. Two processors are on
  legacy contracts pre-dating the 2018 GDPR application: tracker
  DPA-2026-016 owns the renewal with target 2026-Q3. None of the 17
  contracts authorises onward sub-processing without controller
  notification; the sub-processor register is reviewed quarterly.

## Eight Art 28(3) clauses verified per contract

(a) Processes only on documented instructions of the controller, including with regard to third-country transfers, unless required to do so by Union or Member State law.
(b) Ensures persons authorised to process the personal data have committed themselves to confidentiality or are under an appropriate statutory obligation of confidentiality.
(c) Takes all measures required pursuant to Article 32.
(d) Respects the conditions in paragraphs 2 and 4 for engaging another processor (sub-processor notification + flow-down).
(e) Assists the controller by appropriate technical and organisational measures, insofar as this is possible, for the fulfilment of the controller's obligation to respond to requests for exercising the data subject's rights (Articles 12-22).
(f) Assists the controller in ensuring compliance with the obligations pursuant to Articles 32 to 36 (security; breach notification; DPIA; prior consultation).
(g) At the choice of the controller, deletes or returns all the personal data to the controller after the end of the provision of services relating to processing, and deletes existing copies unless Union or Member State law requires storage.
(h) Makes available to the controller all information necessary to demonstrate compliance with the obligations laid down in this Article, and allows for and contributes to audits.

## Audit-right exercise (Art 28(3)(h))

The right to audit is exercised through SOC 2 Type II reports for 14
processors; the remaining 3 (small SaaS) accept on-site audits with 30
days' notice (none exercised in the last 12 months).

## Evidence references

- `governance/processors.yaml` (17 entries)
- Standard DPA template v3.0 (filed legal LEG-DPA-TPL-030)
- Sub-processor register (refreshed 2026-04-30)

## Counter-hypothesis considered

Considered whether the two legacy contracts could be allowed to expire
naturally rather than be renewed early; rejected because the residual-
risk window (12-18 months) was deemed unacceptable by the CISO.

## Auditor notes

(empty)
