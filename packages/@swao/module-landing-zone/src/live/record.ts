// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3571: recording FetchLike for development runs (Design 120 section 7.1
// amendment, Design 121 section 13.2). Active only when SWAO_LZ_RECORD names a
// directory outside any repository and workspace; writes one directory per
// run, `<dir>/<run-ts>/` with `run.json`, `requests.ndjson` and `bodies/`.
// Request headers, request bodies and credentials are never recorded (OAuth
// token fields of response bodies are redacted, #3576);
// response headers only by allow-listed name, token headers only as presence
// booleans. The format is the contract with the findings agent (#3593);
// `RecordedRequestSchema` / `validateRecordingDir` pin it.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse as parsePath, resolve } from 'node:path';
import { z } from 'zod';
import type { FetchLike, LiveResponse } from './types.js';

export const RECORD_ENV = 'SWAO_LZ_RECORD';

export const RecordedRunSchema = z.object({
  provider: z.string().min(1),
  scope_id: z.string().min(1),
  /** A label such as `operator` or `low-privilege`, never a user name. */
  identity: z.string().regex(/^[a-z][a-z0-9-]*$/),
  started_at: z.string().min(1),
  finished_at: z.string().min(1).nullable(),
  driver_version: z.string().min(1),
}).strict();
export type RecordedRun = z.infer<typeof RecordedRunSchema>;

// Header names that may appear with their value; token headers appear only as
// `<name>-present: true`.
const VALUE_HEADERS = ['retry-after', 'link'];
const RATE_LIMIT_HEADER_RE = /^(x-)?rate-?limit-[a-z-]+$/;
const PRESENCE_HEADERS = ['x-subject-token', 'x-auth-token', 'x-amz-security-token'];

export const RecordedRequestSchema = z.object({
  seq: z.number().int().positive(),
  ts: z.string().min(1),
  provider: z.string().min(1),
  scope_id: z.string().min(1),
  identity: z.string().min(1),
  region: z.string().min(1).nullable(),
  method: z.enum(['GET', 'HEAD', 'POST']),
  /** Path with ids replaced by `{name}` placeholders. */
  route: z.string().startsWith('/'),
  query_keys: z.array(z.string()),
  /** #3574: operation name of RPC-style APIs (AWS `Action` query value or
   *  `X-Amz-Target` request header suffix); never a credential. Absent for
   *  REST routes, where `route` already names the call. */
  operation: z.string().min(1).optional(),
  status: z.number().int().min(100).max(599),
  content_type: z.string().nullable(),
  duration_ms: z.number().nonnegative(),
  pagination: z.object({ kind: z.string().min(1), has_next: z.boolean() }).strict().nullable(),
  body_ref: z.string().regex(/^bodies\/\d+\.[a-z]+$/).nullable(),
  error_code: z.string().nullable(),
  response_headers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).superRefine((h, ctx) => {
    for (const [k, v] of Object.entries(h)) {
      const allowed = VALUE_HEADERS.includes(k) || RATE_LIMIT_HEADER_RE.test(k) || (k.endsWith('-present') && typeof v === 'boolean');
      if (!allowed) ctx.addIssue({ code: 'custom', path: [k], message: `response header ${k} is not on the recording allow-list` });
    }
  }),
}).strict();
export type RecordedRequest = z.infer<typeof RecordedRequestSchema>;

export class RecordingLocationError extends Error {
  readonly exitCode = 2;
  constructor(dir: string, why: string) {
    super(`[lz live] ${RECORD_ENV}=${dir} refused: ${why}. Recordings may hold tenant data and must stay outside every repository and workspace.`);
    this.name = 'RecordingLocationError';
  }
}

/** Refuse a recording root inside a git repository, a SWAO workspace or a WSP. */
export function assertRecordingRootAllowed(dir: string): string {
  if (!isAbsolute(dir)) throw new RecordingLocationError(dir, 'the path must be absolute');
  const abs = resolve(dir);
  let cur = abs;
  const root = parsePath(abs).root;
  for (;;) {
    if (cur.split(/[\\/]/).pop() === 'wsp') throw new RecordingLocationError(dir, 'it is inside a WSP');
    if (existsSync(join(cur, '.git'))) throw new RecordingLocationError(dir, `it is inside the repository ${cur}`);
    if (existsSync(join(cur, '.swao.yml'))) throw new RecordingLocationError(dir, `it is inside the SWAO workspace ${cur}`);
    if (cur === root) break;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return abs;
}

const ID_SEGMENT_RES = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^[0-9a-f]{16,}$/i, // hex ids (OTC project / domain ids)
  /^\d+$/, // numeric ids (AWS account ids)
  /^(?=.*\d)[A-Za-z0-9_.:-]{12,}$/, // long mixed ids (arns, resource ids)
];

/** Map a request path to a route template: driver templates first, then generic `{id}`. */
export function routeOf(path: string, templates: readonly string[] = []): string {
  const segs = path.split('/');
  for (const t of templates) {
    const tsegs = t.split('/');
    if (tsegs.length !== segs.length) continue;
    if (tsegs.every((ts, i) => /^\{[a-z_]+\}$/.test(ts) || ts === segs[i])) return t;
  }
  return segs.map((s) => (s !== '' && ID_SEGMENT_RES.some((re) => re.test(s)) ? '{id}' : s)).join('/');
}

/**
 * #3995: the path a route key is built from: the host prefix of `hostPrefixes`
 * (LiveLzDriver.routeHostPrefixes) plus the request path, else the path.
 */
export function routePathOf(url: URL | string, hostPrefixes: Readonly<Record<string, string>> = {}): string {
  const u = typeof url === 'string' ? new URL(url) : url;
  const prefix = Object.prototype.hasOwnProperty.call(hostPrefixes, u.hostname) ? hostPrefixes[u.hostname] : undefined;
  return prefix !== undefined ? `${prefix}${u.pathname}` : u.pathname;
}

function extOf(contentType: string | null): string {
  if (!contentType) return 'bin';
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.startsWith('text/')) return 'txt';
  return 'bin';
}

/**
 * #3576: OAuth token fields of a JSON response body (the STACKIT Key Flow
 * returns the bearer token in the body, not in a header). Their values are
 * replaced before the body is written, so a recording never holds a usable
 * token; the field stays as `"<redacted>"` so the shape is kept for the mocks.
 */
export const REDACTED_BODY_FIELDS: readonly string[] = ['access_token', 'refresh_token', 'id_token', 'accessToken'];

/**
 * #3951: the temporary AK/SK of the OTC IAM answer (`POST
 * /v3.0/OS-CREDENTIAL/securitytokens`: `credential.{access, secret,
 * securitytoken}`). Every field of the nested `credential` object but
 * `expires_at` is replaced.
 */
export const REDACTED_CREDENTIAL_FIELDS: readonly string[] = ['access', 'secret', 'securitytoken'];

/**
 * #3951: elements of an S3-compatible XML error (OBS `SignatureDoesNotMatch`,
 * `InvalidAccessKeyId`) that echo the access key, the signature or the string
 * that was signed, which holds the security token.
 */
export const REDACTED_XML_ELEMENTS: readonly string[] = ['AccessKeyId', 'SignatureProvided', 'StringToSign', 'StringToSignBytes', 'SecurityToken', 'CanonicalRequest'];

function redactXml(body: string): string {
  let out = body;
  for (const el of REDACTED_XML_ELEMENTS) out = out.replace(new RegExp(`<${el}>[\\s\\S]*?</${el}>`, 'g'), `<${el}><redacted></${el}>`);
  return out;
}

