// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4244 / #4243: the LLM Assessment leg preflight (Design 092 section 7.2a).
//
// One LLM Assessment leg is the child command `swao assess --app <id> --llm
// <connector:model> --no-cache` in a copy of the workspace. Before the copy,
// the orchestrator calls OrchestratorDeps.preflightLeg; both hosts (the CLI
// LLM branch of commands/assess.ts and the TUI hook useLlmRunning.ts) build it
// here. The preflight runs the SAME leg command with the hidden `--preflight`
// switch against the main workspace: `assess --app` performs every check it
// runs before a run folder exists (app exists, accepted-run lock, licence
// budget, .swao.yml, assessment type, source, frameworks, LZ source of #4244,
// --llm-provider, and the --llm connector) and stops with
// LEG_PREFLIGHT_OK_MARKER instead of creating the run folder. Nothing is
// cloned, copied or written under apps/<id>/wsp/runs, and no LLM is called.

import { spawn } from 'node:child_process';
import { LEG_ENV, type LegPreflightResult, type ResolvedLeg } from '@swao/module-llm-assessment';
import { guardSecretText, selfSpawnCommand, treeKillPid } from '@swao/core';
import { registerChild } from '../tui/child-process-registry.js';

/** Printed by `assess --preflight` when the leg command can start; the host requires it with exit 0. */
export const LEG_PREFLIGHT_OK_MARKER = '[ok] preflight:';

/** Upper bound for one preflight child (the checks take seconds; a stuck child must not hang the run, #4243). */
export const LEG_PREFLIGHT_TIMEOUT_MS = 120_000;

/** The leg command (without the workspace): the same argv for the leg and its preflight. */
export function legAssessArgs(appId: string, leg: Pick<ResolvedLeg, 'connector' | 'model'>, opts: { crawl: boolean }): string[] {
  return ['assess', '--app', appId, '--llm', `${leg.connector}:${leg.model}`, '--no-cache', ...(opts.crawl ? [] : ['--no-crawl'])];
}

export interface PreflightChildResult {
  exitCode: number | null;
  output: string;
  timedOut?: boolean;
  cancelled?: boolean;
}

/** Starts the preflight child; injected in tests. */
export type PreflightRunner = (argv: string[], opts: { cwd: string; timeoutMs: number; signal?: AbortSignal }) => Promise<PreflightChildResult>;

const MAX_REASON_CHARS = 600;

function stripPrefix(line: string): string {
  return line.replace(/^\[(error|warn)\]\s*/, '').trim();
}

/**
 * Turns the preflight child's result into the orchestrator's verdict. Exit 0
 * alone is not enough (a coming-soon type also exits 0): the marker must be
 * present. The reason quotes the [error] lines, else the [warn] lines (the
 * accepted-run lock exits 2 with warnings only), else the last output lines;
 * it is redacted because the orchestrator writes it to log.ndjson as it is.
 */
export function preflightVerdict(r: PreflightChildResult): LegPreflightResult {
  if (r.exitCode === 0 && r.output.includes(LEG_PREFLIGHT_OK_MARKER)) return { ok: true };
  const lines = r.output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  const errors = lines.filter((l) => l.startsWith('[error]')).map(stripPrefix).filter((l) => l !== '');
  const warns = lines.filter((l) => l.startsWith('[warn]')).map(stripPrefix).filter((l) => l !== '');
  let reason: string;
  if (r.cancelled) reason = 'cancelled';
  else if (r.timedOut) reason = `the leg command did not finish its checks within ${Math.round(LEG_PREFLIGHT_TIMEOUT_MS / 1000)} s`;
  else if (errors.length > 0) reason = errors.join('; ');
  else if (warns.length > 0) reason = `${warns.join('; ')} (exit ${String(r.exitCode)})`;
  else if (lines.length > 0) reason = `${lines.slice(-3).join('; ')} (exit ${String(r.exitCode)})`;
  else reason = r.exitCode === 0 ? 'the leg command ended without its preflight result' : `the leg command exited ${String(r.exitCode)} without output`;
  const text = guardSecretText(reason).text;
  return { ok: false, reason: text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 3)}...` : text };
}

/** Default runner: self spawn (pkg binary or node dist), pipes drained, bounded by a timeout and the abort signal; stopped by PID only. */
export const spawnPreflightChild: PreflightRunner = (argv, { cwd, timeoutMs, signal }) => new Promise((resolveRun) => {
  // The leg recorder variables are not passed: the preflight makes no call.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.values(LEG_ENV)) delete env[k];
  const cmd = selfSpawnCommand(argv, { env });
  const child = spawn(cmd.command, cmd.args, { cwd, env: cmd.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  registerChild(child);
  let output = '';
  const keep = (d: Buffer): void => { output = (output + d.toString()).slice(-16_000); };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  let timedOut = false;
  let cancelled = false;
  const stop = (): void => { if (child.pid !== undefined) void treeKillPid(child.pid); };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  const onAbort = (): void => { cancelled = true; stop(); };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let settled = false;
  const done = (exitCode: number | null, extra?: string): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    resolveRun({ exitCode, output: extra ? `${output}\n${extra}` : output, ...(timedOut ? { timedOut } : {}), ...(cancelled ? { cancelled } : {}) });
  };
  child.on('error', (err) => done(null, `[error] the leg command could not start: ${err.message}`));
  child.on('exit', (code) => done(code));
});

export interface LegPreflightOptions {
  /** The main workspace (the leg workspace is a copy of it). */
  workspaceRoot: string;
  appId: string;
  /** false = the legs run with --no-crawl. */
  crawl: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  run?: PreflightRunner;
}

/** OrchestratorDeps.preflightLeg for both hosts. */
export function createLegPreflight(o: LegPreflightOptions): (leg: ResolvedLeg) => Promise<LegPreflightResult> {
  const run = o.run ?? spawnPreflightChild;
  return async (leg) => {
    // A ~alias the leg builder could not resolve never reaches a provider.
    if (leg.model.trim() === '' || leg.model.startsWith('~')) {
      return { ok: false, reason: `model "${leg.model}" of connector ${leg.connector} is not resolved; choose a model in the LLM setup` };
    }
    const argv = [...legAssessArgs(o.appId, leg, { crawl: o.crawl }), '--workspace', o.workspaceRoot, '--preflight'];
    const r = await run(argv, { cwd: o.workspaceRoot, timeoutMs: o.timeoutMs ?? LEG_PREFLIGHT_TIMEOUT_MS, ...(o.signal ? { signal: o.signal } : {}) });
    return preflightVerdict(r);
  };
}
