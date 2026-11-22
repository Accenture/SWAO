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

// #3576: the `stackit` driver replayed against the neutralised recording of
// the live run on the STACKIT test project with the Reader role (2026-11-03).
// The fixtures live at the private repository root
// (`ops/mock-csp-fixtures/stackit/`), outside `swao/`, so the public tree has
// none and these tests skip there; SWAO_STACKIT_FIXTURE_DIR points them at
// another fixture set. The expected summary was taken from the live scan of
// the same run and holds public facts only. The recorded token response is
// redacted, so the replay scope names its project in `.swao.yml` and signs
// with a generated test key.

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialStore, LzLiveScanSchema } from '@swao/core';
import { routeOf, routePathOf, RecordedRequestSchema } from '../../record.js';
import { omitLzCollectors, unregisterLiveLzDriver } from '../../registry.js';
import { registerBuiltInLiveLzDrivers, UNVERIFIED_DRIVERS_ENV } from '../../builtin.js';
import { runLzLiveScan } from '../../scan.js';
import type { FetchLike } from '../../types.js';
import { STACKIT_DATA_ROUTES, stackitDriver } from '../stackit-driver.js';
import { serviceAccountKey } from './stackit-mock.js';

const RUN = '2026-11-03T18-11-13-275Z';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../..');
const FIXTURE_DIR = process.env['SWAO_STACKIT_FIXTURE_DIR'] ?? join(REPO_ROOT, 'ops', 'mock-csp-fixtures', 'stackit', RUN);
const EXPECTED_FILE = join(REPO_ROOT, 'ops', 'mock-csp-fixtures', 'stackit', 'expected', `${RUN}.summary.json`);
const HAVE_FIXTURES = existsSync(join(FIXTURE_DIR, 'requests.ndjson')) && existsSync(EXPECTED_FILE);

interface Expected {
  read_only: string;
  read_only_overrides: string[];
  regions: { id: string; status: string; azs: string[] }[];
  service_enablement: Record<string, Record<string, string>>;
  sources: { name: string; status: string }[];
  resources_total: number;
  resource_types: string[];
  quotas_total: number;
}

/** Serve the recorded responses per method and route template, in recorded order. */
function replay(dir: string): { fetch: FetchLike; unmatched: string[]; methods: Set<string>; unused: () => string[] } {
  const records = readFileSync(join(dir, 'requests.ndjson'), 'utf-8').split(/\r?\n/).filter(Boolean)
    .map((l) => RecordedRequestSchema.parse(JSON.parse(l)));
  const queues = new Map<string, typeof records>();
  for (const r of records) {
    const k = `${r.method} ${r.route}`;
    queues.set(k, [...(queues.get(k) ?? []), r]);
  }
  const unmatched: string[] = [];
  const methods = new Set<string>();
  const fetch: FetchLike = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    methods.add(method);
    // #3995: the recorder's host-aware route key (SQL Server Flex and PostgreSQL Flex v3 share the path).
    const route = routeOf(routePathOf(new URL(url), stackitDriver.routeHostPrefixes), stackitDriver.routeTemplates);
    const r = queues.get(`${method} ${route}`)?.shift();
    if (!r) {
      unmatched.push(`${method} ${route}`);
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{}' };
    }
    const body = r.body_ref ? readFileSync(join(dir, r.body_ref), 'utf-8') : '';
    return { ok: r.status < 400, status: r.status, headers: { get: (n) => (n.toLowerCase() === 'content-type' ? r.content_type : null) }, text: async () => body };
  };
  // #3932: recorded requests the replay never asked for (a shorter walk than live).
  const unused = (): string[] => [...queues.entries()].flatMap(([k, q]) => q.map(() => k));
  return { fetch, unmatched, methods, unused };
}

