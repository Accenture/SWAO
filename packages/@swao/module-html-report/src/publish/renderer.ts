// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML report module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Mode A single-file HTML renderer -- Design 041 §8.1 + issue #0431
 *
 * Pipeline:
 *   extractPublicationModel -> sanitisePII -> loadTemplate -> assemblePublicationPage
 *   (interpolate -> parse slots -> renderBlock -> splice -> data-quality banner
 *   -> wrap terms -> inline assets) -> enforceSize -> write
 *
 * --headless mode: skips rendering; writes publication-data.json only.
 *
 * The shared engine (extract / blocks / tag-index / data-quality banner / the
 * assemblePublicationPage pipeline + resolvePublishAsset + the rendering assets)
 * moved into the @swao/publication-render leaf (#0582, module-split stage 1) so
 * the Consultant portal and this Community single-page publication render
 * through ONE engine without a sibling import. This file keeps the Mode A entry
 * points (renderModeA + scaffoldPublicationTemplate); it imports the shared pipeline
 * and the canonical template (PUBLICATION_TEMPLATE) from the leaf (D2 -- #0931).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  extractPublicationModel,
  extractLzCatalogPublicationModel,
  extractLlmAssessmentPublicationModel,
  sanitisePII,
  assemblePublicationPage,
  PublicationSizeError,
  WARN_APP_BYTES,
  PUBLICATION_TITLE_MAP,
  PUBLICATION_TEMPLATE,
  LZ_CATALOG_TEMPLATE,
  LLM_ASSESSMENT_TEMPLATE,
} from '@swao/publication-render';
import type { PublicationModel } from '@swao/publication-render';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Re-export PublicationSizeError so existing importers (commands/publish.ts, the
// module barrel, renderer.test.ts's dynamic import) keep importing it from
// './renderer.js' unchanged after it moved to the leaf.
export { PublicationSizeError };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RenderModeAOptions {
  wspRunDir: string;
  outputPath?: string;    // if omitted, auto-resolved inside wsp/publications/
  templatePath?: string;  // workspace override; uses bundled default if absent
  lang?: string;          // 'en' (default) | 'de'
  headless?: boolean;     // emit JSON only, no HTML
  piiStrict?: boolean;    // exit 1 if redaction applied
  timestamp?: string;     // override generated_at (ISO 8601)
  swaoVersion?: string;
  blockProfile?: string;  // override block profile (#0793); defaults to model.block_profile
  /** Named profile variant to load (e.g. 'client', 'internal'). Undefined = default profile. */
  profileVariant?: string;
  evidenceBaseUrl?: string;
  /** Explicit workspace root. When provided, overrides the depth-based derivation from wspRunDir.
   *  Required when wspRunDir is not exactly 5 levels below the workspace (e.g. lz-assessment-fixture). */
  workspaceDir?: string;
  /** Explicit app directory (e.g. <workspace>/apps/<appId>). When provided, the LZ extractor uses
   *  this to find .swao.yml and derive appId rather than counting path components. */
  appDir?: string;
  logger?: { warn(msg: string): void; info(msg: string): void; error(msg: string): void };
}

export interface RenderModeAResult {
  outputPath: string;
  bytes: number;
  piiRedactions: number;
}

// ---------------------------------------------------------------------------
// Headless mode
// ---------------------------------------------------------------------------

async function renderHeadless(
  model: Awaited<ReturnType<typeof extractPublicationModel>>,
  outputDir: string,
  timestamp: string,
): Promise<RenderModeAResult> {
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, 'publication-data.json');
  const data = { ...model, _generated_at: timestamp };
  writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');

  // Copy evidence files
  const evidenceDir = join(outputDir, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });

  return {
    outputPath: jsonPath,
    bytes: Buffer.byteLength(JSON.stringify(data)),
    piiRedactions: 0,
  };
}

// ---------------------------------------------------------------------------
// Stable pointer file + type nav helpers (#0791, Design 068 §7)
// ---------------------------------------------------------------------------

