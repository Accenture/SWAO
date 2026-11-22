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

// #4392: the main menu footer with a live MCP server state, rendered in the
// constant-height TerminalFrame: at 80 x 24 the MCP line and the chrome stay
// within the frame (the list pages), at 80 x 40 the "0 Exit" entry shows too,
// and every line fits the header rule. The starter is
// injected (no process, no port).

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    LicenseGuard: {
      load: vi.fn(() => ({
        state: {
          tier: 'enterprise' as const, valid: true, remaining_assessments: 48, expiry: '2027-01-01',
          fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com',
          firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined,
        },
      })),
    },
  };
});

import { TerminalFrame, headerRuleWidth } from '@swao/tui-kit';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';
import { MainMenu } from '../MainMenu.js';
import { registerTuiMcpServerStarter, resetTuiMcpServerForTest, startTuiMcpServer } from '../../mcp-server-slot.js';

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
afterEach(() => resetTuiMcpServerForTest());

describe('#4392 main menu footer with the MCP server state', () => {
  for (const kind of ['running', 'connected'] as const) {
    it(`${kind}: at 80 x 24 the frame keeps its height, key hints and guidance box; at 80 x 40 the Exit entry shows too`, async () => {
      registerTuiMcpServerStarter(async ({ port }) => ({ kind, port }));
      await startTuiMcpServer({ workspace: '/ws', env: {} });
      const r = renderAt(<TerminalFrame rows={24} columns={80}><MainMenu onSelect={() => undefined} /></TerminalFrame>, 80, 24);
      await settle();
      const lines = r.lines().map((l) => l.trimEnd());
      r.unmount();
      const text = lines.join(' ').replace(/\s+/g, ' ');
      expect(text).toContain(kind === 'running' ? 'MCP server: running on port 3737' : 'MCP server: connected on port 3737');
      // At 24 rows the list pages (its budget counts the wrapped footer, as
      // without the MCP line); the chrome stays visible.
      expect(lines.length).toBeLessThanOrEqual(24);
      expect(lines.some((l) => l.includes('Enter open'))).toBe(true);
      expect(lines.some((l) => l.trimStart().startsWith('└'))).toBe(true);
      expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(80));
      const tall = renderAt(<TerminalFrame rows={40} columns={80}><MainMenu onSelect={() => undefined} /></TerminalFrame>, 80, 40);
      await settle();
      const tallLines = tall.lines();
      tall.unmount();
      expect(tallLines.some((l) => l.includes('0  Exit'))).toBe(true);
      expect(tallLines.join(' ')).toContain('MCP server:');
    });
  }

  it('Community and Consultant (no starter): no MCP line', async () => {
    await startTuiMcpServer({ workspace: '/ws', env: {} });
    const r = renderAt(<TerminalFrame rows={24} columns={80}><MainMenu onSelect={() => undefined} /></TerminalFrame>, 80, 24);
    await settle();
    const text = r.lines().join(' ');
    r.unmount();
    expect(text).not.toContain('MCP server');
  });
});
