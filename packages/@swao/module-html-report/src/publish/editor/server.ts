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
 * SWAO Publication Editor -- server-side HTTP server (#0436)
 *
 * Uses node:http (no Fastify dependency) behind the EditorServer interface.
 * Endpoints:
 *   GET  /          -- editor shell HTML (falls back to inline EDITOR_HTML_FALLBACK)
 *   GET  /health    -- liveness probe
 *   POST /preview   -- render publication HTML with CSS variable overrides
 *   POST /export/level1 -- write publication.html.tmpl to workspace
 *   POST /export/level2 -- write publication-data.html stub to workspace
 *
 * Browser-visible ACs (colour-picker, drag-drop, visual preview) are
 * deferred to UAT-12 and cannot be verified via HTTP requests.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, writeFileSync, readdirSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';

import { renderModeA } from '../renderer.js';
import { findWorkspace } from '@swao/core';
// BUNDLED_TEMPLATE_CONTENT (the slot-marker template shared by Mode A + portal)
// relocated to the @swao/publication-render leaf (#0582).
import { BUNDLED_TEMPLATE_CONTENT, LZ_CATALOG_TEMPLATE, TIER1_TOKENS, listProfileVariants, resolveProfilePath, loadProfileOverride } from '@swao/publication-render';

// ---------------------------------------------------------------------------
// Template manipulation helpers (block reorder + per-block params)
// ---------------------------------------------------------------------------

// Reorder SWAO:slot markers + inject per-block params into a template string.
function buildCustomTemplate(
  base: string,
  blocksOrder?: string[],
  blockParams?: Record<string, Record<string, string>>,
): string {
  if ((!blocksOrder || blocksOrder.length === 0) && (!blockParams || Object.keys(blockParams).length === 0)) {
    return base;
  }

  // Extract all slot names in document order
  const slotRe = /<!--\s*SWAO:slot\s+name="([^"]+)"([^>]*?)-->/g;
  type SlotMatch = { name: string; raw: string; attrs: string };
  const allSlots: SlotMatch[] = [];
  let m: RegExpExecArray | null;
  slotRe.lastIndex = 0;
  while ((m = slotRe.exec(base)) !== null) {
    allSlots.push({ name: m[1], raw: m[0], attrs: m[2] ?? '' });
  }

  // Build ordered list: specified order first, then any remaining
  const orderedNames = blocksOrder && blocksOrder.length > 0
    ? [...blocksOrder, ...allSlots.map(s => s.name).filter(n => !blocksOrder.includes(n))]
    : allSlots.map(s => s.name);

  // Build replacement markers (inject blockParams as extra attributes)
  function slotMarker(name: string): string {
    const extraParams = blockParams?.[name];
    if (!extraParams || Object.keys(extraParams).length === 0) {
      return `<!-- SWAO:slot name="${name}" -->`;
    }
    const attrs = Object.entries(extraParams).map(([k, v]) => ` ${k}="${v}"`).join('');
    return `<!-- SWAO:slot name="${name}"${attrs} -->`;
  }

  const ordered = orderedNames.map(n => slotMarker(n));

  // Replace markers in document order with the new ordered list
  let idx = 0;
  const result = base.replace(/<!--\s*SWAO:slot\s+name="([^"]+)"[^-]*(?:-(?!->)[^-]*)*-->/g, () => {
    return ordered[idx++] ?? '';
  });

  return result;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Block profile registry (#0792)
// Maps profile name to the block IDs included in that profile.
// Blocks not listed in the active profile are hidden in the editor sidebar.
// When block_profile is absent (1.0 publications), 'application' is used.
// ---------------------------------------------------------------------------

/** Extract all SWAO:slot names from a template string, in document order. */
export function listTemplateSlots(template: string): string[] {
  const re = /<!--\s*SWAO:slot\s+name="([^"]+)"[^-]*(?:-(?!->)[^-]*)*-->/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(template)) !== null) {
    names.push(m[1]);
  }
  return names;
}

export const BLOCK_PROFILE_CONTEXTS: Readonly<Record<string, string[]>> = {
  application: [
    'cover', 'quick-nav', 'coverage-bar', 'exec-summary', 'seven-r-card', 'signal-list',
    'compliance-regime', 'compliance-framework-detail', 'compliance-matrix',
    'compliance-requirements', 'controls', 'risk-register',
    'evidence-gallery', 'lzr-summary', 'delta-view', 'run-history',
    'assessment-scope', 'block-scorecard', 'runbook', 'glossary', 'methodology', 'footer',
  ],
  'lz-catalog': [
    'cover', 'lzr-catalog-header', 'lzr-catalog-verdict', 'lz-catalog-services',
    'lzr-catalog-findings', 'lzr-catalog-remediation', 'lzr-catalog-finops',
    'evidence-gallery', 'run-history',
  ],
  hub: [
    'hub.header', 'hub.app_list', 'hub.cross_links', 'hub.workspace_summary',
    'lz-catalog-services',
  ],
};

/** Extract assessment_type from run-context.yaml using a simple regex (no YAML parser dependency). */
function readRunContextAssessmentType(runCtxPath: string): string | undefined {
  try {
    const content = readFileSync(runCtxPath, 'utf-8');
    const m = /^assessment_type:\s*["']?([^\s"'\n]+)["']?/m.exec(content);
    return m?.[1];
  } catch {
    return undefined;
  }
}

/** Determine the block profile for the most recent run in a workspace app. */
function resolveBlockProfile(workspace: string, appId: string | undefined): string {
  const DEFAULT_PROFILE = 'application';
  if (!appId) return DEFAULT_PROFILE;
  try {
    const latestFile = join(workspace, 'apps', appId, 'wsp', 'latest-run.txt');
    if (!existsSync(latestFile)) return DEFAULT_PROFILE;
    const runTs = readFileSync(latestFile, 'utf-8').trim();
    const runCtxPath = join(workspace, 'apps', appId, 'wsp', 'runs', runTs, 'run-context.yaml');
    if (!existsSync(runCtxPath)) return DEFAULT_PROFILE;
    const assessmentType = readRunContextAssessmentType(runCtxPath);
    if (!assessmentType) return DEFAULT_PROFILE;
    return assessmentType === 'landing-zone-catalog' ? 'lz-catalog' : assessmentType;
  } catch {
    return DEFAULT_PROFILE;
  }
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface EditorServerOptions {
  port?: number;
  workspace?: string;
  appId?: string;
  /** Initial active profile variant (e.g. 'client'). Undefined = base profile file. */
  profileVariant?: string;
}

export interface EditorServer {
  /** Start the server; resolves with the bound port number. */
  start(): Promise<number>;
  /** Stop the server. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Body parsing helper
// ---------------------------------------------------------------------------

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// Return only the error message (no stack trace) in API responses.
// Prevents CodeQL js/information-exposure: stack traces leak internal paths.
function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Internal server error';
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleHealth(res: ServerResponse): void {
  sendJson(res, 200, { status: 'ok', service: 'swao-pub-editor' });
}

const SAFE_PROFILE_RE = /^[a-z][a-z0-9-]{0,40}$/;

function handleContext(
  res: ServerResponse,
  workspace: string,
  appId: string | undefined,
  activeVariant: string | undefined,
  overrideProfile?: string,
): void {
  // #1123: allow ?profile= query param to switch profile; validate to prevent injection
  const blockProfile = (overrideProfile && SAFE_PROFILE_RE.test(overrideProfile))
    ? overrideProfile
    : resolveBlockProfile(workspace, appId);
  const allowedBlocks = BLOCK_PROFILE_CONTEXTS[blockProfile] ?? BLOCK_PROFILE_CONTEXTS['application'];

  // D4 Phase 2: read saved ci.yaml for current branding tokens
  let branding: Record<string, string> = {};
  const ciYamlPath = join(workspace, 'wsp', 'templates', 'styles', 'ci.yaml');
  if (existsSync(ciYamlPath)) {
    try {
      const rawCi = loadYaml(readFileSync(ciYamlPath, 'utf-8'));
      if (rawCi && typeof rawCi === 'object' && !Array.isArray(rawCi)) {
        branding = rawCi as Record<string, string>;
      }
    } catch { /* branding stays empty */ }
  }

  // D4 Phase 2 + variant support: read saved profile YAML for block order/visibility/nav
  const profile = loadProfileOverride(workspace, blockProfile, activeVariant);

  // Available profile variants for this block profile
  const available_variants = listProfileVariants(workspace, blockProfile);

  // #1127: pick template by profile so slot list matches the selected assessment type
  const templateContent = blockProfile === 'lz-catalog'
    ? LZ_CATALOG_TEMPLATE
    : BUNDLED_TEMPLATE_CONTENT;
  const template_slots = listTemplateSlots(templateContent);

  sendJson(res, 200, {
    block_profile: blockProfile,
    allowed_blocks: allowedBlocks,
    template_slots,
    branding,
    blocks: profile?.blocks,
    options: profile?.blockOptions,
    nav: profile?.nav,
    available_variants,
    active_variant: activeVariant ?? 'default',
  });
}

function handleGetRoot(res: ServerResponse): void {
  const htmlPath = join(__dirname, 'editor.html');
  if (existsSync(htmlPath)) {
    sendHtml(res, 200, readFileSync(htmlPath, 'utf-8'));
  } else {
    sendHtml(res, 200, EDITOR_HTML_FALLBACK);
  }
}

