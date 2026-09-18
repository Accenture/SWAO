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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { dump } from 'js-yaml';
import { loadPriorSignals, resolvePassesDir, readLzrVerdict } from './pass-09-synth.js';

// Regression coverage for #0240 -- Pass 09 synth was reading from the
// pre-#0227 legacy flat layout (wsp/passes/) and seeing 0 prior signals
// at runtime once Sprint 026 moved per-run output to
// wsp/runs/<ts>/passes/. These tests guard the latest.txt-aware
// resolver that Pass 09 now shares with Pass 11 + Pass 12.

const TEMP_DIR = join(tmpdir(), `pass-09-loadPriorSignals-${process.pid}`);
const RUN_TS = '2026-05-13T08-00-00';
const NEW_PASSES_DIR = join(TEMP_DIR, 'wsp', 'runs', RUN_TS, 'passes');
const LEGACY_PASSES_DIR = join(TEMP_DIR, 'wsp', 'passes');

function writeSignalFile(passesDir: string, fileName: string, signalIds: string[]): void {
  const content = {
    pass: { id: 1, name: 'inv', signal_prefix: 'INV', status: 'complete', iter: 1 },
    signals: signalIds.map((id) => ({
      id,
      source: 'static_analysis',
      category: 'application',
      severity: 'medium',
      derivation: `test signal ${id}`,
      evidence: [],
      confidence: 'high',
    })),
  };
  writeFileSync(join(passesDir, fileName), dump(content, { lineWidth: 120 }));
}

function writeLatestPointer(relPath: string): void {
  writeFileSync(join(TEMP_DIR, 'wsp', 'latest.txt'), relPath);
}

beforeEach(() => {
  mkdirSync(NEW_PASSES_DIR, { recursive: true });
  mkdirSync(LEGACY_PASSES_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolvePassesDir
// ---------------------------------------------------------------------------

describe('resolvePassesDir', () => {
  it('returns wsp/runs/<latest>/passes when latest.txt points there', () => {
    writeLatestPointer(`runs/${RUN_TS}`);
    expect(resolvePassesDir(TEMP_DIR)).toBe(NEW_PASSES_DIR);
  });

  it('falls back to legacy wsp/passes when latest.txt is missing', () => {
    expect(resolvePassesDir(TEMP_DIR)).toBe(LEGACY_PASSES_DIR);
  });

  it('falls back to legacy wsp/passes when latest.txt points at a non-existent run', () => {
    writeLatestPointer('runs/does-not-exist');
    expect(resolvePassesDir(TEMP_DIR)).toBe(LEGACY_PASSES_DIR);
  });
});

// ---------------------------------------------------------------------------
// loadPriorSignals -- the #0240 regression itself
// ---------------------------------------------------------------------------

describe('loadPriorSignals (#0240 regression)', () => {
  it('reads signals from wsp/runs/<latest>/passes/ when latest.txt is present', () => {
    writeLatestPointer(`runs/${RUN_TS}`);
    writeSignalFile(NEW_PASSES_DIR, '01-inv.yaml', ['INV-01', 'INV-02']);
    writeSignalFile(NEW_PASSES_DIR, '03-data.yaml', ['DATA-01', 'DATA-02', 'DATA-03']);

    const signals = loadPriorSignals(TEMP_DIR);
    expect(signals.length).toBe(5);
    expect(signals.map((s) => s.id).sort()).toEqual(['DATA-01', 'DATA-02', 'DATA-03', 'INV-01', 'INV-02']);
  });

  it('returns 0 signals when only the legacy path has files but latest.txt points at a real new run', () => {
    // Operator-visible scenario before #0240: signals lived in legacy dir,
    // but latest.txt pointed at the new run dir which was empty for the
    // pass we asked about. The fix means we always look in the new
    // location when latest.txt is set.
    writeLatestPointer(`runs/${RUN_TS}`);
    writeSignalFile(LEGACY_PASSES_DIR, '01-inv.yaml', ['INV-99']);
    // NEW_PASSES_DIR exists but is empty
    expect(loadPriorSignals(TEMP_DIR).length).toBe(0);
  });

  it('skips its own 09-synth output to avoid recursive ingest', () => {
    writeLatestPointer(`runs/${RUN_TS}`);
    writeSignalFile(NEW_PASSES_DIR, '01-inv.yaml', ['INV-01']);
    writeSignalFile(NEW_PASSES_DIR, '09-synth.yaml', ['SYNTH-01', 'SYNTH-02']);

    const signals = loadPriorSignals(TEMP_DIR);
    expect(signals.map((s) => s.id)).toEqual(['INV-01']);
  });

  it('still works on the legacy layout (fallback path)', () => {
    // No latest.txt -> falls back to wsp/passes/. Preserves behaviour
    // for any workspace that has not yet been re-assessed under the
    // new layout.
    writeSignalFile(LEGACY_PASSES_DIR, '01-inv.yaml', ['INV-01', 'INV-02']);

    const signals = loadPriorSignals(TEMP_DIR);
    expect(signals.length).toBe(2);
  });

  it('returns [] when no passes dir exists at either location', () => {
    rmSync(NEW_PASSES_DIR, { recursive: true, force: true });
    rmSync(LEGACY_PASSES_DIR, { recursive: true, force: true });
    expect(loadPriorSignals(TEMP_DIR)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readLzrVerdict via the new resolver
// ---------------------------------------------------------------------------

describe('readLzrVerdict via resolvePassesDir', () => {
  it('reads 23-lzr.yaml from wsp/runs/<latest>/passes/ when latest.txt is present', () => {
    writeLatestPointer(`runs/${RUN_TS}`);
    const lzr = {
      pass: { id: 23, name: 'lzr', signal_prefix: 'LZR', status: 'complete', iter: 1 },
      signals: [],
      assessment: { overall_verdict: 'ready' },
      lzrResult: {
        landing_zone_id: 'lz-new-layout-01',
        overall_verdict: 'ready',
        blockers: [],
      },
    };
    writeFileSync(join(NEW_PASSES_DIR, '23-lzr.yaml'), dump(lzr, { lineWidth: 120 }));

    const result = readLzrVerdict(TEMP_DIR);
    expect(result.verdict).toBe('ready');
    expect(result.landing_zone_id).toBe('lz-new-layout-01');
  });

  it('still reads legacy wsp/passes/23-lzr.yaml when latest.txt is absent', () => {
    const lzr = {
      pass: { id: 23, name: 'lzr', signal_prefix: 'LZR', status: 'complete', iter: 1 },
      signals: [],
      assessment: { overall_verdict: 'advisory' },
      lzrResult: { landing_zone_id: 'lz-legacy', overall_verdict: 'advisory', blockers: [] },
    };
    writeFileSync(join(LEGACY_PASSES_DIR, '23-lzr.yaml'), dump(lzr, { lineWidth: 120 }));

    const result = readLzrVerdict(TEMP_DIR);
    expect(result.verdict).toBe('advisory');
    expect(result.landing_zone_id).toBe('lz-legacy');
  });
});
