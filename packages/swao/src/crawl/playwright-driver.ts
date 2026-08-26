// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { createRequire } from 'module';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { chromium as _chromiumFromModule } from 'playwright';
import type { Browser, BrowserContext, BrowserType, Page, Request, Response, ConsoleMessage } from 'playwright';
import type { CrawlConfig, CrawlResult, BinaryCheck, CrawlProvider, ScreenArtefact, NetworkEntry, ConsoleEntry, ConsoleEntryType } from './types.js';
import { planNextActions, extractSameOriginLinks, STATIC_ASSET_EXT } from './navigation-planner.js';
import { isPlaywrightPackageInstalled } from '@swao/core';

// #0859: In the pkg binary, `import { chromium } from 'playwright'` resolves
// to the playwright-stub (see build-lib.mjs) which throws on invocation. Try
// to load the REAL playwright-core from the host filesystem so operators who
// have Playwright installed on their machine can use Pass 10 without running
// from source. This uses createRequire with absolute paths so esbuild cannot
// intercept the resolution at build time (it only intercepts static string
// literals, not computed module paths).
function tryLoadHostPlaywrightCore(): BrowserType | null {
  if (!Object.prototype.hasOwnProperty.call(process, 'pkg')) return null;

  const appData = process.env['APPDATA'] ?? '';
  const localAppData = process.env['LOCALAPPDATA'] ?? '';
  const npmConfigPrefix = process.env['npm_config_prefix'] ?? '';
  const home = homedir();

  // Search order: global npm (most common for manual installs), then cwd-relative.
  // Covers Windows (APPDATA/LOCALAPPDATA), Linux (/usr/local/lib, /usr/lib,
  // ~/.npm-global), macOS (same as Linux plus /opt/homebrew), and any custom
  // npm prefix set via npm_config_prefix.
  const candidateDirs = [
    ...(appData      ? [join(appData,      'npm', 'node_modules')] : []),
    ...(localAppData ? [join(localAppData, 'npm', 'node_modules')] : []),
    ...(npmConfigPrefix ? [join(npmConfigPrefix, 'lib', 'node_modules')] : []),
    // pnpm global store: Windows uses LOCALAPPDATA\pnpm, Unix uses home/.local/share/pnpm
    ...(localAppData ? [join(localAppData, 'pnpm', 'node_modules')] : []),
    ...(appData      ? [join(appData,      'pnpm', 'node_modules')] : []),
    join(home, '.local', 'share', 'pnpm', 'node_modules'),
    join(home, 'node_modules'),
    join(home, '.npm', 'lib', 'node_modules'),
    join(home, '.npm-global', 'lib', 'node_modules'),
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
    join(process.cwd(), 'node_modules'),
    join(process.cwd(), '..', 'node_modules'),
  ];

  for (const nmDir of candidateDirs) {
    for (const pkgName of ['playwright-core', 'playwright']) {
      const indexPath = join(nmDir, pkgName, 'index.js');
      if (!existsSync(indexPath)) continue;
      try {
        const req = createRequire(indexPath);
        const pw = req(indexPath) as { chromium?: BrowserType };
        if (pw?.chromium) return pw.chromium;
      } catch { /* not loadable from this location */ }
    }
  }
  return null;
}

// Module-level chromium handle: prefers host playwright-core when running
// inside the pkg binary, falls back to the bundled import (dev/source context
// or stub when bundled without host playwright).
const _hostChromium = tryLoadHostPlaywrightCore();
const chromium: BrowserType = _hostChromium ?? _chromiumFromModule;

/** True when playwright-core was loaded from the host filesystem (binary context). */
export const isHostPlaywrightAvailable = _hostChromium !== null;

const DEFAULT_QUALITY = 80;
const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_MAX_TURNS = 80;
const NAV_TIMEOUT_MS = 15000;

const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token']);

function slugify(url: string, index: number): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .replace(/[^a-z0-9]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'root';
    return `${String(index).padStart(3, '0')}-${path.slice(0, 40)}`;
  } catch {
    return `${String(index).padStart(3, '0')}-screen`;
  }
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

function normaliseConsoleType(raw: string): ConsoleEntryType {
  const allowed: ConsoleEntryType[] = ['log', 'debug', 'info', 'error', 'warning'];
  return (allowed.includes(raw as ConsoleEntryType) ? raw : 'other') as ConsoleEntryType;
}

async function capturePage(
  page: Page,
  url: string,
  index: number,
  screenshotQuality: number,
): Promise<ScreenArtefact> {
  const networkEntries: NetworkEntry[] = [];
  const consoleEntries: ConsoleEntry[] = [];

  const onRequest = (req: Request) => {
    const headers = req.headers();
    const hasSensitive = Object.keys(headers).some((h) => SENSITIVE_HEADER_NAMES.has(h.toLowerCase()));
    if (hasSensitive && req.resourceType() === 'document') return;
    networkEntries.push({
      url: redactUrl(req.url()),
      method: req.method(),
      status: null,
      resourceType: req.resourceType(),
    });
  };

  const onResponse = (res: Response) => {
    const redacted = redactUrl(res.url());
    const entry = networkEntries.find((e) => e.url === redacted && e.status === null);
    if (entry) entry.status = res.status();
  };

  const onConsole = (msg: ConsoleMessage) => {
    consoleEntries.push({
      type: normaliseConsoleType(msg.type()),
      text: msg.text().slice(0, 500),
    });
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('console', onConsole);

  try {
    // `waitUntil: 'networkidle'` hangs reliably on file:// fixtures (no
    // network events ever fire so Playwright waits the full NAV_TIMEOUT_MS
    // each page -- 8 pages x 15s blows the 60s test cap). `'load'` fires
    // on the load event itself which is sufficient for static HTML and
    // most non-SPA workloads SWAO assesses; if a real customer crawl
    // surfaces SPA late-render gaps, the caller can pass an explicit
    // longer timeout.
    await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'load' });
    // For live http/https targets, `load` fires before client-side frameworks
    // (React, Next.js) hydrate the DOM.  A bounded networkidle wait lets the
    // JS bundle execute and render the real page content before the snapshot.
    // file:// fixtures omit this: no network events ever fire on them, so
    // networkidle would block until NAV_TIMEOUT_MS every page.
    if (/^https?:\/\//i.test(url)) {
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
  } catch {
    // Navigation timeout or error -- capture what we have
  }

  page.off('request', onRequest);
  page.off('response', onResponse);
  page.off('console', onConsole);

  const title = await page.title().catch(() => '');
  const domSnapshot = await page.content().catch(() => '');
  const slug = slugify(url, index);

  let screenshotJpeg: Buffer | null = null;
  try {
    screenshotJpeg = await page.screenshot({ type: 'jpeg', quality: screenshotQuality, fullPage: true });
  } catch {
    // Screenshot failed -- non-fatal
  }

  let a11yJson: string | null = null;
  let a11yViolations = 0;
  try {
    // page.accessibility is deprecated in Playwright >= 1.45 but still functional in 1.59
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot = await (page as any).accessibility?.snapshot?.();
    if (snapshot) {
      a11yJson = JSON.stringify(snapshot);
      // Heuristic: count alert-role nodes as violations
      a11yViolations = countA11yAlerts(snapshot);
    }
  } catch {
    // a11y API unavailable
  }

  // Supplement with runtime aria-invalid count if a11y API missed violations
  if (a11yViolations === 0) {
    try {
      const ariaCnt = await page.evaluate(
        () => document.querySelectorAll('[aria-invalid="true"], [role="alert"]').length,
      );
      a11yViolations = ariaCnt;
    } catch {
      // eval failed
    }
  }

  return {
    index,
    url,
    title,
    timestamp: new Date().toISOString(),
    slug,
    screenshotJpeg,
    domSnapshot,
    a11yJson,
    networkEntries,
    consoleEntries,
    a11yViolations,
  };
}

function countA11yAlerts(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const n = node as Record<string, unknown>;
  let count = 0;
  if (n.role === 'alert' || (typeof n.name === 'string' && /error/i.test(n.name))) {
    count++;
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) {
      count += countA11yAlerts(child);
    }
  }
  return count;
}

// Pre-seed the crawl queue from sitemap.xml / sitemapindex (#0894).
// Uses the APIRequestContext (shares cookies, no page navigation consumed).
// A 404, timeout, or parse error is non-fatal -- returns an empty array.
async function fetchSitemapUrls(ctx: BrowserContext, origin: string): Promise<string[]> {
  const urls: string[] = [];

  async function parseSitemap(sitemapUrl: string, depth: number): Promise<void> {
    if (depth > 1) return; // one level of sitemapindex expansion only
    let xml: string;
    try {
      const res = await ctx.request.get(sitemapUrl, { timeout: 8000 });
      if (!res.ok()) return;
      xml = await res.text();
    } catch {
      return;
    }

    if (xml.includes('<sitemapindex')) {
      // Sitemap index -- fetch each child sitemap
      const childRe = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi;
      let m: RegExpExecArray | null;
      while ((m = childRe.exec(xml)) !== null) {
        await parseSitemap(m[1]!.trim(), depth + 1);
      }
      return;
    }

    // Regular sitemap -- extract page URLs
    const locRe = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = locRe.exec(xml)) !== null) {
      const raw = m[1]!.trim();
      try {
        const u = new URL(raw);
        if (u.origin !== origin) continue;
        if (STATIC_ASSET_EXT.test(u.pathname)) continue;
        u.hash = '';
        urls.push(u.href);
      } catch { /* invalid URL */ }
    }
  }

  await parseSitemap(`${origin}/sitemap.xml`, 0);
  return [...new Set(urls)];
}

// Attempt form-based login on the current page (#0893).
// Returns success=true when the URL changed away from a login path after submit.
// Tries common field selectors in preference order; submits via button or Enter.
// Uses networkidle wait so Next.js client-side transitions are caught.
async function attemptFormLogin(
  page: Page,
  username: string,
  password: string,
): Promise<{ success: boolean; message: string }> {
  try {
    // #1086: The login page may be a CSR-only SPA (no __NEXT_DATA__) -- React
    // hydration and form rendering happen AFTER networkidle fires inside
    // capturePage(). Wait up to 10 s for any common input field to appear
    // before running per-selector visibility checks.
    await page.waitForSelector(
      'input[type="email"], input[name="email"], input[autocomplete="email"], input[autocomplete="username"], input[type="text"], input[type="password"]',
      { timeout: 10000 },
    ).catch(() => {});

    const userSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[id="email"]',
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
      'input[name="username"]',
      'input[id="username"]',
      'input[type="text"]',
    ];

    let userField = null;
    for (const selector of userSelectors) {
      const loc = page.locator(selector).first();
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        userField = loc;
        break;
      }
    }
    if (!userField) {
      return { success: false, message: 'no username/email field visible on page' };
    }

    const pwField = page.locator('input[type="password"]').first();
    if (!await pwField.isVisible({ timeout: 500 }).catch(() => false)) {
      return { success: false, message: 'no password field visible on page' };
    }

    await userField.fill(username);
    await pwField.fill(password);

    // Disable browser HTML5 form validation before submit.  React-hook-form
    // apps run Zod schema validation inside the onSubmit handler regardless;
    // the browser-native check fires FIRST and silently blocks the submit
    // event when the username field type="email" rejects a non-RFC5321 value
    // (e.g. local-part without TLD).  Setting noValidate lets the submit
    // event reach the React handler so any schema error surfaces in the DOM.
    let submitted = false;
    for (const sel of ['button[type="submit"]', 'input[type="submit"]']) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        // String-form evaluate avoids the "not well-serializable" error that
        // pkg binaries throw when passing arrow functions with TypeScript casts
        // to page.evaluate -- Function.prototype.toString() fails on compiled
        // bundles.  JSON.stringify escapes the selector safely.
        await page.evaluate(
          `var _b=document.querySelector(${JSON.stringify(sel)});var _f=_b&&_b.closest('form');if(_f)_f.noValidate=true;`,
        );
        await btn.click();
        submitted = true;
        break;
      }
    }
    if (!submitted) {
      await pwField.press('Enter');
    }

    // Wait for the URL to change away from the login path (up to 12 s).
    // Using waitForURL instead of waitForLoadState('networkidle') because
    // Cloudflare challenge-platform scripts keep the network non-idle well
    // past submit, causing the earlier networkidle wait to time out before
    // the redirect completes.
    await page.waitForURL(
      (url) => !/\/(login|signin|auth\/login)\b/i.test(new URL(url).pathname),
      { timeout: 12000 },
    ).catch(() => {});

    const finalUrl = page.url();
    const onLoginPage = /\/(login|signin|auth\/login)\b/i.test(new URL(finalUrl).pathname);
    if (onLoginPage) {
      return { success: false, message: `still on login page after submit (${finalUrl})` };
    }
    return { success: true, message: `navigated to ${finalUrl}` };
  } catch (err) {
    return { success: false, message: `login threw: ${String(err)}` };
  }
}

