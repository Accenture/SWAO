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

// #3437: client-identifier redaction for the support bundle. The PII redactor
// (redactPiiValue) removes e-mail, phone and secret-shaped values, and
// redactUserIdentity removes the operator's home / user / host name, but log
// text still carried internal host names, absolute client paths, file names
// from external tool output and verbatim chat prompts. This module adds a
// generic (not client-specific) pass:
//
//   - URLs: user info, query and fragment dropped; host pseudonymised unless
//     on the exact-match public allowlist; path segments outside a small API
//     vocabulary pseudonymised.
//   - Host names (2+ labels, known or private-use TLD) and IPv4 literals:
//     pseudonymised unless allowlisted / loopback.
//   - Absolute paths (drive, UNC, POSIX 2+ segments, ~/...): replaced by a
//     placeholder that keeps only the file extension.
//   - stderr / stdout excerpts: additionally file-name-shaped tokens, relative
//     paths and quoted fragments are pseudonymised.
//   - Key-suffix fields (api_key_suffix from older logs) are dropped.
//   - Chat turns: content dropped, only its length is kept.
//
// Placeholders are an HMAC-SHA256 prefix keyed by a random per-bundle salt:
// stable inside one bundle (support can correlate "same host"), but not
// reversible by hashing guessed names. Every regex is either a single
// character class or a bounded / deterministic sequence (ReDoS-safe).

import { createHmac, randomBytes } from 'node:crypto';

export interface BundleRedactionCounts {
  urls: number;
  hosts: number;
  paths: number;
  excerpts: number;
  key_fields: number;
  chat_turns: number;
}

export interface BundleRedactor {
  readonly counts: BundleRedactionCounts;
  /** Scrub URLs, host names, IPv4 literals and absolute paths inside free text. */
  scrubText(s: string): string;
  /** Scrub URLs and host names only (safe over serialised JSON text). */
  scrubHosts(s: string): string;
  /** scrubText plus file names, relative paths and quoted fragments (tool output). */
  scrubExcerpt(s: string): string;
  /** Deep-walk a parsed log value: drop key fields, scrub excerpt keys, scrub strings. */
  scrubValue(v: unknown): unknown;
}

/** Exact-match public hosts kept verbatim (vendor endpoints, SWAO's own sites). */
export const PUBLIC_HOST_ALLOWLIST: ReadonlySet<string> = new Set([
  'api.openai.com', 'api.anthropic.com', 'api.mistral.ai', 'generativelanguage.googleapis.com',
  'github.com', 'api.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com',
  'gitlab.com', 'bitbucket.org', 'registry.npmjs.org', 'nodejs.org',
  'accenture.github.io', 'steady-echo-yp4z.here.now', 'here.now',
]);

// Final labels treated as a host TLD outside URL context. Generic + common
// ccTLDs + private-use names; deliberately excludes TLDs that collide with
// file extensions SWAO itself writes (for example md).
const HOST_TLDS: ReadonlySet<string> = new Set([
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'io', 'ai', 'app', 'dev', 'cloud', 'eu',
  'de', 'at', 'ch', 'li', 'uk', 'ie', 'fr', 'be', 'nl', 'lu', 'it', 'es', 'pt', 'dk', 'se', 'no', 'fi',
  'is', 'pl', 'cz', 'sk', 'hu', 'si', 'hr', 'ro', 'bg', 'gr', 'ee', 'lv', 'lt', 'us', 'ca', 'au', 'nz',
  'jp', 'cn', 'in', 'br', 'za', 'sg', 'hk',
  'internal', 'intranet', 'intra', 'corp', 'local', 'localdomain', 'lan', 'home', 'test', 'example', 'invalid',
]);

// URL path segments kept verbatim (generic API shapes useful for gateway triage).
const URL_PATH_VOCAB: ReadonlySet<string> = new Set([
  'v1', 'v2', 'v3', 'v1beta', 'api', 'openai', 'deployments', 'chat', 'completions', 'messages',
  'models', 'embeddings', 'responses', 'health', 'status',
]);

const EXCERPT_KEY = /^(?:std(?:err|out)|output)(?:_[a-z]+)?$/i;
const DROPPED_KEY = /(?:^|_)key_(?:suffix|prefix)$|^api_?key|^authorization$/i;

// Bounded scheme (max 16 chars) keeps the scan linear.
const URL_RE = /\b[A-Za-z][A-Za-z0-9+.-]{0,15}:\/\/[^\s"'<>`\\]+/g;
const HOST_TOKEN_RE = /[A-Za-z0-9.-]+/g;
const WIN_PATH_RE = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>|]*(?: [^\s"'<>|\\/~]+[\\/][^\s"'<>|]*)*/g;
const UNC_PATH_RE = /(?<![\\A-Za-z0-9])\\\\[^\s"'<>|\\]+\\[^\s"'<>|]*/g;
const POSIX_PATH_RE = /(?<![A-Za-z0-9_.:\\<>/-])~?\/(?:[^\s/"'<>|]+\/)+[^\s/"'<>|]*/g;
const FILE_TOKEN_RE = /[A-Za-z0-9_.\\/-]+/g;
const CODE_VALUE_PREFIX = /"(?:code|scope)": ?"$/;
const QUOTED_RE = /'([^'\n]{1,200})'|"([^"\n]{1,200})"/g;

function stripEdge(t: string): { lead: string; core: string; trail: string } {
  let a = 0;
  let b = t.length;
  while (a < b && (t[a] === '.' || t[a] === '-')) a++;
  while (b > a && (t[b - 1] === '.' || t[b - 1] === '-')) b--;
  return { lead: t.slice(0, a), core: t.slice(a, b), trail: t.slice(b) };
}

function isIpv4(core: string): boolean {
  const parts = core.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isHostName(core: string, urlContext: boolean): boolean {
  const labels = core.split('.');
  if (labels.length < 2 || labels.some((l) => l.length === 0 || l.length > 63)) return false;
  const tld = labels[labels.length - 1]!.toLowerCase();
  if (!/^[a-z]{2,24}$/.test(tld)) return false;
  return urlContext || HOST_TLDS.has(tld);
}

function extensionOf(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? '';
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(base);
  return m ? `.${m[1]!.toLowerCase()}` : '';
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * #3437: replace the resolved workspace root with `<workspace>` anywhere in
 * serialised bundle text (raw `\`, JSON-escaped `\\` or `/` separators,
 * case-insensitive), so artefacts that only get the host pass
 * (health-check.json, run-manifests.json) carry no client directory either.
 * Literal sequence, no nested quantifiers.
 */
export function redactWorkspaceRoot(text: string, root: string): string {
  const parts = root.split(/[\\/]+/).filter(Boolean);
  if (parts.length < 2 && !/^[\\/]/.test(root)) return text;
  if (parts.length === 0) return text;
  const SEP = '(?:\\\\\\\\|\\\\|/)';
  const lead = /^[\\/]/.test(root) ? SEP : '';
  return text.replace(new RegExp(`${lead}${parts.map(escapeRe).join(SEP)}(?![A-Za-z0-9_.-])`, 'gi'), '<workspace>');
}

export function createBundleRedactor(salt: string = randomBytes(16).toString('hex')): BundleRedactor {
  const counts: BundleRedactionCounts = { urls: 0, hosts: 0, paths: 0, excerpts: 0, key_fields: 0, chat_turns: 0 };
  const seenHosts = new Set<string>();
  const tag = (kind: string, value: string): string =>
    createHmac('sha256', salt).update(`${kind}:${value}`).digest('hex').slice(0, 8);

  const hostPlaceholder = (host: string): string => {
    const h = host.toLowerCase();
    if (!seenHosts.has(h)) { seenHosts.add(h); counts.hosts++; }
    return `<host-${tag('host', h)}>`;
  };

  const scrubHostToken = (token: string, urlContext: boolean): string => {
    const { lead, core, trail } = stripEdge(token);
    if (!core) return token;
    if (isIpv4(core)) {
      if (core.startsWith('127.') || core === '0.0.0.0') return token;
      return `${lead}${hostPlaceholder(core).replace('<host-', '<ip-')}${trail}`;
    }
    if (!isHostName(core, urlContext) || PUBLIC_HOST_ALLOWLIST.has(core.toLowerCase())) return token;
    return `${lead}${hostPlaceholder(core)}${trail}`;
  };

  const scrubUrl = (raw: string): string => {
    counts.urls++;
    let u: URL;
    try { u = new URL(raw); } catch { return `<url-${tag('url', raw)}>`; }
    const host = u.hostname;
    const safeHost = host === '' ? '' : (PUBLIC_HOST_ALLOWLIST.has(host.toLowerCase()) || host === 'localhost' || host.startsWith('127.')
      ? host
      : hostPlaceholder(host));
    const port = u.port ? `:${u.port}` : '';
    const segs = u.pathname.split('/').map((s) => (s === '' || URL_PATH_VOCAB.has(s.toLowerCase()) ? s : `<seg-${tag('seg', s)}>`));
    const query = u.search || u.hash ? '?<query>' : '';
    return `${u.protocol}//${safeHost}${port}${segs.join('/')}${query}`;
  };

  const pathPlaceholder = (match: string): string => {
    // Trailing sentence punctuation stays outside the placeholder.
    let end = match.length;
    while (end > 1 && '.,;:)]'.includes(match[end - 1]!)) end--;
    const p = match.slice(0, end);
    counts.paths++;
    return `<path-${tag('path', p)}${extensionOf(p)}>${match.slice(end)}`;
  };

  // Token callbacks skip existing placeholders (`<kind-...>`) and keep the
  // escaped character of a JSON escape sequence (backslash-n, backslash-t)
  // out of the token so the escape stays valid.
  const tokenCallback = (fn: (t: string) => string) => (t: string, offset: number, whole: string): string => {
    const prev = offset > 0 ? whole[offset - 1] : '';
    if (prev === '<') return t;
    if (prev === '\\' && 'ntrbfu'.includes(t[0]!)) return t[0]! + (t.length > 1 ? fn(t.slice(1)) : '');
    return fn(t);
  };
  const hostTokens = tokenCallback((t) => scrubHostToken(t, false));
  // Serialised event codes / scopes (e.g. a code ending in `.cloud`) are SWAO
  // identifiers, never hosts: the text-level pass leaves those JSON values alone.
  const textHostTokens = (t: string, offset: number, whole: string): string =>
    CODE_VALUE_PREFIX.test(whole.slice(Math.max(0, offset - 12), offset)) ? t : hostTokens(t, offset, whole);

  const scrubHosts = (s: string): string =>
    s.replace(URL_RE, scrubUrl).replace(HOST_TOKEN_RE, textHostTokens);

  const scrubText = (s: string): string => {
    let out = s.replace(URL_RE, scrubUrl);
    out = out.replace(WIN_PATH_RE, pathPlaceholder).replace(UNC_PATH_RE, pathPlaceholder).replace(POSIX_PATH_RE, pathPlaceholder);
    return out.replace(HOST_TOKEN_RE, hostTokens);
  };

  const scrubExcerpt = (s: string): string => {
    counts.excerpts++;
    let out = scrubText(s);
    out = out.replace(QUOTED_RE, (m, a: string | undefined, b: string | undefined) => {
      const inner = a ?? b ?? '';
      if (inner.startsWith('<') && inner.endsWith('>')) return m;
      const q = m[0]!;
      return `${q}<q-${tag('q', inner)}>${q}`;
    });
    return out.replace(FILE_TOKEN_RE, tokenCallback((t) => {
      const { lead, core, trail } = stripEdge(t);
      const looksLikePath = /[A-Za-z0-9_][\\/][A-Za-z0-9_.]/.test(core);
      const looksLikeFile = /^[^.]+(?:\.[^.]+)*\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(core) && !/^\d/.test(core.split('.').pop() ?? '');
      if (!looksLikePath && !looksLikeFile) return t;
      return `${lead}<file-${tag('file', core)}${extensionOf(core)}>${trail}`;
    }));
  };

  const scrubValue = (v: unknown): unknown => {
    if (typeof v === 'string') return scrubText(v);
    if (Array.isArray(v)) return v.map(scrubValue);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (DROPPED_KEY.test(k)) { counts.key_fields++; continue; }
        out[k] = EXCERPT_KEY.test(k) && typeof val === 'string' ? scrubExcerpt(val) : scrubValue(val);
      }
      return out;
    }
    return v;
  };

  return { counts, scrubText, scrubHosts, scrubExcerpt, scrubValue };
}
