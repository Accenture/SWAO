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

// #3587: privacy defaults of Design 120 section 6.4, applied to every driver's
// output in the scan assembler (scan.ts) before the LzLiveScan reaches the
// WSP. Drivers already drop names, request bodies, source IPs and the user of
// audit events (otc-driver.ts listResources / listActivity); resource tags
// are the remaining place where people appear (owner, created_by, contact).
// A tag value that names a person, or any tag value holding an e-mail
// address, becomes `Person-<hash>`: an HMAC-SHA256 keyed by a random salt per
// landing zone, kept in the vault (`lz:<lz-id>:pseudonym-salt`). The same
// person keeps the same pseudonym across runs of that landing zone, so
// ownership patterns stay visible, but the pseudonym cannot be reversed by
// hashing a list of known names or e-mail addresses (same keyed scheme as
// the support bundle, support-bundle-client-ids.ts pseudonymTag).

import { createHmac, randomBytes } from 'node:crypto';
import type { CredentialStore } from '@swao/core';

/** Tag keys whose value names a person (case-insensitive, `-`, `_`, `.` and `:` ignored). */
export const PERSON_TAG_KEYS: readonly string[] = [
  'owner', 'createdby', 'creator', 'author', 'contact', 'responsible', 'maintainer', 'manager',
  'user', 'username', 'email', 'mail', 'requester', 'requestedby', 'approver', 'technicalcontact',
  'businessowner', 'costowner', 'owneremail', 'contactemail',
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Vault key of the pseudonym salt of one landing zone. */
export function lzPseudonymSaltKey(lzId: string): string {
  return `lz:${lzId}:pseudonym-salt`;
}

/** The landing zone's pseudonym salt; created (32 random bytes, hex) on first use. */
export async function lzPseudonymSalt(store: Pick<CredentialStore, 'get' | 'set'>, lzId: string): Promise<string> {
  const key = lzPseudonymSaltKey(lzId);
  const existing = await store.get(key);
  if (existing && existing.length >= 32) return existing;
  const salt = randomBytes(32).toString('hex');
  await store.set(key, salt);
  return salt;
}

/**
 * `Person-<10 hex>`: HMAC-SHA256(salt, trimmed lower-cased value). A value that
 * already looks like a pseudonym (for example the recording neutraliser's,
 * #3598) is hashed again, so no upstream pseudonym of a person survives (#3687).
 */
export function pseudonymisePerson(value: string, salt: string): string {
  if (salt.length === 0) throw new Error('[lz live] pseudonymisation needs a salt');
  const v = value.trim();
  return `Person-${createHmac('sha256', salt).update(v.toLowerCase()).digest('hex').slice(0, 10)}`;
}

/**
 * A tag key names a person when, lower-cased without `-`, `_`, `.`, `:` and
 * spaces, it is or ends with a PERSON_TAG_KEYS entry: `created-by`,
 * `created_by`, `CreatedBy`, `aws:createdBy` (#3687, provider-neutral).
 */
function isPersonKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-_.:\s/]/g, '');
  return PERSON_TAG_KEYS.some((p) => k === p || k.endsWith(p));
}

/** Pseudonymise the person tags of one resource; other tags are kept as they are. */
/**
 * Pseudonymise the person tags of one resource; other tags are kept as they
 * are. A value is personal when its key names a person, when it holds an
 * e-mail address, or when it contains one of `people` (the scope's login
 * name, which an OTC `created-by` tag carries, #3687).
 */
export function pseudonymiseTags(tags: Readonly<Record<string, string>>, salt: string, people: readonly string[] = []): Record<string, string> {
  const known = people.map((p) => p.trim().toLowerCase()).filter((p) => p.length >= 3);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    const lower = v.toLowerCase();
    const personal = isPersonKey(k) || EMAIL_RE.test(v) || known.some((p) => lower.includes(p));
    out[k] = v.trim() !== '' && personal ? pseudonymisePerson(v, salt) : v;
  }
  return out;
}

/** Apply the tag rule to a list of resources (returns new objects; input untouched). */
export function pseudonymiseResources<T extends { tags?: Record<string, string> }>(resources: readonly T[], salt: string, people: readonly string[] = []): T[] {
  return resources.map((r) => (r.tags ? { ...r, tags: pseudonymiseTags(r.tags, salt, people) } : { ...r }));
}

