// #4256 (TUI-12): the Application and LZ Catalog finish screens on FinishPanel
// at 100 and 80 columns: nothing wider than the frame, the real run folder on
// screen, one key hint line, no placeholder, no letter keys, no double dash.
import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { render as inkRender, Box, type Instance } from 'ink';
import type { ReactElement } from 'react';
import { FinishPanel, KeyHints, FINISH_PANEL_KEYS, formatKeyHints } from '@swao/tui-kit';
import { appFinishView, failedRunView } from './app-finish.js';
import { lzFinishView } from './lz-finish.js';

class FakeStdout extends EventEmitter {
  constructor(public columns: number) { super(); }
  rows = 50;
  last = '';
  write = (frame: string): boolean => { this.last = frame; return true; };
}
class FakeStdin extends EventEmitter {
  isTTY = true;
  read = (): string | null => null;
  setEncoding(): void { /* no-op */ }
  setRawMode(): void { /* no-op */ }
  resume(): void { /* no-op */ }
  pause(): void { /* no-op */ }
  ref(): void { /* no-op */ }
  unref(): void { /* no-op */ }
}

const instances: Instance[] = [];
afterEach(() => { for (const i of instances.splice(0)) i.unmount(); });

// eslint-disable-next-line no-control-regex
const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');

function frame(tree: ReactElement, columns: number): string[] {
  const stdout = new FakeStdout(columns);
  instances.push(inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns) as unknown as NodeJS.WriteStream,
    stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  }));
  return plain(stdout.last).split('\n').map((l) => l.trimEnd());
}

const APP = appFinishView({
  app: 'sovereign-health', typeLabel: 'Application Assessment', totalPasses: 14, passesLabel: 'all', passFiles: 14,
  llm: 'ollama', skipLlm: false, runFolder: 'apps/sovereign-health/wsp/runs/2026-11-10T08-53-21/',
  lzFit: [{ target: 'otc/eu-de', verdict: 'NEEDS_VERIFICATION' }], blockVerdicts: { iam: 'PARTIAL', dr: 'SATISFACTORY' },
  degradedPasses: ['data'], skippedPassGroups: [{ passes: 'dynamic (10)', reason: 'Playwright not installed' }],
  detailLines: [], logAvailable: true, challenge: 'offer',
});
const LZ = lzFinishView({
  app: 'sovereign-health', typeLabel: 'Landing Zone Catalog Assessment',
  targets: [{ target: 'otc/eu-de', verdict: 'needs_verification', gaps: 2 }, { target: 'aws/eu-central-1', verdict: 'sovereignty_blocked', gaps: 1 }],
  overallVerdict: 'sovereignty_blocked', gapDetails: { 'eu-central-1': { gapType: 'sovereignty', sovereigntyStatement: '', assessmentMode: 'partial' } },
  runFolder: 'apps/sovereign-health/wsp/runs/2026-11-09T16-11-31/', catalogueOnly: true, logAvailable: true, challenge: 'offer',
});

describe('assessment finish screens at 100 and 80 columns (#4256)', () => {
  const FAILED = { ...failedRunView('Application Assessment', 'sovereign-health', 1, true), items: [] };
  for (const [name, view, run] of [['Application', APP, '2026-11-10T08-53-21'], ['LZ Catalog', LZ, '2026-11-09T16-11-31'], ['failed run', FAILED, 'Exit code']] as const) {
    for (const columns of [100, 80]) {
      it(`${name} finish at ${columns} columns`, () => {
        const lines = frame((
          <Box flexDirection="column" width={columns - 2}>
            <FinishPanel title={view.title} level={view.level} rows={view.rows} items={view.items} next={view.next} onSelect={() => {}} />
            <KeyHints hints={FINISH_PANEL_KEYS} />
          </Box>
        ), columns);
        const text = lines.join('\n');
        expect(lines[0]).toBe(view.title);
        expect(text).toContain(run);
        expect(text).toContain('Back to main menu');
        expect(lines.filter((l) => l.includes('Enter'))).toEqual([formatKeyHints(FINISH_PANEL_KEYS)]);
        expect(text).not.toMatch(/<ts>|<latest>| -- |Press Esc|Press Enter/);
        expect(Math.max(...lines.map((l) => [...l].length))).toBeLessThanOrEqual(columns);
      });
    }
  }
});
