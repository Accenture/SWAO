// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Canonical bundled slot-marker template (D2 -- #0931).
 *
 * Single source of truth for the default Level 1 HTML shell. Both the
 * production renderer (@swao/module-html-report) and the HTML Editor preview
 * import from this file, guaranteeing that editor previews are byte-identical
 * to the production publication in terms of page chrome (Design 068 §20.11.1 D2).
 *
 * Previously: renderer.ts held a local `BUNDLED_TEMPLATE` constant, and
 * publication-render/editor/template.ts held a stripped `BUNDLED_TEMPLATE_CONTENT`.
 * Both are now aliases to this export.
 */

export const PUBLICATION_TEMPLATE = `<!DOCTYPE html>
<html lang="en" data-theme="light" data-lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="SWAO Publication Engine">
  <title>{{meta.app_name}} -- {{publication_title}}</title>
  <meta property="og:title" content="{{meta.app_name}} -- {{publication_title}}">
  <meta property="og:description" content="Sovereign workload assessment for {{meta.app_name}}">
  <!-- swao:css -->
</head>
<body>
  <div class="band band-top" role="banner" aria-label="Classification">{{publication_config.classification_band}}</div>

  <header class="site-header" role="banner">
    <button class="hamburger-btn" id="nav-hamburger" aria-label="Toggle navigation" aria-expanded="false">&#9776;</button>
    <a class="site-header__logo" href="#cover" style="text-decoration:none;color:inherit;">
      <span class="site-header__logo-name">{{publication_config.logo_name}}</span>
      <span class="site-header__logo-sub">{{publication_config.logo_sub}}</span>
    </a>
    <span class="site-header__logo-links" style="font-size:0.7rem;font-weight:400;align-self:center;padding-left:0.5rem;white-space:nowrap;">[<a href="{{publication_config.github_url}}" data-swao-link="github" target="_blank" rel="noopener" style="color:var(--brand-accent);">Github</a>, <a href="{{publication_config.docs_url}}" data-swao-link="docs" target="_blank" rel="noopener" style="color:var(--brand-accent);">Docs</a>]</span>
    <nav class="site-header__nav" aria-label="Main navigation">
      <a href="#cover" data-nav-key="overview" data-i18n-key="nav.overview">Overview</a>
      <a href="#signal-list" data-nav-key="signals" data-i18n-key="nav.signals">Signals</a>
      <a href="#compliance-regime" data-nav-key="compliance" data-i18n-key="nav.compliance">Compliance</a>
      <a href="#controls" data-nav-key="controls" data-i18n-key="nav.controls">Controls</a>
      <a href="#risk-register" data-nav-key="risk" data-i18n-key="nav.risk">Risk</a>
      <a href="#methodology" data-nav-key="methodology" data-i18n-key="nav.methodology">Methodology</a>
    </nav>
    <div class="site-header__search">
      <input type="search" id="swao-global-search" class="header-search-input" placeholder="Search…" autocomplete="off" aria-label="Search publication" data-i18n-key="ui.search_placeholder">
    </div>
    <div class="site-header__actions">
      <select id="lang-select" class="header-select" aria-label="Language" title="Language">
        <option value="en">EN</option>
        <option value="de">DE</option>
      </select>
      <button class="btn-icon" id="dark-mode-toggle" aria-label="Toggle dark mode" title="Toggle dark / light mode">Dark</button>
    </div>
  </header>

  <nav class="breadcrumb-bar" aria-label="breadcrumb">
    <ol class="breadcrumb">
      <li><a href="engagement-hub.html" data-i18n-key="nav.portfolio">Engagement Hub</a></li>
      <li><strong>{{meta.app_id}}</strong></li>
    </ol>
  </nav>

  <div class="page-layout">
    <nav class="sidebar" id="swao-sidebar" aria-label="App navigation">
      <div class="sidebar__section">
        <span class="sidebar__label">{{meta.app_id}}</span>
        <ul class="sidebar__nav" id="swao-sidebar-nav">
          <!-- populated by initSidebar() from section ids in the document -->
        </ul>
      </div>
    </nav>

    <main class="main-content" id="main-content">
      <!-- SWAO:slot name="cover" -->
      <!-- SWAO:slot name="quick-nav" -->
      <!-- SWAO:slot name="coverage-bar" -->
      <!-- SWAO:slot name="exec-summary" -->
      <!-- SWAO:slot name="seven-r-card" -->
      <!-- SWAO:slot name="signal-list" -->
      <!-- SWAO:slot name="compliance-regime" -->
      <!-- SWAO:slot name="compliance-framework-detail" -->
      <!-- SWAO:slot name="compliance-matrix" -->
      <!-- SWAO:slot name="compliance-requirements" -->
      <!-- SWAO:slot name="controls" -->
      <!-- SWAO:slot name="risk-register" -->
      <!-- SWAO:slot name="evidence-gallery" -->
      <!-- SWAO:slot name="lzr-summary" -->
      <!-- SWAO:slot name="stakeholder-challenge" -->
      <!-- SWAO:slot name="delta-view" -->
      <!-- SWAO:slot name="run-history" -->
      <!-- SWAO:slot name="assessment-scope" -->
      <!-- SWAO:slot name="runbook" -->
      <!-- SWAO:slot name="glossary" -->
      <!-- SWAO:slot name="methodology" -->
      <!-- SWAO:slot name="footer" -->
    </main>
  </div>

  <!-- Search results overlay -->
  <div id="swao-search-overlay" role="dialog" aria-modal="true" aria-label="Search results" style="display:none;">
    <div class="search-overlay__header">
      <button class="btn-icon" id="swao-search-close" aria-label="Close search">&#8592; Back</button>
      <span id="swao-search-query-label"></span>
      <span id="swao-search-count"></span>
    </div>
    <div class="search-overlay__body" id="swao-search-results"></div>
  </div>

  <!-- swao:js -->
</body>
</html>`;