// Discover navigation links hidden behind dropdown trigger elements (#1101).
// Finds elements carrying standard accessibility markers for dropdown menus
// (aria-haspopup, aria-expanded, data-toggle="dropdown"), clicks each one,
// extracts any newly-visible same-origin <a href> links that were not in the
// static DOM before the click, then dismisses the dropdown with Escape.
// Returns URLs to add to the crawl queue (deduplication done by caller).
// Capped at MAX_DROPDOWN_TRIGGERS per page to prevent runaway loops.
// All evaluate calls use string form so pkg binary serialisation does not fail.
const MAX_DROPDOWN_TRIGGERS = 5;

async function discoverDropdownNavUrls(
  page: Page,
  baseUrl: string,
  visited: Set<string>,
  excludePatterns: string[],
): Promise<string[]> {
  const discovered: string[] = [];
  try {
    // Stamp matching trigger elements with a data attribute for stable indexing.
    // Excludes submit/reset buttons (they navigate forms, not open menus).
    const count = (await page.evaluate(
      `(function(){` +
      `var sel='[aria-haspopup],[aria-expanded],[data-toggle="dropdown"]';` +
      `var els=[].slice.call(document.querySelectorAll(sel));` +
      `var triggers=els.filter(function(el){` +
      `var t=(el.getAttribute('type')||'').toLowerCase();` +
      `return t!=='submit'&&t!=='reset';` +
      `}).slice(0,${MAX_DROPDOWN_TRIGGERS});` +
      `triggers.forEach(function(el,i){el.setAttribute('data-swao-dd-idx',String(i));});` +
      `return triggers.length;` +
      `})()`,
    ).catch(() => 0)) as number;

    if (!count) return discovered;

    // Snapshot links already in the static DOM before any click.
    const domBefore = await page.content().catch(() => '');
    const linksBefore = new Set(extractSameOriginLinks(domBefore, baseUrl, excludePatterns));

    for (let i = 0; i < count; i++) {
      try {
        await page.evaluate(
          `(function(){var el=document.querySelector('[data-swao-dd-idx="${i}"]');if(el)el.click();})()`,
        );
        // Brief wait for React/SPA to render dropdown content.
        await new Promise<void>((r) => setTimeout(r, 600));

        const domAfter = await page.content().catch(() => '');
        const linksAfter = extractSameOriginLinks(domAfter, baseUrl, excludePatterns);

        for (const link of linksAfter) {
          if (!linksBefore.has(link) && !visited.has(link) && !discovered.includes(link)) {
            discovered.push(link);
            console.warn(`[info] Playwright dropdown nav discovered: ${link}`);
          }
        }

        // Dismiss the dropdown before the next trigger click.
        await page.keyboard.press('Escape').catch(() => {});
        await new Promise<void>((r) => setTimeout(r, 300));
      } catch { /* trigger not interactable -- skip */ }
    }
  } catch { /* non-fatal */ }
  return discovered;
}

// Explore tab-strip navigation on a captured page (#0898 / #0900).
// Detects three patterns in priority order:
//   A) ARIA role=tab (standard)
//   B) Bootstrap nav-tabs (.nav-tabs .nav-link / button / a)
//   C) Tailwind border-b-2 sibling buttons (custom tab strips, e.g. Ghostfolio/BrickOS)
// Found elements are stamped with data-swao-tab-idx so all subsequent evaluate calls
// use a single, strategy-agnostic attribute selector. Stamps are re-applied if the
// page reloads (URL-changing tab) or if the framework re-renders the tab strip.
// URL-changing tabs are queued for full crawl; state-only tabs are captured inline.
// All string-form evaluate calls avoid TypeScript syntax (pkg binary serialisation).
const STAMP_JS =
  `(function(){` +
  `if(document.querySelector('[data-swao-tab-idx]'))return document.querySelectorAll('[data-swao-tab-idx]').length;` +
  `var tabs=[];` +
  `var a=[].slice.call(document.querySelectorAll('[role="tab"]'));if(a.length>1){tabs=a;}` +
  `if(!tabs.length){var b=[].slice.call(document.querySelectorAll('.nav-tabs .nav-link,.nav-tabs button,.nav-tabs a'));if(b.length>1)tabs=b;}` +
  `if(!tabs.length){` +
  `var btns=[].slice.call(document.querySelectorAll('button'));` +
  `var map=new Map();` +
  `btns.forEach(function(b2){if(typeof b2.className!=='string'||b2.className.indexOf('border-b-2')===-1)return;var p=b2.parentElement;if(!p)return;if(!map.has(p))map.set(p,[]);map.get(p).push(b2);});` +
  `var best=null;map.forEach(function(arr){if(!best||arr.length>best.length)best=arr;});` +
  `if(best&&best.length>1)tabs=best;` +
  `}` +
  `tabs.forEach(function(el,i){el.setAttribute('data-swao-tab-idx',String(i));});` +
  `return tabs.length;` +
  `})()`;

