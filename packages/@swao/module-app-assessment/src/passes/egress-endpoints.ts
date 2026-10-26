// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3422: hard-coded egress endpoints in JVM source and Spring configuration
// for Pass 07. URLs and IPv4 literals come from the shared endpoint scanner
// (#3405, @swao/core scanEndpoints, Design 117 section 3); this module only
// adds the two forms the scanner cannot see because they carry no `://`:
// Kafka bootstrap server lists (`host:9092,host2:9092`) and Oracle thin JDBC
// URLs (`jdbc:oracle:thin:@host:1521:SID`). Their hosts are classified with
// the scanner's classifyEndpointHost, so every hit shares one verdict.
// Each hit is attributed to the HTTP client or configuration key it sits in
// (RestTemplate, WebClient, Feign, OkHttp, JDK HttpClient; `spring.datasource.url`).
// All regexes are linear (bounded quantifiers, negated classes).

import { readFileSync } from 'fs';
import {
  scanEndpoints,
  classifyEndpointHost,
  isEndpointScanCandidate,
  REPORTABLE_ENDPOINT_CLASSES,
  type EndpointClass,
  type SourceFile,
} from '@swao/core';
import { isScannableFile, pathClassOf, type PathClass, type ClassCounts } from './catalogue-matcher.js';
import { configKeysPerLine, isJvmCodeFile, isPropertiesFile, isSpringConfigFile } from './jvm-source-patterns.js';

/** What kind of connection an endpoint is. */
export type EndpointChannel = 'http' | 'database' | 'messaging' | 'cache' | 'directory' | 'mail' | 'network';

export interface EndpointLocation {
  file: string;
  line: number;
  path_class: PathClass;
  /** HTTP client or configuration key the literal sits in, when recognised. */
  via?: string;
}

export interface EndpointHostRecord {
  host: string;
  classification: 'public' | 'private';
  channels: EndpointChannel[];
  /** Distinct clients / configuration keys, sorted. */
  via: string[];
  total: number;
  byClass: ClassCounts;
  /** Locations, production first, capped at MAX_LOCATIONS_PER_HOST. */
  locations: EndpointLocation[];
}

export interface EndpointScanResult {
  hosts: EndpointHostRecord[];
  filesScanned: number;
}

export const MAX_LOCATIONS_PER_HOST = 20;

/** True for the files the JVM egress endpoint scan reads: JVM code, Spring configuration, any `.properties`. */
export function isEgressEndpointFile(f: SourceFile): boolean {
  if (!isEndpointScanCandidate(f)) return false;
  return isJvmCodeFile(f) || isSpringConfigFile(f) || isPropertiesFile(f);
}

// Client markers, tested on the hit line and the two lines above it (a
// builder chain or an annotation often sits one line up).
const CLIENT_MARKERS: ReadonlyArray<{ re: RegExp; via: string }> = [
  { re: /@FeignClient\b/, via: 'Feign' },
  { re: /\bWebClient\b|\.baseUrl\(/, via: 'WebClient' },
  { re: /\bRestClient\b/, via: 'RestClient' },
  { re: /\bRestTemplate\b|\brestTemplate\b|\.(?:getForObject|getForEntity|postForObject|postForEntity)\(/, via: 'RestTemplate' },
  { re: /\bOkHttpClient\b|\bRequest\.Builder\b|\bHttpUrl\b/, via: 'OkHttp' },
  { re: /\bHttpClient\b|\bHttpRequest\b/, via: 'JDK HttpClient' },
  { re: /\bHttpURLConnection\b|\bnew URL\(|\bURI\.create\(/, via: 'java.net' },
  { re: /\bDriverManager\.getConnection\(|\bDataSource\b|\bsetJdbcUrl\(|\bsetUrl\(/, via: 'JDBC' },
];

// `bootstrap-servers`, `bootstrap.servers`, `BOOTSTRAP_SERVERS_CONFIG`: the
// value is a comma-separated host:port list without a scheme.
const KAFKA_BOOTSTRAP_RE = /bootstrap[._-]?servers(?:_config)?["']?[ \t]{0,10}[,:=][ \t]{0,10}["']?([^"'\s#]{1,1000})/i;
const KAFKA_KEY_RE = /bootstrap[._-]?servers/i;
// Oracle thin driver: jdbc:oracle:thin:@host:1521:SID or @//host:1521/service.
const ORACLE_THIN_RE = /jdbc:oracle:thin:@(?:\/\/)?([A-Za-z0-9._-]{1,253})/gi;
// #3485: MySQL / MariaDB / PostgreSQL URL authority with an optional MySQL
// protocol (replication, loadbalance, ...). The authority is one negated class.
const JDBC_MULTI_HOST_RE = /\bjdbc:(?:mysql|mariadb|postgresql)(?::[a-z]{1,20})?:\/\/([^\s/"'?;#]{1,1000})/gi;
const HOST_PORT_ITEM_RE =/^(?:[A-Za-z_]{1,20}:\/\/)?([A-Za-z0-9._-]{1,253})(?::\d{1,5})?$/;

function channelFor(scheme: string | null): EndpointChannel {
  if (scheme === null) return 'network';
  const s = scheme.startsWith('jdbc:') ? 'database' : scheme;
  switch (s) {
    case 'database': case 'postgres': case 'postgresql': case 'mysql': case 'mariadb': case 'sqlserver':
    case 'oracle': case 'db2': case 'h2': case 'mongodb': case 'mongodb+srv':
      return 'database';
    case 'kafka': case 'amqp': case 'amqps': case 'mqtt': case 'mqtts': case 'nats':
      return 'messaging';
    case 'redis': case 'rediss':
      return 'cache';
    case 'ldap': case 'ldaps':
      return 'directory';
    case 'smtp': case 'smtps': case 'imap': case 'imaps': case 'pop3':
      return 'mail';
    case 'http': case 'https': case 'ws': case 'wss': case 'grpc': case 'grpcs':
      return 'http';
    default:
      return 'network';
  }
}

function clientFor(lines: readonly string[], idx: number): string | undefined {
  // The line above counts only when the hit line continues it: a builder
  // chain (`.baseUrl(...)`) or an argument list left open (`(` or `,`).
  for (let j = idx; j >= Math.max(0, idx - 2); j--) {
    const l = lines[j] ?? '';
    for (const m of CLIENT_MARKERS) if (m.re.test(l)) return m.via;
    const continues = (lines[j] ?? '').trimStart().startsWith('.') || /[(,]\s*$/.test(lines[j - 1] ?? '');
    if (!continues) break;
  }
  return undefined;
}

interface RawHit { host: string; classification: EndpointClass; channel: EndpointChannel; line: number }

/** Kafka bootstrap lists and Oracle thin URLs on one line (the scanner covers the rest). */
function extraHits(text: string, lineNo: number, inKafkaList: boolean): RawHit[] {
  const out: RawHit[] = [];
  const items: string[] = [];
  const kafka = KAFKA_BOOTSTRAP_RE.exec(text);
  if (kafka) items.push(...(kafka[1] ?? '').replace(/^\[|\]$/g, '').split(','));
  else if (inKafkaList) {
    const li = /^\s*-\s*["']?([^"'\s#]{1,300})/.exec(text);
    if (li) items.push(li[1] ?? '');
  }
  for (const raw of items) {
    const item = raw.trim().replace(/^["']|["']$/g, '');
    if (item.length === 0 || item.includes('$') || item.includes('{')) continue; // placeholder: externalised
    const m = HOST_PORT_ITEM_RE.exec(item);
    if (!m || !m[1]) continue;
    out.push({ host: m[1].toLowerCase(), classification: classifyEndpointHost(m[1]), channel: 'messaging', line: lineNo });
  }
  // #3485: multi-host MySQL / MariaDB / PostgreSQL URLs (`jdbc:mysql://h1:3306,h2:3306/db`,
  // also `jdbc:mysql:replication://` and `:loadbalance://`, which the shared
  // scanner does not read). Every host is reported; the first one is
  // deduplicated against the scanner hit by host and line.
  if (text.includes('jdbc:')) {
    JDBC_MULTI_HOST_RE.lastIndex = 0;
    for (let m = JDBC_MULTI_HOST_RE.exec(text); m !== null; m = JDBC_MULTI_HOST_RE.exec(text)) {
      // Userinfo (`user:pass@`) precedes the host list and may itself contain commas.
      const authority = m[1] ?? '';
      for (const raw of authority.slice(authority.lastIndexOf('@') + 1).split(',')) {
        const item = raw.trim();
        if (item.length === 0 || item.includes('$') || item.includes('{') || item.startsWith('[')) continue;
        const hp = HOST_PORT_ITEM_RE.exec(item);
        if (!hp || !hp[1]) continue;
        out.push({ host: hp[1].toLowerCase(), classification: classifyEndpointHost(hp[1]), channel: 'database', line: lineNo });
      }
    }
  }
  if (text.toLowerCase().includes('jdbc:oracle:thin:@')) {
    ORACLE_THIN_RE.lastIndex = 0;
    for (let m = ORACLE_THIN_RE.exec(text); m !== null; m = ORACLE_THIN_RE.exec(text)) {
      const host = (m[1] ?? '').toLowerCase();
      if (host.length === 0) continue;
      out.push({ host, classification: classifyEndpointHost(host), channel: 'database', line: lineNo });
    }
  }
  return out;
}

function readText(f: SourceFile): string | null {
  try { return readFileSync(f.abs, 'utf-8'); } catch { return null; }
}

/**
 * Scan the given files (already listed through the source scope) for
 * reportable hard-coded endpoints. `skipHost` drops hosts another detector
 * already reports (the egress and sovereign service catalogues).
 */
export function collectEgressEndpoints(files: readonly SourceFile[], skipHost: (host: string) => boolean = () => false): EndpointScanResult {
  const byHost = new Map<string, EndpointHostRecord & { all: EndpointLocation[] }>();
  let filesScanned = 0;
  for (const f of files) {
    if (!isEgressEndpointFile(f) || !isScannableFile(f)) continue;
    const text = readText(f);
    if (text === null) continue;
    filesScanned++;
    const lines = text.split(/\r?\n/);
    const keys = configKeysPerLine(f, lines);
    const code = isJvmCodeFile(f);
    const raw: RawHit[] = scanEndpoints(text).map((h) => ({ host: h.host, classification: h.classification, channel: channelFor(h.scheme), line: h.line }));
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] ?? '';
      if (l.length === 0 || l.length > 4000 || /^\s*(?:#|!|\/\/|\*|\/\*)/.test(l)) continue;
      const key = keys[i];
      const inKafkaList = !code && key !== null && key !== undefined && KAFKA_KEY_RE.test(key) && /^\s*-/.test(l);
      raw.push(...extraHits(l, i + 1, inKafkaList));
    }
    const seen = new Set<string>();
    const pathClass = pathClassOf(f);
    for (const h of raw) {
      if (!REPORTABLE_ENDPOINT_CLASSES.has(h.classification)) continue;
      if (skipHost(h.host)) continue;
      const dedupe = `${h.host}|${h.line}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const via = code ? clientFor(lines, h.line - 1) : (keys[h.line - 1] ?? undefined);
      let rec = byHost.get(h.host);
      if (!rec) {
        rec = {
          host: h.host,
          classification: h.classification === 'public' ? 'public' : 'private',
          channels: [], via: [], total: 0, byClass: { prod: 0, test: 0, unknown: 0 }, locations: [], all: [],
        };
        byHost.set(h.host, rec);
      }
      if (!rec.channels.includes(h.channel)) rec.channels.push(h.channel);
      if (via && !rec.via.includes(via)) rec.via.push(via);
      rec.total++;
      rec.byClass[pathClass]++;
      rec.all.push({ file: f.rel, line: h.line, path_class: pathClass, ...(via ? { via } : {}) });
    }
  }
  const rank: Record<PathClass, number> = { prod: 0, unknown: 1, test: 2 };
  const hosts = [...byHost.values()]
    .map(({ all, ...rec }) => ({
      ...rec,
      channels: [...rec.channels].sort(),
      via: [...rec.via].sort(),
      locations: all
        .map((loc, i) => ({ loc, i }))
        .sort((a, b) => rank[a.loc.path_class] - rank[b.loc.path_class] || a.i - b.i)
        .slice(0, MAX_LOCATIONS_PER_HOST)
        .map((x) => x.loc),
    }))
    .sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  return { hosts, filesScanned };
}

/**
 * True when `host` is one of the catalogued egress or sovereign service
 * domains, in the forms the catalogues use: exact host or subdomain
 * (`s3.amazonaws.com`), `.suffix` (`.okta.com`), `prefix.` (`cognito-idp.`),
 * and `host/path` entries (`gitlab.com/api`, host part compared).
 */
export function hostMatchesCatalogueDomain(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase();
  for (const raw of domains) {
    const d = raw.toLowerCase().split('/')[0] ?? '';
    if (d.length === 0) continue;
    if (d.startsWith('.')) { if (h.endsWith(d) || h === d.slice(1)) return true; continue; }
    if (d.endsWith('.')) { if (h.startsWith(d)) return true; continue; }
    if (h === d || h.endsWith(`.${d}`)) return true;
  }
  return false;
}
