// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, the bounded and grouped app picker of Publish
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4239 (Design 126 sections 4.2 and 7.10): the Publish app picker is the
// central SelectInput with the bounded window ("more" markers), applications
// before the service apps, the subject app of the setup preselected and
// type-to-filter on the full list; 235 apps stay within the screen.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wsRef = vi.hoisted(() => ({ path: '' }));

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => wsRef.path),
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

import { PublishScreen, publishAppOptions } from '@swao/module-html-report';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function pressKey(stdin: { write: (s: string) => void }, key: string): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 60));
  stdin.write(key);
  await new Promise<void>((r) => setTimeout(r, 60));
}

async function frameWith(lastFrame: () => string | undefined, text: string): Promise<string> {
  for (let i = 0; i < 100 && !(lastFrame() ?? '').includes(text); i++) await new Promise<void>((r) => setTimeout(r, 50));
  return lastFrame() ?? '';
}

/** A workspace with `sovereign-health` (application, the subject app) and `services` service apps, each with a run folder. */
function workspace(services: number): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-publish-picker-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\nassessment:\n  subject_app: sovereign-health\n');
  const app = (id: string, yml: string): void => {
    mkdirSync(join(ws, 'apps', id, 'wsp', 'runs'), { recursive: true });
    writeFileSync(join(ws, 'apps', id, '.swao.yml'), yml);
  };
  app('sovereign-health', 'source:\n  path: ./src\n');
  for (let i = 1; i <= services; i++) app(`app${String(i).padStart(4, '0')}`, 'assessment:\n  type: service\n');
  // An app folder without a run is not offered.
  mkdirSync(join(ws, 'apps', 'no-run'), { recursive: true });
  return ws;
}

describe('Publish app picker (#4239)', () => {
  it('groups the apps by kind with a guidance entry each and marks the subject app', () => {
    const options = publishAppOptions([{ id: 'web', kind: 'application' }, { id: 'app0001', kind: 'service' }], 'web');
    expect(options.map((o) => o.group)).toEqual(['Applications', 'Service apps']);
    expect(options[0]?.guidance?.sections?.map((x) => x.label)).toEqual(['Preselected']);
    expect(options[1]?.guidance?.what).toContain('service app');
  });

  it('235 apps: bounded window with "more", applications first, the subject app preselected, hints and guidance on screen', async () => {
    wsRef.path = workspace(234);
    const { lastFrame, stdin } = render(<PublishScreen onBack={vi.fn()} version="0.0.0-test" />);
    await frameWith(lastFrame, 'Single-Page HTML Report');
    await pressKey(stdin, '1');
    const text = await frameWith(lastFrame, 'Service apps');
    const lines = text.split('\n');
    expect(lines.length).toBeLessThanOrEqual(40);
    expect(text).toContain('Applications');
    expect(text).toContain('❯ sovereign-health');
    expect(text).toContain('more');
    expect(text).not.toContain('app0234');
    expect(text).not.toContain('no-run');
    expect(text).toContain('Tab select all apps');
    expect(text).toContain('Ctrl+G');
    expect(text).not.toMatch(/ -- |\|/);
  }, 30_000);

  it('type-to-filter narrows the full list and Enter picks the match', async () => {
    wsRef.path = workspace(234);
    const { lastFrame, stdin } = render(<PublishScreen onBack={vi.fn()} version="0.0.0-test" />);
    await frameWith(lastFrame, 'Single-Page HTML Report');
    await pressKey(stdin, '1');
    await frameWith(lastFrame, 'Service apps');
    for (const ch of 'app0200') await pressKey(stdin, ch);
    expect(await frameWith(lastFrame, '1 of 235')).toContain('app0200');
    await pressKey(stdin, '\r');
    expect(await frameWith(lastFrame, 'Evidence base URL')).toContain('Evidence base URL');
  }, 60_000);
});
