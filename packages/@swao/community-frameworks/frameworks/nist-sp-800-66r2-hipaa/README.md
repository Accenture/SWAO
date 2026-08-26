<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     NIST SP 800-66r2 / HIPAA -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# HIPAA Security Rule / NIST SP 800-66r2 -- SWAO Community Framework

**Framework ID:** `NIST_SP_800_66R2`
**Version:** NIST SP 800-66 Revision 2 (February 2024) / HIPAA Security Rule (45 CFR Part 164 Subpart C)
**Authority:** U.S. Department of Health and Human Services (HHS); NIST
**SWAO tier:** Community (install required -- `swao framework install NIST_SP_800_66R2`)
**Controls:** 49 controls expanding the HIPAA Security Rule implementation specifications

## What this framework evaluates

NIST SP 800-66 Revision 2 provides implementation guidance for the HIPAA Security Rule,
the U.S. federal regulation protecting electronic protected health information (ePHI). This
framework evaluates whether a healthcare workload satisfies the Administrative, Physical, and
Technical safeguards required of HIPAA-covered entities and business associates. SWAO maps
each implementation specification to signals from code analysis passes and to compliance
documents provided by the healthcare organisation.

This framework applies to any workload that stores, processes, or transmits ePHI, including
cloud-based EHR systems, health data analytics platforms, and telehealth applications
migrating to sovereign or regulated cloud environments.

## How to activate in SWAO

Install the framework, then add to your workspace `.swao.yml`:

```bash
swao framework install NIST_SP_800_66R2
```

```yaml
compliance:
  frameworks: [NIST_SP_800_66R2]
```

## Control domains

| Domain | Controls | HIPAA safeguard |
|---|---|---|
| Administrative safeguards | 22 | Risk analysis, workforce training, access management, contingency planning |
| Physical safeguards | 9 | Facility access, workstation security, device disposal |
| Technical safeguards | 10 | Access controls, audit controls, integrity, transmission security |
| Organisational requirements | 4 | Business Associate Agreements, group health plans |
| Policies, procedures, documentation | 4 | Documentation requirements, retention |

## Customising this framework

Install a local copy to override specific controls for your engagement:

```bash
swao framework install NIST_SP_800_66R2
```

The installed copy at `catalogs/community/nist-sp-800-66r2-hipaa/controls.yaml` overrides
the bundled version. See `CONTRIBUTING.md` for the authoring guide.

## Contributor

Helmut Schindlwick (Accenture SWAO team) -- https://github.com/Accenture/SWAO
https://github.com/Accenture/SWAO

**Authoritative sources:**
- NIST SP 800-66r2: https://doi.org/10.6028/NIST.SP.800-66r2
- HIPAA Security Rule: https://www.hhs.gov/hipaa/for-professionals/security/
