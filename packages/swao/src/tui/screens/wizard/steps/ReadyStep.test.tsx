// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI tests: Ready step health result (#4120)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4120: the Ready step shows the result of the wizard's final health check,
// and the health-check step hands its counts on through onNext.

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return { ...actual, logPortfolio: vi.fn() };
});

import { homedir } from 'os';
import { join } from 'path';
import { ReadyStep, formatReadyHealthLine, readyCredentialPath } from './ReadyStep.js';
import { logSetupHealthCheckResult } from './HealthCheckStep.js';
import type { SetupState } from '../shared.js';

const state: SetupState = {
  workDir: '/ws',
  engagementName: '',
  clientCode: '',
  partnershipLead: '',
  llmProvider: 'anthropic',
  llmModel: 'model',
  ollamaEndpoint: '',
  openLlmBaseUrl: '',
};

describe('Ready step health result (#4120)', () => {
  it('formats probe, failure and warning counts', () => {
    expect(formatReadyHealthLine({ probeCount: 26, failCount: 0, warnCount: 1 })).toBe('26 probes, 0 failures, 1 warning');
    expect(formatReadyHealthLine({ probeCount: 1, failCount: 2, warnCount: 0 })).toBe('1 probe, 2 failures, 0 warnings');
    expect(formatReadyHealthLine(undefined)).toContain('no result');
    expect(formatReadyHealthLine({ probeCount: 0, failCount: 0, warnCount: 0 })).toContain('no result');
  });

  it('renders the health line on the Ready step', () => {
    const r = render(<ReadyStep state={state} health={{ probeCount: 26, failCount: 0, warnCount: 1 }} onBack={() => {}} />);
    const frame = r.lastFrame() ?? '';
    r.unmount();
    expect(frame).toMatch(/Health\s/);
    expect(frame).toContain('26 probes, 0 failures, 1 warning');
  });

  it('#4344: shows the credential store profile-relative, never the user profile path', () => {
    const home = homedir();
    expect(readyCredentialPath({ USERPROFILE: home, HOME: home } as NodeJS.ProcessEnv)).toBe(join('~', '.config', 'swao', '.swao-credentials.json'));
    const r = render(<ReadyStep state={state} health={{ probeCount: 26, failCount: 0, warnCount: 1 }} onBack={() => {}} />);
    const frame = (r.lastFrame() ?? '').replace(/\s+/g, '');
    r.unmount();
    if (home.length > 3) expect(frame).not.toContain(home.replace(/\s+/g, ''));
    expect(frame).toContain('.swao-credentials.json');
  });

  it('#4392: names a change of the saved default workspace (parity with swao init), nothing when unchanged', () => {
    const changed = render(<ReadyStep state={{ ...state, previousDefaultWorkspace: '/old-ws' }} onBack={() => {}} />);
    const frame = changed.lastFrame() ?? '';
    changed.unmount();
    expect(frame).toContain('now the saved default workspace (was /old-ws)');
    const first = render(<ReadyStep state={{ ...state, previousDefaultWorkspace: '' }} onBack={() => {}} />);
    expect(first.lastFrame() ?? '').toContain('(was none)');
    first.unmount();
    const same = render(<ReadyStep state={state} onBack={() => {}} />);
    expect(same.lastFrame() ?? '').not.toContain('saved default');
    same.unmount();
  });

  it('logSetupHealthCheckResult returns the counts the Ready step shows', () => {
    expect(logSetupHealthCheckResult([])).toEqual({ probeCount: 0, failCount: 0, warnCount: 0 });
    expect(logSetupHealthCheckResult([
      '  [1/26] License...............  ok    Enterprise',
      '  [3/26] SWAO-MCP..............  WARN  stale entry',
      'All probes passed.',
    ])).toEqual({ probeCount: 2, failCount: 0, warnCount: 1 });
  });
});
