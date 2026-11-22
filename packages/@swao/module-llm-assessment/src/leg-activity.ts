// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Leg activity while a leg runs (#4470, #4469, Design 092 s5.7).
//
// The orchestrator tails the leg's own app event log (apps/<app>/wsp/logs/
// app-events-*.ndjson inside the leg workspace) while the leg process runs:
//   - every progress event (pass start / progress / complete, LLM attempt /
//     waiting / ok / retry / timeout, a heartbeat whose pass changed) resets
//     the stall watchdog, so the watchdog fires only after a real stall;
//   - pass and retry events are forwarded to the run log (log.ndjson) as
//     they happen (leg.pass.*, leg.llm.*), so a 14 min retry series is not a
//     black spot any more;
//   - the current pass and the attempt of a call in retry feed the leg
//     heartbeat and the failure reason.
// Event context carries counts, codes and short reasons only (no prompt text).

import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface LegLogEvent {
  ts?: string;
  level?: string;
  code: string;
  message?: string;
  context: Record<string, unknown>;
}

/** Incremental reader of the newest app-events-*.ndjson of a leg workspace (complete lines only). */
export class LegLogTailer {
  private file: string | undefined;
  private offset = 0;
  private partial = '';

  constructor(private readonly logDir: string, private readonly sinceIso?: string) {}

  /** New events since the last poll (events older than `sinceIso` are skipped). */
  poll(): LegLogEvent[] {
    let newest: string | undefined;
    try {
      if (!existsSync(this.logDir)) return [];
      newest = readdirSync(this.logDir).filter((f) => /^app-events-.*\.ndjson$/.test(f)).sort().pop();
    } catch { return []; }
    if (!newest) return [];
    const path = join(this.logDir, newest);
    if (path !== this.file) { this.file = path; this.offset = 0; this.partial = ''; }
    let size = 0;
    try { size = statSync(path).size; } catch { return []; }
    if (size < this.offset) { this.offset = 0; this.partial = ''; }
    if (size === this.offset) return [];
    const buf = Buffer.alloc(size - this.offset);
    let fd: number | undefined;
    try {
      fd = openSync(path, 'r');
      readSync(fd, buf, 0, buf.length, this.offset);
    } catch { return []; } finally { if (fd !== undefined) closeSync(fd); }
    this.offset = size;
    const text = this.partial + buf.toString('utf-8');
    const lastNl = text.lastIndexOf('\n');
    this.partial = lastNl === -1 ? text : text.slice(lastNl + 1);
    const complete = lastNl === -1 ? '' : text.slice(0, lastNl);
    const out: LegLogEvent[] = [];
    for (const line of complete.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t) as { ts?: unknown; level?: unknown; code?: unknown; message?: unknown; context?: unknown };
        if (typeof e.code !== 'string') continue;
        if (this.sinceIso && typeof e.ts === 'string' && e.ts < this.sinceIso) continue;
        out.push({
          ...(typeof e.ts === 'string' ? { ts: e.ts } : {}),
          ...(typeof e.level === 'string' ? { level: e.level } : {}),
          code: e.code,
          ...(typeof e.message === 'string' ? { message: e.message } : {}),
          context: (e.context && typeof e.context === 'object' ? e.context : {}) as Record<string, unknown>,
        });
      } catch { /* skip malformed */ }
    }
    return out;
  }
}

/** What the orchestrator knows about the running leg (heartbeat, failure reason). */
export interface LegActivityState {
  /** Current pass, "03 data_classification". */
  pass?: string;
  /** Attempt and limit of the call in retry (cleared by an ok). */
  attempt?: number;
  max_attempts?: number;
  /** Short reason of the last failed attempt (timeout_idle_body, rate_limited ...). */
  last_error?: string;
  /** pass_id of the last leg heartbeat (a heartbeat counts as progress only when it changes). */
  heartbeatKey?: string;
}

/** One run-log line to forward (code, level, message, context). */
export interface ForwardedLine {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  context: Record<string, unknown>;
}

const PROVIDER_RE = /^provider\.llm\.([^.]+)\.(attempt|waiting|ok|retry|timeout|http-error|connectivity-failure|error)$/;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const secs = (ms: number | undefined): string => (ms === undefined ? '?' : `${Math.round(ms / 1000)} s`);

/** #4472: operator words for a retry reason of the request helper. */
export function retryReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'timeout_idle_body': return 'a body timeout';
    case 'timeout_idle_headers': return 'a headers timeout';
    case 'timeout_total_body':
    case 'timeout_total_headers': return 'the attempt time limit';
    case 'rate_limited': return 'a rate limit (HTTP 429)';
    case 'overloaded': return 'an overloaded provider';
    case 'server_error': return 'a server error';
    case 'request_timeout': return 'a request timeout (HTTP 408)';
    case 'network_or_malformed_response': return 'a network error or malformed response';
    case undefined: return 'an error';
    default: return reason.replace(/_/g, ' ');
  }
}

/**
 * Apply one leg event to the state; returns whether it is progress (resets the
 * stall watchdog) and the run-log line to forward, if any.
 */
export function applyLegEvent(state: LegActivityState, legId: string, e: LegLogEvent): { progress: boolean; forward?: ForwardedLine } {
  const c = e.context;
  if (e.code === 'assessment.heartbeat' || e.code.endsWith('.heartbeat')) {
    const key = str(c['pass_id']) ?? str(c['pass']) ?? str(c['phase']);
    const changed = key !== undefined && key !== state.heartbeatKey;
    if (key !== undefined) state.heartbeatKey = key;
    return { progress: changed };
  }
  const passLabel = (): string => [str(c['num']) ?? str(c['pass']), str(c['name'])].filter(Boolean).join(' ');
  if (e.code === 'assessment.pass.start') {
    state.pass = passLabel() || state.pass;
    delete state.attempt; delete state.max_attempts; delete state.last_error;
    return {
      progress: true,
      forward: { level: 'info', code: 'leg.pass.start', message: `leg ${legId}: pass ${state.pass ?? '?'} starting`, context: { leg_id: legId, pass: state.pass, pass_id: c['pass_id'] } },
    };
  }
  if (e.code === 'assessment.pass.complete') {
    const label = passLabel() || state.pass;
    return {
      progress: true,
      forward: { level: 'info', code: 'leg.pass.complete', message: `leg ${legId}: pass ${label ?? '?'} complete (${secs(num(c['wall_clock_ms']) ?? num(c['duration_ms']))})`, context: { leg_id: legId, pass: label, pass_id: c['pass_id'], ...(num(c['wall_clock_ms']) !== undefined ? { wall_clock_ms: c['wall_clock_ms'] } : {}) } },
    };
  }
  if (e.code === 'assessment.pass.connectivity-failure') {
    const label = passLabel() || state.pass;
    return {
      progress: true,
      forward: { level: 'warn', code: 'leg.pass.degraded', message: `leg ${legId}: pass ${label ?? '?'} degraded, every LLM attempt failed`, context: { leg_id: legId, pass: label, pass_id: c['pass_id'] } },
    };
  }
  const m = PROVIDER_RE.exec(e.code);
  if (m) {
    const provider = m[1]!;
    const kind = m[2]!;
    const base = { leg_id: legId, ...(state.pass ? { pass: state.pass } : {}), provider, ...(str(c['model']) ? { model: c['model'] } : {}), ...(str(c['caller']) ? { caller: c['caller'] } : {}) };
    const where = state.pass ? `pass ${state.pass}` : (str(c['caller']) ?? 'call');
    const max = num(c['max_attempts']);
    switch (kind) {
      case 'attempt':
        state.attempt = num(c['attempt']); state.max_attempts = max;
        return { progress: true };
      case 'waiting':
        return { progress: true };
      case 'ok':
        delete state.attempt; delete state.max_attempts; delete state.last_error;
        return { progress: true };
      case 'retry': {
        state.last_error = str(c['reason']);
        const next = num(c['next_attempt']);
        return {
          progress: true,
          forward: {
            level: 'warn', code: 'leg.llm.retry',
            message: `leg ${legId}: ${where}: retry ${next !== undefined ? next - 1 : '?'} of ${max !== undefined ? max - 1 : '?'} after ${retryReasonText(state.last_error)}, attempt ${next ?? '?'} of ${max ?? '?'} in ${secs(num(c['delay_ms']))}`,
            context: { ...base, attempt: c['attempt'], next_attempt: next, max_attempts: max, reason: state.last_error, delay_ms: c['delay_ms'] },
          },
        };
      }
      case 'timeout':
        return {
          progress: true,
          forward: {
            level: 'warn', code: 'leg.llm.timeout',
            message: `leg ${legId}: ${where}: call attempt ${String(c['attempt'] ?? '?')} of ${max ?? '?'} timed out after ${secs(num(c['elapsed_ms']))} (${String(c['limit'] ?? 'idle')} limit ${secs(num(c['limit_ms']))}, awaiting ${String(c['phase'] ?? '?')})`,
            context: { ...base, attempt: c['attempt'], max_attempts: max, phase: c['phase'], limit: c['limit'], limit_ms: c['limit_ms'], elapsed_ms: c['elapsed_ms'] },
          },
        };
      case 'http-error':
        return {
          progress: true,
          forward: {
            level: 'warn', code: 'leg.llm.http-error',
            message: `leg ${legId}: ${where}: HTTP ${String(c['http_status'] ?? '?')} (${String(c['reason'] ?? '?')}) on attempt ${String(c['attempt'] ?? '?')} of ${max ?? '?'}`,
            context: { ...base, attempt: c['attempt'], max_attempts: max, http_status: c['http_status'], reason: c['reason'] },
          },
        };
      case 'connectivity-failure':
        state.last_error = str(c['reason']) ?? state.last_error;
        return {
          progress: true,
          forward: {
            level: 'warn', code: 'leg.llm.connectivity-failure',
            message: `leg ${legId}: ${where}: all ${max ?? '?'} attempts failed (${retryReasonText(str(c['reason']))})`,
            context: { ...base, max_attempts: max, reason: c['reason'] },
          },
        };
      default:
        return { progress: true };
    }
  }
  // Any other leg event (dynamic.*, swao.run.*, assess.*) is progress too.
  return { progress: true };
}

/** The heartbeat fields of the state (pass, attempt, last_error). */
export function activityFields(state: LegActivityState): Record<string, unknown> {
  return {
    ...(state.pass ? { pass: state.pass } : {}),
    ...(state.attempt !== undefined ? { attempt: state.attempt } : {}),
    ...(state.max_attempts !== undefined && state.attempt !== undefined ? { max_attempts: state.max_attempts } : {}),
    ...(state.last_error ? { last_error: state.last_error } : {}),
  };
}
