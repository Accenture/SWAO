// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- Phase 2 post-crawl extraction harness
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 083 Section 7.1 -- Phase 2 post-crawl extraction.
// Reads parity-baseline/ after Phase 1 (Playwright crawl) completes and
// feeds per-screen meta.json + dom.html through deterministic rule engines.
// DOM check functions (DYN-05, DYN-06, DYN-08) are stubs here; they are
// filled in by #1269, #1270, #1271.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface MetaJson {
  index: number;
  url: string;
  title: string;
  timestamp: string;
  slug: string;
  network_entries: number;
  console_entries: number;
  a11y_violations: number;
  network_log: NetworkEntry[];
  console_log: ConsoleEntry[];
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number | null;
  resourceType: string;
}

export interface ConsoleEntry {
  type: string;
  text: string;
}

export interface ExternalHost {
  hostname: string;
  request_count: number;
  resource_types: string[];
}

export interface HttpError {
  url: string;
  status: number;
  method: string;
  screen_slug: string;
}

export interface AuthEndpoint {
  path: string;
  screens: string[];
}

export interface PiiFormField {
  screen_slug: string;
  element: string;
  issue: string;
}

export interface ThirdPartyScript {
  src: string;
  screen_slug: string;
}

export interface ExtractedSignals {
  externalHosts: ExternalHost[];
  apiEndpoints: string[];
  httpErrors: HttpError[];
  authEndpoints: AuthEndpoint[];
  piiForms: PiiFormField[];
  thirdPartyScripts: ThirdPartyScript[];
  cookieConsentPresent: boolean;
}

export interface Phase2Config {
  appDomain: string;
  analyticsBlocklist?: string[];
  piiFieldPatterns?: string[];
  authEndpointPatterns?: string[];
}

export interface Phase2Result {
  extracted: ExtractedSignals;
  extraction_duration_ms: number;
  screens_processed: number;
}

const LOCAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
];

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOST_PATTERNS.some((p) => p.test(hostname));
}

// Replace path segments that look like UUIDs or numeric IDs with {id}.
function normalizePathTemplate(pathname: string): string {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}')
    .replace(/\/\d{4,}/g, '/{id}');
}

const DEFAULT_AUTH_PATTERNS = [
  '/auth/', '/login', '/logout', '/session', '/token', '/oauth', '/oidc', '/user/me', '/auth/me',
];

function runNetworkRules(screens: MetaJson[], config: Phase2Config): Omit<ExtractedSignals, 'piiForms' | 'thirdPartyScripts' | 'cookieConsentPresent'> {
  const externalHostsMap = new Map<string, { count: number; resourceTypes: Set<string> }>();
  const apiEndpointsSet = new Set<string>();
  const httpErrors: HttpError[] = [];
  const authEndpointsMap = new Map<string, Set<string>>();
  const authPatterns = config.authEndpointPatterns ?? DEFAULT_AUTH_PATTERNS;

  for (const screen of screens) {
    for (const entry of screen.network_log) {
      let hostname: string | null = null;
      let pathname: string | null = null;
      try {
        const u = new URL(entry.url);
        hostname = u.hostname;
        pathname = u.pathname;
      } catch {
        continue;
      }

      // DYN-02: external host calls (Design 083 section 3.1)
      if (hostname && hostname !== config.appDomain && !isLocalHost(hostname)) {
        if (!externalHostsMap.has(hostname)) {
          externalHostsMap.set(hostname, { count: 0, resourceTypes: new Set() });
        }
        const rec = externalHostsMap.get(hostname)!;
        rec.count++;
        rec.resourceTypes.add(entry.resourceType);
      }

      // DYN-03: live API endpoint inventory (fetch calls only)
      if (entry.resourceType === 'fetch' && pathname) {
        apiEndpointsSet.add(normalizePathTemplate(pathname));
      }

      // DYN-04: HTTP error responses (status >= 400)
      if (entry.status !== null && entry.status >= 400) {
        httpErrors.push({
          url: entry.url,
          status: entry.status,
          method: entry.method,
          screen_slug: screen.slug,
        });
      }

      // DYN-07: auth surface mapping
      if (pathname && authPatterns.some((p) => pathname!.includes(p))) {
        if (!authEndpointsMap.has(pathname)) authEndpointsMap.set(pathname, new Set());
        authEndpointsMap.get(pathname)!.add(screen.slug);
      }
    }
  }

  return {
    externalHosts: [...externalHostsMap.entries()].map(([hostname, data]) => ({
      hostname,
      request_count: data.count,
      resource_types: [...data.resourceTypes],
    })),
    apiEndpoints: [...apiEndpointsSet].sort(),
    httpErrors,
    authEndpoints: [...authEndpointsMap.entries()].map(([path, screens]) => ({
      path,
      screens: [...screens],
    })),
  };
}

// ---------------------------------------------------------------------------
// DOM check helpers -- DYN-05, DYN-06, DYN-08 (#1269, #1270, #1271)
// ---------------------------------------------------------------------------

const INPUT_ELEMENT_RE = /<input\b([^>]*)>/gis;
const SCRIPT_SRC_RE = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']*)["'][^>]*>/gis;

