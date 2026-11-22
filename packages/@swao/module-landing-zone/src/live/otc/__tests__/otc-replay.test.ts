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

// #3573: the `otc` driver replayed against the neutralised recording of the
// operator run on the OTC test tenant (Design 121 sections 9.2, 12). The
// fixtures live at the private repository root (`ops/mock-csp-fixtures/otc/`),
// outside `swao/`, so the public tree has no partner-derived data and these
// tests skip there; SWAO_OTC_FIXTURE_DIR points them at another fixture set.
// The expected summary was taken from the live scan of the same run and holds
// public facts only (service codes, statuses, AZ names, counts).

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialStore, LzLiveScanSchema } from '@swao/core';
import { routeOf, RecordedRequestSchema } from '../../record.js';
import { unregisterLiveLzDriver } from '../../registry.js';
import { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } from '../../builtin.js';
import { runLzLiveScan } from '../../scan.js';
import type { FetchLike } from '../../types.js';
import { otcDriver } from '../otc-driver.js';

// #3951 / #3954: the operator run of 2026-11-06 with the posture (#3865, OBS and APIG reads) and hierarchy (#3881) reads.
const RUN = '2026-11-06T13-11-05-203Z';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../..');
const FIXTURE_DIR = process.env['SWAO_OTC_FIXTURE_DIR'] ?? join(REPO_ROOT, 'ops', 'mock-csp-fixtures', 'otc', RUN);
const EXPECTED_FILE = join(REPO_ROOT, 'ops', 'mock-csp-fixtures', 'otc', 'expected', `${RUN}.summary.json`);
const HAVE_FIXTURES = existsSync(join(FIXTURE_DIR, 'requests.ndjson')) && existsSync(EXPECTED_FILE);

interface Expected {
  read_only: string;
  read_only_overrides: string[];
  regions: { id: string; status: string; azs: string[] }[];
  eu_nl_not_offered: string[];
  services: Record<string, Record<string, string>>;
  sources: { name: string; status: string }[];
  resources_total: number;
  resources_by_service: Record<string, number>;
  guardrails: string[];
  activity: { window_days: number; events_total: number; by_kind: Record<string, number> };
}

interface Recorded {
  method: string;
  route: string;
  status: number;
  content_type: string | null;
  body_ref: string | null;
  response_headers: Record<string, string | number | boolean>;
}

/** Serve the recorded responses per method and route template, in recorded order. */
function replay(dir: string): { fetch: FetchLike; calls: { method: string; route: string }[]; unmatched: string[]; remaining: () => number; left: () => string[] } {
  const records = readFileSync(join(dir, 'requests.ndjson'), 'utf-8').split(/\r?\n/).filter(Boolean)
    .map((l) => RecordedRequestSchema.parse(JSON.parse(l)) as Recorded);
  const queues = new Map<string, Recorded[]>();
  for (const r of records) {
    const k = `${r.method} ${r.route}`;
    queues.set(k, [...(queues.get(k) ?? []), r]);
  }
  const calls: { method: string; route: string }[] = [];
  const unmatched: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routeOf(new URL(url).pathname, otcDriver.routeTemplates);
    calls.push({ method, route });
    const r = queues.get(`${method} ${route}`)?.shift();
    if (!r) {
      unmatched.push(`${method} ${route}`);
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{}' };
    }
    const body = r.body_ref ? readFileSync(join(dir, r.body_ref), 'utf-8') : '';
    const headers = new Map<string, string>();
    if (r.content_type) headers.set('content-type', r.content_type);
    if (r.response_headers['x-subject-token-present'] === true) headers.set('x-subject-token', `replay-token-${calls.length}`);
    return { ok: r.status < 400, status: r.status, headers: { get: (n) => headers.get(n.toLowerCase()) ?? null }, text: async () => body };
  };
  return { fetch, calls, unmatched, remaining: () => [...queues.values()].reduce((n, q) => n + q.length, 0), left: () => [...queues].filter(([, q]) => q.length > 0).map(([k, q]) => `${k} x${q.length}`) };
}

/**
 * #3930: the scan without the two parts that may hold native ids: the
 * resource inventory (resource ids embed tenant ids) and the tenant hierarchy
 * (node ids are the native domain and project ids, Design 123 section 5.6).
 */
