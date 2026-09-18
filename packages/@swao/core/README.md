=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/core -- Plugin registry, WSP schema, LicenseGuard

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/core

**Tier:** Community

The foundational library shared by all SWAO modules. Provides the plugin registry, WSP (Workspace Profile) schema types, LicenseGuard runtime tier-gating, signal types, and shared utilities.

## Install

```bash
pnpm add @swao/core
```

## Key API

- `LicenseGuard.requireTier(tier, options) -- enforce tier gate`
- `normalizeTier(raw) -- parse tier string`
- `WspSchema -- Zod schema for WSP NDJSON`
- `PluginRegistry -- register and resolve SWAO modules`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO