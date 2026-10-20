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

// #3306: Setup Wizard step that writes assessment.landing_zone.targets.
// Providers and regions are injected; the writer runs against a real
// workspace .swao.yml in a temp sandbox.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { load } from 'js-yaml';
import type { LzGeographyRegion } from '@swao/module-landing-zone';

vi.mock('../shared.js', () => ({
  _wizardGuidanceOpen: false,
  setWizardGuidanceOpen: vi.fn(),
}));

import { LzTargetsStep } from './LzTargetsStep.js';
import { writeLzTargetsToYaml, readWorkspaceLzTargets } from '../lz-targets-helpers.js';

const DOWN = '\u001B[B';
const ENTER = '\r';
const tick = () => new Promise((r) => setTimeout(r, 30));
async function press(stdin: { write: (s: string) => void }, key: string): Promise<void> {
  await tick();
  stdin.write(key);
  await tick();
}

const REGIONS: Record<string, LzGeographyRegion[]> = {
  azure: [
    { id: 'germanywestcentral', sovereignty: { residency_country: 'DE' }, services: [1, 2] },
    { id: 'westeurope', sovereignty: { residency_country: 'NL' }, services: [1, 2, 3] },
    { id: 'eastus', sovereignty: { residency_country: 'US' }, services: [1] },
  ],
  stackit: [
    { id: 'eu01', sovereignty: { residency_country: 'DE' }, services: [1] },
  ],
};
const listProviders = () => ['azure', 'stackit'];
const loadRegions = (p: string) => REGIONS[p] ?? [];

const TEMPLATE = [
  '# SWAO workspace configuration',
  'engagement:',
  '  name: "Demo"  # engagement name',
  '',
  'providers:',
  '  llm:',
  '    primary:',
  '      type: anthropic',
  '      model: claude',
  '',
  '# LZ catalogue targets for every app (#3281); nest under assessment:',
  '#   landing_zone:',
  '#     targets: [stackit:eu01]',
  '',
].join('\n');

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'swao-wizard-lz-'));
  writeFileSync(join(ws, '.swao.yml'), TEMPLATE, 'utf-8');
});
afterEach(() => { rmSync(ws, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only deep access into parsed YAML
type Doc = Record<string, any>;
const yml = (): Doc => load(readFileSync(join(ws, '.swao.yml'), 'utf-8')) as Doc;

describe('LzTargetsStep (#3306)', () => {
  it('lists the catalogue providers and a Skip entry', () => {
    const { lastFrame, unmount } = render(
      <LzTargetsStep workDir={ws} onNext={() => {}} listProviders={listProviders} loadRegions={loadRegions} />,
    );
    const frame = lastFrame() ?? '';
    unmount();
    expect(frame).toContain('Landing Zone Targets');
    expect(frame).toContain('azure');
    expect(frame).toContain('stackit');
    expect(frame).toContain('Skip (configure later)');
  });

  it('offers resolving geographies with their default region, then the region ids', async () => {
    const { stdin, lastFrame, unmount } = render(
      <LzTargetsStep workDir={ws} onNext={() => {}} listProviders={listProviders} loadRegions={loadRegions} />,
    );
    await press(stdin, ENTER); // no provider ticked: the highlighted one (azure)
    const frame = lastFrame() ?? '';
    unmount();
    expect(frame).toContain('Provider 1 of 1');
    expect(frame).toContain('germany (geography, default region germanywestcentral)');
    expect(frame).toContain('europe (geography, default region germanywestcentral)');
    expect(frame).toContain('north-america (geography, default region eastus)');
    expect(frame).not.toContain('asia-pacific');
    expect(frame).toContain('westeurope (NL)');
  });

  it('writes a geography and a region for two providers to the workspace .swao.yml', async () => {
    const onNext = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <LzTargetsStep workDir={ws} onNext={onNext} listProviders={listProviders} loadRegions={loadRegions} />,
    );
    await press(stdin, ' ');      // tick azure
    await press(stdin, DOWN);
    await press(stdin, ' ');      // tick stackit
    await press(stdin, ENTER);
    // azure options: germany, eu, europe, north-america, then regions
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, ' ');      // tick europe
    await press(stdin, ENTER);
    // stackit options: germany, eu, europe, eu01; Enter without a tick picks the highlighted (germany)
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, ENTER);    // eu01
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Wrote assessment.landing_zone.targets');
    expect(frame).toContain('azure:europe');
    expect(frame).toContain('stackit:eu01');
    await press(stdin, ENTER);
    unmount();
    expect(onNext).toHaveBeenCalledWith(['azure:europe', 'stackit:eu01']);
    const doc = yml();
    expect(doc['assessment']['landing_zone']['targets']).toEqual(['azure:europe', 'stackit:eu01']);
    expect(doc['providers']['llm']['primary']['type']).toBe('anthropic');
    const text = readFileSync(join(ws, '.swao.yml'), 'utf-8');
    expect(text).toContain('# SWAO workspace configuration');
    expect(text).toContain('# engagement name');
  });

  it('S skips without touching .swao.yml', async () => {
    const onNext = vi.fn();
    const { stdin, unmount } = render(
      <LzTargetsStep workDir={ws} onNext={onNext} listProviders={listProviders} loadRegions={loadRegions} />,
    );
    await press(stdin, 's');
    unmount();
    expect(onNext).toHaveBeenCalledWith([]);
    expect(readFileSync(join(ws, '.swao.yml'), 'utf-8')).toBe(TEMPLATE);
  });

  it('Enter on the Skip row skips as well', async () => {
    const onNext = vi.fn();
    const { stdin, unmount } = render(
      <LzTargetsStep workDir={ws} onNext={onNext} listProviders={listProviders} loadRegions={loadRegions} />,
    );
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    unmount();
    expect(onNext).toHaveBeenCalledWith([]);
    expect(readFileSync(join(ws, '.swao.yml'), 'utf-8')).toBe(TEMPLATE);
  });

  it('pre-selects the configured targets (geography aliases included)', async () => {
    writeFileSync(join(ws, '.swao.yml'), TEMPLATE + 'assessment:\n  landing_zone:\n    targets: [azure:Europe]\n', 'utf-8');
    const onNext = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <LzTargetsStep workDir={ws} onNext={onNext} listProviders={listProviders} loadRegions={loadRegions} />,
    );
    expect(lastFrame() ?? '').toContain('Configured now: azure:Europe');
    expect(lastFrame() ?? '').toContain('[x] azure');
    await press(stdin, ENTER);
    expect(lastFrame() ?? '').toContain('[x] europe (geography');
    await press(stdin, ENTER);
    await press(stdin, ENTER);
    unmount();
    expect(onNext).toHaveBeenCalledWith(['azure:europe']);
  });

  it('without any catalogue, Enter continues and nothing is written', async () => {
    const onNext = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <LzTargetsStep workDir={ws} onNext={onNext} listProviders={() => []} loadRegions={loadRegions} />,
    );
    expect(lastFrame() ?? '').toContain('No landing zone catalogue found');
    await press(stdin, ENTER);
    unmount();
    expect(onNext).toHaveBeenCalledWith([]);
  });
});

