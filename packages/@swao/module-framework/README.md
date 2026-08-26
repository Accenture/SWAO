=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-framework -- Framework loading and registry abstraction

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Community

The framework loading layer. Discovers, validates, and registers compliance frameworks from the workspace and the bundled community catalogue. Implements the framework-meta.yaml and controls.yaml schema.

## Install

```bash
pnpm add @swao/module-framework
```

## Key API

- `registerFrameworkModule(host) -- wire framework loader into SWAO`
- `FrameworkRegistry -- query frameworks by ID or tag`
- `loadFramework(path) -- parse and validate a framework directory`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO