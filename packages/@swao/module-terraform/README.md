=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-terraform -- Terraform generation (swao generate-tf)

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Consultant

Generates Terraform infrastructure code from SWAO assessment results and landing zone recommendations. Produces ready-to-apply .tf files for the target CSP. Requires a Consultant or Enterprise licence.

## Install

```bash
pnpm add @swao/module-terraform
```

## Key API

- `registerGenerateTf(host) -- register swao generate-tf command`
- `TfGenerationPlan -- resource plan derived from LZ assessment`
- `writeTfFiles(plan, outputDir) -- emit .tf files to disk`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO