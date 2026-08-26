=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-iac -- IaC provider abstraction (Terraform, OpenTofu)

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Community

Infrastructure-as-Code provider abstraction. Discovers Terraform and OpenTofu configuration files in workspace inputs, extracts provider declarations, resource inventories, and variable definitions for use by the static analysis pass.

## Install

```bash
pnpm add @swao/module-iac
```

## Key API

- `registerIacModule(host) -- wire IaC provider into SWAO`
- `IacInventory -- parsed provider/resource/variable inventory`
- `discoverIacFiles(dir) -- walk directory and classify HCL files`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO