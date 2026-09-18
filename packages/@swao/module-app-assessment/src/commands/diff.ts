// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { Command } from 'commander';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load as loadYaml } from 'js-yaml';
import { RunManifestSchema, findWorkspace } from '@swao/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffSignal {
  id: string;
  severity?: string;
  derivation?: string;
}

interface RunSummary {
  run_id: string;
  assessed_at: string;
  provider?: string;
  model?: string;
  signals: DiffSignal[];
  score?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadRunSummary(runDir: string): RunSummary | null {
  if (!existsSync(runDir)) return null;

  const manifestPath = join(runDir, 'run-manifest.json');
  let provider: string | undefined;
  let model: string | undefined;
  let runId = '';
  let assessedAt = '';

  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
      const parsed = RunManifestSchema.safeParse(raw);
      if (parsed.success) {
        runId = parsed.data.run_id;
        assessedAt = parsed.data.assessed_at;
        provider = parsed.data.llm?.provider;
        model = parsed.data.llm?.model;
      }
    } catch { /* skip malformed */ }
  }

  // Collect signals from all pass YAMLs
  const passesDir = join(runDir, 'passes');
  const signals: DiffSignal[] = [];
  if (existsSync(passesDir)) {
    const files = readdirSync(passesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
    for (const file of files) {
      try {
        const parsed = loadYaml(readFileSync(join(passesDir, file), 'utf-8')) as { signals?: Array<{ id?: string; severity?: string; derivation?: string }> };
        for (const s of parsed?.signals ?? []) {
          if (s.id) signals.push({ id: s.id, severity: s.severity, derivation: s.derivation });
        }
      } catch { /* skip unreadable */ }
    }
  }

  // Extract coverage score from wsp.yaml if present
  const wspPath = join(runDir, 'wsp.yaml');
  let score: number | undefined;
  if (existsSync(wspPath)) {
    try {
      const wsp = loadYaml(readFileSync(wspPath, 'utf-8')) as { overall?: { coverage_score?: number } };
      score = wsp?.overall?.coverage_score;
    } catch { /* skip */ }
  }

  return { run_id: runId, assessed_at: assessedAt, provider, model, signals, score };
}

function resolveRunDir(workspaceAppDir: string, runTs: string): string {
  return join(workspaceAppDir, 'wsp', 'runs', runTs);
}

function findLatestRuns(workspaceAppDir: string, count: number): string[] {
  const runsDir = join(workspaceAppDir, 'wsp', 'runs');
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
    .sort()
    .reverse()
    .slice(0, count);
}

// ---------------------------------------------------------------------------
// Diff output
// ---------------------------------------------------------------------------

function printDiff(run1: RunSummary, run2: RunSummary, ts1: string, ts2: string): void {
  console.log(`\nswao diff: ${ts1} -> ${ts2}\n`);

  const p1 = run1.provider ? `${run1.provider}/${run1.model ?? '?'}` : 'unknown';
  const p2 = run2.provider ? `${run2.provider}/${run2.model ?? '?'}` : 'unknown';
  console.log(`  Run 1:  ${ts1}  [${p1}]`);
  console.log(`  Run 2:  ${ts2}  [${p2}]`);

  if (p1 !== p2) {
    console.log(`\n  [!] Provider changed: ${p1} -> ${p2}.`);
    console.log(`      Score differences are not meaningful due to provider change.\n`);
  } else {
    console.log('');
  }

  // Score delta
  if (run1.score !== undefined && run2.score !== undefined) {
    const delta = run2.score - run1.score;
    const pct = (delta * 100).toFixed(1);
    const sign = delta >= 0 ? '+' : '';
    console.log(`  Coverage score:  ${(run1.score * 100).toFixed(1)}% -> ${(run2.score * 100).toFixed(1)}%  (${sign}${pct}pp)`);
  }

  // Signal diff
  const ids1 = new Set(run1.signals.map((s) => s.id));
  const ids2 = new Set(run2.signals.map((s) => s.id));

  const newSignals = run2.signals.filter((s) => !ids1.has(s.id));
  const resolvedSignals = run1.signals.filter((s) => !ids2.has(s.id));
  const unchanged = run1.signals.filter((s) => ids2.has(s.id)).length;

  console.log(`\n  Signals:  ${run1.signals.length} -> ${run2.signals.length}`);
  console.log(`    Unchanged:  ${unchanged}`);
  console.log(`    New:        ${newSignals.length}`);
  console.log(`    Resolved:   ${resolvedSignals.length}`);

  if (newSignals.length > 0) {
    console.log('\n  New signals:');
    for (const s of newSignals) {
      console.log(`    + ${s.id}  [${s.severity ?? '?'}]`);
    }
  }

  if (resolvedSignals.length > 0) {
    console.log('\n  Resolved signals:');
    for (const s of resolvedSignals) {
      console.log(`    - ${s.id}  [${s.severity ?? '?'}]`);
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerDiff(program: Command): void {
  program
    .command('diff')
    .description('Compare two assessment runs -- shows score deltas, new signals, resolved signals, and provider changes.')
    .option('--run1 <ts>', 'First run timestamp (e.g. 2026-06-03T10-00-00)')
    .option('--run2 <ts>', 'Second run timestamp (defaults to latest)')
    .option('--app <id>', 'App to compare (required for multi-app workspaces)')
    .option('--workspace <path>', 'Workspace path (default: current directory)')
    .action((opts: { run1?: string; run2?: string; app?: string; workspace?: string }) => {
      const workspaceRoot = opts.workspace ? opts.workspace : (findWorkspace(process.cwd()) ?? process.cwd());

      // Determine workspace app dir
      const appId = opts.app;
      const workspaceAppDir = appId ? join(workspaceRoot, 'apps', appId) : workspaceRoot;

      // Resolve run timestamps
      const available = findLatestRuns(workspaceAppDir, 10);
      if (available.length < 2 && (!opts.run1 || !opts.run2)) {
        console.error('[error] Not enough runs to diff. Run swao assess at least twice first.');
        process.exit(1);
      }

      const ts2 = opts.run2 ?? available[0];
      const ts1 = opts.run1 ?? available[1];

      if (!ts1 || !ts2) {
        console.error('[error] Could not resolve run timestamps. Specify --run1 and --run2 explicitly.');
        process.exit(1);
      }

      const run1 = loadRunSummary(resolveRunDir(workspaceAppDir, ts1));
      const run2 = loadRunSummary(resolveRunDir(workspaceAppDir, ts2));

      if (!run1) { console.error(`[error] Run not found: ${ts1}`); process.exit(1); }
      if (!run2) { console.error(`[error] Run not found: ${ts2}`); process.exit(1); }

      printDiff(run1, run2, ts1, ts2);
    });
}
