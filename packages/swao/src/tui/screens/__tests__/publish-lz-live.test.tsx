// #3589: Publish HTML > "Landing Zone Live View (lz-live)" (Design 120
// section 14.2). Real temporary workspace; the CLI is mocked at
// child_process. Pins the mode label, the Consultant gate, the registered
// landing zone picker and the argv `swao publish --lz-live <lz-id>`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { EventEmitter } from 'events';
import * as cp from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ root: null as string | null, tier: 'consultant' as 'community' | 'consultant' }));

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => h.root),
    LicenseGuard: { load: vi.fn(() => ({ state: { tier: h.tier, valid: true, assessmentCount: 0, firstRun: '2026-01-01', fingerprint: 'abc' } })) },
  };
});
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return { ...original, spawn: vi.fn() };
});

import { PublishScreen } from '@swao/module-html-report';

const spawned: string[][] = [];
beforeEach(() => {
  spawned.length = 0;
  vi.mocked(cp.spawn).mockImplementation(((_bin: string, argv: string[]) => {
    spawned.push(argv.slice(argv.indexOf('publish')));
    return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
  }) as unknown as typeof cp.spawn);
});
const tmp: string[] = [];
afterEach(() => { h.root = null; h.tier = 'consultant'; for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function workspace(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-pub-lzl-'));
  tmp.push(d);
  writeFileSync(join(d, '.swao.yml'), [
    'name: demo', 'landing_zones:',
    '  - id: otc-prod', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token',
    '  - id: aws-demo', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys', '',
  ].join('\n'));
  const run = join(d, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-03T08-00-00');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'lz-live-merged.yaml'), 'lz_id: otc-prod\n');
  h.root = d;
  return d;
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('PublishScreen, Landing Zone Live View (#3589)', () => {
  it('lists the mode with a plain description; the CLI form is in the guidance box (#4122)', async () => {
    workspace();
    const { lastFrame, stdin } = render(<PublishScreen onBack={vi.fn()} version="0.0.0-test" />);
    // #4257: the central numbered menu row reads "3  Landing Zone Live View (lz-live)".
    expect(lastFrame()).toMatch(/3\s+Landing Zone Live View \(lz-live\)/);
    expect(lastFrame()).toContain('live landing zone view');
    expect(lastFrame()).not.toContain('swao publish --lz-live <lz-id>');
    await settle(100);
    stdin.write('\u001B[B'); await settle();
    stdin.write('\u001B[B'); await settle();
    stdin.write('\x07'); await settle();
    expect(lastFrame()).toContain('swao publish --lz-live <lz-id>');
  });

  it('picks a registered landing zone with a run and publishes it; one without a run is refused', async () => {
    workspace();
    const { lastFrame, stdin } = render(<PublishScreen onBack={vi.fn()} version="0.0.0-test" />);
    await settle(100);
    stdin.write('3'); await settle();
    expect(lastFrame()).toContain('Landing zone to publish');
    expect(lastFrame()).toContain('otc-prod');
    expect(lastFrame()).toContain('run 2026-11-03T08-00-00');
    expect(lastFrame()).toContain('no live run yet');
    stdin.write('2'); await settle();
    expect(lastFrame()).toContain('Landing zone aws-demo has no live run yet');
    expect(spawned).toHaveLength(0);
    stdin.write('1'); await settle(100);
    expect(spawned[0]).toEqual(['publish', '--lz-live', 'otc-prod']);
  });

  it('Community: the mode is Consultant-gated', async () => {
    workspace();
    h.tier = 'community';
    const { lastFrame, stdin } = render(<PublishScreen onBack={vi.fn()} version="0.0.0-test" />);
    await settle(100);
    stdin.write('3'); await settle();
    expect((lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('requires a Consultant or Enterprise licence');
    expect(spawned).toHaveLength(0);
  });
});
