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

// #3865 (Design 123 section 5.4, OTC table): pure mappings from OTC read-only
// API documents to `estate.posture` facts (#3864). The HTTP side lives in
// otc-driver.ts `listPosture`; this file only shapes documents, so every rule
// is unit-tested without a transport.
//
// Sources (live operator run 2026-11-05, read-only):
// - RMS `all-resources` already returns the service properties the posture
//   needs: EVS `encrypted` and `metadata.__system__cmkid`, VPC security group
//   `security_group_rules`, VPC `publicips` with `associateInstanceId`, ELB
//   load balancer `eips`, IAM users `virtual_mfa_device`, `login_protect`,
//   `credentials[].create_time`, `group_list`. No extra call is needed for
//   them, and the RMS read is already in the read-only allow-list.
// - ELB v3 listeners (`tls_ciphers_policy`), RDS v3 instances
//   (`disk_encryption_id`), CBR vaults and policies are direct GETs.
// - CTS trackers (already read for the guardrails) carry `obs_info.bucket_lifecycle`.

import type { LzLivePostureInput } from '@swao/core';
import { flattenAttributes } from '../attributes.js';

/**
 * #3930: the tenant's domain and project ids that posture documents repeat
 * (ELB listener `project_id`, CTS tracker `domain_id`, RDS `project_id`). The
 * scope already names them, so they are not copied into posture attributes:
 * outside the resource inventory and the hierarchy the scan holds no native
 * domain or project id (Design 120 section 6.4; live 2026-11-05).
 */
export const OTC_SCOPE_ID_KEYS: readonly string[] = ['project_id', 'domain_id', 'tenant_id'];

type Doc = Record<string, unknown>;
type Posture = LzLivePostureInput;
type EncryptionItem = NonNullable<Posture['encryption']>['items'] extends (infer T)[] | undefined ? T : never;
type ExposureItem = NonNullable<Posture['exposure']>['items'] extends (infer T)[] | undefined ? T : never;
type IngressItem = NonNullable<Posture['ingress_rules']>['items'] extends (infer T)[] | undefined ? T : never;
type BackupItem = NonNullable<Posture['backup']>['items'] extends (infer T)[] | undefined ? T : never;

/** An RMS resource as `all-resources` returns it (fields the posture reads). */
export interface RmsResource {
  id?: string;
  provider?: string;
  type?: string;
  region_id?: string;
  project_id?: string;
  properties?: unknown;
  [property: string]: unknown;
}

const obj = (v: unknown): Doc => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : {});
const arr = (v: unknown): Doc[] => (Array.isArray(v) ? v.filter((x): x is Doc => x !== null && typeof x === 'object') : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const kindOf = (r: RmsResource): string => `${r.provider ?? ''}.${r.type ?? ''}`;
const base = (r: RmsResource): { resource_id: string; type: string; service_code?: string; region?: string } => ({
  resource_id: r.id as string,
  type: kindOf(r),
  ...(r.provider ? { service_code: r.provider } : {}),
  ...(r.region_id ? { region: r.region_id } : {}),
});

/** EVS volumes: `encrypted` and the KMS key in `metadata.__system__cmkid` (EVS API reference, volume metadata). */
export function evsEncryption(resources: readonly RmsResource[]): EncryptionItem[] {
  return resources.filter((r) => r.id && kindOf(r) === 'evs.volumes').map((r) => {
    const p = obj(r.properties);
    const key = str(obj(p['metadata'])['__system__cmkid']);
    return {
      ...base(r),
      layer: 'at_rest' as const,
      ...(typeof p['encrypted'] === 'boolean' ? { encrypted: p['encrypted'] } : {}),
      ...(key ? { key_id: key } : {}),
    };
  });
}

/** RDS v3 instances: `disk_encryption_id` names the KMS key of an encrypted disk (RDS API reference, querying DB instances). */
export function rdsEncryption(instances: readonly Doc[], region: string): EncryptionItem[] {
  return instances.filter((i) => str(i['id'])).map((i) => {
    const key = str(i['disk_encryption_id']);
    const attributes = flattenAttributes(i, { omit: ['id', 'disk_encryption_id', 'region', ...OTC_SCOPE_ID_KEYS] });
    return {
      resource_id: i['id'] as string,
      type: 'rds.instances',
      service_code: 'rds',
      region: str(i['region']) ?? region,
      layer: 'at_rest' as const,
      encrypted: key !== undefined,
      ...(key ? { key_id: key } : {}),
      ...(attributes ? { attributes } : {}),
    };
  });
}

/**
 * ELB v3 `tls_ciphers_policy` to its lowest TLS version (ELB API reference,
 * "TLS security policies": tls-1-0, tls-1-1, tls-1-2, tls-1-2-strict,
 * tls-1-0-with-1-3, tls-1-2-fs-with-1-3, tls-1-2-fs, tls-1-0-inherit,
 * hybrid-policy-1-0, tls-1-3). Unknown names give no floor.
 */
export function tlsFloor(policy: string | undefined): '1.0' | '1.1' | '1.2' | '1.3' | undefined {
  if (policy === undefined) return undefined;
  const p = policy.toLowerCase();
  if (p === 'tls-1-3') return '1.3';
  if (p.startsWith('tls-1-2')) return '1.2';
  if (p.startsWith('tls-1-1')) return '1.1';
  if (p.startsWith('tls-1-0') || p === 'hybrid-policy-1-0') return '1.0';
  return undefined;
}

const TLS_PROTOCOLS = new Set(['HTTPS', 'TERMINATED_HTTPS', 'TLS', 'QUIC']);
const PLAIN_PROTOCOLS = new Set(['HTTP']);

/** ELB v3 listeners: TLS-terminating listeners are encrypted with their policy floor; HTTP is not; TCP and UDP do not tell. */
export function elbInTransit(listeners: readonly Doc[], region: string): EncryptionItem[] {
  return listeners.filter((l) => str(l['id'])).map((l) => {
    const protocol = (str(l['protocol']) ?? '').toUpperCase();
    const floor = TLS_PROTOCOLS.has(protocol) ? tlsFloor(str(l['tls_ciphers_policy']) ?? 'tls-1-0') : undefined;
    const attributes = flattenAttributes(l, { omit: ['id', 'tls_ciphers_policy', ...OTC_SCOPE_ID_KEYS] });
    return {
      resource_id: l['id'] as string,
      type: 'elb.listeners',
      service_code: 'elb',
      region,
      layer: 'in_transit' as const,
      ...(TLS_PROTOCOLS.has(protocol) ? { encrypted: true } : PLAIN_PROTOCOLS.has(protocol) ? { encrypted: false } : {}),
      ...(floor ? { min_tls_version: floor } : {}),
      ...(attributes ? { attributes } : {}),
    };
  });
}

/**
 * #3953: resource type of the owner of a port (VPC API reference, port
 * `device_owner`: `compute:<az>` a server NIC, `neutron:LOADBALANCER*` an ELB
 * VIP). Other owners (`neutron:VIP_PORT`, router and DHCP ports) name no
 * resource type: the instance the VIP serves is read from `vnic.instanceId`.
 */
export function portOwnerType(owner: string | undefined): string | undefined {
  if (owner === undefined) return undefined;
  if (owner.startsWith('compute:')) return 'ecs.cloudservers';
  if (owner.startsWith('neutron:LOADBALANCER')) return 'elb.loadbalancers';
  return undefined;
}

/**
 * The resource an EIP is bound to. For a port binding (`associateInstanceType`
 * PORT) `associateInstanceId` is the port, which RMS does not list; the RMS
 * `vnic` names the owner: `instanceId` for a virtual IP of a service (for
 * example a CCE cluster, `instanceType` CCE), else `deviceId`, the server of
 * a `compute:*` port (live 2026-11-06: 8 of 9 port-bound EIPs have their
 * server in the RMS inventory, the ninth its CCE cluster).
 */
function eipTarget(p: Doc): { bound?: string; boundType?: string; owner?: string } {
  const assoc = str(p['associateInstanceId']);
  const vnic = obj(p['vnic']);
  const owner = str(vnic['deviceOwner']);
  if (str(p['associateInstanceType']) !== 'PORT' || assoc === undefined) return { ...(assoc ? { bound: assoc } : {}), ...(owner ? { owner } : {}) };
  const instance = str(vnic['instanceId']);
  const device = str(vnic['deviceId']);
  const boundType = portOwnerType(owner);
  const bound = instance ?? (boundType !== undefined ? device : undefined) ?? assoc;
  return { bound, ...(boundType ? { boundType } : {}), ...(owner ? { owner } : {}) };
}

/**
 * #3954: `min_ssl_version` of an APIG custom domain to its TLS floor (APIG API
 * reference, "Querying API Groups", `url_domains[].min_ssl_version`: TLSv1.1
 * or TLSv1.2, default TLSv1.1).
 */
export function apigTlsFloor(v: string | undefined): '1.1' | '1.2' | undefined {
  if (v === undefined) return '1.1';
  if (/^TLSv1\.2$/i.test(v)) return '1.2';
  if (/^TLSv1\.1$/i.test(v)) return '1.1';
  return undefined;
}

const APIG_TLS_PROTOCOLS = new Set(['HTTPS', 'GRPCS']);
const APIG_PLAIN_PROTOCOLS = new Set(['HTTP', 'BOTH']);

/**
 * #3954: API Gateway (dedicated instance) APIs in transit (APIG API
 * reference, "Querying APIs": `req_protocol` HTTP, HTTPS, BOTH or GRPCS;
 * "Querying API Groups": `url_domains[].min_ssl_version`). One item per API:
 * an API that accepts HTTP (HTTP or BOTH) is not encrypted; an HTTPS or GRPCS
 * API is encrypted, with the lowest `min_ssl_version` of its group's custom
 * domains as the floor. A group without a custom domain serves on its
 * automatically allocated subdomain, whose TLS floor no read-only API shows:
 * the API is encrypted without a floor (undecided, never a pass). A gateway
 * that publishes no API carries no traffic: one item for the instance with
 * `published_apis: 0` covers it without a verdict (live 2026-11-06: one
 * instance, one group without a custom domain, no API).
 */
export function apigInTransit(apis: readonly Doc[], groups: readonly Doc[], region: string, instance?: { id: string }): EncryptionItem[] {
  if (apis.length === 0 && instance !== undefined) {
    return [{ resource_id: instance.id, type: 'apig.instances', service_code: 'apig', region, layer: 'in_transit', attributes: { published_apis: 0, api_groups: groups.length } }];
  }
  const floorOf = new Map<string, '1.1' | '1.2' | undefined>();
  for (const g of groups) {
    const gid = str(g['id']);
    if (!gid) continue;
    const floors = arr(g['url_domains']).map((d) => apigTlsFloor(str(d['min_ssl_version'])));
    if (floors.length === 0 || floors.some((f) => f === undefined)) { floorOf.set(gid, undefined); continue; }
    floorOf.set(gid, floors.includes('1.1') ? '1.1' : '1.2');
  }
  return apis.filter((a) => str(a['id'])).map((a) => {
    const protocol = (str(a['req_protocol']) ?? '').toUpperCase();
    const floor = APIG_TLS_PROTOCOLS.has(protocol) ? floorOf.get(str(a['group_id']) ?? '') : undefined;
    return {
      resource_id: a['id'] as string,
      type: 'apig.apis',
      service_code: 'apig',
      region,
      layer: 'in_transit' as const,
      ...(APIG_TLS_PROTOCOLS.has(protocol) ? { encrypted: true } : APIG_PLAIN_PROTOCOLS.has(protocol) ? { encrypted: false } : {}),
      ...(floor ? { min_tls_version: floor } : {}),
      ...(protocol ? { attributes: { req_protocol: protocol } } : {}),
    };
  });
}

/** VPC elastic IPs (bound or not) and load balancers with an EIP are public. */
export function exposureFacts(resources: readonly RmsResource[]): ExposureItem[] {
  const out: ExposureItem[] = [];
  for (const r of resources) {
    if (!r.id) continue;
    const p = obj(r.properties);
    if (kindOf(r) === 'vpc.publicips') {
      const t = eipTarget(p);
      const attrs = {
        ...(t.boundType ? { bound_type: t.boundType } : {}),
        ...(t.owner ? { device_owner: t.owner } : {}),
        ...(str(p['associateInstanceType']) ? { associate_instance_type: p['associateInstanceType'] as string } : {}),
      };
      out.push({ ...base(r), exposure: 'public_ip', public: true, ...(t.bound ? { bound_to: t.bound } : {}), ...(Object.keys(attrs).length > 0 ? { attributes: attrs } : {}) });
    } else if (kindOf(r) === 'elb.loadbalancers') {
      const eips = [...arr(p['eips']), ...arr(p['publicips'])];
      out.push({ ...base(r), exposure: 'internet_endpoint', public: eips.length > 0 });
    }
  }
  return out;
}

const port = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 65535 ? v : undefined);

/**
 * VPC security group rules (RMS `security_group_rules`, VPC API reference
 * "Querying Security Group Rules"): inbound rules only. A rule with neither
 * `remote_ip_prefix` nor `remote_group_id` admits any source of its
 * ethertype; a null protocol is any protocol; null ports are all ports.
 */
export function ingressRules(resources: readonly RmsResource[]): IngressItem[] {
  const out: IngressItem[] = [];
  for (const r of resources) {
    if (!r.id || kindOf(r) !== 'vpc.securityGroups') continue;
    for (const rule of arr(obj(r.properties)['security_group_rules'])) {
      if (str(rule['direction']) !== 'ingress') continue;
      const group = str(rule['remote_group_id']);
      const cidr = str(rule['remote_ip_prefix']) ?? (group === undefined ? (str(rule['ethertype']) === 'IPv6' ? '::/0' : '0.0.0.0/0') : undefined);
      const from = port(rule['port_range_min']);
      const to = port(rule['port_range_max']);
      out.push({
        ...base(r),
        protocol: str(rule['protocol']) ?? 'any',
        ...(from !== undefined ? { port_from: from } : {}),
        ...(to !== undefined && (from === undefined || to >= from) ? { port_to: to } : {}),
        ...(cidr ? { remote_cidr: cidr } : {}),
        ...(group ? { remote_group_id: group } : {}),
        action: str(rule['action']) === 'deny' ? 'deny' as const : 'allow' as const,
      });
    }
  }
  return out;
}

