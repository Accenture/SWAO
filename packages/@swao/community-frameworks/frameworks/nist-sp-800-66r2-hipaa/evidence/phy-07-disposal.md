---
control_id: HIPAA-PHY-07
framework_id: NIST_SP_800_66R2
collected_at: 2026-05-23
collected_by: consultant
classification: regulatory
---

# HIPAA-PHY-07 -- Disposal (Required) -- 164.310(d)(2)(i)

## Verdict (consultant-asserted)

outcome: SATISFIED
severity: high
rationale: >-
  Secure disposal follows NIST SP 800-88 Revision 1 guidance: SSDs are
  cryptographically erased using vendor-supplied secure-erase commands;
  HDDs are degaussed and then physically shredded; tape media is
  shredded; paper is cross-cut shredded to particle size <= 4 mm. A
  contracted ITAD vendor (NAID AAA-certified) handles physical
  destruction with chain-of-custody documentation. Disposal certificates
  are retained for 7 years (above the 6-year HIPAA-PND-02 minimum).
  Quarterly spot-audits in 2025 found 100% certificate coverage on a
  sample of 30 disposals. Cloud storage uses provider's documented
  secure-erase APIs at decommissioning.

## Evidence references

- Disposal Procedure v2.4 (2025-09-15)
- ITAD vendor contract (NAID AAA certificate of compliance attached)
- Disposal certificate register 2026-Q1 -- 47 disposals, all documented
- 2025 spot-audit report -- 30/30 sample compliance
- Cloud-provider secure-erase confirmation logs (3 instances decommissioned 2026-Q1)

## Counter-hypothesis considered

Considered whether cloud-tenant decommissioning leaves residual data on
shared infrastructure; reviewed the cloud provider's SOC 2 Type II
report and BAA -- both attest to cryptographic shredding of customer
keys at tenant termination, rendering residual ciphertext
unrecoverable. Documented in the BAA file.

## Auditor notes

(empty -- filled in at sign-off)
