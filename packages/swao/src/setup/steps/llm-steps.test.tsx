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

// #4196 SET-07 (Design 125 sections 4, 5.6, 5.7, 9, 11 and Q-05): the
// Candidates and Subject steps of the LLM branch. Step order with the engine
// health check, preselection of stored values on re-entry, credentials for
// candidates without a key, the pointer to the Application branch when no
// app has a completed run, and the layout rules.

import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Text, useInput } from 'ink';
import { CURSOR_MARKER, headerRuleWidth } from '@swao/tui-kit';
import { LlmCandidatesStep, type ConnectorLister } from './LlmCandidatesStep.js';
import { LlmSubjectStep } from './LlmSubjectStep.js';
import { readLlmDefaults } from '../defaults.js';
import { writeAssessmentLlm, type CandidateConnector } from '../llm-values.js';
import { buildSetupPlan, defaultSetupRegistry, entryLabel } from '../index.js';
import type { SetupStepProps, SetupStepResult } from '../types.js';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });
function ws(): string {
  dir = mkdtempSync(join(tmpdir(), 'swao-4196-steps-'));
  writeFileSync(join(dir, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
  return dir;
}

function props(root: string, results: Array<SetupStepResult | undefined>): SetupStepProps {
  return {
    ctx: { workspaceRoot: root, tier: 'community', scope: 'llm', scopeLabel: 'LLM Assessment', session: {} as SetupStepProps['ctx']['session'] },
    stepNumber: 1,
    stepCount: 4,
    onNext: (r) => results.push(r),
    updateSession: () => undefined,
    setEscapeCaptured: () => undefined,
    setGuidanceOpen: () => undefined,
  };
}

function expectLayout(frame: string): void {
  expect(frame).not.toContain('--');
  expect(frame).not.toMatch(/\bswao\s/);
  for (const line of frame.split('\n')) expect(line.trimEnd().length).toBeLessThanOrEqual(headerRuleWidth(100));
}

const CONNECTORS: CandidateConnector[] = [
  { id: 'alpha', name: 'Alpha Gateway', defaultModel: 'a-1', models: ['a-1', 'a-2'], credentialKey: 'alpha-key', hasCredential: true },
  { id: 'beta', name: 'Beta Gateway', defaultModel: 'b-1', models: ['b-1'], credentialKey: 'beta-key', hasCredential: false },
];
const lister: ConnectorLister = () => CONNECTORS;

function writeRun(root: string, app: string, completed: boolean): void {
  const runDir = join(root, 'apps', app, 'wsp', 'runs', '2026-11-08T10-00-00Z');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(root, 'apps', app, '.swao.yml'), `app_id: ${app}\n`, 'utf-8');
  writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify(completed ? { finished_at: '2026-11-08T10:00:00Z', passes_executed: ['01'] } : {}), 'utf-8');
}

describe('LLM branch step order (#4196, Design 125 sections 4 and 5.6)', () => {
  it('Candidates, Subject, then the engine health check and Ready', () => {
    const reg = defaultSetupRegistry();
    expect(reg.steps('llm').map((s) => [s.id, s.order])).toEqual([['llm.candidates', 10], ['llm.subject', 20]]);
    expect(buildSetupPlan(reg, { kind: 'branch', type: 'llm' }).map(entryLabel)).toEqual(['Candidates', 'Subject', 'Health Check', 'Ready']);
    for (const s of reg.steps('llm')) expect(typeof s.check).toBe('function');
  });
});

