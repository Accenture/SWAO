=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Controls Library

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# SWAO Controls Library

Runtime compliance asset that SWAO ships to assess client workloads.
Not to be confused with `docs/policies/accenture/` (development policies)
or `packages/@swao/` (source modules).

## Directory layout

```
controls/
-- lenses/                      Assessment lenses (cross-cutting overlays)
   -- cloud-migration.yaml      Migration readiness lens
   -- data-governance.yaml      Data governance lens
   -- security-focus.yaml       Security focus lens

-- dynamic-analysis/            Dynamic-analysis rules (Playwright-driven probes)

-- architecture-patterns-catalogue.yaml   Known architecture patterns
-- blind-spots-catalogue.yaml             Common assessment blind spots
-- cloud-provider-catalogue.yaml          Cloud provider metadata
-- db-compatibility-catalogue.yaml        Database compatibility rules
-- glossary.yaml                          Shared terminology
-- integration-patterns-catalogue.yaml    Integration pattern library
-- landing-zone-checks-catalogue.yaml     Landing-zone gate checks
-- legacy-indicators-catalogue.yaml       Legacy technology signals
-- licence-risk-catalogue.yaml            Licence risk classifications
-- observability-components-catalogue.yaml  Observability component patterns
-- pipeline-security-rules.yaml           CI/CD pipeline security rules
-- sovereign-service-catalogue.yaml       Sovereign-eligible service list
-- testing-maturity-catalogue.yaml        Testing maturity indicators
-- vendor-sdk-catalogue.yaml              Vendor SDK signal catalogue
```

## lenses/ vs dynamic-analysis/

| Subdirectory | Purpose | When loaded |
|---|---|---|
| `lenses/` | Static overlay rules applied on top of any assessment to focus scoring on a particular concern (migration, governance, security) | Always available; selected via `--lens` flag or `.swao.yml` |
| `dynamic-analysis/` | Rules that drive Playwright-based probes -- live browser interactions that generate screenshots and DOM snapshots for the dynamic analysis pass | Loaded only when the dynamic analysis pass runs (requires Playwright) |

## Versioning

Controls follow the SWAO product version. Breaking changes to a catalogue schema
trigger a minor version bump; breaking changes require a major bump. Old schemas
are retained for replay (SPEC.md section 10.1b).

## Community frameworks

Community compliance frameworks (GDPR, AI 10 Pillars, BSI C5, etc.) live in
`packages/@swao/community-frameworks/frameworks/` -- separate from these
catalogues because frameworks are selectable and user-extendable, while
catalogues are internal scoring inputs.
