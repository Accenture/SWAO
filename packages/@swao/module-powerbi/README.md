=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-powerbi -- Power BI export (swao bi-export)

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Enterprise

Exports SWAO assessment results to Power BI-compatible format: generates a star-schema XLSX dataset and a pre-built .pbit Power BI template file ready for import. Supports portfolio-level aggregation across multiple runs. Requires an Enterprise licence.

## Install

```bash
pnpm add @swao/module-powerbi
```

## Key API

- `registerBiExport(host) -- register swao bi-export command`
- `buildStarSchema(runs) -- assemble fact + dimension tables`
- `writePbit(schema, outputDir) -- emit XLSX + .pbit template`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO