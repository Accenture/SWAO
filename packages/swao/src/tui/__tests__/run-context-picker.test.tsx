// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, RunContextPicker on SelectInput (#4343)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4343 (Design 126 audit B-2, B-3, U-2): the run picker of Report and
// Publish HTML draws its rows through SelectInput (the central cursor), with
// no local "> " marker and no hint sentence; Enter selects, Esc cancels.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunContextPicker } from '@swao/tui-kit';

const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
const MARKER = String.fromCodePoint(0x276f);
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function wspWithTwoTypes(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-run-ctx-'));
  dirs.push(ws);
  const wsp = join(ws, 'apps', 'demo', 'wsp');
  mkdirSync(wsp, { recursive: true });
  writeFileSync(join(wsp, 'latest-application.txt'), 'runs/2026-11-12T10-00-00\n');
  writeFileSync(join(wsp, 'latest-landing-zone-catalog.txt'), 'runs/2026-11-12T11-00-00\n');
  return wsp;
}

describe('RunContextPicker (#4343)', () => {
  it('lists the runs with the central cursor and no hint sentence; Enter selects the highlighted run', async () => {
    const onSelect = vi.fn();
    const r = render(<RunContextPicker wspDir={wspWithTwoTypes()} onSelect={onSelect} onCancel={vi.fn()} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain(`${MARKER} Application Assessment`);
    expect(frame).toContain('Landing Zone Catalog Assessment');
    expect(frame).not.toContain('> ');
    expect(frame).not.toContain('Enter to confirm');
    r.stdin.write('\u001B[B');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(onSelect).toHaveBeenCalledWith({ assessmentType: 'landing-zone-catalog', runTimestamp: '2026-11-12T11:00:00Z' });
    r.unmount();
  });

  it('Esc cancels', async () => {
    const onCancel = vi.fn();
    const r = render(<RunContextPicker wspDir={wspWithTwoTypes()} onSelect={vi.fn()} onCancel={onCancel} />);
    await tick();
    r.stdin.write('\u001B');
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});
