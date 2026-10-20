<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     GDPR -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# General Data Protection Regulation (GDPR) -- SWAO Community Framework

**Framework ID:** `GDPR`
**Version:** Regulation (EU) 2016/679 -- in force since 2018-05-25
**Authority:** European Parliament and Council of the European Union
**SWAO tier:** Community (install required -- `swao framework install GDPR`)
**Controls:** 53 controls across Chapters II-V + transfer safeguards

## What this framework evaluates

GDPR assesses whether a workload migrating to sovereign cloud meets the obligations of
Regulation (EU) 2016/679. Controls span the full data-subject lifecycle: lawful basis for
processing, data subject rights (access, erasure, portability, objection), controller and
processor accountability, technical security measures, breach notification obligations, and
third-country transfer safeguards. SWAO maps each control to evidence collected from code
analysis passes (CRYPTO, IAM, EGR, DATA) and from consultant-furnished documents (lawful
basis register, DPAs, RoPA, DPIAs).

## How to activate in SWAO

Install the framework with `swao framework install GDPR`, then add it to the app's `.swao.yml` (`apps/<app-id>/.swao.yml`):

```yaml
assessment:
  regimes_active: [GDPR]
```

Then run the application assessment for that app:

```bash
swao assess --app <app-id>
```

## Control domains

| Domain | Controls | Key articles |
|---|---|---|
| Chapter II: Principles | 12 | Art. 5-11 (principles, lawfulness, consent, special categories) |
| Chapter III: Data subject rights | 12 | Art. 12-23 (transparency, access, erasure, portability, objection, automated decisions) |
| Chapter IV: Controller and processor | 23 | Art. 24-42 (accountability, processors, RoPA, security, breach notification, DPIA, DPO) |
| Chapter V: Third-country transfers | 6 | Art. 44-49 (adequacy decisions, Standard Contractual Clauses, BCRs, derogations) |

## Evidence sources

Controls are evaluated from:

- Automated code analysis: CRYPTO pass (encryption at rest and in transit), IAM pass (access controls), EGR pass (data egress endpoints), DATA pass (personal data markers in source code).
- Consultant-furnished documents in `imports/`: lawful basis register, Data Processing Agreements, Records of Processing Activities, Data Protection Impact Assessments.

## Customising this framework

Install a local copy to override specific controls for your engagement:

```bash
swao framework install GDPR
```

The installed copy at `wsp/inputs/catalogs/community/gdpr/controls.yaml` overrides the bundled version
for all assessments in that workspace. Edit the YAML to add jurisdiction-specific controls,
adjust severity weights, or extend evidence requirements. See `CONTRIBUTING.md` at the
repository root for the full authoring guide.

## Contributor

SWAO Development Team (Accenture) -- https://github.com/Accenture/SWAO
https://github.com/Accenture/SWAO

**Authoritative source:** EUR-Lex canonical text at
https://eur-lex.europa.eu/eli/reg/2016/679/oj
