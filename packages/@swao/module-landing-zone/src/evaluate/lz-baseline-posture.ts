// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- Client LZ Policy Baseline posture evaluators (#3871)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Estate evaluators of the kinds that read `estate.posture` (Design 123
// sections 5.4, 8.1 and 13 Phase 2): encryption at rest (estate part),
// encryption in transit, public exposure, open admin ingress, privileged MFA,
// credential age, log retention and backup. Pure and CSP-agnostic. Rules
// shared by every kind (Design 123 section 8.2a "Posture kinds"):
//   1. A kind that no read-only API answers on the CSP (NOT_OBSERVABLE of
//      lz-baseline-eval.ts) stays not_observable when the block lacks the fact.
//   2. A block that is absent was not collected: unverified, not_collected.
//   3. A block whose source is not_collected (denied read): unverified,
//      not_collected, with the HTTP status or the reason.
//   4. An answered block decides: an empty answered block is evidence (no
//      ingress rule means no open admin ingress).
//   5. A partial source never gives pass, na or warn (unverified,
//      not_collected); a fail on partial evidence stands.
//   6. Kinds with `applies_to` cross-check the inventory: a resource of an
//      applies_to capability that no posture item covers (by id, type or
//      capability) is a collector gap, named by its resource type; the result
//      is then never a pass.
// Details carry counts, resource types and policy parameters only, never a
// resource id, a CIDR of a rule or a name (Design 123 sections 8.1 and 12).

import {
  KEY_CUSTODY_LEVELS,
  type KeyCustodyLevel,
  type LzBaselineOfferingVerdict,
  type LzLiveCheckStatus,
  type LzLiveFactSource,
  type LzLiveObservability,
  type LzLiveScan,
} from '@swao/core';
import {
  LIVE_RESOURCE_CAPABILITY_MAPS,
  LIVE_SERVICE_INVENTORY_SOURCE,
  LIVE_SERVICE_INVENTORY_TYPES,
  liveResourceCapabilityTags,
} from '../live/resource-capabilities.js';

export interface PostureOutcome {
  offering: LzBaselineOfferingVerdict;
  estate: LzLiveCheckStatus;
  observability: LzLiveObservability;
  detail: string;
}

type Tls = '1.0' | '1.1' | '1.2' | '1.3';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Offering of a posture kind from its estate result (the audit_trail mapping): the CSP can meet it; the tenant configures it. */
export function postureOutcome(estate: LzLiveCheckStatus, observability: LzLiveObservability, detail: string): PostureOutcome {
  let offering: LzBaselineOfferingVerdict;
  switch (estate) {
    case 'pass':
    case 'na': offering = 'READY'; break;
    case 'fail':
    case 'warn': offering = 'READY_WITH_CHANGES'; break;
    case 'unverified': offering = 'NEEDS_VERIFICATION'; break;
    default: {
      const exhaustive: never = estate;
      return exhaustive;
    }
  }
  return { offering, estate, observability, detail };
}

const unverified = (observability: LzLiveObservability, detail: string): PostureOutcome => postureOutcome('unverified', observability, detail);

/** Rules 2 and 3: the outcome when the block cannot decide, else null. */
function blockGap(name: string, source: LzLiveFactSource | undefined, provider: string, unread: LzLiveObservability): PostureOutcome | null {
  if (source === undefined) {
    return unverified(unread, unread === 'not_observable'
      ? 'not observable from live read-only data; manual evidence item'
      : `posture block ${name} not collected by the ${provider} driver`);
  }
  if (source.status === 'not_collected') {
    const why = source.http_status !== undefined ? `HTTP ${source.http_status}` : source.reason ?? 'not collected';
    // #3955: on a CSP where no read-only API answers the kind (section 5.4), a refused read is not_observable, with the status.
    if (unread === 'not_observable') return unverified('not_observable', `posture block ${name} not collected (${why}); not observable from live read-only data; manual evidence item`);
    return unverified('not_collected', `posture block ${name} not collected (${why})`);
  }
  return null;
}

/** Rule 5: a partial source turns pass, na and warn into unverified; a fail stands. */
function partialGuard(o: PostureOutcome, source: LzLiveFactSource): PostureOutcome {
  if (!source.partial || o.estate === 'fail' || o.estate === 'unverified') return o;
  return unverified('not_collected', `partial source (a region or a read of the block was refused); ${o.detail}`);
}

// ---------------------------------------------------------------------------
// Capabilities of posture items and inventory resources
// ---------------------------------------------------------------------------

interface CapabilityIndex {
  /** Tags of a resource type or service code; undefined when unmapped. */
  of(type: string | undefined, serviceCode: string | undefined): readonly string[] | undefined;
  /** Tags of an inventory resource by id; undefined when the id is not in the inventory or unmapped. */
  ofResource(id: string): readonly string[] | undefined;
}

function capabilityIndex(scan: LzLiveScan): CapabilityIndex {
  const serviceTags = new Map(scan.offering.services.map((s) => [s.code, s.capability_tags] as const));
  const of = (type: string | undefined, serviceCode: string | undefined): readonly string[] | undefined => {
    const t = (type ? liveResourceCapabilityTags(scan.meta.provider, type) : undefined) ?? (serviceCode ? serviceTags.get(serviceCode) : undefined);
    return t && t.length > 0 ? t : undefined;
  };
  const byId = new Map(scan.estate.resources.map((r) => [r.id, r] as const));
  return {
    of,
    ofResource: (id) => {
      const r = byId.get(id);
      return r ? of(r.type, r.service_code) : undefined;
    },
  };
}

interface PostureItemRef { resource_id: string; type?: string; service_code?: string }

interface Scoped<T> { items: T[]; unmapped: Map<string, number>; all: readonly T[] }

/**
 * Items of an applies_to capability. An item whose type and service map to no
 * capability is neither judged nor dropped: it is counted as unmapped, so the
 * result is never a pass and never a fail on it (ADR-0041).
 */
function inScope<T extends PostureItemRef>(all: readonly T[], caps: CapabilityIndex, appliesTo: readonly string[]): Scoped<T> {
  const want = new Set(appliesTo);
  const items: T[] = [];
  const unmapped = new Map<string, number>();
  for (const i of all) {
    const t = caps.of(i.type, i.service_code) ?? caps.ofResource(i.resource_id);
    if (t === undefined) {
      const type = i.type ?? 'unknown type';
      unmapped.set(type, (unmapped.get(type) ?? 0) + 1);
    } else if (t.some((x) => want.has(x))) items.push(i);
  }
  return { items, unmapped, all };
}

/**
 * Rule 6: inventory resources of an applies_to capability that no item covers
 * (same id, same resource type, or an item of the same capability), grouped
 * by resource type.
 */
function uncovered(scan: LzLiveScan, caps: CapabilityIndex, appliesTo: readonly string[], items: readonly PostureItemRef[]): Map<string, number> {
  const want = new Set(appliesTo);
  const ids = new Set(items.map((i) => i.resource_id));
  const types = new Set(items.map((i) => i.type).filter((t): t is string => t !== undefined));
  const itemCaps = new Set(items.flatMap((i) => [...(caps.of(i.type, i.service_code) ?? caps.ofResource(i.resource_id) ?? [])]));
  const out = new Map<string, number>();
  for (const r of scan.estate.resources) {
    const t = caps.of(r.type, r.service_code);
    if (!t) continue;
    const hit = t.filter((x) => want.has(x));
    if (hit.length === 0) continue;
    if (ids.has(r.id) || types.has(r.type) || hit.some((x) => itemCaps.has(x))) continue;
    out.set(r.type, (out.get(r.type) ?? 0) + 1);
  }
  return out;
}

/**
 * D-15: the AWS inventory is the tagging API, which lists tagged resources
 * only, and the posture reads do not cover every applies_to service (API
 * Gateway, CloudFront; S3 and DynamoDB are listed since #3935, #3952): "nothing of applies_to" is no evidence
 * of absence there, so the applies_to kinds never claim `na` on AWS.
 */
function absenceUnobservable(scan: LzLiveScan): string | undefined {
  return scan.meta.provider === 'aws' ? 'the tagging API lists tagged resources only, untagged resources are not observable (D-15)' : undefined;
}

/**
 * #3955: providers whose inventory reads a few resource kinds only. STACKIT
 * lists the five iaas kinds, the load balancers of the posture read and,
 * since #3970, object storage, PostgreSQL Flex, MongoDB Flex, SFS and the CDN,
 * and since #3995 SQL Server Flex (LIVE_RESOURCE_CAPABILITY_MAPS.stackit); a
 * denied read of those keeps its posture block partial, so `na` is not claimed
 * on it. Other enabled services are not read. A capability of `applies_to` that a service
 * enabled in the scope carries, but that the inventory does not read, makes
 * "nothing of applies_to" unproven: never `na`, but unverified (not_collected,
 * a collector can close it, #3970). A service that is only available (not
 * enabled) holds nothing.
 *
 * #3871 / #4026: what the inventory read is taken from the scan, not from this
 * build's driver. The service inventory types (LIVE_SERVICE_INVENTORY_TYPES)
 * count as read only when the scan holds the source `inventory:service-resources`
 * with status ok and no refused read of the type (`inventory:<type>:<region>`
 * not_collected; an answered empty or absent list is ok), so a stored scan of a driver without that inventory, re-evaluated
 * with this code, does not claim `na` for object storage, the Flex databases,
 * SFS or the CDN (live STACKIT scan of 2026-11-06 18:05Z).
 */
const PARTIAL_INVENTORY: ReadonlySet<string> = new Set(['stackit']);

function uninventoried(scan: LzLiveScan, appliesTo: readonly string[]): string | undefined {
  const provider = scan.meta.provider;
  if (!PARTIAL_INVENTORY.has(provider)) return undefined;
  const serviceInventoryRead = scan.meta.sources.some((s) => s.name === LIVE_SERVICE_INVENTORY_SOURCE && s.status === 'ok');
  const serviceTypes = LIVE_SERVICE_INVENTORY_TYPES[provider] ?? [];
  // #4026: a type whose own read was refused in a region (`inventory:<type>:<region>` not_collected) is not read either.
  const refused = (type: string): boolean => scan.meta.sources.some((s) => s.name.startsWith(`inventory:${type}:`) && s.status === 'not_collected');
  const unreadTypes = new Set(serviceInventoryRead ? serviceTypes.filter(refused) : serviceTypes);
  const read = new Set(Object.entries(LIVE_RESOURCE_CAPABILITY_MAPS[provider] ?? {}).filter(([type]) => !unreadTypes.has(type)).flatMap(([, caps]) => caps));
  const enabled = new Set(scan.offering.services.filter((s) => Object.values(s.regions).some((r) => r.status === 'enabled')).flatMap((s) => s.capability_tags));
  const missing = [...new Set(appliesTo)].filter((c) => enabled.has(c) && !read.has(c)).sort();
  return missing.length > 0 ? `enabled in the offering but not read by the ${provider} inventory: ${missing.join(', ')}` : undefined;
}

const describeUncovered = (gap: ReadonlyMap<string, number>): string =>
  [...gap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, n]) => `${n} ${type}`).join(', ');

/**
 * Combine a per-item evaluation with the shared rules: fail wins; then a
 * collector gap or undecided items give unverified (not_collected before
 * not_observable, because a collector can still close it); then pass, or na
 * when nothing applies. The partial guard runs last.
 */
function decide(args: {
  source: LzLiveFactSource;
  failing: number;
  failDetail: string;
  ok: number;
  undecidedCollect: number;
  undecidedCollectDetail: string;
  undecidedObservable: number;
  undecidedObservableDetail: string;
  gap: ReadonlyMap<string, number>;
  gapObservability: LzLiveObservability;
  /** Items whose type maps to no capability (not judged). */
  unmapped?: ReadonlyMap<string, number>;
  /** Items judged (the denominator of the detail). */
  judged: number;
  passDetail: string;
  naDetail: string;
  /** Why `na` cannot be claimed (the inventory cannot show absence), else undefined. */
  naUnobservable?: string;
  /** #3955: why `na` cannot be claimed yet (a capability of applies_to the inventory does not read), else undefined. */
  naNotCollected?: string;
}): PostureOutcome {
  const notes: string[] = [];
  if (args.gap.size > 0) notes.push(`not covered by the collector: ${describeUncovered(args.gap)}`);
  const unmapped = args.unmapped ?? new Map<string, number>();
  if (unmapped.size > 0) notes.push(`not judged, resource type without a capability mapping: ${describeUncovered(unmapped)}`);
  if (args.undecidedCollect > 0) notes.push(args.undecidedCollectDetail);
  if (args.undecidedObservable > 0) notes.push(args.undecidedObservableDetail);
  const tail = notes.length > 0 ? `; ${notes.join('; ')}` : '';
  let o: PostureOutcome;
  if (args.failing > 0) o = postureOutcome('fail', 'observed', `${args.failDetail}${tail}`);
  else if (args.undecidedCollect > 0 || unmapped.size > 0 || (args.gap.size > 0 && args.gapObservability !== 'not_observable')) o = unverified('not_collected', `${args.judged === 0 ? 'no item judged' : `${args.ok} of ${args.judged} compliant`}${tail}`);
  else if (args.undecidedObservable > 0 || args.gap.size > 0) o = unverified('not_observable', `${args.judged === 0 ? 'no item judged' : `${args.ok} of ${args.judged} compliant`}${tail}`);
  else if (args.ok > 0) o = postureOutcome('pass', 'observed', args.passDetail);
  else if (args.naUnobservable !== undefined) o = unverified('not_observable', `${args.naDetail}; ${args.naUnobservable}`);
  else if (args.naNotCollected !== undefined) o = unverified('not_collected', `${args.naDetail}; ${args.naNotCollected}`);
  else o = postureOutcome('na', 'observed', args.naDetail);
  return partialGuard(o, args.source);
}

// ---------------------------------------------------------------------------
// Encryption at rest (estate part) and in transit
// ---------------------------------------------------------------------------

const CUSTODY_RANK: Readonly<Record<KeyCustodyLevel, number>> = Object.fromEntries(KEY_CUSTODY_LEVELS.map((k, i) => [k, i])) as Record<KeyCustodyLevel, number>;

/** Estate of encryption_at_rest from `posture.encryption` at_rest items; null when the block cannot decide (the caller keeps the catalogue result). */
export function evalEncryptionAtRestEstate(scan: LzLiveScan, minCustody: KeyCustodyLevel, appliesTo: readonly string[]): PostureOutcome | null {
  const block = scan.estate.posture?.encryption;
  const gapOutcome = blockGap('encryption', block?.source, scan.meta.provider, 'not_collected');
  if (gapOutcome) return block === undefined ? null : gapOutcome;
  const b = block!;
  const caps = capabilityIndex(scan);
  const scoped = inScope(b.items.filter((i) => i.layer === 'at_rest'), caps, appliesTo);
  const items = scoped.items;
  const min = CUSTODY_RANK[minCustody];
  let unencrypted = 0;
  let weakKey = 0;
  let ok = 0;
  let unknownEncrypted = 0;
  let unknownCustody = 0;
  for (const i of items) {
    if (i.encrypted === false) unencrypted++;
    else if (i.encrypted === undefined) unknownEncrypted++;
    else if (min === 0) ok++;
    else if (i.key_custody === undefined) unknownCustody++;
    else if (CUSTODY_RANK[i.key_custody] < min) weakKey++;
    else ok++;
  }
  const undecided = unknownEncrypted + unknownCustody;
  return decide({
    source: b.source,
    failing: unencrypted + weakKey,
    failDetail: `${plural(items.length, 'stored resource')} read: ${unencrypted} unencrypted, ${weakKey} encrypted with keys weaker than ${minCustody}`,
    ok,
    undecidedCollect: undecided,
    undecidedCollectDetail: `${undecided} without ${unknownCustody > 0 ? 'key custody' : 'an encryption flag'} in the read${unknownEncrypted > 0 && unknownCustody > 0 ? ` (${unknownEncrypted} without an encryption flag)` : ''}`,
    undecidedObservable: 0,
    undecidedObservableDetail: '',
    gap: uncovered(scan, caps, appliesTo, scoped.all),
    gapObservability: 'not_collected',
    unmapped: scoped.unmapped,
    judged: items.length,
    passDetail: `every stored resource read (${items.length}) is encrypted with ${minCustody} keys or stronger`,
    naDetail: `no stored resource of applies_to (${appliesTo.join(', ')}) in scope`,
    naUnobservable: absenceUnobservable(scan),
    naNotCollected: uninventoried(scan, appliesTo),
  });
}

const TLS_RANK: Readonly<Record<Tls, number>> = { '1.0': 0, '1.1': 1, '1.2': 2, '1.3': 3 };

/**
 * #3970: providers whose in-transit items can carry a TLS floor without an
 * `encrypted` verdict because the API does not say whether plain HTTP is
 * refused (STACKIT CDN v1 `config.tls`). There a floor below the minimum
 * fails (the weak versions are accepted), any other floor is not_observable.
 * Other providers keep the pass-through rule for an item without `encrypted`
 * (Azure, for example, can emit a floor without it; not re-checked live).
 */
const TLS_FLOOR_WITHOUT_PLAINTEXT_VERDICT: ReadonlySet<string> = new Set(['stackit']);

export function evalEncryptionInTransit(scan: LzLiveScan, minTls: Tls, appliesTo: readonly string[], unread: LzLiveObservability): PostureOutcome {
  const block = scan.estate.posture?.encryption;
  const gapOutcome = blockGap('encryption', block?.source, scan.meta.provider, unread);
  if (gapOutcome) return gapOutcome;
  const b = block!;
  const caps = capabilityIndex(scan);
  const scoped = inScope(b.items.filter((i) => i.layer === 'in_transit'), caps, appliesTo);
  // #3954: an endpoint that publishes nothing (an API gateway without an API) is covered, not judged.
  const items = scoped.items.filter((i) => i.attributes?.['published_apis'] !== 0);
  let plain = 0;
  let weak = 0;
  let ok = 0;
  let noFloor = 0;
  let passThrough = 0;
  let floorOnly = 0;
  // #3970: on these providers an endpoint with a TLS floor but no `encrypted` is judged by the floor (STACKIT CDN).
  const floorJudged = TLS_FLOOR_WITHOUT_PLAINTEXT_VERDICT.has(scan.meta.provider);
  for (const i of items) {
    if (i.encrypted === false) plain++;
    else if (floorJudged && i.encrypted === undefined && i.min_tls_version !== undefined && TLS_RANK[i.min_tls_version] < TLS_RANK[minTls]) weak++;
    else if (floorJudged && i.encrypted === undefined && i.min_tls_version !== undefined) floorOnly++;
    else if (i.encrypted === undefined) passThrough++;
    else if (i.min_tls_version === undefined) noFloor++;
    else if (TLS_RANK[i.min_tls_version] < TLS_RANK[minTls]) weak++;
    else ok++;
  }
  return decide({
    source: b.source,
    failing: plain + weak,
    failDetail: `${plural(items.length, 'endpoint')} read: ${plain} unencrypted, ${weak} with a TLS floor below ${minTls}`,
    ok,
    undecidedCollect: noFloor,
    undecidedCollectDetail: `${noFloor} encrypted without a known TLS floor`,
    undecidedObservable: passThrough + floorOnly,
    undecidedObservableDetail: [
      ...(passThrough > 0 ? [`${passThrough} pass-through (TCP, UDP or TLS passthrough): encryption is not observable at the endpoint`] : []),
      ...(floorOnly > 0 ? [`${floorOnly} with a TLS floor of ${minTls} or higher, but whether plain HTTP is refused is not observable`] : []),
    ].join('; '),
    gap: uncovered(scan, caps, appliesTo, scoped.all),
    gapObservability: unread,
    unmapped: scoped.unmapped,
    judged: items.length,
    passDetail: `every endpoint read (${items.length}) enforces TLS ${minTls} or higher`,
    naDetail: `no endpoint of applies_to (${appliesTo.join(', ')}) in scope`,
    naUnobservable: absenceUnobservable(scan),
    naNotCollected: uninventoried(scan, appliesTo),
  });
}