export function redactBody(body: string): string {
  if (REDACTED_XML_ELEMENTS.some((e) => body.includes(`<${e}>`))) return redactXml(body);
  const credential = body.includes('"credential"') && REDACTED_CREDENTIAL_FIELDS.some((f) => body.includes(`"${f}"`));
  if (!credential && !REDACTED_BODY_FIELDS.some((f) => body.includes(`"${f}"`))) return body;
  try {
    const j = JSON.parse(body) as unknown;
    if (j === null || typeof j !== 'object' || Array.isArray(j)) return body;
    const out = { ...(j as Record<string, unknown>) };
    for (const f of REDACTED_BODY_FIELDS) if (f in out) out[f] = '<redacted>';
    const c = out['credential'];
    if (c !== null && typeof c === 'object' && !Array.isArray(c)) {
      const cred = { ...(c as Record<string, unknown>) };
      for (const f of REDACTED_CREDENTIAL_FIELDS) if (f in cred) cred[f] = '<redacted>';
      out['credential'] = cred;
    }
    return JSON.stringify(out);
  } catch {
    return body;
  }
}

function errorCodeOf(status: number, body: string): string | null {
  if (status < 400) return null;
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const nested = (j['error'] && typeof j['error'] === 'object') ? j['error'] as Record<string, unknown> : {};
    for (const v of [j['error_code'], j['code'], nested['code'], j['__type'], j['Code']]) {
      if (typeof v === 'string' && v !== '') return v;
    }
  } catch {
    const m = /<Code>([^<]+)<\/Code>/.exec(body);
    if (m) return m[1] as string;
  }
  return null;
}

// #3574: the operation name of an RPC-style request. Request headers are
// never recorded; only the X-Amz-Target value (an operation name such as
// `ResourceGroupsTaggingAPI_20170126.GetResources`) is kept, reduced to the
// operation itself.
function operationOf(u: URL, init?: { headers?: Record<string, string> }): { operation?: string } {
  const target = Object.entries(init?.headers ?? {}).find(([k]) => k.toLowerCase() === 'x-amz-target')?.[1];
  if (target) return { operation: target.slice(target.lastIndexOf('.') + 1) };
  const action = u.searchParams.get('Action');
  return action ? { operation: action } : {};
}

// #3716: a region hook that throws or returns something that is not a plain
// region id never breaks the run or puts another value into the recording.
const REGION_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
function regionFor(regionOf: RecorderOptions['regionOf'], u: URL, init?: { headers?: Record<string, string> }): string | null {
  if (!regionOf) return null;
  try {
    const r = regionOf(u, init);
    return typeof r === 'string' && REGION_ID.test(r) ? r : null;
  } catch {
    return null;
  }
}

function recordHeaders(res: LiveResponse): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const h of VALUE_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) out[h] = v;
  }
  for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset']) {
    const v = res.headers.get(h);
    if (v !== null) out[h] = v;
  }
  for (const h of PRESENCE_HEADERS) {
    if (res.headers.get(h) !== null) out[`${h}-present`] = true;
  }
  return out;
}

function paginationOf(res: LiveResponse): RecordedRequest['pagination'] {
  const link = res.headers.get('link');
  if (link !== null) return { kind: 'link', has_next: /rel="?next"?/.test(link) };
  return null;
}

export interface RecorderOptions {
  root: string;
  provider: string;
  scopeId: string;
  identity: string;
  driverVersion: string;
  routeTemplates?: readonly string[];
  /** #3995: route key prefix per API host (LiveLzDriver.routeHostPrefixes). */
  routeHostPrefixes?: Readonly<Record<string, string>>;
  /**
   * Region of a request, from its URL and request headers (#3716: the AWS
   * SigV4 credential scope); null when the driver cannot tell. Only the
   * returned region is recorded.
   */
  regionOf?: (url: URL, init?: { headers?: Record<string, string> }) => string | null;
  now?: () => Date;
}

export interface Recorder {
  fetch: FetchLike;
  runDir: string;
  finish(): void;
}

