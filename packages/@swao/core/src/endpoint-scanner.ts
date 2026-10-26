// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3405: shared hard-coded endpoint scanner (Design 117 section 3).
//
// One deterministic scanner for hard-coded IPv4 addresses and network URLs in
// source and configuration text. Carved out of the code-health pass (Pass 26)
// so the Java egress patterns (#3422) and the stack-aware TF-01 config check
// (#3424) consume the same rules instead of growing their own regexes.
//
// Contract:
//   - pure: no file system access. The caller lists files through the central
//     source scope (listSourceFiles, #3428), filters them with
//     isEndpointScanCandidate, reads them and passes the text in;
//   - deterministic: hits come back in (line, column) order, every field is
//     derived from the text alone;
//   - linear: the line is scanned with two regexes that have no nested
//     quantifiers (bounded scheme, single negated character class for the URL
//     remainder, bounded octets with fixed-width lookarounds);
//   - classify, do not drop: every literal is returned with a classification
//     and a `reportable` flag, so a consumer can choose. #3422 wants public
//     hosts, #3424 wants any literal host in a config file (including the
//     default inside `${DB_HOST:10.0.0.1}`), the code-health pass counts
//     `reportable` hits only.
//
// Not reportable: loopback, unspecified, link-local, documentation ranges
// (RFC 5737, RFC 3849), reserved names (RFC 2606 / RFC 6761), XML namespace
// and licence hosts, templated hosts (`${HOST}`, `{{ .Values.host }}`),
// version-like dotted quads, netmasks/multicast, and the operator allowlist.
// Comment-only lines (licence headers, Javadoc, YAML comments) are skipped by
// default (`skipCommentLines`).

/** What kind of literal was found. IPv6 literals are recognised inside URLs only (`http://[2001:db8::1]/`). */
export type EndpointKind = 'ipv4' | 'url';

/** Classification of the host of a hit. Only `public` and `private` are reportable. */
export type EndpointClass =
  | 'public'
  | 'private'
  | 'loopback'
  | 'unspecified'
  | 'link_local'
  | 'documentation'
  | 'reserved'
  | 'namespace'
  | 'templated'
  | 'version_like'
  | 'allowlisted';

export const REPORTABLE_ENDPOINT_CLASSES: ReadonlySet<EndpointClass> = new Set<EndpointClass>(['public', 'private']);

export interface EndpointHit {
  kind: EndpointKind;
  /** The literal as matched (URL with trailing punctuation trimmed), at most MAX_VALUE_LENGTH characters. */
  value: string;
  /** Lower-cased host (IPv6 without brackets); the raw authority for templated URLs. */
  host: string;
  /** Lower-cased URL scheme (`https`, `jdbc:postgresql`); null for bare IPv4 literals. */
  scheme: string | null;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the first character of the literal. */
  column: number;
  classification: EndpointClass;
  /** classification is `public` or `private`. */
  reportable: boolean;
}

export interface ScanEndpointsOptions {
  /** Operator allowlist: exact hosts, or `.suffix` entries matching every subdomain. Case-insensitive. */
  allowHosts?: Iterable<string>;
  /** Stop after this many hits (all classes). Default: unlimited. */
  maxHits?: number;
  /** Lines longer than this are skipped (minified bundles). Default MAX_SCANNED_LINE_LENGTH. */
  maxLineLength?: number;
  /**
   * Skip comment-only lines (isCommentOnlyLine): licence headers, Javadoc,
   * YAML / properties comments. Default true; trailing comments on a code
   * line are still scanned.
   */
  skipCommentLines?: boolean;
}

export const MAX_SCANNED_LINE_LENGTH = 4000;
const MAX_VALUE_LENGTH = 200;

// Line-comment starts: `//`, `/*`, `*` (block comment body), `#` (not a C
// preprocessor directive), `<!--`, `--` (SQL, Lua), `;` (INI), `!` followed
// by a space (Java .properties), `REM ` (batch).
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*|#(?!\s*(?:include|define|if|ifdef|ifndef|elif|else|endif|pragma|import)\b)|<!--|--(?=\s|$)|;|!\s|rem\s)/i;

/** True when the line holds only a comment (heuristic shared by all file types). */
export function isCommentOnlyLine(line: string): boolean {
  return COMMENT_LINE_RE.test(line);
}

// ---------------------------------------------------------------------------
// File applicability
// ---------------------------------------------------------------------------

/**
 * Extensions the scanner covers: source code and the configuration formats
 * of the stacks SWAO assesses (Spring `application*.yml` / `.properties`,
 * Helm `values-*.yaml`, `config.js`, Terraform, .NET `appsettings.json`).
 * Documentation (`.md`, `.txt`, `.html`) is out of scope on purpose.
 */
export const ENDPOINT_SCAN_EXTENSIONS: ReadonlySet<string> = new Set([
  // JVM
  '.java', '.kt', '.kts', '.groovy', '.scala', '.gradle',
  // JavaScript / TypeScript
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  // other languages
  '.py', '.go', '.cs', '.vb', '.rb', '.php', '.rs', '.swift', '.c', '.cc', '.cpp', '.h', '.hpp',
  '.sh', '.bash', '.ps1', '.psm1', '.bat', '.cmd', '.sql',
  // configuration
  '.yml', '.yaml', '.properties', '.json', '.xml', '.toml', '.ini', '.conf', '.cfg', '.config',
  '.env', '.tf', '.tfvars', '.hcl', '.tpl', '.j2', '.dockerfile',
]);

/** Extension-less build and container files the scanner covers (lower-cased names). */
const ENDPOINT_SCAN_NAMES: ReadonlySet<string> = new Set([
  'dockerfile', 'containerfile', 'jenkinsfile', 'makefile', 'procfile', 'vagrantfile',
]);

/** Lockfiles: registry URLs only, never configuration (lower-cased names). */
const ENDPOINT_SCAN_SKIP_NAMES: ReadonlySet<string> = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
  'gemfile.lock', 'poetry.lock', 'cargo.lock', 'go.sum', 'packages.lock.json',
]);

/**
 * True when the scanner should read this file. Takes the name and extension
 * of a source-scope SourceFile. Covers `Dockerfile`, `Dockerfile.prod`,
 * `api.dockerfile` and `.env` / `.env.production` (the latter are dot-files:
 * list them with `includeHidden: true`).
 */
export function isEndpointScanCandidate(f: { name: string; ext: string }): boolean {
  const lower = f.name.toLowerCase();
  if (ENDPOINT_SCAN_SKIP_NAMES.has(lower)) return false;
  if (lower === '.env' || lower.startsWith('.env.')) return true;
  if (ENDPOINT_SCAN_NAMES.has(lower)) return true;
  if (lower.startsWith('dockerfile.') || lower.startsWith('containerfile.')) return true;
  return ENDPOINT_SCAN_EXTENSIONS.has(f.ext.toLowerCase());
}

// ---------------------------------------------------------------------------
// Host classification
// ---------------------------------------------------------------------------

/** Hosts that appear as XML namespaces, schema locations and licence headers, never as endpoints. */
const NAMESPACE_HOSTS: ReadonlySet<string> = new Set([
  'www.w3.org', 'w3.org', 'xmlns.jcp.org', 'java.sun.com', 'xmlns.oracle.com', 'maven.apache.org',
  'www.apache.org', 'apache.org', 'json-schema.org', 'schemas.xmlsoap.org', 'schemas.microsoft.com',
  'schemas.openxmlformats.org', 'www.springframework.org', 'docs.oasis-open.org', 'purl.org',
  'ns.adobe.com', 'www.opengis.net', 'opensource.org', 'www.gnu.org', 'gnu.org', 'spdx.org',
  'creativecommons.org', 'schema.org', 'www.omg.org', 'jakarta.ee', 'xmlns.com', 'www.eclipse.org',
  'hibernate.org', 'www.hibernate.org', 'logging.apache.org', 'www.liquibase.org', 'mybatis.org',
]);

