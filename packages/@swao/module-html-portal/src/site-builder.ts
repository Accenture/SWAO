// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML portal module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Mode B multi-page static site builder -- Design 041 §9 + issue #0437
 *
 * Generates a complete multi-page HTML site from a WSP run directory.
 * Does NOT use Eleventy at runtime; pages are rendered directly using
 * the existing renderBlock() function.
 *
 * TypeScript strict, NodeNext module resolution.
 */

import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

// Shared rendering engine relocated to the @swao/publication-render leaf (#0582).
import {
  extractPublicationModel,
  sanitisePII,
  buildTagIndex,
  buildSearchIndex,
  renderBlock,
} from '@swao/publication-render';
import type { PublicationModel, FrameworkResult } from '@swao/publication-render';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BuildModeBSiteOptions {
  wspRunDir: string;
  outDir: string;
  lang?: string;
  appId?: string;
  timestamp?: string;
  swaoVersion?: string;
  logger?: { info(m: string): void; warn(m: string): void };
}

export interface BuildModeBSiteResult {
  outDir: string;
  pageCount: number;
  sitemapPath: string;
}

// ---------------------------------------------------------------------------
// HTML escape helper
// ---------------------------------------------------------------------------

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Slug helper
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// App sidebar builder
// ---------------------------------------------------------------------------

interface SidebarSection {
  label: string;
  href: string;
  active?: boolean;
}

