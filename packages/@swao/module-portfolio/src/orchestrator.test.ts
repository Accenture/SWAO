// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Portfolio module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverApps,
  runPortfolio,
  resolveSpawn,
  PortfolioOrchestrator,
  formatPortfolioResult,
  type PortfolioRunDeps,
  type PortfolioRunResult,
} from './orchestrator.js';
import { manifest } from './index.js';

// Build a temp workspace with apps/{a,b,c}/ (the sprint artefact: mock 3-app
// workspace). The orchestrator only needs the directories to exist; per-app
// dispatch is exercised via a MOCK runForApp, so NO real subprocess is spawned.
function makeWorkspace(appIds: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'swao-portfolio-test-'));
  for (const id of appIds) {
    mkdirSync(join(root, 'apps', id), { recursive: true });
  }
  return root;
}

describe('@swao/module-portfolio orchestrator', () => {
  let ws = '';

  beforeEach(() => { ws = makeWorkspace(['c', 'a', 'b']); });
  afterEach(() => { if (ws) rmSync(ws, { recursive: true, force: true }); });

  it('discoverApps lists apps/ child dirs, sorted and deterministic', () => {
    expect(discoverApps(ws)).toEqual(['a', 'b', 'c']);
  });

  it('discoverApps returns [] when apps/ is absent', () => {
    const empty = mkdtempSync(join(tmpdir(), 'swao-portfolio-empty-'));
    try {
      expect(discoverApps(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('runPortfolio dispatches once per app with the right args (mock runForApp)', async () => {
    const calls: Array<{ appId: string; args: string[] }> = [];
    const deps: PortfolioRunDeps = {
      runForApp: async (appId, args): Promise<PortfolioRunResult> => {
        calls.push({ appId, args });
        return { ok: true, stdout: `ran ${appId}`, stderr: '' };
      },
    };

    await runPortfolio(ws, 'assess', ['--llm-stub'], deps);

    // One dispatch per app, in discovery (sorted) order. Each per-app run carries
    // an explicit --workspace and NO --portfolio (so it never re-enters).
    expect(calls).toEqual([
      { appId: 'a', args: ['assess', '--app', 'a', '--workspace', ws, '--llm-stub'] },
      { appId: 'b', args: ['assess', '--app', 'b', '--workspace', ws, '--llm-stub'] },
      { appId: 'c', args: ['assess', '--app', 'c', '--workspace', ws, '--llm-stub'] },
    ]);
    // No `--portfolio` in the per-app args (avoids re-entering the portfolio branch).
    for (const c of calls) expect(c.args).not.toContain('--portfolio');
  });

  it('runPortfolio aggregates per-app ok/fail outcomes correctly', async () => {
    const deps: PortfolioRunDeps = {
      runForApp: async (appId): Promise<PortfolioRunResult> => ({
        // 'b' fails; 'a' and 'c' succeed.
        ok: appId !== 'b',
        stdout: `stdout-${appId}`,
        stderr: appId === 'b' ? 'boom' : '',
      }),
    };

    const result = await runPortfolio(ws, 'report', [], deps);

    expect(result.command).toBe('report');
    expect(result.apps).toEqual(['a', 'b', 'c']);
    expect(result.counts).toEqual({ total: 3, ok: 2, failed: 1 });
    expect(result.outcomes.map(o => ({ appId: o.appId, ok: o.ok }))).toEqual([
      { appId: 'a', ok: true },
      { appId: 'b', ok: false },
      { appId: 'c', ok: true },
    ]);
    expect(result.outcomes[1].stderr).toBe('boom');
  });

  it('PortfolioOrchestrator class delegates to the functional API', async () => {
    const deps: PortfolioRunDeps = {
      runForApp: async (appId): Promise<PortfolioRunResult> => ({ ok: true, stdout: appId, stderr: '' }),
    };
    const orch = new PortfolioOrchestrator(deps);
    expect(orch.discoverApps(ws)).toEqual(['a', 'b', 'c']);
    const result = await orch.runPortfolio(ws, 'assess', []);
    expect(result.counts.ok).toBe(3);
  });

  it('formatPortfolioResult renders a per-app ok/fail summary', async () => {
    const deps: PortfolioRunDeps = {
      runForApp: async (appId): Promise<PortfolioRunResult> => ({ ok: appId !== 'b', stdout: '', stderr: '' }),
    };
    const result = await runPortfolio(ws, 'assess', [], deps);
    const text = formatPortfolioResult(result);
    expect(text).toContain('2 ok, 1 failed');
    expect(text).toContain('[ok] a');
    expect(text).toContain('[fail] b');
    expect(text).toContain('[ok] c');
  });
});

describe('@swao/module-portfolio resolveSpawn (host-injection DI)', () => {
  it('dev (cliIsScript) spawns the node execPath with the script + args', () => {
    const { cmd, cmdArgs } = resolveSpawn(
      { swaoCliPath: '/abs/host/index.js', cliIsScript: true },
      ['assess', '--app', 'a'],
    );
    expect(cmd).toBe(process.execPath);
    expect(cmdArgs).toEqual(['/abs/host/index.js', 'assess', '--app', 'a']);
  });

  it('pkg binary (cliIsScript false) spawns the binary directly with args', () => {
    const { cmd, cmdArgs } = resolveSpawn(
      { swaoCliPath: '/abs/swao-enterprise-win.exe', cliIsScript: false },
      ['report', '--app', 'b'],
    );
    expect(cmd).toBe('/abs/swao-enterprise-win.exe');
    expect(cmdArgs).toEqual(['report', '--app', 'b']);
  });

  it('null deps falls back to execPath + argv[1]', () => {
    const { cmd } = resolveSpawn(null, ['assess']);
    expect(cmd).toBe(process.execPath);
  });
});

describe('@swao/module-portfolio manifest', () => {
  it('declares the enterprise tier and contributes the PortfolioScreen', () => {
    expect(manifest.id).toBe('@swao/module-portfolio');
    expect(manifest.tier).toBe('enterprise');
    const screens = manifest.contributions.tuiScreens ?? [];
    expect(screens.map(s => s.name)).toContain('PortfolioScreen');
    expect(screens.every(s => s.tier === 'enterprise')).toBe(true);
  });
});
