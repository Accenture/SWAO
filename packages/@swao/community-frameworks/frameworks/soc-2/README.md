<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     SOC 2 -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# SOC 2 -- SWAO Community Framework

**Framework ID:** `SOC_2`
**Version:** AICPA Trust Services Criteria (2017 revised)
**Authority:** American Institute of Certified Public Accountants (AICPA)
**SWAO tier:** Community (install required -- `swao framework install SOC_2`)
**Controls:** Trust Services Criteria controls (PoC depth; deeper catalogue in progress)

## What this framework evaluates

SOC 2 assesses whether a SaaS or B2B service provider's systems meet the AICPA Trust
Services Criteria for Security, Availability, Processing Integrity, Confidentiality, and
Privacy. A SOC 2 Type II audit report is required by enterprise buyers in the US market and
is increasingly expected globally for cloud service providers handling sensitive data. SWAO
maps the Common Criteria (CC) security baseline controls to signals from code analysis passes
and from consultant-furnished documentation.

SOC 2 applies to any organisation that provides cloud-based software or services to other
businesses and needs to demonstrate trustworthiness to customers and auditors.

## How to activate in SWAO

Install the framework, then add to your workspace `.swao.yml`:

```bash
swao framework install SOC_2
```

```yaml
compliance:
  frameworks: [SOC_2]
```

## Trust Services Criteria

| Category | Controls | Focus |
|---|---|---|
| Security (CC) | CC6, CC7, CC8, CC9 | Logical access, encryption, change management, risk management |
| Availability (A) | A1 | System availability commitments; capacity management |
| Processing Integrity (PI) | PI1 | Complete, accurate, timely processing |
| Confidentiality (C) | C1 | Data identified as confidential; protection and disposal |
| Privacy (P) | P1-P8 | Personal information collection, use, retention, disclosure |

## Customising this framework

```bash
swao framework install SOC_2
```

The installed copy at `catalogs/community/soc-2/controls.yaml` overrides the bundled
version. See `CONTRIBUTING.md` for the authoring guide.

**Note:** This is a PoC-depth packaging (5 controls covering the CC security baseline). The
full Trust Services Criteria publication is available from https://www.aicpa.org. A
full-depth SWAO packaging is tracked as a community contribution opportunity.

## Contributor

Helmut Schindlwick (Accenture SWAO team) -- https://github.com/Accenture/SWAO
https://github.com/Accenture/SWAO
