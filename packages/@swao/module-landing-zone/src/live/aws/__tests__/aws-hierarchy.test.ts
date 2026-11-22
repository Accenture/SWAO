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

// #3882: the AWS tenant hierarchy collector against the in-process mock
// (Design 123 section 5.6). Mock only on 2026-11-05: no SSO window (D-17).

import { beforeEach, describe, expect, it } from 'vitest';
import { LzLiveHierarchySchema, lzLiveHierarchyRoots } from '@swao/core';
import { createReadOnlyFetch } from '../../http.js';
import { prepareHierarchy } from '../../hierarchy.js';
import type { ScopeCtx } from '../../types.js';
import { setAwsRetryDelayForTests } from '../aws-client.js';
import { awsDriver } from '../aws-driver.js';
import { listAwsHierarchy } from '../aws-hierarchy.js';
import { ACCOUNT, ORG_ROOT, makeAwsMock } from './aws-mock.js';
import type { AwsMockOptions } from './aws-mock.js';

const SALT = 'x'.repeat(64);

function ctxFor(opts: AwsMockOptions = {}, over: Partial<ScopeCtx> = {}): { ctx: ScopeCtx; calls: ReturnType<typeof makeAwsMock>['calls'] } {
  const mock = makeAwsMock(opts);
  return {
    ctx: {
      lzId: 'aws-test', provider: 'aws', scopeId: 'platform', scopeKind: 'platform', auth: 'session-keys', regions: ['eu-central-1'], target: {},
      credentials: { 'access-key-id': ['MOCK', 'ACCESS', 'ID'].join(''), 'secret-access-key': ['mock', 'secret', 'value'].join('-'), 'session-token': ['mock', 'session', 'token'].join('-') },
      http: { fetch: createReadOnlyFetch(mock.fetch, 'aws', awsDriver.readAllowList), baseUrls: { ...awsDriver.defaultBaseUrls } },
      sources: [],
      ...over,
    },
    calls: mock.calls,
  };
}

beforeEach(() => setAwsRetryDelayForTests(() => 0));

describe('listAwsHierarchy (#3882, mock only)', () => {
  it('management account, platform scope: organisation > root > nested OUs > accounts, every list paged', async () => {
    const { ctx, calls } = ctxFor();
    const h = prepareHierarchy(await awsDriver.listHierarchy!(ctx), SALT);
    expect(LzLiveHierarchySchema.safeParse(h).success).toBe(true);
    expect(lzLiveHierarchyRoots(h.nodes)).toEqual(['o-mock']);
    expect(h.nodes.map((n) => [n.id, n.native_kind, n.parent])).toEqual([
      ['o-mock', 'aws:organization', undefined],
      [ORG_ROOT, 'aws:root', 'o-mock'],
      ['ou-mock-a', 'aws:ou', ORG_ROOT],
      ['444455556666', 'aws:account', ORG_ROOT],
      ['ou-mock-b', 'aws:ou', 'ou-mock-a'],
      [ACCOUNT, 'aws:account', 'ou-mock-b'],
    ]);
    expect(h.scope_node).toBe(ACCOUNT);
    expect(h.source).toEqual({ calls: ['sts:GetCallerIdentity', 'organizations:DescribeOrganization', 'organizations:ListRoots', 'organizations:ListOrganizationalUnitsForParent', 'organizations:ListAccountsForParent', 'organizations:ListPoliciesForTarget'], partial: false, status: 'ok' });
    // SCP attachment per node: the customer SCP on the root, FullAWSAccess everywhere.
    expect(h.nodes.find((n) => n.id === ORG_ROOT)?.policy_refs).toEqual(['p-mock0', 'p-mock1']);
    expect(h.nodes.find((n) => n.id === ACCOUNT)?.policy_refs).toEqual(['p-mock0']);
    expect(h.nodes.find((n) => n.id === 'o-mock')?.policy_refs).toEqual([]);
    // Every request is a read the AWS action guard admits; names and e-mails never stored.
    expect(calls.every((c) => c.operation === null || /^(Describe|List|Get|Lookup)/.test(String(c.operation)))).toBe(true);
    const account = h.nodes.find((n) => n.id === ACCOUNT)!;
    expect(account.attributes).toMatchObject({ Status: 'ACTIVE', JoinedMethod: 'CREATED' });
    expect(String(account.attributes?.['Email'])).toMatch(/^Person-/);
    expect(JSON.stringify(h)).not.toContain(`account-${ACCOUNT}`);
    expect(ctx.sources).toEqual([]);
  });

  it('application scope: own account and its ancestors only', async () => {
    const { ctx } = ctxFor({}, { scopeKind: 'application', scopeId: 'app1' });
    const h = prepareHierarchy(await listAwsHierarchy(ctx, 'eu-central-1'), SALT);
    expect(h.nodes.map((n) => n.id)).toEqual(['o-mock', ORG_ROOT, 'ou-mock-a', 'ou-mock-b', ACCOUNT]);
    expect(h.source.partial).toBe(false);
  });

  it('member account: the Organizations reads are denied, the own account stands alone, partial, denied reads in sources', async () => {
    const deny = { status: 400, code: 'AccessDenied' };
    const { ctx } = ctxFor({ fail: { DescribeOrganization: deny, ListRoots: deny } });
    const h = prepareHierarchy(await listAwsHierarchy(ctx, 'eu-central-1'), SALT);
    expect(LzLiveHierarchySchema.safeParse(h).success).toBe(true);
    expect(h.nodes).toEqual([{ id: ACCOUNT, kind: 'account', native_kind: 'aws:account', status: 'observed', policy_refs: [] }]);
    expect(h.source).toMatchObject({ calls: ['sts:GetCallerIdentity'], partial: true });
    expect(ctx.sources.map((s) => [s.name, s.status, s.http_status])).toEqual([['hierarchy:organization', 'not_collected', 400], ['hierarchy:roots', 'not_collected', 400]]);
  });

  it('a denied SCP attachment read is recorded; the tree stays whole', async () => {
    const { ctx } = ctxFor({ fail: { ListPoliciesForTarget: { status: 400, code: 'AccessDenied' } } });
    const h = prepareHierarchy(await listAwsHierarchy(ctx, 'eu-central-1'), SALT);
    expect(h.nodes).toHaveLength(6);
    expect(h.nodes.every((n) => n.policy_refs.length === 0)).toBe(true);
    expect(h.source.partial).toBe(false);
    expect(ctx.sources.map((s) => s.name)).toEqual(['hierarchy:policies']);
  });

  it('a denied child listing keeps what was read and marks the tree partial', async () => {
    const { ctx } = ctxFor({ fail: { ListAccountsForParent: { status: 400, code: 'AccessDenied' } } });
    const h = prepareHierarchy(await listAwsHierarchy(ctx, 'eu-central-1'), SALT);
    expect(h.nodes.map((n) => n.id).sort()).toEqual([ACCOUNT, 'o-mock', 'ou-mock-a', ORG_ROOT].sort());
    expect(h.source.partial).toBe(true);
    expect(ctx.sources.map((s) => s.name)).toEqual(['hierarchy:children']);
    // The attachment reads still run for the nodes that were read.
    expect(h.nodes.find((n) => n.id === ORG_ROOT)?.policy_refs).toEqual(['p-mock0', 'p-mock1']);
  });
});