// ---------------------------------------------------------------------------
// #3801: resource types carry no resource name (Design 120 section 6.4)
// ---------------------------------------------------------------------------

const SEG_SPLIT = /[/:.]+/;
const meaningful = (s: string): boolean => s.length >= 3 && s !== '*';

/** Name segments of a resource id: ARN resource segments, ARM names, else the id itself. */
export function resourceIdNameSegments(id: string): string[] {
  if (id.startsWith('arn:')) {
    const resource = id.split(':').slice(5).join(':');
    const segs = resource.split(/[/:]/).filter(meaningful);
    // A leading `<type>/` or `<type>:` is the resource type, not a name.
    const lead = /^([A-Za-z][A-Za-z0-9-]*)[/:]/.exec(resource)?.[1];
    return lead === undefined ? segs : segs.filter((s, i) => !(i === 0 && s === lead));
  }
  if (id.startsWith('/subscriptions/')) {
    const p = id.split('/').filter((s) => s !== '');
    const out: string[] = [];
    const rg = p.findIndex((s) => s.toLowerCase() === 'resourcegroups');
    if (rg >= 0 && p[rg + 1]) out.push(p[rg + 1] as string);
    const prov = p.findIndex((s) => s.toLowerCase() === 'providers');
    // providers/<namespace>/<type>/<name>[/<type>/<name>...]
    if (prov >= 0) for (let i = prov + 3; i < p.length; i += 2) out.push(p[i] as string);
    return out.filter(meaningful);
  }
  return [id].filter(meaningful);
}

/** Resource type segments that repeat a name of the resource's id (empty when the type is clean). */
export function resourceTypeNameLeaks(r: { id: string; type: string }): string[] {
  const names = new Set(resourceIdNameSegments(r.id).map((s) => s.toLowerCase()));
  const type = r.type.toLowerCase();
  const leaks = r.type.split(SEG_SPLIT).filter((s) => meaningful(s) && names.has(s.toLowerCase()));
  // #3850: a name with a dot (SQS FIFO `<name>.fifo`) is one id segment but
  // several type segments, so it is also matched as a whole inside the type.
  for (const n of names) if (n.includes('.') && type.includes(n) && !leaks.includes(n)) leaks.push(n);
  return leaks;
}

/**
 * Scan boundary guard: a type that repeats a name of its id is replaced by
 * `<first type segment>.resource`, so a driver defect cannot carry names into
 * the scan or the publications. Returns new objects and the number replaced.
 */
export function scrubResourceTypes<T extends { id: string; type: string }>(resources: readonly T[]): { resources: T[]; replaced: number } {
  let replaced = 0;
  const out = resources.map((r) => {
    if (resourceTypeNameLeaks(r).length === 0) return r;
    replaced++;
    return { ...r, type: `${r.type.split(/[.]/)[0] ?? 'resource'}.resource` };
  });
  return { resources: out, replaced };
}

// ---------------------------------------------------------------------------
// #3886: the one privacy filter of attributes maps (Design 123 sections 5.7
// and 12, Design 120 section 6.4). Applied in the scan assembler to every
// attributes map a driver returns (resources today; posture entries and
// hierarchy nodes reuse it), before the scan is stored.
// ---------------------------------------------------------------------------

/** Key segments of free text (exact): the entry is dropped. */
export const FREE_TEXT_KEYS: readonly string[] = ['desc', 'note', 'summary', 'purpose'];
/** A key segment ending with one of these is free text (`description`, `errorMessage`): the entry is dropped. */
export const FREE_TEXT_SUFFIXES: readonly string[] = ['description', 'message', 'comment', 'comments', 'remark', 'remarks', 'notes'];

/**
 * Key segments of user-defined content or secret-shaped values: the entry is
 * dropped (CLAUDE.md section 5.7). Free-form maps (`metadata`, `tags`,
 * `labels`; tags are kept in their normalised field) can hold anything.
 */
