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

// #3868 (Design 123 section 5.4, Azure table): pure mappings from Azure
// Resource Graph rows to `estate.posture` facts (#3864). The HTTP side is
// `listPosture` in azure-driver.ts. Mock-verified only: there is no Azure
// environment (Q-21), so no live tenant answered any of this.
//
// Resource Graph `data` is untyped in the spec (QueryResponse), and the
// pack's spec subset holds only the Resource Graph envelope. The property
// names and enum values below were checked on 2026-11-06 against the
// Microsoft Learn REST API reference pages, which are generated from
// azure-rest-api-specs (Disks - Get, Storage Accounts - Get Properties,
// PostgreSQL Servers - Get, SQL Servers - Get, Redis - Get, Public IP
// Addresses - Get, Network Security Groups - Get), not against the pinned
// commit of the mock pack:
// - Microsoft.Compute Disk: `encryption.type` (EncryptionAtRestWithPlatformKey,
//   EncryptionAtRestWithCustomerKey, EncryptionAtRestWithPlatformAndCustomerKeys),
//   `encryption.diskEncryptionSetId`;
// - Microsoft.Storage StorageAccount: `encryption.keySource` (Microsoft.Storage,
//   Microsoft.Keyvault), `encryption.keyvaultproperties`, `minimumTlsVersion`
//   (TLS1_0 to TLS1_3), `supportsHttpsTrafficOnly`, `allowBlobPublicAccess`,
//   `publicNetworkAccess`;
// - Microsoft.DBforPostgreSQL flexible server: `dataEncryption.type`
//   (SystemManaged, AzureKeyVault), `dataEncryption.primaryKeyURI`;
// - Microsoft.Sql server: `minimalTlsVersion` ("1.0" to "1.3", "None");
// - Microsoft.Cache Redis: `minimumTlsVersion` ("1.0" to "1.2"), `enableNonSslPort`;
// - Microsoft.Network PublicIPAddress: `ipConfiguration.id`;
// - Microsoft.Network NetworkSecurityGroup: `securityRules[].properties`
//   (`direction`, `access`, `protocol`, `sourceAddressPrefix(es)`,
//   `sourceApplicationSecurityGroups`, `destinationPortRange(s)`);
// - the RecoveryServicesResources table (Microsoft Learn "Query your backups
//   using Azure Resource Graph"): protected items
//   (`microsoft.recoveryservices/vaults/backupfabrics/protectioncontainers/protecteditems`,
//   `sourceResourceId`, `policyId`, `protectionState` or `currentProtectionState`)
//   and backup policies (`microsoft.recoveryservices/vaults/backuppolicies`,
//   `retentionPolicy.dailySchedule.retentionDuration`).

import type { LzLivePostureInput } from '@swao/core';

type Doc = Record<string, unknown>;
type Posture = LzLivePostureInput;
type Item<B extends 'encryption' | 'exposure' | 'ingress_rules' | 'backup' | 'budgets'> = NonNullable<NonNullable<Posture[B]>['items']>[number];
type Tls = '1.0' | '1.1' | '1.2' | '1.3';

const obj = (v: unknown): Doc => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : {});
const arr = (v: unknown): Doc[] => (Array.isArray(v) ? v.filter((x): x is Doc => x !== null && typeof x === 'object' && !Array.isArray(x)) : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);
const props = (row: Doc): Doc => obj(row['properties']);
const typeOf = (row: Doc): string => (str(row['type']) ?? '').toLowerCase();
const base = (row: Doc): { resource_id: string; type: string; service_code: string; region?: string } => {
  const type = typeOf(row);
  const region = str(row['location']);
  return { resource_id: row['id'] as string, type, service_code: type, ...(region ? { region } : {}) };
};
const withId = (rows: readonly Doc[], type: string): Doc[] => rows.filter((r) => typeOf(r) === type && str(r['id']) !== undefined);

export const AZURE_POSTURE_TYPES = {
  disk: 'microsoft.compute/disks',
  vm: 'microsoft.compute/virtualmachines',
  storage: 'microsoft.storage/storageaccounts',
  postgres: 'microsoft.dbforpostgresql/flexibleservers',
  sql: 'microsoft.sql/servers',
  redis: 'microsoft.cache/redis',
  publicIp: 'microsoft.network/publicipaddresses',
  nsg: 'microsoft.network/networksecuritygroups',
  protectedItem: 'microsoft.recoveryservices/vaults/backupfabrics/protectioncontainers/protecteditems',
  backupPolicy: 'microsoft.recoveryservices/vaults/backuppolicies',
} as const;

