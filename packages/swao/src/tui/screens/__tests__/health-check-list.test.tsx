// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, Health Check probe list rows (#4257)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4257 (TUI-13, Design 126 mockup M-06, #4235 row 10, A-11):
// HC-01 the counters [1/15] and [10/15] are right-aligned, so the name column does not shift
// HC-02 a warn or fail row shows its reason on a second line under the row; ok and info rows take one line
// HC-03 the status words come from the central status map (lower case, in brackets), never OK or WARN
// HC-04 every line stays within the header rule at 100 and 80 columns
// HC-05 the guidance entry of the selected probe reaches the screen (onCursorEntry), status in lower case

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { headerRuleWidth, type GuidanceEntry } from '@swao/tui-kit';
import { HealthCheckProbeList } from '@swao/module-health-check';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';

const dots = (name: string): string => `${name}${'.'.repeat(Math.max(3, 26 - name.length))}`;
const header = (n: number, name: string, status: string, msg = ''): string => `  [${n}/15] ${dots(name)}  ${status}  ${msg}`;

const LINES: string[] = [
  header(1, 'License', 'ok', 'community tier'),
  header(2, 'Prerequisites', 'WARN', 'checkov not found; the IaC security scan uses kics instead'),
  header(3, 'VCS auth', 'INFO', 'no app with a remote source'),
  ...Array.from({ length: 6 }, (_, i) => header(4 + i, `Probe ${4 + i}`, 'ok', 'fine')),
  header(10, 'LLM gateway', 'FAIL', 'no connector file loads'),
];

async function settle(ms = 80): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

async function lines(columns: number, onCursorEntry?: (e: GuidanceEntry | undefined) => void): Promise<string[]> {
  const r = renderAt(<HealthCheckProbeList lines={LINES} done guidance="none" onCursorEntry={onCursorEntry} />, columns, 80);
  await settle();
  const out = r.lines().map((l) => l.trimEnd());
  r.unmount();
  return out;
}

describe('Health Check probe list on the standard (#4257, Design 126 M-06)', () => {
  for (const columns of [100, 80]) {
    it(`HC-01 to HC-04 at ${columns} columns`, async () => {
      const out = await lines(columns);
      // formatCounter right-aligns: " [1/15]" and "[10/15]" end in the same column.
      const one = out.find((l) => l.includes('[1/15]'));
      const ten = out.find((l) => l.includes('[10/15]'));
      expect(one).toBeDefined();
      expect(ten).toBeDefined();
      expect(one!.indexOf('License')).toBe(ten!.indexOf('LLM gateway'));
      expect(one!.indexOf('[1/15]') + '[1/15]'.length).toBe(ten!.indexOf('[10/15]') + '[10/15]'.length);

      const warnIdx = out.findIndex((l) => l.includes('Prerequisites'));
      expect(out[warnIdx]).toContain('[warn]');
      expect(out[warnIdx + 1]).toContain('checkov not found');
      const failIdx = out.findIndex((l) => l.includes('LLM gateway'));
      expect(out[failIdx]).toContain('[fail]');
      expect(out[failIdx + 1]).toContain('no connector file loads');
      const infoIdx = out.findIndex((l) => l.includes('VCS auth'));
      expect(out[infoIdx]).toContain('[info]');
      expect(out[infoIdx + 1]).toContain('Probe 4');

      const text = out.join('\n');
      expect(text).not.toMatch(/\b(OK|WARN|FAIL|INFO)\b/);
      expect(widest(out)).toBeLessThanOrEqual(headerRuleWidth(columns));
    });
  }

  it('HC-05 the selected probe guidance reaches the screen', async () => {
    const onCursorEntry = vi.fn();
    await lines(100, onCursorEntry);
    const last = onCursorEntry.mock.calls.at(-1)?.[0] as GuidanceEntry;
    expect(last.title).toBe('License');
    expect(last.sections?.[0]).toEqual({ label: 'Status', text: 'ok' });
    expect(last.cli).toBe('swao health-check');
  });
});
