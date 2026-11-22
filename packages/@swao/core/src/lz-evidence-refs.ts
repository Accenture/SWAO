// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3956 (Design 123 section 9.5, owner decision 2026-11-06 "local resolve"):
// evidence references of a Landing Zone Live run.
//
// Every finding (baseline check, posture item, resource, hierarchy node,
// guardrail, service light) gets a stable reference
//
//     ev:<run>:<check id or block>:Ref-<10 hex>
//
// with no native id in it. `Ref-<10 hex>` is an HMAC-SHA256 of the evidence
// kind, the scope and the native key, keyed by the landing zone pseudonym
// salt (the vault key of privacy.ts), in its own domain (`ev|`), so a list of
// known ids cannot be hashed back to it. The native reference (provider,
// native id, scope node, region, setting) and the console link live only in
// the evidence map `evidence-refs.json` next to the run's scans: local,
// never published, never synced. `swao lz evidence <ref>`, the TUI and the
// local HTML Editor resolve a reference from the map; publications carry the
// reference only (Design 120 section 12, Design 123 section 9.5).

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { lzLivePostureEntryKey } from './lz-live-scan.js';
import type { LzLiveScan } from './lz-live-scan.js';
import type { PolicyKind } from './policy-baseline.js';
import { LzConsoleLinkSchema, lzConsoleLink } from './lz-console-links.js';

export const LZ_EVIDENCE_MAP_FILE = 'evidence-refs.json';
export const LZ_EVIDENCE_MAP_SCHEMA = 'lz-evidence-refs/1';

/** Evidence kinds; the `subject` of a non-check reference is the kind's block name. */
export const LZ_EVIDENCE_KINDS = [
  'check', 'resource', 'encryption', 'exposure', 'ingress_rule', 'backup', 'budget', 'trail', 'identity', 'hierarchy_node', 'guardrail', 'service',
  // #4050: an organisational document of the landing zone ingestion folder (native id = its path in the folder).
  'document',
] as const;
export type LzEvidenceKind = (typeof LZ_EVIDENCE_KINDS)[number];

/** Block name used as the subject of a reference per kind (`check` uses the check id). */
export const LZ_EVIDENCE_SUBJECT: Readonly<Record<Exclude<LzEvidenceKind, 'check'>, string>> = {
  resource: 'resource',
  encryption: 'encryption',
  exposure: 'exposure',
  ingress_rule: 'ingress_rules',
  backup: 'backup',
  budget: 'budgets',
  trail: 'logging',
  identity: 'identity',
  hierarchy_node: 'hierarchy',
  guardrail: 'guardrail',
  service: 'service',
  document: 'document',
};

export const LZ_EVIDENCE_LABEL_PATTERN = /^Ref-[0-9a-f]{10}$/;
/** Same rule as the run folder names (lz-live-run.ts RUN_SEGMENT_RE). */
const RUN_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const REF_RE = /^ev:([A-Za-z0-9][A-Za-z0-9_.-]{0,80}):(.+):(Ref-[0-9a-f]{10})$/;

export const LzEvidenceNativeSchema = z.object({
  /** Provider id of the item (resource id, ARN, node id, guardrail id); absent for a block-level entry. */
  id: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  /** Native node id of the scope (account, project, subscription), when the scan has the tree. */
  scope_node: z.string().min(1).optional(),
  /** The setting the evidence is about, for example `inbound tcp 22-22 from 0.0.0.0/0` or `at_rest key customer-managed`. */
  setting: z.string().min(1).optional(),
  /** Other provider ids of the item (key, policy, bound resource, remote group). */
  related_ids: z.record(z.string(), z.string().min(1)).optional(),
  /** Pseudonym label of a hierarchy node (`Node-<hex>`), for orientation. */
  node_label: z.string().min(1).optional(),
}).strict();
export type LzEvidenceNative = z.infer<typeof LzEvidenceNativeSchema>;

export const LzEvidenceEntrySchema = z.object({
  ref: z.string().regex(REF_RE),
  kind: z.enum(LZ_EVIDENCE_KINDS),
  scope_id: z.string().min(1),
  /** Check id, or the block name of LZ_EVIDENCE_SUBJECT. */
  subject: z.string().min(1),
  /** Lookup key of the publication join (`<kind>|<scope>|<native key>`); holds native ids, never published. */
  key: z.string().min(1),
  /** Short description without names or ids, for lists. */
  title: z.string().min(1),
  status: z.string().min(1).optional(),
  native: LzEvidenceNativeSchema,
  /** Evidence references a check reads (posture items, resources, guardrails). */
  related: z.array(z.string().regex(REF_RE)).default([]),
  console: LzConsoleLinkSchema.optional(),
}).strict();
export type LzEvidenceEntry = z.infer<typeof LzEvidenceEntrySchema>;

export const LzEvidenceMapSchema = z.object({
  schema: z.literal(LZ_EVIDENCE_MAP_SCHEMA),
  lz_id: z.string().min(1),
  provider: z.string().min(1),
  run_id: z.string().regex(RUN_RE),
  generated_at: z.string().min(1),
  entries: z.array(LzEvidenceEntrySchema),
}).strict().superRefine((v, ctx) => {
  const seen = new Set<string>();
  v.entries.forEach((e, i) => {
    if (seen.has(e.ref)) ctx.addIssue({ code: 'custom', path: ['entries', i, 'ref'], message: `duplicate evidence reference ${e.ref}` });
    seen.add(e.ref);
    if (!e.ref.startsWith(`ev:${v.run_id}:`)) ctx.addIssue({ code: 'custom', path: ['entries', i, 'ref'], message: 'reference of another run' });
  });
});
export type LzEvidenceMap = z.infer<typeof LzEvidenceMapSchema>;

export interface ParsedLzEvidenceRef { run: string; subject: string; label: string }

/** Parse a reference from both ends, so a subject holding `:` cannot break it; null when malformed. */
export function parseLzEvidenceRef(ref: string): ParsedLzEvidenceRef | null {
  const m = REF_RE.exec(ref.trim());
  if (!m) return null;
  return { run: m[1] as string, subject: m[2] as string, label: m[3] as string };
}

export function formatLzEvidenceRef(run: string, subject: string, label: string): string {
  return `ev:${run}:${subject}:${label}`;
}

/** `Ref-<10 hex>`: HMAC-SHA256(salt, `ev|<kind>|<scope>|<native key>`). */
export function lzEvidenceLabel(salt: string, kind: LzEvidenceKind, scopeId: string, nativeKey: string): string {
  if (salt.length === 0) throw new Error('[lz live] evidence references need the pseudonym salt');
  return `Ref-${createHmac('sha256', salt).update(`ev|${kind}|${scopeId}|${nativeKey}`).digest('hex').slice(0, 10)}`;
}

/** Blocks each baseline policy kind reads (exhaustive: a new kind fails to compile here). */
export function lzEvidenceKindsForPolicy(kind: PolicyKind): readonly LzEvidenceKind[] {
  switch (kind) {
    case 'region_residency': return ['resource'];
    case 'service_deny': return ['resource', 'service'];
    case 'service_allow_list': return ['resource', 'service'];
    case 'encryption_at_rest': return ['encryption'];
    case 'encryption_in_transit': return ['encryption'];
    case 'no_public_exposure': return ['exposure'];
    case 'no_open_admin_ingress': return ['ingress_rule'];
    case 'privileged_mfa': return ['identity'];
    case 'credential_age': return ['identity'];
    case 'audit_trail': return ['trail', 'guardrail'];
    case 'log_retention': return ['trail'];
    case 'required_tags': return ['resource'];
    case 'min_availability_zones': return [];
    case 'backup_configured': return ['backup'];
    case 'budget_alerts': return ['budget'];
    case 'documented_exit': return [];
    default: {
      const never: never = kind;
      return never;
    }
  }
}

export interface BuildLzEvidenceMapInput {
  runId: string;
  lzId: string;
  provider: string;
  /** Scans written to this run (after evaluation, so `estate.checks` are final). */
  scans: readonly LzLiveScan[];
  salt: string;
  /** Policy kind per check id (baseline checks); other checks get no related refs. */
  policyKinds?: ReadonlyMap<string, PolicyKind>;
  /** #4050: organisational documents of the landing zone ingestion folder (path relative to the folder, Pass 00 category). */
  documents?: readonly { source: string; category: string }[];
  generatedAt?: string;
}

/**
 * Build the evidence map of one run. Pure apart from the HMAC. Throws when
 * two different native keys collide on one reference (never seen; 40 bits).
 */
export function buildLzEvidenceMap(input: BuildLzEvidenceMapInput): LzEvidenceMap {
  if (input.salt.length === 0) throw new Error('[lz live] evidence references need the pseudonym salt');
  const entries: LzEvidenceEntry[] = [];
  const byKey = new Map<string, LzEvidenceEntry>();
  const byRef = new Map<string, string>();
  const relatedByScope = new Map<string, Map<LzEvidenceKind, string[]>>();
  const add = (kind: Exclude<LzEvidenceKind, 'check'>, scopeId: string, nativeKey: string, e: Omit<LzEvidenceEntry, 'ref' | 'kind' | 'scope_id' | 'subject' | 'key' | 'related' | 'console'>, consoleType?: string): string => {
    const key = `${kind}|${scopeId}|${nativeKey}`;
    const prev = byKey.get(key);
    if (prev) return prev.ref;
    const ref = formatLzEvidenceRef(input.runId, LZ_EVIDENCE_SUBJECT[kind], lzEvidenceLabel(input.salt, kind, scopeId, nativeKey));
    const clash = byRef.get(ref);
    if (clash !== undefined && clash !== key) throw new Error(`[lz live] evidence reference collision on ${ref}`);
    byRef.set(ref, key);
    // #4050: a document is a local file, not a console item: no console link.
    const link = kind === 'document' ? undefined : lzConsoleLink({ provider: input.provider, kind, ...((consoleType ?? e.native.type) !== undefined ? { type: (consoleType ?? e.native.type) as string } : {}), ...(e.native.region ? { region: e.native.region } : {}) });
    const entry: LzEvidenceEntry = { ref, kind, scope_id: scopeId, subject: LZ_EVIDENCE_SUBJECT[kind], key, ...e, related: [], ...(link ? { console: link } : {}) };
    entries.push(entry);
    byKey.set(key, entry);
    const rel = relatedByScope.get(scopeId) ?? new Map<LzEvidenceKind, string[]>();
    rel.set(kind, [...(rel.get(kind) ?? []), ref]);
    relatedByScope.set(scopeId, rel);
    return ref;
  };

  for (const scan of input.scans) {
    const scope = scan.meta.scope_id;
    const scopeNode = scan.estate.hierarchy?.scope_node;
    const base = scopeNode ? { scope_node: scopeNode } : {};
    for (const r of scan.estate.resources) {
      add('resource', scope, r.id, { title: `resource ${r.service_code ?? r.type}`, native: { id: r.id, type: r.type, ...(r.region ? { region: r.region } : {}), ...base } });
    }
    const p = scan.estate.posture;
    for (const e of p?.encryption?.items ?? []) {
      add('encryption', scope, lzLivePostureEntryKey('encryption', e), {
        title: `${e.layer === 'at_rest' ? 'encryption at rest' : 'encryption in transit'} of ${e.type ?? 'a resource'}`,
        native: { id: e.resource_id, ...(e.type ? { type: e.type } : {}), ...(e.region ? { region: e.region } : {}), ...base,
          setting: [e.layer, e.encrypted === undefined ? 'unknown' : e.encrypted ? 'encrypted' : 'not encrypted', e.key_custody, e.min_tls_version ? `tls ${e.min_tls_version}` : undefined].filter(Boolean).join(' '),
          ...(e.key_id ? { related_ids: { key: e.key_id } } : {}) },
      }, e.key_id ? 'kms.key' : undefined);
    }
    for (const e of p?.exposure?.items ?? []) {
      add('exposure', scope, lzLivePostureEntryKey('exposure', e), {
        title: `${e.exposure.replace(/_/g, ' ')} of ${e.type ?? 'a resource'}`,
        native: { id: e.resource_id, ...(e.type ? { type: e.type } : {}), ...(e.region ? { region: e.region } : {}), ...base, setting: `${e.exposure} ${e.public ? 'public' : 'not public'}`, ...(e.bound_to ? { related_ids: { bound_to: e.bound_to } } : {}) },
      });
    }
    for (const e of p?.ingress_rules?.items ?? []) {
      const ports = e.port_from === undefined && e.port_to === undefined ? 'all ports' : `${e.port_from ?? '*'}-${e.port_to ?? '*'}`;
      add('ingress_rule', scope, lzLivePostureEntryKey('ingress_rules', e), {
        title: `inbound rule ${e.protocol} ${ports} of a security group`,
        native: { id: e.resource_id, ...(e.type ? { type: e.type } : {}), ...(e.region ? { region: e.region } : {}), ...base,
          setting: `inbound ${e.action} ${e.protocol} ${ports} from ${e.remote_cidr ?? (e.remote_group_id ? 'a security group' : 'any')}`,
          ...(e.remote_group_id ? { related_ids: { remote_group: e.remote_group_id } } : {}) },
      });
    }
    for (const e of p?.backup?.items ?? []) {
      add('backup', scope, lzLivePostureEntryKey('backup', e), {
        title: `backup of ${e.type ?? 'a resource'}`,
        native: { id: e.resource_id, ...(e.type ? { type: e.type } : {}), ...(e.region ? { region: e.region } : {}), ...base,
          setting: `${e.protected ? 'protected' : 'not protected'}${e.retention_days !== undefined ? `, retention ${e.retention_days} days` : ''}`,
          ...(e.policy_id ? { related_ids: { policy: e.policy_id } } : {}) },
      });
    }
    for (const e of p?.budgets?.items ?? []) {
      add('budget', scope, lzLivePostureEntryKey('budgets', e), {
        title: `${e.budget_kind} budget`,
        native: { id: e.resource_id, ...(e.type ? { type: e.type } : {}), ...base,
          setting: `${e.budget_kind}${e.period ? ` ${e.period}` : ''}, ${e.alerts.length} alert(s)`,
          ...(e.scope ? { related_ids: { scope: e.scope } } : {}) },
      });
    }
    if (p?.logging) {
      p.logging.trails.forEach((t, i) => {
        add('trail', scope, t.resource_id ?? `${t.region ?? 'global'}#${i}`, {
          title: `audit trail${t.region ? ` in ${t.region}` : ''}`,
          native: { ...(t.resource_id ? { id: t.resource_id } : {}), ...(t.region ? { region: t.region } : {}), ...base, setting: `${t.enabled ? 'enabled' : 'disabled'}${t.all_regions ? ', all regions' : ''}${t.retention_days !== undefined ? `, retention ${t.retention_days} days` : ''}` },
        });
      });
    }
    if (p?.identity) {
      const id = p.identity;
      add('identity', scope, 'identity', {
        title: 'identity posture of the scope (users and credentials)',
        native: { ...base, setting: `${id.privileged_principals ?? '?'} privileged principals, ${id.privileged_without_mfa ?? '?'} without MFA, ${id.credentials.length} credentials` },
      });
    }
    for (const n of scan.estate.hierarchy?.nodes ?? []) {
      add('hierarchy_node', scope, n.id, {
        title: `${n.native_kind ?? n.kind}${n.status === 'unknown' ? ' (unknown)' : ''}`,
        native: { id: n.id, type: n.native_kind ?? n.kind, ...(n.label ? { node_label: n.label } : {}) },
      });
    }
    for (const g of scan.estate.guardrails) {
      add('guardrail', scope, `${g.type}#${g.id ?? ''}`, {
        title: `guardrail ${g.type}`, status: g.status,
        native: { ...(g.id ? { id: g.id } : {}), type: g.type, ...base, ...(g.detail ? { setting: g.detail } : {}) },
      });
    }
    for (const s of scan.offering.services) {
      add('service', 'lz', s.code, {
        title: `service ${s.code}`,
        native: { type: s.code, setting: `regions ${Object.keys(s.regions).sort().join(', ')}` },
      });
    }
  }

  // #4050: landing zone level documents (scope `lz`); the title names the category, never the file.
  for (const d of input.documents ?? []) {
    add('document', 'lz', d.source, { title: `organisational document (${d.category})`, native: { id: d.source, type: d.category } });
  }

  // Checks last: their related refs are the entries of the blocks they read in the same scope.
  for (const scan of input.scans) {
    const scope = scan.meta.scope_id;
    const scopeNode = scan.estate.hierarchy?.scope_node;
    for (const c of scan.estate.checks) {
      const key = `check|${scope}|${c.id}`;
      if (byKey.has(key)) continue;
      const ref = formatLzEvidenceRef(input.runId, c.id, lzEvidenceLabel(input.salt, 'check', scope, `${c.id}#${c.node_id ?? ''}`));
      const clash = byRef.get(ref);
      if (clash !== undefined && clash !== key) throw new Error(`[lz live] evidence reference collision on ${ref}`);
      byRef.set(ref, key);
      const kind = input.policyKinds?.get(c.id);
      const rel = relatedByScope.get(scope);
      const related = kind ? lzEvidenceKindsForPolicy(kind).flatMap((k) => (k === 'service' ? relatedByScope.get('lz')?.get('service') : rel?.get(k)) ?? []) : [];
      const nodeEntry = c.node_id ? byKey.get(`hierarchy_node|${scope}|${c.node_id}`) : undefined;
      const entry: LzEvidenceEntry = {
        ref, kind: 'check', scope_id: scope, subject: c.id, key, title: c.title, status: c.status,
        native: { ...(c.node_id ? { id: c.node_id } : {}), ...(scopeNode ? { scope_node: scopeNode } : {}), ...(nodeEntry?.native.node_label ? { node_label: nodeEntry.native.node_label } : {}), ...(kind ? { type: kind } : {}) },
        related,
      };
      const firstRelated = related.length > 0 ? entries.find((e) => e.ref === related[0]) : undefined;
      if (firstRelated?.console) entry.console = firstRelated.console;
      else {
        const link = lzConsoleLink({ provider: input.provider, kind: 'check' });
        if (link) entry.console = link;
      }
      entries.push(entry);
      byKey.set(key, entry);
    }
  }

  return LzEvidenceMapSchema.parse({
    schema: LZ_EVIDENCE_MAP_SCHEMA,
    lz_id: input.lzId,
    provider: input.provider,
    run_id: input.runId,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    entries,
  });
}

/** Read and validate the evidence map of one run folder; null when absent or invalid. */
export function readLzEvidenceMap(runDir: string): LzEvidenceMap | null {
  const p = join(runDir, LZ_EVIDENCE_MAP_FILE);
  if (!existsSync(p)) return null;
  try {
    const r = LzEvidenceMapSchema.safeParse(JSON.parse(readFileSync(p, 'utf-8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * Lookups for a publication: the reference of a check, guardrail, service or
 * hierarchy node, joined in memory by native key. Only the reference string
 * leaves; the native key never does.
 */
export interface LzEvidencePublicIndex {
  check(scopeId: string, checkId: string): string | undefined;
  guardrail(scopeId: string, type: string, id: string | undefined): string | undefined;
  service(code: string): string | undefined;
  node(nativeId: string): string | undefined;
  /** #4050: reference of an organisational document by its path in the ingestion folder. */
  document(source: string): string | undefined;
}

export function lzEvidencePublicIndex(map: LzEvidenceMap | null): LzEvidencePublicIndex {
  const byKey = new Map((map?.entries ?? []).map((e) => [e.key, e.ref] as const));
  const nodes = new Map<string, string>();
  for (const e of map?.entries ?? []) if (e.kind === 'hierarchy_node' && e.native.id && !nodes.has(e.native.id)) nodes.set(e.native.id, e.ref);
  return {
    check: (scopeId, checkId) => byKey.get(`check|${scopeId}|${checkId}`),
    guardrail: (scopeId, type, id) => byKey.get(`guardrail|${scopeId}|${type}#${id ?? ''}`),
    service: (code) => byKey.get(`service|lz|${code}`),
    node: (nativeId) => nodes.get(nativeId),
    document: (source) => byKey.get(`document|lz|${source}`),
  };
}

export class LzEvidenceRefError extends Error {
  readonly exitCode = 2;
}

export interface ResolvedLzEvidence {
  lz_id: string;
  provider: string;
  run_dir: string;
  entry: LzEvidenceEntry;
}

/**
 * Resolve a reference in a workspace: the run named in the reference, under
 * `landing-zones/<lz-id>/wsp/runs/<run>/evidence-refs.json` of any (or the
 * named) landing zone. Throws LzEvidenceRefError (exit 2) for a malformed,
 * unknown or foreign-run reference.
 */
export function resolveLzEvidenceRef(workspaceRoot: string, ref: string, lzId?: string): ResolvedLzEvidence {
  const parsed = parseLzEvidenceRef(ref);
  if (!parsed) throw new LzEvidenceRefError(`'${ref}' is not an evidence reference (ev:<run>:<check id or block>:Ref-<10 hex>)`);
  const lzRoot = join(workspaceRoot, 'landing-zones');
  const lzIds = lzId !== undefined ? [lzId] : existsSync(lzRoot) ? readdirSync(lzRoot).filter((d) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d)).sort() : [];
  let runSeen = false;
  for (const id of lzIds) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) continue;
    const runDir = join(lzRoot, id, 'wsp', 'runs', parsed.run);
    if (!existsSync(runDir)) continue;
    runSeen = true;
    const map = readLzEvidenceMap(runDir);
    const entry = map?.entries.find((e) => e.ref === ref.trim());
    if (map && entry) return { lz_id: map.lz_id, provider: map.provider, run_dir: runDir, entry };
  }
  if (!runSeen) throw new LzEvidenceRefError(`run ${parsed.run} of reference ${ref.trim()} is not in this workspace${lzId ? ` (landing zone ${lzId})` : ''}; evidence references resolve only in the workspace that ran the assessment`);
  throw new LzEvidenceRefError(`reference ${ref.trim()} is not in the evidence map of run ${parsed.run} (${LZ_EVIDENCE_MAP_FILE} missing, or the reference belongs to another landing zone or run)`);
}
