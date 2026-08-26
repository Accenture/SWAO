=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-html-report -- HTML publication (swao publish)

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Consultant

Implements the swao publish command and HTML assessment publication. Takes a completed WSP run and renders a self-contained, shareable HTML report. Integrates with publication-render for block-profile selection. Requires a Consultant or Enterprise licence.

## Install

```bash
pnpm add @swao/module-html-report
```

## Key API

- `registerPublish(host, deps) -- register swao publish command`
- `PublishOptions -- block profile, output path, evidence base URL`
- `buildPublication(run, opts) -- render WSP run to HTML file`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO