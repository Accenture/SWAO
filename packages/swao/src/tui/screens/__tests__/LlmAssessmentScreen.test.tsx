// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI component tests: LlmAssessmentScreen (#1427)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-LLM-01: no-apps-found -- screen shows message when no eligible app exists
// TU-LLM-02: error branch -- orchestrateLegs throws; screen shows the error message
// TU-LLM-03: done display -- LlmResultTable renders synthetic OrchestrationResult
//
// CLI equivalent : swao assess --app <id> --type llm
// MCP equivalent : n/a

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Mocks -- declared before imports (vi.mock is hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => '/mock/workspace'),
    LicenseGuard: {
      load: vi.fn(() => ({
        state: {
          tier:                  'consultant' as const,
          valid:                 true,
          remaining_assessments: 500,
          expiry:                '2027-01-01',
          fingerprint:           'abc1234567890abc',
          licensee:              'Test User',
          email:                 'test@test.com',
          firstRun:              '2026-01-01',
          assessmentCount:       0,
          assessmentLimit:       null,
          exp:                   undefined,
        },

        requireTier: vi.fn(), // no-op -- tier tests use orchestrateLegs.mockRejectedValue instead
      })),
    },
  };
});

vi.mock('@swao/module-llm-assessment', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/module-llm-assessment')>();
  return {
    ...original,
    checkAppAssessmentPrecondition: vi.fn(() => ({ ok: false, reason: 'no-runs' })),
    orchestrateLegs: vi.fn(),
  };
});

// LlmAssessmentScreen calls existsSync + readdirSync + readFileSync from 'fs'.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync:   vi.fn(() => false),
    readdirSync:  vi.fn(() => [] as never[]),
    readFileSync: vi.fn((_p: unknown) => { throw new Error('mock: file not found'); }),
  };
});

// ---------------------------------------------------------------------------
// Screen imports -- after mock declarations
// ---------------------------------------------------------------------------
import { LlmAssessmentScreen, LlmResultTable } from '../LlmAssessmentScreen.js';
import type { OrchestrationResult, ResolvedLeg } from '@swao/module-llm-assessment';
import { checkAppAssessmentPrecondition, orchestrateLegs } from '@swao/module-llm-assessment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = vi.fn();

// ---------------------------------------------------------------------------
// TU-LLM-01: no-apps-found
// ---------------------------------------------------------------------------
describe('LlmAssessmentScreen -- TU-LLM-01: no eligible apps', () => {
  beforeEach(() => {
    // appsDir does not exist -> appNames = [] -> no-apps stage
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([] as never[]);
  });

  afterEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it('shows no-eligible-applications message', async () => {
    const { lastFrame } = render(
      <LlmAssessmentScreen workspacePath="/mock/workspace" onBack={noop} />,
    );
    // Allow the synchronous loading useEffect to settle and re-render.
    await new Promise<void>((r) => setTimeout(r, 100));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('No eligible applications found');
  });
});

// ---------------------------------------------------------------------------
// TU-LLM-02: error branch -- screen renders the error stage with the message
// ---------------------------------------------------------------------------
// The error stage is reachable from any async failure (loading, orchestrateLegs,
// writeLlmLegsToSwaoYml). Triggering it via a loading exception is the
// simplest path that keeps this test self-contained and avoids navigating
// the full interactive build-legs -> pick-model -> health-check -> review-config
// flow. The render logic (errorMsg display) is the same regardless of origin.
describe('LlmAssessmentScreen -- TU-LLM-02: error stage renders the error message', () => {
  afterEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(checkAppAssessmentPrecondition).mockReset();
    vi.mocked(orchestrateLegs).mockReset();
  });

  it('shows error message when loading throws', async () => {
    // existsSync throws -> loading catch -> errorMsg set -> error stage
    vi.mocked(fs.existsSync).mockImplementation(() => {
      throw new Error('connection refused');
    });
    const { lastFrame } = render(
      <LlmAssessmentScreen workspacePath="/mock/workspace" onBack={noop} />,
    );
    await new Promise<void>((r) => setTimeout(r, 100));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('LLM Assessment failed');
    expect(frame).toContain('connection refused');
  });
});

// ---------------------------------------------------------------------------
// TU-LLM-03: done display -- LlmResultTable with synthetic OrchestrationResult
// ---------------------------------------------------------------------------
describe('LlmResultTable -- TU-LLM-03: renders synthetic result', () => {
  const syntheticLegs: ResolvedLeg[] = [
    {
      id: 'openrouter--anthropic_claude_sonnet_4',
      connector: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      primary: true,
      costSource: 'billed',
    },
    {
      id: 'openrouter--deepseek_deepseek_chat',
      connector: 'openrouter',
      model: 'deepseek/deepseek-chat',
      primary: false,
      costSource: 'billed',
    },
  ];

  const legA = 'openrouter--anthropic_claude_sonnet_4';
  const legB = 'openrouter--deepseek_deepseek_chat';

  const syntheticResult: OrchestrationResult = {
    runDir:        '/mock/workspace/.llm-runs/run-1',
    manifestPath:  '/mock/workspace/.llm-runs/run-1/manifest.json',
    records:       [],
    groups: [
      {
        group: 'performance',
        score: { [legA]: 80, [legB]: 60 },
        rank:  { [legA]: 1,  [legB]: 2  },
        light: { [legA]: 'ok', [legB]: 'warn' },
      },
      {
        group: 'cost',
        score: { [legA]: 40, [legB]: 90 },
        rank:  { [legA]: 2,  [legB]: 1  },
        light: { [legA]: 'warn', [legB]: 'ok' },
      },
    ],
    final: {
      score:   { [legA]: 72, [legB]: 68 },
      rank:    { [legA]: 1,  [legB]: 2  },
      weights: { quality: 0.5, reliability: 0.2, performance: 0.15, cost: 0.15 },
      partial: {},
    },
    findingsCount: 3,
  };

  it('renders group names, FINAL row, and ranked scores', () => {
    const { lastFrame } = render(
      <LlmResultTable result={syntheticResult} legs={syntheticLegs} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('performance');
    expect(frame).toContain('cost');
    expect(frame).toContain('FINAL');
    // Primary leg scores 72 and ranks #1
    expect(frame).toContain('72');
    expect(frame).toContain('#1');
  });

  it('shows call count and findings count in footer', () => {
    const { lastFrame } = render(
      <LlmResultTable result={syntheticResult} legs={syntheticLegs} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('0 call(s)');
    expect(frame).toContain('3 finding(s)');
  });
});
