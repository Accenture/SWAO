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
 * HTML Portal builder -- Sprint 064 #0582, Design 058 D-PORTAL-4
 *
 * Builds a multi-page portfolio portal as a LIVE data view over the workspace
 * YAML. The defining property (D-PORTAL-4): every portal page is assembled
 * through the SAME pipeline the single-page publication uses -- the slot-marker
 * template shell + `assemblePublicationPage` (renderBlock per slot + inlined
 * swao-pub.css) from the @swao/publication-render leaf. The portal contributes only TWO things of its
 * own: (1) which slots a given page declares (the grouped subset), and (2) a
 * top nav linking the portal pages. The block HTML and the style come unchanged
 * from the publication, so style + content parity is STRUCTURAL: the portal
 * cannot drift from the publication because it renders the identical components.
 *
 * This is the root cause fix for the earlier deactivation, where the old Mode B
 * site-builder rendered its own divergent markup + a linked stylesheet.
 *
 * WHY this now lives in @swao/module-html-portal (Consultant tier): #0582 built
 * the portal in @swao/module-html-report first, to PROVE parity against the
 * single-page publication it sat beside. Module-split stage 2 (Sprint 064, this
 * change) relocates the portal renderer here per the approved design (058 §4
 * D-PORTAL-1), with the shared primitives already in the @swao/publication-render
 * leaf (stage 1). The Community `publish` command stays in
 * @swao/module-html-report and reaches buildPortalSite by host injection (it may
 * not import this sibling Consultant module).
 *
 * Increment 2 (#0582) adds the portfolio-level aggregate pages, all rendered
 * through the SAME assemblePublicationPage pipeline (D-PORTAL-4): the programme
 * dashboard (Design 058 §5 roll-ups), the cross-app tags index and the cross-app
 * frameworks index, plus the `Programme` nav entry (now a live link, so no dead
 * link is shipped). The aggregates are derived here from each app's
 * PublicationModel; the markup reuses the existing swao-pub.css card/table/badge
 * classes (swao-card / card-grid / stats-strip / badge / rag / callout), so the
 * dashboard cannot drift from the publication's styling -- NO portal-only sheet.
 *
 * TODO (D-PORTAL-3 follow-up): the shared `risk-register` block computes an
 * `OVERDUE` marker relative to `new Date()`, so a risk page with past
 * target_dates is NOT day-stable across runs. This is a pre-existing block-level
 * nondeterminism inherited from the single-page publication (Mode A has it too),
 * not introduced here. The portal output is byte-stable for inputs without
 * overdue risk dates; making the date reference injectable is the proper fix and
 * belongs with the dashboard work, since it touches the shared block.
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname, resolve as pathResolve } from 'path';

// Shared rendering engine relocated to the @swao/publication-render leaf (#0582).
// assemblePublicationPage is the shared publication pipeline (renderBlock per
// slot + inlined swao-pub.css). The portal inlines the CSS THROUGH this function
// (the `<!-- swao:css -->` marker -> the same <style id="swao-pub-css"> the
// publication emits), so the builder never resolves/copies a stylesheet itself.
// buildTagIndex is the SAME helper the publication uses to derive per-app tags
// (severity / pass-prefix / outcome / explicit tags / framework_id / status / ...).
// The cross-app tags page aggregates its per-app output so the taxonomy matches
// the single-page publication's tag derivation exactly (D-PORTAL-4).
import {
  extractPublicationModel,
  sanitisePII,
  assemblePublicationPage,
  renderAppCard,
  buildTagIndex,
} from '@swao/publication-render';
import type { PublicationModel, FrameworkResult, RiskRegisterItem } from '@swao/publication-render';

// ---------------------------------------------------------------------------
// Options + result
// ---------------------------------------------------------------------------

export interface BuildPortalSiteOptions {
  /** Workspace root (the directory containing `apps/`). */
  workspace: string;
  /** Output directory for the generated portal. */
  outDir: string;
  /** Restrict the build to a single app id (`--site-app <id>`); rebuilds one app. */
  appId?: string;
  lang?: string;
  /**
   * Fixed generated_at injected into every page (Design 058 D-PORTAL-3). The
   * portal omits timestamps from the page body for byte-stable output; this only
   * feeds the machine-readable swao-pub-data JSON, so a fixed value -> identical
   * builds. Defaults to the empty string for determinism.
   */
  timestamp?: string;
  swaoVersion?: string;
  logger?: { info(m: string): void; warn(m: string): void };
}