// ---------------------------------------------------------------------------
// Network exposure and admin ingress
// ---------------------------------------------------------------------------

/**
 * Public items outside allow_capabilities. An item is allowed when its own
 * capability, or the capability of the resource it is bound to, is allowed.
 * An unbound public IP exposes nothing. A public IP bound to a target that is
 * neither in the inventory nor a posture item cannot be shown allowed or
 * exposed: undecided (not_collected).
 */
export function evalNoPublicExposure(scan: LzLiveScan, allow: readonly string[]): PostureOutcome {
  const block = scan.estate.posture?.exposure;
  const gapOutcome = blockGap('exposure', block?.source, scan.meta.provider, 'not_collected');
  if (gapOutcome) return gapOutcome;
  const b = block!;
  const caps = capabilityIndex(scan);
  const allowed = new Set(allow);
  const itemCaps = new Map(b.items.map((i) => [i.resource_id, caps.of(i.type, i.service_code)] as const));
  const isAllowed = (t: readonly string[] | undefined): boolean => t !== undefined && t.some((x) => allowed.has(x));
  let exposed = 0;
  let ok = 0;
  let unknownTarget = 0;
  const exposedTypes = new Map<string, number>();
  for (const i of b.items) {
    if (!i.public) continue;
    const own = caps.of(i.type, i.service_code) ?? caps.ofResource(i.resource_id);
    if (isAllowed(own)) { ok++; continue; }
    if (i.exposure === 'public_ip') {
      if (i.bound_to === undefined) { ok++; continue; }
      // #3953: a target outside the inventory is judged by the type the collector recorded for it (`bound_type`).
      const boundType = i.attributes?.['bound_type'];
      const target = caps.ofResource(i.bound_to) ?? itemCaps.get(i.bound_to) ?? (typeof boundType === 'string' ? caps.of(boundType, undefined) : undefined);
      if (target === undefined) { unknownTarget++; continue; }
      if (isAllowed(target)) { ok++; continue; }
    }
    exposed++;
    const type = i.type ?? i.exposure;
    exposedTypes.set(type, (exposedTypes.get(type) ?? 0) + 1);
  }
  // Object storage is exposed by its own access settings: without a public_storage
  // item for it, the read did not cover it (for example AWS S3, #3935; OTC OBS).
  const storageRead = new Set(b.items.filter((i) => i.exposure === 'public_storage').map((i) => i.resource_id));
  const storageTypes = new Set(b.items.filter((i) => i.exposure === 'public_storage').map((i) => i.type));
  const gap = new Map<string, number>();
  if (!allowed.has('object_storage')) {
    for (const r of scan.estate.resources) {
      if (!caps.of(r.type, r.service_code)?.includes('object_storage')) continue;
      if (storageRead.has(r.id) || storageTypes.has(r.type)) continue;
      gap.set(r.type, (gap.get(r.type) ?? 0) + 1);
    }
  }
  const total = b.items.filter((i) => i.public).length;
  // #3935: storage read as not public is judged (and compliant), so a scope whose
  // only exposure evidence is private object storage passes instead of claiming na.
  const privateStorage = b.items.filter((i) => i.exposure === 'public_storage' && !i.public).length;
  return decide({
    source: b.source,
    failing: exposed,
    failDetail: `${plural(exposed, 'public address or endpoint', 'public addresses or endpoints')} outside the allowed capabilities (${allow.join(', ') || 'none'}): ${describeUncovered(exposedTypes)}`,
    ok: ok + privateStorage,
    undecidedCollect: unknownTarget,
    undecidedCollectDetail: `${plural(unknownTarget, 'public IP')} bound to a target whose capability is not recorded`,
    undecidedObservable: 0,
    undecidedObservableDetail: '',
    gap,
    gapObservability: 'not_collected',
    judged: total + privateStorage,
    passDetail: `${plural(total, 'public address or endpoint', 'public addresses or endpoints')}, all unbound or on allowed capabilities (${allow.join(', ') || 'none'})${privateStorage > 0 ? `; ${plural(privateStorage, 'storage resource')} read, none public` : ''}`,
    naDetail: 'no public address, endpoint or storage in scope',
    naNotCollected: allowed.has('object_storage') ? undefined : uninventoried(scan, ['object_storage']),
  });
}

/** Protocols an admin port listens on; ICMP never matches. */
const PORT_PROTOCOLS: ReadonlySet<string> = new Set(['any', 'all', '-1', '*', 'tcp', 'udp', '6', '17']);

const normCidr = (c: string): string => c.trim().toLowerCase();