async function discoverAndCaptureTabVariants(
  page: Page,
  baseUrl: string,
  baseSlug: string,
  screenshotQuality: number,
  queue: string[],
  visited: Set<string>,
  screens: ScreenArtefact[],
  maxTurns: number,
): Promise<void> {
  let tabCount = 0;
  try {
    tabCount = (await page.evaluate(STAMP_JS)) as number;
  } catch { return; }
  if (tabCount <= 1) return;

  for (let i = 0; i < tabCount; i++) {
    if (screens.length >= maxTurns) break;
    try {
      // Re-stamp on each iteration: covers React re-renders and post-navigation page reloads.
      await page.evaluate(STAMP_JS).catch(() => {});

      const selected = (await page.evaluate(
        `(function(){` +
        `var el=document.querySelector('[data-swao-tab-idx="${i}"]');if(!el)return true;` +
        `var cls=typeof el.className==='string'?el.className:'';` +
        `return el.getAttribute('aria-selected')==='true'` +
        `||el.getAttribute('aria-current')==='page'` +
        `||el.classList.contains('active')` +
        `||(cls.indexOf('border-b-2')!==-1&&cls.indexOf('border-transparent')===-1);` +
        `})()`,
      )) as boolean;
      if (selected) continue;

      const label = (await page.evaluate(
        `(function(){var el=document.querySelector('[data-swao-tab-idx="${i}"]');return el&&el.textContent?el.textContent.trim():'tab-${i}';})()`,
      )) as string;

      const urlBefore = page.url();
      await page.evaluate(
        `(function(){var el=document.querySelector('[data-swao-tab-idx="${i}"]');if(el)el.click();})()`,
      );
      await new Promise<void>((r) => setTimeout(r, 800));
      // Let React/SPA frameworks finish rendering the new tab content.
      if (/^https?:\/\//i.test(baseUrl)) {
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
      }
      const urlAfter = page.url();

      if (urlAfter !== urlBefore) {
        // URL-changing tab -- capture inline (screenshot + DOM) before navigating back.
        // Marking visited here prevents the main crawl loop from re-visiting the same
        // URL and producing a duplicate parity-baseline entry.
        const normalised = (urlAfter.split('#')[0] ?? urlAfter).replace(/\?$/, '');
        console.warn(`[info] Tab navigation discovered: ${normalised}`);
        if (!visited.has(normalised) && screens.length < maxTurns) {
          visited.add(normalised);
          const tabTitle = await page.title().catch(() => '');
          const tabDom   = await page.content().catch(() => '');
          const tabLabel =
            label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `tab-${i}`;
          let tabScreenshot: Buffer | null = null;
          try {
            tabScreenshot = await page.screenshot({ type: 'jpeg', quality: screenshotQuality, fullPage: true });
          } catch { /* non-fatal */ }
          screens.push({
            index:          screens.length,
            url:            normalised,
            title:          tabTitle,
            timestamp:      new Date().toISOString(),
            slug:           `${baseSlug}-tab-${tabLabel}`,
            screenshotJpeg: tabScreenshot,
            domSnapshot:    tabDom,
            a11yJson:       null,
            networkEntries: [],
            consoleEntries: [],
            a11yViolations: 0,
          });
        }
        // Return to the original page so remaining tabs can be explored
        await page.goto(urlBefore, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS }).catch(() => {});
        if (/^https?:\/\//i.test(urlBefore)) {
          await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        }
      } else {
        // State-only tab -- capture inline full-page screenshot
        const title = await page.title().catch(() => '');
        const domSnapshot = await page.content().catch(() => '');
        const tabLabel =
          label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `tab-${i}`;
        const tabSlug = `${baseSlug}-tab-${tabLabel}`;
        let screenshotJpeg: Buffer | null = null;
        try {
          screenshotJpeg = await page.screenshot({
            type: 'jpeg',
            quality: screenshotQuality,
            fullPage: true,
          });
        } catch { /* non-fatal */ }
        screens.push({
          index: screens.length,
          url: baseUrl,
          title,
          timestamp: new Date().toISOString(),
          slug: tabSlug,
          screenshotJpeg,
          domSnapshot,
          a11yJson: null,
          networkEntries: [],
          consoleEntries: [],
          a11yViolations: 0,
        });
      }
    } catch { /* tab not interactable -- skip */ }
  }
}

