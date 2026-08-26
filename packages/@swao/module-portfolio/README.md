=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-portfolio -- Portfolio aggregation (swao portfolio)

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Enterprise

Implements portfolio-level assessment aggregation: runs assessments across multiple applications in a workspace and produces an executive portfolio summary with cross-application sovereignty scoring and risk roll-up. Requires an Enterprise licence.

## Install

```bash
pnpm add @swao/module-portfolio
```

## Key API

- `registerPortfolio(host) -- register swao portfolio command`
- `PortfolioRun -- multi-app orchestrator`
- `PortfolioSummary -- aggregated scoring and risk matrix`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO