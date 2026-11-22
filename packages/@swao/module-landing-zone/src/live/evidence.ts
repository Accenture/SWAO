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

// #3956 (Design 123 section 9.5, owner decision 2026-11-06 "local resolve"):
// the evidence map writer of a live run and `swao lz evidence`.
//
//   swao lz evidence --lz <lz-id> [--run <ts>]      list the references of a run
//                                                   (kind, subject, title; no native id)
//   swao lz evidence <ref> [--open] [--run-dir <d>] resolve one reference: native
//                                                   id, scope node, region, setting
//                                                   and the console link; --open opens
//                                                   the link in the default browser
//
// Exit 0 resolved or listed; 1 no run or no evidence map for the list; 2 a
// malformed, unknown or foreign-run reference, or a tier refusal.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  LZ_EVIDENCE_MAP_FILE, LzEvidenceMapSchema, LzEvidenceRefError, buildLzEvidenceMap, isLzConsoleLinkUrl, lzProviderBrand, parseLzEvidenceRef, readLzEvidenceMap, resolveLzEvidenceRef,
} from '@swao/core';
import type { CredentialStore, LzBaselineResult, LzEvidenceEntry, LzEvidenceMap, LzLiveScan, PolicyKind, ResolvedLzEvidence } from '@swao/core';
import { lzPseudonymSalt } from './privacy.js';

const RUN_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const LZ_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface WriteLzEvidenceMapInput {
  runDir: string;
  /** Run folder name; the `<run>` of every reference. */
  runId: string;
  lzId: string;
  provider: string;
  scans: readonly LzLiveScan[];
  store: Pick<CredentialStore, 'get' | 'set'>;
  /** Baseline results of the run: the policy kind of each baseline check. */
  baselineResults?: readonly LzBaselineResult[];
  /** #4050: documents of the landing zone ingestion folder (kind `document`). */
  documents?: readonly { source: string; category: string }[];
}

export type WriteLzEvidenceMapOutcome = { ok: true; entries: number; map: LzEvidenceMap } | { ok: false; reason: string };

/**
 * Write `evidence-refs.json` into the run folder. Never throws: a run whose
 * map cannot be written stays valid, its references simply do not resolve.
 */
export async function writeLzEvidenceMap(i: WriteLzEvidenceMapInput): Promise<WriteLzEvidenceMapOutcome> {
  try {
    if (!RUN_SEGMENT_RE.test(i.runId)) return { ok: false, reason: `run folder name ${i.runId} cannot carry references` };
    const salt = await lzPseudonymSalt(i.store, i.lzId);
    const policyKinds = new Map<string, PolicyKind>();
    for (const b of i.baselineResults ?? []) for (const p of b.policies) policyKinds.set(p.id, p.kind);
    const map = buildLzEvidenceMap({ runId: i.runId, lzId: i.lzId, provider: i.provider, scans: i.scans, salt, policyKinds, ...(i.documents && i.documents.length > 0 ? { documents: i.documents } : {}) });
    writeFileSync(join(i.runDir, LZ_EVIDENCE_MAP_FILE), JSON.stringify(map, null, 2) + '\n');
    return { ok: true, entries: map.entries.length, map };
  } catch (err) {
    return { ok: false, reason: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

/** Run folder name of an `--out` folder of `swao lz scan` (its basename). */
export function lzEvidenceRunIdOf(dir: string): string {
  return basename(resolve(dir));
}

export interface LzEvidenceResolveOptions {
  workspaceRoot: string;
  ref: string;
  lzId?: string;
  /** Resolve from this run folder instead of the workspace runs (a `swao lz scan --out` folder). */
  runDir?: string;
}

/** Resolve one reference; throws LzEvidenceRefError (exit 2). */
export function resolveLzEvidence(o: LzEvidenceResolveOptions): ResolvedLzEvidence {
  if (o.lzId !== undefined && !LZ_ID_RE.test(o.lzId)) throw new LzEvidenceRefError(`landing zone id '${o.lzId}' must be kebab-case`);
  if (o.runDir === undefined) return resolveLzEvidenceRef(o.workspaceRoot, o.ref, o.lzId);
  const parsed = parseLzEvidenceRef(o.ref);
  if (!parsed) throw new LzEvidenceRefError(`'${o.ref}' is not an evidence reference (ev:<run>:<check id or block>:Ref-<10 hex>)`);
  const dir = resolve(o.runDir);
  const map = readLzEvidenceMap(dir);
  if (!map) throw new LzEvidenceRefError(`no valid ${LZ_EVIDENCE_MAP_FILE} in ${dir}`);
  if (map.run_id !== parsed.run) throw new LzEvidenceRefError(`reference ${o.ref.trim()} belongs to run ${parsed.run}, not to run ${map.run_id} of ${dir}`);
  const entry = map.entries.find((e) => e.ref === o.ref.trim());
  if (!entry) throw new LzEvidenceRefError(`reference ${o.ref.trim()} is not in the evidence map of run ${map.run_id}`);
  return { lz_id: map.lz_id, provider: map.provider, run_dir: dir, entry };
}

/** Lines of a resolved reference (local output: native ids are shown here, and only here). */
export function formatLzEvidence(r: ResolvedLzEvidence): string[] {
  const e = r.entry;
  const n = e.native;
  const lines = [
    `${e.ref}`,
    `  ${e.kind} ${e.subject}: ${e.title}${e.status ? ` (${e.status})` : ''}`,
    `  landing zone ${r.lz_id} (${lzProviderBrand(r.provider)}), scope ${e.scope_id}`,
  ];
  if (n.id) lines.push(`  native id: ${n.id}`);
  if (n.type) lines.push(`  type: ${n.type}`);
  if (n.region) lines.push(`  region: ${n.region}`);
  if (n.scope_node) lines.push(`  scope node: ${n.scope_node}`);
  if (n.node_label) lines.push(`  node label: ${n.node_label}`);
  if (n.setting) lines.push(`  setting: ${n.setting}`);
  for (const [k, v] of Object.entries(n.related_ids ?? {})) lines.push(`  ${k}: ${v}`);
  if (e.console) {
    lines.push(`  console: ${e.console.url} (${e.console.precision === 'resource' ? 'opens the item' : e.console.precision === 'service-page' ? 'opens the service page' : 'opens the console'}${e.console.navigate ? `, then ${e.console.navigate}` : ''}${n.id ? '; find the item by the native id' : ''})`);
    lines.push(`  link pattern source: ${e.console.doc}`);
  } else {
    lines.push('  console: no documented console link for this item; use the native id in the console');
  }
  if (e.related.length > 0) {
    lines.push(`  evidence read by this check: ${e.related.length} reference(s)`);
    for (const ref of e.related.slice(0, 20)) lines.push(`    ${ref}`);
    if (e.related.length > 20) lines.push(`    ... ${e.related.length - 20} more (swao lz evidence --lz ${r.lz_id} --run ${parseLzEvidenceRef(e.ref)?.run ?? ''})`);
  }
  return lines;
}

export interface LzEvidenceListOptions {
  workspaceRoot: string;
  lzId: string;
  run?: string;
}

export interface LzEvidenceList {
  lz_id: string;
  run_id: string;
  entries: LzEvidenceEntry[];
}

/** The references of one run (latest by default). Throws LzEvidenceRefError when there is no map. */
export function listLzEvidence(o: LzEvidenceListOptions): LzEvidenceList {
  if (!LZ_ID_RE.test(o.lzId)) throw new LzEvidenceRefError(`landing zone id '${o.lzId}' must be kebab-case`);
  const wsp = join(o.workspaceRoot, 'landing-zones', o.lzId, 'wsp');
  const runsDir = join(wsp, 'runs');
  const runs = existsSync(runsDir) ? readdirSync(runsDir).filter((r) => RUN_SEGMENT_RE.test(r) && existsSync(join(runsDir, r, LZ_EVIDENCE_MAP_FILE))).sort() : [];
  let run: string | undefined;
  if (o.run) {
    run = o.run.replace(/:/g, '-').replace(/\.\d{1,9}Z?$|Z$/, '');
    if (!runs.includes(run)) throw new LzEvidenceRefError(`run ${o.run} of ${o.lzId} has no ${LZ_EVIDENCE_MAP_FILE}${runs.length > 0 ? ` (runs with one: ${runs.join(', ')})` : ''}`);
  } else {
    const ptr = join(wsp, 'latest-lz-live.txt');
    const pointed = existsSync(ptr) ? readFileSync(ptr, 'utf-8').trim() : '';
    run = runs.includes(pointed) ? pointed : runs[runs.length - 1];
  }
  if (!run) throw new LzEvidenceRefError(`no live run of ${o.lzId} with an evidence map; run swao assess --type landing-zone-live --lz ${o.lzId} first`);
  const raw = JSON.parse(readFileSync(join(runsDir, run, LZ_EVIDENCE_MAP_FILE), 'utf-8')) as unknown;
  const map = LzEvidenceMapSchema.parse(raw);
  return { lz_id: o.lzId, run_id: run, entries: map.entries };
}

/** List lines: references with kind, subject and title; no native id (safe to paste). */
export function formatLzEvidenceList(l: LzEvidenceList): string[] {
  const counts = new Map<string, number>();
  for (const e of l.entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const lines = [`landing zone ${l.lz_id}, run ${l.run_id}: ${l.entries.length} evidence reference(s) (${[...counts].map(([k, c]) => `${k} ${c}`).join(', ')})`];
  for (const e of l.entries) lines.push(`  ${e.ref}  ${e.kind}  ${e.title}${e.status ? ` (${e.status})` : ''}`);
  lines.push(`resolve one: swao lz evidence <ref> [--open]`);
  return lines;
}

/**
 * Open a console link in the default browser. Only URLs the link builder can
 * produce are opened (lz-console-links.ts allowlist); spawned without a shell.
 */
export function openLzConsoleLink(url: string, spawnImpl: typeof spawn = spawn): boolean {
  if (!isLzConsoleLinkUrl(url)) return false;
  try {
    const [cmd, args] = process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]] as const
      : process.platform === 'darwin' ? ['open', [url]] as const : ['xdg-open', [url]] as const;
    spawnImpl(cmd, [...args], { detached: true, stdio: 'ignore', shell: false }).unref();
    return true;
  } catch {
    return false;
  }
}