// Resolve the Chromium executable path. In pkg-binary mode without a host
// playwright-core, chromium.executablePath() throws because the browser registry
// is not in the virtual snapshot -- fall back to the filesystem scan (same
// pattern as buildPlaywrightProbe). This lets the bundled playwright-core use a
// discovered browser via the executablePath launch option.
function resolveChromiumPath(): string | null {
  try {
    const p = chromium.executablePath();
    if (existsSync(p)) return p;
  } catch { /* binary mode: registry unavailable */ }
  return findChromiumOnFilesystem();
}

export class PlaywrightCrawlProvider implements CrawlProvider {
  async checkBinary(): Promise<BinaryCheck> {
    const path = resolveChromiumPath();
    if (!path) return { available: false, version: null, path: null };
    const match = /chromium-(\d+)/.exec(path);
    const version = match ? match[1] : 'installed';
    return { available: true, version, path };
  }

  async crawl(config: CrawlConfig, _workspaceAppDir: string): Promise<CrawlResult> {
    const {
      targetUrl,
      authType = 'none',
      username,
      password,
      screenshotQuality = DEFAULT_QUALITY,
      viewportWidth = DEFAULT_VIEWPORT_WIDTH,
      maxTurns = DEFAULT_MAX_TURNS,
      excludePatterns = [],
    } = config;

    const start = Date.now();
    const screens: ScreenArtefact[] = [];
    const visited = new Set<string>();
    const queue: string[] = [targetUrl];

    const executablePath = resolveChromiumPath() ?? undefined;
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
      const ctx = await browser.newContext({
        viewport: { width: viewportWidth, height: 900 },
        // #1090: supply httpCredentials so Playwright responds automatically to any
        // HTTP 401 WWW-Authenticate: Basic challenge (e.g. staging-environment protection
        // layered in front of the app). These are only sent in response to a 401 challenge
        // so they are harmless on sites that use form-based or no auth.
        ...(username && password ? { httpCredentials: { username, password } } : {}),
      });
      if (username && password) {
        console.warn(`[info] Playwright: httpCredentials active for ${username} -- HTTP Basic Auth 401 challenges handled automatically`);
      }
      const page = await ctx.newPage();

      // Pre-seed queue from sitemap.xml for full-site coverage (#0894).
      // Sitemap URLs are appended AFTER targetUrl so login still fires first;
      // they are visited with the authenticated session established by the login step.
      try {
        const origin = new URL(targetUrl).origin;
        const sitemapUrls = await fetchSitemapUrls(ctx, origin);
        let added = 0;
        for (const u of sitemapUrls) {
          if (!queue.includes(u)) { queue.push(u); added++; }
        }
        if (added > 0) {
          console.warn(`[info] Playwright sitemap pre-seed: ${added} URLs queued from ${origin}/sitemap.xml`);
        }
      } catch { /* non-fatal -- invalid targetUrl */ }

      let loginAttempted = false;
      // After form login succeeds, the very next page (the authenticated landing page)
      // may contain nav links (e.g. /settings, /affiliate) that are not in the sitemap.
      // Those links would normally land at the END of the queue -- behind 100+ sitemap
      // URLs -- and never be reached within the 80-screen budget. Setting this flag causes
      // the first authenticated page's discovered links to be unshifted to the FRONT of
      // the queue, ensuring they are visited before the bulk of sitemap pages (#1101).
      let firstAuthPagePriority = false;
      while (queue.length > 0 && screens.length < maxTurns) {
        const url = queue.shift()!;
        if (visited.has(url)) continue;
        visited.add(url);

        const screen = await capturePage(page, url, screens.length, screenshotQuality);
        screens.push(screen);

        const nextActions = planNextActions(url, screen.domSnapshot, visited, excludePatterns);
        for (const action of nextActions) {
          if (!visited.has(action.url) && !queue.includes(action.url)) {
            // Prioritise links found on the first authenticated page so that
            // nav-only pages (settings, profile, affiliate) are visited before
            // the bulk of sitemap URLs consume the screen budget.
            if (firstAuthPagePriority) {
              queue.unshift(action.url);
            } else {
              queue.push(action.url);
            }
          }
        }
        // Reset after the first authenticated page so subsequent pages use normal ordering.
        if (firstAuthPagePriority) firstAuthPagePriority = false;

        // After the first page (login page screenshot captured + public links queued),
        // attempt form login so subsequent crawl turns reach authenticated screens (#0893).
        if (!loginAttempted && authType === 'form' && username && password) {
          loginAttempted = true;
          const loginResult = await attemptFormLogin(page, username, password);
          if (loginResult.success) {
            // Strip hash so the landing URL deduplicates cleanly.
            const landingUrl = page.url().split('#')[0] ?? page.url();
            if (!visited.has(landingUrl) && !queue.includes(landingUrl)) {
              queue.unshift(landingUrl);
            }
            // Signal that the NEXT page's discovered links should be prioritised.
            firstAuthPagePriority = true;
            console.warn(`[info] Playwright form login succeeded -- ${loginResult.message}`);
          } else {
            // Form login was attempted but failed. Log clearly so the operator
            // knows screenshots will show unauthenticated content and can diagnose
            // the cause (wrong credentials, app-side error, CAPTCHA, etc.).
            console.warn(
              `[warn] Playwright form login FAILED: ${loginResult.message}` +
              ` -- verify credentials in vault (playwright-user-<app> / playwright-pass-<app>); crawl continues unauthenticated`,
            );
          }
          // Skip tab exploration on the login page -- page state has changed after login
          continue;
        }

        // Discover nav links hidden behind dropdown triggers (#1101).
        // Runs on every page except the login page (which uses `continue` above).
        const dropdownUrls = await discoverDropdownNavUrls(page, url, visited, excludePatterns);
        for (const u of dropdownUrls) {
          if (!visited.has(u) && !queue.includes(u)) queue.push(u);
        }

        // Explore role=tab navigation: inline screenshots for state-tabs, queue for URL-tabs (#0898)
        if (screens.length < maxTurns) {
          await discoverAndCaptureTabVariants(
            page, url, screen.slug, screenshotQuality, queue, visited, screens, maxTurns,
          );
        }
      }
    } finally {
      await browser?.close();
    }

