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

# COBIT 5: SWAO Community Framework

**Framework ID:** `COBIT_5`
**Version:** COBIT 5 (ISACA, 2012, ISBN 978-1-60420-237-3)
**Authority:** ISACA
**SWAO tier:** Community (shipped with SWAO; `swao framework install COBIT_5` copies it into the workspace)
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

Copy this `cobit-5/` folder into the workspace at
`<workspace>/wsp/inputs/catalogs/community/cobit-5/` (`swao framework install COBIT_5`
does this for you), then add it to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

```yaml
assessment:
  regimes_active: [COBIT_5]
```

## Control domains

| Domain | Abbreviation | Processes | Focus |
|---|---|---|---|
| Evaluate, Direct and Monitor | EDM | EDM01-05 | Board oversight, value delivery, risk optimisation |
| Align, Plan and Organise | APO | APO01-13 | Strategy, architecture, innovation, HR, suppliers |
| Build, Acquire and Implement | BAI | BAI01-10 | Programme management, change, configuration, testing |
| Deliver, Service and Support | DSS | DSS01-06 | Operations, incidents, business process controls |
| Monitor, Evaluate and Assess | MEA | MEA01-03 | Performance monitoring, internal controls, external compliance |

## Evidence sources

Controls are evaluated from CMDB data (service dependencies, change records), source code
analysis (configuration management signals, dependency management), and consultant-furnished
documents placed in `imports/`: governance statements, supplier agreements, internal audit
reports, capacity plans.

## Customising this framework

Edit the copied folder to adjust specific controls. The copy at
`wsp/inputs/catalogs/community/cobit-5/controls.yaml` is the catalogue SWAO evaluates for all
assessments in that workspace. See `CONTRIBUTING.md` for the full authoring
guide.

**Licensing note:** the control descriptions and assessor guidance in this catalogue were
re-authored in original SWAO wording (#3292, 2026-10-17); the remediation text is SWAO
practitioner advice. None of it is copied or adapted from ISACA material. Process IDs (EDM01 to MEA03) and process names are the COBIT 5
identifiers, used as factual references. Reference publication: ISACA, *COBIT 5: A Business
Framework for the Governance and Management of Enterprise IT* (2012, ISBN 978-1-60420-237-3).
COBIT is a registered trademark of ISACA. No ISACA publication is bundled with this folder;
see https://www.isaca.org for the official COBIT material.

## Contributor

SWAO Development Team (Accenture): https://github.com/Accenture/SWAO
https://github.com/Accenture/SWAO
