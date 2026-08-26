=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-health-check -- swao health-check command (16 probes)

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Community

Implements the swao health-check command. Runs 16 diagnostic probes covering LLM connectivity, workspace validity, framework registration, licence status, and provider reachability. Identifies configuration problems before an assessment run.

## Install

```bash
pnpm add @swao/module-health-check
```

## Key API

- `registerHealthCheck(host) -- register the health-check command`
- `HealthCheckReport -- typed probe result set`
- `ProbeResult -- individual probe outcome (pass/warn/fail)`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO