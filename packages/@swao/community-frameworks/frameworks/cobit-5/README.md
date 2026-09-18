<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     COBIT 5 -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# COBIT 5 -- SWAO Community Framework

**Framework ID:** `COBIT_5`
**Version:** COBIT 5 (ISACA, 2012 -- ISBN 978-1-60420-237-3)
**Authority:** ISACA
**SWAO tier:** Community (install required -- `swao framework install COBIT_5`)
**Controls:** 37 process controls across 5 COBIT 5 domains

## What this framework evaluates

COBIT 5 evaluates the IT governance and management posture of a workload in the context of
a cloud migration or audit programme. Controls map to the five COBIT 5 governance and
management domains: Evaluate, Direct and Monitor (EDM); Align, Plan and Organise (APO);
Build, Acquire and Implement (BAI); Deliver, Service and Support (DSS); Monitor, Evaluate
and Assess (MEA). SWAO maps each process to evidence collected from source code analysis,
CMDB data, and consultant-furnished governance documents.

COBIT 5 is appropriate for engagements where the client is subject to IT audit obligations,
board-level IT governance review, or regulatory alignment across multiple frameworks.

## How to activate in SWAO

Install the framework, then add to your workspace `.swao.yml`:

```bash
swao framework install COBIT_5
```

```yaml
compliance:
  frameworks: [COBIT_5]
```

## Control domains

| Domain | Abbreviation | Processes | Focus |
|---|---|---|---|
| Evaluate, Direct and Monitor | EDM | EDM01-05 | Board oversight, value delivery, risk optimisation |
| Align, Plan and Organise | APO | APO01-14 | Strategy, architecture, innovation, HR, suppliers |
| Build, Acquire and Implement | BAI | BAI01-10 | Programme management, change, configuration, testing |
| Deliver, Service and Support | DSS | DSS01-06 | Operations, incidents, business process controls |
| Monitor, Evaluate and Assess | MEA | MEA01-03 | Performance monitoring, internal controls, external compliance |

## Evidence sources

Controls are evaluated from CMDB data (service dependencies, change records), source code
analysis (configuration management signals, dependency management), and consultant-furnished
documents placed in `imports/`: governance statements, supplier agreements, internal audit
reports, capacity plans.

## Customising this framework

Install a local copy to override specific controls:

```bash
swao framework install COBIT_5
```

The installed copy at `catalogs/community/cobit-5/controls.yaml` overrides the bundled
version for all assessments in that workspace. See `CONTRIBUTING.md` for the full authoring
guide.

**Licensing note:** COBIT 5 is copyright (c) 2012 ISACA -- all rights reserved. This
catalogue paraphrases process descriptions for assessment purposes; it does not redistribute
the verbatim ISACA text or figures. Implementers should review https://www.isaca.org for
usage and redistribution terms.

## Contributor

SWAO Development Team (Accenture) -- https://github.com/Accenture/SWAO
https://github.com/Accenture/SWAO