const tmp: string[] = [];
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function scanFixture(acceptWriteCapableCredentials: boolean, dir: string = FIXTURE_DIR, omit: boolean = true, project: string = 'replay-project', dataReads: boolean = false) {
  // #3867, #3883: the 2026-11-03 recording predates the posture and the
  // hierarchy reads, so the replay runs the driver without `listPosture` and
  // `listHierarchy` (the hierarchy is pinned by stackit-hierarchy.test.ts); the posture is pinned by the mock
  // pack contract tests and was answered by the live Reader run of 2026-11-05
  // (omitLzCollectors, the mechanism of the OTC replay and the conformance run).
  // #3932: the Reader run of 2026-11-06 has both, so it replays the driver with them (omit false).
  // #3970: both recordings predate the data service reads (listServiceResources and their posture part).
  // #3995: a recording with the data service reads (and the SQL Server Flex reads) replays the whole driver.
  registerBuiltInLiveLzDrivers({ [UNVERIFIED_DRIVERS_ENV]: 'stackit' }, [dataReads ? stackitDriver : omitLzCollectors(stackitDriver, omit ? ['listPosture', 'listHierarchy', 'listServiceResources'] : ['listServiceResources'])]);
  const ws = mkdtempSync(join(tmpdir(), 'swao-stackit-replay-ws-'));
  const vault = mkdtempSync(join(tmpdir(), 'swao-stackit-replay-vault-'));
  tmp.push(ws, vault);
  writeFileSync(join(ws, '.swao.yml'), [
    'name: replay',
    'landing_zones:',
    '  - id: stackit-test',
    '    provider: stackit',
    '    scopes:',
    '      - id: platform',
    '        kind: platform',
    '        auth: key-flow',
    '        regions: [eu01, eu02]',
    '        target:',
    `          project: ${project}`,
    '',
  ].join('\n'));
  const store = new CredentialStore(vault);
  await store.set('lz:stackit-test:platform:service-account-key', serviceAccountKey());
  const r = replay(dir);
  const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'stackit-test', store, env: {}, fetchImpl: r.fetch, acceptWriteCapableCredentials });
  return { out, r };
}

describe.skipIf(!HAVE_FIXTURES)('stackit driver replayed on the neutralised Reader run (#3576)', () => {
  const expected = (HAVE_FIXTURES ? JSON.parse(readFileSync(EXPECTED_FILE, 'utf-8')) : {}) as Expected;

  it('reproduces the live scan: probe refused for Reader, regions and AZs, Service Enablement statuses, sources, counts', async () => {
    const { out, r } = await scanFixture(true);
    expect(r.unmatched).toEqual([]);
    expect([...r.methods].sort()).toEqual(['GET', 'POST']);
    expect(out.exitCode).toBe(0);
    const scan = out.results[0]?.scan;
    expect(LzLiveScanSchema.safeParse(scan).success).toBe(true);
    expect(scan?.meta.read_only).toBe(expected.read_only);
    expect(scan?.meta.read_only_overrides).toEqual(expected.read_only_overrides);
    expect(scan?.offering.regions.map((x) => ({ id: x.id, status: x.status, azs: x.azs.map((a) => a.name) }))).toEqual(expected.regions);
    const observed = Object.fromEntries((scan?.offering.services ?? [])
      .filter((s) => s.code.startsWith('cloud.stackit.'))
      .map((s) => [s.code, Object.fromEntries(Object.entries(s.regions).map(([k, v]) => [k, v.status]))]));
    expect(observed).toEqual(expected.service_enablement);
    expect([...(scan?.meta.sources ?? [])].map((x) => ({ name: x.name, status: x.status })).sort((a, b) => a.name.localeCompare(b.name))).toEqual(expected.sources);
    expect(scan?.estate.resources).toHaveLength(expected.resources_total);
    expect([...new Set(scan?.estate.resources.map((x) => x.type))].sort()).toEqual(expected.resource_types);
    expect(scan?.estate.quotas).toHaveLength(expected.quotas_total);
  });

  it('joins the live service ids to catalogue codes (#3790): PostgreSQL Flex and SKE carry their catalogue code and tags', async () => {
    const { out } = await scanFixture(true);
    const services = out.results[0]?.scan?.offering.services ?? [];
    const pg = services.find((s) => s.code === 'cloud.stackit.postgres-flex');
    expect(pg).toMatchObject({ catalogue_code: 'postgresql-flex', capability_tags: ['postgresql'] });
    expect(services.find((s) => s.code === 'cloud.stackit.ske')).toMatchObject({ catalogue_code: 'kubernetes-engine', capability_tags: ['kubernetes'] });
    // no catalogue code appears twice for the same region
    const perRegion = services.filter((s) => s.catalogue_code !== undefined).flatMap((s) => Object.keys(s.regions).map((r) => `${s.catalogue_code}@${r}`));
    expect(new Set(perRegion).size).toBe(perRegion.length);
  });

  it('without --accept-write-capable-credentials the Reader run stops at the gate (exit 1)', async () => {
    const { out } = await scanFixture(false);
    expect(out.exitCode).toBe(1);
    expect(out.results[0]?.gate.manifest.read_only).toBe('refused');
  });
});