function buildAppSidebarHtml(
  appId: string,
  appName: string,
  baseHref: string,
  currentRel: string,
): string {
  const appBase = `${baseHref}apps/${appId}`;
  const sections: SidebarSection[] = [
    { label: 'Overview',         href: `${appBase}/index.html` },
    { label: 'Signals',          href: `${appBase}/signals/index.html` },
    { label: 'Compliance',       href: `${appBase}/compliance/index.html` },
    { label: 'Risk Register',    href: `${appBase}/risk-register/index.html` },
    { label: 'Evidence Gallery', href: `${appBase}/evidence/index.html` },
    { label: 'Run History',      href: `${appBase}/history/index.html` },
    { label: 'Methodology',      href: `${appBase}/methodology/index.html` },
    { label: 'Glossary',         href: `${baseHref}glossary/index.html` },
  ];

  const items = sections
    .map(s => {
      const isActive = currentRel.endsWith(s.href.replace(baseHref, ''));
      return `<li><a href="${esc(s.href)}"${isActive ? ' class="active" aria-current="page"' : ''}>${esc(s.label)}</a></li>`;
    })
    .join('\n          ');

  return `<div class="sidebar__section">
      <span class="sidebar__label">${esc(appName.toUpperCase())}</span>
      <ul class="sidebar__nav">
          ${items}
      </ul>
    </div>`;
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageShellOptions {
  title: string;
  breadcrumb: BreadcrumbItem[];
  content: string;
  lang: string;
  baseHref: string;
  sidebarHtml?: string;
  // Publication config (from .swao.yml) -- keeps Mode B visually in sync with Mode A
  classificationBand?: string;
  logoName?: string;
  logoSub?: string;
  // Nav context: 'site' = portfolio/global nav, 'app' = app section nav
  navContext?: 'site' | 'app';
  appId?: string;
  // Search index JSON to embed inline (same as Mode A)
  searchIndexJson?: string;
}

function buildPageShell(opts: PageShellOptions): string {
  const {
    title, breadcrumb, content, lang, baseHref, sidebarHtml,
    classificationBand = 'SWAO - Sovereign Workload Assessment & Onboarding',
    logoName = 'SWAO', logoSub = 'PUBLICATION',
    navContext = 'app', appId = '',
    searchIndexJson = '[]',
  } = opts;

  const breadcrumbHtml = breadcrumb
    .map((item, i) => {
      const isLast = i === breadcrumb.length - 1;
      if (isLast || !item.href) {
        return `<li class="breadcrumb-item" aria-current="${isLast ? 'page' : 'false'}">${esc(item.label)}</li>`;
      }
      return `<li class="breadcrumb-item"><a href="${esc(baseHref + item.href)}">${esc(item.label)}</a></li>`;
    })
    .join('\n      ');

  // App-level nav links to sibling pages within the same app
  const appBase = appId ? `${baseHref}apps/${appId}` : '';
  const appNavHtml = appId ? `
      <a href="${esc(appBase)}/index.html" data-nav-key="overview">Overview</a>
      <a href="${esc(appBase)}/signals/index.html" data-nav-key="signals">Signals</a>
      <a href="${esc(appBase)}/compliance/index.html" data-nav-key="compliance">Compliance</a>
      <a href="${esc(appBase)}/risk-register/index.html" data-nav-key="risk">Risk</a>
      <a href="${esc(appBase)}/methodology/index.html" data-nav-key="methodology">Methodology</a>` : '';

  // Site-level nav links to global index pages
  const siteNavHtml = `
      <a href="${esc(baseHref)}index.html">Portfolio</a>
      <a href="${esc(baseHref)}tags/index.html">Tags</a>
      <a href="${esc(baseHref)}frameworks/index.html">Frameworks</a>
      <a href="${esc(baseHref)}glossary/index.html">Glossary</a>`;

  const navHtml = navContext === 'app' && appId ? appNavHtml : siteNavHtml;

  return `<!DOCTYPE html>
<html lang="${esc(lang)}" data-theme="light" data-lang="${esc(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="generator" content="SWAO Publication Engine">
  <title>${esc(title)} | SWAO</title>
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="SWAO assessment publication">
  <link rel="stylesheet" href="${esc(baseHref)}assets/swao-pub.css">
</head>
<body>
  <div class="band band-top" role="banner" aria-label="Classification">${esc(classificationBand)}</div>
  <header class="site-header" role="banner">
    <button class="hamburger-btn" id="nav-hamburger" aria-label="Toggle navigation" aria-expanded="false">&#9776;</button>
    <div class="site-header__logo">
      <span class="site-header__logo-name">${esc(logoName)}</span>
      <span class="site-header__logo-sub">${esc(logoSub)}</span>
    </div>
    <nav class="site-header__nav" id="site-nav" aria-label="Main navigation">
      ${navHtml}
    </nav>
    <div class="site-header__search">
      <input type="search" id="swao-global-search" class="header-search-input" placeholder="Search..." autocomplete="off" aria-label="Search publication">
    </div>
    <div class="site-header__actions">
      <select id="lang-select" class="header-select" aria-label="Language" title="Language">
        <option value="en"${lang === 'en' ? ' selected' : ''}>EN</option>
        <option value="de"${lang === 'de' ? ' selected' : ''}>DE</option>
      </select>
      <button class="btn-icon" id="dark-mode-toggle" aria-label="Toggle dark mode" title="Toggle dark / light mode">Dark</button>
    </div>
  </header>
  <nav class="breadcrumb-bar" aria-label="breadcrumb">
    <ol class="breadcrumb">
      ${breadcrumbHtml}
    </ol>
  </nav>
  ${sidebarHtml ? `<div class="page-layout">
    <nav class="sidebar" id="swao-sidebar" aria-label="App navigation">
      ${sidebarHtml}
    </nav>
    <main class="main-content" id="main-content">
      ${content}
    </main>
  </div>` : `<main class="main-content" id="main-content">
    ${content}
  </main>`}
  <footer role="contentinfo">
    <div class="band band-bottom">${esc(classificationBand)}</div>
  </footer>
  <!-- Search overlay -->
  <div id="swao-search-overlay" role="dialog" aria-modal="true" aria-label="Search results" style="display:none;">
    <div class="search-overlay__header">
      <button class="btn-icon" id="swao-search-close" aria-label="Close search">&#8592; Back</button>
      <span id="swao-search-query-label"></span>
      <span id="swao-search-count"></span>
    </div>
    <div class="search-overlay__body" id="swao-search-results"></div>
  </div>
  <!-- Search index (embedded for offline/file:// use) -->
  <script type="application/json" id="swao-search-index">${searchIndexJson}</script>
  <script src="${esc(baseHref)}assets/swao-pub.js" defer></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export async function buildModeBSite(
  opts: BuildModeBSiteOptions,
): Promise<BuildModeBSiteResult> {
  const {
    wspRunDir,
    outDir,
    lang = 'en',
    swaoVersion,
    logger = { info: console.error, warn: console.warn },
  } = opts;

  const timestamp = opts.timestamp ?? new Date().toISOString();

  // 1. Extract + sanitise PII + build tag index
  logger.info(`[swao publish --site] Extracting model from ${wspRunDir}`);
  const model = await extractPublicationModel(wspRunDir, { swaoVersion });
  sanitisePII(model);

  // Populate the tag index (signals come out of extractor with tags: [])
  const populatedTagIndex = buildTagIndex(model);
  Object.assign(model.tags, populatedTagIndex);

  // 2. Set up output directory
  mkdirSync(outDir, { recursive: true });

  // Track pages and sitemap URLs
  let pageCount = 0;
  const sitemapUrls: string[] = [];

  // Extract publication config for consistent branding across all pages
  const pubCfg = model.meta.publication_config as Record<string, string> | undefined;
  const classificationBand = pubCfg?.classification_band ?? 'SWAO - Sovereign Workload Assessment & Onboarding';
  const logoName = pubCfg?.logo_name ?? 'SWAO';
  const logoSub = pubCfg?.logo_sub ?? 'PUBLICATION';

  // Build search index once and embed in every page (same as Mode A)
  const searchIndexJson = buildSearchIndex(model);

  // Helper: write one page
  function writePage(
    relPath: string,
    title: string,
    breadcrumb: BreadcrumbItem[],
    content: string,
    sidebarHtml?: string,
    navContext: 'site' | 'app' = 'app',
  ): void {
    // baseHref: number of segments minus 1 determines depth
    const segments = relPath.split('/');
    const depth = segments.length - 1;
    const baseHref = '../'.repeat(depth);

    const html = buildPageShell({
      title, breadcrumb, content, lang, baseHref, sidebarHtml,
      classificationBand, logoName, logoSub,
      navContext, appId: navContext === 'app' ? appId : undefined,
      searchIndexJson,
    });
    const absPath = join(outDir, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, html, 'utf-8');
    pageCount++;

    // Add to sitemap (use leading slash + directory path without index.html)
    const urlPath = '/' + relPath.replace(/index\.html$/, '');
    sitemapUrls.push(urlPath);
  }

  // 3. Copy assets
  const assetsOutDir = join(outDir, 'assets');
  mkdirSync(assetsOutDir, { recursive: true });

  // Resolve and copy static assets. Uses readFileSync try/catch -- existsSync
  // may return false for pkg snapshot virtual paths on Windows even when bundled.
  function copyAsset(name: string, destDir: string): boolean {
    // After esbuild bundling, __dirname = dist/ -- try publish/assets/ first.
    const candidates = [
      join(__dirname, 'publish', 'assets', name),
      join(__dirname, 'assets', name),
      join(__dirname, '..', 'publish', 'assets', name),
      join(__dirname, '..', 'assets', name),
      join(__dirname, '..', '..', 'src', 'publish', 'assets', name),
    ];
    for (const c of candidates) {
      try {
        const content = readFileSync(c);
        writeFileSync(join(destDir, name), content);
        return true;
      } catch { /* try next */ }
    }
    return false;
  }

  const cssOk = copyAsset('swao-pub.css', assetsOutDir);
  const jsOk  = copyAsset('swao-pub.js',  assetsOutDir);
  if (!cssOk) {
    logger.warn('[swao publish --site] swao-pub.css not found; skipping copy');
    writeFileSync(join(assetsOutDir, 'swao-pub.css'), '/* swao-pub.css not found */', 'utf-8');
  }
  if (!jsOk) {
    logger.warn('[swao publish --site] swao-pub.js not found; skipping copy');
    writeFileSync(join(assetsOutDir, 'swao-pub.js'), '/* swao-pub.js not found */', 'utf-8');
  }

  // Copy evidence files (best-effort)
  const evidenceOutDir = join(assetsOutDir, 'evidence');
  mkdirSync(evidenceOutDir, { recursive: true });
  for (const ev of model.evidence) {
    if (!ev.file) continue;
    const evSource = join(wspRunDir, ev.file);
    if (existsSync(evSource)) {
      const evDest = join(evidenceOutDir, basename(ev.file));
      try {
        copyFileSync(evSource, evDest);
      } catch {
        // Best-effort; skip on error
      }
    }
  }

  // 4. Derive app ID
  const appId = model.meta.app_id || 'app';
  const appName = model.meta.app_name || appId;

  // 5. Portfolio index page (siteAppHref so "View Assessment" links to the app page, not #anchor)
  const portfolioContent = renderBlock('portfolio-grid', { siteAppHref: `apps/${appId}/index.html` }, model);
  writePage('index.html', 'Portfolio', [{ label: 'Portfolio' }], portfolioContent, undefined, 'site');

  // 6. App pages
  const appBase = `apps/${appId}`;

  // Sidebar builder for app pages -- depth-aware baseHref computed per page
  function appSidebar(relPath: string): string {
    const segments = relPath.split('/');
    const depth = segments.length - 1;
    const bh = '../'.repeat(depth);
    return buildAppSidebarHtml(appId, appName, bh, relPath);
  }

  // App overview: exec-summary + coverage-bar + seven-r-card
  const overviewContent = [
    renderBlock('exec-summary', {}, model),
    renderBlock('coverage-bar', {}, model),
    renderBlock('seven-r-card', {}, model),
  ].join('\n');
  writePage(
    `${appBase}/index.html`,
    appName,
    [
      { label: 'Portfolio', href: 'index.html' },
      { label: appName },
    ],
    overviewContent,
    appSidebar(`${appBase}/index.html`),
  );

  // Signals
  writePage(
    `${appBase}/signals/index.html`,
    `${appName} - Signals`,
    [
      { label: 'Portfolio', href: 'index.html' },
      { label: appName, href: `${appBase}/index.html` },
      { label: 'Signals' },
    ],
    renderBlock('signal-list', {}, model),
    appSidebar(`${appBase}/signals/index.html`),
  );

  // Compliance (all frameworks)
  writePage(
    `${appBase}/compliance/index.html`,
    `${appName} - Compliance`,
    [
      { label: 'Portfolio', href: 'index.html' },
      { label: appName, href: `${appBase}/index.html` },
      { label: 'Compliance' },
    ],
    renderBlock('compliance-regime', {}, model),
    appSidebar(`${appBase}/compliance/index.html`),
  );

  // Per-framework compliance pages
  for (const fw of model.compliance as FrameworkResult[]) {
    const fwSlug = slugify(fw.framework_id);
    const fwModel: PublicationModel = {
      ...model,
      compliance: [fw],
    };
    writePage(
      `${appBase}/compliance/${fwSlug}/index.html`,
      `${appName} - ${fw.framework_name}`,
      [
        { label: 'Portfolio', href: 'index.html' },
        { label: appName, href: `${appBase}/index.html` },
        { label: 'Compliance', href: `${appBase}/compliance/index.html` },
        { label: fw.framework_name },
      ],
      renderBlock('compliance-regime', {}, fwModel),
      appSidebar(`${appBase}/compliance/${fwSlug}/index.html`),
    );
  }

  // Risk register
  writePage(
    `${appBase}/risk-register/index.html`,
    `${appName} - Risk Register`,
    [
      { label: 'Portfolio', href: 'index.html' },
      { label: appName, href: `${appBase}/index.html` },
      { label: 'Risk Register' },
    ],
    renderBlock('risk-register', {}, model),
    appSidebar(`${appBase}/risk-register/index.html`),
  );

  // Evidence gallery
  writePage(
    `${appBase}/evidence/index.html`,
    `${appName} - Evidence`,
    [
      { label: 'Portfolio', href: 'index.html' },
      { label: appName, href: `${appBase}/index.html` },
      { label: 'Evidence' },
    ],
    renderBlock('evidence-gallery', {}, model),
    appSidebar(`${appBase}/evidence/index.html`),
  );

  // Run history
  writePage(
    `${appBase}/history/index.html`,
    `${appName} - Run History`,
    [
      { label: 'Portfolio', href: 'index.html' },
      { label: appName, href: `${appBase}/index.html` },
      { label: 'Run History' },
    ],
    renderBlock('run-history', {}, model),
    appSidebar(`${appBase}/history/index.html`),
  );

  // Methodology
  writePage(
    `${appBase}/methodology/index.html`,
    `${appName} - Methodology`,
    [
      { label: 'Portfolio', href: 'index.html' },
      { label: appName, href: `${appBase}/index.html` },
      { label: 'Methodology' },
    ],
    renderBlock('methodology', {}, model),
    appSidebar(`${appBase}/methodology/index.html`),
  );

  // 7. Tags index
  const tagTaxonomyContent = renderBlock('tag-taxonomy', {}, model);
  writePage('tags/index.html', 'Tags', [{ label: 'Portfolio', href: 'index.html' }, { label: 'Tags' }], tagTaxonomyContent, undefined, 'site');

  // Per-tag pages
  for (const [tag, entries] of Object.entries(model.tags)) {
    const tagSlug = slugify(tag);
    if (!tagSlug) continue;

    const tagItems = entries
      .map(
        e =>
          `<li><a href="#${esc(e.anchor)}">${esc(e.label)}</a> <span class="badge badge-neutral">${esc(e.type)}</span></li>`,
      )
      .join('\n      ');

    const tagContent = `<section id="tag-${esc(tagSlug)}" class="swao-block">
  <h2>Tag: ${esc(tag)}</h2>
  <p>${esc(entries.length)} item(s) tagged <strong>${esc(tag)}</strong>.</p>
  <ul>
      ${tagItems}
  </ul>
</section>`;

    writePage(
      `tags/${tagSlug}/index.html`,
      `Tag: ${tag}`,
      [
        { label: 'Portfolio', href: 'index.html' },
        { label: 'Tags', href: 'tags/index.html' },
        { label: tag },
      ],
      tagContent,
    );
  }

  // 8. Frameworks index
  const frameworkCards = (model.compliance as FrameworkResult[])
    .map(
      fw => `
  <div class="framework-card" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:1rem;box-shadow:var(--shadow-sm);margin-bottom:1rem;">
    <h3 style="margin:0 0 0.5rem;">${esc(fw.framework_name)} <small style="color:var(--text-secondary);">(${esc(fw.framework_id)})</small></h3>
    <p style="margin:0;"><a href="frameworks/${esc(slugify(fw.framework_id))}/index.html">View compliance details</a></p>
  </div>`,
    )
    .join('');

  const frameworksIndexContent =
    frameworkCards.trim().length > 0
      ? `<section id="frameworks-list" class="swao-block"><h2>Frameworks</h2>${frameworkCards}</section>`
      : `<section id="frameworks-list" class="swao-block"><h2>Frameworks</h2><p style="color:var(--text-secondary);">No frameworks assessed.</p></section>`;

  writePage('frameworks/index.html', 'Frameworks', [{ label: 'Portfolio', href: 'index.html' }, { label: 'Frameworks' }], frameworksIndexContent, undefined, 'site');

  // Per-framework portfolio pages
  for (const fw of model.compliance as FrameworkResult[]) {
    const fwSlug = slugify(fw.framework_id);
    const fwModel: PublicationModel = {
      ...model,
      compliance: [fw],
    };
    writePage(
      `frameworks/${fwSlug}/index.html`,
      fw.framework_name,
      [
        { label: 'Portfolio', href: 'index.html' },
        { label: 'Frameworks', href: 'frameworks/index.html' },
        { label: fw.framework_name },
      ],
      renderBlock('compliance-regime', {}, fwModel),
    );
  }

  // 9. Glossary
  writePage('glossary/index.html', 'Glossary', [{ label: 'Portfolio', href: 'index.html' }, { label: 'Glossary' }], renderBlock('glossary', {}, model), undefined, 'site');

  // 10. Sitemap
  const sitemapPath = join(outDir, 'sitemap.xml');
  const sitemapEntries = sitemapUrls
    .map(u => `  <url><loc>${esc(u)}</loc></url>`)
    .join('\n');
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</urlset>`;
  writeFileSync(sitemapPath, sitemapXml, 'utf-8');

  logger.info(
    `[swao publish --site] Done. ${pageCount} pages written to ${outDir}. Generated: ${timestamp}`,
  );

  return { outDir, pageCount, sitemapPath };
}
