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

// #3575: the `azure` live driver (Design 120 sections 5.3, 6.3, 7.1 to 7.5).
// There is no Azure environment (Q-21, Design 121 section 13.1 P3): the
// driver is developed against the spec-derived Azure mock pack (#3600,
// swao/ops/mock-csp/providers/azure/) and stays unregistered for release
// (`liveVerified: false`). Wire formats as in azure-client.ts.
//
// Probe (Design 120 section 6.3): the role assignments of the principal
// (`$filter=principalId eq '{oid}'`, oid from the access token) and their role
// definitions; any action or data action outside `*/read` refuses the
// credential. No assignment found, or a definition that cannot be read,
// is `unverifiable` (role assignments of groups the principal belongs to are
// not returned by that filter as far as the spec says; Q-3600-4).
//
// Status per (region, service), Design 120 section 5.3, from the Providers
// List (`GET /subscriptions/{id}/providers`) and the catalogue alias table
// below (ARM namespace/type to catalogue code, `lz-catalogues/azure.json`):
// - provider `Registered` and the type lists the region -> `enabled`
// - provider `NotRegistered` and the type lists the region -> `available_not_enabled`
// - the type does not list the region -> `not_offered`
// - any other registration state (`Registering`, ...) -> `unknown`
// - an Azure Policy assignment with a Deny rule on the resource type
//   (`if: { field: type, equals | in }`, `then.effect: Deny`, the shape of the
//   spec example getBuiltinPolicyDefinition.json) -> `restricted`, unless
//   the assignment's enforcementMode is `DoNotEnforce`
// - providers list not readable -> `unknown` with the HTTP status
// - catalogue services without an alias -> `unknown` (`no-arm-mapping`)
// Provider locations are display names or names; both are normalised
// (lower case, spaces removed) before matching location names.
//
// Privacy (Design 120 section 6.4): resource names are not copied; tags go
// through the scan assembler's pseudonymisation (privacy.ts).

import type { LzLiveEvidence, LzLiveFactSource, LzLivePostureInput, LzLiveRegion, LzLiveRegionStatus, LzLiveScan, LzLiveService, LzServiceCatalogue } from '@swao/core';
import type { ActivityWindow, LiveLzDriver, ReadOnlyProbe, ScopeCtx } from '../types.js';
import { LiveAuthError, LiveSourceUnavailableError } from '../errors.js';
import { flattenAttributes } from '../attributes.js';
import { loadLzCatalogue, resolveLzCataloguesDir } from '../../catalogue/loader.js';
import { listAzureHierarchy, rememberAzureResources } from './azure-hierarchy.js';
import { atRestFacts, backupFacts, budgetFacts, budgetPostureItems, exposureFacts, inTransitFacts, ingressRules, loggingTrails } from './azure-posture.js';
import type { AzureBudgetFact } from './azure-posture.js';
import {
  AZURE_API_VERSIONS,
  AZURE_DEFAULT_ARM,
  AZURE_DEFAULT_LOGIN,
  AZURE_PROVIDER,
  AzureHttpError,
  armGet,
  armList,
  azureSubscription,
  azureToken,
  resourceGraph,
} from './azure-client.js';

type Estate = LzLiveScan['estate'];
type Doc = Record<string, any>;

export const AZURE_DRIVER_VERSION = '0.1.0';

/**
 * ARM `namespace/resourceType` -> catalogue code candidates (first present in
 * the region's catalogue wins). Editorial table of this driver, pinned to the
 * codes of `lz-catalogues/azure.json` by a test. The alias table that Design
 * 094 D-094-08 asks for does not exist in code yet (`fetch-azure.ts` keys on
 * Retail Prices service names only); this table is the driver's part of it.
 */
export const AZURE_ARM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'microsoft.compute/virtualmachines': ['Virtual Machines'],
  'microsoft.compute/disks': ['Managed Disks'],
  'microsoft.containerservice/managedclusters': ['Azure Kubernetes Service'],
  'microsoft.containerregistry/registries': ['Container Registry'],
  'microsoft.dbforpostgresql/flexibleservers': ['Azure Database for PostgreSQL'],
  'microsoft.dbformysql/flexibleservers': ['Azure Database for MySQL'],
  'microsoft.sql/servers': ['SQL Database', 'Azure SQL Database'],
  'microsoft.documentdb/databaseaccounts': ['Azure Cosmos DB'],
  'microsoft.cache/redis': ['Azure Cache for Redis', 'Redis Cache'],
  'microsoft.keyvault/vaults': ['Azure Key Vault', 'Key Vault'],
  'microsoft.storage/storageaccounts': ['Storage'],
  'microsoft.web/sites': ['App Service', 'Azure App Service'],
  'microsoft.eventhub/namespaces': ['Event Hubs'],
  'microsoft.servicebus/namespaces': ['Service Bus'],
  'microsoft.operationalinsights/workspaces': ['Log Analytics'],
  'microsoft.network/virtualnetworks': ['Virtual Network'],
  'microsoft.network/applicationgateways': ['Application Gateway'],
  'microsoft.network/azurefirewalls': ['Azure Firewall'],
};

/**
 * Capability tag corrections of 094 D-094-08: the catalogue maps the Azure SQL
 * Database codes to `postgresql` and `mysql` (lz-premium.ts
 * AZURE_SERVICE_FULFILLS), which is wrong for a SQL Server engine; the live
 * view carries no tags for them until the vocabulary has a SQL Server tag.
 */
export const AZURE_TAG_CORRECTIONS: Readonly<Record<string, readonly string[]>> = {
  'SQL Database': [],
  'Azure SQL Database': [],
};

const now = (): string => new Date().toISOString();
const norm = (location: string): string => location.toLowerCase().replace(/\s+/g, '');

function httpStatusOf(err: unknown): number | undefined {
  if (err instanceof AzureHttpError) return err.status === 0 ? undefined : err.status;
  if (err instanceof LiveAuthError) return err.httpStatus;
  if (err instanceof LiveSourceUnavailableError) return err.httpStatus;
  return undefined;
}

function recordSource(ctx: ScopeCtx, name: string, err: unknown): void {
  if (err instanceof LiveAuthError) throw err;
  const http = httpStatusOf(err);
  ctx.sources.push(http !== undefined
    ? { name, status: 'not_collected', http_status: http }
    : { name, status: 'not_collected', reason: err instanceof Error ? err.message : String(err) });
}

const memo = <T>(cache: WeakMap<ScopeCtx, Promise<T>>, ctx: ScopeCtx, fn: () => Promise<T>): Promise<T> => {
  let p = cache.get(ctx);
  if (!p) { p = fn(); cache.set(ctx, p); }
  return p;
};

let catalogueMemo: LzServiceCatalogue | null | undefined;
function azureCatalogue(): LzServiceCatalogue | null {
  if (catalogueMemo === undefined) {
    const dir = resolveLzCataloguesDir();
    try { catalogueMemo = dir ? loadLzCatalogue(dir, AZURE_PROVIDER) : null; } catch { catalogueMemo = null; }
  }
  return catalogueMemo;
}
export function setAzureCatalogueForTests(c: LzServiceCatalogue | null | undefined): void { catalogueMemo = c; }

const SUB = (ctx: ScopeCtx): string => `/subscriptions/${encodeURIComponent(azureSubscription(ctx))}`;

// ---------------------------------------------------------------------------
// probeReadOnly
// ---------------------------------------------------------------------------

export interface AzureRoleDefinition { roleName: string; actions: string[]; dataActions: string[] }

const isRead = (a: string): boolean => a.toLowerCase().endsWith('/read');

/** Read-only verdict from the principal's role definitions (Design 120 section 6.3: refuse on actions outside `*\/read`). */
export function probeFromRoles(roles: readonly AzureRoleDefinition[]): ReadOnlyProbe {
  const names = [...new Set(roles.map((r) => r.roleName))].sort();
  const identity = `service principal (roles: ${names.join(', ') || 'none'})`;
  if (roles.length === 0) {
    return { read_only: 'unverifiable', identity, reason: 'no role assignment of the principal at, above or below the subscription (group assignments are not listed, Q-3600-4)', write_actions_allowed: [], coverage: { readable: [], unreadable: [] } };
  }
  const writes = [...new Set(roles.flatMap((r) => [...r.actions, ...r.dataActions]).filter((a) => !isRead(a)))].sort();
  const reads = [...new Set(roles.flatMap((r) => r.actions).filter(isRead))].sort();
  if (writes.length > 0) {
    return { read_only: 'refused', identity, reason: `the principal's roles allow ${writes.length} action(s) outside */read`, write_actions_allowed: writes, coverage: { readable: reads, unreadable: [] } };
  }
  return { read_only: 'verified', identity, write_actions_allowed: [], coverage: { readable: reads, unreadable: [] } };
}

