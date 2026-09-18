=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-app-assessment -- Application sovereignty assessment

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Community

Implements the Application Sovereignty Assessment: the primary SWAO assessment type. Analyses application workload files, IaC configuration, and optional context inputs to produce a sovereignty finding set and WSP output. One of the three core assessment types in SWAO v1.0.

## Install

```bash
pnpm add @swao/module-app-assessment
```

## Key API

- `registerAppAssessment(host) -- register assessment passes`
- `runAppAssessment(ctx) -- execute full assessment pipeline`
- `AppAssessmentResult -- typed finding/signal/score output`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO