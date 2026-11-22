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

// #4197 SET-08 (Design 125 section 8): the functions the TUI branch and
// `swao setup --type <type>` share. Both run `health-check --type <type>`
// (healthCheckArgs), turn its text output into the branch result with
// healthResultFromLines, record the branch state and list the Ready items, so
// both give the same result for the same workspace.

import { spawn } from 'node:child_process';
import { logPortfolio, SETUP_ASSESSMENT_TYPE_LABELS, branchStateFromHealth, setupBranchStateNote, type SetupBranchRecord, type SetupAssessmentType, type SetupBranchState, type SetupScope } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import { summariseHealthCheckOutput } from '@swao/module-health-check';
import { healthCheckArgs } from '../tui/screens/wizard/steps/HealthCheckStep.js';
import type { SetupRegistry } from './registry.js';
import type { SetupCheckItem, SetupHealthResult } from './types.js';
import { addAssessmentType, recordBranchHealth } from './workspace-state.js';

/** The branch health result from the text output of `health-check --type` (same parser as the TUI). */
export function healthResultFromLines(lines: ReadonlyArray<string>, scope: SetupScope): SetupHealthResult {
  const s = summariseHealthCheckOutput(lines);
  return { scope, probeCount: s.probeCount, failCount: s.failCount, warnCount: s.warnCount, failedProbes: s.failedProbes, warnedProbes: s.warnedProbes };
}