export interface BuildPortalSiteResult {
  outDir: string;
  pageCount: number;
  /**
   * App ids that actually rendered (model extracted + pages written). Apps whose
   * WSP failed to extract are discovered but excluded here, so this is the true
   * operator-facing count, not the raw discovery count.
   */
  appIds: string[];
  /** Relative paths of every page written, in write order. */
  pages: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** App id allowlist (mirrors portal/server.ts sanitizeAppId; CodeQL path-injection). */
function isSafeAppId(raw: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(raw);
}

/**
 * Locate an app's latest WSP run directory. Prefers the canonical
 * `wsp/latest.txt` pointer the CLI writes ("runs/<ts>"), falling back to the
 * newest run dir by name. Mirrors the discovery in publish.ts / portal/server.ts
 * so the portal is a live view over the same runs Mode A publishes.
 */
function findLatestRun(workspace: string, appId: string): string | null {
  // Resolve to canonical paths + verify the result stays under the workspace
  // (CodeQL js/path-injection). latest.txt content is operator-writable, so a
  // `../../..` pointer must not be allowed to escape the workspace. Mirrors the
  // containment guard in portal/server.ts.
  const wsRoot = pathResolve(workspace);
  const appWsp = join(workspace, 'apps', appId, 'wsp');
  const runsDir = pathResolve(appWsp, 'runs');
  if (!runsDir.startsWith(wsRoot)) return null;
  if (!existsSync(runsDir)) return null;

  const latestPtr = pathResolve(appWsp, 'latest.txt');
  if (latestPtr.startsWith(wsRoot) && existsSync(latestPtr)) {
    const rel = readFileSync(latestPtr, 'utf-8').trim();
    if (rel) {
      const pointed = pathResolve(appWsp, rel);
      if (pointed.startsWith(wsRoot) && existsSync(pointed)) return pointed;
    }
  }

  const runs = readdirSync(runsDir).sort().reverse();
  if (runs.length === 0) return null;
  return join(runsDir, runs[0]);
}

/** Discover assessable apps in the workspace (those with a wsp/runs dir). */
function discoverApps(workspace: string): string[] {
  const appsDir = join(workspace, 'apps');
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir)
    .filter(name => isSafeAppId(name) && existsSync(join(appsDir, name, 'wsp', 'runs')))
    .sort(); // deterministic order (Design 058 D-PORTAL-3)
}

// ---------------------------------------------------------------------------
// Portal page template (publication shell + grouped slot subset + portal nav)
// ---------------------------------------------------------------------------

interface NavLink {
  href: string;
  label: string;
  active?: boolean;
}

/**
 * Build a portal-page template: the publication's slot-marker shell with a
 * portal-specific top nav and ONLY the requested slot markers in <main>. Feeding
 * this to `assemblePublicationPage` yields a page rendered through the exact
 * publication pipeline (inlined swao-pub.css via the `<!-- swao:css -->` marker,
 * the same renderBlock output, the same term wrapping). The nav reuses the
 * publication's existing `site-header__nav` classes -- no portal-only stylesheet.
 */