/** `TLS1_2` (Storage), `1.2` (SQL, Redis) -> `1.2`; `None` and unknown values -> undefined. */
export function tlsVersion(v: unknown): Tls | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  const m = /^(?:TLS)?1[._]([0-3])$/i.exec(s);
  return m ? (`1.${m[1]}` as Tls) : undefined;
}

/**
 * At rest: managed disks, storage accounts and PostgreSQL flexible servers.
 * Azure encrypts all three always (`encrypted: true` when the encryption
 * block is present); the custody is customer-managed when a customer key
 * (disk encryption set, Key Vault key) is configured.
 */
export function atRestFacts(rows: readonly Doc[]): Item<'encryption'>[] {
  const T = AZURE_POSTURE_TYPES;
  const out: Item<'encryption'>[] = [];
  for (const r of withId(rows, T.disk)) {
    const enc = obj(props(r)['encryption']);
    const kind = str(enc['type']);
    const des = str(enc['diskEncryptionSetId']);
    const customer = kind !== undefined && /CustomerKey/i.test(kind);
    out.push({
      ...base(r), layer: 'at_rest',
      ...(kind ? { encrypted: true, key_custody: customer ? 'customer-managed' as const : 'provider-managed' as const } : {}),
      ...(customer && des ? { key_id: des } : {}),
      ...(kind ? { attributes: { encryption_type: kind } } : {}),
    });
  }
  for (const r of withId(rows, T.storage)) {
    const enc = obj(props(r)['encryption']);
    const source = str(enc['keySource']);
    const kv = obj(enc['keyvaultproperties']);
    const uri = str(kv['keyvaulturi']);
    const name = str(kv['keyname']);
    const customer = source !== undefined && source.toLowerCase() === 'microsoft.keyvault';
    out.push({
      ...base(r), layer: 'at_rest',
      ...(source ? { encrypted: true, key_custody: customer ? 'customer-managed' as const : 'provider-managed' as const } : {}),
      ...(customer && name ? { key_id: uri ? `${uri.replace(/\/+$/, '')}/keys/${name}` : name } : {}),
    });
  }
  for (const r of withId(rows, T.postgres)) {
    const enc = obj(props(r)['dataEncryption']);
    const kind = str(enc['type']);
    const key = str(enc['primaryKeyURI']);
    const customer = kind === 'AzureKeyVault';
    out.push({
      ...base(r), layer: 'at_rest',
      ...(kind ? { encrypted: true, key_custody: customer ? 'customer-managed' as const : 'provider-managed' as const } : {}),
      ...(customer && key ? { key_id: key } : {}),
    });
  }
  return out;
}

/**
 * In transit: the TLS floor of storage accounts (`minimumTlsVersion`, HTTPS
 * only), SQL servers (`minimalTlsVersion`) and Redis caches
 * (`minimumTlsVersion`, non-TLS port). `encrypted` is false when plain
 * traffic is accepted, true when it is refused, absent when the row does
 * not tell.
 */
export function inTransitFacts(rows: readonly Doc[]): Item<'encryption'>[] {
  const T = AZURE_POSTURE_TYPES;
  const out: Item<'encryption'>[] = [];
  const push = (r: Doc, tls: unknown, encrypted: boolean | undefined): void => {
    const floor = tlsVersion(tls);
    out.push({ ...base(r), layer: 'in_transit', ...(encrypted !== undefined ? { encrypted } : {}), ...(floor ? { min_tls_version: floor } : {}) });
  };
  for (const r of withId(rows, T.storage)) {
    const p = props(r);
    push(r, p['minimumTlsVersion'], typeof p['supportsHttpsTrafficOnly'] === 'boolean' ? p['supportsHttpsTrafficOnly'] : undefined);
  }
  for (const r of withId(rows, T.sql)) {
    const p = props(r);
    push(r, p['minimalTlsVersion'], tlsVersion(p['minimalTlsVersion']) !== undefined ? true : undefined);
  }
  for (const r of withId(rows, T.redis)) {
    const p = props(r);
    push(r, p['minimumTlsVersion'], typeof p['enableNonSslPort'] === 'boolean' ? !p['enableNonSslPort'] : undefined);
  }
  return out;
}

/** The resource an ip configuration id belongs to (`.../networkInterfaces/nic1/ipConfigurations/ip1` -> the NIC). */
export function owningResource(ipConfigurationId: string): string {
  return ipConfigurationId.replace(/\/(?:ipConfigurations|frontendIPConfigurations|frontendIpConfigurations)\/[^/]+$/i, '');
}

