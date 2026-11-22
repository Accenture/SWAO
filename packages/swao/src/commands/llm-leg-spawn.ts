// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, LLM Assessment leg spawn
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4470: one leg process spawn for the CLI (`assess --type llm`) and the TUI
// (LLM Assessment screen). The leg is `swao assess --app <id> --llm
// <connector:model> --no-cache` (legAssessArgs, the same argv as the leg
// preflight) started through the central self-spawn helper (#4241) in the
// leg workspace. Both pipes are drained and their tail is kept (#4243). The
// PID goes to the orchestrator at once (hooks.onPid), and the leg signal
// (run cancel or a fired leg limit) stops the whole process tree by PID
// (treeKillPid: taskkill /PID <pid> /T /F on Windows; on POSIX the process
// group when the leg leads one, else the leg process). The CLI path used to
// ignore the signal, so a leg could outlive its run.

import { spawn } from 'node:child_process';
import { selfSpawnCommand, treeKillPid } from '@swao/core';
import type { LegSpawnHooks, LegSpawnResult, ResolvedLeg } from '@swao/module-llm-assessment';
import { registerChild } from '../tui/child-process-registry.js';
import { legAssessArgs } from './llm-leg-preflight.js';

/** #4243: characters of combined leg stdout and stderr kept for the failure reason. */
export const LEG_OUTPUT_TAIL_CHARS = 16_000;

export interface SpawnLegProcessOptions {
  appId: string;
  leg: ResolvedLeg;
  legWorkspaceRoot: string;
  legEnv: Record<string, string>;
  crawl: boolean;
  signal?: AbortSignal;
  hooks?: LegSpawnHooks;
  /** Test seam: the command to start instead of the SWAO self-spawn. */
  command?: { command: string; args: string[]; env: NodeJS.ProcessEnv };
  /** Called with the exit code and the output tail when the leg ends (CLI console excerpt). */
  onExit?: (code: number | null, tail: string) => void;
}

export function spawnLegProcess(o: SpawnLegProcessOptions): Promise<LegSpawnResult> {
  return new Promise((resolveSpawn) => {
    const started = Date.now();
    const cmd = o.command ?? selfSpawnCommand(
      legAssessArgs(o.appId, o.leg, { crawl: o.crawl }),
      { env: { ...process.env, ...o.legEnv } },
    );
    const child = spawn(cmd.command, cmd.args, {
      cwd: o.legWorkspaceRoot,
      env: cmd.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    registerChild(child);
    const pid = child.pid;
    if (pid !== undefined) {
      try { o.hooks?.onPid?.(pid); } catch { /* the hook is best-effort */ }
    }
    let tail = '';
    const keepTail = (d: Buffer): void => { tail = (tail + d.toString()).slice(-LEG_OUTPUT_TAIL_CHARS); };
    child.stdout?.on('data', keepTail);
    child.stderr?.on('data', keepTail);
    const onAbort = (): void => { if (pid !== undefined) void treeKillPid(pid); };
    if (o.signal?.aborted) onAbort();
    else o.signal?.addEventListener('abort', onAbort, { once: true });
    let finished = false;
    const done = (code: number | null, extra?: string): void => {
      if (finished) return;
      finished = true;
      o.signal?.removeEventListener('abort', onAbort);
      const out = extra ? `${tail}\n${extra}` : tail;
      try { o.onExit?.(code, out); } catch { /* console excerpt is best-effort */ }
      resolveSpawn({ exitCode: code, durationMs: Date.now() - started, outputTail: out, ...(pid !== undefined ? { pid } : {}) });
    };
    child.on('error', (err) => done(null, `[error] leg process could not start: ${err.message}`));
    child.on('exit', (code) => done(code));
  });
}
