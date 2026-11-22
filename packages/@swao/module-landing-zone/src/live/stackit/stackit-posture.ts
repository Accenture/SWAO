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

// #3867 (Design 123 section 5.4, STACKIT table): pure mappings from STACKIT
// read-only API documents to `estate.posture` facts (#3864). The HTTP side is
// `listPosture` in stackit-driver.ts. Shapes from the STACKIT API
// specifications (github.com/stackitcloud/stackit-api-specifications: iaas
// v2, kms v1, load-balancer v2, server-backup v2, authorization v2) and the
// live Reader run of 2026-11-05.

import type { LzLivePostureInput } from '@swao/core';
import { flattenAttributes } from '../attributes.js';

type Doc = Record<string, unknown>;
type Posture = LzLivePostureInput;
type Item<B extends 'encryption' | 'exposure' | 'ingress_rules' | 'backup'> = NonNullable<NonNullable<Posture[B]>['items']>[number];

const obj = (v: unknown): Doc => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : {});
const arr = (v: unknown): Doc[] => (Array.isArray(v) ? v.filter((x): x is Doc => x !== null && typeof x === 'object') : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const port = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 65535 ? v : undefined);

/** An iaas list item with its region. */
export interface IaasItemOf { region: string; item: Doc }

/**
 * iaas v2 volumes: `encrypted` and `encryptionParameters` (`kekKeyId`,
 * `kekKeyringId`, `kekKeyVersion`): an encrypted volume names its KMS key, so
 * the key is customer-managed. `keyProtection` (KMS v1 key `protection`,
 * software or hsm) is added when the KMS key list was readable.
 */
export function volumeEncryption(volumes: readonly IaasItemOf[], keyProtection: ReadonlyMap<string, string>): Item<'encryption'>[] {
  return volumes.filter((v) => str(v.item['id'])).map(({ region, item }) => {
    const key = str(obj(item['encryptionParameters'])['kekKeyId']);
    const protection = key === undefined ? undefined : keyProtection.get(key);
    return {
      resource_id: item['id'] as string,
      type: 'iaas.volume',
      service_code: 'iaas',
      region,
      layer: 'at_rest' as const,
      ...(typeof item['encrypted'] === 'boolean' ? { encrypted: item['encrypted'] } : {}),
      ...(key ? { key_id: key, key_custody: 'customer-managed' as const } : {}),
      ...(protection ? { attributes: { kms_key_protection: protection } } : {}),
    };
  });
}

/**
 * Network load balancer v2 listeners. The protocols are TCP, UDP, TCP proxy
 * and TLS passthrough: the load balancer terminates no TLS, so it cannot tell
 * whether the traffic is encrypted (`encrypted` stays absent).
 */
export function listenerFacts(lbs: readonly IaasItemOf[]): Item<'encryption'>[] {
  const out: Item<'encryption'>[] = [];
  for (const { region, item } of lbs) {
    const lb = str(item['name']);
    if (!lb) continue;
    for (const l of arr(item['listeners'])) {
      const attributes = flattenAttributes(l, { omit: ['name', 'displayName'] });
      out.push({
        resource_id: `${lb}/${str(l['name']) ?? String(l['port'] ?? '')}`,
        type: 'load-balancer.listener',
        service_code: 'load-balancer',
        region,
        layer: 'in_transit' as const,
        ...(attributes ? { attributes } : {}),
      });
    }
  }
  return out;
}

/** Public IPs (bound through `networkInterface`) and load balancers with an external address. */
export function exposureFacts(publicIps: readonly IaasItemOf[], lbs: readonly IaasItemOf[]): Item<'exposure'>[] {
  const out: Item<'exposure'>[] = [];
  for (const { region, item } of publicIps) {
    const id = str(item['id']);
    if (!id) continue;
    const nic = str(item['networkInterface']);
    out.push({ resource_id: id, type: 'iaas.public-ip', service_code: 'iaas', region, exposure: 'public_ip', public: true, ...(nic ? { bound_to: nic } : {}) });
  }
  for (const { region, item } of lbs) {
    const name = str(item['name']);
    if (!name) continue;
    const privateOnly = obj(item['options'])['privateNetworkOnly'] === true;
    out.push({ resource_id: name, type: 'load-balancer.load-balancer', service_code: 'load-balancer', region, exposure: 'internet_endpoint', public: !privateOnly && str(item['externalAddress']) !== undefined });
  }
  return out;
}

/**
 * iaas v2 security group rules (`rules` of the security group list, live
 * 2026-11-05): inbound only. `ipRange` is the remote CIDR; a rule with
 * neither `ipRange` nor `remoteSecurityGroupId` admits any source of its
 * ethertype; no `protocol` is any protocol; no `portRange` all ports.
 * STACKIT security groups hold allow rules only.
 */
export function ingressRules(groups: readonly IaasItemOf[]): Item<'ingress_rules'>[] {
  const out: Item<'ingress_rules'>[] = [];
  for (const { region, item } of groups) {
    const id = str(item['id']);
    if (!id) continue;
    for (const r of arr(item['rules'])) {
      if (str(r['direction']) !== 'ingress') continue;
      const group = str(r['remoteSecurityGroupId']);
      const cidr = str(r['ipRange']) ?? (group === undefined ? (str(r['ethertype']) === 'IPv6' ? '::/0' : '0.0.0.0/0') : undefined);
      const range = obj(r['portRange']);
      const from = port(range['min']);
      const to = port(range['max']);
      const protocol = obj(r['protocol']);
      out.push({
        resource_id: id,
        type: 'iaas.security-group',
        service_code: 'iaas',
        region,
        protocol: str(protocol['name']) ?? (typeof protocol['number'] === 'number' ? String(protocol['number']) : 'any'),
        ...(from !== undefined ? { port_from: from } : {}),
        ...(to !== undefined && (from === undefined || to >= from) ? { port_to: to } : {}),
        ...(cidr ? { remote_cidr: cidr } : {}),
        ...(group ? { remote_group_id: group } : {}),
        action: 'allow' as const,
      });
    }
  }
  return out;
}

/** Roles that only read (authorization v2 project roles: `reader`, and service roles ending with `.reader` or `viewer`). */
export function isReadOnlyRole(role: string): boolean {
  const r = role.toLowerCase();
  return r === 'reader' || r.endsWith('.reader') || r.endsWith('viewer') || r === 'auditor' || r.endsWith('.auditor');
}

/**
 * Project members (authorization v2 `ListMembers`): a subject with a role
 * that is not read-only is privileged. Counts only, never a subject. MFA is
 * not visible through the project APIs, so the MFA fields stay absent.
 */
export function identityFacts(members: readonly Doc[]): Omit<NonNullable<Posture['identity']>, 'source'> {
  const privileged = new Set<string>();
  for (const m of members) {
    const subject = str(m['subject']);
    const role = str(m['role']);
    if (subject && role && !isReadOnlyRole(role)) privileged.add(subject.toLowerCase());
  }
  return { privileged_principals: privileged.size, credentials: [] };
}

/**
 * server-backup v2 schedules per server: protected when an enabled schedule
 * exists; retention is the longest `backupProperties.retentionPeriod` (days)
 * of the enabled schedules; `schedules` undefined means the backup service is
 * not enabled for the server (HTTP 404), so it is not protected.
 */
export function backupFacts(servers: readonly IaasItemOf[], schedulesOf: ReadonlyMap<string, readonly Doc[] | undefined>): Item<'backup'>[] {
  return servers.filter((s) => str(s.item['id'])).map(({ region, item }) => {
    const id = item['id'] as string;
    const enabled = (schedulesOf.get(id) ?? []).filter((s) => s['enabled'] === true);
    const retention = enabled.map((s) => obj(s['backupProperties'])['retentionPeriod']).filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0);
    const first = enabled[0];
    return {
      resource_id: id,
      type: 'iaas.server',
      service_code: 'iaas',
      region,
      protected: enabled.length > 0,
      ...(first !== undefined && first['id'] !== undefined ? { policy_id: String(first['id']) } : {}),
      ...(retention.length > 0 ? { retention_days: Math.max(...retention) } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// #3970: object storage, PostgreSQL Flex, MongoDB Flex, SFS and CDN
// ---------------------------------------------------------------------------

/**
 * Properties never copied into `attributes` (Design 120 section 6.4): URLs,
 * hosts and mount paths that carry a resource name or an address, IP access
 * lists, and the service account of a customer key. The privacy filter of the
 * scan assembler handles names, people and single host addresses; these keys
 * carry them inside longer strings, so the drivers omit them.
 */
export const STACKIT_DATA_OMIT: Readonly<Record<string, readonly string[]>> = {
  'object-storage.bucket': ['name', 'region', 'urlPathStyle', 'urlVirtualHostedStyle'],
  'postgres-flex.instance': ['id', 'name', 'labels', 'connectionInfo', 'network', 'encryption', 'backupSchedule', 'retentionDays', 'created'],
  // #3995: sqlserverflex v3 GetInstanceResponse (network holds the ACL and the addresses).
  'sqlserver-flex.instance': ['id', 'name', 'labels', 'network', 'encryption', 'backupSchedule', 'retentionDays'],
  'mongodb-flex.instance': ['id', 'name', 'labels', 'acl', 'backupSchedule', 'options'],
  'sfs.resource-pool': ['id', 'name', 'labels', 'createdAt', 'ipAcl', 'mountPath', 'snapshotPolicy'],
  'cdn.distribution': ['id', 'projectId', 'createdAt', 'updatedAt', 'domains', 'config', 'errors', 'waf'],
};

/** A STACKIT data service item with its region (`global` for the project-wide CDN). */
export interface DataItemOf { region: string; item: Doc }

const ref = (type: string, serviceCode: string, region: string, id: string) => ({ resource_id: id, type, service_code: serviceCode, region });

/** Resource id of a data service item: the bucket name (buckets have no other id), else `id`. */
export function dataItemId(type: string, item: Doc): string | undefined {
  return type === 'object-storage.bucket' ? str(item['name']) : str(item['id']);
}

/**
 * At rest. Object storage v2 buckets, MongoDB Flex v2 instances and SFS v1
 * resource pools carry no encryption property, so `encrypted` stays absent
 * (the read does not tell). PostgreSQL Flex v3 and SQL Server Flex v3 (#3995)
 * `encryption` (`kekKeyId`, `kekKeyRingId`, `kekKeyVersion`) names a KMS key of
 * the project: encrypted with a customer-managed key; without it the read does
 * not tell.
 */
export function dataAtRest(type: string, serviceCode: string, items: readonly DataItemOf[]): Item<'encryption'>[] {
  const out: Item<'encryption'>[] = [];
  for (const { region, item } of items) {
    const id = dataItemId(type, item);
    if (!id) continue;
    const key = str(obj(item['encryption'])['kekKeyId']);
    const attributes = flattenAttributes(item, { omit: STACKIT_DATA_OMIT[type] ?? [] });
    out.push({
      ...ref(type, serviceCode, region, id),
      layer: 'at_rest' as const,
      ...(key ? { encrypted: true, key_id: key, key_custody: 'customer-managed' as const } : {}),
      ...(attributes ? { attributes } : {}),
    });
  }
  return out;
}

/**
 * Backup. PostgreSQL Flex v3, SQL Server Flex v3 (#3995) and MongoDB Flex v2:
 * `backupSchedule` (a cron expression, required on create) makes the instance
 * protected; PostgreSQL Flex and SQL Server Flex `retentionDays` is the
 * retention. SFS v1: a resource pool with a
 * `snapshotPolicy` is protected by scheduled snapshots (judgement recorded in
 * Design 123 section 5.4: snapshots are the backup mechanism SFS offers).
 */
export function dataBackup(type: string, serviceCode: string, items: readonly DataItemOf[]): Item<'backup'>[] {
  const out: Item<'backup'>[] = [];
  for (const { region, item } of items) {
    const id = dataItemId(type, item);
    if (!id) continue;
    if (type === 'sfs.resource-pool') {
      const policy = str(obj(item['snapshotPolicy'])['id']);
      out.push({ ...ref(type, serviceCode, region, id), protected: policy !== undefined, ...(policy ? { policy_id: policy, attributes: { protection: 'snapshot_policy' } } : {}) });
      continue;
    }
    const schedule = str(item['backupSchedule']);
    const retention = item['retentionDays'];
    out.push({
      ...ref(type, serviceCode, region, id),
      protected: schedule !== undefined,
      ...(typeof retention === 'number' && Number.isInteger(retention) && retention >= 0 ? { retention_days: retention } : {}),
      ...(schedule ? { attributes: { backup_schedule: schedule } } : {}),
    });
  }
  return out;
}

/**
 * CDN v1 distributions (`config.tls.enableTls10`, `enableTls11`). STACKIT
 * documents that only TLS 1.2 and 1.3 are active by default and that 1.0 and
 * 1.1 can be enabled (docs.stackit.cloud CDN features), so the floor is the
 * lowest enabled version. Whether plain HTTP is refused is neither in the API
 * nor in the documentation, so `encrypted` stays absent.
 */
export function cdnInTransit(distributions: readonly DataItemOf[]): Item<'encryption'>[] {
  const out: Item<'encryption'>[] = [];
  for (const { region, item } of distributions) {
    const id = str(item['id']);
    if (!id) continue;
    const config = obj(item['config']);
    const tls = obj(config['tls']);
    const floor = tls['enableTls10'] === true ? '1.0' as const
      : tls['enableTls11'] === true ? '1.1' as const
        : tls['enableTls10'] === false && tls['enableTls11'] === false ? '1.2' as const : undefined;
    const attributes = flattenAttributes({ status: item['status'], backend_type: obj(config['backend'])['type'], edge_regions: config['regions'], waf_mode: obj(config['waf'])['mode'], waf_type: obj(config['waf'])['type'] });
    out.push({ ...ref('cdn.distribution', 'cloud.stackit.cdn', region, id), layer: 'in_transit' as const, ...(floor ? { min_tls_version: floor } : {}), ...(attributes ? { attributes } : {}) });
  }
  return out;
}