function buildPortalTemplate(args: {
  title: string;
  lang: string;
  nav: NavLink[];
  breadcrumb: Array<{ label: string; href?: string }>;
  slots: string[];
}): string {
  const { title, lang, nav, breadcrumb, slots } = args;

  const navHtml = nav
    .map(n => `<a href="${esc(n.href)}"${n.active ? ' class="active" aria-current="page"' : ''}>${esc(n.label)}</a>`)
    .join('\n      ');

  const breadcrumbHtml = breadcrumb
    .map((item, i) => {
      const isLast = i === breadcrumb.length - 1;
      if (isLast || !item.href) {
        return `<li><strong>${esc(item.label)}</strong></li>`;
      }
      return `<li><a href="${esc(item.href)}">${esc(item.label)}</a></li>`;
    })
    .join('\n      ');

  const slotMarkers = slots.map(s => `      <!-- SWAO:slot name="${s}" -->`).join('\n');

  // Mirrors renderer.ts BUNDLED_TEMPLATE structure (band -> header -> breadcrumb
  // -> main) so the publication CSS lays it out identically. The `<!-- swao:css -->`
  // marker is the load-bearing parity hook: inlineAssets replaces it with the
  // same <style id="swao-pub-css"> the publication inlines.
  return `<!DOCTYPE html>
<html lang="${esc(lang)}" data-theme="light" data-lang="${esc(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="SWAO Publication Engine">
  <title>${esc(title)} -- SWAO Portal</title>
  <meta property="og:title" content="${esc(title)} -- SWAO Portal">
  <meta property="og:description" content="SWAO portfolio portal">
  <!-- swao:css -->
</head>
<body>
  <div class="band band-top" role="banner" aria-label="Classification">{{publication_config.classification_band}}</div>

  <header class="site-header" role="banner">
    <button class="hamburger-btn" id="nav-hamburger" aria-label="Toggle navigation" aria-expanded="false">&#9776;</button>
    <div class="site-header__logo">
      <span class="site-header__logo-name">{{publication_config.logo_name}}</span>
      <span class="site-header__logo-sub">{{publication_config.logo_sub}}</span>
    </div>
    <nav class="site-header__nav" id="portal-nav" aria-label="Portal navigation">
      ${navHtml}
    </nav>
    <div class="site-header__actions">
      <button class="btn-icon" id="dark-mode-toggle" aria-label="Toggle dark mode" title="Toggle dark / light mode">Dark</button>
    </div>
  </header>

  <nav class="breadcrumb-bar" aria-label="breadcrumb">
    <ol class="breadcrumb">
      ${breadcrumbHtml}
    </ol>
  </nav>

  <main class="main-content" id="main-content">
${slotMarkers}
  </main>

  <!-- swao:js -->
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Per-app page plan (grouped slot subsets -- the only portal-specific layer)
// ---------------------------------------------------------------------------

interface AppPagePlan {
  /** Relative path under apps/<id>/ */
  rel: string;
  title: string;
  slots: string[];
  navKey: string;
  /** Predicate: only emit this page when the model actually has the data. */
  has: (m: PublicationModel) => boolean;
}

// Overview always renders (cover/exec/seven-r/coverage derive from meta+summary,
// which always exist). The rest are conditional on their collection being
// non-empty so empty pages are skipped gracefully (#0582).
const APP_PAGE_PLANS: AppPagePlan[] = [
  { rel: 'index.html', title: 'Overview', navKey: 'overview',
    slots: ['cover', 'exec-summary', 'seven-r-card', 'coverage-bar'],
    has: () => true },
  { rel: 'signals/index.html', title: 'Signals', navKey: 'signals',
    slots: ['signal-list'],
    has: m => m.signals.length > 0 },
  { rel: 'compliance/index.html', title: 'Compliance', navKey: 'compliance',
    slots: ['compliance-regime'],
    has: m => m.compliance.length > 0 },
  { rel: 'risk/index.html', title: 'Risk', navKey: 'risk',
    slots: ['risk-register'],
    has: m => m.risk_register.length > 0 },
  { rel: 'evidence/index.html', title: 'Evidence', navKey: 'evidence',
    slots: ['evidence-gallery'],
    has: m => m.evidence.length > 0 },
];

// ---------------------------------------------------------------------------
// Cross-app aggregation (Design 058 §5 -- the only portal-specific layer beyond
// slot grouping). Every aggregate is derived from the per-app PublicationModels
// and SORTED on a stable key before rendering, so the dashboard is byte-stable
// (D-PORTAL-3). NO new Date() is used anywhere here -- the two known block-level
// nondeterminism sources (risk-register OVERDUE marker, footer date) are not
// replicated, and the dashboard never declares a `footer` slot.
// ---------------------------------------------------------------------------

/** Canonical severity order, shared with the publication blocks (blocks.ts). */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'informational', 'positive'] as const;

/** Numeric severity rank for stable cross-app risk sorting (lower = worse). */
const SEVERITY_RANK: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3, informational: 4, positive: 5,
};

/**
 * Readiness band for one app (Design 058 §5).
 *
 * Definition (derived from the model fields the task names -- blocker_count +
 * coverage_score; documented here because Design 058 §5 leaves the thresholds to
 * the operator):
 *   - `blocked`           : blocker_count > 0 (an LZR blocker must be cleared
 *                           before migration -- this matches the exec-summary's
 *                           "blockers must be resolved" callout).
 *   - `ready`             : no blockers AND coverage_score >= 0.8 (high assessment
 *                           coverage, nothing blocking).
 *   - `ready_with_changes`: no blockers but coverage_score < 0.8 (assessable, but
 *                           gaps remain -- the "ready with changes" middle band).
 *
 * The `sovereignty_blocked` band from Design 058 §5 is INTENTIONALLY OMITTED: the
 * PublicationModel (model.ts) exposes no sovereignty verdict field (no such field
 * on summary / meta / lzr), so manufacturing one from a tag convention would be a
 * guess. When the model later encodes sovereignty explicitly, add the band here.
 */
type ReadinessBand = 'ready' | 'ready_with_changes' | 'blocked';

function readinessBand(model: PublicationModel): ReadinessBand {
  if (model.summary.blocker_count > 0) return 'blocked';
  if (model.summary.coverage_score >= 0.8) return 'ready';
  return 'ready_with_changes';
}

const BAND_LABELS: Record<ReadinessBand, string> = {
  ready: 'Ready',
  ready_with_changes: 'Ready with changes',
  blocked: 'Blocked',
};

/**
 * Group the highest-severity risks across apps into portfolio-wide patterns.
 *
 * Grouping key (documented because Design 058 §5 leaves it open): a risk's
 * `signal_ref` when present, else its `trigger` text. WHY not `risk_id`: risk ids
 * are per-app sequential (RR-001 recurs in every app) and would false-merge
 * unrelated risks. The same underlying signal / trigger recurring across apps IS
 * the portfolio-wide pattern Design 058 §5 wants surfaced.
 */
interface CrossAppRiskGroup {
  key: string;
  /** Display label: the shared trigger text. */
  trigger: string;
  /** Worst severity seen across the grouped occurrences. */
  worstSeverity: string;
  /** App ids affected, sorted. */
  apps: string[];
}

function aggregateCrossAppRisks(
  appIds: string[],
  models: Map<string, PublicationModel>,
): CrossAppRiskGroup[] {
  const groups = new Map<string, { trigger: string; worstRank: number; worstSev: string; apps: Set<string> }>();
  for (const id of appIds) {
    const m = models.get(id);
    if (!m) continue;
    for (const r of m.risk_register as RiskRegisterItem[]) {
      const sev = r.severity ?? '';
      const key = r.signal_ref && r.signal_ref.length > 0 ? `sig:${r.signal_ref}` : `trg:${r.trigger}`;
      const rank = SEVERITY_RANK[sev] ?? 9;
      const existing = groups.get(key);
      if (existing) {
        existing.apps.add(id);
        if (rank < existing.worstRank) { existing.worstRank = rank; existing.worstSev = sev; }
      } else {
        groups.set(key, { trigger: r.trigger, worstRank: rank, worstSev: sev, apps: new Set([id]) });
      }
    }
  }

  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      trigger: g.trigger,
      worstSeverity: g.worstSev,
      apps: [...g.apps].sort(),
    }))
    // Stable order: worst severity first, then most-shared, then key (D-PORTAL-3).
    .sort((a, b) => {
      const ra = SEVERITY_RANK[a.worstSeverity] ?? 9;
      const rb = SEVERITY_RANK[b.worstSeverity] ?? 9;
      if (ra !== rb) return ra - rb;
      if (b.apps.length !== a.apps.length) return b.apps.length - a.apps.length;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
}

/** Severity badge using the publication's badge classes (mirrors blocks.ts sevBadge). */
function portalSevBadge(severity: string): string {
  const cls = ({
    critical: 'badge-critical', high: 'badge-high', medium: 'badge-medium',
    low: 'badge-low', informational: 'badge-info', positive: 'badge-positive',
  } as Record<string, string>)[severity] ?? 'badge-neutral';
  const label = severity ? severity.charAt(0).toUpperCase() + severity.slice(1) : '';
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

/**
 * Embed a pre-rendered aggregate <main> body into a slot-less portal template
 * (mirrors how the portfolio index injects its grid). Keeping the splice in one
 * place ensures every aggregate page flows through assemblePublicationPage with
 * the SAME css/js inlining + meta interpolation as the publication.
 */
function embedAggregateBody(template: string, bodyHtml: string): string {
  return template.replace(
    '<main class="main-content" id="main-content">\n\n  </main>',
    `<main class="main-content" id="main-content">\n      ${bodyHtml}\n  </main>`,
  );
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildPortalSite(
  opts: BuildPortalSiteOptions,
): Promise<BuildPortalSiteResult> {
  const {
    workspace,
    outDir,
    lang = 'en',
    timestamp = '',
    swaoVersion,
    logger = { info: console.error, warn: console.warn },
  } = opts;

  const allApps = discoverApps(workspace);
  // --site-app <id> rebuilds one app's pages (still re-reads its live run).
  const targetApps = opts.appId
    ? allApps.filter(a => a === opts.appId)
    : allApps;

  if (opts.appId && targetApps.length === 0) {
    throw new Error(`App '${opts.appId}' not found in workspace (no apps/${opts.appId}/wsp/runs)`);
  }

  mkdirSync(outDir, { recursive: true });

  const pages: string[] = [];
  let pageCount = 0;

  // Load every app's model up front (live view over the YAML). The portfolio
  // index needs all of them even when --site-app targets one app.
  const models = new Map<string, PublicationModel>();
  for (const id of allApps) {
    const runDir = findLatestRun(workspace, id);
    if (!runDir) {
      logger.warn(`[swao publish --site] No run found for ${id}; skipping`);
      continue;
    }
    try {
      const model = await extractPublicationModel(runDir, { swaoVersion });
      sanitisePII(model);
      models.set(id, model);
    } catch (err) {
      logger.warn(`[swao publish --site] Failed to extract ${id}: ${String(err)}`);
    }
  }

  // Pick branding off any app's model (publication_config is identical per
  // workspace .swao.yml); fall back to defaults via empty interpolation.
  const firstModel = models.values().next().value as PublicationModel | undefined;

  function writePage(rel: string, html: string): void {
    const abs = join(outDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, html, 'utf-8');
    pages.push(rel);
    pageCount++;
  }

  // baseHref helper: depth from a page's rel path to the portal root.
  function baseHrefFor(rel: string): string {
    const depth = rel.split('/').length - 1;
    return '../'.repeat(depth);
  }

  // The site-level nav links shown on every page (Design 058 §3 nav set):
  // Portfolio | Programme | Tags | Frameworks | <one entry per app>. The
  // Programme/Tags/Frameworks pages all exist now (increment 2), so none of these
  // is a dead link. Reuses the publication's site-header__nav classes.
  function siteNav(baseHref: string, activeKey: string): NavLink[] {
    const links: NavLink[] = [
      { href: `${baseHref}index.html`, label: 'Portfolio', active: activeKey === 'portfolio' },
      { href: `${baseHref}programme/index.html`, label: 'Programme', active: activeKey === 'programme' },
      { href: `${baseHref}tags/index.html`, label: 'Tags', active: activeKey === 'tags' },
      { href: `${baseHref}frameworks/index.html`, label: 'Frameworks', active: activeKey === 'frameworks' },
    ];
    for (const id of allApps) {
      const m = models.get(id);
      if (!m) continue;
      links.push({
        href: `${baseHref}apps/${id}/index.html`,
        label: m.meta.app_name || id,
        active: activeKey === `app:${id}`,
      });
    }
    return links;
  }

  // -------------------------------------------------------------------------
  // 1. Portfolio index (reuses the portfolio-grid card markup for every app)
  // -------------------------------------------------------------------------
  {
    const rel = 'index.html';
    const baseHref = baseHrefFor(rel);
    const cards = allApps
      .map(id => {
        const m = models.get(id);
        if (!m) return '';
        return renderAppCard(m, `${baseHref}apps/${id}/index.html`);
      })
      .filter(Boolean)
      .join('\n    ');

    const gridSection = `<section id="portfolio-grid" class="swao-block swao-block--portfolio-grid">
  <h2 id="portfolio-grid-h" data-i18n-key="block.portfolio_grid.title">Portfolio</h2>
  <div class="card-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">
    ${cards}
  </div>
</section>`;

    // Render through the same shell. The portfolio index has no per-app WSP
    // blocks, so the template embeds the pre-rendered grid directly as the
    // <main> body (a slot-less template still flows through the css/js inlining
    // and meta interpolation that give it publication parity).
    const template = buildPortalTemplate({
      title: 'Portfolio',
      lang,
      nav: siteNav(baseHref, 'portfolio'),
      breadcrumb: [{ label: 'Portfolio' }],
      slots: [],
    }).replace('<main class="main-content" id="main-content">\n\n  </main>',
               `<main class="main-content" id="main-content">\n      ${gridSection}\n  </main>`);

    // A model is required for meta interpolation + asset inlining; use any app's
    // model (branding is workspace-wide). If the workspace has no apps, synthesise
    // a minimal carrier so css/js still inline.
    const carrier = firstModel ?? makeEmptyModel();
    const html = assemblePublicationPage({ template, model: carrier, timestamp });
    writePage(rel, html);
  }

  // The aggregate pages share a carrier model (workspace-wide branding) so they
  // flow through assemblePublicationPage identically to the portfolio index.
  const aggregateCarrier = firstModel ?? makeEmptyModel();

  // Apps that actually have a model (the only ones the aggregates can read).
  const aggregatableApps = allApps.filter(id => models.has(id));

  // -------------------------------------------------------------------------
  // 1a. Programme dashboard (Design 058 §5 roll-ups, cross-app aggregates)
  // -------------------------------------------------------------------------
  {
    const rel = 'programme/index.html';
    const baseHref = baseHrefFor(rel);

    // Readiness bands -- count per band (Ready / Ready with changes / Blocked).
    const bandCounts: Record<ReadinessBand, number> = { ready: 0, ready_with_changes: 0, blocked: 0 };
    for (const id of aggregatableApps) bandCounts[readinessBand(models.get(id)!)]++;
    const bandStrip = (['ready', 'ready_with_changes', 'blocked'] as ReadinessBand[])
      .map(b => `<div class="stat-item${b === 'blocked' ? ' stat-critical' : ''}" style="text-align:center;">
        <div class="stat-item__value" style="font-size:1.5rem;font-weight:800;">${bandCounts[b]}</div>
        <div class="stat-item__label" style="font-size:0.75rem;color:var(--text-secondary);">${esc(BAND_LABELS[b])}</div>
      </div>`)
      .join('\n      ');

    // Blockers by severity -- sum signal_counts across apps, canonical order.
    const sevTotals: Record<string, number> = {};
    for (const id of aggregatableApps) {
      const counts = models.get(id)!.summary.signal_counts as Record<string, number>;
      for (const sev of SEVERITY_ORDER) sevTotals[sev] = (sevTotals[sev] ?? 0) + (counts[sev] ?? 0);
    }
    const sevStrip = SEVERITY_ORDER
      .filter(sev => (sevTotals[sev] ?? 0) > 0)
      .map(sev => `<div class="stat-item" style="text-align:center;">
        <div class="stat-item__value" style="font-size:1.5rem;font-weight:800;">${sevTotals[sev]}</div>
        <div class="stat-item__label" style="font-size:0.75rem;color:var(--text-secondary);">${portalSevBadge(sev)}</div>
      </div>`)
      .join('\n      ');

    // Framework coverage -- per framework: apps assessed + aggregate pass rate.
    interface FwAgg { name: string; apps: Set<string>; pass: number; partial: number; fail: number; }
    const fwAgg = new Map<string, FwAgg>();
    for (const id of aggregatableApps) {
      for (const fw of models.get(id)!.compliance as FrameworkResult[]) {
        const a = fwAgg.get(fw.framework_id) ?? { name: fw.framework_name, apps: new Set<string>(), pass: 0, partial: 0, fail: 0 };
        a.apps.add(id);
        a.pass += fw.pass_count; a.partial += fw.partial_count; a.fail += fw.fail_count;
        fwAgg.set(fw.framework_id, a);
      }
    }
    const fwRows = [...fwAgg.entries()]
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)) // stable: framework_id
      .map(([fwId, a]) => {
        const total = a.pass + a.partial + a.fail;
        const passRate = total > 0 ? Math.round((a.pass / total) * 100) : 0;
        return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:0.45rem 0.75rem;font-weight:600;">${esc(fwId)} <span style="font-weight:400;color:var(--text-secondary);font-size:0.8em;">${esc(a.name)}</span></td>
        <td style="padding:0.45rem 0.75rem;">${a.apps.size}</td>
        <td style="padding:0.45rem 0.75rem;">${passRate}% <span style="color:var(--text-secondary);font-size:0.8em;">(${a.pass}/${total})</span></td>
      </tr>`;
      })
      .join('\n      ');
    const fwTable = fwAgg.size > 0
      ? `<table style="width:100%;border-collapse:collapse;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);font-size:0.85rem;">
      <thead><tr style="background:var(--brand-primary);color:#fff;">
        <th style="padding:0.45rem 0.75rem;text-align:left;">Framework</th>
        <th style="padding:0.45rem 0.75rem;text-align:left;">Apps assessed</th>
        <th style="padding:0.45rem 0.75rem;text-align:left;">Aggregate pass rate</th>
      </tr></thead>
      <tbody>
      ${fwRows}
      </tbody>
    </table>`
      : '<div class="callout callout-info">No compliance frameworks assessed across the portfolio.</div>';

    // Top cross-app risks -- grouped by signal_ref / trigger (portfolio patterns).
    const riskGroups = aggregateCrossAppRisks(aggregatableApps, models);
    const riskRows = riskGroups.slice(0, 10)
      .map(g => `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:0.45rem 0.75rem;">${portalSevBadge(g.worstSeverity)}</td>
        <td style="padding:0.45rem 0.75rem;">${esc(g.trigger)}</td>
        <td style="padding:0.45rem 0.75rem;">${g.apps.map(a => `<a href="${esc(baseHref)}apps/${esc(a)}/risk/index.html">${esc(models.get(a)?.meta.app_name || a)}</a>`).join(', ')}</td>
      </tr>`)
      .join('\n      ');
    const riskTable = riskGroups.length > 0
      ? `<table style="width:100%;border-collapse:collapse;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);font-size:0.85rem;">
      <thead><tr style="background:var(--brand-primary);color:#fff;">
        <th style="padding:0.45rem 0.75rem;text-align:left;">Severity</th>
        <th style="padding:0.45rem 0.75rem;text-align:left;">Risk pattern</th>
        <th style="padding:0.45rem 0.75rem;text-align:left;">Apps affected</th>
      </tr></thead>
      <tbody>
      ${riskRows}
      </tbody>
    </table>`
      : '<div class="callout callout-info">No risks recorded across the portfolio.</div>';

    // Per-app table: app, type, verdict, blockers, coverage, link.
    const appRows = aggregatableApps
      .map(id => {
        const m = models.get(id)!;
        const band = readinessBand(m);
        return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:0.45rem 0.75rem;"><a href="${esc(baseHref)}apps/${esc(id)}/index.html">${esc(m.meta.app_name || id)}</a></td>
        <td style="padding:0.45rem 0.75rem;"><span class="badge badge-7r">${esc(m.summary.seven_r_label || '')}</span></td>
        <td style="padding:0.45rem 0.75rem;">${esc(BAND_LABELS[band])}</td>
        <td style="padding:0.45rem 0.75rem;">${m.summary.blocker_count}</td>
        <td style="padding:0.45rem 0.75rem;">${Math.round(m.summary.coverage_score * 100)}%</td>
      </tr>`;
      })
      .join('\n      ');
    const appTable = `<table style="width:100%;border-collapse:collapse;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);font-size:0.85rem;">
      <thead><tr style="background:var(--brand-primary);color:#fff;">
        <th style="padding:0.45rem 0.75rem;text-align:left;">App</th>
        <th style="padding:0.45rem 0.75rem;text-align:left;">Strategy</th>
        <th style="padding:0.45rem 0.75rem;text-align:left;">Verdict</th>
        <th style="padding:0.45rem 0.75rem;text-align:left;">Blockers</th>
        <th style="padding:0.45rem 0.75rem;text-align:left;">Coverage</th>
      </tr></thead>
      <tbody>
      ${appRows}
      </tbody>
    </table>`;

    const body = `<section id="programme-dashboard" class="swao-block swao-block--programme-dashboard">
  <h2 id="programme-dashboard-h">Programme Dashboard</h2>
  <h3>Portfolio readiness</h3>
  <div class="stats-strip">
      ${bandStrip}
  </div>
  <h3>Blockers by severity</h3>
  <div class="stats-strip">
      ${sevStrip || '<div class="stat-item" style="text-align:center;"><div class="stat-item__label">No signals across the portfolio.</div></div>'}
  </div>
  <h3>Framework coverage</h3>
  ${fwTable}
  <h3 style="margin-top:1.5rem;">Top cross-app risks</h3>
  ${riskTable}
  <h3 style="margin-top:1.5rem;">Applications</h3>
  ${appTable}
</section>`;

    const template = embedAggregateBody(buildPortalTemplate({
      title: 'Programme',
      lang,
      nav: siteNav(baseHref, 'programme'),
      breadcrumb: [{ label: 'Portfolio', href: `${baseHref}index.html` }, { label: 'Programme' }],
      slots: [],
    }), body);
    writePage(rel, assemblePublicationPage({ template, model: aggregateCarrier, timestamp }));
  }

  // -------------------------------------------------------------------------
  // 1b. Cross-app tags index (aggregates buildTagIndex output across apps)
  // -------------------------------------------------------------------------
  {
    const rel = 'tags/index.html';
    const baseHref = baseHrefFor(rel);

    // tag -> set of app ids that carry it (with a per-app item count). Reuses the
    // SAME buildTagIndex helper the publication uses, so the taxonomy matches.
    const tagToApps = new Map<string, Map<string, number>>();
    for (const id of aggregatableApps) {
      const idx = buildTagIndex(models.get(id)!);
      for (const [tag, items] of Object.entries(idx)) {
        const apps = tagToApps.get(tag) ?? new Map<string, number>();
        apps.set(id, items.length);
        tagToApps.set(tag, apps);
      }
    }

    const tagRows = [...tagToApps.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) // stable: tag key
      .map(([tag, apps]) => {
        const appLinks = [...apps.entries()]
          .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
          .map(([id, count]) => `<a href="${esc(baseHref)}apps/${esc(id)}/index.html">${esc(models.get(id)?.meta.app_name || id)} (${count})</a>`)
          .join(', ');
        return `  <dt style="font-weight:600;margin-top:0.75rem;"><span class="badge badge-tag">${esc(tag)}</span> <span style="color:var(--text-secondary);font-size:0.8em;">${apps.size} app(s)</span></dt>
  <dd style="margin-left:1.5rem;color:var(--text-secondary);">${appLinks}</dd>`;
      })
      .join('\n');

    const body = tagToApps.size > 0
      ? `<section id="tag-taxonomy" class="swao-block swao-block--tag-taxonomy">
  <h2 id="tag-taxonomy-h" data-i18n-key="block.tag_taxonomy.title">Tag Index</h2>
  <p style="color:var(--text-secondary);font-size:0.875rem;">Tags aggregated across ${aggregatableApps.length} app(s); each lists the apps it covers.</p>
  <dl>
${tagRows}
  </dl>
</section>`
      : `<section id="tag-taxonomy" class="swao-block swao-block--tag-taxonomy">
  <h2 id="tag-taxonomy-h" data-i18n-key="block.tag_taxonomy.title">Tag Index</h2>
  <p style="color:var(--text-secondary);">No tags across the portfolio.</p>
</section>`;

    const template = embedAggregateBody(buildPortalTemplate({
      title: 'Tags',
      lang,
      nav: siteNav(baseHref, 'tags'),
      breadcrumb: [{ label: 'Portfolio', href: `${baseHref}index.html` }, { label: 'Tags' }],
      slots: [],
    }), body);
    writePage(rel, assemblePublicationPage({ template, model: aggregateCarrier, timestamp }));
  }

  // -------------------------------------------------------------------------
  // 1c. Cross-app frameworks index (aggregate framework coverage per app)
  // -------------------------------------------------------------------------
  {
    const rel = 'frameworks/index.html';
    const baseHref = baseHrefFor(rel);

    interface FwIdx { name: string; apps: Map<string, { pass: number; partial: number; fail: number }>; }
    const fwIdx = new Map<string, FwIdx>();
    for (const id of aggregatableApps) {
      for (const fw of models.get(id)!.compliance as FrameworkResult[]) {
        const entry = fwIdx.get(fw.framework_id) ?? { name: fw.framework_name, apps: new Map() };
        entry.apps.set(id, { pass: fw.pass_count, partial: fw.partial_count, fail: fw.fail_count });
        fwIdx.set(fw.framework_id, entry);
      }
    }

    const fwCards = [...fwIdx.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) // stable: framework_id
      .map(([fwId, entry]) => {
        const appRows = [...entry.apps.entries()]
          .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
          .map(([id, c]) => {
            const total = c.pass + c.partial + c.fail;
            const rate = total > 0 ? Math.round((c.pass / total) * 100) : 0;
            return `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.4rem 0.6rem;"><a href="${esc(baseHref)}apps/${esc(id)}/compliance/index.html">${esc(models.get(id)?.meta.app_name || id)}</a></td>
          <td style="padding:0.4rem 0.6rem;"><span class="rag rag-pass">${c.pass}</span> / <span class="rag rag-partial">${c.partial}</span> / <span class="rag rag-fail">${c.fail}</span></td>
          <td style="padding:0.4rem 0.6rem;">${rate}%</td>
        </tr>`;
          })
          .join('\n          ');
        return `  <div class="swao-card" style="margin-bottom:1rem;">
    <h3 style="margin:0 0 0.5rem;">${esc(fwId)} <small style="font-weight:400;color:var(--text-secondary);">${esc(entry.name)}</small> <span style="color:var(--text-secondary);font-size:0.8rem;">${entry.apps.size} app(s)</span></h3>
    <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
      <thead><tr style="background:var(--bg-muted);"><th style="padding:0.4rem 0.6rem;text-align:left;">App</th><th style="padding:0.4rem 0.6rem;text-align:left;">Pass / Partial / Fail</th><th style="padding:0.4rem 0.6rem;text-align:left;">Pass rate</th></tr></thead>
      <tbody>
          ${appRows}
      </tbody>
    </table>
  </div>`;
      })
      .join('\n');

    const body = fwIdx.size > 0
      ? `<section id="framework-explainer" class="swao-block swao-block--framework-explainer">
  <h2 id="framework-explainer-h" data-i18n-key="block.framework_explainer.title">Frameworks</h2>
  <p style="color:var(--text-secondary);font-size:0.875rem;">Compliance framework coverage aggregated across ${aggregatableApps.length} app(s).</p>
${fwCards}
</section>`
      : `<section id="framework-explainer" class="swao-block swao-block--framework-explainer">
  <h2 id="framework-explainer-h" data-i18n-key="block.framework_explainer.title">Frameworks</h2>
  <p style="color:var(--text-secondary);">No frameworks assessed across the portfolio.</p>
</section>`;

    const template = embedAggregateBody(buildPortalTemplate({
      title: 'Frameworks',
      lang,
      nav: siteNav(baseHref, 'frameworks'),
      breadcrumb: [{ label: 'Portfolio', href: `${baseHref}index.html` }, { label: 'Frameworks' }],
      slots: [],
    }), body);
    writePage(rel, assemblePublicationPage({ template, model: aggregateCarrier, timestamp }));
  }

  // -------------------------------------------------------------------------
  // 2. Per-app pages (publication shell + grouped slot subset, each app)
  // -------------------------------------------------------------------------
  const renderedAppIds: string[] = [];
  for (const id of targetApps) {
    const model = models.get(id);
    if (!model) continue;
    renderedAppIds.push(id);
    const runDir = findLatestRun(workspace, id);
    const appName = model.meta.app_name || id;

    for (const plan of APP_PAGE_PLANS) {
      if (!plan.has(model)) continue;
      const rel = `apps/${id}/${plan.rel}`;
      const baseHref = baseHrefFor(rel);

      const breadcrumb = plan.rel === 'index.html'
        ? [{ label: 'Portfolio', href: `${baseHref}index.html` }, { label: appName }]
        : [
            { label: 'Portfolio', href: `${baseHref}index.html` },
            { label: appName, href: `${baseHref}apps/${id}/index.html` },
            { label: plan.title },
          ];

      const template = buildPortalTemplate({
        title: `${appName} -- ${plan.title}`,
        lang,
        nav: siteNav(baseHref, `app:${id}`),
        breadcrumb,
        slots: plan.slots,
      });

      // Pass wspRunDir so the data-quality banner logic matches Mode A exactly
      // (it injects after <main>, so it does not disturb block parity).
      const html = assemblePublicationPage({
        template,
        model,
        wspRunDir: runDir ?? undefined,
        timestamp,
      });
      writePage(rel, html);
    }
  }

  logger.info(`[swao publish --site] Portal built: ${pageCount} pages, ${renderedAppIds.length} app(s) -> ${outDir}`);

  return { outDir, pageCount, appIds: renderedAppIds, pages };
}

// ---------------------------------------------------------------------------
// Empty-model carrier (only used when the workspace has zero apps, so the
// portfolio index still inlines css/js and interpolates default branding).
// ---------------------------------------------------------------------------

function makeEmptyModel(): PublicationModel {
  return {
    contract_version: '1.0',
    meta: {
      app_id: '', app_name: '', assessed_at: '', run_id: '', swao_version: '',
      engagement: { engagement_name: '', partnership_lead: '' },
      licensee: '', tier: 'community',
      publication_config: {
        classification_band: 'SWAO - Sovereign Workload Assessment & Onboarding',
        logo_name: 'SWAO', logo_sub: 'Portal', footer_note: '',
        engagement_lead_label: '', primary_contact_label: '', secondary_contact_label: '',
      },
    },
    summary: { seven_r_label: '', coverage_score: 0, signal_counts: {}, blocker_count: 0, top_findings: [] },
    signals: [], compliance: [], risk_register: [], runbook: [], evidence: [],
    input_files: [], tags: {},
    lzr: { checks: [], summary: {} } as unknown as PublicationModel['lzr'],
    run_history: [],
  } as PublicationModel;
}