describe('LlmCandidatesStep (#4196)', () => {
  it('adds two candidates (same connector, two models), saves them and reads them back', async () => {
    const root = ws();
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LlmCandidatesStep {...props(root, results)} listConnectors={lister} />);
    await tick();
    expect(r.lastFrame()).toContain('No candidates yet.');
    expectLayout(r.lastFrame() ?? '');
    for (const model of ['1', '2']) {
      // #4254: "Add a candidate" is a list entry (no letter A); after the first add it sits below the new candidate.
      if (model === '2') { r.stdin.write('\u001B[B'); await tick(); }
      expect(r.lastFrame()).toContain('Enter add');
      r.stdin.write('\r'); await tick();
      expect(r.lastFrame()).toContain('Alpha Gateway (alpha)');
      expect(r.lastFrame()).toContain('Beta Gateway (beta), credential missing');
      r.stdin.write('1'); await tick();
      expect(r.lastFrame()).toContain('a-1 (default)');
      r.stdin.write(model); await tick();
    }
    expect(r.lastFrame()).toMatch(/alpha\s+a-1, credential stored/);
    expect(r.lastFrame()).toMatch(/alpha\s+a-2, credential stored/);
    expectLayout(r.lastFrame() ?? '');
    expect(r.lastFrame()).toContain('Enter save'); // the new candidate is highlighted
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'done', summary: '2 candidates: alpha, alpha' }]);
    expect(readLlmDefaults(root).candidates).toEqual([{ connector: 'alpha', model: 'a-1' }, { connector: 'alpha', model: 'a-2' }]);
    r.unmount();
  });

  it('refuses to save a single candidate', async () => {
    const root = ws();
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LlmCandidatesStep {...props(root, results)} listConnectors={lister} />);
    await tick();
    r.stdin.write('\r'); await tick(); r.stdin.write('1'); await tick(); r.stdin.write('1'); await tick();
    r.stdin.write('\r'); await tick();
    expect(r.lastFrame()).toContain('Choose at least 2 candidates.');
    expect(results).toEqual([]);
    r.unmount();
  });

  it('re-entry preselects the stored candidates; a candidate without a key gets the credentials screen', async () => {
    const root = ws();
    writeAssessmentLlm(root, { candidates: [{ connector: 'alpha', model: 'a-1' }, { connector: 'beta', model: 'b-1' }] });
    const asked: string[] = [];
    // Stand-in for the workspace credentials screen: records the provider and continues on Enter.
    const FakeCreds = (({ provider, onNext }: { provider: string; onNext: () => void }) => {
      useInput((_i, key) => { if (key.return) { asked.push(provider); onNext(); } });
      return <Text>Credentials for {provider}</Text>;
    }) as unknown as Parameters<typeof LlmCandidatesStep>[0]['credentialsStep'];
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LlmCandidatesStep {...props(root, results)} listConnectors={lister} credentialsStep={FakeCreds} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toMatch(/alpha\s+a-1, credential stored/);
    expect(frame).toMatch(/beta\s+b-1, credential missing, asked on save/);
    r.stdin.write(String.fromCharCode(27) + '[B'); await tick(); // #4494: from the keep entry (stored candidates) Down wraps to the first candidate
    r.stdin.write('\r'); await tick(); // Enter on a candidate saves
    expect(r.lastFrame()).toContain('Credentials for gw:beta');
    r.stdin.write('\r'); await tick();
    expect(asked).toEqual(['gw:beta']);
    expect(results).toEqual([{ status: 'done', summary: '2 candidates: alpha, beta' }]);
    r.unmount();
  });

  it('#4341: the keep entry (last in the list, not Esc) keeps the stored candidates unchanged', async () => {
    const root = ws();
    writeAssessmentLlm(root, { candidates: [{ connector: 'alpha', model: 'a-1' }, { connector: 'alpha', model: 'a-2' }] });
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LlmCandidatesStep {...props(root, results)} listConnectors={lister} />);
    await tick();
    r.stdin.write(String.fromCharCode(27) + '[B'); await tick(); // #4494: from the keep entry Down wraps to the first candidate
    r.stdin.write('d'); await tick();
    r.stdin.write('\x1b'); await tick(80);
    expect(results).toEqual([]); // Esc belongs to the wizard
    expect(r.lastFrame()).toContain('Keep the stored candidates and continue');
    r.stdin.write('\u001B[A'); await tick(); // Up wraps to the last entry: keep
    // #4254: on the keep entry the hint is "Enter next", not "Enter save", and D is not named.
    expect(r.lastFrame()).toContain('Enter next');
    expect(r.lastFrame()).not.toContain('Enter save');
    expect(r.lastFrame()).not.toContain('D remove');
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'kept', summary: '2 candidates: alpha, alpha' }]);
    expect(readLlmDefaults(root).candidates).toHaveLength(2);
    r.unmount();
  });
});

describe('LlmSubjectStep (#4196, Q-05)', () => {
  it('without a completed Application run points to the Application Assessment and writes nothing', async () => {
    const root = ws();
    writeRun(root, 'draft', false);
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LlmSubjectStep {...props(root, results)} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('No app is ready for the LLM Assessment.');
    expect(frame).toContain('Set up the Application Assessment, run it once');
    expect(frame).toContain('no completed Application Assessment run');
    expectLayout(frame);
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'skipped', summary: 'No app with a completed Application Assessment' }]);
    expect(readLlmDefaults(root).subjectApp).toBeUndefined();
    r.unmount();
  });

  it('preselects the single eligible app and stores it as assessment.llm.subject_app', async () => {
    const root = ws();
    writeRun(root, 'shop', true);
    writeRun(root, 'draft', false);
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LlmSubjectStep {...props(root, results)} />);
    await tick();
    expect(r.lastFrame()).toContain(`${CURSOR_MARKER}[ok]`);
    expect(r.lastFrame()).toContain('shop');
    expectLayout(r.lastFrame() ?? '');
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'done', summary: 'Assessed app: shop' }]);
    expect(readLlmDefaults(root).subjectApp).toBe('shop');
    r.unmount();
  });

  it('re-entry with the stored subject: Enter keeps it', async () => {
    const root = ws();
    writeRun(root, 'shop', true);
    writeRun(root, 'other', true);
    writeAssessmentLlm(root, { subjectApp: 'shop' });
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LlmSubjectStep {...props(root, results)} />);
    await tick();
    expect(r.lastFrame()).toContain('current, last completed run');
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'kept', summary: 'Assessed app: shop' }]);
    r.unmount();
  });
});

describe('Esc ownership (#4341): neither Subject nor Candidates captures Esc; keep is a list entry', () => {
  it('Subject and Candidates never call setEscapeCaptured', async () => {
    const root = ws();
    const none: boolean[] = [];
    const c = render(<LlmCandidatesStep {...props(root, [])} setEscapeCaptured={(x) => none.push(x)} listConnectors={lister} />);
    await tick();
    c.unmount();
    const s = render(<LlmSubjectStep {...props(root, [])} setEscapeCaptured={(x) => none.push(x)} />);
    await tick();
    s.unmount();
    await tick();
    expect(none).toEqual([]);
  });

  it('Subject: Esc keeps nothing; the last entry keeps the stored subject (#4341)', async () => {
    const root = ws();
    writeRun(root, 'shop', true);
    writeRun(root, 'other', true);
    writeAssessmentLlm(root, { subjectApp: 'other' });
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LlmSubjectStep {...props(root, results)} />);
    await tick();
    expect(r.lastFrame()).toContain('Keep other and continue');
    r.stdin.write('\x1b'); await tick(80);
    expect(results).toEqual([]);
    r.stdin.write('3'); await tick();
    expect(results).toEqual([{ status: 'kept', summary: 'Assessed app: other' }]);
    r.unmount();
  });
});
