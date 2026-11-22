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

// #3970: the optional `listServiceResources` collector. The scan assembler
// appends its resources to `estate.resources` (same privacy filter as the
// main inventory); a denied read is a not_collected source and keeps the main
// inventory; `omitLzCollectors` drops it for recordings that predate it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';
import type { LzLiveScan } from '@swao/core';
import { runLzLiveScan } from '../scan.js';
import { LiveSourceUnavailableError } from '../errors.js';
import { omitLzCollectors, registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { VERIFIED, makeFakeDriver, makeTransport } from './fake-driver.js';

describe('scan assembler appends listServiceResources (#3970)', () => {
  const tmp: string[] = [];
  const dir = (p: string): string => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };
  beforeEach(() => unregisterLiveLzDriver());
  afterEach(() => { unregisterLiveLzDriver(); for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

  async function run(): Promise<LzLiveScan> {
    const ws = dir('swao-svcres-ws-');
    writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: fake-prod', '    provider: fakecsp', '    scopes:', '      - id: platform', '        kind: platform', '        auth: aksk', '        regions: [eu-de]', ''].join('\n'));
    const store = new CredentialStore(dir('swao-svcres-vault-'));
    await store.set('lz:fake-prod:platform:access-key-id', ['fake', 'ak'].join('-'));
    await store.set('lz:fake-prod:platform:secret-access-key', ['fake', 'sk'].join('-'));
    const out = await runLzLiveScan({ workspaceRoot: ws, lzId: 'fake-prod', store, env: {}, fetchImpl: makeTransport([]) });
    return out.results[0]!.scan!;
  }

  const base = makeFakeDriver(VERIFIED);
  const withService = makeFakeDriver(VERIFIED, {
    listServiceResources: async () => [{ id: 'bucket-1', type: 'obs.bucket', service_code: 'obs', region: 'eu-de', tags: { owner: 'someone@example.com' } }],
  });

  it('the resources follow the main inventory, people in tags pseudonymised, source ok', async () => {
    const baseCount = await (async () => { registerLiveLzDriver(base); const s = await run(); unregisterLiveLzDriver(); return s.estate.resources.length; })();
    registerLiveLzDriver(withService);
    const s = await run();
    expect(s.estate.resources).toHaveLength(baseCount + 1);
    expect(s.estate.resources.at(-1)).toMatchObject({ id: 'bucket-1', type: 'obs.bucket', tags: { owner: expect.stringMatching(/^Person-[0-9a-f]{10}$/) } });
    expect(JSON.stringify(s)).not.toContain('example.com');
    expect(s.meta.sources).toContainEqual({ name: 'inventory:service-resources', status: 'ok' });
  });

  it('a denied read is a not_collected source and keeps the main inventory', async () => {
    registerLiveLzDriver(base);
    const n = (await run()).estate.resources.length;
    unregisterLiveLzDriver();
    registerLiveLzDriver(makeFakeDriver(VERIFIED, { listServiceResources: async () => { throw new LiveSourceUnavailableError('inventory:service-resources', 403); } }));
    const s = await run();
    expect(s.estate.resources).toHaveLength(n);
    expect(s.meta.sources).toContainEqual({ name: 'inventory:service-resources', status: 'not_collected', http_status: 403 });
  });

  it('omitLzCollectors drops the collector without changing the driver', () => {
    const stripped = omitLzCollectors(withService, ['listServiceResources']);
    expect(stripped.listServiceResources).toBeUndefined();
    expect(withService.listServiceResources).toBeTypeOf('function');
  });

  it('omitting listServiceResources also puts listPostureWithoutServiceResources in place of listPosture (unless the posture is omitted too)', () => {
    const full = async () => ({});
    const without = async () => ({});
    const d = makeFakeDriver(VERIFIED, { listServiceResources: async () => [], listPosture: full, listPostureWithoutServiceResources: without });
    const a = omitLzCollectors(d, ['listServiceResources']);
    expect(a.listPosture).toBe(without);
    expect(a.listPostureWithoutServiceResources).toBeUndefined();
    expect(omitLzCollectors(d, ['listPosture', 'listServiceResources']).listPosture).toBeUndefined();
    expect(omitLzCollectors(d, ['listHierarchy']).listPosture).toBe(full);
    expect(d.listPosture).toBe(full);
  });
});