export function evalNoOpenAdminIngress(scan: LzLiveScan, ports: readonly number[], sources: readonly string[]): PostureOutcome {
  const block = scan.estate.posture?.ingress_rules;
  const gapOutcome = blockGap('ingress_rules', block?.source, scan.meta.provider, 'not_collected');
  if (gapOutcome) return gapOutcome;
  const b = block!;
  const forbidden = new Set(sources.map(normCidr));
  const opens = (r: (typeof b.items)[number], port: number): boolean => {
    if (!PORT_PROTOCOLS.has(r.protocol.toLowerCase())) return false;
    const from = r.port_from ?? 0;
    const to = r.port_to ?? (r.port_from ?? 65535);
    return port >= from && port <= to;
  };
  const priority = (r: (typeof b.items)[number]): number | undefined => {
    const p = r.attributes?.['priority'];
    return typeof p === 'number' ? p : undefined;
  };
  // A deny of the same group, source and port with a lower priority number wins (Azure NSG order).
  const shadowed = (r: (typeof b.items)[number], port: number): boolean => {
    const pr = priority(r);
    if (pr === undefined) return false;
    return b.items.some((d) => d.action === 'deny' && d.resource_id === r.resource_id && d.remote_cidr !== undefined
      && normCidr(d.remote_cidr) === normCidr(r.remote_cidr ?? '') && opens(d, port) && (priority(d) ?? Infinity) < pr);
  };
  const openRules = new Set<number>();
  const groups = new Set<string>();
  const openPorts = new Set<number>();
  b.items.forEach((r, idx) => {
    if (r.action !== 'allow' || r.remote_cidr === undefined || !forbidden.has(normCidr(r.remote_cidr))) return;
    for (const port of ports) {
      if (opens(r, port) && !shadowed(r, port)) { openRules.add(idx); groups.add(r.resource_id); openPorts.add(port); }
    }
  });
  const inbound = b.items.filter((r) => r.action === 'allow').length;
  const o: PostureOutcome = openRules.size > 0
    ? postureOutcome('fail', 'observed', `${plural(openRules.size, 'inbound rule')} in ${plural(groups.size, 'security group')} open port ${[...openPorts].sort((x, y) => x - y).join(', ')} to ${sources.join(' or ')}`)
    : postureOutcome('pass', 'observed', `${plural(inbound, 'inbound allow rule')} read, none opens ${ports.join(', ')} to ${sources.join(' or ')}`);
  return partialGuard(o, b.source);
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function evalPrivilegedMfa(scan: LzLiveScan, unread: LzLiveObservability): PostureOutcome {
  const id = scan.estate.posture?.identity;
  const gapOutcome = blockGap('identity', id?.source, scan.meta.provider, unread);
  if (gapOutcome) return gapOutcome;
  const i = id!;
  let o: PostureOutcome;
  if (i.privileged_without_mfa !== undefined && i.privileged_without_mfa > 0) {
    o = postureOutcome('fail', 'observed', `${i.privileged_without_mfa} of ${i.privileged_principals ?? 'the'} privileged principals without MFA`);
  } else if (i.privileged_without_mfa === 0 && i.privileged_principals !== undefined) {
    o = i.privileged_principals === 0
      ? postureOutcome('na', 'observed', 'no privileged principal read')
      : postureOutcome('pass', 'observed', `every privileged principal (${i.privileged_principals}) has MFA`);
  } else if (i.mfa_required_for_privileged === true) {
    o = postureOutcome('pass', 'observed', 'MFA is required for privileged access');
  } else if (i.mfa_required_for_privileged === false) {
    o = postureOutcome('fail', 'observed', 'MFA is not required for privileged access');
  } else {
    const counted = i.privileged_principals !== undefined ? `${plural(i.privileged_principals, 'privileged principal')} read, ` : '';
    o = unread === 'not_observable'
      ? unverified('not_observable', `${counted}MFA is not observable from live read-only data; manual evidence item`)
      : unverified('not_collected', `${counted}MFA of privileged principals not in the read (the role or group query was not readable)`);
  }
  return partialGuard(o, i.source);
}

const LONG_LIVED: ReadonlySet<string> = new Set(['access_key', 'api_key', 'service_account_key']);

export function evalCredentialAge(scan: LzLiveScan, maxDays: number, unread: LzLiveObservability): PostureOutcome {
  const id = scan.estate.posture?.identity;
  const gapOutcome = blockGap('identity', id?.source, scan.meta.provider, unread);
  if (gapOutcome) return gapOutcome;
  const i = id!;
  // Rule 1: where no read-only API shows credentials (section 5.4), an empty list says nothing.
  if (unread === 'not_observable' && i.credentials.length === 0) {
    return unverified('not_observable', 'credential ages are not observable from live read-only data; manual evidence item');
  }
  const active = i.credentials.filter((c) => c.active && LONG_LIVED.has(c.kind));
  const old = active.filter((c) => c.age_days > maxDays);
  const oldest = active.reduce((m, c) => Math.max(m, c.age_days), 0);
  const o = old.length > 0
    ? postureOutcome('fail', 'observed', `${old.length} of ${plural(active.length, 'active long-lived key')} older than ${maxDays} days (oldest ${oldest} days)`)
    : active.length > 0
      ? postureOutcome('pass', 'observed', `every active long-lived key (${active.length}) is at most ${maxDays} days old (oldest ${oldest} days)`)
      : postureOutcome('pass', 'observed', 'no active long-lived key read');
  return partialGuard(o, i.source);
}

// ---------------------------------------------------------------------------
// Log retention
// ---------------------------------------------------------------------------

/**
 * Providers whose `retention_days` can be a copy, not the trail's primary
 * store: on AWS every trail delivers to S3, and the CloudWatch Logs group is a
 * copy. #3935: a trail whose bucket lifecycle was read carries
 * `retention_source: s3_lifecycle` (aws-posture.ts trailFacts) and its
 * retention is the primary store's; any other AWS trail (the bucket not
 * readable, for example in a log archive account, or a scan from before
 * #3935) carries the copy only. A copy below the minimum proves nothing about
 * the primary store, so it cannot fail; a copy at or above it shows the logs
 * are kept.
 */
const RETENTION_IS_COPY: ReadonlySet<string> = new Set(['aws']);
const PRIMARY_STORE_READ = 's3_lifecycle';

/** #3975: what the landing zone's log archive scope said about the unread trail buckets (aws-posture.ts trailFacts `log_archive`). */
const LOG_ARCHIVE_REASON: Readonly<Record<string, string>> = {
  bucket_not_in_scope: 'it does not list the bucket',
  login_missing: 'no login stored for it',
  login_expired: 'its login has expired',
  login_rejected: 'its login was rejected',
  read_only_refused: 'its login is write-capable and was not accepted for this run',
  read_only_unverifiable: 'its read-only result is unverifiable and was not accepted for this run',
  not_opened: 'it could not be opened',
  not_read: 'its read failed',
};

/**
 * #3975 (live 2026-11-09): the scope is the log archive itself; its own read
 * was the archive's read, so the note says what the archive holds.
 */
const ARCHIVE_SCOPE_REASON: Readonly<Record<string, string>> = {
  archive_scope_not_listed: 'it does not list the bucket (the bucket belongs to another account)',
  archive_scope_refused: 'it lists the bucket but its read was refused (the bucket policy must admit its role)',
};

function logArchiveNote(trails: readonly { attributes?: Record<string, unknown> }[]): string {
  const codes = [...new Set(trails.map((t) => t.attributes?.['log_archive']).filter((x): x is string => typeof x === 'string'))].sort();
  if (codes.length === 0) return '';
  const self = codes.filter((c) => c in ARCHIVE_SCOPE_REASON);
  const others = codes.filter((c) => !(c in ARCHIVE_SCOPE_REASON));
  const notes: string[] = [];
  if (self.length > 0) notes.push(`; this scope is the log archive scope: ${self.map((c) => ARCHIVE_SCOPE_REASON[c]).join(', ')}`);
  if (others.length > 0 && others.every((c) => c === 'not_registered')) notes.push('; the landing zone registers no log archive scope (scopes[].purpose: log-archive) to read it from');
  else if (others.length > 0) {
    const said = others.filter((c) => c !== 'not_registered').map((c) => (c.startsWith('http_') ? `the bucket answers HTTP ${c.slice(5)} (its bucket policy must admit the log archive role)` : LOG_ARCHIVE_REASON[c] ?? c));
    notes.push(`; nor from the log archive scope: ${said.join(', ')}`);
  }
  return notes.join('');
}

export function evalLogRetention(scan: LzLiveScan, minDays: number, unread: LzLiveObservability): PostureOutcome {
  const logging = scan.estate.posture?.logging;
  const gapOutcome = blockGap('logging', logging?.source, scan.meta.provider, unread);
  if (gapOutcome) return gapOutcome;
  const l = logging!;
  const on = l.trails.filter((t) => t.enabled);
  if (on.length === 0) return partialGuard(postureOutcome('fail', 'observed', `${plural(l.trails.length, 'trail')}, none enabled: no audit log is kept`), l.source);
  const keeps = (t: (typeof on)[number]): boolean => (t.retention_days !== undefined && t.retention_days >= minDays) || t.attributes?.['log_retention'] === 'never_expires';
  const meeting = on.filter(keeps);
  const coveredRegions = new Set(meeting.map((t) => t.region).filter((r): r is string => r !== undefined));
  // #3951: per-region trails cover a region only where an enabled trail runs; a region in use
  // (an inventory resource, global excluded) without one keeps no audit log (the audit_trail rule).
  // Coverage is any enabled multi-region trail, whatever its retention (an AWS CloudWatch copy below the minimum still covers).
  const multiRegion = on.some((t) => t.all_regions === true);
  const trailRegions = new Set(on.map((t) => t.region).filter((r): r is string => r !== undefined));
  const untrailed = multiRegion ? [] : [...new Set(scan.estate.resources.map((r) => r.region).filter((r): r is string => r !== undefined && r !== 'global'))].filter((r) => !trailRegions.has(r)).sort();
  if (untrailed.length > 0 && !on.some((t) => t.region === undefined)) {
    return partialGuard(postureOutcome('fail', 'observed', `${plural(untrailed.length, 'region')} in use without an enabled trail: no audit log is kept there`), l.source);
  }
  const allCovered = meeting.some((t) => t.all_regions === true) || (meeting.length > 0 && on.every((t) => keeps(t) || (t.region !== undefined && coveredRegions.has(t.region))));
  // A trail that also writes to another destination (Azure diagnostic settings name
  // their destinations; the retention is the Log Analytics workspace's) keeps a copy
  // whose retention is not read: its short retention cannot fail either.
  const otherStore = (t: (typeof on)[number]): boolean => {
    const d = t.attributes?.['destinations'];
    return typeof d === 'string' && d.split(',').filter((x) => x !== '').length > 1;
  };
  const copyOnly = (t: (typeof on)[number]): boolean => RETENTION_IS_COPY.has(scan.meta.provider) && t.attributes?.['retention_source'] !== PRIMARY_STORE_READ;
  const copyTrail = (t: (typeof on)[number]): boolean => copyOnly(t) || otherStore(t);
  const copy = on.some((t) => !keeps(t) && copyTrail(t));
  const short = on.filter((t) => !keeps(t) && t.retention_days !== undefined);
  const unset = on.filter((t) => !keeps(t) && t.retention_days === undefined);
  let o: PostureOutcome;
  if (allCovered) {
    o = postureOutcome('pass', 'observed', `${meeting.length === 1 ? '1 enabled trail keeps' : `${meeting.length} enabled trails keep`} logs at least ${minDays} days or without expiry, covering every region`);
  } else if (!copy && short.length > 0 && unset.length === 0) {
    o = postureOutcome('fail', 'observed', `${short.length === 1 ? '1 enabled trail keeps' : `${short.length} enabled trails keep`} logs fewer than ${minDays} days (longest ${Math.max(...short.map((t) => t.retention_days ?? 0))} days)`);
  } else {
    const parts: string[] = [];
    const longest = (ts: readonly (typeof on)[number][]): number => Math.max(...ts.map((t) => t.retention_days ?? 0));
    // #3975 (live 2026-11-09): a trail whose primary store was read (for AWS the bucket
    // lifecycle, possibly through the log archive scope) is not a copy; it is named apart
    // from the copies, with the scope it was read through.
    const primaryShort = copy ? short.filter((t) => !copyTrail(t)) : short;
    const copyShort = copy ? short.filter(copyTrail) : [];
    if (primaryShort.length > 0) {
      const via = [...new Set(primaryShort.map((t) => t.attributes?.['log_archive_scope']).filter((x): x is string => typeof x === 'string'))].sort();
      parts.push(`${plural(primaryShort.length, 'trail')} with retention below ${minDays} days (longest ${longest(primaryShort)} days${via.length > 0 ? `, read through the log archive scope ${via.join(', ')}` : ''})`);
    }
    if (copyShort.length > 0) parts.push(`${plural(copyShort.length, 'trail')} with a log copy below ${minDays} days (longest ${longest(copyShort)} days)`);
    if (unset.length > 0) parts.push(`${plural(unset.length, 'trail')} without a retention in the read`);
    // #3935: why the primary store was not read, per trail (`s3_lifecycle`: `http_403` for a bucket of another account).
    const unreadPrimary = on.filter((t) => !keeps(t) && copyOnly(t));
    const why = [...new Set(unreadPrimary.map((t) => t.attributes?.['s3_lifecycle']).filter((x): x is string => typeof x === 'string' && x.startsWith('http_')))].sort();
    const store = unreadPrimary.length > 0
      ? why.length > 0
        ? `the retention of the trail's primary store (S3 bucket lifecycle) is not readable from this scope (${why.join(', ').replace(/http_/g, 'HTTP ')})${logArchiveNote(unreadPrimary)}`
        : `the retention of the trail's primary store (S3 bucket lifecycle) is not in the read${logArchiveNote(unreadPrimary)}`
      : copy ? 'the retention of the trail\'s other destination is not read' : 'the retention of the trail\'s storage is not in the read';
    o = unverified('not_collected', `${parts.join(', ')}; ${store}`);
  }
  return partialGuard(o, l.source);
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export function evalBackupConfigured(scan: LzLiveScan, appliesTo: readonly string[]): PostureOutcome {
  const block = scan.estate.posture?.backup;
  const gapOutcome = blockGap('backup', block?.source, scan.meta.provider, 'not_collected');
  if (gapOutcome) return gapOutcome;
  const b = block!;
  const caps = capabilityIndex(scan);
  const scoped = inScope(b.items, caps, appliesTo);
  const items = scoped.items;
  const unprotected = items.filter((i) => !i.protected);
  const types = new Map<string, number>();
  for (const i of unprotected) types.set(i.type ?? 'unknown type', (types.get(i.type ?? 'unknown type') ?? 0) + 1);
  return decide({
    source: b.source,
    failing: unprotected.length,
    failDetail: `${unprotected.length} of ${plural(items.length, 'stateful resource')} without a backup: ${describeUncovered(types)}`,
    ok: items.length - unprotected.length,
    undecidedCollect: 0,
    undecidedCollectDetail: '',
    undecidedObservable: 0,
    undecidedObservableDetail: '',
    gap: uncovered(scan, caps, appliesTo, scoped.all),
    gapObservability: 'not_collected',
    unmapped: scoped.unmapped,
    judged: items.length,
    passDetail: `every stateful resource read (${items.length}) has a backup`,
    naDetail: `no stateful resource of applies_to (${appliesTo.join(', ')}) in scope`,
    naUnobservable: absenceUnobservable(scan),
    naNotCollected: uninventoried(scan, appliesTo),
  });
}