const DAY_MS = 86_400_000;
function ageDays(created: unknown, now: number): number | undefined {
  const t = typeof created === 'number' ? created : typeof created === 'string' ? Date.parse(created.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(created) ? created : `${created}Z`) : Number.NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : undefined;
}

export interface IdentityInput {
  users: readonly RmsResource[];
  /** Ids of groups whose roles allow a non-read action; undefined when the role queries were not readable. */
  privilegedGroups: ReadonlySet<string> | undefined;
  now: number;
}

/**
 * IAM users from RMS. A user is privileged when one of their groups holds a
 * role with a non-read action (otc-probe.ts analyseRoles). A second factor at
 * login is a virtual MFA device or enabled login protection (IAM user guide,
 * "Login Protection"). Counts and ages only, no principal (Design 120 section 6.4).
 */
export function identityFacts(input: IdentityInput): Omit<NonNullable<Posture['identity']>, 'source'> {
  const users = input.users.filter((u) => kindOf(u) === 'iam.users');
  const credentials: { kind: 'access_key'; active: boolean; age_days: number }[] = [];
  let privileged = 0;
  let withoutMfa = 0;
  for (const u of users) {
    const p = obj(u.properties);
    for (const c of arr(p['credentials'])) {
      const age = ageDays(c['create_time'], input.now);
      if (age !== undefined) credentials.push({ kind: 'access_key', active: str(c['status']) === 'active', age_days: age });
    }
    if (input.privilegedGroups === undefined) continue;
    const groups = Array.isArray(p['group_list']) ? (p['group_list'] as unknown[]).filter((g): g is string => typeof g === 'string') : [];
    if (!groups.some((g) => input.privilegedGroups?.has(g))) continue;
    privileged++;
    const mfa = p['virtual_mfa_device'] === true || obj(p['login_protect'])['enabled'] === true;
    if (!mfa) withoutMfa++;
  }
  return {
    ...(input.privilegedGroups !== undefined ? { privileged_principals: privileged, privileged_without_mfa: withoutMfa, mfa_required_for_privileged: withoutMfa === 0 } : {}),
    credentials,
  };
}