async function handlePreview(
  req: IncomingMessage,
  res: ServerResponse,
  workspace: string,
  defaultAppId: string | undefined,
): Promise<void> {
  let body: {
    appId?: string;
    cssVars?: Record<string, string>;
    blocksDisabled?: string[];
    blocksOrder?: string[];
    blockParams?: Record<string, Record<string, string>>;
    theme?: 'light' | 'dark';
    topNav?: {
      topBarVisible?: boolean;
      search?: boolean;
      langSwitcher?: boolean;
      themeToggle?: boolean;
      sidebarVisible?: boolean;  // legacy -- kept for compat; moved to sideNav
      anchors?: Array<{ id: string; label: string; enabled: boolean }>;  // legacy
      items?: Array<{ id: string; label: string; enabled: boolean; order: number }>;
    };
    // #0820: per-item sidebar nav toggles + reorder
    sideNav?: { sidebarVisible?: boolean; items: Array<{ id: string; enabled: boolean; order: number }> };
  };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const rawAppId = body.appId ?? defaultAppId ?? '';
  if (!rawAppId) {
    sendJson(res, 400, { error: 'appId required' });
    return;
  }
  // Restrict to safe characters to prevent path traversal (CodeQL js/path-injection)
  const appId = /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(rawAppId) ? rawAppId : null;
  if (!appId) {
    sendJson(res, 400, { error: 'Invalid appId' });
    return;
  }

  const runsDir = join(workspace, 'apps', appId, 'wsp', 'runs');
  if (!existsSync(runsDir)) {
    sendJson(res, 404, { error: `No runs found for app: ${appId}` });
    return;
  }
  const runs = readdirSync(runsDir)
    .filter(r => existsSync(join(runsDir, r, 'wsp.yaml')))
    .sort()
    .reverse();
  if (runs.length === 0) {
    sendJson(res, 404, { error: 'No publishable runs found -- run swao assess --app first.' });
    return;
  }
  const wspRunDir = join(runsDir, runs[0]);

  try {
    const tmpDir = mkdtempSync(join(tmpdir(), 'swao-editor-'));
    const outputPath = join(tmpDir, 'preview.html');

    // Build customised template (block order + per-block params)
    const customTmpl = buildCustomTemplate(BUNDLED_TEMPLATE_CONTENT, body.blocksOrder, body.blockParams);
    const tmplFile = join(tmpDir, 'preview.html.tmpl');
    writeFileSync(tmplFile, customTmpl, 'utf-8');

    await renderModeA({ wspRunDir, outputPath, templatePath: tmplFile, timestamp: new Date().toISOString() });
    let html = readFileSync(outputPath, 'utf-8');

    // Inject CSS variable overrides
    if (body.cssVars && Object.keys(body.cssVars).length > 0) {
      const overrides = Object.entries(body.cssVars)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');
      const styleOverride = `<style id="swao-editor-overrides">:root {\n${overrides}\n}</style>`;
      html = html.replace('</head>', `${styleOverride}\n</head>`);
    }

    // Dark mode: swap data-theme attribute on the <html> element.
    // Two-pass approach: regex handles the initial render; a late DOMContentLoaded
    // script wins after the publication JS reads localStorage and may override the attribute.
    const previewTheme = body.theme === 'dark' ? 'dark' : 'light';
    if (/<html[^>]*\bdata-theme="/.test(html)) {
      html = html.replace(/(<html[^>]*)\bdata-theme="[^"]*"/, `$1data-theme="${previewTheme}"`);
    } else {
      html = html.replace(/(<html\b)/, `$1 data-theme="${previewTheme}"`);
    }
    // Late-binding theme lock: fires after initDarkModeToggle reads localStorage.
    // Uses capture=true so it registers before the pub-JS bubble listener.
    const themeLockScript = `<script id="swao-editor-theme-lock">
document.addEventListener('DOMContentLoaded',function(){
  document.documentElement.setAttribute('data-theme','${previewTheme}');
},true);
</script>`;
    html = html.replace('</body>', `${themeLockScript}\n</body>`);

    // Hide disabled blocks: section + all anchors pointing to them.
    // CSS approach so no-JS clients and print styles both work.
    // :has() selector hides parent <li> elements that contain only hidden anchors.
    if (body.blocksDisabled && body.blocksDisabled.length > 0) {
      const rules = body.blocksDisabled.map(b => {
        const id = b.replace(/[^a-zA-Z0-9-_]/g, '');
        return [
          `section#${id} { display: none !important; }`,
          `a[href="#${id}"] { display: none !important; }`,
          `li:has(> a[href="#${id}"]) { display: none !important; }`,
        ].join('\n');
      }).join('\n');
      const hideStyle = `<style id="swao-disabled-blocks">\n${rules}\n</style>`;
      html = html.replace('</head>', `${hideStyle}\n</head>`);
    }

    // Top-nav and sidebar area overrides
    if (body.topNav) {
      const navRules: string[] = [];
      if (body.topNav.topBarVisible === false) {
        navRules.push('header.site-header { display: none !important; }');
        navRules.push('.breadcrumb-bar { margin-top: 0 !important; }');
      }
      if (body.topNav.search === false) navRules.push('.site-header__search { display: none !important; }');
      if (body.topNav.langSwitcher === false) navRules.push('#lang-select { display: none !important; }');
      if (body.topNav.themeToggle === false) navRules.push('#dark-mode-toggle { display: none !important; }');
      // legacy sidebarVisible -- now in sideNav, kept for compat
      if (body.topNav.sidebarVisible === false) {
        navRules.push('#swao-sidebar { display: none !important; }');
        navRules.push('.page-layout { grid-template-columns: 1fr !important; }');
      }
      // new: items array with order (CSS hide/reorder existing nav links in preview)
      if (body.topNav.items && body.topNav.items.length > 0) {
        navRules.push('.site-header__nav { display: flex; }');
        for (const item of body.topNav.items) {
          const safeId = item.id.replace(/[^a-zA-Z0-9-_]/g, '');
          if (!safeId) continue;
          navRules.push(`.site-header__nav a[href="#${safeId}"] { order: ${item.order}; }`);
          if (!item.enabled) {
            navRules.push(`.site-header__nav a[href="#${safeId}"] { display: none !important; }`);
          }
        }
      }
      // legacy anchors format
      if (body.topNav.anchors) {
        for (const a of body.topNav.anchors) {
          if (!a.enabled) {
            const id = a.id.replace(/[^a-zA-Z0-9-_]/g, '');
            navRules.push(`.site-header__nav a[href="#${id}"] { display: none !important; }`);
          }
        }
      }
      if (navRules.length > 0) {
        const navStyle = `<style id="swao-nav-overrides">\n${navRules.join('\n')}\n</style>`;
        html = html.replace('</head>', `${navStyle}\n</head>`);
      }
    }

    // Sidebar visibility (new location: sideNav.sidebarVisible)
    if (body.sideNav?.sidebarVisible === false) {
      const hideStyle = `<style id="swao-sidebar-hide">\n#swao-sidebar { display: none !important; }\n.page-layout { grid-template-columns: 1fr !important; }\n</style>`;
      html = html.replace('</head>', `${hideStyle}\n</head>`);
    }

    // Per-item sidebar nav order -- cover=1, quick-nav=2, coverage-bar=3, nav items start at 4
    {
      const sideRules: string[] = [
        '#swao-sidebar-nav { display: flex; flex-direction: column; }',
        '#swao-sidebar-nav li:has(a[href="#quick-nav"]) { order: 2; }',
        '#swao-sidebar-nav li:has(a[href="#coverage-bar"]) { order: 3; }',
        '#swao-sidebar-nav li:has(a[href="#stakeholder-challenge"]) { order: 998; }',
        '#swao-sidebar-nav li:has(a[href="#footer"]) { order: 999; }',
      ];
      if (body.sideNav?.items && body.sideNav.items.length > 0) {
        const sortedItems = body.sideNav.items.slice().sort((a, b) => a.order - b.order);
        let pos = 4; // positions 1-3 reserved for cover/quick-nav/coverage-bar
        for (const item of sortedItems) {
          const safeId = item.id.replace(/[^a-zA-Z0-9-_]/g, '');
          if (!safeId) continue;
          const order = safeId === 'cover' ? 1 : pos++;
          sideRules.push(`#swao-sidebar-nav li:has(a[href="#${safeId}"]) { order: ${order}; }`);
          if (!item.enabled) {
            sideRules.push(`#swao-sidebar-nav li:has(a[href="#${safeId}"]) { display: none !important; }`);
          }
        }
      }
      const sideStyle = `<style id="swao-sidenav-overrides">\n${sideRules.join('\n')}\n</style>`;
      html = html.replace('</head>', `${sideStyle}\n</head>`);
    }

    // Inject navigation guard: prevent publication links from navigating
    // the editor iframe away (e.g. top-nav "Portfolio" -> / -> editor UI).
    // Only anchor links (#...) are allowed; all other hrefs are blocked.
    const navGuard = `<script id="swao-editor-nav-guard">
(function(){
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href]');
    if(!a)return;
    var h=a.getAttribute('href');
    if(!h||h.startsWith('#'))return;
    e.preventDefault();
    e.stopPropagation();
    if(h.startsWith('#'))document.getElementById(h.slice(1))?.scrollIntoView({behavior:'smooth'});
  },true);
})();
</script>`;
    html = html.replace('<head>', `<head>\n${navGuard}`);

    sendHtml(res, 200, html);
  } catch (err) {
    const reason = safeErrorMessage(err);
    sendJson(res, 500, { error: `Render failed in block "unknown": ${reason}` });
  }
}