/** Extract the inner content of the first <main> element. */
export function extractMainContent(html: string): string {
  const startM = /<main[^>]*>/i.exec(html);
  if (!startM) return '';
  const start = startM.index + startM[0].length;
  const end = html.lastIndexOf('</main>');
  if (end === -1 || end < start) return '';
  return html.slice(start, end).trim();
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scanPublicationTypes(pubDir: string): Array<{ type: string; href: string; title: string }> {
  if (!existsSync(pubDir)) return [];
  try {
    return readdirSync(pubDir)
      .filter(f => /^latest-.+\.html$/.test(f))
      .map(f => {
        const type = f.replace(/^latest-/, '').replace(/\.html$/, '');
        return {
          type,
          href: `./${f}`,
          title: PUBLICATION_TITLE_MAP[type] ?? type,
        };
      })
      .sort((a, b) => a.type.localeCompare(b.type));
  } catch {
    return [];
  }
}

function buildAlternateLinks(types: Array<{ type: string; href: string; title: string }>): string {
  return types
    .map(t => `  <link rel="alternate" href="${escHtml(t.href)}" title="${escHtml(t.title)}">`)
    .join('\n');
}

// Canonical tab order for assessment type navigation (#1481).
const TYPE_NAV_ORDER: Record<string, number> = {
  'application': 1,
  'lz': 2,
  'landing-zone-catalog': 2,
  'llm': 3,
};

function buildTypeNavHtml(
  types: Array<{ type: string; href: string; title: string }>,
  activeType: string,
): string {
  if (types.length < 2) return '';
  const sorted = [...types].sort((a, b) =>
    (TYPE_NAV_ORDER[a.type] ?? 99) - (TYPE_NAV_ORDER[b.type] ?? 99),
  );
  const pills = sorted.map(t => {
    const isActive = t.type === activeType;
    const style = isActive
      ? `background:var(--brand-primary);color:#fff;`
      : `background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border);`;
    return `<a href="${escHtml(t.href)}" style="display:inline-block;padding:0.25rem 0.75rem;border-radius:9999px;font-size:0.8rem;font-weight:600;text-decoration:none;${style}">${escHtml(t.title)}</a>`;
  }).join(' ');
  // #1524 (Option B): inline script hides pills whose targets are unreachable
  // on non-file:// origins (http/https). For file:// the nav is left as-is so
  // workspace users who have all siblings present still see the toggle.
  const detectionScript = `<script>(function(){var n=document.getElementById('swao-type-nav');if(!n||window.location.protocol==='file:')return;var links=Array.from(n.querySelectorAll('a[href]'));if(!links.length){n.style.display='none';return;}var hidden=0;function check(){if(hidden>=links.length)n.style.display='none';}links.forEach(function(a){fetch(a.getAttribute('href'),{method:'HEAD',cache:'no-store'}).then(function(r){if(!r.ok){a.style.display='none';hidden++;check();}}).catch(function(){a.style.display='none';hidden++;check();});});})()</script>`;
  return `<div id="swao-type-nav" style="padding:0.4rem 1rem;background:var(--bg-surface);border-bottom:1px solid var(--border);display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">\n  <span style="font-size:0.75rem;color:var(--text-secondary);margin-right:0.25rem;">View as:</span>\n  ${pills}\n</div>\n${detectionScript}\n`;
}

function injectHeadLinks(html: string, linkHtml: string): string {
  if (!linkHtml) return html;
  const idx = html.indexOf('</head>');
  if (idx === -1) return html;
  return html.slice(0, idx) + linkHtml + '\n' + html.slice(idx);
}

function injectTypeNav(html: string, navHtml: string): string {
  if (!navHtml) return html;
  // Prefer injecting just before the page-layout div so the nav appears
  // below the fixed chrome (band + header + breadcrumb) and above the content.
  const layoutMarker = '<div class="page-layout">';
  const layoutIdx = html.indexOf(layoutMarker);
  if (layoutIdx !== -1) {
    return html.slice(0, layoutIdx) + navHtml + '\n' + html.slice(layoutIdx);
  }
  // Fallback: inject after <body> (used only when page-layout marker is absent)
  const idx = html.indexOf('<body>');
  if (idx === -1) {
    const m = html.match(/<body[^>]*>/);
    if (!m) return html;
    const end = html.indexOf(m[0]) + m[0].length;
    return html.slice(0, end) + '\n' + navHtml + html.slice(end);
  }
  return html.slice(0, idx + '<body>'.length) + '\n' + navHtml + html.slice(idx + '<body>'.length);
}

// #1519: when a new publication is written, refresh the type nav bar inside all
// existing sibling publication files so their view-as bars stay in sync.
function updateSiblingTypeNavs(
  pubDir: string,
  allTypes: Array<{ type: string; href: string; title: string }>,
  currentType: string,
): void {
  for (const t of allTypes) {
    if (t.type === currentType) continue;
    const pointerPath = join(pubDir, `latest-${t.type}.html`);
    if (!existsSync(pointerPath)) continue;
    const pointerContent = readFileSync(pointerPath, 'utf-8');
    const m = pointerContent.match(/url=\.\/([^"]+)/);
    if (!m) continue;
    const actualPath = join(pubDir, m[1]!);
    if (!existsSync(actualPath)) continue;
    let siblingHtml = readFileSync(actualPath, 'utf-8');
    // Strip existing type nav before re-injecting with the updated allTypes set.
    siblingHtml = siblingHtml.replace(/<div id="swao-type-nav"[^>]*>[\s\S]*?<\/div>\n?/, '');
    const siblingNavHtml = buildTypeNavHtml(allTypes, t.type);
    siblingHtml = injectTypeNav(siblingHtml, siblingNavHtml);
    writeFileSync(actualPath, siblingHtml, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export async function renderModeA(opts: RenderModeAOptions): Promise<RenderModeAResult> {
  const {
    wspRunDir,
    lang: _lang = 'en',
    headless = false,
    piiStrict = false,
    timestamp = new Date().toISOString(),
    swaoVersion,
    evidenceBaseUrl,
    logger = { warn: console.warn, info: console.info, error: console.error },
  } = opts;

  // #1383: honour the documented "auto-detected from the run type" default.
  // LZ-catalog runs emit lz-catalogue-fit-*.yaml and no wsp.yaml; without
  // detection the application extractor fails with a misleading
  // "run swao assess first" error on a perfectly valid LZ run.
  const isLzFitFile = (f: string): boolean =>
    (f.startsWith('lz-catalogue-fit-') || f.startsWith('lz-fit')) && (f.endsWith('.yaml') || f.endsWith('.yml'));
  const looksLikeLzCatalogRun = !opts.blockProfile
    && existsSync(wspRunDir)
    && !existsSync(join(wspRunDir, 'wsp.yaml'))
    && (readdirSync(wspRunDir).some(isLzFitFile)
      || (existsSync(join(wspRunDir, 'passes')) && readdirSync(join(wspRunDir, 'passes')).some(isLzFitFile)));
  const isLzCatalog = opts.blockProfile === 'lz-catalog' || looksLikeLzCatalogRun;

  // 1. Extract -- LZ catalog uses a dedicated extractor with appDir context (#1250).
  let model: PublicationModel;
  if (isLzCatalog) {
    model = await extractLzCatalogPublicationModel(wspRunDir, { swaoVersion, appDir: opts.appDir });
  } else {
    model = await extractPublicationModel(wspRunDir, { swaoVersion, evidenceBaseUrl });
  }

  // Apply block profile override (#0793): --block-profile flag overrides the model value
  if (opts.blockProfile) {
    (model as Record<string, unknown>)['block_profile'] = opts.blockProfile;
  }

  // 2. Sanitise PII
  const { redactions } = sanitisePII(model);
  if (piiStrict && redactions.length > 0) {
    const detail = redactions.map(r => `  ${r.field} [${r.types.join(',')}]`).join('\n');
    throw new Error(`--pii-strict: ${redactions.length} PII redaction(s) applied:\n${detail}`);
  }

  // Derive workspace path: use explicit workspaceDir when provided (e.g. for LZ fixture paths
  // that are not 5 levels below workspace); otherwise derive from wspRunDir depth.
  const workspace = opts.workspaceDir ?? join(wspRunDir, '../../../../../');
  const appId = model.meta.app_id;
  const runTs = basename(wspRunDir);
  const pubDir = join(workspace, 'apps', appId, 'wsp', 'publications');

  // 3. Headless mode
  if (headless) {
    const outputDir = opts.outputPath ?? pubDir;
    return renderHeadless(model, outputDir, timestamp);
  }

  // 4. Load template -- priority: explicit path > profile-specific > generic > legacy root > bundled
  const htmlTmplDir = join(workspace, 'wsp', 'templates', 'html');
  const rawProfile = (model as Record<string, unknown>)['block_profile'];
  const activeProfile = typeof rawProfile === 'string' && /^[a-z0-9-]+$/.test(rawProfile) ? rawProfile : 'application';
  const profileTmplPath = join(htmlTmplDir, `publication-${activeProfile}.html.tmpl`);
  const htmlTmplPath = join(htmlTmplDir, 'publication.html.tmpl');
  const legacyTmplPath = join(workspace, 'publication.html.tmpl');
  let template: string;
  if (opts.templatePath && existsSync(opts.templatePath)) {
    template = readFileSync(opts.templatePath, 'utf-8');
  } else if (existsSync(profileTmplPath)) {
    template = readFileSync(profileTmplPath, 'utf-8');
  } else if (existsSync(htmlTmplPath)) {
    // Legacy fallback: generic name -- kept for backward compatibility
    template = readFileSync(htmlTmplPath, 'utf-8');
  } else if (existsSync(legacyTmplPath)) {
    template = readFileSync(legacyTmplPath, 'utf-8');
  } else if (activeProfile === 'lz-catalog') {
    template = LZ_CATALOG_TEMPLATE;
  } else {
    template = PUBLICATION_TEMPLATE;
  }

  // 5-10. Assemble the page through the shared pipeline (#0582 D-PORTAL-4):
  // interpolate meta -> parse slots -> renderBlock per slot -> splice ->
  // data-quality banner -> wrap terms -> inline assets. The portal builder
  // reuses this exact function (now in @swao/publication-render), which is what
  // makes portal/publication parity structural.
  const html = assemblePublicationPage({ template, model, wspRunDir, timestamp, logger, profileVariant: opts.profileVariant });

  // 11. Size reporting -- warn only, no hard cap (#0929: limit removed).
  // HTML publications are self-contained files that can be zipped for email.
  const bytes = Buffer.byteLength(html, 'utf-8');
  if (bytes > WARN_APP_BYTES) {
    logger.warn(`[swao publish] Output ${Math.round(bytes / 1024)} KB -- large publication (consider zipping for email)`);
  }

  // 12. Write + stable pointer file + type nav (#0791)
  mkdirSync(pubDir, { recursive: true });
  // LZ publications use a timestamp-based name with -lz suffix (#1250 acceptance criteria).
  const pubTs = timestamp.replace(/:/g, '-').slice(0, 19);
  const defaultOutputName = isLzCatalog ? `${pubTs}-${appId}-lz.html` : `${runTs}-${appId}.html`;
  const outputPath = opts.outputPath ?? join(pubDir, defaultOutputName);
  const outputDir2 = dirname(outputPath);
  mkdirSync(outputDir2, { recursive: true });

  // Write the stable redirect file BEFORE scanning so the scan below includes it.
  // Only write the pointer when the output is going into the publications directory.
  // Custom outputPath (e.g. HTML Editor preview in OS temp dir) must not overwrite
  // the pointer with a path that does not exist in pubDir (#1251).
  const assessmentType = (model as unknown as Record<string, unknown>)['assessment_type'] as string | undefined;
  // LZ catalog pointer uses 'lz' slug per #1250; other types use their assessment type.
  const pointerType = isLzCatalog ? 'lz' : (assessmentType ?? 'application');
  const isPublicationOutput = !opts.outputPath || resolve(dirname(outputPath)) === resolve(pubDir);
  if (isPublicationOutput) {
    const pointerFile = join(pubDir, `latest-${pointerType}.html`);
    const outBasename = basename(outputPath);
    writeFileSync(pointerFile, `<meta http-equiv="refresh" content="0;url=./${outBasename}">`, 'utf-8');
  }

  // Scan publications directory for all types (including the one we just wrote).
  const allTypes = scanPublicationTypes(pubDir);

  // Inject alternate links into <head> and type nav after <body>.
  const alternateLinks = buildAlternateLinks(allTypes);
  const typeNavHtml = buildTypeNavHtml(allTypes, pointerType);
  let finalHtml = injectHeadLinks(html, alternateLinks);
  finalHtml = injectTypeNav(finalHtml, typeNavHtml);

  writeFileSync(outputPath, finalHtml, 'utf-8');
  // #1519: refresh the type nav bar in all sibling publication files.
  if (isPublicationOutput) {
    updateSiblingTypeNavs(pubDir, allTypes, pointerType);
  }

  return { outputPath, bytes, piiRedactions: redactions.length };
}

// ---------------------------------------------------------------------------
// Hub page generator (#0794)
// ---------------------------------------------------------------------------

export interface RenderHubPageOptions {
  workspace: string;
  appId: string;
  swaoVersion?: string;
  timestamp?: string;
  logger?: { warn(msg: string): void; info(msg: string): void; error(msg: string): void };
}

export interface RenderHubPageResult {
  outputPath: string;
  bytes: number;
}

const HUB_TEMPLATE = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="SWAO Publication Engine">
  <title>{{publication_config.logo_name}} -- Engagement Hub</title>
  <!-- swao:css -->
</head>
<body>
  <div class="band band-top" role="banner" aria-label="Classification">{{publication_config.classification_band}}</div>

  <header class="site-header" role="banner">
    <button class="hamburger-btn" id="nav-hamburger" aria-label="Toggle navigation" aria-expanded="false">&#9776;</button>
    <a class="site-header__logo" href="#hub-header" style="text-decoration:none;color:inherit;">
      <span class="site-header__logo-name">{{publication_config.logo_name}}</span>
      <span class="site-header__logo-sub">HUB</span>
    </a>
    <nav class="site-header__nav" aria-label="Hub navigation">
      <a href="#hub-header" data-nav-key="hub-header">Overview</a>
      <a href="#hub-app-list" data-nav-key="hub-app-list">Applications</a>
      <a href="#hub-workspace-summary" data-nav-key="hub-workspace-summary">Summary</a>
    </nav>
    <div class="site-header__actions">
      <button class="btn-icon" id="dark-mode-toggle" aria-label="Toggle dark mode" title="Toggle dark / light mode">Dark</button>
    </div>
  </header>

  <nav class="breadcrumb-bar" aria-label="breadcrumb">
    <ol class="breadcrumb">
      <li><span>Engagement Hub</span></li>
      <li><strong>{{meta.app_id}}</strong></li>
    </ol>
  </nav>

  <div class="page-layout">
    <nav class="sidebar" id="swao-sidebar" aria-label="Hub navigation">
      <div class="sidebar__section">
        <span class="sidebar__label">{{meta.app_id}}</span>
        <ul class="sidebar__nav" id="swao-sidebar-nav">
          <!-- populated by initSidebar() from section ids in the document -->
        </ul>
      </div>
    </nav>

    <main class="main-content" id="main-content">
      <!-- SWAO:slot name="hub.header" -->
      <!-- SWAO:slot name="hub.workspace_summary" -->
      <!-- SWAO:slot name="hub.app_list" -->
    </main>
  </div>

  <!-- swao:js -->
</body>
</html>`;


/**
 * Generates an engagement-hub.html for a single app -- a navigation hub
 * linking to all available publication types (#0794).
 *
 * Does not require a run directory; scans apps/<appId>/wsp/publications/
 * for latest-*.html pointer files and builds a minimal hub model.
 */
export async function renderHubPage(opts: RenderHubPageOptions): Promise<RenderHubPageResult> {
  const {
    workspace,
    appId,
    swaoVersion = 'unknown',
    timestamp = new Date().toISOString(),
    logger = { warn: console.warn, info: console.info, error: console.error },
  } = opts;

  const pubDir = join(workspace, 'apps', appId, 'wsp', 'publications');

  // Scan available publication types from existing latest-*.html pointer files
  const pubTypes = scanPublicationTypes(pubDir);
  const pubLinks: Record<string, string> = {};
  for (const t of pubTypes) {
    pubLinks[t.type] = t.href;
  }

  // Build a minimal PublicationModel stub with hub extension
  const model: PublicationModel = {
    contract_version: '1.1',
    meta: {
      app_id: appId,
      app_name: appId,
      assessed_at: timestamp,
      run_id: 'hub',
      swao_version: swaoVersion,
      engagement: { engagement_name: '', partnership_lead: '' },
      licensee: 'SWAO',
      tier: 'community',
      publication_config: {
        classification_band: '',
        logo_name: 'SWAO',
        logo_sub: 'Hub',
        footer_note: '',
        engagement_lead_label: '',
        primary_contact_label: '',
        secondary_contact_label: '',
      },
    },
    summary: {
      seven_r_label: '',
      coverage_score: 0,
      signal_counts: {},
      blocker_count: 0,
      top_findings: [],
    },
    signals: [],
    compliance: [],
    risk_register: [],
    runbook: [],
    evidence: [],
    input_files: [],
    tags: {},
    lzr: { overall: '', blockers: 0, checks: [] },
    run_history: [],
    block_profile: 'hub',
    assessment_type: 'hub',
  };

  // Attach hub extension (passthrough fields; not in schema but used by hub blocks)
  (model as unknown as Record<string, unknown>)['hub'] = {
    entries: [{
      app_id: appId,
      app_name: appId,
      assessment_types: [...new Set([...pubTypes.map(t => t.type), 'application', 'lz', 'llm'])],
      pub_links: pubLinks,
    }],
    workspace_path: workspace,
    last_updated: timestamp,
  };

  const html = assemblePublicationPage({
    template: HUB_TEMPLATE,
    model,
    wspRunDir: pubDir,
    timestamp,
    logger,
  });

  const bytes = Buffer.byteLength(html, 'utf-8');
  mkdirSync(pubDir, { recursive: true });
  const outputPath = join(pubDir, 'engagement-hub.html');
  writeFileSync(outputPath, html, 'utf-8');

  logger.info(`[swao publish --block-profile hub] Hub page written: ${outputPath}`);

  return { outputPath, bytes };
}

// ---------------------------------------------------------------------------
// Workspace hub generator (#0795)
// ---------------------------------------------------------------------------

export interface RenderWorkspaceHubPageResult {
  outputPath: string;
  bytes: number;
  appCount: number;
}

/**
 * Generates a workspace-level engagement-hub.html at apps/engagement-hub.html.
 * Scans all apps/<id>/wsp/publications/ for latest-*.html pointer files and
 * builds one hub entry per app (#0795).
 */
export async function renderWorkspaceHubPage(opts: Omit<RenderHubPageOptions, 'appId'>): Promise<RenderWorkspaceHubPageResult> {
  const {
    workspace,
    swaoVersion = 'unknown',
    timestamp = new Date().toISOString(),
    logger = { warn: console.warn, info: console.info, error: console.error },
  } = opts;

  const appsDir = join(workspace, 'apps');
  const entries: Array<{
    app_id: string;
    app_name: string;
    assessment_types: string[];
    pub_links: Record<string, string>;
  }> = [];

  if (existsSync(appsDir)) {
    for (const appId of readdirSync(appsDir).sort()) {
      const pubDir = join(appsDir, appId, 'wsp', 'publications');
      if (!existsSync(pubDir)) continue;
      const types = scanPublicationTypes(pubDir);
      if (types.length === 0) continue;
      const pub_links: Record<string, string> = {};
      for (const t of types) {
        pub_links[t.type] = `./${appId}/wsp/publications/${t.href.replace(/^\.\//, '')}`;
      }
      entries.push({
        app_id: appId,
        app_name: appId,
        assessment_types: [...new Set([...types.map(t => t.type), 'application', 'lz', 'llm'])],
        pub_links,
      });
    }
  }

  const model: PublicationModel = {
    contract_version: '1.1',
    meta: {
      app_id: 'workspace',
      app_name: 'Workspace',
      assessed_at: timestamp,
      run_id: 'hub',
      swao_version: swaoVersion,
      engagement: { engagement_name: '', partnership_lead: '' },
      licensee: 'SWAO',
      tier: 'community',
      publication_config: {
        classification_band: '',
        logo_name: 'SWAO',
        logo_sub: 'Hub',
        footer_note: '',
        engagement_lead_label: '',
        primary_contact_label: '',
        secondary_contact_label: '',
      },
    },
    summary: { seven_r_label: '', coverage_score: 0, signal_counts: {}, blocker_count: 0, top_findings: [] },
    signals: [],
    compliance: [],
    risk_register: [],
    runbook: [],
    evidence: [],
    input_files: [],
    tags: {},
    lzr: { overall: '', blockers: 0, checks: [] },
    run_history: [],
    block_profile: 'hub',
    assessment_type: 'hub',
  };

  (model as unknown as Record<string, unknown>)['hub'] = {
    entries,
    workspace_path: workspace,
    last_updated: timestamp,
  };

  const html = assemblePublicationPage({
    template: HUB_TEMPLATE,
    model,
    wspRunDir: appsDir,
    timestamp,
    logger,
  });

  const bytes = Buffer.byteLength(html, 'utf-8');
  mkdirSync(appsDir, { recursive: true });
  const outputPath = join(appsDir, 'engagement-hub.html');
  writeFileSync(outputPath, html, 'utf-8');

  logger.info(`[swao publish --block-profile hub] Workspace hub written: ${outputPath} (${entries.length} apps)`);

  return { outputPath, bytes, appCount: entries.length };
}

// ---------------------------------------------------------------------------
// LLM Assessment publication generator (#1428, Design 092 s8)
// ---------------------------------------------------------------------------

export interface RenderModeALlmOptions {
  workspace: string;
  appId: string;
  /** Specific run timestamp to publish. When omitted, latest.txt is used. */
  runTs?: string;
  swaoVersion?: string;
  timestamp?: string;
  outputPath?: string;
  /** When false, suppress the LLM-generated narrative block (--no-llm-narrative). Default true. */
  narrativeEnabled?: boolean;
  logger?: { warn(msg: string): void; info(msg: string): void; error(msg: string): void };
}

export interface RenderModeALlmResult {
  outputPath: string;
  bytes: number;
}

/**
 * Generates a single-file HTML publication for an LLM Assessment run.
 *
 * Reads llm-assessments/swao/<ts>/comparison/publication-model.json and renders
 * it using LLM_ASSESSMENT_TEMPLATE + the seven llm.* block renderers. Writes to
 * apps/<appId>/wsp/publications/<ts>-llm-assessment.html and updates the
 * latest-llm.html pointer file (#1428).
 */
export async function renderModeALlm(opts: RenderModeALlmOptions): Promise<RenderModeALlmResult> {
  const {
    workspace,
    appId,
    runTs,
    swaoVersion = 'unknown',
    timestamp = new Date().toISOString(),
    logger = { warn: console.warn, info: console.info, error: console.error },
  } = opts;

  const { model, llmData } = extractLlmAssessmentPublicationModel(workspace, appId, runTs, { swaoVersion });

  // Suppress narrative when --no-llm-narrative is passed (#1431).
  if (opts.narrativeEnabled === false) {
    (llmData as unknown as Record<string, unknown>)['narrative'] = undefined;
  }

  // Attach LLM data as a runtime extension (same extra-field pattern as hub page).
  (model as unknown as Record<string, unknown>)['llm_assessment'] = llmData;

  const html = assemblePublicationPage({
    template: LLM_ASSESSMENT_TEMPLATE,
    model,
    wspRunDir: join(workspace, 'llm-assessments', 'swao'),
    timestamp,
    logger,
  });

  const bytes = Buffer.byteLength(html, 'utf-8');
  const pubDir = join(workspace, 'apps', appId, 'wsp', 'publications');
  mkdirSync(pubDir, { recursive: true });

  const ts = llmData.created.slice(0, 19).replace(/[T:.]/g, '-');
  const outputPath = opts.outputPath ?? join(pubDir, `${ts}-llm-assessment.html`);
  const isPublicationOutput = !opts.outputPath || resolve(dirname(outputPath)) === resolve(pubDir);

  // Write pointer BEFORE scanning so the type-nav scan picks up this type.
  if (isPublicationOutput) {
    const pointerFile = join(pubDir, 'latest-llm.html');
    writeFileSync(pointerFile, `<meta http-equiv="refresh" content="0;url=./${basename(outputPath)}">`, 'utf-8');
  }

  // Inject cross-publication type nav (mirrors renderModeA behaviour, #1428).
  const allTypes = scanPublicationTypes(pubDir);
  const alternateLinks = buildAlternateLinks(allTypes);
  const typeNavHtml = buildTypeNavHtml(allTypes, 'llm');
  let finalHtml = injectHeadLinks(html, alternateLinks);
  finalHtml = injectTypeNav(finalHtml, typeNavHtml);

  writeFileSync(outputPath, finalHtml, 'utf-8');

  logger.info(`[swao publish --block-profile llm-assessment] Done: ${outputPath}`);

  return { outputPath, bytes };
}

// ---------------------------------------------------------------------------
// --init scaffold
// ---------------------------------------------------------------------------

export function scaffoldPublicationTemplate(workspace: string, logger: { info(m: string): void; warn(m: string): void }): void {
  const targets = [
    {
      src: join(__dirname, 'templates/publication.html.tmpl'),
      dst: join(workspace, 'wsp', 'templates', 'html', 'publication.html.tmpl'),
      content: PUBLICATION_TEMPLATE,
    },
  ];

  for (const { dst, content } of targets) {
    if (existsSync(dst)) {
      logger.warn(`[swao publish --init] Skipping existing file: ${dst}`);
    } else {
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, content, 'utf-8');
      logger.info(`[swao publish --init] Created: ${dst}`);
    }
  }
}