/** CTS trackers: one trail per tracker; OBS transfer lifecycle in days is the retention (CTS API reference, tracker `obs_info.bucket_lifecycle`). */
export function loggingTrails(trackers: readonly Doc[], region: string): NonNullable<NonNullable<Posture['logging']>['trails']> {
  return trackers.map((t) => {
    const lifecycle = obj(t['obs_info'])['bucket_lifecycle'];
    const attributes = flattenAttributes(t, { omit: ['id', 'status', ...OTC_SCOPE_ID_KEYS] });
    return {
      ...(str(t['id']) ? { resource_id: t['id'] as string } : {}),
      region,
      enabled: str(t['status']) === 'enabled',
      ...(typeof lifecycle === 'number' && Number.isInteger(lifecycle) && lifecycle > 0 ? { retention_days: lifecycle } : {}),
      ...(attributes ? { attributes } : {}),
    };
  });
}

/** Stateful resource kinds a backup policy is expected for (CBR protects servers and disks). */
export const OTC_BACKUP_KINDS: readonly string[] = ['ecs.cloudservers', 'evs.volumes'];

/**
 * CBR (CBR API reference, "Querying the Vault List" and "Querying the Policy
 * List"): a server or disk is protected when a vault lists it; its policy is
 * the backup policy associated with that vault, the retention that policy's
 * `operation_definition.retention_duration_days`.
 */
export function backupFacts(resources: readonly RmsResource[], vaults: readonly Doc[], policies: readonly Doc[]): BackupItem[] {
  const policyOfVault = new Map<string, Doc>();
  for (const p of policies) {
    if (str(p['operation_type']) !== undefined && str(p['operation_type']) !== 'backup') continue;
    for (const a of arr(p['associated_vaults'])) {
      const v = str(a['vault_id']);
      if (v && !policyOfVault.has(v)) policyOfVault.set(v, p);
    }
  }
  const vaultOf = new Map<string, string>();
  for (const v of vaults) {
    const vid = str(v['id']);
    if (!vid) continue;
    for (const res of arr(v['resources'])) {
      const rid = str(res['id']);
      if (rid && !vaultOf.has(rid)) vaultOf.set(rid, vid);
    }
  }
  return resources.filter((r) => r.id && OTC_BACKUP_KINDS.includes(kindOf(r))).map((r) => {
    const vault = vaultOf.get(r.id as string);
    const policy = vault === undefined ? undefined : policyOfVault.get(vault);
    const retention = obj(policy?.['operation_definition'])['retention_duration_days'];
    return {
      ...base(r),
      protected: vault !== undefined,
      ...(policy && str(policy['id']) ? { policy_id: policy['id'] as string } : {}),
      ...(typeof retention === 'number' && Number.isInteger(retention) && retention >= 0 ? { retention_days: retention } : {}),
    };
  });
}
