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

// #3576: STACKIT read-only probe (Design 120 section 6.3, the STACKIT row of
// the probe table: read the role bindings of the service account, refuse on
// write roles). Wire format from the published Authorization API v2
// (stackitcloud/stackit-api-specifications services/authorization/v2):
//   GET /v2/users/{email}/permissions?resourceType=project&resource=<id>
//     -> ListUserPermissionsResponse { items: [{ resourceId, resourceType,
//        permissions: [{ name, description }] }] }
//   GET /v2/users/{email}/memberships?resourceType=project&resourceId=<id>
//     -> ListUserMembershipsResponse { items: [{ resourceId, resourceType, role, subject }] }
// The spec states that a user may list its own permissions and memberships,
// so a least-privilege service account can run the probe (verified live
// 2026-11-03: HTTP 200 for both on the own e-mail).
// Permission names are `<service>.<resource>.<verb>` (spec examples
// `iam.member.read`); a permission whose verb is not a read is a write.

import type { ReadOnlyProbe } from '../types.js';

/** Collection sources of the driver and the permission prefix that serves each. */
export const STACKIT_SOURCE_PREFIXES: Readonly<Record<string, string>> = {
  'service-enablement': 'service-enablement',
  iaas: 'iaas',
};

const READ_VERB_RE = /^(get|list|read|view|describe|show|query)$/i;

/**
 * Further read verbs seen in the Reader role on the live run of 2026-11-03,
 * each a read by its published permission description: `ping` ("echo the
 * project_id"), `logs` ("list the logs"), `metrics` ("read the metrics"),
 * `check-enabled` ("get enablement"), `overview` ("get the overview") and
 * `<x>-list` (`restore-list`: "list backup restore"). The same role also
 * holds non-read permissions (`create`, `restore`, `use`, `auth`), so Reader
 * is reported `refused` (#3576).
 */
const OBSERVED_READ_VERBS = new Set(['ping', 'logs', 'metrics', 'check-enabled', 'overview']);

export function isReadPermission(name: string): boolean {
  const verb = (name.split('.').pop() ?? '').toLowerCase();
  return name.includes('.') && (READ_VERB_RE.test(verb) || OBSERVED_READ_VERBS.has(verb) || verb.endsWith('-list'));
}

export interface StackitPermissionsDoc {
  items?: { resourceId?: string; resourceType?: string; permissions?: { name?: string }[] }[];
}

export interface StackitMembershipsDoc {
  items?: { resourceId?: string; resourceType?: string; role?: string }[];
}

/** Coverage from the permission prefixes the service account holds. */
export function stackitCoverage(permissions: readonly string[]): ReadOnlyProbe['coverage'] {
  const prefixes = new Set(permissions.map((p) => p.split('.')[0] ?? ''));
  const all = Object.keys(STACKIT_SOURCE_PREFIXES);
  return {
    readable: all.filter((s) => prefixes.has(STACKIT_SOURCE_PREFIXES[s] as string)),
    unreadable: all.filter((s) => !prefixes.has(STACKIT_SOURCE_PREFIXES[s] as string)),
  };
}

/**
 * Classify the own permissions on the project. Role names label the identity
 * (never the service account e-mail, Design 120 section 6.4).
 */
export function probeFromPermissions(perms: StackitPermissionsDoc, memberships: StackitMembershipsDoc | undefined, _projectId: string): ReadOnlyProbe {
  // The query is already scoped to the project. Live 2026-11-03: `resourceId`
  // in the response is the project's containerId (a slug), not the project
  // UUID of the request, so items are matched by type, not by id.
  const names = [...new Set((perms.items ?? [])
    .filter((i) => i.resourceType === undefined || i.resourceType === 'project')
    .flatMap((i) => (i.permissions ?? []).map((p) => p.name ?? ''))
    .filter((n) => n !== ''))].sort();
  const roles = [...new Set((memberships?.items ?? []).map((m) => m.role ?? '').filter((r) => r !== ''))].sort();
  const identity = roles.length > 0 ? `roles: ${roles.join(', ')}` : 'no role on the project';
  const coverage = stackitCoverage(names);
  const writes = names.filter((n) => !isReadPermission(n));
  if (writes.length > 0) {
    return { read_only: 'refused', identity, reason: `the service account holds ${writes.length} non-read permission(s) on the project`, write_actions_allowed: writes, coverage };
  }
  if (names.length === 0) {
    return {
      read_only: 'unverifiable',
      identity,
      reason: 'the service account holds no permission on the project (no role binding); assign the Reader role on the project',
      write_actions_allowed: [],
      coverage,
    };
  }
  return { read_only: 'verified', identity, write_actions_allowed: [], coverage };
}
