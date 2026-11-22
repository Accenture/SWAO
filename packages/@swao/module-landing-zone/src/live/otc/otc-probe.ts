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

// #3572: OTC read-only probe (Design 120 section 6.3): read the groups of the
// token's user and the roles assigned to them, then classify every Allow
// action of the role policies. Wire formats from the published OTC IAM API
// reference (opentelekomcloud-docs/identity-access-management, api-ref/source/
// apis/): user_management/querying_the_user_group_to_which_a_user_belongs.rst
// (`GET /v3/users/{user_id}/groups` -> `groups[{id, name}]`) and
// permission_management/querying_permissions_of_a_user_group_under_a_domain.rst,
// ..._corresponding_to_a_project.rst, querying_all_permissions_of_a_user_group.rst
// (`roles[{name, display_name, policy: {Statement: [{Action[], Effect}]}}]`).
// The reference states that the role queries need a token with the Security
// Administrator permission, so a least-privilege identity typically gets a 403
// here: the probe then reports `unverifiable`, never `verified`.

import type { ReadOnlyProbe } from '../types.js';
import { OTC_SERVICES } from './otc-services.js';

export interface OtcPolicyStatement {
  Action?: string[];
  Effect?: string;
}

export interface OtcRole {
  name?: string;
  display_name?: string;
  policy?: { Statement?: OtcPolicyStatement[] };
}

/** Verbs that only read (`<service>:<resource>:<verb>`); a wildcard verb is not a read. */
const READ_VERB_RE = /^(get|list|show|query|describe|head|check|count|view|read|batchget|batchlist)[a-z0-9]*\*?$/i;

export function isReadAction(action: string): boolean {
  const parts = action.split(':');
  const verb = parts[parts.length - 1] ?? '';
  if (parts.length < 3 || verb === '' || verb === '*') return false;
  return READ_VERB_RE.test(verb);
}

export interface RoleAnalysis {
  /** Allow actions that are not reads (not cancelled by an identical Deny). */
  writeActions: string[];
  /** Service prefixes the Allow actions cover (`*` = every service). */
  readableServices: Set<string>;
  /** Roles without a policy document (cannot be classified). */
  unclassified: string[];
}

export function analyseRoles(roles: readonly OtcRole[]): RoleAnalysis {
  const write = new Set<string>();
  const readable = new Set<string>();
  const unclassified: string[] = [];
  for (const role of roles) {
    const statements = role.policy?.Statement;
    if (!Array.isArray(statements) || statements.length === 0) {
      unclassified.push(role.display_name ?? role.name ?? '(unnamed role)');
      continue;
    }
    const denied = new Set(statements.filter((s) => s.Effect === 'Deny').flatMap((s) => s.Action ?? []));
    for (const s of statements) {
      if (s.Effect !== 'Allow') continue;
      for (const a of s.Action ?? []) {
        readable.add((a.split(':')[0] ?? '').toLowerCase());
        if (!isReadAction(a) && !denied.has(a)) write.add(a);
      }
    }
  }
  return { writeActions: [...write].sort(), readableServices: readable, unclassified };
}

/**
 * IAM action prefixes that differ from the Config provider code of the
 * service. Observed on the test tenant 2026-11-03 (#3572): the system role
 * "AOM Global Access" allows `rms:*:list*` / `rms:*:get*` (Config), and IAM
 * actions use `identity:`.
 */
export const OTC_ACTION_PREFIX_ALIASES: Readonly<Record<string, string>> = { rms: 'config', identity: 'iam' };

/** Driver coverage from the service prefixes of the Allow actions. */
export function otcCoverage(readableServices: ReadonlySet<string>): ReadOnlyProbe['coverage'] {
  const all = OTC_SERVICES.map((s) => s.code);
  if (readableServices.has('*')) return { readable: all, unreadable: [] };
  const codes = new Set([...readableServices].map((p) => OTC_ACTION_PREFIX_ALIASES[p] ?? p));
  return {
    readable: all.filter((c) => codes.has(c)),
    unreadable: all.filter((c) => !codes.has(c)),
  };
}

export function probeFromRoles(identity: string, roles: readonly OtcRole[]): ReadOnlyProbe {
  const a = analyseRoles(roles);
  const coverage = otcCoverage(a.readableServices);
  if (a.writeActions.length > 0) {
    return {
      read_only: 'refused',
      identity,
      reason: `the assigned roles allow ${a.writeActions.length} non-read action(s)`,
      write_actions_allowed: a.writeActions,
      coverage,
    };
  }
  if (a.unclassified.length > 0 || roles.length === 0) {
    return {
      read_only: 'unverifiable',
      identity,
      reason: roles.length === 0 ? 'no role assignments were readable for the user groups' : `roles without a policy document: ${a.unclassified.join(', ')}`,
      write_actions_allowed: [],
      coverage,
    };
  }
  return { read_only: 'verified', identity, write_actions_allowed: [], coverage };
}