/**
 * Exposure: every public IP address (bound when `ipConfiguration` names
 * one) and storage accounts that allow anonymous blob access on a public
 * network endpoint.
 */
export function exposureFacts(rows: readonly Doc[]): Item<'exposure'>[] {
  const T = AZURE_POSTURE_TYPES;
  const out: Item<'exposure'>[] = [];
  for (const r of withId(rows, T.publicIp)) {
    const cfg = str(obj(props(r)['ipConfiguration'])['id']);
    out.push({ ...base(r), exposure: 'public_ip', public: true, ...(cfg ? { bound_to: owningResource(cfg) } : {}) });
  }
  for (const r of withId(rows, T.storage)) {
    const p = props(r);
    if (typeof p['allowBlobPublicAccess'] !== 'boolean' && str(p['publicNetworkAccess']) === undefined) continue;
    const networkOpen = str(p['publicNetworkAccess']) !== 'Disabled';
    out.push({ ...base(r), exposure: 'public_storage', public: p['allowBlobPublicAccess'] === true && networkOpen });
  }
  return out;
}

/** Address prefixes that mean "any source": `*`, `Any`, `Internet` and the all-zero CIDRs. */
const ANY_SOURCE = new Set(['*', 'any', 'internet', '0.0.0.0/0', '0.0.0.0', '::/0']);
const CIDR_OR_IP = /^[0-9a-f.:]+(?:\/\d{1,3})?$/i;

function portRange(v: string): { port_from?: number; port_to?: number } | null {
  if (v === '*') return {};
  const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(v.trim());
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  return from <= 65535 && to <= 65535 && from <= to ? { port_from: from, port_to: to } : null;
}

/**
 * Network security group rules, inbound only, both Allow and Deny (Azure
 * evaluates them by priority; `priority` is kept as an attribute). One entry
 * per source and port range of a rule. A source of `*`, `Any` or `Internet`
 * is `0.0.0.0/0`; a CIDR or address is kept; another service tag
 * (`VirtualNetwork`, `AzureLoadBalancer`, ...) is no CIDR and is kept as the
 * attribute `source_service_tag`; an application security group is the
 * remote group. The default rules (`defaultSecurityRules`) admit only the
 * virtual network and the load balancer and are not listed.
 */
export function ingressRules(rows: readonly Doc[]): Item<'ingress_rules'>[] {
  const out: Item<'ingress_rules'>[] = [];
  for (const nsg of withId(rows, AZURE_POSTURE_TYPES.nsg)) {
    for (const rule of arr(props(nsg)['securityRules'])) {
      const p = obj(rule['properties']);
      if (str(p['direction']) !== 'Inbound') continue;
      const access = str(p['access']);
      const action = access === 'Deny' ? 'deny' as const : 'allow' as const;
      const proto = str(p['protocol']);
      const protocol = proto === undefined || proto === '*' ? 'any' : proto.toLowerCase();
      const priority = typeof p['priority'] === 'number' ? p['priority'] : undefined;
      const ports = [...strs(p['destinationPortRanges']), ...(str(p['destinationPortRange']) ? [p['destinationPortRange'] as string] : [])];
      const ranges = (ports.length > 0 ? ports : ['*']).map(portRange).filter((x): x is NonNullable<ReturnType<typeof portRange>> => x !== null);
      const sources: { remote_cidr?: string; remote_group_id?: string; tag?: string }[] = [];
      for (const s of [...strs(p['sourceAddressPrefixes']), ...(str(p['sourceAddressPrefix']) ? [p['sourceAddressPrefix'] as string] : [])]) {
        if (ANY_SOURCE.has(s.toLowerCase())) sources.push({ remote_cidr: s.includes(':') ? '::/0' : '0.0.0.0/0' });
        else if (CIDR_OR_IP.test(s)) sources.push({ remote_cidr: s });
        else sources.push({ tag: s });
      }
      for (const g of arr(p['sourceApplicationSecurityGroups'])) {
        const id = str(g['id']);
        if (id) sources.push({ remote_group_id: id });
      }
      for (const src of sources) {
        for (const range of ranges) {
          const attributes = { ...(priority !== undefined ? { priority } : {}), ...(src.tag ? { source_service_tag: src.tag } : {}) };
          out.push({
            ...base(nsg),
            protocol,
            ...range,
            ...(src.remote_cidr ? { remote_cidr: src.remote_cidr } : {}),
            ...(src.remote_group_id ? { remote_group_id: src.remote_group_id } : {}),
            action,
            ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
          });
        }
      }
    }
  }
  return out;
}

/** Protection states of a protected item that mean the item is no longer backed up. */
const NOT_PROTECTED = new Set(['protectionstopped', 'softdeleted', 'protectionpaused', 'invalid', 'configuringprotectionfailed']);

/** Daily retention of a backup policy in days (`retentionPolicy.dailySchedule.retentionDuration`, `durationType: Days`). */
export function dailyRetentionDays(policy: Doc): number | undefined {
  const d = obj(obj(obj(props(policy)['retentionPolicy'])['dailySchedule'])['retentionDuration']);
  const n = d['count'];
  return str(d['durationType']) === 'Days' && typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Backup of virtual machines: a VM is protected when a Recovery Services
 * protected item names it (`sourceResourceId`, compared case-insensitively)
 * in a state that still backs it up; the retention is the daily retention of
 * the item's backup policy when that policy row is readable.
 */
export function backupFacts(resources: readonly Doc[], recovery: readonly Doc[]): Item<'backup'>[] {
  const T = AZURE_POSTURE_TYPES;
  const policies = new Map<string, Doc>();
  for (const p of withId(recovery, T.backupPolicy)) policies.set((p['id'] as string).toLowerCase(), p);
  const items = new Map<string, Doc>();
  for (const it of withId(recovery, T.protectedItem)) {
    const p = props(it);
    const src = str(p['sourceResourceId']);
    const state = (str(p['currentProtectionState']) ?? str(p['protectionState']) ?? '').toLowerCase();
    if (src && !NOT_PROTECTED.has(state) && !items.has(src.toLowerCase())) items.set(src.toLowerCase(), p);
  }
  return withId(resources, T.vm).map((vm) => {
    const item = items.get((vm['id'] as string).toLowerCase());
    const policyId = item ? str(item['policyId']) : undefined;
    const policy = policyId ? policies.get(policyId.toLowerCase()) : undefined;
    const retention = policy ? dailyRetentionDays(policy) : undefined;
    return {
      ...base(vm),
      protected: item !== undefined,
      ...(policyId ? { policy_id: policyId } : {}),
      ...(retention !== undefined ? { retention_days: retention } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// #3940: subscription activity log diagnostic settings and budgets
// (SubscriptionDiagnosticSettings_List 2021-05-01-preview, Budgets_List
// 2026-06-01; shapes from the spec subset of the mock pack, extracted from
// azure-rest-api-specs at the pinned commit).
// ---------------------------------------------------------------------------

type Trail = NonNullable<NonNullable<Posture['logging']>['trails']>[number];

/** Destinations of a diagnostic setting (SubscriptionDiagnosticSettings properties). */
const DESTINATIONS = ['workspaceId', 'storageAccountId', 'eventHubAuthorizationRuleId', 'serviceBusRuleId', 'marketplacePartnerId'] as const;

/**
 * One trail per subscription diagnostic setting. It is enabled when the
 * setting sends the `Administrative` category (the control-plane audit log),
 * or the `allLogs` category group, to at least one destination. The activity
 * log covers the whole subscription, so `all_regions` is true. The retention
 * is the `retentionInDays` of the Log Analytics workspace the setting names
 * (Workspaces - Get), matched case-insensitively against the inventory rows;
 * without that row no retention is claimed (subscription diagnostic settings
 * carry no retention policy of their own).
 */
export function loggingTrails(settings: readonly Doc[], rows: readonly Doc[]): Trail[] {
  const retention = new Map<string, number>();
  for (const w of withId(rows, 'microsoft.operationalinsights/workspaces')) {
    const d = props(w)['retentionInDays'];
    if (typeof d === 'number' && Number.isInteger(d) && d >= 0) retention.set((w['id'] as string).toLowerCase(), d);
  }
  return settings.map((s) => {
    const p = props(s);
    const destinations = DESTINATIONS.filter((k) => str(p[k]) !== undefined);
    const audit = arr(p['logs']).some((l) => l['enabled'] === true && (str(l['category']) === 'Administrative' || str(l['categoryGroup'])?.toLowerCase() === 'alllogs'));
    const workspace = str(p['workspaceId'])?.toLowerCase();
    const days = workspace === undefined ? undefined : retention.get(workspace);
    const id = str(s['id']);
    return {
      ...(id ? { resource_id: id } : {}),
      all_regions: true,
      enabled: audit && destinations.length > 0,
      ...(days !== undefined ? { retention_days: days } : {}),
      ...(destinations.length > 0 ? { attributes: { destinations: destinations.join(',') } } : {}),
    };
  });
}

/**
 * #3936: `estate.posture.budgets` items from the subscription budgets
 * (Budgets_List, Microsoft.Consumption). Mapping (Design 123 section 5.4):
 * `id` -> resource_id; `properties.category` Cost / Usage -> budget_kind;
 * `amount` -> amount; `currentSpend.unit` -> currency; `timeGrain` Monthly /
 * BillingMonth -> monthly, Quarterly / BillingQuarter -> quarterly, Annually /
 * BillingAnnual -> annually, else custom; each entry of
 * `properties.notifications` -> one alert: `threshold` (percent of the
 * amount), `thresholdType` Forecasted -> forecasted, else actual, `enabled`,
 * and the number of `contactEmails`, `contactRoles` and `contactGroups` as
 * `recipients`. The contacts themselves are personal data and never enter the
 * block; only their count does.
 */
export function budgetPostureItems(budgets: readonly Doc[], subscription: string): NonNullable<NonNullable<Posture['budgets']>['items']> {
  const PERIOD: Readonly<Record<string, 'monthly' | 'quarterly' | 'annually'>> = { monthly: 'monthly', billingmonth: 'monthly', quarterly: 'quarterly', billingquarter: 'quarterly', annually: 'annually', billingannual: 'annually' };
  return budgets.filter((b) => str(b['id']) !== undefined).map((b) => {
    const p = props(b);
    const category = str(p['category'])?.toLowerCase();
    const grain = str(p['timeGrain']);
    const unit = str(obj(p['currentSpend'])['unit']);
    const alerts = Object.values(obj(p['notifications'])).map(obj).filter((n) => typeof n['threshold'] === 'number' && (n['threshold'] as number) >= 0).map((n) => ({
      threshold: n['threshold'] as number,
      threshold_type: 'percentage' as const,
      basis: str(n['thresholdType'])?.toLowerCase() === 'forecasted' ? 'forecasted' as const : 'actual' as const,
      recipients: ['contactEmails', 'contactRoles', 'contactGroups'].reduce((sum, k) => sum + (Array.isArray(n[k]) ? (n[k] as unknown[]).length : 0), 0),
      enabled: n['enabled'] === true,
    })).sort((x, y) => x.threshold - y.threshold);
    return {
      resource_id: b['id'] as string,
      type: 'microsoft.consumption/budgets',
      scope: subscription,
      budget_kind: category === 'cost' ? 'cost' as const : category === 'usage' ? 'usage' as const : 'other' as const,
      ...(typeof p['amount'] === 'number' && p['amount'] >= 0 ? { amount: p['amount'] } : {}),
      ...(unit ? { currency: unit } : {}),
      ...(grain ? { period: PERIOD[grain.toLowerCase()] ?? 'custom' as const } : {}),
      alerts,
    };
  });
}

/**
 * #3940: budget facts of the subscription (Budgets_List). Counts and
 * thresholds only: the notification contacts (`contactEmails`,
 * `contactRoles`, `contactGroups`) are personal data and are dropped.
 * Summary facts returned by `readAzureBudgets`; `estate.posture.budgets`
 * is filled by `budgetPostureItems` (#3936).
 */
export interface AzureBudgetFact {
  resource_id: string;
  amount?: number;
  time_grain?: string;
  category?: string;
  /** Notifications with `enabled: true`. */
  notifications_enabled: number;
  /** Thresholds (percent) of the enabled notifications, ascending. */
  thresholds: number[];
}

export function budgetFacts(budgets: readonly Doc[]): AzureBudgetFact[] {
  return budgets.filter((b) => str(b['id']) !== undefined).map((b) => {
    const p = props(b);
    const enabled = Object.values(obj(p['notifications'])).map(obj).filter((n) => n['enabled'] === true);
    const thresholds = enabled.map((n) => n['threshold']).filter((t): t is number => typeof t === 'number').sort((x, y) => x - y);
    const grain = str(p['timeGrain']);
    const category = str(p['category']);
    return {
      resource_id: b['id'] as string,
      ...(typeof p['amount'] === 'number' ? { amount: p['amount'] } : {}),
      ...(grain ? { time_grain: grain } : {}),
      ...(category ? { category } : {}),
      notifications_enabled: enabled.length,
      thresholds,
    };
  });
}
