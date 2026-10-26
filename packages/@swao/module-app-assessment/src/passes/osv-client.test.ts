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

// #3420: OSV client. Network is always mocked (vi.stubGlobal('fetch')).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  compareVersions, lookupOsv, osvAffects, OSV_BATCH_SIZE, OSV_DETAIL_CAP, OSV_QUERY_CAP, selectOsvFetch,
  type OsvQuery, type OsvVulnRecord,
} from './osv-client.js';

const ENV_KEYS = ['SWAO_OSV_BASE_URL', 'SWAO_OSV_OFFLINE', 'SWAO_OSV_DB_PATH'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

const LOG4J: OsvQuery = { ecosystem: 'Maven', name: 'org.apache.logging.log4j:log4j-core', version: '2.14.1' };

const LOG4SHELL: OsvVulnRecord = {
  id: 'GHSA-jfh8-c2jp-5v3q',
  database_specific: { severity: 'CRITICAL' },
  affected: [{
    package: { ecosystem: 'Maven', name: 'org.apache.logging.log4j:log4j-core' },
    ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '2.0-beta9' }, { fixed: '2.15.0' }] }],
  }],
};

describe('#3420 version ordering and affected ranges', () => {
  it('orders Maven-style versions', () => {
    expect(compareVersions('2.14.1', '2.15.0')).toBe(-1);
    expect(compareVersions('2.15.0', '2.15.0')).toBe(0);
    expect(compareVersions('2.0-beta9', '2.0')).toBe(-1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0-rc1', '1.0')).toBe(-1);
    expect(compareVersions('1.0.1', '1.0-rc1')).toBe(1);
    expect(compareVersions('32.1.3-jre', '32.0.0-jre')).toBe(1);
    expect(compareVersions('10.0', '9.9')).toBe(1);
  });

  it('evaluates introduced / fixed / last_affected events and explicit versions', () => {
    expect(osvAffects(LOG4SHELL, LOG4J)).toBe(true);
    expect(osvAffects(LOG4SHELL, { ...LOG4J, version: '2.15.0' })).toBe(false);
    expect(osvAffects(LOG4SHELL, { ...LOG4J, version: '1.2.17' })).toBe(false);
    expect(osvAffects(LOG4SHELL, { ...LOG4J, name: 'other:artifact' })).toBe(false);
    const lastAffected: OsvVulnRecord = {
      id: 'X', affected: [{ package: { ecosystem: 'Maven', name: 'g:a' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { last_affected: '1.2.0' }] }], versions: ['9.9.9'] }],
    };
    expect(osvAffects(lastAffected, { ecosystem: 'Maven', name: 'g:a', version: '1.2.0' })).toBe(true);
    expect(osvAffects(lastAffected, { ecosystem: 'Maven', name: 'g:a', version: '1.2.1' })).toBe(false);
    expect(osvAffects(lastAffected, { ecosystem: 'Maven', name: 'g:a', version: '9.9.9' })).toBe(true);
  });
});

describe('#3420 online lookup', () => {
  it('sends one querybatch with ecosystem Maven, then fetches the full record for severity', async () => {
    process.env['SWAO_OSV_BASE_URL'] = 'https://osv.mirror.example/';
    const calls: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/v1/querybatch')) return jsonResponse({ results: [{ vulns: [{ id: LOG4SHELL.id, modified: 'x' }] }, {}] });
      if (url.endsWith(`/v1/vulns/${LOG4SHELL.id}`)) return jsonResponse(LOG4SHELL);
      return jsonResponse({}, false);
    }));
    const r = await lookupOsv([LOG4J, { ecosystem: 'npm', name: 'express', version: '4.21.0' }]);
    expect(r.mode).toBe('online');
    expect(r.available).toBe(true);
    expect(calls[0]!.url).toBe('https://osv.mirror.example/v1/querybatch');
    expect(calls[0]!.body).toEqual({
      queries: [
        { version: '2.14.1', package: { name: 'org.apache.logging.log4j:log4j-core', ecosystem: 'Maven' } },
        { version: '4.21.0', package: { name: 'express', ecosystem: 'npm' } },
      ],
    });
    expect(calls.filter((c) => c.url.endsWith('/v1/querybatch'))).toHaveLength(1);
    expect(r.perQuery[0]![0]!.database_specific?.severity).toBe('CRITICAL');
    expect(r.perQuery[1]).toEqual([]);
    expect(r.detailsFetched).toBe(1);
  });

  it('chunks at OSV_BATCH_SIZE and truncates at OSV_QUERY_CAP', async () => {
    const batchSizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const n = (JSON.parse(String(init!.body)) as { queries: unknown[] }).queries.length;
      batchSizes.push(n);
      return jsonResponse({ results: Array.from({ length: n }, () => ({})) });
    }));
    const queries = Array.from({ length: OSV_QUERY_CAP + 5 }, (_, i): OsvQuery => ({ ecosystem: 'Maven', name: `g:a${i}`, version: '1.0.0' }));
    const r = await lookupOsv(queries);
    expect(batchSizes).toEqual([OSV_BATCH_SIZE, OSV_QUERY_CAP - OSV_BATCH_SIZE]);
    expect(r.queried).toBe(OSV_QUERY_CAP);
    expect(r.truncated).toBe(5);
  });

  it('caps the detail fetches at OSV_DETAIL_CAP; ids beyond the cap keep the id only', async () => {
    const ids = Array.from({ length: OSV_DETAIL_CAP + 3 }, (_, i) => `GHSA-${i}`);
    let detailCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/v1/querybatch')) return jsonResponse({ results: [{ vulns: ids.map((id) => ({ id })) }] });
      detailCalls++;
      return jsonResponse({ id: decodeURIComponent(url.split('/').pop()!), database_specific: { severity: 'LOW' } });
    }));
    const r = await lookupOsv([LOG4J]);
    expect(detailCalls).toBe(OSV_DETAIL_CAP);
    expect(r.detailsCapped).toBe(true);
    expect(r.perQuery[0]).toHaveLength(OSV_DETAIL_CAP + 3);
  });

  it('hydrates round-robin so one package with many advisories cannot starve the others', async () => {
    const many = Array.from({ length: OSV_DETAIL_CAP + 10 }, (_, i) => ({ id: `JACKSON-${i}` }));
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/v1/querybatch')) return jsonResponse({ results: [{ vulns: many }, { vulns: [{ id: LOG4SHELL.id }] }] });
      const id = decodeURIComponent(url.split('/').pop()!);
      fetched.push(id);
      return jsonResponse(id === LOG4SHELL.id ? LOG4SHELL : { id });
    }));
    const r = await lookupOsv([{ ecosystem: 'Maven', name: 'com.fasterxml.jackson.core:jackson-databind', version: '2.9.0' }, LOG4J]);
    expect(fetched).toContain(LOG4SHELL.id);
    expect(r.perQuery[1]![0]!.database_specific?.severity).toBe('CRITICAL');
  });

  it('reports unavailable (never throws) when the API is unreachable or answers garbage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const down = await lookupOsv([LOG4J]);
    expect(down.available).toBe(false);
    expect(down.reason).toMatch(/unreachable/);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ unexpected: true })));
    expect((await lookupOsv([LOG4J])).available).toBe(false);
  });

  it('skips without a network call in offline mode when no database is configured', async () => {
    process.env['SWAO_OSV_OFFLINE'] = 'true';
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await lookupOsv([LOG4J]);
    expect(r.mode).toBe('skipped');
    expect(r.reason).toMatch(/SWAO_OSV_OFFLINE/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('#3420 offline database', () => {
  it('matches a local OSV JSON database without any network call (offline flag irrelevant)', async () => {
    process.env['SWAO_OSV_OFFLINE'] = 'true';
    const dir = mkdtempSync(join(tmpdir(), 'swao-osvdb-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'maven.json'), JSON.stringify({ vulns: [LOG4SHELL, { id: 'OTHER', affected: [{ package: { ecosystem: 'npm', name: 'left-pad' } }] }] }));
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await lookupOsv([LOG4J, { ...LOG4J, version: '2.17.1' }], { dbPath: dir });
    expect(f).not.toHaveBeenCalled();
    expect(r.mode).toBe('offline_db');
    expect(r.available).toBe(true);
    expect(r.dbFiles).toEqual(['maven.json']);
    expect(r.perQuery[0]!.map((v) => v.id)).toEqual([LOG4SHELL.id]);
    expect(r.perQuery[1]).toEqual([]);
  });
});

// #3420 / #3369: OSV honours the corporate proxy.
describe('selectOsvFetch (#3369 proxy)', () => {
  it('uses the proxy-aware fetch when HTTPS_PROXY is set', () => {
    expect(selectOsvFetch({ HTTPS_PROXY: 'http://proxy.example.internal:3128' }).kind).toBe('proxy');
    expect(selectOsvFetch({ http_proxy: 'http://proxy.example.internal:3128' }).kind).toBe('proxy');
  });

  it('uses the global fetch without a proxy variable', () => {
    expect(selectOsvFetch({}).kind).toBe('global');
    expect(selectOsvFetch({ HTTPS_PROXY: '  ' }).kind).toBe('global');
  });
});
