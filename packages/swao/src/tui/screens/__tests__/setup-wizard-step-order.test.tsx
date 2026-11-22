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

// #4120 / #4190 / #4191 (Design 125 sections 4 to 7): the wizard engine drives
// the real SetupWizard with every step component stubbed (each stub renders
// its name and advances on Enter). First run: generic steps, the generic
// health check, the type selection, then per chosen type its steps, its scoped
// health check (after its last configuration step) and its Ready. The type
// choice and each branch state are recorded in the workspace .swao.yml.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { logged, hcScopes, wsHolder } = vi.hoisted(() => ({ logged: [] as string[], hcScopes: [] as Array<string | undefined>, wsHolder: { dir: '.' } }));

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: vi.fn((_level: string, code: string) => { logged.push(code); }),
    saveDefaultWorkspace: vi.fn(),
    setWorkspaceRoot: vi.fn(),
    findInstalledChromium: vi.fn(() => null),
  };
});

vi.mock('../../../license/license-guard.js', () => ({
  LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'enterprise' } })) },
}));

vi.mock('../wizard/yaml-helpers.js', () => ({
  writeLlmToYaml: vi.fn(),
  writeSecondaryLlmToYaml: vi.fn(),
  writeVisionMaxScreensToYaml: vi.fn(),
  readTestCodeModeFromYaml: vi.fn(() => undefined),
  writeTestCodeModeToYaml: vi.fn(() => { logged.push('stub.test-code.written'); }),
}));

function Stub({ name, advance }: { name: string; advance: () => void }) {
  useInput((_i, key) => { if (key.return) advance(); });
  return <Text>STUB:{name}</Text>;
}

