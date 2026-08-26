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