describe('writeLzTargetsToYaml (#3306)', () => {
  it('appends an assessment block and keeps every comment', () => {
    expect(writeLzTargetsToYaml(ws, ['azure:germanywestcentral'])).toBe(true);
    const text = readFileSync(join(ws, '.swao.yml'), 'utf-8');
    expect(text.startsWith(TEMPLATE.trimEnd())).toBe(true);
    expect(yml()['assessment']).toEqual({ landing_zone: { targets: ['azure:germanywestcentral'] } });
    expect(readWorkspaceLzTargets(ws)).toEqual(['azure:germanywestcentral']);
  });

  it('replaces existing targets inside a live block and drops lz_cat_targets', () => {
    writeFileSync(join(ws, '.swao.yml'), TEMPLATE + [
      'assessment:',
      '  regimes_active:',
      '    - GDPR_DEMO',
      '  lz_cat_targets: "aws:eu-central-1"',
      '  landing_zone:',
      '    provider: azure  # Pass 23 reads this',
      '    targets:',
      '      - aws:eu-central-1',
      '      - stackit:eu01',
      '  vision_max_screens: 2',
      '',
    ].join('\n'), 'utf-8');
    writeLzTargetsToYaml(ws, ['azure:europe', 'azure:europe']);
    const doc = yml();
    expect(doc['assessment']).toEqual({
      regimes_active: ['GDPR_DEMO'],
      landing_zone: { provider: 'azure', targets: ['azure:europe'] },
      vision_max_screens: 2,
    });
    expect(readFileSync(join(ws, '.swao.yml'), 'utf-8')).toContain('# Pass 23 reads this');
  });

  it('keeps CRLF line endings', () => {
    writeFileSync(join(ws, '.swao.yml'), TEMPLATE.replace(/\n/g, '\r\n'), 'utf-8');
    writeLzTargetsToYaml(ws, ['stackit:eu01']);
    const text = readFileSync(join(ws, '.swao.yml'), 'utf-8');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(yml()['assessment']['landing_zone']['targets']).toEqual(['stackit:eu01']);
  });

  it('falls back to a parsed rewrite for a flow-style assessment', () => {
    writeFileSync(join(ws, '.swao.yml'), 'engagement:\n  name: Demo\nassessment: { regimes_active: [GDPR_DEMO] }\n', 'utf-8');
    writeLzTargetsToYaml(ws, ['stackit:eu01']);
    expect(yml()).toEqual({
      engagement: { name: 'Demo' },
      assessment: { regimes_active: ['GDPR_DEMO'], landing_zone: { targets: ['stackit:eu01'] } },
    });
  });

  it('returns false when the workspace has no .swao.yml', () => {
    rmSync(join(ws, '.swao.yml'));
    expect(writeLzTargetsToYaml(ws, ['stackit:eu01'])).toBe(false);
  });
});
