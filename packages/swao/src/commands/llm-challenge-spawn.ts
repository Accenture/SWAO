// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, LLM Assessment leg challenge spawn
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4478: one challenge process spawn for the CLI (`assess --type llm`) and the
// TUI (LLM Assessment screen), app and LZ challenge alike (same class as the
// leg spawn of #4470, commands/llm-leg-spawn.ts). The challenge is
// `swao challenge ...` (legChallengeArgs) started through the central
// self-spawn helper (#4241) in the leg workspace. Both pipes are drained and
// their tail is kept (#4323). The PID goes to the orchestrator at once
// (hooks.onPid), and the challenge signal (run cancel or a fired challenge
// limit, Design 092 section 5.7) stops the whole process tree by PID
// (treeKillPid: taskkill /PID <pid> /T /F on Windows; on POSIX the process
// group when the challenge leads one, else the challenge process only: the
// spawn is not detached, so Ctrl+C in the terminal still reaches it).

import { spawn } from 'child_process';
import { selfSpawnCommand, treeKillPid } from '@swao/core';
import type { ChallengePassResult, LegChallengeContext, LegSpawnHooks } from '@swao/module-llm-assessment';
import { registerChild } from '../tui/child-process-registry.js';
import { legChallengeArgs, legChallengeWspDir, readLegChallengeAgents, type LegChallengeAgent } from './llm-leg-challenge.js';

/** #4323: characters of combined challenge stdout and stderr kept for the failure reason. */
export const CHALLENGE_OUTPUT_TAIL_CHARS = 8_000;

export interface ChallengeProcessResult {
  exitCode: number | null;
  outputTail: string;
  durationMs: number;
  pid?: number;
}

export interface SpawnChallengeProcessOptions {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  hooks?: LegSpawnHooks;
  /** Label of the start error line ("challenge" or "LZ challenge"). */
  label?: string;
  /** Test seam: the command to start instead of the SWAO self-spawn. */
  command?: { command: string; args: string[]; env: NodeJS.ProcessEnv };
}

/** Starts one challenge process; abort of `signal` kills its tree by PID. Never rejects. */
export function spawnChallengeProcess(o: SpawnChallengeProcessOptions): Promise<ChallengeProcessResult> {
  return new Promise((resolveSpawn) => {
    const started = Date.now();
    const cmd = o.command ?? selfSpawnCommand(o.args, { env: o.env });
    let finished = false;
    let tail = '';
    // Set once the process has started (a holder, so the callbacks above the spawn see it).
    const proc: { pid?: number } = {};
    const onAbort = (): void => { if (proc.pid !== undefined) void treeKillPid(proc.pid); };
    const done = (code: number | null, extra?: string): void => {
      if (finished) return;
      finished = true;
      o.signal?.removeEventListener('abort', onAbort);
      const out = extra ? `${tail}${extra}` : tail;
      resolveSpawn({ exitCode: code, outputTail: out, durationMs: Date.now() - started, ...(proc.pid !== undefined ? { pid: proc.pid } : {}) });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd.command, cmd.args, {
        cwd: o.cwd,
        env: cmd.env,
        // #4323: output piped (async, no spawnSync) so a failed challenge has a reason.
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      done(null, `[error] ${o.label ?? 'challenge'} process could not start: ${(err as Error).message}`);
      return;
    }
    registerChild(child);
    const pid = child.pid;
    if (pid !== undefined) {
      proc.pid = pid;
      try { o.hooks?.onPid?.(pid); } catch { /* the hook is best-effort */ }
    }
    const keepTail = (d: Buffer): void => { tail = (tail + d.toString()).slice(-CHALLENGE_OUTPUT_TAIL_CHARS); };
    child.stdout?.on('data', keepTail);
    child.stderr?.on('data', keepTail);
    if (o.signal?.aborted) onAbort();
    else o.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => done(null, `[error] ${o.label ?? 'challenge'} process could not start: ${err.message}`));
    child.on('exit', (code) => done(code));
  });
}

/**
 * #2283 (CLI and TUI): exit code 2 with no agent output means no agents are
 * configured, a clean skip; normalised to 0 so the orchestrator does not log
 * it as a failed challenge (#4323 warn level).
 */
export function cleanSkipExit(exitCode: number | null, agentCount: number): number | null {
  return exitCode === 2 && agentCount === 0 ? 0 : exitCode;
}

export interface RunLegChallengeOptions {
  kind: 'app' | 'lz';
  appId: string;
  leg: { connector: string; model: string };
  legWorkspaceRoot: string;
  /** SWAO_LLM_ASSESSMENT_* of the leg (#1819), merged over the process env. */
  legEnv: Record<string, string> | NodeJS.ProcessEnv;
  ctx?: LegChallengeContext;
  /** More env over legEnv (CLI: the live connector token, #2901). */
  extraEnv?: Record<string, string>;
  signal?: AbortSignal;
  hooks?: LegSpawnHooks;
  /** Test seam: the command to start instead of the SWAO self-spawn. */
  command?: { command: string; args: string[]; env: NodeJS.ProcessEnv };
}

export interface LegChallengeRun {
  result: ChallengePassResult;
  durationMs: number;
  /** #2283: exit code 2 and no agent output. */
  noAgentsConfigured: boolean;
  /** File or folder the agents were read from (null: the challenge wrote nothing). */
  source: string | null;
  agents: LegChallengeAgent[];
}

/**
 * #4277 / #4478: runs one leg challenge (app or LZ) in the LEG workspace (cwd)
 * on the given run (#4291) and reads only the output this challenge wrote
 * (#3336: files older than the spawn are ignored).
 */
export async function runLegChallenge(o: RunLegChallengeOptions): Promise<LegChallengeRun> {
  const started = Date.now();
  const spawned = await spawnChallengeProcess({
    args: legChallengeArgs(o.kind, o.appId, o.leg, o.ctx?.runId),
    cwd: o.legWorkspaceRoot,
    env: { ...process.env, ...o.legEnv, ...(o.extraEnv ?? {}) },
    label: o.kind === 'app' ? 'challenge' : 'LZ challenge',
    ...(o.signal ? { signal: o.signal } : {}),
    ...(o.hooks ? { hooks: o.hooks } : {}),
    ...(o.command ? { command: o.command } : {}),
  });
  const durationMs = Date.now() - started;
  const read = readLegChallengeAgents(legChallengeWspDir(o.legWorkspaceRoot, o.appId), o.kind, started);
  const exitCode = cleanSkipExit(spawned.exitCode, read.agents.length);
  return {
    result: {
      completed_at: new Date().toISOString(),
      agents: read.agents.map((a) => ({
        agent_id: String(a['agent_id'] ?? 'unknown'),
        calls: 1,
        dnf: exitCode !== 0,
        duration_ms: Math.round(durationMs / Math.max(read.agents.length, 1)),
      })),
      exit_code: exitCode,
      ...(spawned.outputTail ? { output_tail: spawned.outputTail } : {}),
    },
    durationMs,
    noAgentsConfigured: spawned.exitCode === 2 && read.agents.length === 0,
    source: read.source,
    agents: read.agents,
  };
}