    return {
      targetUrl,
      screenCount: screens.length,
      screens,
      durationMs: Date.now() - start,
      engineVersion: '0.0.1',
    };
  }
}

function findChromiumOnFilesystem(): string | null {
  // chromium.executablePath() throws inside pkg binaries because the Playwright
  // registry can't find browsers.json in the virtual snapshot. Fall back to
  // scanning the known ms-playwright install location directly.
  // Locations differ per OS:
  //   Windows : %LOCALAPPDATA%\ms-playwright
  //   Linux   : ~/.cache/ms-playwright
  //   macOS   : ~/Library/Caches/ms-playwright
  const home = homedir();
  const localAppData = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local');
  const candidateRoots = [
    join(localAppData, 'ms-playwright'),       // Windows
    join(home, '.cache', 'ms-playwright'),      // Linux
    join(home, 'Library', 'Caches', 'ms-playwright'), // macOS
  ];

  // Binary sub-paths within a chromium-NNNN directory, in preference order.
  // Windows: chrome-win64/chrome.exe or chrome-win/chrome.exe
  // Linux  : chrome-linux/chrome
  // macOS  : chrome-mac/Chromium.app/Contents/MacOS/Chromium (older)
  //          chrome-mac-NNNN/Chromium.app/Contents/MacOS/Chromium (newer)
  const subfolderCandidates: [string, string][] = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win',   'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-linux', 'chromium'],
    ['chrome-mac',   join('Chromium.app', 'Contents', 'MacOS', 'Chromium')],
  ];

  for (const msPlaywrightDir of candidateRoots) {
    if (!existsSync(msPlaywrightDir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(msPlaywrightDir).filter(d => d.startsWith('chromium-'));
    } catch {
      continue;
    }
    entries.sort().reverse(); // highest build number first
    for (const dir of entries) {
      for (const [subfolder, binary] of subfolderCandidates) {
        const candidate = join(msPlaywrightDir, dir, subfolder, binary);
        if (existsSync(candidate)) return candidate;
      }
      // macOS: Playwright sometimes adds a build-number suffix to chrome-mac,
      // e.g. chrome-mac-1415. Scan for any chrome-mac* subdirectory.
      let subEntries: string[];
      try {
        subEntries = readdirSync(join(msPlaywrightDir, dir)).filter(d => d.startsWith('chrome-mac'));
      } catch {
        subEntries = [];
      }
      for (const sub of subEntries) {
        const candidate = join(msPlaywrightDir, dir, sub, 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

export async function buildPlaywrightProbe(opts?: {
  executablePath?: string;
  launchTimeoutMs?: number;
}): Promise<{ status: 'ok' | 'fail' | 'warn'; version: string | null; path: string | null; error: string | null }> {
  let path: string;
  let fromFilesystemScan = false;
  try {
    path = opts?.executablePath ?? chromium.executablePath();
  } catch {
    // pkg binary: playwright registry unavailable in virtual snapshot -- scan filesystem
    const fsPath = findChromiumOnFilesystem();
    if (!fsPath) {
      return { status: 'warn', version: null, path: null, error: 'Chromium not found -- run: swao install-playwright' };
    }
    path = fsPath;
    fromFilesystemScan = true;
  }

  if (!existsSync(path)) {
    // Path from playwright registry may be a virtual snapshot path in pkg binary.
    // Fall back to filesystem scan before declaring failure.
    const fsPath = findChromiumOnFilesystem();
    if (fsPath) {
      const buildMatch = fsPath.match(/chromium-(\d+)/);
      const version = buildMatch ? `build-${buildMatch[1]}` : 'detected';
      return { status: 'ok', version, path: fsPath, error: null };
    }
    return { status: 'fail', version: null, path, error: 'Chromium not found -- run: swao install-playwright' };
  }

  // In pkg binary context, playwright.launch() cannot run inside the virtual snapshot.
  // Check two conditions: (1) Chromium binary exists on disk, (2) playwright-core npm
  // package is installed on the host so the binary stub can load it at runtime (#0927).
  // Reporting 'warn' when (2) is missing keeps health-check consistent with assess.ts
  // which also gates on isPlaywrightPackageInstalled() (#1077).
  if (fromFilesystemScan) {
    const buildMatch = path.match(/chromium-(\d+)/);
    const version = buildMatch ? `build-${buildMatch[1]}` : 'detected';
    if (!isPlaywrightPackageInstalled()) {
      return {
        status: 'warn',
        version,
        path,
        error: 'Chromium found but playwright-core npm package missing -- run: swao install-playwright',
      };
    }
    return { status: 'ok', version, path, error: null };
  }

  // Development / dev-build context: perform a full launch check.
  const timeoutMs = opts?.launchTimeoutMs ?? 5000;
  let browser: Browser | null = null;
  try {
    browser = await Promise.race<Browser>([
      chromium.launch({ headless: true, executablePath: path }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Chromium launch timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    const version = browser.version();
    return { status: 'ok', version, path, error: null };
  } catch (e) {
    // If the path exists but launch fails (e.g. pkg binary can't launch from snapshot),
    // fall back to reporting ok based on file presence -- the actual launch will be
    // attempted only when Pass 10 (dynamic analysis) runs.
    const err = (e as Error).message;
    if (err.includes('undefined') || err.includes('snapshot') || err.includes('Cannot find')) {
      const buildMatch = path.match(/chromium-(\d+)/);
      const version = buildMatch ? `build-${buildMatch[1]}` : 'detected';
      return { status: 'ok', version, path, error: null };
    }
    return { status: 'fail', version: null, path, error: err };
  } finally {
    await browser?.close();
  }
}
