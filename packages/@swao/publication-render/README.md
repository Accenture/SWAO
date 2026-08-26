=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/publication-render -- Shared HTML publication renderer

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/publication

**Tier:** Community

Shared HTML publication rendering logic. Takes a WSP assessment result and emits a self-contained HTML file. Used by module-html-report (Consultant) and module-html-portal (Consultant).

## Install

```bash
pnpm add @swao/publication-render
```

## Key API

- `renderPublication(result, opts) -- render assessment to HTML string`
- `PublicationOptions -- rendering configuration`
- `BlockProfile -- publication block/profile selector`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO