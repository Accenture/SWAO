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

// #4399: `swao lz probe` printed "identity groups: read-only admin, admin,
// read-only refused": the verdict merged into a comma-list identity, and
// "refused" was shown for a login accepted for the run. The verdict now has
// the scope line to itself (the TUI words) and the identity its own line.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, LZ_PROBE_WRITE_CAPABLE_ACCEPTED, parseLzProbeIdentityLine, parseLzProbeScopeLine } from '@swao/core';
import { registerLiveLzDriver, unregisterLiveLzDriver } from '../registry.js';
import { lzProbeAction } from '../cli.js';
import { WRITE_CAPABLE_ACCEPTED_REASON } from '../session.js';
import { makeFakeDriver, makeTransport, REFUSED, VERIFIED } from './fake-driver.js';
import type { WireCall } from './fake-driver.js';

const COMMA_IDENTITY = 'groups: read-only admin, admin';

const tmp: string[] = [];
const tempDir = (prefix: string): string => { const d = mkdtempSync(join(tmpdir(), prefix)); tmp.push(d); return d; };

async function setup(): Promise<{ ws: string; store: CredentialStore; calls: WireCall[] }> {
  const ws = tempDir('swao-lz-probe-line-ws-');
  writeFileSync(join(ws, '.swao.yml'), [
    'name: demo', 'landing_zones:', '  - id: fake-prod', '    provider: fakecsp', '    scopes:',
    '      - id: platform', '        kind: platform', '        auth: aksk', '        regions: [eu-de]', '',
  ].join('\n'));
  const store = new CredentialStore(tempDir('swao-lz-probe-line-vault-'));
  await store.set('lz:fake-prod:platform:access-key-id', ['fake', 'ak'].join('-'));
  await store.set('lz:fake-prod:platform:secret-access-key', ['fake', 'sk'].join('-'));
  return { ws, store, calls: [] };
}

async function probe(flags: Record<string, unknown>, driverProbe = { ...REFUSED, identity: COMMA_IDENTITY }): Promise<{ code: number; out: string[]; err: string[] }> {
  registerLiveLzDriver(makeFakeDriver(driverProbe));
  const h = await setup();
  const out: string[] = [];
  const err: string[] = [];
  const code = await lzProbeAction('fake-prod', flags, { cwd: h.ws, store: h.store, env: {}, fetchImpl: makeTransport(h.calls), out: (l) => out.push(l), err: (l) => err.push(l), guard: { requireFeature: () => undefined } });
  return { code, out, err };
}

beforeEach(() => { unregisterLiveLzDriver(); });
afterEach(() => {
  unregisterLiveLzDriver();
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('#4399 lz probe scope line', () => {
  it('an accepted write-capable login: the verdict says accepted, the comma identity is on its own line', async () => {
    const { code, out } = await probe({ acceptWriteCapableCredentials: true });
    expect(code).toBe(0);
    expect(out[0]).toBe(`scope platform: read-only check: ${LZ_PROBE_WRITE_CAPABLE_ACCEPTED}`);
    expect(out[1]).toBe(`  identity: ${COMMA_IDENTITY}`);
    // The verdict is not part of the identity text, and the identity not part of the verdict.
    expect(parseLzProbeIdentityLine(out[1]!)).toBe(COMMA_IDENTITY);
    expect(out[0]).not.toContain('admin');
    expect(out[0]).not.toContain('refused');
    expect(parseLzProbeScopeLine(out[0]!)).toEqual({ scopeId: 'platform', readOnly: 'refused', accepted: true });
    // The same words as the run manifest read_only_reason name the acceptance.
    expect(WRITE_CAPABLE_ACCEPTED_REASON).toContain('accepted');
  });

  it('without the override the verdict says refused and the run stops', async () => {
    const { code, out } = await probe({});
    expect(code).toBe(1);
    expect(out[0]).toBe('scope platform: read-only check: write-capable, refused (not accepted for this run)');
    expect(parseLzProbeScopeLine(out[0]!)).toEqual({ scopeId: 'platform', readOnly: 'refused', accepted: false });
  });

  it('a verified login reads "read-only"', async () => {
    const { code, out } = await probe({}, VERIFIED);
    expect(code).toBe(0);
    expect(out[0]).toBe('scope platform: read-only check: read-only');
    expect(parseLzProbeScopeLine(out[0]!)?.readOnly).toBe('verified');
  });

  it('the parser still reads the line format before #4399', () => {
    expect(parseLzProbeScopeLine('scope app-a: identity x, y, read-only unverifiable')).toEqual({ scopeId: 'app-a', readOnly: 'unverifiable', accepted: null, identity: 'x, y' });
    expect(parseLzProbeScopeLine('  coverage: 56 readable')).toBeNull();
  });
});
