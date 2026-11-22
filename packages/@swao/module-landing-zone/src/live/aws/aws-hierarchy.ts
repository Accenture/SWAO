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

// #3882: AWS tenant hierarchy (Design 123 section 5.6, D-13). Organizations
// (JSON protocol, global endpoint, AWSOrganizationsV20161128), all reads that
// pass the AWS action guard (aws-client.ts AWS_READ_OPERATION, Describe and
// List operations):
//   - `sts:GetCallerIdentity`: the account of the scope;
//   - `organizations:DescribeOrganization`: the organisation, the top node
//     (`aws:organization`);
//   - `organizations:ListRoots`: the root (`aws:root`) under it;
//   - `organizations:ListOrganizationalUnitsForParent` and
//     `organizations:ListAccountsForParent` per parent: the nested
//     organisational units and the accounts;
//   - `organizations:ListPoliciesForTarget` (`SERVICE_CONTROL_POLICY`) per
//     root, OU and account: the SCPs attached to the node (`policy_refs`).
// Wire format from the botocore model of Organizations (2016-11-28): every
// list pages with `NextToken`; `Roots[]` (`Id`, `Arn`, `Name`, `PolicyTypes`),
// `OrganizationalUnits[]` (`Id`, `Arn`, `Name`), `Accounts[]` (`Id`, `Arn`,
// `Email`, `Name`, `Status`, `JoinedMethod`, `JoinedTimestamp`). The
// Organizations reads answer only in the management account or a delegated
// administrator; elsewhere they are AccessDenied (or
// AWSOrganizationsNotInUseException), recorded in `sources`, and the tree is
// the scope's own account, partial. An application scope keeps its own
// account and its ancestors. Mock only on 2026-11-05: no SSO window (D-17).

import type { DriverHierarchy, DriverHierarchyNode, ScopeCtx } from '../types.js';
import { LiveAuthError } from '../errors.js';
import { flattenAttributes } from '../attributes.js';
import { AwsApiError, awsJson, awsQuery } from './aws-client.js';
import { find, textOf } from './aws-xml.js';

const MAX_PAGES = 100;
/** Parents walked (root and organisational units). */
const MAX_PARENTS = 500;

type Doc = Record<string, unknown>;
interface AwsOrg { Id?: string; [k: string]: unknown }
interface AwsNode { Id?: string; Name?: string; [k: string]: unknown }


function denied(ctx: ScopeCtx, name: string, err: unknown): void {
  if (err instanceof LiveAuthError && err.httpStatus === 401) throw err;
  if (!(err instanceof Error)) throw err;
  const http = err instanceof AwsApiError ? err.status : err instanceof LiveAuthError ? err.httpStatus : undefined;
  const code = err instanceof AwsApiError ? err.code : undefined;
  ctx.sources.push(http !== undefined && http >= 100 ? { name, status: 'not_collected', http_status: http, ...(code ? { reason: code } : {}) } : { name, status: 'not_collected', reason: err.message });
}

async function paged<T>(ctx: ScopeCtx, home: string, op: string, key: string, input: Doc): Promise<T[]> {
  const out: T[] = [];
  let token = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const doc = await awsJson<Doc>(ctx, 'organizations', op, home, { ...input, ...(token ? { NextToken: token } : {}) });
    out.push(...((doc[key] ?? []) as T[]));
    token = typeof doc['NextToken'] === 'string' ? doc['NextToken'] : '';
    if (!token) break;
  }
  return out;
}

const node = (n: AwsNode, kind: DriverHierarchyNode['kind'], native: string, parent: string | undefined): DriverHierarchyNode => {
  const attributes = flattenAttributes(n, { omit: ['Id', 'Name'] });
  return { id: String(n.Id), kind, native_kind: native, ...(parent ? { parent } : {}), ...(n.Name ? { name: n.Name } : {}), ...(attributes ? { attributes } : {}) };
};

/** `home`: the region of the account-wide calls (aws-driver.ts awsHomeRegion); Organizations itself is global. */
export async function listAwsHierarchy(ctx: ScopeCtx, home: string): Promise<DriverHierarchy> {
  const application = ctx.scopeKind === 'application';
  const calls: string[] = [];
  let partial = false;
  const who = await awsQuery(ctx, 'sts', 'GetCallerIdentity', home);
  const account = textOf(find(who, 'GetCallerIdentityResult'), 'Account') ?? '';
  calls.push('sts:GetCallerIdentity');
  const nodes = new Map<string, DriverHierarchyNode>();
  const put = (n: DriverHierarchyNode): void => { nodes.set(n.id, n); };

  let org: AwsOrg | undefined;
  try {
    org = (await awsJson<{ Organization?: AwsOrg }>(ctx, 'organizations', 'DescribeOrganization', home)).Organization;
    calls.push('organizations:DescribeOrganization');
    if (org?.Id) {
      const attributes = flattenAttributes(org, { omit: ['Id'] });
      put({ id: org.Id, kind: 'organisation', native_kind: 'aws:organization', ...(attributes ? { attributes } : {}) });
    }
  } catch (err) {
    denied(ctx, 'hierarchy:organization', err);
    partial = true;
  }

  let roots: AwsNode[] = [];
  try {
    roots = await paged<AwsNode>(ctx, home, 'ListRoots', 'Roots', {});
    calls.push('organizations:ListRoots');
  } catch (err) {
    denied(ctx, 'hierarchy:roots', err);
    partial = true;
  }
  const queue: string[] = [];
  for (const r of roots) {
    if (!r.Id) continue;
    put(node(r, 'root', 'aws:root', org?.Id));
    queue.push(r.Id);
  }
  let i = 0;
  for (; i < queue.length && i < MAX_PARENTS; i++) {
    const parent = queue[i] as string;
    try {
      const ous = await paged<AwsNode>(ctx, home, 'ListOrganizationalUnitsForParent', 'OrganizationalUnits', { ParentId: parent });
      if (!calls.includes('organizations:ListOrganizationalUnitsForParent')) calls.push('organizations:ListOrganizationalUnitsForParent');
      for (const ou of ous) {
        if (!ou.Id) continue;
        put(node(ou, 'organisational_unit', 'aws:ou', parent));
        queue.push(ou.Id);
      }
      const accounts = await paged<AwsNode>(ctx, home, 'ListAccountsForParent', 'Accounts', { ParentId: parent });
      if (!calls.includes('organizations:ListAccountsForParent')) calls.push('organizations:ListAccountsForParent');
      for (const a of accounts) if (a.Id) put(node(a, 'account', 'aws:account', parent));
    } catch (err) {
      denied(ctx, 'hierarchy:children', err);
      partial = true;
      break;
    }
  }
  if (i < queue.length) partial = true;

  // SCP attachment per node (`policy_refs`, the ids of estate.guardrails `aws-scp`).
  const targets = [...nodes.values()].filter((n) => n.kind === 'root' || n.kind === 'organisational_unit' || n.kind === 'account').slice(0, MAX_PARENTS);
  for (const t of targets) {
    try {
      const policies = await paged<AwsNode>(ctx, home, 'ListPoliciesForTarget', 'Policies', { TargetId: t.id, Filter: 'SERVICE_CONTROL_POLICY' });
      if (!calls.includes('organizations:ListPoliciesForTarget')) calls.push('organizations:ListPoliciesForTarget');
      const refs = policies.map((p) => p.Id).filter((x): x is string => typeof x === 'string' && x !== '');
      if (refs.length > 0) t.policy_refs = [...new Set(refs)];
    } catch (err) {
      denied(ctx, 'hierarchy:policies', err);
      break;
    }
  }

  // The scope's own account; without the Organizations reads it stands alone (never a guessed parent).
  if (account !== '' && !nodes.has(account)) {
    put({ id: account, kind: 'account', native_kind: 'aws:account' });
    partial = true;
  }

  let keep = [...nodes.values()];
  if (application && account !== '') {
    keep = [];
    for (let n: DriverHierarchyNode | undefined = nodes.get(account); n && keep.length < 32; n = n.parent ? nodes.get(n.parent) : undefined) keep.push(n);
    keep.reverse();
  }
  const depth = (id: string, seen = 0): number => { const p = nodes.get(id)?.parent; return p === undefined || seen > 32 ? 0 : 1 + depth(p, seen + 1); };
  keep.sort((a, b) => depth(a.id) - depth(b.id));
  return { nodes: keep, source: { calls, partial }, ...(account !== '' ? { scope_node: account } : {}) };
}
