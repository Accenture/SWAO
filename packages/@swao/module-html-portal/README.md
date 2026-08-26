=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    @swao/module-html-portal -- HTML Editor portal (--edit)

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# @swao/module

**Tier:** Consultant

Implements the HTML publication editor portal: an in-browser rich-text editor integrated with SWAO that allows consultants to annotate, customise, and finalise HTML assessment reports before delivery. Accessible via swao publish --edit. Requires a Consultant or Enterprise licence.

## Install

```bash
pnpm add @swao/module-html-portal
```

## Key API

- `registerHtmlPortal(host) -- wire editor into swao publish`
- `portalServer(opts) -- start local editor server`
- `HtmlPortalSession -- editor session state`

## Licence

Apache-2.0 -- see [LICENSE](../../LICENSE) in the repository root.

Community Edition source and all Apache-2.0 content:
https://github.com/Accenture/SWAO