// #3932: the live Reader run of 2026-11-06 with the posture reads (#3867) and
// the hierarchy reads (#3883), neutralised with 0 survivors. Expected: the
// summary of its live scan (`swao-mock-csp summary`: read-only result, source
// statuses, resource count; public facts only).
const POSTURE_RUN = '2026-11-06T09-38-05-102Z';
const POSTURE_DIR = join(REPO_ROOT, 'ops', 'mock-csp-fixtures', 'stackit', POSTURE_RUN);
const POSTURE_EXPECTED = join(REPO_ROOT, 'ops', 'mock-csp-fixtures', 'stackit', 'expected', `${POSTURE_RUN}.summary.json`);
const HAVE_POSTURE = existsSync(join(POSTURE_DIR, 'requests.ndjson')) && existsSync(POSTURE_EXPECTED);

describe.skipIf(!HAVE_POSTURE)('stackit driver replayed on the Reader run with the posture and hierarchy reads (#3932)', () => {
  it('replays every recorded request with listPosture and listHierarchy and reproduces the live sources and counts', async () => {
    const expected = JSON.parse(readFileSync(POSTURE_EXPECTED, 'utf-8')) as { read_only: string; sources: { name: string; status: string }[]; resources_total: number };
    // The hierarchy walk starts at the scope project, so the replay names the (neutralised) project of the run.
    const reqs = readFileSync(join(POSTURE_DIR, 'requests.ndjson'), 'utf-8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as { route: string; status: number; body_ref?: string });
    const projects = reqs.find((x) => x.route === '/v2/projects' && x.status === 200);
    const project = String((JSON.parse(readFileSync(join(POSTURE_DIR, projects?.body_ref ?? ''), 'utf-8')) as { items: { projectId: string }[] }).items[0]?.projectId);
    const { out, r } = await scanFixture(true, POSTURE_DIR, false, project);
    expect(r.unused()).toEqual([]);
    expect(r.unmatched).toEqual([]);
    expect(out.exitCode).toBe(0);
    const scan = out.results[0]?.scan;
    expect(LzLiveScanSchema.safeParse(scan).success).toBe(true);
    expect(scan?.meta.read_only).toBe(expected.read_only);
    expect((scan?.meta.sources ?? []).map((x) => ({ name: x.name, status: x.status }))).toEqual(expected.sources);
    expect(scan?.estate.resources).toHaveLength(expected.resources_total);
    expect((scan?.meta.sources ?? []).find((x) => x.name === 'posture')?.status).toBe('ok');
  });
});

// #3995: a neutralised Reader run with the data service reads, SQL Server Flex
// included (for example 2026-11-07T07-59-57-584Z). Not committed (the private
// fixture set lives outside swao/); SWAO_STACKIT_DATA_FIXTURE_DIR names one.
// The replay keys requests like the recorder (host-aware route key), so the
// SQL Server Flex and PostgreSQL Flex lists, which share the path on two
// hosts, each consume their own recorded answers.
const DATA_DIR = process.env['SWAO_STACKIT_DATA_FIXTURE_DIR'] ?? '';
const HAVE_DATA = DATA_DIR !== '' && existsSync(join(DATA_DIR, 'requests.ndjson'));

describe.skipIf(!HAVE_DATA)('stackit driver replayed on a Reader run with the data service reads (#3995)', () => {
  it('replays every recorded request with the whole driver; SQL Server Flex and PostgreSQL Flex keep their own route keys', async () => {
    const reqs = readFileSync(join(DATA_DIR, 'requests.ndjson'), 'utf-8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as { route: string; status: number; body_ref?: string });
    expect(reqs.filter((x) => x.route === STACKIT_DATA_ROUTES.sqlserverInstances).length).toBeGreaterThan(0);
    const projects = reqs.find((x) => x.route === '/v2/projects' && x.status === 200);
    const project = String((JSON.parse(readFileSync(join(DATA_DIR, projects?.body_ref ?? ''), 'utf-8')) as { items: { projectId: string }[] }).items[0]?.projectId);
    const { out, r } = await scanFixture(true, DATA_DIR, false, project, true);
    // The SFS eu02 read ends without an HTTP answer (connection closed, live 2026-11-06 and 2026-11-07); the
    // recorder writes HTTP answers only, so that one request has no recorded entry. Every other request matches.
    expect(r.unmatched.filter((u) => u !== `GET ${STACKIT_DATA_ROUTES.resourcePools}`)).toEqual([]);
    expect(r.unused()).toEqual([]);
    expect(out.exitCode).toBe(0);
    const scan = out.results[0]?.scan;
    expect(LzLiveScanSchema.safeParse(scan).success).toBe(true);
    expect(scan?.estate.posture?.encryption?.source.calls).toEqual(expect.arrayContaining([STACKIT_DATA_ROUTES.sqlserverInstances, STACKIT_DATA_ROUTES.postgresInstances]));
  });
});