vi.mock('../wizard/steps/InitStep.js', () => ({
  InitStep: ({ onNext }: { onNext: (s: object) => void }) =>
    <Stub name="init" advance={() => onNext({ workDir: wsHolder.dir, engagementName: 'Demo', clientCode: 'demo', partnershipLead: '' })} />,
}));
vi.mock('../wizard/steps/LlmStep.js', () => ({
  LlmStep: ({ onNext }: { onNext: (p: string, m: string, e: string, o: string) => void }) =>
    <Stub name="llm" advance={() => onNext('anthropic', 'model', '', '')} />,
}));
vi.mock('../wizard/steps/LlmSecondaryStep.js', () => ({
  LlmSecondaryStep: ({ onSkip }: { onSkip: () => void }) => <Stub name="llm-secondary" advance={onSkip} />,
}));
vi.mock('../wizard/steps/CredentialsStep.js', () => ({
  CredentialsStep: ({ onNext }: { onNext: () => void }) => <Stub name="credentials" advance={onNext} />,
}));
vi.mock('../wizard/steps/LzConnectionsStep.js', () => ({
  LzConnectionsStep: ({ onNext }: { onNext: (opened: boolean) => void }) => <Stub name="lz-connections" advance={() => onNext(false)} />,
}));
vi.mock('../wizard/steps/IntegrationsStep.js', () => ({
  ClaudeDesktopStep: ({ onNext }: { onNext: () => void }) => <Stub name="claude-desktop" advance={onNext} />,
  PlaywrightStep: ({ onNext }: { onNext: (n?: number) => void }) => <Stub name="playwright" advance={() => onNext(undefined)} />,
}));
// The real step: Enter picks a mode, Esc keeps the current one (#3403).
function TestCodeStub({ onNext }: { onNext: (m?: string) => void }) {
  useInput((_i, key) => { if (key.return) onNext('tag'); if (key.escape) onNext(undefined); });
  return <Text>STUB:test-code</Text>;
}
vi.mock('../wizard/steps/TestCodeStep.js', () => ({ TestCodeStep: TestCodeStub }));
// The branch steps the Application (#4192) and LZ Live (#4195) lanes added to
// the branch modules; stubbed like the migrated steps so this file stays an
// engine test (each step component has its own test file).
function BranchStepStub({ name, onNext }: { name: string; onNext: (r: { status: 'kept' }) => void }) {
  return <Stub name={name} advance={() => onNext({ status: 'kept' })} />;
}
vi.mock('../../../setup/steps/ApplicationAppStep.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../setup/steps/ApplicationAppStep.js')>()),
  ApplicationAppStep: ({ onNext }: { onNext: (r: { status: 'kept' }) => void }) => <BranchStepStub name="app" onNext={onNext} />,
}));
vi.mock('../../../setup/steps/ApplicationSourceStep.js', () => ({
  ApplicationSourceStep: ({ onNext }: { onNext: (r: { status: 'kept' }) => void }) => <BranchStepStub name="source-access" onNext={onNext} />,
}));
vi.mock('../../../setup/steps/ApplicationToolsStep.js', () => ({
  ApplicationToolsStep: ({ onNext }: { onNext: (r: { status: 'kept' }) => void }) => <BranchStepStub name="tools" onNext={onNext} />,
}));
vi.mock('../../../setup/branches/lz-live-steps.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../setup/branches/lz-live-steps.js')>()),
  LzLiveProbeStep: ({ onNext }: { onNext: (r: { status: 'kept' }) => void }) => <BranchStepStub name="probe" onNext={onNext} />,
  LzLiveBaselineStep: ({ onNext }: { onNext: (r: { status: 'kept' }) => void }) => <BranchStepStub name="policy-baseline" onNext={onNext} />,
  LzLiveEvidenceStep: ({ onNext }: { onNext: (r: { status: 'kept' }) => void }) => <BranchStepStub name="org-evidence" onNext={onNext} />,
}));
vi.mock('../wizard/steps/HealthCheckStep.js', () => ({
  HealthCheckStep: ({ onNext, scope }: { scope?: string; onNext: (s?: { probeCount: number; failCount: number; warnCount: number; failedProbes?: string[]; warnedProbes?: string[] }) => void }) =>
    <Stub name={`health-check:${scope ?? 'all'}`} advance={() => {
      hcScopes.push(scope);
      logged.push(`stub.health-check.${scope}`);
      onNext(scope === 'lz-live'
        ? { probeCount: 7, failCount: 1, warnCount: 0, failedProbes: ['credential-vault'], warnedProbes: [] }
        : { probeCount: 15, failCount: 0, warnCount: 1, failedProbes: [], warnedProbes: ['Prerequisites'] });
    }} />,
}));
vi.mock('../wizard/steps/ReadyStep.js', () => ({
  ReadyStep: ({ health }: { health?: { probeCount: number } }) => <Text>STUB:ready-generic health={health ? health.probeCount : 'none'}</Text>,
  formatReadyHealthLine: (h?: { probeCount: number; failCount: number; warnCount: number }) => (h ? `${h.probeCount} probes, ${h.failCount} failures` : 'no result'),
}));

import { SetupWizard } from '../SetupWizard.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); logged.length = 0; hcScopes.length = 0; });

function workspace(yml = 'engagement:\n  name: Demo\n'): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-wizard-engine-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), yml, 'utf-8');
  wsHolder.dir = d;
  return d;
}

const current = (frame: string | undefined): string => {
  const m = /STUB:([a-z:-]+)/.exec(frame ?? '');
  if (m) return m[1]!;
  if ((frame ?? '').includes('Which assessments will you run?')) return 'type-selection';
  const r = /(Application Assessment|Landing Zone Live Assessment): (ready|needs attention)/.exec(frame ?? '');
  return r ? `ready:${r[1]}:${r[2]}` : 'unknown';
};

