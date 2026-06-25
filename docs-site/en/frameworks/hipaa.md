---
title: HIPAA
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->


# HIPAA

## What is HIPAA?

The Health Insurance Portability and Accountability Act of 1996 (HIPAA) is a United States
federal law that establishes national standards for the protection of sensitive patient health
information, known as Protected Health Information (PHI). The HIPAA Security Rule, published
in 2003, specifies technical, administrative, and physical safeguards that covered entities
and their business associates must implement.

Covered entities include healthcare providers, health plans, and healthcare clearinghouses.
Business associates -- such as cloud service providers that process PHI on behalf of covered
entities -- are directly subject to HIPAA obligations under the HITECH Act.

## Why it Matters for Cloud Migration

Migrating healthcare workloads to the cloud requires careful attention to HIPAA obligations:

- **Business Associate Agreements (BAAs)** -- a BAA must be in place with every cloud provider
  that creates, receives, maintains, or transmits PHI.
- **Access controls** -- access to PHI must be restricted to the minimum necessary for each
  user's role, with access logs retained.
- **Data in transit and at rest** -- PHI must be encrypted whenever it traverses a network or
  is stored on persistent media.
- **Audit trails** -- all access to, and modifications of, PHI must be logged and those logs
  retained for a minimum of six years.
- **Contingency planning** -- disaster recovery and data backup plans must specifically address
  PHI availability and integrity.

## What SWAO Checks

The HIPAA framework in SWAO covers the following control domains:

| Domain | Examples of Controls Assessed |
|--------|-------------------------------|
| Access management | Unique user identification, automatic logoff, emergency access procedures |
| Audit controls | Activity logging configuration, log retention policy, SIEM integration |
| Encryption | PHI at-rest encryption, TLS version enforcement, key rotation policy |
| Integrity | Checksums or digital signatures on PHI records, tamper detection |
| Transmission security | VPN or TLS for all PHI in transit, certificate pinning where applicable |
| BAA coverage | Cloud provider BAA status, sub-processor chain verification |

## Example Finding

```
Control:   164.312(a)(1) -- Access Control
Severity:  High
Finding:   IAM policy "ehr-reader" grants s3:GetObject on all buckets, not scoped to PHI prefix.
Evidence:  iam/policies/ehr-reader.json -- Resource: ["arn:aws:s3:::*"]
Guidance:  Restrict the resource to the specific bucket and key prefix containing PHI.
           Reference: https://www.hhs.gov/hipaa/for-professionals/security/index.html
```

## Further Reading

- [HHS HIPAA Security Rule summary](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html)
- [HHS guidance on cloud computing and HIPAA](https://www.hhs.gov/hipaa/for-professionals/special-topics/cloud-computing/index.html)
