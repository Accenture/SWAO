// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, LLM Assessment run screen output lines
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4472: the Output lines of the LLM Assessment run screen from the running
// leg's own event log (polled by useLlmRunning), and the passes the leg has
// finished (they move the Stage bar). A call line names who made the call:
// the pass ("pass 03: LLM call complete (28s)") or the challenge agent
// ("Challenge, FinOps Lead: LLM call complete (46s)"); a retry line names the
// pass and the reason ("pass 03: retry 1 of 5 after a body timeout").

import { retryReasonText } from '@swao/module-llm-assessment';

export interface LegLogEntry {
  code?: string;
  message?: string;
  context?: Record<string, unknown>;
}

export interface LegEventFormatter {
  /** The Output line of one leg event, or null when the event is not shown. */
  line(entry: LegLogEntry): string | null;
  /** Distinct passes of the leg that completed so far. */
  passesDone(): number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const secs = (ms: unknown): string => (typeof ms === 'number' ? `${Math.round(ms / 1000)}s` : '?');

/** A fresh formatter per leg (passes, the current pass and the agent roles are per leg). */
export function createLegEventFormatter(): LegEventFormatter {
  const done = new Set<string>();
  let currentPass: string | undefined;
  /** challenge.<type>.<agent> -> "Challenge, <role>" / "LZ challenge, <role>". */
  const roles = new Map<string, string>();

  const who = (ctx: Record<string, unknown>): string => {
    const caller = str(ctx['caller']);
    if (caller && caller.startsWith('challenge.')) {
      const known = roles.get(caller);
      if (known) return known;
      const [, type, agent] = caller.split('.');
      return `${type === 'lz' ? 'LZ challenge' : 'Challenge'}, ${agent ?? 'agent'}`;
    }
    return currentPass ? `pass ${currentPass}` : (caller ?? 'LLM');
  };

  return {
    passesDone: () => done.size,
    line(entry) {
      const code = entry.code ?? '';
      const ctx = entry.context ?? {};
      // #2598: orchestrator-level progress lines (leg start / complete / challenge).
      if (code === 'llm_assess.progress') return entry.message ?? '';
      if (code === 'assessment.pass.start') {
        currentPass = str(ctx['num']) ?? currentPass;
        return `  pass ${String(ctx['num'] ?? '?')}: ${String(ctx['name'] ?? ctx['pass'] ?? '?')} starting`;
      }
      if (code === 'assessment.pass.complete') {
        const key = str(ctx['num']) ?? str(ctx['pass']) ?? str(ctx['pass_id']);
        if (key) done.add(key);
        return `  pass ${String(ctx['num'] ?? '?')}: ${String(ctx['name'] ?? ctx['pass'] ?? '?')} complete (${secs(ctx['wall_clock_ms'])})`;
      }
      if (code === 'challenge.agent.start') {
        const type = str(ctx['type']) ?? 'app';
        const agent = str(ctx['agent_id']);
        const role = str(ctx['role']) ?? agent;
        if (agent) roles.set(`challenge.${type}.${agent}`, `${type === 'lz' ? 'LZ challenge' : 'Challenge'}, ${role}`);
        currentPass = undefined;
        return null;
      }
      if (/^provider\.llm\.[^.]+\.retry$/.test(code)) {
        const next = num(ctx['next_attempt']);
        const max = num(ctx['max_attempts']);
        return `    ${who(ctx)}: retry ${next !== undefined ? next - 1 : '?'} of ${max !== undefined ? max - 1 : '?'} after ${retryReasonText(str(ctx['reason']))}`;
      }
      if (/^provider\.llm\.[^.]+\.ok$/.test(code)) {
        const attempt = num(ctx['attempt']);
        return `    ${who(ctx)}: LLM call complete (${attempt !== undefined && attempt > 1 ? `attempt ${attempt}, ` : ''}${secs(ctx['latency_ms'])})`;
      }
      return null;
    },
  };
}
