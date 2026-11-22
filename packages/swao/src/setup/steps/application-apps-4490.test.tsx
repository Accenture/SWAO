// #4490 (Design 126 section 7.13): the Application Assessment and LLM setup
// steps work on the application apps only; the service apps are counted in a
// note. Long result lists page and filter (the central SelectInput).

import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, type VcsAuthProbeResult } from '@swao/core';
import { ApplicationAppStep } from './ApplicationAppStep.js';
import { ApplicationSourceStep, SOURCE_ROWS_MAX, type ApplicationSourceDeps } from './ApplicationSourceStep.js';
import { LlmSubjectStep } from './LlmSubjectStep.js';
import { readApplicationDefaults } from '../defaults.js';
import { listSubjectApps } from '../llm-values.js';
import { readAppSources } from '../application-app.js';
import type { SetupStepProps, SetupStepResult } from '../types.js';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function waitFor(ok: () => boolean, timeoutMs = 10000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!ok() && Date.now() < until) await tick(20);
}
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A workspace with the given application apps and `services` service apps. */
function workspace(applications: string[], services: number): string {
  const root = mkdtempSync(join(tmpdir(), 'swao-4490-'));
  dirs.push(root);
  writeFileSync(join(root, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
  for (const id of applications) {
    mkdirSync(join(root, 'apps', id), { recursive: true });
    writeFileSync(join(root, 'apps', id, '.swao.yml'), 'source:\n  path: ./src\n', 'utf-8');
  }
  for (let i = 1; i <= services; i++) {
    const id = `agfa_svc${i}`;
    mkdirSync(join(root, 'apps', id), { recursive: true });
    writeFileSync(join(root, 'apps', id, '.swao.yml'), `app_name: Service ${i}\nassessment:\n  type: service\n`, 'utf-8');
  }
  return root;
}

function props(root: string, results: Array<SetupStepResult | undefined>): SetupStepProps {
  return {
    ctx: { workspaceRoot: root, tier: 'community', scope: 'application', scopeLabel: 'Application Assessment', session: {} as SetupStepProps['ctx']['session'] },
    stepNumber: 1,
    stepCount: 7,
    onNext: (r) => results.push(r),
    updateSession: () => undefined,
    setEscapeCaptured: () => undefined,
    setGuidanceOpen: () => undefined,
  };
}

describe('Application setup lists application apps only (#4490)', () => {
  it('readApplicationDefaults, the sources and the LLM subjects leave the service apps out', () => {
    const root = workspace(['sovereign-health'], 3);
    expect(readApplicationDefaults(root)).toMatchObject({ apps: ['sovereign-health'], serviceApps: 3 });
    expect(readAppSources(root).map((s) => s.appId)).toEqual(['sovereign-health']);
    expect(listSubjectApps(root).map((s) => s.appId)).toEqual(['sovereign-health']);
  });

  it('the App step names the application and the service-apps note; keep names the application only', async () => {
    const root = workspace(['sovereign-health'], 3);
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ApplicationAppStep {...props(root, results)} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('Applications in this workspace: sovereign-health');
    expect(frame).not.toContain('agfa_svc');
    expect(frame).toContain('3 service apps are not listed');
    r.stdin.write('\r');
    await waitFor(() => results.length > 0);
    expect(results).toEqual([{ status: 'kept', summary: 'App: sovereign-health' }]);
    r.unmount();
  });

  it('with service apps only, the App step offers Add an app first', async () => {
    const root = workspace([], 2);
    const r = render(<ApplicationAppStep {...props(root, [])} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).not.toContain('Keep the current apps');
    expect(frame.split('\n').find((l) => l.includes('Add an app'))).toContain('❯');
    expect(frame).toContain('2 service apps are not listed');
    r.unmount();
  });

  it('the LLM Subject step lists no service app and shows the note', async () => {
    const root = workspace(['sovereign-health'], 3);
    const r = render(<LlmSubjectStep {...props(root, [])} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('sovereign-health');
    expect(frame).not.toContain('agfa_svc');
    expect(frame).toContain('3 service apps are not listed');
    r.unmount();
  });
});

describe('Source Access results page and filter (#4490, #4492)', () => {
  it('more than SOURCE_ROWS_MAX application apps: a paged list with the filter; typing narrows it; service apps of the probe are dropped', async () => {
    const ids = Array.from({ length: SOURCE_ROWS_MAX + 12 }, (_, i) => `app-${String(i + 1).padStart(2, '0')}`);
    const root = workspace(ids, 2);
    const deps: ApplicationSourceDeps = {
      store: () => new CredentialStore(mkdtempSync(join(tmpdir(), 'swao-4490-vault-'))),
      probe: async (): Promise<VcsAuthProbeResult> => ({
        status: 'info',
        message: '',
        apps: [...ids, 'agfa_svc1'].map((id) => ({ app_id: id, vcs_url: null, host: null, outcome: 'no-vcs-config' as const, hint: '' })),
      }),
    };
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ApplicationSourceStep {...props(root, results)} deps={deps} />);
    await waitFor(() => (r.lastFrame() ?? '').includes('Type filter') || (r.lastFrame() ?? '').includes('Filter'));
    let frame = r.lastFrame() ?? '';
    expect(frame).toContain('app-01');
    expect(frame).not.toContain('app-20');
    expect(frame).not.toContain('agfa_svc1');
    expect(frame).toContain('Filter');
    for (const ch of 'app-17') { r.stdin.write(ch); await tick(40); }
    await waitFor(() => (r.lastFrame() ?? '').includes('1 of 22'));
    frame = r.lastFrame() ?? '';
    expect(frame).toContain('app-17');
    expect(frame).not.toContain('app-01');
    r.unmount();
  });
});

describe('Ready rows and the repository check skip the service apps (#4490)', () => {
  it('branchReadyItems of the Application branch and buildVcsAuthProbe name the application only', async () => {
    const { branchReadyItems } = await import('../branch-check.js');
    const { defaultSetupRegistry } = await import('../index.js');
    const { buildVcsAuthProbe } = await import('../../health-check/vcs-auth-probe.js');
    const root = workspace(['sovereign-health'], 3);
    const items = branchReadyItems(defaultSetupRegistry(), 'application', root, undefined);
    const text = items.map((i) => `${i.label} ${i.detail}`).join('\n');
    expect(text).toContain('sovereign-health');
    expect(text).not.toContain('agfa_svc');
    const probe = await buildVcsAuthProbe(root, new CredentialStore(mkdtempSync(join(tmpdir(), 'swao-4490-vault-'))));
    expect(probe.apps.map((a) => a.app_id)).toEqual(['sovereign-health']);
  });
});