/** Wrap `inner` so every response is recorded under `<root>/<run-ts>/`. */
export function createRecordingFetch(inner: FetchLike, opts: RecorderOptions): Recorder {
  const root = assertRecordingRootAllowed(opts.root);
  const now = opts.now ?? (() => new Date());
  const started = now();
  const runDir = join(root, started.toISOString().replace(/[:.]/g, '-'));
  mkdirSync(join(runDir, 'bodies'), { recursive: true });
  const run: RecordedRun = {
    provider: opts.provider,
    scope_id: opts.scopeId,
    identity: opts.identity,
    started_at: started.toISOString(),
    finished_at: null,
    driver_version: opts.driverVersion,
  };
  RecordedRunSchema.parse(run);
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run) + '\n');
  let seq = 0;

  const fetch: FetchLike = async (url, init) => {
    const t0 = Date.now();
    const res = await inner(url, init);
    const body = await res.text();
    seq += 1;
    const u = new URL(url);
    const contentType = res.headers.get('content-type');
    const bodyRef = body === '' ? null : `bodies/${seq}.${extOf(contentType)}`;
    if (bodyRef !== null) writeFileSync(join(runDir, bodyRef), redactBody(body));
    const entry: RecordedRequest = RecordedRequestSchema.parse({
      seq,
      ts: now().toISOString(),
      provider: opts.provider,
      scope_id: opts.scopeId,
      identity: opts.identity,
      region: regionFor(opts.regionOf, u, init),
      method: (init?.method ?? 'GET').toUpperCase(),
      route: routeOf(routePathOf(u, opts.routeHostPrefixes), opts.routeTemplates),
      query_keys: [...new Set(u.searchParams.keys())].sort(),
      ...operationOf(u, init),
      status: res.status,
      content_type: contentType,
      duration_ms: Date.now() - t0,
      pagination: paginationOf(res),
      body_ref: bodyRef,
      error_code: errorCodeOf(res.status, body),
      response_headers: recordHeaders(res),
    });
    appendFileSync(join(runDir, 'requests.ndjson'), JSON.stringify(entry) + '\n');
    return { ok: res.ok, status: res.status, headers: res.headers, text: async () => body };
  };

  return {
    fetch,
    runDir,
    finish: () => {
      writeFileSync(join(runDir, 'run.json'), JSON.stringify({ ...run, finished_at: now().toISOString() }) + '\n');
    },
  };
}

export interface RecordingValidation {
  ok: boolean;
  requests: number;
  errors: string[];
}

/** Validate a recorded run directory against the Design 121 section 13.2 contract. */
export function validateRecordingDir(runDir: string): RecordingValidation {
  const errors: string[] = [];
  const runPath = join(runDir, 'run.json');
  if (!existsSync(runPath)) return { ok: false, requests: 0, errors: ['run.json missing'] };
  const run = RecordedRunSchema.safeParse(JSON.parse(readFileSync(runPath, 'utf-8')));
  if (!run.success) errors.push(`run.json: ${run.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const reqPath = join(runDir, 'requests.ndjson');
  const lines = existsSync(reqPath) ? readFileSync(reqPath, 'utf-8').split('\n').filter((l) => l.trim() !== '') : [];
  lines.forEach((line, i) => {
    const r = RecordedRequestSchema.safeParse(JSON.parse(line));
    if (!r.success) {
      errors.push(`requests.ndjson line ${i + 1}: ${r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
      return;
    }
    if (r.data.body_ref !== null && !existsSync(join(runDir, r.data.body_ref))) errors.push(`requests.ndjson line ${i + 1}: ${r.data.body_ref} missing`);
  });
  const bodies = existsSync(join(runDir, 'bodies')) ? readdirSync(join(runDir, 'bodies')) : [];
  if (bodies.some((b) => !/^\d+\.[a-z]+$/.test(b))) errors.push('bodies/ holds a file that is not <seq>.<ext>');
  return { ok: errors.length === 0, requests: lines.length, errors };
}
