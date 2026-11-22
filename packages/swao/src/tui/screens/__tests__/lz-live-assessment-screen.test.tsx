// #3588: Landing Zone Live Assessment screen flow with an injected CLI runner
// (no process spawned, no network). Covers the write-capable confirmation
// step of Design 120 section 6.3: refused stops unless confirmed twice, and
// the accept flag reaches the assess call of this run only.
import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return { ...original, LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'consultant', valid: true } })) } };
});

import { LzLiveAssessmentScreen, type LiveCliRunner } from '@swao/module-app-assessment';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function workspace(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-lzl-screen-'));
  tmp.push(d);
  writeFileSync(join(d, '.swao.yml'), ['name: demo', 'assessment:', '  frameworks: [BSI_C5]', 'landing_zones:', '  - id: otc-test', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', ''].join('\n'));
  const fw = join(d, 'wsp', 'inputs', 'catalogs', 'community', 'bsi-c5');
  mkdirSync(fw, { recursive: true });
  writeFileSync(join(fw, 'framework-meta.yaml'), 'framework:\n  id: BSI_C5\n  name: "BSI C5 test"\n  version: "2020"\n');
  return d;
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Polls until `ok()` holds (frames lag under a loaded test run); fails with what it waited for. */
async function until(ok: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await settle(20);
  }
  // The key handler of the new frame registers in an effect after the paint.
  await settle(30);
}
const DOWN = '\u001B[B';
const LEFT = '\u001B[D';
const ESC = '\u001B';

function runner(probeState: 'verified' | 'refused'): { run: LiveCliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: LiveCliRunner = async (args, onLine) => {
    calls.push(args);
    if (args[0] === 'lz' && args[1] === 'probe') {
      onLine(`scope platform: identity mock-user, read-only ${probeState}`);
      if (probeState === 'refused') onLine('  credential is write-capable (role te_admin)');
      return probeState === 'refused' ? 1 : 0;
    }
    onLine('[lz live] run 2026-11-03T08-00-00: complete -> landing-zones/otc-test/wsp/runs/2026-11-03T08-00-00');
    return 0;
  };
  return { run, calls };
}

describe('LzLiveAssessmentScreen (#3588)', () => {
  it('verified: landing zone -> scopes -> probe -> frameworks (pre-selected) -> run -> done menu', async () => {
    // Waits for the frame or the runner call each key is meant for (never a fixed time):
    // under parallel load a fixed 100 ms wait let the next key reach the previous phase.
    const { run, calls } = runner('verified');
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={workspace()} run={run} />);
    const frame = (): string => lastFrame() ?? '';
    expect(frame()).toContain('Select landing zone');
    expect(frame()).toContain('otc-test');
    await settle(150);
    stdin.write('\r');
    await until(() => frame().includes('[x] platform'), 'the scope step');
    stdin.write('\r');
    await until(() => frame().includes('Select community frameworks') && frame().includes('[x] BSI_C5'), 'the framework step');
    stdin.write('\r');
    await until(() => frame().includes('Publish Live View (lz-live)'), 'the finish menu');
    expect(calls).toEqual([
      ['lz', 'probe', 'otc-test'],
      ['assess', '--type', 'landing-zone-live', '--lz', 'otc-test', '--scope', 'platform', '--frameworks', 'BSI_C5'],
    ]);
    stdin.write('\r'); // #4256: What next entries on FinishPanel (were the number keys)
    await until(() => calls.length >= 3, 'the publish call');
    expect(calls[2]).toEqual(['publish', '--lz-live', 'otc-test']);
    // #3589: "Use as source for Update LZ Catalogue" runs the #3582 dry run (no write).
    await nextEntry(2);
    await until(() => calls.length >= 4 && frame().includes('Dry run only'), 'the catalogue dry run');
    expect(calls[3]).toEqual(['lz', 'catalogue', 'update', '--provider', 'otc', '--source', 'live', '--lz', 'otc-test', '--dry-run']);
    // #3830: "Diff vs previous run" runs swao lz diff and shows its lines.
    await nextEntry(3);
    await until(() => calls.length >= 5 && frame().includes('Diff vs the previous run of each scope'), 'the diff');
    expect(calls[4]).toEqual(['lz', 'diff', 'otc-test']);
    // #3885: "Tenant hierarchy" runs swao lz hierarchy and shows its lines.
    await nextEntry(4);
    await until(() => calls.length >= 6 && frame().includes('Tenant hierarchy of the latest run, pseudonymised'), 'the hierarchy');
    expect(calls[5]).toEqual(['lz', 'hierarchy', 'otc-test']);

    /** Down to the next What next entry, then Enter; Enter is sent once the cursor moved. */
    async function nextEntry(index: number): Promise<void> {
      const before = cursorRow();
      stdin.write(DOWN);
      await until(() => cursorRow() !== before, `the cursor on What next entry ${index}`);
      stdin.write('\r');
    }
    function cursorRow(): string {
      return frame().split(String.fromCharCode(10)).find((l) => l.includes(String.fromCodePoint(0x276f))) ?? '';
    }
  });

  it('with no landing zone registered and no host callback, step 1 points at the Landing Zone Live setup (#4127)', () => {
    const d = workspace();
    writeFileSync(join(d, '.swao.yml'), 'name: demo\n');
    const { lastFrame } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={d} run={runner('verified').run} />);
    expect(lastFrame()).toContain('Add one in the Landing Zone Live setup');
    expect(lastFrame()).not.toContain('Tools');
  });

  it('#4127 / #4255: the list entry "Add or manage landing zones" opens Landing Zone Connections, with or without registered landing zones', async () => {
    const d = workspace();
    const open = vi.fn();
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={d} run={runner('verified').run} onManageConnections={open} />);
    await settle(150);
    expect(lastFrame()).toContain('Add or manage landing zones');
    stdin.write('a'); await settle();
    expect(open).not.toHaveBeenCalled(); // no letter keys (Design 126 section 7.10)
    stdin.write(DOWN); await settle();
    stdin.write('\r'); await settle();
    expect(open).toHaveBeenCalledTimes(1);
    writeFileSync(join(d, '.swao.yml'), 'name: demo\n');
    const empty = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={d} run={runner('verified').run} onManageConnections={open} />);
    await settle(150);
    expect(empty.lastFrame()).toContain('Add one in Landing Zone Connections');
    empty.stdin.write('\r'); await settle();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('refused: stops with the roles; the continue entry and the ConfirmPanel run with --accept-write-capable-credentials', async () => {
    const { run, calls } = runner('refused');
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={workspace()} run={run} />);
    await settle(150);
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(150);
    expect(lastFrame()).toContain('read-only refused');
    expect(lastFrame()).toContain('credential is write-capable (role te_admin)');
    expect(lastFrame()).toContain('Continue with the write-capable credential for this run');
    stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('Continue with a write-capable credential?');
    expect(lastFrame()).toContain('Enter confirm');
    stdin.write(LEFT); await settle();
    // The left arrow goes back: no run started.
    expect(lastFrame()).toContain('read-only refused');
    expect(calls).toHaveLength(1);
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('Select community frameworks');
    stdin.write('\r'); await settle(150);
    expect(calls[1]).toContain('--accept-write-capable-credentials');
  });

  it('a probe without a scope line shows the CLI reason (tier gate) and runs nothing else', async () => {
    const calls: string[][] = [];
    const run: LiveCliRunner = async (args, onLine) => { calls.push(args); onLine('Feature "lz-live-connect" requires a consultant license'); return 3; };
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={workspace()} run={run} />);
    await settle(150);
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(150);
    expect(lastFrame()).toContain('Read-only probe failed');
    expect(lastFrame()).toContain('No probe result for scope platform');
    expect(lastFrame()).toContain('requires a consultant license');
    expect(calls).toHaveLength(1);
    // #4241 / #4255: ErrorPanel with recovery entries; Enter is never dead.
    expect(lastFrame()).toContain('Probe again');
    expect(lastFrame()).toContain('Back to the scopes');
    expect(lastFrame()).not.toContain('Continue without');
    stdin.write('\r'); await settle(150);
    expect(calls).toHaveLength(2);
    expect(lastFrame()).toContain('Read-only probe failed');
    stdin.write('\u001B[B'); await settle();
    stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('Scopes to read');
    expect(calls).toHaveLength(2);
  });

  it('#4241: a partial probe offers Continue without the failed scope', async () => {
    const d = workspace();
    writeFileSync(join(d, '.swao.yml'), ['name: demo', 'assessment:', '  frameworks: [BSI_C5]', 'landing_zones:', '  - id: otc-test', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', '      - id: app-a', '        kind: application', '        auth: iam-password-token', ''].join('\n'));
    const calls: string[][] = [];
    const run: LiveCliRunner = async (args, onLine) => {
      calls.push(args);
      if (args[0] === 'lz') { onLine('scope platform: identity mock-user, read-only verified'); return 1; }
      onLine('[lz live] run 2026-11-03T08-00-00: complete -> landing-zones/otc-test/wsp/runs/2026-11-03T08-00-00');
      return 0;
    };
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={d} run={run} />);
    await settle(150);
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(150);
    expect(lastFrame()).toContain('Continue without scope app-a');
    stdin.write('\u001B[B'); await settle();
    stdin.write('\r'); await settle(150);
    // Re-probe of the scope that answered, then the frameworks step.
    expect(calls[1]).toEqual(['lz', 'probe', 'otc-test', '--scope', 'platform']);
    expect(lastFrame()).toContain('Select community frameworks');
  });

  it('refused then n stops without any assess call; the choice is not remembered on the next probe', async () => {
    const { run, calls } = runner('refused');
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={workspace()} run={run} />);
    await settle(150);
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(150);
    stdin.write('\r'); await settle(); // continue with the write-capable credential
    stdin.write('\r'); await settle(); // confirm
    expect(lastFrame()).toContain('Select community frameworks');
    stdin.write(LEFT); await settle(); // back to scopes from frameworks
    stdin.write('\r'); await settle(150); // probe again
    expect(lastFrame()).toContain('read-only refused');
    stdin.write(DOWN); await settle();
    stdin.write('\r'); await settle(); // Back to the scopes
    expect(lastFrame()).toContain('Scopes to read');
    expect(calls.filter((c) => c[0] === 'assess')).toHaveLength(0);
  });

  it('#3875: the results step shows the Client LZ Policy Baseline summary of this run (verdicts and counts, no detail text)', async () => {
    const d = workspace();
    const runDir = join(d, 'landing-zones', 'otc-test', 'wsp', 'runs', '2026-11-05T08-00-00');
    const run: LiveCliRunner = async (args, onLine) => {
      if (args[0] === 'lz') { onLine('scope platform: identity mock-user, read-only verified'); return 0; }
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'otc-test.platform.lz-baseline.json'), JSON.stringify({
        schema: 'lz-baseline-result/1', lz_id: 'otc-test', scope_id: 'platform', provider: 'otc', framework: 'CLIENT_LZ_POLICY_BASELINE', baseline_of: 'CLIENT_LZ_POLICY_BASELINE',
        catalogue_version: '1.0.0', sha256: 'b'.repeat(64), overall: 'BLOCKED',
        policies: [
          { id: 'CPB-RES-01', kind: 'region_residency', category: 'data_residency', control: 'CPB-RES-01', severity: 'blocker', offering: 'READY', estate: 'fail', observability: 'observed', detail: '1 resource outside DE: ecs-4be1' },
          { id: 'CPB-AUD-01', kind: 'audit_trail', category: 'logging', control: 'CPB-AUD-01', severity: 'warning', offering: 'READY', estate: 'pass', observability: 'observed', detail: 'audit on' },
        ],
        not_reviewed: [], disabled: [],
      }));
      onLine('[lz live] run 2026-11-05T08-00-00: complete -> landing-zones/otc-test/wsp/runs/2026-11-05T08-00-00');
      return 0;
    };
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={d} run={run} />);
    await settle(150);
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(150);
    stdin.write('\r'); await settle(150);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Publish Live View (lz-live)');
    expect(frame).toContain('Client LZ Policy Baseline: CLIENT_LZ_POLICY_BASELINE 1.0.0');
    expect(frame).toContain('scope platform: BLOCKED, 2 evaluated (1 pass, 1 fail');
    expect(frame).not.toContain('ecs-4be1');
  });

  it('#3875: without a baseline result the results step shows no baseline line', async () => {
    const { run } = runner('verified');
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={workspace()} run={run} />);
    await settle(150);
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(150);
    stdin.write('\r'); await settle(150);
    expect(lastFrame()).toContain('Publish Live View (lz-live)');
    expect(lastFrame()).not.toContain('Client LZ Policy Baseline');
  });

  it('#4050: the frameworks step names the landing zone ingestion folder; the results step shows the organisational controls', async () => {
    const d = workspace();
    const runDir = join(d, 'landing-zones', 'otc-test', 'wsp', 'runs', '2026-11-07T20-00-00');
    const run: LiveCliRunner = async (args, onLine) => {
      if (args[0] === 'lz') { onLine('scope platform: identity mock-user, read-only verified'); return 0; }
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'lz-organisational.json'), JSON.stringify({
        schema: 'lz-organisational-result/1', lz_id: 'otc-test', run_id: '2026-11-07T20-00-00', generated_at: '2026-11-07T20:00:00Z',
        folder: 'landing-zones/otc-test/ingestion', documents: { total: 3, readable: 3, matched: 2 },
        frameworks: [{ id: 'DORA', version: '2025-01-17', controls: [], counts: { satisfied: 4, partial: 1, unknown: 28, n_a: 2 } }],
      }));
      onLine('[lz live] run 2026-11-07T20-00-00: complete -> landing-zones/otc-test/wsp/runs/2026-11-07T20-00-00');
      return 0;
    };
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={d} run={run} />);
    await settle(150);
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(150);
    expect(lastFrame()).toContain('Select community frameworks');
    expect((lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('landing-zones/otc-test/ingestion/');
    stdin.write('\r'); await settle(150);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Publish Live View (lz-live)');
    // #4256: the summaries are rows of the finish block and wrap at the frame width.
    expect(frame.replace(/\s+/g, ' ')).toContain('Organisational controls from landing-zones/otc-test/ingestion/: 3 document(s), 2 matched');
    expect(frame).toContain('DORA: 4 documented, 1 partly documented, 28 not evaluated, 2 n/a');
  });

  // #4255 (Design 126 section 7, G-09 for the flows): Esc aborts through useFlowNavigation,
  // the left arrow goes back one step with the values kept, an open guidance box closes first.
  it('#4255: Esc on the first step leaves at once; after a choice Esc asks with the AbortDialog', async () => {
    const onBack = vi.fn();
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={onBack} version="9.9.9" workspace={workspace()} run={runner('verified').run} />);
    await settle(150);
    stdin.write('\r'); await settle(); // landing zone chosen: the flow is dirty
    expect(lastFrame()).toContain('Scopes to read');
    stdin.write(ESC); await settle();
    expect(lastFrame()).toContain('Abort the assessment?');
    expect(onBack).not.toHaveBeenCalled();
    stdin.write(ESC); await settle(); // stay
    expect(lastFrame()).not.toContain('Abort the assessment?');
    expect(lastFrame()).toContain('Scopes to read');
    stdin.write(ESC); await settle();
    stdin.write('\r'); await settle(); // abort
    expect(onBack).toHaveBeenCalledTimes(1);
    const first = render(<LzLiveAssessmentScreen onBack={onBack} version="9.9.9" workspace={workspace()} run={runner('verified').run} />);
    await settle(150);
    first.stdin.write(ESC); await settle();
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('#4255: the left arrow goes back with the scope choice kept; Esc closes an open guidance box first', async () => {
    const d = workspace();
    writeFileSync(join(d, '.swao.yml'), ['name: demo', 'assessment:', '  frameworks: [BSI_C5]', 'landing_zones:', '  - id: otc-test', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', '      - id: app-a', '        kind: application', '        auth: iam-password-token', ''].join('\n'));
    const onBack = vi.fn();
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={onBack} version="9.9.9" workspace={d} run={runner('verified').run} />);
    await settle(150);
    stdin.write('\r'); await settle();
    stdin.write(DOWN); await settle();
    stdin.write(' '); await settle(); // deselect app-a
    expect(lastFrame()).toContain('[ ] app-a');
    stdin.write(LEFT); await settle();
    expect(lastFrame()).toContain('Select landing zone');
    stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('[x] platform');
    // #4230: the open box follows the highlighted scope; Esc closes it and never opens the dialog.
    stdin.write('\u0007'); await settle();
    expect(lastFrame()).toContain('platform landing zone (PLZ) holds the shared foundation');
    stdin.write(DOWN); await settle();
    expect(lastFrame()).toContain('application landing zone (ALZ) holds the resources of one workload');
    stdin.write(ESC); await settle();
    expect(lastFrame()).not.toContain('Abort the assessment?');
    expect(onBack).not.toHaveBeenCalled();
  });
  it('#4256: the probe and the run show RunPanel (stage name, Esc cancel); Esc cancels the probe at once and stops its runner', async () => {
    let probeSignal: AbortSignal | undefined;
    const run: LiveCliRunner = (args, _onLine, signal) => new Promise((resolve) => {
      if (args[1] === 'probe') { probeSignal = signal; signal?.addEventListener('abort', () => resolve(1)); return; }
      resolve(0);
    });
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={workspace()} run={run} />);
    await settle(150);
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(150);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Probing 1 scope(s) of otc-test');
    expect(frame).toContain('Stage 1 of 1.');
    expect(frame).toContain('Read-only probe');
    expect(frame).toContain('Esc cancel');
    expect(frame).not.toContain('Working...');
    stdin.write(ESC); await settle(150);
    expect(probeSignal?.aborted).toBe(true);
    expect(lastFrame()).toContain('[x] platform');
  });

  it('#4256: the run asks before cancelling; Enter stops the runner and returns to the frameworks; the guidance names the stage', async () => {
    let runSignal: AbortSignal | undefined;
    const run: LiveCliRunner = (args, onLine, signal) => new Promise((resolve) => {
      if (args[1] === 'probe') { onLine('scope platform: identity mock-user, read-only verified'); resolve(0); return; }
      runSignal = signal;
      onLine('[lz live] crawl scope platform: 12 of 61 routes');
      signal?.addEventListener('abort', () => resolve(1));
    });
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={workspace()} run={run} />);
    await settle(150);
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(150);
    stdin.write('\r'); await settle(150);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Assessing the landing zone otc-test');
    expect(frame).toContain('Reading the scopes');
    expect(frame).toContain('Run: Reading the scopes');
    stdin.write(ESC); await settle();
    expect(lastFrame()).toContain('Cancel the run?');
    expect(runSignal?.aborted).toBe(false);
    stdin.write('\r'); await settle(150);
    expect(runSignal?.aborted).toBe(true);
    expect(lastFrame()).toContain('Select community frameworks');
  });

  for (const columns of [100, 80]) {
    it(`#4256: the run screen at ${columns} columns: title, stage, titled output, Esc cancel above the box, nothing wider than the frame`, async () => {
      const run: LiveCliRunner = (args, onLine) => new Promise((resolve) => {
        if (args[1] === 'probe') { onLine('scope platform: identity mock-user, read-only verified'); resolve(0); return; }
        onLine('[lz live] evaluate scope platform: 42 controls of BSI_C5 against C:/Users/someone/AppData/Local/swao/cache/a-very-long-folder-name/records.json');
      });
      const r = renderAt(<LzLiveAssessmentScreen onBack={vi.fn()} version="9.9.9" workspace={workspace()} run={run} />, columns);
      await settle(150);
      r.stdin.write('\r'); await settle();
      r.stdin.write('\r'); await settle(150);
      r.stdin.write('\r'); await settle(150);
      const ls = r.lines().map((l) => l.trimEnd());
      const text = ls.join(' ');
      expect(text).toContain('Assessing the landing zone otc-test');
      expect(text).toContain('Evaluating the controls');
      const hints = ls.indexOf('Esc cancel');
      expect(hints).toBeGreaterThan(ls.indexOf('Output'));
      expect(widest(ls)).toBeLessThanOrEqual(columns);
      r.unmount();
    });
  }
});
