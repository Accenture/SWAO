// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- diff command tests
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// v1.0
// Tests for the swao diff command: cross-run-type detection (#2868),
// provider-change alerting, and signal delta reporting.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Command } from 'commander';
import { registerDiff } from './diff.js';

const TEMP_DIR = join(tmpdir(), 'swao-diff-test');

function ensureTempDir(): void {
  mkdirSync(TEMP_DIR, { recursive: true });
}

function cleanTempDir(): void {
  if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeManifest(opts: {
  runId: string;
  assessedAt: string;
  provider?: string;
  model?: string;
}): object {
  return {
    schema_version: '1.5',
    run_id: opts.runId,
    app: 'test-app',
    iter: 1,
    assessed_at: opts.assessedAt,
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:01:00.000Z',
    duration_ms: 60000,
    passes_executed: [],
    total_signals_emitted: 0,
    pass_stats: [],
    ...(opts.provider
      ? { llm: { provider: opts.provider, model: opts.model } }
      : {}),
  };
}

function makeSignalYaml(signals: Array<{ id: string; severity?: string }>): string {
  const items = signals.map((s) => `  - id: "${s.id}"\n    severity: "${s.severity ?? 'medium'}"`).join('\n');
  return `signals:\n${items}\n`;
}

function scaffoldRun(opts: {
  baseDir: string;
  ts: string;
  provider?: string;
  model?: string;
  signals?: Array<{ id: string; severity?: string }>;
  coverageScore?: number;
}): string {
  const runDir = join(opts.baseDir, 'wsp', 'runs', opts.ts);
  const passesDir = join(runDir, 'passes');
  mkdirSync(passesDir, { recursive: true });

  const manifest = makeManifest({
    runId: opts.ts,
    assessedAt: opts.ts,
    provider: opts.provider,
    model: opts.model,
  });
  writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify(manifest), 'utf-8');

  if (opts.signals && opts.signals.length > 0) {
    writeFileSync(join(passesDir, 'pass-01.yaml'), makeSignalYaml(opts.signals), 'utf-8');
  }

  if (opts.coverageScore !== undefined) {
    writeFileSync(
      join(runDir, 'wsp.yaml'),
      `overall:\n  coverage_score: ${opts.coverageScore}\n`,
      'utf-8',
    );
  }

  return runDir;
}

// ---------------------------------------------------------------------------
// Cross-run-type detection (#2868)
// ---------------------------------------------------------------------------

describe('swao diff cross-run-type (#2868)', () => {
  afterEach(() => { cleanTempDir(); });

  function runDiff(appDir: string, extraArgs: string[] = []): { stdout: string; stderr: string } {
    ensureTempDir();
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => { out.push(args.join(' ')); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => { err.push(args.join(' ')); });
    try {
      const program = new Command('swao').exitOverride();
      registerDiff(program);
      program.parse(
        ['diff', '--workspace', appDir, ...extraArgs],
        { from: 'user' },
      );
    } catch { /* exitOverride or process.exit */ } finally {
      vi.restoreAllMocks();
      void logSpy;
      void errSpy;
    }
    return { stdout: out.join('\n'), stderr: err.join('\n') };
  }

  it('emits cross-run-type warning when comparing LLM run to LZ-only run', () => {
    ensureTempDir();
    const appDir = join(TEMP_DIR, 'cross-type-app');
    mkdirSync(appDir, { recursive: true });
    // Run 1: LLM run (older)
    scaffoldRun({ baseDir: appDir, ts: '2026-01-01T10-00-00', provider: 'openai', model: 'gpt-4o' });
    // Run 2: LZ-only run (latest, no llm block)
    scaffoldRun({ baseDir: appDir, ts: '2026-01-02T10-00-00' });

    const { stdout } = runDiff(appDir);
    expect(stdout).toContain('cross-run-type comparison');
    expect(stdout).not.toContain('Provider changed');
  });

  it('emits cross-run-type warning when comparing LZ-only run to LLM run', () => {
    ensureTempDir();
    const appDir = join(TEMP_DIR, 'cross-type-reversed');
    mkdirSync(appDir, { recursive: true });
    // Run 1: LZ-only (older)
    scaffoldRun({ baseDir: appDir, ts: '2026-01-01T10-00-00' });
    // Run 2: LLM run (latest)
    scaffoldRun({ baseDir: appDir, ts: '2026-01-02T10-00-00', provider: 'azure-openai', model: 'gpt-4o' });

    const { stdout } = runDiff(appDir);
    expect(stdout).toContain('cross-run-type comparison');
    expect(stdout).not.toContain('Provider changed');
  });

  it('does NOT emit cross-run-type warning when both runs are LLM type', () => {
    ensureTempDir();
    const appDir = join(TEMP_DIR, 'same-type-llm');
    mkdirSync(appDir, { recursive: true });
    scaffoldRun({ baseDir: appDir, ts: '2026-01-01T10-00-00', provider: 'openai', model: 'gpt-4o' });
    scaffoldRun({ baseDir: appDir, ts: '2026-01-02T10-00-00', provider: 'openai', model: 'gpt-4o' });

    const { stdout } = runDiff(appDir);
    expect(stdout).not.toContain('cross-run-type comparison');
  });

  it('does NOT emit cross-run-type warning when both runs are LZ-only type', () => {
    ensureTempDir();
    const appDir = join(TEMP_DIR, 'same-type-lz');
    mkdirSync(appDir, { recursive: true });
    scaffoldRun({ baseDir: appDir, ts: '2026-01-01T10-00-00' });
    scaffoldRun({ baseDir: appDir, ts: '2026-01-02T10-00-00' });

    const { stdout } = runDiff(appDir);
    expect(stdout).not.toContain('cross-run-type comparison');
  });

  it('emits Provider changed alert when both runs are LLM type but providers differ', () => {
    ensureTempDir();
    const appDir = join(TEMP_DIR, 'provider-changed');
    mkdirSync(appDir, { recursive: true });
    scaffoldRun({ baseDir: appDir, ts: '2026-01-01T10-00-00', provider: 'openai', model: 'gpt-4o' });
    scaffoldRun({ baseDir: appDir, ts: '2026-01-02T10-00-00', provider: 'azure-openai', model: 'gpt-4o' });

    const { stdout } = runDiff(appDir);
    expect(stdout).toContain('Provider changed');
    expect(stdout).not.toContain('cross-run-type comparison');
  });

  it('shows signal delta between two LLM runs', () => {
    ensureTempDir();
    const appDir = join(TEMP_DIR, 'signal-delta');
    mkdirSync(appDir, { recursive: true });
    scaffoldRun({
      baseDir: appDir, ts: '2026-01-01T10-00-00', provider: 'openai', model: 'gpt-4o',
      signals: [{ id: 'SEC-001' }, { id: 'PERF-002' }],
    });
    scaffoldRun({
      baseDir: appDir, ts: '2026-01-02T10-00-00', provider: 'openai', model: 'gpt-4o',
      signals: [{ id: 'SEC-001' }, { id: 'COMP-003' }],
    });

    const { stdout } = runDiff(appDir);
    expect(stdout).toContain('COMP-003');
    expect(stdout).toContain('PERF-002');
    expect(stdout).toContain('New:');
    expect(stdout).toContain('Resolved:');
  });
});
