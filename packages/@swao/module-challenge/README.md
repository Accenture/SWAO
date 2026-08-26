=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-challenge -- Stakeholder Challenge pass

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Enterprise

Implements the Stakeholder Challenge pass: a structured AI-facilitated challenge session where stakeholder personas (CTO, CISO, DPO, CFO, Cloud Architect) review and challenge the sovereignty assessment findings. Surfaces assumptions, identifies risks, and produces a challenge report. Requires an Enterprise licence.

## Install

```bash
pnpm add @swao/module-challenge
```

## Key API

- `registerChallenge(host) -- register swao challenge command`
- `ChallengeSession -- multi-persona challenge orchestrator`
- `ChallengeReport -- per-stakeholder challenge outcome`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO