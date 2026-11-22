// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing Zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4233 (Design 120 section 14.2): the last read-only probe per scope, so the
// health check can show the live connection facts without a network call.
// `runLzProbe` records every probe it runs (CLI, Setup Probe step, connect)
// and so does `runLzLiveScan` (the probe of an LZ Live run, caller `lz.scan`),
// in `landing-zones/<lz-id>/wsp/last-probe.json`. The record holds
// the read-only state, the coverage counts, the masked driver reason, the time
// and the caller: no identity, no credential value, no native id.
//
// The same file also gives the last LZ Live run facts per scope (services and
// resources read, observation time), read from the run `latest-lz-live.txt`
// names.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { maskNativeIds } from '@swao/core';
import { LZ_LIVE_LATEST_FILE, lzLiveWspDir } from './assess.js';
import type { ReadOnlyProbe } from './types.js';

export const LZ_PROBE_RECORD_FILE = 'last-probe.json';
export const LZ_PROBE_RECORD_SCHEMA = 'lz-probe-record/1';
/** Clip of the stored driver reason (the log event clips the same way). */
const REASON_MAX = 160;
/** #4233: the probe outcomes; `login-failed` when the provider refused the stored login (LiveAuthError). */
const READ_ONLY_STATES = ['verified', 'refused', 'unverifiable', 'login-failed'] as const;
/** Keys never written or read as a scope id (object path guard). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type LzProbeReadOnly = (typeof READ_ONLY_STATES)[number];

export interface LzProbeRecord {
  read_only: LzProbeReadOnly;
  readable: number;
  unreadable: number;
  /** Masked, clipped driver reason (no native id). */
  reason?: string;
  /** ISO time of the probe. */
  probed_at: string;
  /** Who ran the probe (`lz.probe`, `wizard.lz-live.probe`, `lz.connect`, ...). */
  caller: string;
}

function recordPath(workspaceRoot: string, lzId: string): string {
  return join(lzLiveWspDir(workspaceRoot, lzId), LZ_PROBE_RECORD_FILE);
}

function isRecord(v: unknown): v is LzProbeRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (READ_ONLY_STATES as readonly unknown[]).includes(r['read_only'])
    && typeof r['readable'] === 'number' && typeof r['unreadable'] === 'number'
    && typeof r['probed_at'] === 'string' && Number.isFinite(Date.parse(r['probed_at']))
    && typeof r['caller'] === 'string'
    && (r['reason'] === undefined || typeof r['reason'] === 'string');
}

/** The stored probe records of one landing zone, by scope id (empty when none or unreadable). */
export function readLzProbeRecords(workspaceRoot: string, lzId: string): Map<string, LzProbeRecord> {
  const out = new Map<string, LzProbeRecord>();
  const p = recordPath(workspaceRoot, lzId);
  if (!existsSync(p)) return out;
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(p, 'utf-8')); } catch { return out; }
  const scopes = (doc as { scopes?: unknown } | null)?.scopes;
  if (!scopes || typeof scopes !== 'object') return out;
  for (const [id, rec] of Object.entries(scopes as Record<string, unknown>)) {
    if (UNSAFE_KEYS.has(id) || !isRecord(rec)) continue;
    out.set(id, rec);
  }
  return out;
}

/**
 * Store the probe of one scope (merged with the other scopes of the landing
 * zone). Never throws: a probe whose record cannot be written still counts.
 * Returns false when nothing was written.
 */
export function recordLzProbe(args: {
  workspaceRoot: string;
  lzId: string;
  scopeId: string;
  /** The probe result, or the HTTP status of a refused login (no detail: it can name the account). */
  probe: Pick<ReadOnlyProbe, 'read_only' | 'coverage' | 'reason'> | { loginFailed: { httpStatus: number } };
  caller: string;
  now?: Date;
}): boolean {
  if (UNSAFE_KEYS.has(args.scopeId) || UNSAFE_KEYS.has(args.lzId)) return false;
  try {
    const existing = readLzProbeRecords(args.workspaceRoot, args.lzId);
    const p = args.probe;
    const failed = 'loginFailed' in p;
    const rawReason = failed ? `authentication failed (HTTP ${p.loginFailed.httpStatus})` : p.reason;
    const reason = rawReason ? maskNativeIds(rawReason) : undefined;
    existing.set(args.scopeId, {
      read_only: failed ? 'login-failed' : p.read_only,
      readable: failed ? 0 : p.coverage.readable.length,
      unreadable: failed ? 0 : p.coverage.unreadable.length,
      ...(reason ? { reason: reason.length > REASON_MAX ? `${reason.slice(0, REASON_MAX - 3)}...` : reason } : {}),
      probed_at: (args.now ?? new Date()).toISOString(),
      caller: args.caller,
    });
    const scopes = Object.fromEntries([...existing.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const dir = lzLiveWspDir(args.workspaceRoot, args.lzId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(recordPath(args.workspaceRoot, args.lzId), JSON.stringify({ schema: LZ_PROBE_RECORD_SCHEMA, scopes }, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** What the last LZ Live run read for one scope. */
export interface LzLastRunFacts {
  run_id: string;
  observed_at: string;
  services: number;
  resources: number;
}

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

/**
 * The scans of the run `latest-lz-live.txt` names, by scope id: services and
 * resources read and the observation time (counts only). Empty when no run.
 */
export function readLzLastRunFacts(workspaceRoot: string, lzId: string): Map<string, LzLastRunFacts> {
  const out = new Map<string, LzLastRunFacts>();
  const wsp = lzLiveWspDir(workspaceRoot, lzId);
  let runId: string;
  try { runId = readFileSync(join(wsp, LZ_LIVE_LATEST_FILE), 'utf-8').trim(); } catch { return out; }
  if (!RUN_ID.test(runId)) return out;
  const dir = join(wsp, 'runs', runId);
  let names: string[];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (!name.startsWith(`${lzId}.`) || !name.endsWith('.lz-live-scan.json')) continue;
    try {
      const scan = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as {
        meta?: { scope_id?: unknown; observed_at?: unknown };
        offering?: { services?: unknown };
        estate?: { resources?: unknown };
      };
      const scopeId = scan.meta?.scope_id;
      const observedAt = scan.meta?.observed_at;
      if (typeof scopeId !== 'string' || UNSAFE_KEYS.has(scopeId) || typeof observedAt !== 'string') continue;
      out.set(scopeId, {
        run_id: runId,
        observed_at: observedAt,
        services: Array.isArray(scan.offering?.services) ? scan.offering.services.length : 0,
        resources: Array.isArray(scan.estate?.resources) ? scan.estate.resources.length : 0,
      });
    } catch { /* unreadable scan: no facts for that scope */ }
  }
  return out;
}