/**
 * Bundled slot-marker template for Landing Zone Catalog publications (Design 068 Phase 3A).
 * Used by the HTML Editor when block_profile is 'lz-catalog', and by renderLzCatalogPage.
 * Slots: cover, lzr-catalog-header, lzr-catalog-verdict, lz-catalog-services,
 *        lzr-catalog-findings, lzr-catalog-remediation, lzr-catalog-finops,
 *        evidence-gallery, run-history.
 */
export const LZ_CATALOG_TEMPLATE = `<!DOCTYPE html>
<html lang="en" data-theme="light" data-lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="SWAO Publication Engine">
  <title>{{meta.app_name}} -- Landing Zone Catalog</title>
  <meta property="og:title" content="{{meta.app_name}} -- Landing Zone Catalog">
  <meta property="og:description" content="Landing zone assessment catalog for {{meta.app_name}}">
  <!-- swao:css -->
</head>
<body>
  <div class="band band-top" role="banner" aria-label="Classification">{{publication_config.classification_band}}</div>

  <header class="site-header" role="banner">
    <button class="hamburger-btn" id="nav-hamburger" aria-label="Toggle navigation" aria-expanded="false">&#9776;</button>
    <a class="site-header__logo" href="#cover" style="text-decoration:none;color:inherit;">
      <span class="site-header__logo-name">{{publication_config.logo_name}}</span>
      <span class="site-header__logo-sub">{{publication_config.logo_sub}}</span>
    </a>
    <nav class="site-header__nav" aria-label="Main navigation">
      <a href="#cover" data-nav-key="overview">Overview</a>
      <a href="#lzr-catalog-verdict" data-nav-key="verdicts">Verdicts</a>
      <a href="#lz-catalog-services" data-nav-key="services">Services</a>
      <a href="#lzr-catalog-findings" data-nav-key="findings">Findings</a>
      <a href="#lzr-catalog-finops" data-nav-key="finops">Intel</a>
    </nav>
    <div class="site-header__actions">
      <button class="btn-icon" id="dark-mode-toggle" aria-label="Toggle dark mode" title="Toggle dark / light mode">Dark</button>
    </div>
  </header>

  <nav class="breadcrumb-bar" aria-label="breadcrumb">
    <ol class="breadcrumb">
      <li><a href="engagement-hub.html">Engagement Hub</a></li>
      <li><strong>{{meta.app_id}}</strong></li>
      <li>Landing Zone Assessment</li>
    </ol>
  </nav>

  <div class="page-layout">
    <nav class="sidebar" id="swao-sidebar" aria-label="LZ Catalog navigation">
      <div class="sidebar__section">
        <span class="sidebar__label">{{meta.app_id}}</span>
        <ul class="sidebar__nav" id="swao-sidebar-nav">
          <!-- populated by initSidebar() from section ids in the document -->
        </ul>
      </div>
    </nav>

    <main class="main-content" id="main-content">
      <!-- SWAO:slot name="cover" -->
      <!-- SWAO:slot name="lzr-catalog-header" -->
      <!-- SWAO:slot name="lzr-catalog-verdict" -->
      <!-- SWAO:slot name="lz-catalog-services" -->
      <!-- SWAO:slot name="lzr-catalog-findings" -->
      <!-- SWAO:slot name="lzr-catalog-remediation" -->
      <!-- SWAO:slot name="lzr-catalog-finops" -->
      <!-- SWAO:slot name="evidence-gallery" -->
      <!-- SWAO:slot name="run-history" -->
    </main>
  </div>

  <!-- swao:js -->
</body>
</html>`;