describe('Setup Wizard engine (#4190, #4191)', () => {
  it('first run: generic, generic health check, type selection, then each chosen branch with its scoped health check and Ready', async () => {
    const ws = workspace();
    let back = 0;
    const r = render(<SetupWizard onBack={() => { back++; }} workspaceRoot={null} />);
    const seen: string[] = [];
    const frames: Record<string, string> = {};
    for (let i = 0; i < 40 && back === 0; i++) {
      await tick();
      const name = current(r.lastFrame());
      if (seen[seen.length - 1] !== name) { seen.push(name); frames[name] = r.lastFrame() ?? ''; }
      if (name === 'type-selection') {
        r.stdin.write('1'); await tick(); // tick Application
        r.stdin.write('4'); await tick(); // tick Landing Zone Live
      }
      r.stdin.write('\r');
    }
    r.unmount();

    expect(seen).toEqual([
      'init', 'llm', 'llm-secondary', 'credentials', 'claude-desktop', 'health-check:generic', 'type-selection',
      'app', 'source-access', 'playwright', 'test-code', 'tools', 'health-check:application', 'ready:Application Assessment:needs attention',
      'lz-connections', 'probe', 'policy-baseline', 'org-evidence', 'health-check:lz-live', 'ready:Landing Zone Live Assessment:needs attention',
    ]);
    expect(back).toBe(1);
    expect(hcScopes).toEqual(['generic', 'application', 'lz-live']);
    // #4120: the configuration steps of a branch come before its health check.
    expect(logged.indexOf('stub.test-code.written')).toBeLessThan(logged.indexOf('stub.health-check.application'));
    expect(logged.indexOf('wsp.setup.complete')).toBeGreaterThan(logged.indexOf('stub.health-check.generic'));
    // Step bar: generic entries plus the active branch only; the subtitle names the branch.
    expect(frames['test-code']).toContain('Setup: Application Assessment');
    // In a branch the finished workspace part is one Workspace entry, so the bar fits the header width.
    expect(frames['test-code']).toMatch(/Workspace +. +App +. +Source Access +. +Playwright +. +Test Code +. +Tools +. +Health Check +. +Ready/);
    expect(frames['test-code']).not.toContain('Landing Zones');
    expect(frames['lz-connections']).toMatch(/Workspace +. +Landing Zones +. +Probe +. +Policy Baseline +. +Org Evidence +. +Health Check +. +Ready/);
    expect(frames['lz-connections']).not.toContain('Playwright');
    expect(frames['claude-desktop']).toMatch(/Init +. +LLM +. +Credentials +. +MCP Client +. +Health Check +. +Assessments/);
    // Ready of the failing branch names the failed probe.
    expect(frames['ready:Landing Zone Live Assessment:needs attention']).toContain('credential-vault');
    // Design 125 section 7: the choice and the branch states are recorded.
    const yml = readFileSync(join(ws, '.swao.yml'), 'utf-8');
    expect(yml).toContain('  assessment_types: [application, lz-live]');
    // The fixture has no app, so the Application Ready item "App" is missing: needs attention (branchStateFromCheck).
    expect(yml).toMatch(/setup_state: \{ ?application: \{ ?state: needs-attention, .*\}, lz-live: \{ ?state: needs-attention, .*fail_count: 1/);
    expect(yml).toContain('engagement:\n  name: Demo');
  });

  it('first run with no type ticked ends on the generic Ready and records an empty choice', async () => {
    const ws = workspace();
    const r = render(<SetupWizard onBack={() => {}} workspaceRoot={null} />);
    for (let i = 0; i < 12; i++) {
      await tick();
      if (current(r.lastFrame()) === 'ready-generic') break;
      r.stdin.write('\r');
    }
    const frame = r.lastFrame() ?? '';
    r.unmount();
    expect(frame).toContain('STUB:ready-generic health=15');
    expect(readFileSync(join(ws, '.swao.yml'), 'utf-8')).toContain('assessment_types: []');
  });

  it('a workspace with recorded types opens the Setup menu; one type runs only that branch', async () => {
    const ws = workspace('workspace:\n  assessment_types: [application]\n');
    let back = 0;
    const r = render(<SetupWizard onBack={() => { back++; }} workspaceRoot={ws} />);
    await tick();
    expect(r.lastFrame()).toContain('Set up an assessment type');
    r.stdin.write('\r'); // Set up an assessment type
    await tick();
    expect(r.lastFrame()).toContain('Landing Zone Catalog Assessment');
    r.stdin.write('1'); // Application Assessment
    const seen: string[] = [];
    for (let i = 0; i < 12 && back === 0; i++) {
      await tick();
      const name = current(r.lastFrame());
      if (seen[seen.length - 1] !== name) seen.push(name);
      r.stdin.write('\r');
    }
    r.unmount();
    expect(seen).toEqual(['app', 'source-access', 'playwright', 'test-code', 'tools', 'health-check:application', 'ready:Application Assessment:needs attention']);
    expect(hcScopes).toEqual(['application']);
    expect(back).toBe(1);
  });

  it('#4341: Esc on the type picker of the Setup menu returns to the menu; Esc on the menu leaves the Setup', async () => {
    const ws = workspace('workspace:\n  assessment_types: [application]\n');
    let back = 0;
    const r = render(<SetupWizard onBack={() => { back++; }} workspaceRoot={ws} />);
    await tick();
    r.stdin.write('\r'); // Set up an assessment type
    await tick();
    expect(r.lastFrame()).toContain('Landing Zone Catalog Assessment');
    r.stdin.write('\u001B');
    await tick(80);
    expect(r.lastFrame()).toContain('Workspace setup');
    expect(back).toBe(0);
    r.stdin.write('\u001B');
    await tick(80);
    r.unmount();
    expect(back).toBe(1);
  });

  it('Esc in the Test Code step opens the AbortDialog; Enter aborts without writing (#4341, Design 126 section 7.4)', async () => {
    const ws = workspace();
    let back = 0;
    const r = render(<SetupWizard onBack={() => { back++; }} mode={{ kind: 'branch', type: 'application' }} workspaceRoot={ws} />);
    // App and Source Access (#4192) come before Playwright in the branch.
    for (const step of ['app', 'source-access', 'playwright']) {
      await tick();
      expect(current(r.lastFrame())).toBe(step);
      r.stdin.write(String.fromCharCode(13));
    }
    await tick();
    expect(current(r.lastFrame())).toBe('test-code');
    // #4341: the step no longer captures Esc; one Esc belongs to the wizard.
    r.stdin.write(String.fromCharCode(27));
    await tick();
    expect(r.lastFrame()).toContain('Abort the setup?');
    r.stdin.write(String.fromCharCode(13));
    await tick();
    r.unmount();
    expect(back).toBe(1);
    expect(logged).not.toContain('stub.test-code.written');
  });

  it('Esc from a step returns to the main menu and logs wizard.abort', async () => {
    workspace();
    let back = 0;
    const r = render(<SetupWizard onBack={() => { back++; }} workspaceRoot={null} />);
    await tick();
    r.stdin.write('\u001B');
    await tick();
    r.unmount();
    await tick();
    expect(back).toBe(1);
    expect(logged).toContain('wizard.abort');
  });
});

describe('Esc leaves the wizard with a cancelled step (#4263)', () => {
  it('logs wizard.step.cancelled for the current step, then wizard.abort with reason user_escape; no completion', async () => {
    workspace();
    const { logPortfolio } = await import('@swao/core');
    vi.mocked(logPortfolio).mockClear();
    let back = 0;
    const r = render(<SetupWizard onBack={() => { back++; }} workspaceRoot={null} />);
    await tick();
    r.stdin.write('\u001B'); await tick(80);
    expect(back).toBe(1);
    r.unmount();
    await tick();
    const seen = vi.mocked(logPortfolio).mock.calls.map((c) => [c[1], (c[3] as { context?: Record<string, unknown> } | undefined)?.context ?? {}] as const);
    const codes = seen.map(([c]) => c);
    expect(codes).not.toContain('wizard.step.complete');
    expect(codes.indexOf('wizard.step.cancelled')).toBeGreaterThanOrEqual(0);
    expect(codes.indexOf('wizard.step.cancelled')).toBeLessThan(codes.indexOf('wizard.abort'));
    expect(seen.find(([c]) => c === 'wizard.step.cancelled')![1]).toMatchObject({ reason: 'user_escape' });
    expect(seen.find(([c]) => c === 'wizard.abort')![1]).toMatchObject({ reason: 'user_escape' });
  });
});