function outsideIdBearingParts(scan: unknown): unknown {
  const s = scan as { estate?: Record<string, unknown> } | undefined;
  if (s?.estate === undefined) return s;
  const { hierarchy: _hierarchy, ...estate } = s.estate;
  return { ...s, estate: { ...estate, resources: [] } };
}

const tmp: string[] = [];
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function scanFixture(acceptWriteCapableCredentials: boolean) {
  // #3930: the recording has the posture and hierarchy reads, so the replay
  // runs the full driver (no omitted collector).
  registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'otc' });
  const ws = mkdtempSync(join(tmpdir(), 'swao-otc-replay-ws-'));
  const vault = mkdtempSync(join(tmpdir(), 'swao-otc-replay-vault-'));
  tmp.push(ws, vault);
  writeFileSync(join(ws, '.swao.yml'), [
    'name: replay',
    'landing_zones:',
    '  - id: otc-test',
    '    provider: otc',
    '    scopes:',
    '      - id: platform',
    '        kind: platform',
    '        auth: iam-password-token',
    '        regions: [eu-de, eu-nl]',
    '',
  ].join('\n'));
  const store = new CredentialStore(vault);
  for (const f of ['username', 'password', 'domain']) await store.set(`lz:otc-test:platform:${f}`, ['replay', f].join('-'));
  const r = replay(FIXTURE_DIR);
  const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'otc-test', store, env: {}, fetchImpl: r.fetch, acceptWriteCapableCredentials });
  return { out, r };
}

