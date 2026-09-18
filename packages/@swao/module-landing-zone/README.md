=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-landing-zone -- LZ Catalogue Sovereignty Assessment

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Consultant

Implements the Landing Zone Catalogue Sovereignty Assessment: evaluates a CSP landing zone catalogue (AWS Control Tower, Azure Landing Zone, GCP Landing Zone) against sovereignty and compliance lenses. One of the three core assessment types in SWAO v1.0. Requires a Consultant or Enterprise licence.

## Install

```bash
pnpm add @swao/module-landing-zone
```

## Key API

- `registerLzAssessment(host) -- register LZ assessment passes`
- `LzCatalogueInput -- catalogue specification schema`
- `LzAssessmentResult -- sovereignty verdict per catalogue entry`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO