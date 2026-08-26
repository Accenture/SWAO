<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     ISO 27001 -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# ISO/IEC 27001:2022 -- SWAO Community Framework

**Framework ID:** `ISO_27001`
**Version:** ISO/IEC 27001:2022
**Authority:** International Organization for Standardization (ISO)
**SWAO tier:** Community (install required -- `swao framework install ISO_27001`)
**Controls:** Information Security Management System controls (PoC depth; deeper catalogue in progress)

## What this framework evaluates

ISO/IEC 27001:2022 assesses whether a workload's supporting information security posture
meets the requirements of the international ISMS standard. The 2022 revision introduces
93 controls in Annex A (updated from ISO 27001:2013's 114 controls), organised into four
themes: Organisational, People, Physical, and Technological controls. SWAO maps Annex A
controls to signals from code analysis passes (IAM, CRYPTO, EGR, OBS) and to the ISMS
documentation the client provides.

ISO 27001 is the world's most widely-adopted information security standard and is required
or strongly preferred by procurement teams in financial services, healthcare, government,
and regulated industries across all geographies.

## How to activate in SWAO

Install the framework, then add to your workspace `.swao.yml`:

```bash
swao framework install ISO_27001
```

```yaml
compliance:
  frameworks: [ISO_27001]
```

## Control themes (ISO 27001:2022 Annex A)

| Theme | Controls | Focus |
|---|---|---|
| Organisational | A.5 (37 controls) | Policies, roles, intelligence, supplier relationships |
| People | A.6 (8 controls) | Screening, training, remote working, disciplinary process |
| Physical | A.7 (14 controls) | Physical perimeter, clear desk, equipment |
| Technological | A.8 (34 controls) | Access, cryptography, malware, backup, logging, monitoring |

## Customising this framework

```bash
swao framework install ISO_27001
```

The installed copy at `catalogs/community/iso-27001/controls.yaml` overrides the bundled
version. See `CONTRIBUTING.md` for the authoring guide.

**Note:** This is a PoC-depth packaging (5 controls). The full Annex A catalogue is available
from ISO (https://www.iso.org). A full-depth SWAO packaging is tracked as a community
contribution opportunity.

## Contributor

Helmut Schindlwick (Accenture SWAO team) -- https://github.com/Accenture/SWAO
https://github.com/Accenture/SWAO