// Full replay scans take several seconds; under full-suite load the default 5 s timed out twice (2026-11-09).
describe.skipIf(!HAVE_FIXTURES)('otc driver on the neutralised operator recording (#3573)', { timeout: 30000 }, () => {
  const expected = HAVE_FIXTURES ? (JSON.parse(readFileSync(EXPECTED_FILE, 'utf-8')) as Expected) : undefined;

  it('reproduces the live scan: regions and AZs, service status per region, sources, estate counts', async () => {
    const { out, r } = await scanFixture(true);
    const e = expected as Expected;
    expect(r.unmatched).toEqual([]);
    expect(r.left()).toEqual([]);
    expect(r.remaining()).toBe(0);
    expect(out.exitCode).toBe(0);
    const scan = out.results[0]?.scan;
    expect(LzLiveScanSchema.safeParse(scan).success).toBe(true);
    expect(scan?.meta.read_only).toBe(e.read_only);
    expect(scan?.meta.read_only_overrides).toEqual(e.read_only_overrides);
    expect(scan?.offering.regions.map((x) => ({ id: x.id, status: x.status, azs: x.azs.map((a) => a.name) }))).toEqual(e.regions);
    const services = Object.fromEntries((scan?.offering.services ?? []).map((s) => [s.code, Object.fromEntries(Object.entries(s.regions).map(([reg, v]) => [reg, v.status]))]));
    expect(services).toEqual(e.services);
    expect(scan?.meta.sources.map((s) => ({ name: s.name, status: s.status }))).toEqual(e.sources);
    expect(scan?.estate.resources).toHaveLength(e.resources_total);
    const byService: Record<string, number> = {};
    for (const x of scan?.estate.resources ?? []) byService[x.service_code] = (byService[x.service_code] ?? 0) + 1;
    expect(Object.fromEntries(Object.entries(byService).sort())).toEqual(e.resources_by_service);
    expect((scan?.estate.guardrails ?? []).map((g) => g.id).sort()).toEqual(e.guardrails);
    expect(scan?.estate.activity_summary).toEqual(e.activity);
  });

  it('carries the 095 AZs and the eu-nl absent-service list (Design 095)', async () => {
    const { out } = await scanFixture(true);
    const e = expected as Expected;
    const azs = (out.results[0]?.scan?.offering.regions ?? []).flatMap((x) => x.azs.map((a) => a.name)).sort();
    expect(azs).toEqual(['eu-de-01', 'eu-de-02', 'eu-de-03', 'eu-nl-01', 'eu-nl-02', 'eu-nl-03']);
    const notOffered = (out.results[0]?.scan?.offering.services ?? []).filter((s) => s.regions['eu-nl']?.status === 'not_offered').map((s) => s.code).sort();
    expect(notOffered).toEqual(e.eu_nl_not_offered);
    expect(notOffered.length).toBeGreaterThan(0);
  });

  it('sends only the token POSTs (IAM token, one temporary AK/SK for OBS, #3951) and GETs, and stops without the override (probe refused on the operator login)', async () => {
    const accepted = await scanFixture(true);
    expect(new Set(accepted.r.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.route}`))).toEqual(new Set(['POST /v3/auth/tokens', 'POST /v3.0/OS-CREDENTIAL/securitytokens']));
    expect(accepted.r.calls.filter((c) => c.route === '/v3.0/OS-CREDENTIAL/securitytokens')).toHaveLength(1);
    const refused = await scanFixture(false);
    expect(refused.out.exitCode).toBe(1);
    expect(refused.out.results[0]?.probe.read_only).toBe('refused');
    expect(refused.out.results[0]?.scan).toBeUndefined();
    expect(refused.r.calls.some((c) => c.route.endsWith('/all-resources'))).toBe(false);
  });

  it('#3930: the id exemption covers estate.resources and estate.hierarchy only; a native id anywhere else is still caught', async () => {
    const { out } = await scanFixture(true);
    const scan = out.results[0]?.scan as Record<string, unknown> & { estate: Record<string, unknown> };
    // The hierarchy holds the native domain and project ids (Design 123 section 5.6), hence the exemption.
    const h = scan.estate['hierarchy'] as { nodes: { id: string; kind: string }[] } | undefined;
    expect(h?.nodes.some((n) => n.kind === 'organisation')).toBe(true);
    const stripped = outsideIdBearingParts(scan) as { estate: Record<string, unknown> };
    expect(stripped.estate['hierarchy']).toBeUndefined();
    expect(stripped.estate['resources']).toEqual([]);
    // Every other estate block is still checked.
    for (const k of Object.keys(scan.estate).filter((k) => k !== 'hierarchy' && k !== 'resources')) expect(stripped.estate[k], k).toEqual(scan.estate[k]);
    expect(Object.keys(stripped).sort()).toEqual(Object.keys(scan).sort());
    const id = h?.nodes[0]?.id as string;
    const planted = { ...scan, estate: { ...scan.estate, posture: { ...(scan.estate['posture'] as object), planted: id } } };
    expect(JSON.stringify(outsideIdBearingParts(planted))).toContain(id);
  });

  // Resource ids in the estate inventory legitimately embed tenant ids (an
  // `iam.users` resource is the user id, a FunctionGraph URN holds the project
  // id); the scan is WSP data and publications strip ids (Design 120 section
  // 6.4, #3587). Everything outside `estate.resources` must hold none, and the
  // domain name and the token user name appear nowhere: resource tags such as
  // `created-by` carry the user name and are pseudonymised by the scan (#3687).
  it('holds no domain or project id outside the resource inventory and no domain or user name anywhere (Design 120 section 6.4)', async () => {
    const { out } = await scanFixture(true);
    const scan = out.results[0]?.scan;
    expect(scan).toBeDefined();
    const full = JSON.stringify(scan);
    const outsideInventory = JSON.stringify(outsideIdBearingParts(scan));
    const ids = new Set<string>();
    const names = new Set<string>();
    const users = new Set<string>();
    for (const line of readFileSync(join(FIXTURE_DIR, 'requests.ndjson'), 'utf-8').split(/\r?\n/).filter(Boolean)) {
      const r = JSON.parse(line) as Recorded;
      if (r.route !== '/v3/auth/tokens' || !r.body_ref) continue;
      const t = (JSON.parse(readFileSync(join(FIXTURE_DIR, r.body_ref), 'utf-8')) as { token?: { project?: { id?: string }; user?: { name?: string; domain?: { id?: string; name?: string } } } }).token;
      for (const v of [t?.project?.id, t?.user?.domain?.id]) if (v) ids.add(v);
      if (t?.user?.domain?.name) names.add(t.user.domain.name);
      if (t?.user?.name) users.add(t.user.name);
    }
    expect(ids.size).toBeGreaterThan(0);
    expect(names.size).toBeGreaterThan(0);
    for (const v of ids) expect(outsideInventory).not.toContain(v);
    for (const v of names) expect(full).not.toContain(v);
    expect(users.size).toBeGreaterThan(0);
    for (const v of users) expect(full, 'token user name in the scan').not.toContain(v);
  });
});