async function handleExportLevel1(
  req: IncomingMessage,
  res: ServerResponse,
  workspace: string,
): Promise<void> {
  let body: {
    cssVars?: Record<string, string>;
    blocksDisabled?: string[];
    blocksOrder?: string[];
    blockParams?: Record<string, Record<string, string>>;
    profile?: string;
    topNavConfig?: {
      topBarVisible?: boolean;
      search?: boolean;
      langSwitcher?: boolean;
      themeToggle?: boolean;
      items?: Array<{ id: string; label: string; enabled: boolean; order: number }>;
    };
    sideNavConfig?: { sidebarVisible?: boolean; items: Array<{ id: string; enabled: boolean; order: number }> };
  };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  try {
    const htmlTmplDir = join(workspace, 'wsp', 'templates', 'html');
    mkdirSync(htmlTmplDir, { recursive: true });
    // Use profile-specific filename to avoid clash between assessment types
    const safeProfile = /^[a-z0-9-]+$/.test(body.profile ?? '') ? body.profile! : 'application';
    const tmplPath = join(htmlTmplDir, `publication-${safeProfile}.html.tmpl`);

    // Apply block order + per-block params
    let tmpl = buildCustomTemplate(BUNDLED_TEMPLATE_CONTENT, body.blocksOrder, body.blockParams);

    // Write CSS variable overrides to wsp/templates/styles/ci.yaml (D1 -- #0930).
    // Only recognised Tier 1 token names are written; unknown vars are silently discarded.
    // The renderer reads ci.yaml on every `swao publish` run, so the template stays clean.
    if (body.cssVars && Object.keys(body.cssVars).length > 0) {
      const validSet = new Set<string>(TIER1_TOKENS);
      const lightTokens: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.cssVars)) {
        if (validSet.has(k)) lightTokens[k] = v;
      }
      if (Object.keys(lightTokens).length > 0) {
        const stylesDir = join(workspace, 'wsp', 'templates', 'styles');
        mkdirSync(stylesDir, { recursive: true });
        const ciYaml = dumpYaml(lightTokens, { lineWidth: 120 });
        writeFileSync(join(stylesDir, 'ci.yaml'), ciYaml, 'utf-8');
      }
    }

    // Remove disabled blocks from the exported template.
    // Block names are validated against an allowlist to prevent regex injection.
    const SAFE_BLOCK_NAME = /^[a-z][a-z0-9-]{1,40}$/;
    if (body.blocksDisabled && body.blocksDisabled.length > 0) {
      for (const b of body.blocksDisabled) {
        if (!SAFE_BLOCK_NAME.test(b)) continue;
        tmpl = tmpl.replace(new RegExp(`<!--\\s*SWAO:slot\\s+name="${b}"[^>]*?-->`, 'g'), '');
      }
      // Bake link-suppression CSS into the exported template so rendered navigation
      // blocks (quick-nav, sidebar, top-nav) do not show links to removed sections.
      const linkRules = body.blocksDisabled
        .filter(b => SAFE_BLOCK_NAME.test(b))
        .flatMap(b => [
          `a[href="#${b}"] { display: none !important; }`,
          `li:has(> a[href="#${b}"]) { display: none !important; }`,
        ]).join('\n');
      if (linkRules) {
        const linkStyle = `<style id="swao-disabled-links">\n${linkRules}\n</style>`;
        tmpl = tmpl.replace('</head>', `${linkStyle}\n</head>`);
      }
    }

    // Inject top nav config into template
    if (body.topNavConfig) {
      const topNav = body.topNavConfig;
      const topRules: string[] = [];
      if (topNav.topBarVisible === false) {
        topRules.push('header.site-header { display: none !important; }');
        topRules.push('.breadcrumb-bar { margin-top: 0 !important; }');
      }
      if (topNav.search === false) topRules.push('.site-header__search { display: none !important; }');
      if (topNav.langSwitcher === false) topRules.push('#lang-select { display: none !important; }');
      if (topNav.themeToggle === false) topRules.push('#dark-mode-toggle { display: none !important; }');

      // Rewrite nav HTML with enabled items in order (baked into template, not CSS)
      if (topNav.items && topNav.items.length > 0) {
        const enabledItems = topNav.items
          .filter(item => item.enabled !== false)
          .sort((a, b) => a.order - b.order);
        if (enabledItems.length > 0) {
          const navLinks = enabledItems.map(item => {
            const safeId = item.id.replace(/[^a-zA-Z0-9-_]/g, '');
            if (!safeId) return '';
            const label = (item.label ?? safeId).replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `      <a href="#${safeId}" data-nav-key="${safeId}" data-i18n-key="nav.${safeId}">${label}</a>`;
          }).filter(Boolean).join('\n');
          const newNav = `<nav class="site-header__nav" aria-label="Main navigation">\n${navLinks}\n    </nav>`;
          tmpl = tmpl.replace(/<nav class="site-header__nav"[^>]*>[\s\S]*?<\/nav>/, newNav);
        }
      }

      if (topRules.length > 0) {
        const topStyle = `<style id="swao-topnav-overrides">\n${topRules.join('\n')}\n</style>`;
        tmpl = tmpl.replace('</head>', `${topStyle}\n</head>`);
      }
    }

    // Inject sidebar visibility + order into template
    if (body.sideNavConfig?.sidebarVisible === false) {
      const hideStyle = `<style id="swao-sidebar-hide">\n#swao-sidebar { display: none !important; }\n.page-layout { grid-template-columns: 1fr !important; }\n</style>`;
      tmpl = tmpl.replace('</head>', `${hideStyle}\n</head>`);
    }
    {
      // Sidebar order: cover=1, quick-nav=2, coverage-bar=3, nav items start at 4,
      // stakeholder-challenge=998, footer=999.
      const sideRules: string[] = [
        '#swao-sidebar-nav { display: flex; flex-direction: column; }',
        '#swao-sidebar-nav li:has(a[href="#quick-nav"]) { order: 2; }',
        '#swao-sidebar-nav li:has(a[href="#coverage-bar"]) { order: 3; }',
        '#swao-sidebar-nav li:has(a[href="#stakeholder-challenge"]) { order: 998; }',
        '#swao-sidebar-nav li:has(a[href="#footer"]) { order: 999; }',
      ];
      if (body.sideNavConfig?.items && body.sideNavConfig.items.length > 0) {
        const sortedItems = body.sideNavConfig.items.slice().sort((a, b) => a.order - b.order);
        let pos = 4; // positions 1-3 reserved for cover/quick-nav/coverage-bar
        for (const item of sortedItems) {
          const safeId = item.id.replace(/[^a-zA-Z0-9-_]/g, '');
          if (!safeId) continue;
          // Cover always gets position 1 (first section in the page)
          const order = safeId === 'cover' ? 1 : pos++;
          sideRules.push(`#swao-sidebar-nav li:has(a[href="#${safeId}"]) { order: ${order}; }`);
          if (!item.enabled) {
            sideRules.push(`#swao-sidebar-nav li:has(a[href="#${safeId}"]) { display: none !important; }`);
          }
        }
      }
      const sideStyle = `<style id="swao-sidenav-overrides">\n${sideRules.join('\n')}\n</style>`;
      // Replace any existing sidenav-overrides style block, or inject before </head>
      if (tmpl.includes('<style id="swao-sidenav-overrides">')) {
        tmpl = tmpl.replace(/<style id="swao-sidenav-overrides">[\s\S]*?<\/style>/, sideStyle);
      } else {
        tmpl = tmpl.replace('</head>', `${sideStyle}\n</head>`);
      }
    }

    writeFileSync(tmplPath, tmpl, 'utf-8');
    sendJson(res, 200, { path: tmplPath, ok: true });
  } catch (err) {
    sendJson(res, 500, { error: safeErrorMessage(err) });
  }
}

async function handleExportLevel2(
  _req: IncomingMessage,
  res: ServerResponse,
  workspace: string,
): Promise<void> {
  try {
    const htmlTmplDir2 = join(workspace, 'wsp', 'templates', 'html');
    mkdirSync(htmlTmplDir2, { recursive: true });
    const stubPath = join(htmlTmplDir2, 'publication-data.html');
    const stub = `<!DOCTYPE html>
<!-- SWAO Publication Data Shell -- Level 2 template -->
<!-- Operator replaces this placeholder with custom HTML/CSS -->
<html lang="en"><head><meta charset="utf-8">
<title>SWAO Publication (custom shell)</title>
</head><body>
<!-- publication data injected here by swao publish -->
<script type="application/json" id="swao-pub-data">/* injected by renderer */</script>
</body></html>`;
    writeFileSync(stubPath, stub, 'utf-8');
    sendJson(res, 200, { path: stubPath, ok: true });
  } catch (err) {
    sendJson(res, 500, { error: safeErrorMessage(err) });
  }
}

// ---------------------------------------------------------------------------
// Allowed fields in POST /settings/content body -> publication_config.*
// Unknown request fields are ignored per D3 AC (future-proofing).
// ---------------------------------------------------------------------------

const CONTENT_FIELDS = [
  'logo_name', 'logo_sub', 'classification_band',
  'github_url', 'docs_url', 'footer_note',
  'primary_contact', 'secondary_contact',
] as const;