/** RFC 2606 / RFC 6761 second-level documentation domains. */
const DOCUMENTATION_DOMAINS: readonly string[] = ['example.com', 'example.net', 'example.org'];
/** RFC 2606 / RFC 6761 reserved top-level names. */
const RESERVED_TLDS: readonly string[] = ['example', 'test', 'invalid'];
/** Internal-only name suffixes: still hard-coded, so reportable as private. */
const PRIVATE_SUFFIXES: readonly string[] = [
  'local', 'internal', 'intranet', 'lan', 'corp', 'home', 'localdomain', 'svc', 'cluster.local',
];

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p.startsWith('0')) return null; // leading zero: octal-ambiguous, not an address literal
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out as [number, number, number, number];
}

function classifyIpv4(o: readonly [number, number, number, number]): EndpointClass {
  const [a, b, c] = o;
  if (a === 0) return o.every((x) => x === 0) ? 'unspecified' : 'reserved';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link_local';
  if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) {
    return 'documentation'; // RFC 5737 TEST-NET-1/2/3
  }
  if (a >= 224) return 'reserved'; // multicast, class E, netmasks such as 255.255.255.0
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
    return 'private'; // RFC 1918 and RFC 6598 shared address space
  }
  return 'public';
}

function classifyIpv6(host: string): EndpointClass {
  const h = host.toLowerCase();
  if (h === '::1') return 'loopback';
  if (h === '::') return 'unspecified';
  if (h.startsWith('2001:db8:') || h === '2001:db8::') return 'documentation'; // RFC 3849
  if (/^fe[89ab]/.test(h)) return 'link_local';
  if (/^f[cd]/.test(h)) return 'private'; // RFC 4193 unique local
  if (h.startsWith('::ffff:')) {
    const v4 = parseIpv4(h.slice(7));
    return v4 ? classifyIpv4(v4) : 'public';
  }
  return 'public';
}

function matchesSuffix(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

// #3487: operator allowlist entries (`assessment.code_health.endpoint_allowlist`).
// A host name (`api.partner.example`), a `.suffix` matching the domain and every
// subdomain (`.corp.example`), an IPv4 literal (`10.20.30.40`) or an IPv6
// literal without brackets (`fd00::1`). Labels are letters, digits, `_` and
// `-` separated by single dots; every repetition starts with a literal dot, so
// the pattern is linear (no nested ambiguity).
const ALLOW_NAME_RE = /^\.?[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/;
const ALLOW_IPV6_RE = /^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/;
/** Longest accepted allowlist entry (a DNS name is at most 253 characters). */
export const MAX_ENDPOINT_ALLOW_ENTRY_LENGTH = 253;

/** True when `entry` is a usable allowlist entry (see normaliseEndpointAllowlist). */
export function isValidEndpointAllowEntry(entry: string): boolean {
  const e = entry.trim().toLowerCase().replace(/\.$/, '');
  if (e.length === 0 || e.length > MAX_ENDPOINT_ALLOW_ENTRY_LENGTH) return false;
  return ALLOW_NAME_RE.test(e) || ALLOW_IPV6_RE.test(e);
}

/**
 * Normalised operator allowlist for `allowHosts`: trimmed, lower-cased,
 * trailing dot removed, invalid entries dropped, duplicates removed, sorted
 * (code-unit order), so the same configuration always gives the same list.
 */
export function normaliseEndpointAllowlist(entries: Iterable<unknown>): string[] {
  const out = new Set<string>();
  for (const raw of entries) {
    if (typeof raw !== 'string' || !isValidEndpointAllowEntry(raw)) continue;
    out.add(raw.trim().toLowerCase().replace(/\.$/, ''));
  }
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function isAllowlisted(host: string, allow: readonly string[]): boolean {
  for (const a of allow) {
    if (a.startsWith('.') ? host.endsWith(a) || host === a.slice(1) : host === a) return true;
  }
  return false;
}

/**
 * Classify a bare host (lower-cased; IPv6 without brackets). Exported for
 * consumers that extract hosts themselves (for example from a Spring
 * `spring.datasource.url` value) and want the same verdict.
 */
export function classifyEndpointHost(host: string, allowHosts: Iterable<string> = []): EndpointClass {
  const h = host.toLowerCase().replace(/\.$/, '');
  const allow = [...allowHosts].map((a) => a.toLowerCase());
  if (allow.length > 0 && isAllowlisted(h, allow)) return 'allowlisted';
  const v4 = parseIpv4(h);
  if (v4) return classifyIpv4(v4);
  if (h.includes(':')) return classifyIpv6(h);
  if (h === 'localhost' || h.endsWith('.localhost')) return 'loopback';
  if (DOCUMENTATION_DOMAINS.some((d) => matchesSuffix(h, d))) return 'documentation';
  const tld = h.slice(h.lastIndexOf('.') + 1);
  if (RESERVED_TLDS.includes(tld)) return 'documentation';
  if (NAMESPACE_HOSTS.has(h)) return 'namespace';
  if (!h.includes('.')) return 'private'; // single-label service name (`db`, `keycloak`)
  if (PRIVATE_SUFFIXES.some((s) => matchesSuffix(h, s))) return 'private';
  return 'public';
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/** Network URL schemes (after an optional `jdbc:` prefix). `file:` and custom app schemes are not endpoints. */
const URL_SCHEMES: ReadonlySet<string> = new Set([
  'http', 'https', 'ftp', 'ftps', 'sftp', 'ws', 'wss', 'ldap', 'ldaps', 'amqp', 'amqps', 'mqtt', 'mqtts',
  'redis', 'rediss', 'mongodb', 'mongodb+srv', 'postgres', 'postgresql', 'mysql', 'mariadb', 'sqlserver',
  'oracle', 'db2', 'h2', 'smtp', 'smtps', 'imap', 'imaps', 'pop3', 'kafka', 'nats', 'grpc', 'grpcs', 'tcp',
  'udp', 'telnet', 'ssh', 'git', 'svn', 'rtsp', 'sip',
]);

// Scheme: a letter then at most 20 scheme characters, optionally preceded by
// `jdbc:`. Remainder: one negated character class (no nested quantifier), so
// the match is linear in the line length.
const URL_RE = /(?<![A-Za-z0-9+.-])((?:jdbc:)?[A-Za-z][A-Za-z0-9+.-]{0,20}):\/\/([^\s"'`<>\\|^]{1,2048})/g;
// Dotted quad, not part of a longer dotted or word token. Fixed-width lookarounds.
const IPV4_RE = /(?<![\w.-])(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?![\w-])(?!\.\d)/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;
const TEMPLATE_CHARS_RE = /[${}%<>()*@]/;
const VERSION_WORD_RE = /version/i;
// `group:artifact:` immediately before a dotted quad (Maven / Gradle coordinate).
const COORDINATE_TAIL_RE = /[A-Za-z][\w.-]{0,100}:[A-Za-z][\w.-]{0,100}:$/;

interface Span { start: number; end: number }

/** #3405: replace URL userinfo (`user:password@`) with `***@` so a hit never echoes a credential. */
export function maskUserinfo(url: string): string {
  const i = url.indexOf('://');
  if (i < 0) return url;
  const start = i + 3;
  let end = url.length;
  for (const sep of ['/', '?', '#']) {
    const j = url.indexOf(sep, start);
    if (j >= 0 && j < end) end = j;
  }
  const at = url.lastIndexOf('@', end - 1);
  if (at < start) return url;
  return `${url.slice(0, start)}***${url.slice(at)}`;
}

function urlHost(rest: string): { host: string; templated: boolean } | null {
  let authority = rest;
  for (const sep of ['/', '?', '#']) {
    const i = authority.indexOf(sep);
    if (i >= 0) authority = authority.slice(0, i);
  }
  if (authority.length === 0) return null;
  // Placeholders keep their braces in the authority (`${DB_HOST:db}`), so the
  // template test runs before the userinfo split (a `${X}@host` would otherwise lose the marker).
  if (TEMPLATE_CHARS_RE.test(authority.replace(/^[^@/]*@(?=[^@]+$)/, ''))) {
    return { host: authority.toLowerCase(), templated: true };
  }
  const at = authority.lastIndexOf('@');
  if (at >= 0) authority = authority.slice(at + 1);
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close < 0) return null;
    return { host: authority.slice(1, close).toLowerCase(), templated: false };
  }
  const colon = authority.indexOf(':');
  const host = (colon >= 0 ? authority.slice(0, colon) : authority).toLowerCase().replace(/\.$/, '');
  if (host.length === 0) return null;
  if (!/^[a-z0-9._-]+$/.test(host)) return { host, templated: true };
  return { host, templated: false };
}

/**
 * Scan text for hard-coded IPv4 literals and network URLs. Returns every hit
 * in (line, column) order with its classification; filter on `reportable`
 * for the hard-coded endpoint count. An IPv4 literal inside a URL is
 * reported once, as the URL.
 */
export function scanEndpoints(content: string, opts: ScanEndpointsOptions = {}): EndpointHit[] {
  const allow = [...(opts.allowHosts ?? [])].map((a) => a.toLowerCase());
  const maxHits = opts.maxHits ?? Number.POSITIVE_INFINITY;
  const maxLine = opts.maxLineLength ?? MAX_SCANNED_LINE_LENGTH;
  const skipComments = opts.skipCommentLines ?? true;
  const hits: EndpointHit[] = [];
  const lines = content.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    if (hits.length >= maxHits) break;
    const text = lines[li] ?? '';
    if (text.length === 0 || text.length > maxLine) continue;
    if (skipComments && isCommentOnlyLine(text)) continue;
    const lineHits: EndpointHit[] = [];
    const urlSpans: Span[] = [];

    if (text.includes('://')) {
      URL_RE.lastIndex = 0;
      for (let m = URL_RE.exec(text); m !== null; m = URL_RE.exec(text)) {
        const rawScheme = (m[1] ?? '').toLowerCase();
        const baseScheme = rawScheme.startsWith('jdbc:') ? rawScheme.slice(5) : rawScheme;
        if (!URL_SCHEMES.has(baseScheme)) continue;
        const value = m[0].replace(TRAILING_PUNCT_RE, '');
        const rest = value.slice(rawScheme.length + 3);
        const parsed = urlHost(rest);
        if (!parsed) continue;
        urlSpans.push({ start: m.index, end: m.index + m[0].length });
        const classification: EndpointClass = parsed.templated ? 'templated' : classifyEndpointHost(parsed.host, allow);
        lineHits.push({
          kind: 'url',
          value: maskUserinfo(value).slice(0, MAX_VALUE_LENGTH), // #3405: never echo credentials
          host: parsed.host.slice(0, MAX_VALUE_LENGTH),
          scheme: rawScheme,
          line: li + 1,
          column: m.index + 1,
          classification,
          reportable: REPORTABLE_ENDPOINT_CLASSES.has(classification),
        });
      }
    }

    if (/\d\.\d/.test(text)) {
      const versionLine = VERSION_WORD_RE.test(text);
      IPV4_RE.lastIndex = 0;
      for (let m = IPV4_RE.exec(text); m !== null; m = IPV4_RE.exec(text)) {
        const start = m.index;
        if (urlSpans.some((s) => start >= s.start && start < s.end)) continue;
        const literal = m[1] ?? '';
        const octets = parseIpv4(literal);
        if (!octets) continue;
        const before = text.slice(Math.max(0, start - 202), start);
        let classification: EndpointClass;
        if (versionLine || COORDINATE_TAIL_RE.test(before)) classification = 'version_like';
        else if (allow.length > 0 && isAllowlisted(literal, allow)) classification = 'allowlisted';
        else classification = classifyIpv4(octets);
        lineHits.push({
          kind: 'ipv4',
          value: literal,
          host: literal,
          scheme: null,
          line: li + 1,
          column: start + 1,
          classification,
          reportable: REPORTABLE_ENDPOINT_CLASSES.has(classification),
        });
      }
    }

    lineHits.sort((a, b) => a.column - b.column);
    for (const h of lineHits) {
      if (hits.length >= maxHits) break;
      hits.push(h);
    }
  }
  return hits;
}

/** Reportable hits only (`public` and `private`). */
export function scanReportableEndpoints(content: string, opts: ScanEndpointsOptions = {}): EndpointHit[] {
  return scanEndpoints(content, opts).filter((h) => h.reportable);
}

/** `file:line` evidence string for a hit (`rel` is the source-scope relative path). */
export function endpointEvidence(rel: string, hit: Pick<EndpointHit, 'line'>): string {
  return `${rel}:${hit.line}`;
}
