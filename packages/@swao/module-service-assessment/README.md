=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-service-assessment -- Service Portfolio Assessment

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module-service-assessment

**Tier:** Community

Implements Service Portfolio Assessment (Design 103, ADR-0064): assesses third-party,
SaaS, and COTS applications from an Excel inventory with no source code required.
`swao service init` reads the intake workbook (default template or a custom
`column-map.yaml`), scrubs PII columns to boolean flags, classifies each row against
SWAO-INFRA-CAT, detects clusters, and scaffolds one `apps/<id>/.swao.yml` per app with
`assessment.type: service`.