const PII_NAME_RE = /\b(dob|ssn|phone|address|surname|firstname|last[_-]?name|first[_-]?name)\b/i;

const CONSENT_PATTERNS = [
  /class\s*=\s*["'][^"']*\bcookie\b[^"']*["']/i,
  /class\s*=\s*["'][^"']*\bconsent\b[^"']*["']/i,
  /id\s*=\s*["'][^"']*\bgdpr\b[^"']*["']/i,
  /id\s*=\s*["'][^"']*\bcookie\b[^"']*["']/i,
  /\bonetrust\b/i,
  /\bcookiebot\b/i,
  /\busercentrics\b/i,
  /\bcookieyes\b/i,
];

function extractHtmlAttr(attrStr: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = attrStr.match(re);
  return m ? m[1]! : null;
}

const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'file', 'range', 'color']);

export function runDomChecks(
  slug: string,
  domHtml: string,
  config: Phase2Config,
): { piiForms: PiiFormField[]; thirdPartyScripts: ThirdPartyScript[]; cookieConsentPresent: boolean } {
  const piiForms: PiiFormField[] = [];
  const thirdPartyScripts: ThirdPartyScript[] = [];

  // DYN-05: PII form field security attributes
  INPUT_ELEMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INPUT_ELEMENT_RE.exec(domHtml)) !== null) {
    const attrs = m[1] ?? '';
    const type = (extractHtmlAttr(attrs, 'type') ?? 'text').toLowerCase();
    const name = extractHtmlAttr(attrs, 'name') ?? '';
    const autocomplete = extractHtmlAttr(attrs, 'autocomplete');

    if (SKIP_INPUT_TYPES.has(type)) continue;

    if (type === 'password') {
      if (autocomplete !== 'current-password' && autocomplete !== 'new-password') {
        piiForms.push({
          screen_slug: slug,
          element: `<input type="password" name="${name}">`,
          issue: 'password field missing autocomplete="current-password" or "new-password"',
        });
      }
    } else if (type === 'email') {
      if (autocomplete !== 'email') {
        piiForms.push({
          screen_slug: slug,
          element: `<input type="email" name="${name}">`,
          issue: 'email field missing autocomplete="email"',
        });
      }
    } else if (name && PII_NAME_RE.test(name) && autocomplete === null) {
      piiForms.push({
        screen_slug: slug,
        element: `<input type="${type}" name="${name}">`,
        issue: `PII-named field "${name}" missing autocomplete attribute`,
      });
    }
  }

  // DYN-06: third-party scripts (design 083 Q3 exception: script[src] is checked)
  SCRIPT_SRC_RE.lastIndex = 0;
  while ((m = SCRIPT_SRC_RE.exec(domHtml)) !== null) {
    const src = m[1]!;
    try {
      const hostname = new URL(src).hostname;
      if (hostname && hostname !== config.appDomain && !hostname.endsWith('.' + config.appDomain)) {
        thirdPartyScripts.push({ src, screen_slug: slug });
      }
    } catch {
      // skip invalid src values
    }
  }

  // DYN-08: cookie consent / privacy control element detection
  const cookieConsentPresent = CONSENT_PATTERNS.some((re) => re.test(domHtml));

  return { piiForms, thirdPartyScripts, cookieConsentPresent };
}

export async function runPhase2(baselineDir: string, config: Phase2Config): Promise<Phase2Result> {
  const t0 = Date.now();

  if (!existsSync(baselineDir)) {
    return { extracted: emptyExtracted(), extraction_duration_ms: 0, screens_processed: 0 };
  }

  const entries = readdirSync(baselineDir, { withFileTypes: true });
  const screenDirs = entries
    .filter((d) => d.isDirectory() && /^\d{3}-/.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const screens: MetaJson[] = [];
  const domHtmlMap = new Map<string, string>();

  for (const dir of screenDirs) {
    const metaPath = join(baselineDir, dir.name, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as MetaJson;
      screens.push(meta);
    } catch {
      continue;
    }

    const domPath = join(baselineDir, dir.name, 'dom.html');
    if (existsSync(domPath)) {
      try {
        domHtmlMap.set(dir.name, readFileSync(domPath, 'utf-8'));
      } catch {
        // skip unreadable dom snapshots
      }
    }
  }

  const networkSignals = runNetworkRules(screens, config);

  const domAggregate = { piiForms: [] as PiiFormField[], thirdPartyScripts: [] as ThirdPartyScript[], cookieConsentPresent: false };
  for (const [slug, html] of domHtmlMap) {
    const domResult = runDomChecks(slug, html, config);
    domAggregate.piiForms.push(...domResult.piiForms);
    domAggregate.thirdPartyScripts.push(...domResult.thirdPartyScripts);
    if (domResult.cookieConsentPresent) domAggregate.cookieConsentPresent = true;
  }

  return {
    extracted: { ...networkSignals, ...domAggregate },
    extraction_duration_ms: Date.now() - t0,
    screens_processed: screens.length,
  };
}

function emptyExtracted(): ExtractedSignals {
  return {
    externalHosts: [],
    apiEndpoints: [],
    httpErrors: [],
    authEndpoints: [],
    piiForms: [],
    thirdPartyScripts: [],
    cookieConsentPresent: false,
  };
}