const ROLE_DEF_RE = /^\/subscriptions\/[^/]+\/providers\/Microsoft\.Authorization\/roleDefinitions\/[^/]+$/i;

async function probeReadOnly(ctx: ScopeCtx): Promise<ReadOnlyProbe> {
  const t = await azureToken(ctx);
  const unverifiable = (reason: string): ReadOnlyProbe => ({ read_only: 'unverifiable', identity: 'service principal', reason, write_actions_allowed: [], coverage: { readable: [], unreadable: [] } });
  if (!t.objectId) return unverifiable('the access token carries no oid claim, so the role assignments of the principal cannot be listed');
  let assignments: Doc[];
  try {
    assignments = await armList<Doc>(ctx, `${SUB(ctx)}/providers/Microsoft.Authorization/roleAssignments`, '/subscriptions/{subscription_id}/providers/Microsoft.Authorization/roleAssignments', AZURE_API_VERSIONS.authorization, { $filter: `principalId eq '${t.objectId}'` });
  } catch (err) {
    if (err instanceof LiveAuthError) throw err;
    return unverifiable(`the role assignments of the principal are not readable (HTTP ${httpStatusOf(err) ?? 'error'})`);
  }
  const roles: AzureRoleDefinition[] = [];
  for (const id of new Set(assignments.map((a) => String(a.properties?.roleDefinitionId ?? '')))) {
    if (!ROLE_DEF_RE.test(id)) return unverifiable(`role definition ${id === '' ? '(none)' : 'outside the subscription scope'} is not read by this driver`);
    let d: Doc;
    try {
      d = await armGet<Doc>(ctx, id, '/subscriptions/{subscription_id}/providers/Microsoft.Authorization/roleDefinitions/{role_definition_id}', AZURE_API_VERSIONS.authorization);
    } catch (err) {
      if (err instanceof LiveAuthError) throw err;
      return unverifiable(`a role definition of the principal is not readable (HTTP ${httpStatusOf(err) ?? 'error'})`);
    }
    const perms = (d.properties?.permissions ?? []) as Doc[];
    roles.push({
      roleName: String(d.properties?.roleName ?? 'role'),
      actions: perms.flatMap((p) => (p.actions ?? []) as string[]),
      dataActions: perms.flatMap((p) => (p.dataActions ?? []) as string[]),
    });
  }
  return probeFromRoles(roles);
}

// ---------------------------------------------------------------------------
// Offering
// ---------------------------------------------------------------------------

const locationCache = new WeakMap<ScopeCtx, Promise<Doc[]>>();
const locations = (ctx: ScopeCtx): Promise<Doc[]> => memo(locationCache, ctx, () => armList<Doc>(ctx, `${SUB(ctx)}/locations`, '/subscriptions/{subscription_id}/locations', AZURE_API_VERSIONS.subscriptions));

async function scopeRegions(ctx: ScopeCtx): Promise<string[]> {
  if (ctx.regions.length > 0) return [...ctx.regions];
  return (await locations(ctx)).filter((l) => l.metadata?.regionType !== 'Logical').map((l) => String(l.name)).sort();
}

async function listRegions(ctx: ScopeCtx): Promise<LzLiveRegion[]> {
  // Subscriptions_Get: a subscription that is not `Enabled` (SubscriptionState
  // enum of the spec) offers nothing usable; its regions are `unknown`.
  let state = 'Enabled';
  try {
    state = String((await armGet<Doc>(ctx, SUB(ctx), '/subscriptions/{subscription_id}', AZURE_API_VERSIONS.subscriptions)).state ?? 'Enabled');
  } catch (err) {
    recordSource(ctx, 'subscription', err);
  }
  if (state !== 'Enabled') ctx.sources.push({ name: 'subscription', status: 'not_collected', reason: `subscription state ${state}` });
  const all = await locations(ctx);
  const cat = azureCatalogue();
  const out: LzLiveRegion[] = [];
  for (const id of await scopeRegions(ctx)) {
    const l = all.find((x) => String(x.name) === id);
    const country = cat?.regions.find((r) => r.id === id)?.country;
    if (!l) { out.push({ id, ...(country ? { country } : {}), azs: [], status: 'not_offered' }); continue; }
    const azs = ((l.availabilityZoneMappings ?? []) as Doc[]).map((z) => ({ name: String(z.logicalZone), available: true }));
    out.push({ id, ...(country ? { country } : {}), azs, status: state === 'Enabled' ? 'enabled' : 'unknown' });
  }
  return out;
}

const providerCache = new WeakMap<ScopeCtx, Promise<Doc[]>>();
const providers = (ctx: ScopeCtx): Promise<Doc[]> => memo(providerCache, ctx, () => armList<Doc>(ctx, `${SUB(ctx)}/providers`, '/subscriptions/{subscription_id}/providers', AZURE_API_VERSIONS.providers));

// ---- Azure Policy ------------------------------------------------------------

/** Resource types (lower case) a policy rule denies, when the rule is a pure type condition with a Deny effect. */
export function deniedTypes(rule: unknown, definitionParams: Doc, assignmentParams: Doc): string[] {
  if (rule === null || typeof rule !== 'object') return [];
  const r = rule as Doc;
  const resolve = (v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    const m = /^\[parameters\('([^']+)'\)\]$/.exec(v);
    if (!m) return v;
    const name = m[1] as string;
    return assignmentParams?.[name]?.value ?? definitionParams?.[name]?.defaultValue;
  };
  const effect = resolve(r.then?.effect);
  if (typeof effect !== 'string' || effect.toLowerCase() !== 'deny') return [];
  const cond = r.if as Doc | undefined;
  if (!cond || cond.field !== 'type') return [];
  const value = resolve(cond.equals ?? cond.in);
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return list.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase());
}

interface PolicyView { assignments: Doc[]; denied: Map<string, string> }

const DEF_PATH_RE = /^(?:\/subscriptions\/[^/]+|\/providers\/Microsoft\.Management\/managementGroups\/[^/]+)?\/providers\/Microsoft\.Authorization\/policyDefinitions\/[^/]+$/i;

function definitionRoute(id: string): string {
  if (id.toLowerCase().startsWith('/subscriptions/')) return '/subscriptions/{subscription_id}/providers/Microsoft.Authorization/policyDefinitions/{policy_definition_name}';
  if (id.toLowerCase().startsWith('/providers/microsoft.management/')) return '/providers/Microsoft.Management/managementGroups/{management_group_id}/providers/Microsoft.Authorization/policyDefinitions/{policy_definition_name}';
  return '/providers/Microsoft.Authorization/policyDefinitions/{policy_definition_name}';
}

const policyCache = new WeakMap<ScopeCtx, Promise<PolicyView>>();
function policies(ctx: ScopeCtx): Promise<PolicyView> {
  return memo(policyCache, ctx, async () => {
    const assignments = await armList<Doc>(ctx, `${SUB(ctx)}/providers/Microsoft.Authorization/policyAssignments`, '/subscriptions/{subscription_id}/providers/Microsoft.Authorization/policyAssignments', AZURE_API_VERSIONS.policy, { $filter: 'atScope()' });
    const denied = new Map<string, string>();
    for (const a of assignments) {
      const defId = String(a.properties?.policyDefinitionId ?? '');
      a._definition = undefined;
      if (!DEF_PATH_RE.test(defId)) continue; // initiatives (policySetDefinitions) are not evaluated (#3575 open question)
      try {
        const d = await armGet<Doc>(ctx, defId, definitionRoute(defId), AZURE_API_VERSIONS.policy);
        a._definition = d;
        if (a.properties?.enforcementMode === 'DoNotEnforce') continue;
        for (const t of deniedTypes(d.properties?.policyRule, d.properties?.parameters ?? {}, a.properties?.parameters ?? {})) denied.set(t, String(a.name ?? 'assignment'));
      } catch (err) {
        recordSource(ctx, `guardrails:policy-definition:${String(a.name ?? '?')}`, err);
      }
    }
    return { assignments, denied };
  });
}

// ---- services -----------------------------------------------------------------

function statusFor(provider: Doc | undefined, type: string, region: string, denyBy: string | undefined, observed_at: string): LzLiveRegionStatus {
  if (!provider) return { status: 'unknown', evidence: [{ source: 'api', ref: `providers:${type}:not-listed` }], observed_at };
  const rt = ((provider.resourceTypes ?? []) as Doc[]).find((x) => String(x.resourceType).toLowerCase() === type.split('/')[1]);
  const offered = ((rt?.locations ?? []) as string[]).some((l) => norm(l) === norm(region));
  const state = String(provider.registrationState ?? '');
  const evidence: LzLiveEvidence[] = [{ source: 'api', ref: `providers:${String(provider.namespace)}:${state}` }];
  if (!offered) return { status: 'not_offered', evidence: [{ source: 'api', ref: `providers:${type}:locations` }], observed_at };
  if (denyBy !== undefined) return { status: 'restricted', evidence: [...evidence, { source: 'policy', ref: `policy-assignment:${denyBy}` }], observed_at };
  if (state === 'Registered') return { status: 'enabled', evidence, observed_at };
  if (state === 'NotRegistered') return { status: 'available_not_enabled', evidence, observed_at };
  return { status: 'unknown', evidence, observed_at };
}

async function listServices(ctx: ScopeCtx, region: string): Promise<LzLiveService[]> {
  const observed_at = now();
  const cat = azureCatalogue();
  if (!cat) throw new LiveSourceUnavailableError(`services:${region}`, undefined, 'the Azure catalogue (lz-catalogues/azure.json) was not found');
  const catRegion = cat.regions.find((r) => r.id === region);
  const codes = new Set((catRegion?.services ?? []).map((s) => s.code));
  let provs: Doc[] | undefined;
  let http: number | undefined;
  try {
    provs = await providers(ctx);
  } catch (err) {
    if (err instanceof LiveAuthError) throw err;
    http = httpStatusOf(err);
    recordSource(ctx, `providers:${region}`, err);
  }
  let denied = new Map<string, string>();
  try {
    denied = (await policies(ctx)).denied;
  } catch (err) {
    if (err instanceof LiveAuthError) throw err;
    // reported by listGuardrails; no service is `restricted` without the policy read
  }
  const out: LzLiveService[] = [];
  const covered = new Set<string>();
  for (const [type, candidates] of Object.entries(AZURE_ARM_ALIASES)) {
    const code = candidates.find((c) => codes.has(c));
    if (code === undefined) continue;
    covered.add(code);
    const entry = catRegion?.services.find((s) => s.code === code);
    const ns = type.split('/')[0] as string;
    const status: LzLiveRegionStatus = provs === undefined
      ? { status: 'unknown', evidence: [{ source: 'api', ref: 'providers', ...(http !== undefined ? { http_status: http } : {}) }], observed_at }
      : statusFor(provs.find((p) => String(p.namespace).toLowerCase() === ns), type, region, denied.get(type), observed_at);
    out.push({ code: type, name: code, capability_tags: [...(AZURE_TAG_CORRECTIONS[code] ?? entry?.fulfills ?? [])], catalogue_code: code, regions: { [region]: status }, frameworks: {} });
  }
  for (const s of catRegion?.services ?? []) {
    if (covered.has(s.code)) continue;
    out.push({ code: s.code, name: s.name ?? s.code, capability_tags: [...(AZURE_TAG_CORRECTIONS[s.code] ?? s.fulfills)], catalogue_code: s.code, regions: { [region]: { status: 'unknown', evidence: [{ source: 'api', ref: 'providers:no-arm-mapping' }], observed_at } }, frameworks: {} });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Estate
// ---------------------------------------------------------------------------

/**
 * Resource Graph query of the inventory; the mock serves the table, optionally
 * with `project`, and nothing else (Design 121 section 8.2). #3886 (Design 123
 * section 5.7): the bare table returns every column of a resource (before
 * #3886: `| project id, type, location, tags, subscriptionId`); the columns
 * without a normalised field go into `attributes`.
 */
export const AZURE_INVENTORY_QUERY = 'Resources';

/** Resource Graph columns mapped into normalised fields (the rest goes into `attributes`, #3886). */
export const AZURE_RESOURCE_NORMALISED_KEYS: readonly string[] = ['id', 'type', 'location', 'tags'];

/** #3868: one inventory read per scope run, shared by `listResources` and `listPosture`. */
const inventoryCache = new WeakMap<ScopeCtx, Promise<Doc[]>>();
const inventoryRows = (ctx: ScopeCtx): Promise<Doc[]> => memo(inventoryCache, ctx, async () => {
  const rows = await resourceGraph<Doc>(ctx, AZURE_INVENTORY_QUERY, [azureSubscription(ctx)]);
  // #3884: the hierarchy attaches these resources to their resource groups.
  rememberAzureResources(ctx, rows);
  return rows;
});

async function listResources(ctx: ScopeCtx): Promise<Estate['resources']> {
  let rows: Doc[];
  try {
    rows = await inventoryRows(ctx);
  } catch (err) {
    if (err instanceof LiveAuthError) throw err;
    throw new LiveSourceUnavailableError('inventory:resources', httpStatusOf(err), httpStatusOf(err) === undefined ? (err as Error).message : undefined);
  }
  return rows.filter((r) => typeof r.id === 'string' && typeof r.type === 'string').map((r) => {
    const type = String(r.type).toLowerCase();
    const tags = r.tags && typeof r.tags === 'object' ? Object.fromEntries(Object.entries(r.tags as Doc).map(([k, v]) => [k, String(v)])) : {};
    const attributes = flattenAttributes(r, { omit: AZURE_RESOURCE_NORMALISED_KEYS });
    return {
      id: String(r.id),
      type,
      service_code: AZURE_ARM_ALIASES[type] !== undefined ? type : (type.split('/')[0] as string),
      ...(typeof r.location === 'string' && r.location !== '' ? { region: r.location } : {}),
      ...(Object.keys(tags).length > 0 ? { tags } : {}),
      ...(attributes ? { attributes } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// #3868: posture (Design 123 section 5.4, Azure table; estate.posture of #3864)
// Mock-verified only (no Azure environment, Q-21); mappings in azure-posture.ts.
// ---------------------------------------------------------------------------

/** Resource Graph query of the backup facts (protected items and backup policies); the mock serves the whole table. */
export const AZURE_RECOVERY_QUERY = 'RecoveryServicesResources';

export const AZURE_POSTURE_ROUTES = {
  resourceGraph: '/providers/Microsoft.ResourceGraph/resources',
  // #3940: SubscriptionDiagnosticSettings_List and Budgets_List (GET list operations only).
  diagnosticSettings: '/subscriptions/{subscription_id}/providers/Microsoft.Insights/diagnosticSettings',
  budgets: '/subscriptions/{subscription_id}/providers/Microsoft.Consumption/budgets',
} as const;

/** #3940: the scope source name of `readAzureBudgets`; `listPosture` records the read in the budgets block instead (#3936). */
export const AZURE_BUDGETS_SOURCE = 'posture:budgets';

function failedSource(route: string, err: unknown): LzLiveFactSource {
  if (err instanceof LiveAuthError) throw err;
  const http = httpStatusOf(err);
  return { calls: [route], partial: false, status: 'not_collected', ...(http !== undefined ? { http_status: http } : { reason: err instanceof Error ? err.message : String(err) }) };
}
const graphSource = (err: unknown): LzLiveFactSource => failedSource(AZURE_POSTURE_ROUTES.resourceGraph, err);

/** Budgets_List of the scope subscription (throws on a failed read). */
function budgetDocs(ctx: ScopeCtx): Promise<Doc[]> {
  return armList<Doc>(ctx, `${SUB(ctx)}/providers/Microsoft.Consumption/budgets`, AZURE_POSTURE_ROUTES.budgets, AZURE_API_VERSIONS.budgets);
}

/**
 * #3940: the subscription budgets as summary facts, with the read recorded in
 * `sources` (`posture:budgets`: ok, or not_collected with the HTTP status).
 * `listPosture` fills `estate.posture.budgets` from the same read (#3936).
 */
export async function readAzureBudgets(ctx: ScopeCtx): Promise<AzureBudgetFact[] | undefined> {
  try {
    const budgets = await budgetDocs(ctx);
    ctx.sources.push({ name: AZURE_BUDGETS_SOURCE, status: 'ok' });
    return budgetFacts(budgets);
  } catch (err) {
    recordSource(ctx, AZURE_BUDGETS_SOURCE, err);
    return undefined;
  }
}

async function listPosture(ctx: ScopeCtx): Promise<LzLivePostureInput> {
  const ok: LzLiveFactSource = { calls: [AZURE_POSTURE_ROUTES.resourceGraph], partial: false, status: 'ok' };
  let rows: Doc[] | undefined;
  let inventoryErr: unknown;
  try {
    rows = await inventoryRows(ctx);
  } catch (err) {
    if (err instanceof LiveAuthError) throw err;
    inventoryErr = err;
  }

  // #3940: audit_trail and log_retention from the subscription activity log diagnostic settings.
  let logging: NonNullable<LzLivePostureInput['logging']>;
  try {
    const settings = await armList<Doc>(ctx, `${SUB(ctx)}/providers/Microsoft.Insights/diagnosticSettings`, AZURE_POSTURE_ROUTES.diagnosticSettings, AZURE_API_VERSIONS.diagnosticSettings);
    const trails = loggingTrails(settings, rows ?? []);
    // A workspace's retention needs the inventory; without it the retention is unread (partial).
    const needsInventory = settings.some((s) => typeof s.properties?.workspaceId === 'string');
    logging = {
      source: { calls: rows !== undefined ? [AZURE_POSTURE_ROUTES.diagnosticSettings, AZURE_POSTURE_ROUTES.resourceGraph].sort() : [AZURE_POSTURE_ROUTES.diagnosticSettings], partial: rows === undefined && needsInventory, status: 'ok' },
      trails,
    };
  } catch (err) {
    logging = { source: failedSource(AZURE_POSTURE_ROUTES.diagnosticSettings, err), trails: [] };
  }

  // #3936: the shared budgets block (Budgets_List; contacts counted, never kept).
  let budgets: NonNullable<LzLivePostureInput['budgets']>;
  try {
    budgets = { source: { calls: [AZURE_POSTURE_ROUTES.budgets], partial: false, status: 'ok' }, items: budgetPostureItems(await budgetDocs(ctx), azureSubscription(ctx)) };
  } catch (err) {
    budgets = { source: failedSource(AZURE_POSTURE_ROUTES.budgets, err), items: [] };
  }

  if (rows === undefined) {
    const source = graphSource(inventoryErr);
    return {
      encryption: { source, items: [] },
      exposure: { source, items: [] },
      ingress_rules: { source, items: [] },
      logging,
      backup: { source, items: [] },
      budgets,
    };
  }
  let backup: NonNullable<LzLivePostureInput['backup']>;
  try {
    const recovery = await resourceGraph<Doc>(ctx, AZURE_RECOVERY_QUERY, [azureSubscription(ctx)]);
    backup = { source: ok, items: backupFacts(rows, recovery) };
  } catch (err) {
    backup = { source: graphSource(err), items: [] };
  }
  // Entra ID (privileged_mfa, credential_age) is outside the ARM read scope: no identity block (not_observable).
  return {
    encryption: { source: ok, items: [...atRestFacts(rows), ...inTransitFacts(rows)] },
    exposure: { source: ok, items: exposureFacts(rows) },
    ingress_rules: { source: ok, items: ingressRules(rows) },
    logging,
    backup,
    budgets,
  };
}

async function listGuardrails(ctx: ScopeCtx): Promise<Estate['guardrails']> {
  let view: PolicyView;
  try {
    view = await policies(ctx);
  } catch (err) {
    if (err instanceof LiveAuthError) throw err;
    throw new LiveSourceUnavailableError('guardrails', httpStatusOf(err));
  }
  const out: Estate['guardrails'] = [];
  if (view.assignments.length === 0) out.push({ type: 'azure-policy', id: 'subscription', status: 'fail', detail: 'no Azure Policy assignment applies to the subscription' });
  for (const a of view.assignments) {
    const d = a._definition as Doc | undefined;
    const effect = d?.properties?.policyRule?.then?.effect;
    const enforced = a.properties?.enforcementMode !== 'DoNotEnforce';
    out.push({
      type: 'azure-policy',
      id: String(a.name ?? 'assignment'),
      status: enforced ? 'pass' : 'fail',
      detail: `${String(a.properties?.displayName ?? a.name ?? 'assignment')}; enforcement ${enforced ? 'on' : 'off'}; effect ${typeof effect === 'string' ? effect : d === undefined ? 'not read (initiative or definition not readable)' : 'parameterised'}`,
    });
  }
  return out;
}

async function listQuotas(_ctx: ScopeCtx, region: string): Promise<Estate['quotas']> {
  throw new LiveSourceUnavailableError(`quotas:${region}`, undefined, 'no Azure quota API is served by the spec-derived mock yet (open question in #3575)');
}

async function listActivity(_ctx: ScopeCtx, _window: ActivityWindow): Promise<NonNullable<Estate['activity_summary']>> {
  throw new LiveSourceUnavailableError('activity', undefined, 'the Azure activity log is not read yet (open question in #3575)');
}

// ---------------------------------------------------------------------------
// Pass 23 (Design 120 section 7.5): the AKS, PostgreSQL, Redis, Key Vault and VNet reads of the LZR adapter
// ---------------------------------------------------------------------------

export interface AzurePass23State {
  aks_clusters: { name: string; provisioningState: string; kubernetesVersion?: string }[];
  postgresql_servers: { name: string; state: string; version?: string }[];
  redis_instances: { name: string; provisioningState: string }[];
  keyvault_vaults: { name: string }[];
  vnet_count: number;
}

export const AZURE_PASS23_QUERY = 'Resources | project id, name, type, properties';

/** Pass 23 state from one Resource Graph read (the mock filters no KQL, so the type filter is applied here). */
export async function readAzurePass23State(ctx: ScopeCtx): Promise<AzurePass23State> {
  const rows = await resourceGraph<Doc>(ctx, AZURE_PASS23_QUERY, [azureSubscription(ctx)]);
  const of = (t: string): Doc[] => rows.filter((r) => String(r.type).toLowerCase() === t);
  const p = (r: Doc): Doc => (r.properties && typeof r.properties === 'object' ? r.properties as Doc : {});
  return {
    aks_clusters: of('microsoft.containerservice/managedclusters').map((r) => ({ name: String(r.name), provisioningState: String(p(r).provisioningState ?? ''), ...(p(r).kubernetesVersion ? { kubernetesVersion: String(p(r).kubernetesVersion) } : {}) })),
    postgresql_servers: of('microsoft.dbforpostgresql/flexibleservers').map((r) => ({ name: String(r.name), state: String(p(r).state ?? ''), ...(p(r).version ? { version: String(p(r).version) } : {}) })),
    redis_instances: of('microsoft.cache/redis').map((r) => ({ name: String(r.name), provisioningState: String(p(r).provisioningState ?? '') })),
    keyvault_vaults: of('microsoft.keyvault/vaults').map((r) => ({ name: String(r.name) })),
    vnet_count: of('microsoft.network/virtualnetworks').length,
  };
}

export const azureDriver: LiveLzDriver = {
  provider: AZURE_PROVIDER,
  driverVersion: AZURE_DRIVER_VERSION,
  // Managed identity (Design 120 section 7.1) is not registered: IMDS is plain
  // HTTP and the driver base URLs must be https (Q-3600-5, owner decision open).
  authMethods: [
    { id: 'service-principal-secret', required: ['tenant-id', 'client-id', 'client-secret'], optional: [], unattended: true },
    { id: 'service-principal-certificate', required: ['tenant-id', 'client-id', 'client-certificate'], optional: [], unattended: true },
  ],
  defaultBaseUrls: { login: AZURE_DEFAULT_LOGIN, arm: AZURE_DEFAULT_ARM },
  readAllowList: [
    { method: 'POST', path: /^\/[^/]+\/oauth2\/v2\.0\/token$/, reason: 'Entra ID client credentials token request; returns an access token and creates nothing in the tenant' },
    { method: 'POST', path: /^\/providers\/Microsoft\.ResourceGraph\/resources$/, reason: 'Resource Graph query (read-only by API design: QueryRequest selects rows of the inventory)' },
  ],
  routeTemplates: [
    '/{tenant_id}/oauth2/v2.0/token',
    '/subscriptions/{subscription_id}',
    '/subscriptions/{subscription_id}/locations',
    '/subscriptions/{subscription_id}/providers',
    '/providers/Microsoft.ResourceGraph/resources',
    '/subscriptions/{subscription_id}/providers/Microsoft.Authorization/policyAssignments',
    '/providers/Microsoft.Authorization/policyDefinitions/{policy_definition_name}',
    '/subscriptions/{subscription_id}/providers/Microsoft.Authorization/policyDefinitions/{policy_definition_name}',
    '/providers/Microsoft.Management/managementGroups/{management_group_id}/providers/Microsoft.Authorization/policyDefinitions/{policy_definition_name}',
    '/subscriptions/{subscription_id}/providers/Microsoft.Authorization/roleAssignments',
    '/subscriptions/{subscription_id}/providers/Microsoft.Authorization/roleDefinitions/{role_definition_id}',
    // #3940: posture reads (GET list operations; the read allow-list is unchanged).
    '/subscriptions/{subscription_id}/providers/Microsoft.Insights/diagnosticSettings',
    '/subscriptions/{subscription_id}/providers/Microsoft.Consumption/budgets',
  ],
  probeReadOnly,
  listRegions,
  listServices,
  listGuardrails,
  listResources,
  listQuotas,
  listActivity,
  // #3868 (Design 123 section 5.4): posture from Resource Graph; mock only.
  listPosture,
  // #3884 (Design 123 section 5.6): tenant root group, nested management
  // groups, subscriptions, resource groups; mock only, liveVerified stays false.
  listHierarchy: listAzureHierarchy,
  liveVerified: false,
};