export const DROPPED_KEYS: readonly string[] = [
  'metadata', 'userdata', 'customdata', 'tags', 'labels', 'policydocument', 'script', 'environment', 'envvars', 'credentials', 'credential',
  // request and response bodies (Design 120 section 6.4)
  'request', 'response', 'body', 'requestbody', 'responsebody',
];
/** A key segment ending with one of these is secret-shaped: the entry is dropped. */
export const SECRET_KEY_SUFFIXES: readonly string[] = [
  'password', 'passwd', 'secret', 'token', 'privatekey', 'secretkey', 'accesskey', 'apikey', 'passphrase', 'connectionstring', 'certificatebody',
];

/** `<x>name` keys that name a kind, not an entity (kept as they are). */
const TECHNICAL_NAME_KEYS: readonly string[] = [
  'typename', 'flavorname', 'skuname', 'regionname', 'zonename', 'availabilityzonename', 'providername', 'protocolname', 'tiername', 'resourcetypename', 'kindname',
];
/** A plain `name` under one of these parents names a kind (`sku.name`, `flavor.name`). */
const TECHNICAL_NAME_PARENTS: readonly string[] = ['sku', 'flavor', 'tier', 'kind', 'type', 'region', 'zone', 'provider', 'protocol', 'family', 'size'];

/** Name-like keys besides `*name`. */
const NAME_KEYS: readonly string[] = ['alias', 'resourcegroup', 'fqdn', 'hostname', 'dnslabel', 'dnsprefix', 'computername'];

/** Longer strings, and strings with a line break, are free text. */
export const ATTRIBUTE_MAX_STRING = 256;

/**
 * A single host address (IPv4 or IPv6, optionally `/32` or `/128`) is
 * dropped, as the drivers did before #3886 (Design 120 section 6.4); network
 * ranges with a shorter prefix (`0.0.0.0/0`, `10.0.0.0/16`) are kept, because
 * the ingress and exposure policies need them.
 */
const IPV4_HOST = /^(\d{1,3}\.){3}\d{1,3}(\/32)?$/;
const IPV6_HOST = /^(?=[0-9A-Fa-f:]*:[0-9A-Fa-f:]*:)[0-9A-Fa-f:]{2,39}(\/128)?$/;
export const isHostAddress = (v: string): boolean => IPV4_HOST.test(v) || IPV6_HOST.test(v);

/** A key segment the driver did not choose (a map keyed by node or resource names) is not an identifier. */
const IDENTIFIER_SEGMENT = /^(\d+|[A-Za-z_$@][A-Za-z0-9_$@]{0,63})$/;

const norm = (s: string): string => s.toLowerCase().replace(/[-_.:\s/]/g, '');

/** `Name-<10 hex>`: HMAC-SHA256(salt, `name:` + trimmed lower-cased value); a separate domain from `Person-`. */
export function pseudonymiseName(value: string, salt: string): string {
  if (salt.length === 0) throw new Error('[lz live] pseudonymisation needs a salt');
  return `Name-${createHmac('sha256', salt).update(`name:${value.trim().toLowerCase()}`).digest('hex').slice(0, 10)}`;
}

type AttrValue = string | number | boolean | null | (string | number | boolean | null)[];

export type AttributeRule = 'keep' | 'drop' | 'name' | 'person';

/** The rule of one attributes key (a dotted path), from its segments. */
export function attributeKeyRule(key: string): AttributeRule {
  const segs = key.split('.');
  if (!segs.every((s) => IDENTIFIER_SEGMENT.test(s))) return 'drop';
  const named = segs.filter((s) => !/^\d+$/.test(s)).map(norm);
  if (named.some((s) => FREE_TEXT_KEYS.includes(s) || FREE_TEXT_SUFFIXES.some((x) => s.endsWith(x)) || DROPPED_KEYS.includes(s) || SECRET_KEY_SUFFIXES.some((x) => s.endsWith(x)))) return 'drop';
  const leaf = named[named.length - 1] ?? '';
  const parent = named[named.length - 2];
  if (isPersonKey(leaf) || (leaf === 'name' && parent !== undefined && isPersonKey(parent))) return 'person';
  if (leaf === 'name') return parent !== undefined && TECHNICAL_NAME_PARENTS.includes(parent) ? 'keep' : 'name';
  if (NAME_KEYS.includes(leaf) || (leaf.endsWith('name') && !TECHNICAL_NAME_KEYS.includes(leaf))) return 'name';
  return 'keep';
}

/**
 * #3953: a port's device owner (OTC VPC `vnic.deviceOwner`, Neutron
 * `device_owner`) names the service that owns the port (`compute:eu-de-01`,
 * `neutron:LOADBALANCERV2`, `neutron:VIP_PORT`), not a person; the key ends
 * with `owner`, so the person rule would hash it. Only a value of the
 * documented `<service>:<kind>` shape is kept; any other value of the key
 * stays pseudonymised.
 */
const DEVICE_OWNER_KEYS: readonly string[] = ['deviceowner'];
const DEVICE_OWNER_ENUM = /^(compute|neutron|network|baremetal):[A-Za-z0-9_.-]{1,64}$/;
export function isDeviceOwnerEnum(key: string, value: string): boolean {
  const leaf = norm(key.split('.').pop() ?? '');
  return DEVICE_OWNER_KEYS.includes(leaf) && DEVICE_OWNER_ENUM.test(value);
}

export interface AttributeFilterResult {
  attributes: Record<string, AttrValue> | undefined;
  /** Entries dropped (free text, user-defined content, secret-shaped keys, non-identifier keys, host addresses). */
  dropped: number;
}

/**
 * The privacy filter of an attributes map: names become `Name-<hash>`;
 * people (person keys, e-mail addresses, the scope's login names) become
 * `Person-<hash>`; free text, user-defined content, secret-shaped values and
 * host addresses are dropped. Ids, states, flags, sizes, timestamps and
 * network ranges are kept: the scan may hold them, publications carry counts only (Design 120
 * section 6.4). Returns a new map; the input is untouched.
 */
export function filterAttributes(attrs: Readonly<Record<string, AttrValue>> | undefined, salt: string, people: readonly string[] = []): AttributeFilterResult {
  if (attrs === undefined) return { attributes: undefined, dropped: 0 };
  const known = people.map((p) => p.trim().toLowerCase()).filter((p) => p.length >= 3);
  const out: Record<string, AttrValue> = {};
  let dropped = 0;
  const personal = (v: string): boolean => EMAIL_RE.test(v) || known.some((p) => v.toLowerCase().includes(p));
  for (const [k, v] of Object.entries(attrs)) {
    const rule = attributeKeyRule(k);
    if (rule === 'drop') {
      dropped++;
      continue;
    }
    const one = (x: string | number | boolean | null): string | number | boolean | null | undefined => {
      if (typeof x !== 'string') return x;
      if (x.length > ATTRIBUTE_MAX_STRING || /[\r\n]/.test(x) || isHostAddress(x.trim())) return undefined;
      if (x.trim() === '') return x;
      if (rule === 'person' && isDeviceOwnerEnum(k, x)) return x;
      if (rule === 'person' || personal(x)) return pseudonymisePerson(x, salt);
      if (rule === 'name') return pseudonymiseName(x, salt);
      return x;
    };
    if (Array.isArray(v)) {
      const kept = v.map(one);
      if (kept.some((x) => x === undefined)) {
        dropped++;
        continue;
      }
      out[k] = kept as (string | number | boolean | null)[];
    } else {
      const x = one(v);
      if (x === undefined) {
        dropped++;
        continue;
      }
      out[k] = x;
    }
  }
  return { attributes: Object.keys(out).length > 0 ? out : undefined, dropped };
}

/** Apply the attributes filter to a list of resources (returns new objects and the number of dropped entries). */
export function filterResourceAttributes<T extends { attributes?: Record<string, AttrValue> }>(resources: readonly T[], salt: string, people: readonly string[] = []): { resources: T[]; dropped: number } {
  let dropped = 0;
  const out = resources.map((r) => {
    if (r.attributes === undefined) return r;
    const f = filterAttributes(r.attributes, salt, people);
    dropped += f.dropped;
    const next: T = { ...r };
    if (f.attributes) next.attributes = f.attributes;
    else delete next.attributes;
    return next;
  });
  return { resources: out, dropped };
}
