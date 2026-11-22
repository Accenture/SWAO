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

// #4392: the public TUI slot of the HTTP MCP server. Without a registered
// starter (Community, Consultant) the start is a silent no-op; the Enterprise
// starter is injected here (no process, no port).

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  formatTuiMcpServerState,
  registerTuiMcpServerStarter,
  resetTuiMcpServerForTest,
  startTuiMcpServer,
  subscribeTuiMcpServerState,
  tuiMcpServerState,
  type TuiMcpServerState,
} from './mcp-server-slot.js';
import { mainMenuFooter } from './screens/MainMenu.js';

afterEach(() => resetTuiMcpServerForTest());

describe('#4392 TUI MCP server slot', () => {
  it('no starter registered (Community, Consultant): nothing happens, nothing is shown', async () => {
    await startTuiMcpServer({ workspace: '/ws', env: {} });
    expect(tuiMcpServerState()).toEqual({ kind: 'off' });
    expect(formatTuiMcpServerState(tuiMcpServerState())).toBeNull();
  });

  it('SWAO_MCP_AUTOSTART=0 or no open workspace: the starter is not called', async () => {
    const starter = vi.fn(async (): Promise<TuiMcpServerState> => ({ kind: 'running', port: 3737 }));
    registerTuiMcpServerStarter(starter);
    await startTuiMcpServer({ workspace: '/ws', env: { SWAO_MCP_AUTOSTART: '0' } });
    await startTuiMcpServer({ workspace: null, env: {} });
    expect(starter).not.toHaveBeenCalled();
    expect(tuiMcpServerState().kind).toBe('off');
  });

  it('Enterprise: starting, then the starter result; subscribers see each state', async () => {
    let release!: (s: TuiMcpServerState) => void;
    const starter = vi.fn(() => new Promise<TuiMcpServerState>((res) => { release = res; }));
    registerTuiMcpServerStarter(starter);
    const seen: string[] = [];
    const off = subscribeTuiMcpServerState(() => seen.push(tuiMcpServerState().kind));
    const run = startTuiMcpServer({ workspace: '/ws', port: 4100, env: {} });
    expect(tuiMcpServerState()).toEqual({ kind: 'starting', port: 4100 });
    release({ kind: 'connected', port: 4100 });
    await run;
    off();
    expect(starter).toHaveBeenCalledWith({ port: 4100, workspace: '/ws' });
    expect(seen).toEqual(['starting', 'connected']);
  });

  it('a throwing starter ends as failed with the reason', async () => {
    registerTuiMcpServerStarter(async () => { throw new Error('spawn EACCES'); });
    await startTuiMcpServer({ workspace: '/ws', env: {} });
    expect(tuiMcpServerState()).toEqual({ kind: 'failed', port: 3737, reason: 'spawn EACCES' });
  });

  it('footer lines: short, no double dash; the landing page stays', () => {
    const lines = [
      formatTuiMcpServerState({ kind: 'starting', port: 3737 }),
      formatTuiMcpServerState({ kind: 'running', port: 3737 }),
      formatTuiMcpServerState({ kind: 'connected', port: 3737 }),
      formatTuiMcpServerState({ kind: 'failed', port: 3737, reason: 'x'.repeat(200) }),
    ];
    expect(lines[1]).toBe('MCP server: running on port 3737, stops when SWAO closes');
    expect(lines[2]).toBe('MCP server: connected on port 3737 (another SWAO, stays running)');
    for (const l of lines) {
      expect(l!.length).toBeLessThanOrEqual(110);
      expect(l).not.toMatch(/--/);
    }
    expect(mainMenuFooter(null)).toMatch(/^Further information: /);
    expect(mainMenuFooter(lines[1]!)).toMatch(/^MCP server: running on port 3737, stops when SWAO closes\. Further information: /);
  });
});