async function handleSettingsContent(
  req: IncomingMessage,
  res: ServerResponse,
  workspace: string,
  appId: string | undefined,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  // Write to app-level .swao.yml so swao publish can read it via the extractor.
  // The extractor reads publication.* from apps/<appId>/.swao.yml (not workspace root).
  const swaoYmlPath = appId
    ? join(workspace, 'apps', appId, '.swao.yml')
    : join(workspace, '.swao.yml');
  let yaml: Record<string, unknown> = {};
  if (existsSync(swaoYmlPath)) {
    try {
      const parsed = loadYaml(readFileSync(swaoYmlPath, 'utf-8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        yaml = parsed as Record<string, unknown>;
      }
    } catch (err) {
      sendJson(res, 500, { error: `Failed to read .swao.yml: ${safeErrorMessage(err)}` });
      return;
    }
  }

  // Ensure the `publication` key exists (matches extractor.ts swaoYml?.publication read path).
  if (!yaml['publication'] || typeof yaml['publication'] !== 'object' || Array.isArray(yaml['publication'])) {
    yaml['publication'] = {};
  }
  const pubCfg = yaml['publication'] as Record<string, unknown>;

  // Merge recognised fields; unknown fields are silently ignored
  for (const field of CONTENT_FIELDS) {
    if (field in body && typeof body[field] === 'string') {
      pubCfg[field] = body[field] as string;
    }
  }

  // Write back as UTF-8 (no BOM) -- Node writeFileSync with 'utf-8' does not add BOM
  try {
    mkdirSync(join(swaoYmlPath, '..'), { recursive: true });
    const yamlOut = dumpYaml(yaml, { lineWidth: 120 });
    writeFileSync(swaoYmlPath, yamlOut, 'utf-8');
  } catch (err) {
    sendJson(res, 500, { error: `Failed to write .swao.yml: ${safeErrorMessage(err)}` });
    return;
  }

  sendJson(res, 200, { ok: true, path: swaoYmlPath });
}

// ---------------------------------------------------------------------------
// D4 Phase 2: POST /settings/branding -- write Tier 1 tokens to ci.yaml
// ---------------------------------------------------------------------------

async function handleSettingsBranding(
  req: IncomingMessage,
  res: ServerResponse,
  workspace: string,
): Promise<void> {
  let body: { cssVars?: Record<string, string> };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!body.cssVars || typeof body.cssVars !== 'object' || Array.isArray(body.cssVars)) {
    sendJson(res, 400, { error: 'cssVars required' });
    return;
  }

  try {
    const stylesDir = join(workspace, 'wsp', 'templates', 'styles');
    mkdirSync(stylesDir, { recursive: true });
    const ciYamlPath = join(stylesDir, 'ci.yaml');

    // Read existing ci.yaml and merge (not overwrite)
    let existing: Record<string, string> = {};
    if (existsSync(ciYamlPath)) {
      const rawCi = loadYaml(readFileSync(ciYamlPath, 'utf-8'));
      if (rawCi && typeof rawCi === 'object' && !Array.isArray(rawCi)) {
        existing = rawCi as Record<string, string>;
      }
    }

    const validSet = new Set<string>(TIER1_TOKENS);
    const merged = { ...existing };
    for (const [k, v] of Object.entries(body.cssVars)) {
      if (validSet.has(k) && typeof v === 'string') merged[k] = v;
    }

    writeFileSync(ciYamlPath, dumpYaml(merged, { lineWidth: 120 }), 'utf-8');
    sendJson(res, 200, { ok: true, path: ciYamlPath });
  } catch (err) {
    sendJson(res, 500, { error: safeErrorMessage(err) });
  }
}

// ---------------------------------------------------------------------------
// D4 Phase 2: POST /settings/profile -- write block order/options to profile YAML
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /settings/variant -- switch the active profile variant
// ---------------------------------------------------------------------------

async function handleSetVariant(
  req: IncomingMessage,
  res: ServerResponse,
  getActiveVariant: () => string | undefined,
  setActiveVariant: (v: string | undefined) => void,
): Promise<void> {
  let body: { variant?: string };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  const SAFE_VARIANT = /^[a-z][a-z0-9-]{0,40}$/;
  const raw = body.variant;
  if (raw !== undefined && raw !== 'default' && !SAFE_VARIANT.test(raw)) {
    sendJson(res, 400, { error: 'Invalid variant name' });
    return;
  }
  const next = (raw === 'default' || raw === undefined) ? undefined : raw;
  setActiveVariant(next);
  sendJson(res, 200, { ok: true, active_variant: getActiveVariant() ?? 'default' });
}

// ---------------------------------------------------------------------------
// D4 Phase 2: POST /settings/profile -- write block order/options to profile YAML
// ---------------------------------------------------------------------------

