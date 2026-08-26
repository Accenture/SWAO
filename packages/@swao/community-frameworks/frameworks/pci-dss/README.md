<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     PCI DSS -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# PCI DSS v4.0 -- SWAO Community Framework

**Framework ID:** `PCI_DSS`
**Version:** PCI DSS v4.0 (effective March 2024)
**Authority:** PCI Security Standards Council (PCI SSC)
**SWAO tier:** Community (install required -- `swao framework install PCI_DSS`)
**Controls:** Payment Card Industry Data Security Standard controls (PoC depth; deeper catalogue in progress)

## What this framework evaluates

PCI DSS assesses whether a workload that stores, processes, or transmits payment card data
meets the requirements of the Payment Card Industry Data Security Standard version 4.0. The
12 PCI DSS requirements cover network security, account data protection, vulnerability
management, strong access controls, monitoring, and information security policies. Cloud
migration projects that move cardholder data environments (CDEs) to sovereign cloud must
demonstrate PCI DSS compliance.

PCI DSS v4.0 introduces the Customised Approach as an alternative to the Defined Approach,
allowing organisations to design their own controls to meet the security objective of each
requirement.

## How to activate in SWAO

Install the framework, then add to your workspace `.swao.yml`:

```bash
swao framework install PCI_DSS
```

```yaml
compliance:
  frameworks: [PCI_DSS]
```

## Control requirements

| Requirement | Focus |
|---|---|
| 1-2 | Network security controls; secure configurations |
| 3-4 | Account data protection; cryptographic controls |
| 5-6 | Vulnerability management; secure development |
| 7-8 | Identity and access management |
| 9 | Physical access to cardholder data |
| 10-11 | Logging, monitoring, and testing |
| 12 | Information security policy and programme |

## Customising this framework

```bash
swao framework install PCI_DSS
```

The installed copy at `catalogs/community/pci-dss/controls.yaml` overrides the bundled
version. See `CONTRIBUTING.md` for the authoring guide.

**Note:** This is a PoC-depth packaging (5 controls at Requirements 3.4, 4.1, 6.2, 8.3, 10).
The full PCI DSS v4.0 standard is available from https://www.pcisecuritystandards.org.
A full-depth SWAO packaging is tracked as a community contribution opportunity.

## Contributor

Helmut Schindlwick (Accenture SWAO team) -- https://github.com/Accenture/SWAO
https://github.com/Accenture/SWAO
