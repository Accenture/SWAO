=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Documentation Site

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# SWAO Documentation Site

VitePress-based documentation published to
`https://accenture.github.io/SWAO/` via the `gh-pages` branch.

## Local development

```bash
cd docs-site
npm install
npm run dev        # live-reload preview at http://localhost:5173/SWAO/
npm run build      # production build -> .vitepress/dist/
```

## Content sync

Markdown source lives in the private development repository under
`swao/docs/` and `swao/docs/de/`. Run the sync script to pull the
latest content into this site before building:

```bash
node sync-content.mjs
```

The script copies runbooks, feature pages, and the getting-started
guide from their source locations into the VitePress content tree.
Never edit the synced files directly -- edit the source in `docs/`
and re-run the sync.

## Deploying

The `pages.yml` GitHub Actions workflow builds and deploys the site
automatically on every push to `main`. To deploy manually:

```bash
npm run build
# push .vitepress/dist/ to the gh-pages branch
```

### Landing Zone catalogue pages

The factual part of `swao/docs/lz-catalogues/*.md` and `swao/docs/de/lz-catalogues/*.md`
(summary, regions, certifications, usage) is generated from `swao/lz-catalogues/*.json`
by `node swao/docs-site/scripts/generate-lz-catalogue-pages.mjs`. Only the block between the
`lz-catalogue-facts` marker comments is rewritten; the title and the hand-written
introduction are kept. Run it after a catalogue refresh; `--check` exits 1 when a page is
out of date. A new catalogue gets a page with a placeholder introduction that must be
replaced by hand, plus a sidebar entry in `.vitepress/config.ts`. The audit gate
`tests/audit-gates/lz-catalogue-docs.gate.mjs` fails when a catalogue has no page or a
page has no catalogue.
