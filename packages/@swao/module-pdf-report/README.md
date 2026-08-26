=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-pdf-report -- PDF report renderer

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Consultant

Renders a completed SWAO assessment as a professional PDF report suitable for client delivery. Uses the same publication model as module-html-report but outputs a print-ready PDF with Accenture branding. Requires a Consultant or Enterprise licence.

## Install

```bash
pnpm add @swao/module-pdf-report
```

## Key API

- `registerPdfReport(host) -- register swao publish --pdf flag`
- `renderPdf(publication, opts) -- render HTML publication to PDF`
- `PdfOptions -- page size, branding, section selection`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO