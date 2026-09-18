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
 * Bundled slot-marker template for LLM Assessment publications -- Design 092
 * s8, L5 (#1428).
 *
 * Used by renderModeALlm in @swao/module-html-report. Eight slots:
 *   llm.header             -- app name, legs, run timestamp
 *   llm.final-ranking      -- weighted composite ranking table
 *   llm.group-breakdown    -- per-dimension group breakdown
 *   llm.pass-table         -- per-pass aggregates across legs
 *   llm.findings           -- operational findings from the run
 *   llm.challenge-results  -- per-leg challenge resilience (#1587, Enterprise)
 *   llm.methodology        -- scoring methodology note
 *   llm.narrative          -- LLM-generated executive summary (optional)
 */
export const LLM_ASSESSMENT_TEMPLATE = `<!DOCTYPE html>
<html lang="en" data-theme="light" data-lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="SWAO Publication Engine">
  <title>{{meta.app_name}} -- LLM Assessment Report</title>
  <meta property="og:title" content="{{meta.app_name}} -- LLM Assessment Report">
  <meta property="og:description" content="LLM Assessment comparison for {{meta.app_name}}">
  <!-- swao:css -->
</head>
<body>
  <div class="band band-top" role="banner" aria-label="Classification">{{publication_config.classification_band}}</div>

  <header class="site-header" role="banner">
    <button class="hamburger-btn" id="nav-hamburger" aria-label="Toggle navigation" aria-expanded="false">&#9776;</button>
    <a class="site-header__logo" href="#llm-header" style="text-decoration:none;color:inherit;">
      <span class="site-header__logo-name">{{publication_config.logo_name}}</span>
      <span class="site-header__logo-sub">{{publication_config.logo_sub}}</span>
    </a>
    <nav class="site-header__nav" aria-label="Main navigation">
      <a href="#llm-header" data-nav-key="overview">Overview</a>
      <a href="#llm-final-ranking" data-nav-key="ranking">Final Ranking</a>
      <a href="#llm-group-breakdown" data-nav-key="breakdown">Breakdown</a>
      <a href="#llm-pass-table" data-nav-key="passes">Passes</a>
      <a href="#llm-pass-deep-dive" data-nav-key="deep-dive">Pass Detail</a>
      <a href="#llm-findings" data-nav-key="findings">Findings</a>
      <a href="#llm-challenge-results" data-nav-key="challenge">Challenge</a>
      <a href="#llm-model-detail" data-nav-key="providers">Providers</a>
      <a href="#llm-methodology" data-nav-key="methodology">Methodology</a>
    </nav>
    <div class="site-header__actions">
      <button class="btn-icon" id="dark-mode-toggle" aria-label="Toggle dark mode" title="Toggle dark / light mode">Dark</button>
    </div>
  </header>

  <nav class="breadcrumb-bar" aria-label="breadcrumb">
    <ol class="breadcrumb">
      <li><a href="engagement-hub.html">Engagement Hub</a></li>
      <li><strong>{{meta.app_id}}</strong></li>
      <li>LLM Assessment</li>
    </ol>
  </nav>

  <div class="page-layout">
    <nav class="sidebar" id="swao-sidebar" aria-label="LLM Assessment navigation">
      <div class="sidebar__section">
        <span class="sidebar__label">{{meta.app_id}}</span>
        <ul class="sidebar__nav" id="swao-sidebar-nav">
          <!-- populated by initSidebar() from section ids in the document -->
        </ul>
      </div>
    </nav>

    <main class="main-content" id="main-content">
      <!-- SWAO:slot name="llm.header" -->
      <!-- SWAO:slot name="llm.narrative" -->
      <!-- SWAO:slot name="llm.final-ranking" -->
      <!-- SWAO:slot name="llm.group-breakdown" -->
      <!-- SWAO:slot name="llm.pass-table" -->
      <!-- SWAO:slot name="llm.pass-deep-dive" -->
      <!-- SWAO:slot name="llm.findings" -->
      <!-- SWAO:slot name="llm.challenge-results" -->
      <!-- SWAO:slot name="llm.model-detail" -->
      <!-- SWAO:slot name="llm.methodology" -->
    </main>
  </div>

  <!-- swao:js -->
</body>
</html>`;
