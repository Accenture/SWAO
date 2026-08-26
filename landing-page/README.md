=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Landing Page

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# SWAO Landing Page

Static marketing landing page for SWAO -- Sovereign Workload Assessment and
Onboarding. Lives at https://steady-echo-yp4z.here.now/ (served via static
hosting; source of truth is this directory).

## Files

```
landing-page/
-- index.html     Single-page landing site (self-contained; no build step)
-- README.md      This file
```

## Editing

`index.html` is a single self-contained file: HTML, CSS (inline `<style>`),
and JavaScript (inline `<script>`). No build step, no dependencies.

Edit directly and open in a browser to preview. The page uses:

- Inter font via Google Fonts (CDN)
- No framework or bundler

## Deployment

The file is served as-is from static hosting. To publish an updated version,
replace `index.html` at the hosting provider. The canonical URL is pinned in
`swao/SPEC.md section 1` and in `swao/dist-bin/README.txt`.

## Content guidelines

- No em-dashes (U+2014) or en-dashes (U+2013) -- use `--` or `,`
- No client names (Sovereign Health is the sole exception as the demo subject)
- No emojis
- Tier assignments must match `docs/strategy/012-feature-licence-tier-matrix.md`
- Assessment pass count and framework list must match `swao/SPEC.md`