/** Runs `swao health-check --type <scope> --workspace <ws>` as a child process and returns its output lines. */
export function runScopedHealthCheck(workspaceRoot: string, scope: SetupScope, timeoutMs = 300_000): Promise<string[]> {
  return new Promise((resolveLines) => {
    const lines: string[] = [];
    let buf = '';
    // #4241: central self-spawn helper (no script path in the binary, PKG_EXECPATH '').
    const selfCmd = selfSpawnCommand([...healthCheckArgs(scope), '--workspace', workspaceRoot]);
    const child = spawn(selfCmd.command, selfCmd.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: selfCmd.env,
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const push = (chunk: Buffer): void => {
      const parts = (buf + chunk.toString().replace(/\r/g, '')).split('\n');
      buf = parts.pop() ?? '';
      lines.push(...parts.filter(Boolean));
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (err) => { clearTimeout(timer); lines.push(`[spawn error] ${err.message}`); resolveLines(lines); });
    child.on('close', () => { clearTimeout(timer); if (buf.trim()) lines.push(buf); resolveLines(lines); });
  });
}

export interface BranchCheckResult {
  type: SetupAssessmentType;
  state: SetupBranchState;
  health: SetupHealthResult;
  items: SetupCheckItem[];
  /** #4282: the Ready items that keep the branch from running (labels only). */
  cause: { missing: string[]; waiting: string[] };
}

/**
 * #4282 (D-8): the Ready items that keep a branch from running: `missing`
 * (required input absent) and `waiting` (operator input expected). Warnings
 * and info lines are never a cause.
 */
export function branchCause(items: readonly SetupCheckItem[]): { missing: string[]; waiting: string[] } {
  return {
    missing: items.filter((i) => i.state === 'missing' || i.state === 'fail').map((i) => i.label), // #4496: a failed check keeps the branch from running too
    waiting: items.filter((i) => i.state === 'waiting').map((i) => i.label),
  };
}

/** The Ready lines of a branch: readySummary when the branch has one, else the step checks. */
export function branchReadyItems(reg: SetupRegistry, type: SetupAssessmentType, workspaceRoot: string, health: SetupHealthResult | undefined): SetupCheckItem[] {
  const m = reg.branch(type);
  if (m.branch.readySummary) return m.branch.readySummary(workspaceRoot, health);
  return m.steps.flatMap((s) => (s.check ? s.check(workspaceRoot) : []));
}

/**
 * The non-interactive branch check: scoped health check, recorded branch
 * state (workspace.setup_state) and the Ready items. `run` is injectable for tests.
 */
export async function checkBranch(
  reg: SetupRegistry,
  workspaceRoot: string,
  type: SetupAssessmentType,
  run: (ws: string, scope: SetupScope) => Promise<string[]> = runScopedHealthCheck,
): Promise<BranchCheckResult> {
  // #4346: the steps' own entry actions first (CLI parity with the TUI branch).
  reg.branch(type).branch.prepareNonInteractive?.(workspaceRoot);
  const health = healthResultFromLines(await run(workspaceRoot, type), type);
  const items = branchReadyItems(reg, type, workspaceRoot, health);
  const state = branchStateFromCheck(health, items);
  const cause = branchCause(items);
  recordBranchHealth(workspaceRoot, type, health, new Date(), state, cause);
  addAssessmentType(workspaceRoot, type);
  return { type, state, health, items, cause };
}

/**
 * The end of a branch in the TUI (after its scoped health check): records the
 * state with its cause, adds the type to workspace.assessment_types and logs
 * `setup.branch.complete` with the probes and the Ready items that decided the
 * state (#4282, #4264 criterion 2). Same rule as checkBranch (the CLI).
 */
export function completeBranchSetup(
  reg: SetupRegistry,
  workspaceRoot: string,
  type: SetupAssessmentType,
  health: SetupHealthResult | undefined,
  now: Date = new Date(),
): { record: SetupBranchRecord; cause: { missing: string[]; waiting: string[] } } {
  const items = branchReadyItems(reg, type, workspaceRoot, health);
  const cause = branchCause(items);
  const record = recordBranchHealth(workspaceRoot, type, health, now, branchStateFromCheck(health, items), cause);
  addAssessmentType(workspaceRoot, type); // a branch that was set up is a chosen type
  try {
    logPortfolio('info', 'setup.branch.complete', `Setup of ${SETUP_ASSESSMENT_TYPE_LABELS[type]}: ${record.state}`, {
      context: {
        scope: type, state: record.state, fail_count: health?.failCount ?? null, warn_count: health?.warnCount ?? null,
        failed_probes: health?.failedProbes ?? [], warned_probes: health?.warnedProbes ?? [],
        missing: cause.missing, waiting: cause.waiting,
      },
    });
  } catch { /* best-effort */ }
  return { record, cause };
}

/**
 * Branch state, one rule for every branch (Design 125 section 7, owner
 * decision D-8, #4282): no health result is `not-set-up`; a failed probe, a
 * `missing` Ready item (required input absent) or a `waiting` Ready item
 * (operator input expected) is `needs-attention`, because the branch cannot
 * run; warnings, on any probe, keep the branch `ready` and are listed on the
 * Ready step. Shared by the CLI, the Ready step and the recorded
 * workspace.setup_state, so all three agree.
 */
export function branchStateFromCheck(health: SetupHealthResult | undefined, items: readonly SetupCheckItem[]): SetupBranchState {
  const fromHealth = branchStateFromHealth(health);
  if (fromHealth === 'ready' && items.some((i) => i.state === 'missing' || i.state === 'fail' || i.state === 'waiting')) return 'needs-attention';
  return fromHealth;
}

/** Text report of a branch check (CLI output). */
export function formatBranchCheck(r: Omit<BranchCheckResult, 'cause'>): string[] {
  const h = r.health;
  const cause = branchCause(r.items);
  const out = [
    `${SETUP_ASSESSMENT_TYPE_LABELS[r.type]}: ${setupBranchStateNote({ state: r.state, fail_count: h.failCount, missing: cause.missing, waiting: cause.waiting })}`,
    `  Health: ${h.probeCount} probe(s), ${h.failCount} failure(s), ${h.warnCount} warning(s)`,
  ];
  if (h.failedProbes.length > 0) out.push(`  Failed: ${h.failedProbes.join(', ')}`);
  if (h.warnedProbes.length > 0) out.push(`  Check:  ${h.warnedProbes.join(', ')}`);
  for (const i of r.items) out.push(`  [${i.state}] ${i.label}${i.detail ? `: ${i.detail}` : ''}`);
  if (cause.missing.length === 0 && cause.waiting.length === 0 && r.items.length > 0) out.push('  Nothing missing.');
  return out;
}