async function handleSettingsProfile(
  req: IncomingMessage,
  res: ServerResponse,
  workspace: string,
  activeVariant: string | undefined,
): Promise<void> {
  let body: {
    profile?: string;
    blocks?: Array<{ id: string; enabled: boolean; order: number }>;
    options?: Record<string, Record<string, string>>;
    nav?: Record<string, unknown>;
  };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const SAFE_PROFILE = /^[a-z][a-z0-9-]{1,40}$/;
  const profileId = body.profile ?? 'application';
  if (!SAFE_PROFILE.test(profileId)) {
    sendJson(res, 400, { error: 'Invalid profile id' });
    return;
  }

  const SAFE_BLOCK = /^[a-z][a-z0-9-]{1,40}$/;

  try {
    const profileDir = join(workspace, 'wsp', 'templates', 'profiles');
    mkdirSync(profileDir, { recursive: true });
    const profilePath = resolveProfilePath(workspace, profileId, activeVariant);

    // Read existing profile to preserve any fields not in this request
    let existing: Record<string, unknown> = {};
    if (existsSync(profilePath)) {
      const rawExisting = loadYaml(readFileSync(profilePath, 'utf-8'));
      if (rawExisting && typeof rawExisting === 'object' && !Array.isArray(rawExisting)) {
        existing = rawExisting as Record<string, unknown>;
      }
    }

    // Validate + sanitize blocks array
    const blocks: Array<{ id: string; enabled: boolean; order: number }> = [];
    for (const blk of (body.blocks ?? [])) {
      if (typeof blk.id !== 'string' || !SAFE_BLOCK.test(blk.id)) continue;
      blocks.push({
        id: blk.id,
        enabled: blk.enabled !== false,
        order: typeof blk.order === 'number' ? Math.round(blk.order) : 0,
      });
    }

    // Validate + sanitize options (string values only, bounded length)
    const options: Record<string, Record<string, string>> = {};
    for (const [blockId, opts] of Object.entries(body.options ?? {})) {
      if (!SAFE_BLOCK.test(blockId)) continue;
      const safeOpts: Record<string, string> = {};
      for (const [k, v] of Object.entries(opts)) {
        if (typeof k === 'string' && typeof v === 'string' && k.length <= 40 && v.length <= 200) {
          safeOpts[k] = v;
        }
      }
      if (Object.keys(safeOpts).length > 0) options[blockId] = safeOpts;
    }

    // Merge nav: shallow-merge at the nav level, but deep-merge nav.top so that
    // saveProfile() (which only sends chrome toggles) does not wipe nav.top.items
    // saved previously by saveTopNavLayout().
    let mergedNav: Record<string, unknown> | undefined;
    if (body.nav !== undefined) {
      const existingNav = (existing['nav'] && typeof existing['nav'] === 'object')
        ? existing['nav'] as Record<string, unknown> : {};
      mergedNav = { ...existingNav, ...body.nav };
      if (body.nav['top'] && typeof body.nav['top'] === 'object' &&
          existingNav['top'] && typeof existingNav['top'] === 'object') {
        mergedNav['top'] = {
          ...(existingNav['top'] as Record<string, unknown>),
          ...(body.nav['top'] as Record<string, unknown>),
        };
      }
    }
    const profileData: Record<string, unknown> = {
      ...existing,
      profile: profileId,
      ...(blocks.length > 0 && { blocks }),
      ...(Object.keys(options).length > 0 && { options }),
      ...(mergedNav !== undefined && { nav: mergedNav }),
    };
    writeFileSync(profilePath, dumpYaml(profileData, { lineWidth: 120 }), 'utf-8');
    sendJson(res, 200, { ok: true, path: profilePath });
  } catch (err) {
    sendJson(res, 500, { error: safeErrorMessage(err) });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEditorServer(opts: EditorServerOptions = {}): EditorServer {
  const port = opts.port ?? 4001;
  const workspace = opts.workspace ?? findWorkspace(process.cwd()) ?? process.cwd();
  const defaultAppId = opts.appId;

  // Mutable active variant -- changes when the browser calls POST /settings/variant.
  let activeVariant: string | undefined = opts.profileVariant;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // Route dispatch
    void (async () => {
      try {
        if (method === 'GET' && url === '/health') {
          handleHealth(res);
        } else if (method === 'GET' && (url === '/context' || url.startsWith('/context?'))) {
          // #1123: extract optional ?profile= override
          const qsProfile = url.includes('?')
            ? (new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('profile') ?? undefined)
            : undefined;
          handleContext(res, workspace, defaultAppId, activeVariant, qsProfile);
        } else if (method === 'GET' && url === '/') {
          handleGetRoot(res);
        } else if (method === 'POST' && url === '/preview') {
          await handlePreview(req, res, workspace, defaultAppId);
        } else if (method === 'POST' && url === '/export/level1') {
          await handleExportLevel1(req, res, workspace);
        } else if (method === 'POST' && url === '/export/level2') {
          await handleExportLevel2(req, res, workspace);
        } else if (method === 'POST' && url === '/settings/content') {
          await handleSettingsContent(req, res, workspace, defaultAppId);
        } else if (method === 'POST' && url === '/settings/branding') {
          await handleSettingsBranding(req, res, workspace);
        } else if (method === 'POST' && url === '/settings/profile') {
          await handleSettingsProfile(req, res, workspace, activeVariant);
        } else if (method === 'POST' && url === '/settings/variant') {
          await handleSetVariant(req, res, () => activeVariant, (v) => { activeVariant = v; });
        } else {
          sendJson(res, 404, { error: 'Not found' });
        }
      } catch (err) {
        sendJson(res, 500, { error: safeErrorMessage(err) });
      }
    })();
  });

  return {
    start(): Promise<number> {
      return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
          // Return the bound port number, not a URL string, so callers construct
          // the URL from a numeric value that cannot carry shell-injection payloads.
          resolve(port);
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err); else resolve();
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Fallback editor HTML (rendered when editor.html is not bundled)
// ---------------------------------------------------------------------------

const EDITOR_HTML_FALLBACK = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>SWAO Publication Editor</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:system-ui,sans-serif;background:#f8fafc;color:#111827;display:grid;grid-template-columns:320px 1fr;min-height:100vh;}
  #sidebar{background:#1a2744;color:#e2e8f0;padding:1rem;overflow-y:auto;}
  #sidebar h1{font-size:1rem;font-weight:700;color:#fff;margin-bottom:0.25rem;}
  #sidebar .sub{font-size:0.7rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:1.25rem;}
  #sidebar h2{font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.5);margin:1.25rem 0 0.5rem;}
  .tab-bar{display:flex;gap:2px;margin-bottom:1rem;background:rgba(0,0,0,0.3);border-radius:6px;padding:3px;}
  .tab-btn{flex:1;padding:0.3rem 0.4rem;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;background:transparent;color:rgba(255,255,255,0.5);border:none;border-radius:4px;cursor:pointer;}
  .tab-btn.active{background:rgba(255,255,255,0.15);color:#fff;}
  .tab-panel{display:none;}.tab-panel.active{display:block;}
  .nav-row{display:flex;align-items:center;gap:0.5rem;padding:0.2rem 0;border-bottom:1px solid rgba(255,255,255,0.06);}
  .nav-row input[type=checkbox]{accent-color:#7c3aed;flex-shrink:0;}
  .nav-row label{font-size:0.78rem;flex:1;color:#e2e8f0;cursor:pointer;}
  .nav-item-row{display:flex;align-items:center;gap:0.35rem;padding:0.2rem 0;border-bottom:1px solid rgba(255,255,255,0.06);}
  .nav-item-row input[type=checkbox]{accent-color:#7c3aed;flex-shrink:0;}
  .nav-item-row label{font-size:0.78rem;flex:1;color:#e2e8f0;cursor:pointer;}
  .move-nav{background:none;border:none;color:rgba(255,255,255,0.35);cursor:pointer;font-size:0.65rem;padding:0 1px;line-height:1;}
  .move-nav:hover{color:#fff;}
  .colour-row{display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;}
  .colour-row label{font-size:0.8rem;flex:1;color:#e2e8f0;}
  .colour-row input[type=color]{width:32px;height:24px;border:none;border-radius:3px;cursor:pointer;padding:0;}
  .preset-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;margin-bottom:0.75rem;}
  .preset-btn{padding:0.35rem 0.5rem;font-size:0.75rem;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#e2e8f0;border-radius:4px;cursor:pointer;}
  .preset-btn:hover,.preset-btn.active{background:rgba(255,255,255,0.22);border-color:rgba(255,255,255,0.5);}
  .block-list{list-style:none;}
  .block-list li{display:flex;align-items:center;gap:0.4rem;padding:0.25rem 0;font-size:0.8rem;border-bottom:1px solid rgba(255,255,255,0.06);}
  .block-list input[type=checkbox]{accent-color:#7c3aed;flex-shrink:0;}
  .block-list .blk-label{flex:1;color:#e2e8f0;}
  .blk-move{background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:0.7rem;padding:0 2px;line-height:1;}
  .blk-move:hover{color:#fff;}
  .blk-settings{background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:0.75rem;padding:0 2px;margin-left:auto;}
  .blk-settings:hover{color:#7c3aed;}
  select.blk-filter{font-size:0.7rem;background:#0f172a;color:#e2e8f0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;padding:1px 3px;max-width:90px;}
  #main-area{display:flex;flex-direction:column;}
  #toolbar{background:#fff;border-bottom:1px solid #e5e7eb;padding:0.6rem 1rem;display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;}
  #toolbar label{font-size:0.85rem;font-weight:600;}
  #toolbar input[type=text]{padding:0.3rem 0.5rem;border:1px solid #d1d5db;border-radius:4px;font-size:0.85rem;width:190px;}
  .btn{padding:0.35rem 0.8rem;border:0;border-radius:4px;cursor:pointer;font-size:0.8rem;font-weight:600;}
  .btn-primary{background:#1a2744;color:#fff;}
  .btn-secondary{background:#7c3aed;color:#fff;}
  .btn-outline{background:#fff;color:#1a2744;border:1px solid #d1d5db;}
  .btn-mode{background:#f1f5f9;color:#374151;border:1px solid #d1d5db;padding:0.3rem 0.65rem;font-size:0.78rem;}
  .btn-mode.active{background:#1a2744;color:#fff;border-color:#1a2744;}
  .btn:hover{opacity:0.88;}
  .btn-sep{width:1px;height:28px;background:#e5e7eb;margin:0 0.1rem;}
  #preview-wrap{flex:1;overflow:auto;background:#e2e8f0;display:flex;align-items:flex-start;justify-content:center;padding:0.5rem;}
  #preview-frame{border:none;background:#fff;width:100%;height:100%;min-height:600px;}
  #preview-frame.mobile{max-width:390px;box-shadow:0 4px 24px rgba(0,0,0,0.15);}
  #status{font-size:0.75rem;color:#6b7280;margin-left:auto;white-space:nowrap;}
</style>
</head>
<body>
<div id="sidebar">
  <h1>SWAO Publication Editor</h1>
  <div class="sub">Layout &bull; Content &bull; Style</div>

  <div class="tab-bar">
    <button class="tab-btn active" data-testid="tab-layout" onclick="switchTab('layout')">Layout</button>
    <button class="tab-btn" data-testid="tab-content" onclick="switchTab('content')">Content</button>
    <button class="tab-btn" data-testid="tab-style" onclick="switchTab('style')">Style</button>
  </div>

  <!-- Layout tab -->
  <div class="tab-panel active" id="tab-layout">
    <div style="margin-bottom:0.75rem;">
      <label for="assessment-type-selector" style="font-size:0.72rem;color:rgba(255,255,255,0.5);display:block;margin-bottom:0.2rem;">Assessment Type</label>
      <select id="assessment-type-selector" onchange="switchAssessmentType(this.value)"
        style="width:100%;background:#0f172a;color:#e2e8f0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:0.3rem;font-size:0.78rem;">
        <option value="application">Application Assessment</option>
        <option value="lz-catalog">Landing Zone Catalog</option>
      </select>
    </div>
    <h2>Publication Elements</h2>
    <p style="font-size:0.7rem;color:rgba(255,255,255,0.4);margin-bottom:0.5rem;">Toggle structural elements and top bar chrome. Assessment content blocks are managed via the nav panels below.</p>
    <p id="active-profile-label" style="font-size:0.68rem;color:rgba(255,255,255,0.35);margin-bottom:0.25rem;">Profile: application</p>
    <ul class="block-list" id="block-list"><!-- populated from /context template_slots --></ul>
    <div class="nav-row"><input type="checkbox" id="nav-search" checked onchange="schedulePreview()"><label for="nav-search">Search box</label></div>
    <div class="nav-row"><input type="checkbox" id="nav-lang" checked onchange="schedulePreview()"><label for="nav-lang">Language switcher</label></div>
    <div class="nav-row"><input type="checkbox" id="nav-theme" checked onchange="schedulePreview()"><label for="nav-theme">Dark mode toggle (in publication)</label></div>
    <button class="btn btn-secondary" onclick="saveProfile()" style="margin-top:0.5rem;width:100%;" title="Saves structural element visibility and top bar chrome to profile YAML. Applied on next swao publish.">Save Elements</button>
    <h2>Top Nav Panel</h2>
    <p style="font-size:0.7rem;color:rgba(255,255,255,0.4);margin-bottom:0.5rem;">Configure top bar links. Default: 6 key sections shown.</p>
    <div class="nav-row"><input type="checkbox" id="nav-topbar" checked onchange="schedulePreview()"><label for="nav-topbar">Show top bar</label></div>
    <ul class="block-list" id="top-nav-items"><!-- populated by buildTopNavItems --></ul>
    <button class="btn btn-secondary" onclick="saveTopNavLayout()" style="margin-top:0.5rem;width:100%;" title="Saves top nav configuration to the profile YAML. Applied on next swao publish.">Save Top Nav</button>
    <h2>Side Nav Panel</h2>
    <p style="font-size:0.7rem;color:rgba(255,255,255,0.4);margin-bottom:0.35rem;">Configure sidebar links. Toggle visibility and reorder below.</p>
    <div class="nav-row"><input type="checkbox" id="nav-sidebar" checked onchange="schedulePreview()"><label for="nav-sidebar">Show sidebar</label></div>
    <ul class="block-list" id="side-nav-items"><!-- populated by buildSideNavItems --></ul>
    <button class="btn btn-secondary" onclick="saveSideNavLayout()" style="margin-top:0.5rem;margin-bottom:0.5rem;width:100%;" title="Saves sidebar configuration to the profile YAML. Applied on next swao publish.">Save Side Nav</button>
  </div>

  <!-- Style tab -->
  <div class="tab-panel" id="tab-style">
  <h2>Presets</h2>
  <div class="preset-grid">
    <button class="preset-btn" onclick="applyPreset('default')">Default</button>
    <button class="preset-btn" onclick="applyPreset('dark-pro')">Dark Professional</button>
    <button class="preset-btn" onclick="applyPreset('minimal')">Minimal Light</button>
    <button class="preset-btn" onclick="applyPreset('client-red')">Client Red</button>
  </div>

  <h2>Brand</h2>
  <div class="colour-row"><label>--brand-primary</label><input type="color" id="brand-primary" value="#1a2744"></div>
  <div class="colour-row"><label>--brand-accent</label><input type="color" id="brand-accent" value="#7c3aed"></div>

  <h2>Severity</h2>
  <div class="colour-row"><label>--sev-critical</label><input type="color" id="sev-critical" value="#dc2626"></div>
  <div class="colour-row"><label>--sev-high</label><input type="color" id="sev-high" value="#f97316"></div>
  <div class="colour-row"><label>--sev-medium</label><input type="color" id="sev-medium" value="#d97706"></div>
  <div class="colour-row"><label>--sev-low</label><input type="color" id="sev-low" value="#2563eb"></div>
  <div class="colour-row"><label>--sev-info</label><input type="color" id="sev-info" value="#64748b"></div>
  <div class="colour-row"><label>--sev-positive</label><input type="color" id="sev-positive" value="#16a34a"></div>

  <h2>RAG Status</h2>
  <div class="colour-row"><label>--rag-pass</label><input type="color" id="rag-pass" value="#16a34a"></div>
  <div class="colour-row"><label>--rag-partial</label><input type="color" id="rag-partial" value="#d97706"></div>
  <div class="colour-row"><label>--rag-fail</label><input type="color" id="rag-fail" value="#dc2626"></div>
  <div class="colour-row"><label>--rag-info</label><input type="color" id="rag-info" value="#3b82f6"></div>
  <div class="colour-row"><label>--rag-positive</label><input type="color" id="rag-positive" value="#16a34a"></div>

  <h2>Backgrounds</h2>
  <div class="colour-row"><label>--bg-primary</label><input type="color" id="bg-primary" value="#f8fafc"></div>
  <div class="colour-row"><label>--bg-secondary</label><input type="color" id="bg-secondary" value="#ffffff"></div>
  <div class="colour-row"><label>--bg-dark</label><input type="color" id="bg-dark" value="#f1f5f9"></div>
  <div class="colour-row"><label>--bg-overlay</label><input type="color" id="bg-overlay" value="#00000033"></div>
  <button class="btn btn-secondary" onclick="saveBranding()" style="margin-top:0.75rem;width:100%;" title="Writes Tier 1 CSS tokens to wsp/templates/styles/ci.yaml. Applied on next swao publish.">Save Branding</button>
  </div><!-- /tab-style -->

  <!-- Content tab -->
  <div class="tab-panel" id="tab-content">
  <h2>Content Overrides</h2>
  <div class="colour-row"><label style="font-size:0.75rem;">Classification band</label><input type="text" id="content-band" value="SWAO - Sovereign Workload Assessment &amp; Onboarding" style="flex:1;font-size:0.72rem;background:#0f172a;color:#e2e8f0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;padding:2px 4px;"></div>
  <div class="colour-row"><label style="font-size:0.75rem;">Logo name</label><input type="text" id="content-logo-name" value="SWAO" style="flex:1;font-size:0.72rem;background:#0f172a;color:#e2e8f0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;padding:2px 4px;"></div>
  <div class="colour-row"><label style="font-size:0.75rem;">Logo sub</label><input type="text" id="content-logo-sub" value="PUBLICATION" style="flex:1;font-size:0.72rem;background:#0f172a;color:#e2e8f0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;padding:2px 4px;"></div>
  <div class="colour-row"><label style="font-size:0.75rem;">GitHub URL</label><input type="text" id="content-github-url" placeholder="https://github.com/..." style="flex:1;font-size:0.72rem;background:#0f172a;color:#e2e8f0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;padding:2px 4px;"></div>
  <div class="colour-row"><label style="font-size:0.75rem;">Docs URL</label><input type="text" id="content-docs-url" placeholder="https://..." style="flex:1;font-size:0.72rem;background:#0f172a;color:#e2e8f0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;padding:2px 4px;"></div>
  <button class="btn btn-secondary" onclick="saveContentSettings()" style="margin-top:0.5rem;width:100%;" title="Writes classification band, logo name/sub, and URLs to .swao.yml under publication_config. swao publish will use these values.">Save Content Settings</button>
  </div><!-- /tab-content -->
</div><!-- /sidebar -->

<div id="main-area">
  <div id="toolbar">
    <label title="Preview only -- the exported template is not bound to a specific app. Any app in your workspace can use it.">Preview App ID: <input type="text" id="app-id" placeholder="sovereign-health"></label>
    <button class="btn btn-primary" onclick="loadPreview()">Load Preview</button>
    <div class="btn-sep"></div>
    <button class="btn btn-mode active" id="mode-desktop" onclick="setViewport('desktop')">Desktop</button>
    <button class="btn btn-mode" id="mode-mobile" onclick="setViewport('mobile')">Mobile</button>
    <button class="btn btn-mode" id="mode-dark" onclick="toggleDark()">Dark</button>
    <div class="btn-sep"></div>
    <button class="btn btn-secondary" onclick="exportLevel1()" title="Saves your block layout, order, and theme as wsp/templates/html/publication-&lt;profile&gt;.html.tmpl. Run &apos;swao publish --app &lt;id&gt;&apos; -- the renderer auto-picks the matching template. Delete the file to revert to the built-in default.">Export Template (Level 1)</button>
    <span id="status"></span>
  </div>
  <div id="preview-wrap">
    <iframe id="preview-frame" src="about:blank"></iframe>
  </div>
</div>

<script>
var debounceTimer = null;
var darkMode = false;

var COLOUR_VARS = [
  '--brand-primary','--brand-accent',
  '--sev-critical','--sev-high','--sev-medium','--sev-low','--sev-info','--sev-positive',
  '--rag-pass','--rag-partial','--rag-fail','--rag-info','--rag-positive',
  '--bg-primary','--bg-secondary','--bg-dark','--bg-overlay'
];

var PRESETS = {
  'default':    {'--brand-primary':'#1a2744','--brand-accent':'#7c3aed','--bg-primary':'#f8fafc','--bg-secondary':'#ffffff'},
  'dark-pro':   {'--brand-primary':'#0f2044','--brand-accent':'#b8860b','--bg-primary':'#0f172a','--bg-secondary':'#1e293b'},
  'minimal':    {'--brand-primary':'#1d4ed8','--brand-accent':'#0ea5e9','--bg-primary':'#ffffff','--bg-secondary':'#f8fafc'},
  'client-red': {'--brand-primary':'#a100ff','--brand-accent':'#460073','--bg-primary':'#f8fafc','--bg-secondary':'#ffffff'}
};

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  var panel = document.getElementById('tab-' + name);
  if (panel) panel.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    if (b.getAttribute('onclick') === "switchTab('" + name + "')") b.classList.add('active');
  });
}

// Per-profile default checked items in the top nav (6 for application, fewer for others)
var TOP_NAV_DEFAULT_CHECKED = {
  'application': ['cover', 'signal-list', 'compliance-regime', 'controls', 'risk-register', 'methodology'],
  'lz-catalog':  ['cover', 'lzr-catalog-verdict', 'lz-catalog-services', 'lzr-catalog-findings', 'lzr-catalog-finops'],
  'hub':         ['hub-header', 'hub-app-list', 'hub-workspace-summary'],
};

// Structural/meta slots: excluded from both Top Nav and Side Nav panels; managed in Publication Elements
var NON_NAV_SLOTS = { 'quick-nav': true, 'coverage-bar': true, 'footer': true, 'stakeholder-challenge': true };

function buildTopNavItems(slots, allowed, savedTop) {
  var list = document.getElementById('top-nav-items');
  if (!list) return;
  var activeSlots = allowed ? slots.filter(function(s) { return allowed.includes(s); }) : slots;
  var navSlots = activeSlots.filter(function(s) { return !NON_NAV_SLOTS[s]; });
  var profile = window._swaoProfile || 'application';
  var defaults = TOP_NAV_DEFAULT_CHECKED[profile] || TOP_NAV_DEFAULT_CHECKED['application'];
  var defaultSet = {};
  defaults.forEach(function(id) { defaultSet[id] = true; });
  list.innerHTML = navSlots.map(function(sid) {
    var checked = defaultSet[sid] ? ' checked' : '';
    return '<li data-nav="' + sid + '"><input type="checkbox" id="tnav-' + sid + '"' + checked + ' onchange="schedulePreview()">' +
      '<span class="blk-label">' + slotLabel(sid) + '</span>' +
      '<button class="blk-move" onclick="moveTopNavItem(this,-1)">&#9650;</button>' +
      '<button class="blk-move" onclick="moveTopNavItem(this,1)">&#9660;</button></li>';
  }).join('');
  if (savedTop && savedTop.items && Array.isArray(savedTop.items)) {
    var sorted = savedTop.items.slice().sort(function(a, b) { return a.order - b.order; });
    sorted.forEach(function(item) {
      var li = list.querySelector('li[data-nav="' + item.id + '"]');
      if (li) list.appendChild(li);
    });
    savedTop.items.forEach(function(item) {
      var cb = document.getElementById('tnav-' + item.id);
      if (cb) cb.checked = item.enabled !== false;
    });
  }
}

function getTopNav() {
  var chk = function(id) { var el = document.getElementById(id); return el ? el.checked : true; };
  var items = Array.from(document.querySelectorAll('#top-nav-items li[data-nav]')).map(function(li, idx) {
    var sid = li.getAttribute('data-nav');
    var cb = document.getElementById('tnav-' + sid);
    return { id: sid, label: slotLabel(sid), enabled: cb ? cb.checked : true, order: idx + 1 };
  });
  return {
    topBarVisible: chk('nav-topbar'),
    search: chk('nav-search'),
    langSwitcher: chk('nav-lang'),
    themeToggle: chk('nav-theme'),
    items: items.length > 0 ? items : null,
  };
}

function getSideNav() {
  var chkEl = document.getElementById('nav-sidebar');
  var items = Array.from(document.querySelectorAll('#side-nav-items li[data-nav]')).map(function(li, idx) {
    var sid = li.getAttribute('data-nav');
    var cb = document.getElementById('snav-' + sid);
    return { id: sid, enabled: cb ? cb.checked : true, order: idx + 1 };
  });
  return { sidebarVisible: chkEl ? chkEl.checked : true, items: items };
}

function moveTopNavItem(btn, dir) {
  var li = btn.closest('li');
  var list = li.parentNode;
  if (dir === -1 && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
  else if (dir === 1 && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
  schedulePreview();
}

function moveSideNavItem(btn, dir) {
  var li = btn.closest('li');
  var list = li.parentNode;
  if (dir === -1 && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
  else if (dir === 1 && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
  schedulePreview();
}

function getContentOverrides() {
  return {
    classificationBand: document.getElementById('content-band')?.value || '',
    logoName: document.getElementById('content-logo-name')?.value || '',
    logoSub: document.getElementById('content-logo-sub')?.value || '',
    githubUrl: document.getElementById('content-github-url')?.value || undefined,
    docsUrl: document.getElementById('content-docs-url')?.value || undefined,
  };
}

function getCssVars() {
  var vars = {};
  COLOUR_VARS.forEach(function(v) {
    var id = v.replace(/^--/, '');
    var el = document.getElementById(id);
    if (el) vars[v] = el.value;
  });
  return vars;
}

function getBlocksOrder() {
  // Nav-eligible order from Side Nav Panel DOM (cover is typically first)
  var navOrder = Array.from(document.querySelectorAll('#side-nav-items li[data-nav]'))
    .map(function(li) { return li.getAttribute('data-nav'); });
  var result = navOrder.slice();
  // Insert structural top elements (quick-nav, coverage-bar) right after cover, or at top if cover absent
  var coverIdx = result.indexOf('cover');
  var insertAt = coverIdx >= 0 ? coverIdx + 1 : 0;
  result.splice(insertAt, 0, 'quick-nav', 'coverage-bar');
  // Structural bottom elements always go last
  result.push('stakeholder-challenge');
  result.push('footer');
  return result;
}

function getDisabledBlocks() {
  var disabled = [];
  // Nav-eligible slots: disabled if unchecked in BOTH top nav AND side nav
  // Default to enabled when checkbox is absent (safety: never strip content by accident)
  document.querySelectorAll('#side-nav-items li[data-nav]').forEach(function(li) {
    var sid = li.getAttribute('data-nav');
    var topCb = document.getElementById('tnav-' + sid);
    var sideCb = document.getElementById('snav-' + sid);
    var inTop = topCb ? topCb.checked : true;
    var inSide = sideCb ? sideCb.checked : true;
    if (!inTop && !inSide) disabled.push(sid);
  });
  // Non-nav slots (Publication Elements): driven by their own checkbox
  document.querySelectorAll('#block-list li[data-blk]').forEach(function(li) {
    var sid = li.getAttribute('data-blk');
    var cb = document.getElementById('blk-' + sid);
    if (cb && !cb.checked) disabled.push(sid);
  });
  return disabled;
}

function getBlockParams() {
  var params = {};
  var filterEl = document.getElementById('filter-signal-list');
  if (filterEl && filterEl.value) params['signal-list'] = { filter: filterEl.value };
  var fwEl = document.getElementById('filter-fw-detail');
  if (fwEl && fwEl.value) params['compliance-framework-detail'] = { frameworkId: fwEl.value };
  return params;
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function applyPreset(name) {
  var preset = PRESETS[name];
  if (!preset) return;
  document.querySelectorAll('.preset-btn').forEach(function(b) { b.classList.remove('active'); });
  event.target.classList.add('active');
  Object.keys(preset).forEach(function(v) {
    var id = v.replace(/^--/, '');
    var el = document.getElementById(id);
    if (el) el.value = preset[v];
  });
  schedulePreview();
}

function setViewport(mode) {
  var frame = document.getElementById('preview-frame');
  document.getElementById('mode-desktop').classList.toggle('active', mode === 'desktop');
  document.getElementById('mode-mobile').classList.toggle('active', mode === 'mobile');
  if (mode === 'mobile') {
    frame.classList.add('mobile');
  } else {
    frame.classList.remove('mobile');
  }
}

function toggleDark() {
  darkMode = !darkMode;
  document.getElementById('mode-dark').classList.toggle('active', darkMode);
  schedulePreview();
}


function moveBlock(btn, dir) {
  var li = btn.closest('li');
  var list = li.parentNode;
  if (dir === -1 && li.previousElementSibling) {
    list.insertBefore(li, li.previousElementSibling);
  } else if (dir === 1 && li.nextElementSibling) {
    list.insertBefore(li.nextElementSibling, li);
  }
  schedulePreview();
}

async function updatePreview() {
  var appId = document.getElementById('app-id').value || 'sovereign-health';
  setStatus('Loading...');
  try {
    var r = await fetch('/preview', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        appId: appId,
        cssVars: getCssVars(),
        blocksDisabled: getDisabledBlocks(),
        blocksOrder: getBlocksOrder(),
        topNav: getTopNav(),
        sideNav: getSideNav(),
        blockParams: getBlockParams(),
        contentOverrides: getContentOverrides(),
        theme: darkMode ? 'dark' : 'light'
      })
    });
    if (r.ok) {
      var html = await r.text();
      document.getElementById('preview-frame').srcdoc = html;
      setStatus('Preview updated.');
    } else {
      var err = await r.json();
      setStatus('Error: ' + (err.error || r.status));
    }
  } catch (e) {
    setStatus('Network error: ' + e.message);
  }
}

function schedulePreview() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(updatePreview, 500);
}

function loadPreview() { updatePreview(); }

async function exportLevel1() {
  setStatus('Exporting...');
  var r = await fetch('/export/level1', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      profile: window._swaoProfile || 'application',
      cssVars: getCssVars(),
      blocksDisabled: getDisabledBlocks(),
      blocksOrder: getBlocksOrder(),
      blockParams: getBlockParams(),
      contentOverrides: getContentOverrides(),
      topNavConfig: getTopNav(),
      sideNavConfig: getSideNav()
    })
  });
  var data = await r.json();
  setStatus(r.ok ? 'Exported to: ' + data.path : 'Export failed: ' + data.error);
}

// Persist Content tab fields to .swao.yml via POST /settings/content (D3 -- #0932).
// Translates camelCase UI field names to the snake_case keys expected by the server.
async function saveContentSettings() {
  var overrides = getContentOverrides();
  var body = {
    classification_band: overrides.classificationBand,
    logo_name: overrides.logoName,
    logo_sub: overrides.logoSub,
    github_url: overrides.githubUrl || '',
    docs_url: overrides.docsUrl || '',
  };
  setStatus('Saving content settings...');
  try {
    var r = await fetch('/settings/content', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    var data = await r.json();
    if (r.ok) {
      setStatus('Content settings saved.');
      schedulePreview();
    } else {
      setStatus('Save failed: ' + (data.error || r.status));
    }
  } catch (e) {
    setStatus('Save failed: ' + e.message);
  }
}

// D4 Phase 2: persist branding tokens to ci.yaml via POST /settings/branding
async function saveBranding() {
  var cssVars = getCssVars();
  setStatus('Saving branding...');
  try {
    var r = await fetch('/settings/branding', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ cssVars: cssVars })
    });
    var data = await r.json();
    if (r.ok) {
      setStatus('Branding saved.');
    } else {
      setStatus('Save failed: ' + (data.error || r.status));
    }
  } catch (e) {
    setStatus('Save failed: ' + e.message);
  }
}

// D4 Phase 2: persist Publication Elements (structural/meta) visibility and chrome toggles
async function saveProfile() {
  var profile = window._swaoProfile || 'application';
  var blocks = Array.from(document.querySelectorAll('#block-list li[data-blk]')).map(function(li, idx) {
    var id = li.getAttribute('data-blk');
    var cb = document.getElementById('blk-' + id);
    return { id: id, enabled: cb ? cb.checked : true, order: idx + 1 };
  });
  var options = getBlockParams();
  // Persist the chrome toggles that now live in the Publication Elements section.
  // Deep-merged server-side so nav.top.items saved by saveTopNavLayout() are preserved.
  var chk = function(id) { var el = document.getElementById(id); return el ? el.checked : true; };
  var chromeNav = { top: { search: chk('nav-search'), langSwitcher: chk('nav-lang'), themeToggle: chk('nav-theme') } };
  setStatus('Saving profile...');
  try {
    var r = await fetch('/settings/profile', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ profile: profile, blocks: blocks, options: options, nav: chromeNav })
    });
    var data = await r.json();
    if (r.ok) {
      setStatus('Profile saved.');
    } else {
      setStatus('Save failed: ' + (data.error || r.status));
    }
  } catch (e) {
    setStatus('Save failed: ' + e.message);
  }
}

async function saveTopNavLayout() {
  var profile = window._swaoProfile || 'application';
  setStatus('Saving top nav...');
  try {
    var r = await fetch('/settings/profile', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ profile: profile, nav: { top: getTopNav() } })
    });
    var data = await r.json();
    setStatus(r.ok ? 'Top nav saved.' : 'Save failed: ' + (data.error || r.status));
  } catch (e) { setStatus('Save failed: ' + e.message); }
}

async function saveSideNavLayout() {
  var profile = window._swaoProfile || 'application';
  setStatus('Saving side nav...');
  try {
    var r = await fetch('/settings/profile', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ profile: profile, nav: { side: getSideNav() } })
    });
    var data = await r.json();
    setStatus(r.ok ? 'Side nav saved.' : 'Save failed: ' + (data.error || r.status));
  } catch (e) { setStatus('Save failed: ' + e.message); }
}

// Make sidebar h2 sections collapsible
(function() {
  var headings = document.querySelectorAll('#sidebar h2');
  headings.forEach(function(h2) {
    h2.style.cursor = 'pointer';
    h2.style.userSelect = 'none';
    // Collect following siblings until next h2 or end
    var sibs = [];
    var el = h2.nextElementSibling;
    while (el && el.tagName !== 'H2') { sibs.push(el); el = el.nextElementSibling; }
    if (!sibs.length) return;
    // Add indicator
    h2.setAttribute('data-collapsed', 'false');
    var makeLabel = function(collapsed) {
      return (collapsed ? '▶ ' : '▼ ') + h2.textContent.replace(/^[▶▼] */, '');
    };
    h2.textContent = makeLabel(false);
    h2.addEventListener('click', function() {
      var collapsed = h2.getAttribute('data-collapsed') === 'true';
      sibs.forEach(function(s) { s.style.display = collapsed ? '' : 'none'; });
      h2.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
      h2.textContent = makeLabel(!collapsed);
    });
  });
})();

// Auto-update on colour, block, or content change
document.addEventListener('input', function(e) {
  if (e.target.id === 'assessment-type-selector') return; // handled by onchange -> switchAssessmentType
  if (e.target.type === 'color' || e.target.tagName === 'SELECT' || e.target.type === 'text') schedulePreview();
});
document.addEventListener('change', function(e) {
  if (e.target.type === 'checkbox' && (e.target.closest('#block-list') || e.target.closest('#side-nav-items') || e.target.closest('#top-nav-items'))) schedulePreview();
});

// Slot label map: slot id -> human readable label (application + lz-catalog profiles)
var SLOT_LABELS = {
  'cover': 'Overview', 'quick-nav': 'Quick Navigation', 'coverage-bar': 'Coverage Bar',
  'exec-summary': 'Executive Summary', 'seven-r-card': 'Migration Strategy',
  'signal-list': 'Signals', 'compliance-regime': 'Compliance Frameworks',
  'compliance-framework-detail': 'Framework Detail', 'compliance-matrix': 'Compliance Matrix',
  'compliance-requirements': 'Compliance Requirements', 'controls': 'Controls',
  'risk-register': 'Risk Register', 'evidence-gallery': 'Evidence Gallery',
  'lzr-summary': 'Landing Zone Readiness', 'delta-view': 'Assessment Delta',
  'run-history': 'Assessment History', 'assessment-scope': 'Assessment Scope',
  'runbook': 'Remediation Runbook', 'glossary': 'Glossary',
  'methodology': 'Methodology', 'stakeholder-challenge': 'Stakeholder Challenge', 'footer': 'Footer',
  'lzr-catalog-header': 'LZ Catalog Header', 'lzr-catalog-verdict': 'LZ Verdicts',
  'lz-catalog-services': 'Services Catalog', 'lzr-catalog-findings': 'LZ Findings',
  'lzr-catalog-remediation': 'LZ Remediation', 'lzr-catalog-finops': 'Service Intelligence',
};
function slotLabel(id) { return SLOT_LABELS[id] || id; }

function buildSideNavItems(slots, allowed, savedSide) {
  var list = document.getElementById('side-nav-items');
  if (!list) return;
  var activeSlots = allowed ? slots.filter(function(s) { return allowed.includes(s); }) : slots;
  // Exclude structural/meta slots -- they live in Publication Elements, not the nav panels
  var navSlots = activeSlots.filter(function(s) { return !NON_NAV_SLOTS[s]; });
  list.innerHTML = navSlots.map(function(sid) {
    var extra = '';
    if (sid === 'signal-list') {
      extra = ' <select class="blk-filter" id="filter-signal-list" title="Severity filter" onchange="schedulePreview()">' +
        '<option value="">All</option><option value="critical">Critical</option>' +
        '<option value="high">High</option><option value="critical,high">Crit+High</option>' +
        '<option value="medium">Medium</option></select>';
    } else if (sid === 'compliance-framework-detail') {
      extra = ' <input type="text" class="blk-filter" id="filter-fw-detail" placeholder="Framework ID (e.g. GDPR)"' +
        ' title="Filter to one framework" style="width:8rem;font-size:0.72rem;background:#0f172a;color:#e2e8f0;border:1px solid rgba(255,255,255,0.2);border-radius:3px;padding:2px 4px;">';
    }
    return '<li data-nav="' + sid + '"><input type="checkbox" id="snav-' + sid + '" checked onchange="schedulePreview()">' +
      '<span class="blk-label">' + slotLabel(sid) + '</span>' + extra +
      '<button class="blk-move" onclick="moveSideNavItem(this,-1)">&#9650;</button>' +
      '<button class="blk-move" onclick="moveSideNavItem(this,1)">&#9660;</button></li>';
  }).join('');
  if (savedSide && savedSide.items && Array.isArray(savedSide.items)) {
    var sorted = savedSide.items.slice().sort(function(a, b) { return a.order - b.order; });
    sorted.forEach(function(item) {
      var li = list.querySelector('li[data-nav="' + item.id + '"]');
      if (li) list.appendChild(li);
    });
    savedSide.items.forEach(function(item) {
      var cb = document.getElementById('snav-' + item.id);
      if (cb) cb.checked = item.enabled !== false;
    });
  }
}

function buildBlockList(slots, allowed, savedBlocks) {
  var blockListEl = document.getElementById('block-list');
  if (!blockListEl) return;
  var activeSlots = allowed ? slots.filter(function(s) { return allowed.includes(s); }) : slots;
  // Only show structural/meta slots -- assessment content is managed by the nav panels
  var metaSlots = activeSlots.filter(function(s) { return NON_NAV_SLOTS[s]; });
  blockListEl.innerHTML = metaSlots.map(function(sid) {
    return '<li data-blk="' + sid + '"><input type="checkbox" id="blk-' + sid + '" checked onchange="schedulePreview()">' +
      '<span class="blk-label">' + slotLabel(sid) + '</span></li>';
  }).join('');
  // Restore enabled state from saved profile (no reordering -- positions are fixed)
  if (savedBlocks && Array.isArray(savedBlocks) && savedBlocks.length > 0) {
    savedBlocks.forEach(function(blk) {
      var cb = document.getElementById('blk-' + blk.id);
      if (cb) cb.checked = blk.enabled !== false;
    });
  }
}

// #1123: switch assessment type -- re-fetches /context?profile=<id> and rebuilds all lists
async function switchAssessmentType(profileId) {
  try {
    var r = await fetch('/context?profile=' + encodeURIComponent(profileId));
    if (!r.ok) return;
    var ctx = await r.json();
    window._swaoProfile = ctx.block_profile || profileId;
    var slots = (ctx.template_slots && ctx.template_slots.length > 0)
      ? ctx.template_slots : (ctx.allowed_blocks || []);
    var allowed = ctx.allowed_blocks || null;
    buildTopNavItems(slots, allowed, null);
    buildSideNavItems(slots, allowed, null);
    buildBlockList(slots, allowed, null);
    var lbl = document.getElementById('active-profile-label');
    if (lbl) lbl.textContent = 'Profile: ' + window._swaoProfile;
    schedulePreview();
  } catch (e) {
    setStatus('Switch failed: ' + String(e));
  }
}

// Block profile filter + branding + block state restore (D4 Phase 2)
(function() {
  fetch('/context')
    .then(function(r) { if (!r.ok) throw new Error('context'); return r.json(); })
    .then(function(ctx) {
    // Store profile name for saveProfile()
    window._swaoProfile = ctx.block_profile || 'application';
    // Sync assessment type selector to loaded profile
    var selEl = document.getElementById('assessment-type-selector');
    if (selEl) selEl.value = window._swaoProfile;

    // #1033: derive slots from template (authoritative list)
    var slots = (ctx.template_slots && Array.isArray(ctx.template_slots) && ctx.template_slots.length > 0)
      ? ctx.template_slots
      : (ctx.allowed_blocks || []);
    // Fallback: if server returned no slots (empty or error JSON), use hardcoded list
    if (slots.length === 0) {
      slots = ['cover','quick-nav','coverage-bar','exec-summary','seven-r-card','signal-list',
        'compliance-regime','compliance-framework-detail','compliance-matrix','compliance-requirements',
        'controls','risk-register','evidence-gallery','lzr-summary','delta-view','run-history',
        'assessment-scope','runbook','glossary','methodology','stakeholder-challenge','footer'];
    }
    var allowed = ctx.allowed_blocks || null;

    // 1. Build Top Navigation, Side Navigation and Block Manager dynamically
    buildTopNavItems(slots, allowed, ctx.nav && ctx.nav.top);
    buildSideNavItems(slots, allowed, ctx.nav && ctx.nav.side);
    buildBlockList(slots, allowed, ctx.blocks);

    // Update static profile label (id="active-profile-label" in HTML)
    var lbl2 = document.getElementById('active-profile-label');
    if (lbl2) lbl2.textContent = 'Profile: ' + window._swaoProfile;

    // 2. Populate branding colour pickers from saved ci.yaml
    if (ctx.branding && typeof ctx.branding === 'object') {
      Object.keys(ctx.branding).forEach(function(k) {
        var id = k.replace(/^--/, '');
        var el = document.getElementById(id);
        if (el && el.type === 'color') el.value = ctx.branding[k];
      });
    }

    // 4. Restore block options from saved profile YAML
    if (ctx.options && typeof ctx.options === 'object') {
      var sigEl = document.getElementById('filter-signal-list');
      if (sigEl && ctx.options['signal-list'] && ctx.options['signal-list'].filter) {
        sigEl.value = ctx.options['signal-list'].filter;
      }
      var fwEl = document.getElementById('filter-fw-detail');
      if (fwEl && ctx.options['compliance-framework-detail'] && ctx.options['compliance-framework-detail'].frameworkId) {
        fwEl.value = ctx.options['compliance-framework-detail'].frameworkId;
      }
    }

    // 5. Restore top-nav and side-nav feature toggles from saved profile YAML
    // (item order/visibility is already restored by buildTopNavItems / buildSideNavItems)
    if (ctx.nav && typeof ctx.nav === 'object') {
      var setChk = function(id, val) { var el = document.getElementById(id); if (el) el.checked = val !== false; };
      var top = ctx.nav.top;
      if (top && typeof top === 'object') {
        setChk('nav-topbar', top.topBarVisible);
        setChk('nav-search', top.search);
        setChk('nav-lang', top.langSwitcher);
        setChk('nav-theme', top.themeToggle);
      }
      var side = ctx.nav.side;
      if (side && typeof side === 'object') {
        setChk('nav-sidebar', side.sidebarVisible);
      }
    }
  }).catch(function() { /* editor works without /context -- use fallback defaults */
    var fbSlots = ['cover','quick-nav','coverage-bar','exec-summary','seven-r-card','signal-list','compliance-regime','compliance-framework-detail','compliance-matrix','compliance-requirements','controls','risk-register','evidence-gallery','lzr-summary','delta-view','run-history','assessment-scope','runbook','glossary','methodology','footer'];
    buildTopNavItems(fbSlots, null, null);
    buildSideNavItems(fbSlots, null, null);
    buildBlockList(fbSlots, null, null);
  });
})();
</script>
</body></html>`;
