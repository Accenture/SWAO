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

// #3571 test fixture: a minimal LiveLzDriver whose probe calls the transport,
// so the tests see what reaches the wire.

import type { FetchLike, LiveLzDriver, ReadOnlyProbe, ScopeCtx } from '../types.js';

export interface WireCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export function makeTransport(calls: WireCall[], respond?: (url: string) => { status: number; body: string; headers?: Record<string, string> }): FetchLike {
  return async (url, init) => {
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), headers: init?.headers ?? {} });
    const r = respond?.(url) ?? { status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } };
    const h = new Map(Object.entries(r.headers ?? { 'content-type': 'application/json' }).map(([k, v]) => [k.toLowerCase(), v]));
    return { ok: r.status < 400, status: r.status, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, text: async () => r.body };
  };
}

export function makeFakeDriver(probe: ReadOnlyProbe | ((ctx: ScopeCtx) => Promise<ReadOnlyProbe>), extra: Partial<LiveLzDriver> = {}): LiveLzDriver {
  return {
    provider: 'fakecsp',
    driverVersion: '0.0.0-test',
    authMethods: [{ id: 'aksk', required: ['access-key-id', 'secret-access-key'], optional: ['session-token'], unattended: true }],
    defaultBaseUrls: { iam: 'https://iam.fakecsp.example', ecs: 'https://ecs.fakecsp.example' },
    readAllowList: [{ method: 'POST', path: /^\/v3\/auth\/tokens$/, reason: 'token request, changes nothing in the tenant' }],
    routeTemplates: ['/v3/projects/{project_id}/servers'],
    async probeReadOnly(ctx) {
      if (typeof probe === 'function') return probe(ctx);
      await ctx.http.fetch(`${ctx.http.baseUrls['iam']}/v3/auth/tokens`, { method: 'POST', headers: { 'x-auth-key': ctx.credentials['secret-access-key'] ?? '' }, body: '{}' });
      await ctx.http.fetch(`${ctx.http.baseUrls['iam']}/v3/projects/0123456789abcdef0123456789abcdef/servers?limit=10&marker=x`);
      return probe;
    },
    listRegions: async () => [],
    listServices: async () => [],
    listGuardrails: async () => [],
    listResources: async () => [],
    listQuotas: async () => [],
    listActivity: async () => ({ window_days: 30, events_total: 0, by_kind: {} }),
    ...extra,
  };
}

export const VERIFIED: ReadOnlyProbe = { read_only: 'verified', identity: 'readonly-group', write_actions_allowed: [], coverage: { readable: ['ecs'], unreadable: ['rds'] } };
export const REFUSED: ReadOnlyProbe = { read_only: 'refused', identity: 'domain-admin', reason: 'role grants ecs:servers:create', write_actions_allowed: ['ecs:servers:create'], coverage: { readable: ['ecs', 'rds'], unreadable: [] } };
export const UNVERIFIABLE: ReadOnlyProbe = { read_only: 'unverifiable', identity: 'sso-role', reason: 'simulate permission missing', write_actions_allowed: [], coverage: { readable: [], unreadable: [] } };
