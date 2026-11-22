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

// #4296: LZ Catalog Setup rows. Catalogues: one row per catalogue with the
// provider abbreviation and full name and the quality state as a StatusLabel
// (green ok, yellow warn, red fail with the rule ids); origin and date move to
// the guidance box, which follows the highlighted catalogue. Targets: rows
// `[ ] OTC  T Cloud Public`; the confirmation shows `OTC, T Cloud Public:
// germany` on the Design 126 frame with key hints and a guidance box.
// Rendered at 100 and 80 columns.

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { render } from 'ink';
import { STATUS_MAP, headerRuleWidth } from '@swao/tui-kit';
import { ellipsisOffenders } from '../../__tests__/helpers/width-rule.js';
import type { LzCatalogueListing, LzCatalogueQualityFinding, LzGeographyRegion } from '@swao/module-landing-zone';
import type { SetupStepProps, SetupStepResult } from '../types.js';
import type { LzCatalogSources, LzCatalogueRow } from './lz-catalog-checks.js';
import { LzCatalogCataloguesStep, LzCatalogRefreshStep, LzCatalogTargetsStep, catalogueGuidance, catalogueStatus, targetLabel } from './lz-catalog.js';

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  constructor(readonly columns: number, readonly rows: number) { super(); }
  write = (frame: string): boolean => { this.frames.push(frame); return true; };
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write = (data: string): void => { this.data = data; this.emit('readable'); this.emit('data', data); };
  read = (): string | null => { const d = this.data; this.data = null; return d; };
  setEncoding(): void { /* not needed */ }
  setRawMode(): void { /* not needed */ }
  resume(): void { /* not needed */ }
  pause(): void { /* not needed */ }
  ref(): void { /* not needed */ }
  unref(): void { /* not needed */ }
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line no-control-regex
const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');
const DOWN = '\u001B[B';
const CTRL_G = '\u0007';

interface Mounted { lines: () => string[]; write: (s: string) => Promise<void>; unmount: () => void }

function mount(el: React.ReactElement, columns: number): Mounted {
  const stdout = new FakeStdout(columns, 60);
  const stdin = new FakeStdin();
  const inst = render(el, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns, 60) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  return {
    lines: () => plain(stdout.frames[stdout.frames.length - 1] ?? '').split('\n'),
    write: async (s: string) => { stdin.write(s); await settle(); },
    unmount: () => inst.unmount(),
  };
}

const NOW = new Date('2026-11-10T00:00:00Z');

function entry(provider: string, provenance: LzCatalogueListing['provenance'], lastUpdated: string, name: string): LzCatalogueListing {
  return {
    provider, file: `${provider}.json`, path: `/x/${provider}.json`, provenance,
    name: `${name} service catalogue`, short_description: name,
    last_updated: lastUpdated, source: 'api', confidence: 'high', regions_count: 4,
  };
}

const finding = (rule: LzCatalogueQualityFinding['rule'], severity: LzCatalogueQualityFinding['severity'], provider: string): LzCatalogueQualityFinding =>
  ({ rule, severity, file: `${provider}.json`, provider, message: `${rule} in ${provider}` });

const SOURCES: LzCatalogSources = {
  now: NOW,
  list: () => [
    entry('otc', 'bundled', '2026-11-01', 'T Cloud Public'),
    entry('aws-iso-e', 'bundled', '2026-11-01', 'AWS ISOE Europe (classified)'),
    entry('gcp', 'workspace', '2026-11-01', 'GCP'),
    entry('azure', 'bundled', '2026-11-01', 'Azure'),
  ],
  bundledProviders: () => ['otc', 'aws-iso-e', 'gcp', 'azure'],
  quality: () => new Map([
    ['workspace:gcp', [finding('facts-unsourced', 'warn', 'gcp')]],
    ['bundled:azure', [finding('pin-drift', 'error', 'azure')]],
  ]),
};

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ws(yml = 'engagement:\n  name: fixture\n'): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-4296-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), yml, 'utf-8');
  return d;
}

function props(workspaceRoot: string, results: Array<SetupStepResult | undefined>): SetupStepProps {
  return {
    ctx: { workspaceRoot, tier: 'consultant', scope: 'lz-catalog', scopeLabel: 'Landing Zone Catalog Assessment', session: {} as SetupStepProps['ctx']['session'] },
    stepNumber: 1,
    stepCount: 5,
    onNext: (r) => results.push(r),
    updateSession: () => {},
    setEscapeCaptured: () => {},
    setGuidanceOpen: () => {},
  };
}

/** Every line within the header rule, no double hyphen, no ellipsis (strict since 2026-11-13, #4213). */
function expectWithin(lines: string[], columns: number): void {
  const width = headerRuleWidth(columns);
  for (const line of lines) {
    expect(line.trimEnd().length).toBeLessThanOrEqual(width);
    expect(line).not.toContain('--');
  }
  // #4213 G-08: no ellipsis outside a path or the collapsed guidance box.
  expect(ellipsisOffenders(lines, columns)).toEqual([]);
}

const row = (lines: string[], needle: string): string => lines.find((l) => l.includes(needle)) ?? '';

describe('catalogueStatus (#4296)', () => {
  const base: LzCatalogueRow = { provider: 'otc', origin: 'bundled', name: 'T Cloud Public', lastUpdated: '2026-11-01', ageDays: 9, stale: false, qualityErrors: 0, qualityWarnings: 0, qualityRules: [] };

  it('is ok and green without findings, warn and yellow with warnings or age, fail and red with errors', () => {
    expect(catalogueStatus(base)).toEqual({ level: 'ok', text: 'no quality findings' });
    expect(STATUS_MAP.ok.style.color).toBe('green');
    const warn = catalogueStatus({ ...base, qualityWarnings: 1, qualityRules: ['facts-unsourced'] });
    expect(warn).toEqual({ level: 'warn', text: '1 warning(s): facts-unsourced' });
    expect(STATUS_MAP.warn.style.color).toBe('yellow');
    expect(catalogueStatus({ ...base, stale: true, ageDays: 120 }, 90)).toEqual({ level: 'warn', text: 'older than 90 days' });
    const fail = catalogueStatus({ ...base, qualityErrors: 1, qualityWarnings: 1, qualityRules: ['pin-drift', 'stale'] });
    expect(fail).toEqual({ level: 'fail', text: '1 error(s), 1 warning(s): pin-drift, stale' });
    expect(STATUS_MAP.fail.style.color).toBe('red');
    expect(catalogueStatus({ ...base, error: 'meta block: name: Required' }).level).toBe('fail');
  });

  it('puts provider, origin in words, date, confidence, regions, quality and update into the guidance', () => {
    const g = catalogueGuidance({ ...base, confidence: 'high', regionsCount: 4 }, true);
    expect(g.what.startsWith('T Cloud Public:')).toBe(true);
    const text = (g.sections ?? []).map((s) => `${s.label}: ${s.text}`);
    expect(text).toContain('Provider: OTC, T Cloud Public');
    expect(text.find((t) => t.startsWith('Origin:'))).toContain('bundled, shipped with SWAO');
    expect(text).toContain('Last update: 2026-11-01, 9 day(s) ago.');
    expect(text).toContain('Confidence: high');
    expect(text).toContain('Regions: 4');
    expect(text.find((t) => t.startsWith('Update:'))).toContain('Tools, Update LZ Catalogue');
    expect(catalogueGuidance({ ...base, origin: 'user-defined' }, true).sections?.find((s) => s.label === 'Update')?.text).toContain('maintained by hand');
    expect(catalogueGuidance(base, false).sections?.find((s) => s.label === 'Update')?.text).toContain('Consultant or Enterprise licence');
  });
});

describe('targetLabel (#4296)', () => {
  it('reads OTC, T Cloud Public: germany and keeps a bare provider', () => {
    expect(targetLabel('otc:germany')).toBe('OTC, T Cloud Public: germany');
    expect(targetLabel('stackit:eu01')).toBe('STACKIT: eu01');
    expect(targetLabel('otc')).toBe('OTC, T Cloud Public');
  });
});

for (const columns of [100, 80]) {
  describe(`LZ Catalog Setup rows at ${columns} columns (#4296)`, () => {
    it('Catalogues: abbreviation, full name and the quality state; no origin or date in the row', async () => {
      const m = mount(<LzCatalogCataloguesStep {...props('/ws', [])} sources={SOURCES} />, columns);
      await settle();
      const lines = m.lines();
      const otc = row(lines, 'T Cloud Public');
      // #4254 (run 9): central StatusRows, status column first (Design 126 M-06).
      expect(otc).toMatch(/\[ok\] +OTC +T Cloud Public +no quality findings/);
      expect(row(lines, 'Google Cloud Platform')).toMatch(/\[warn\] +GCP +Google Cloud Platform +1 warning\(s\)/);
      expect(row(lines, 'Microsoft Azure')).toMatch(/\[fail\] +Azure +Microsoft Azure +1 error\(s\),/);
      // A long text wraps under its column; nothing is cut.
      const words = lines.slice(0, lines.findIndex((l) => l.includes('Esc abort'))).join(' ').replace(/\s+/g, ' ');
      expect(words).toContain('facts-unsourced');
      expect(words).toContain('pin-drift');
      expect(words).not.toContain('...');
      expect(row(lines, 'AWS ISO-E Europe (classified)')).toContain('[ok]');
      // The status column is aligned.
      expect(otc.indexOf('[ok]')).toBe(row(lines, 'AWS ISO-E Europe').indexOf('[ok]'));
      for (const l of lines.filter((x) => x.includes('['))) {
        expect(l).not.toContain('workspace copy');
        expect(l).not.toContain('2026-11-01');
      }
      expectWithin(lines, columns);
      m.unmount();
    });

    it('Catalogues: the guidance box follows the highlighted catalogue and carries origin and date', async () => {
      const m = mount(<LzCatalogCataloguesStep {...props('/ws', [])} sources={SOURCES} />, columns);
      await settle();
      expect(m.lines().join('\n')).toContain('T Cloud Public: the catalogue');
      await m.write(DOWN);
      await m.write(DOWN);
      expect(m.lines().join('\n')).toContain('Google Cloud Platform: the catalogue');
      await m.write(CTRL_G);
      const open = m.lines().join(' ').replace(/[│]/g, ' ').replace(/\s+/g, ' ');
      expect(open).toContain('Origin: workspace copy');
      expect(open).toContain('Last update: 2026-11-01, 9 day(s) ago.');
      expect(open).not.toMatch(/Sections \d+ to \d+ of/);
      expectWithin(m.lines(), columns);
      m.unmount();
    });

    it('Targets: rows show abbreviation and full name; the confirmation reads OTC, T Cloud Public: germany with key hints and a guidance box', async () => {
      const d = ws();
      const regions: Record<string, LzGeographyRegion[]> = { otc: [{ id: 'eu-de', sovereignty: { residency_country: 'DE' } }] };
      const results: Array<SetupStepResult | undefined> = [];
      const m = mount(
        <LzCatalogTargetsStep {...props(d, results)} listProviders={() => ['aws', 'otc', 'stackit']} loadRegions={(p) => regions[p] ?? []} />,
        columns,
      );
      await settle();
      let lines = m.lines();
      expect(row(lines, 'Amazon Web Services')).toMatch(/\[ \] AWS +Amazon Web Services/);
      expect(row(lines, 'T Cloud Public')).toMatch(/\[ \] OTC +T Cloud Public/);
      expect(row(lines, 'STACKIT')).toMatch(/\[ \] STACKIT +STACKIT Cloud, Schwarz Digits\s*$/);
      expectWithin(lines, columns);
      await m.write(DOWN);
      await m.write(' ');
      await m.write('\r');
      expect(m.lines().join('\n')).toContain('Provider 1 of 1: OTC, T Cloud Public.');
      await m.write('\r');
      lines = m.lines();
      const text = lines.join('\n');
      expect(text).toContain('Targets saved in the workspace .swao.yml:');
      expect(text).toMatch(/OTC, T Cloud Public: (germany|eu-de|europe)/i);
      expect(text).toContain('Enter confirm');
      expect(text).toContain('Targets saved');
      expect(text).toContain('Ctrl+G');
      expectWithin(lines, columns);
      m.unmount();
    });
  });
}

// #4254 criterion 5 (Design 126 section 10): the Refresh step at 100 and 80
// columns, with stale catalogues (the list, the update note) and without.
const STALE_SOURCES: LzCatalogSources = {
  ...SOURCES,
  list: () => [
    entry('otc', 'bundled', '2025-01-01', 'T Cloud Public'),
    entry('aws-iso-e', 'workspace', '2025-02-01', 'AWS ISOE Europe (classified)'),
    entry('gcp', 'bundled', '2026-11-01', 'GCP'),
  ],
};

for (const columns of [100, 80]) {
  describe(`LZ Catalog Refresh step at ${columns} columns (#4254)`, () => {
    it('stale catalogues: title, the list with provider names, the update note; within the header rule', async () => {
      const m = mount(<LzCatalogRefreshStep {...props('/ws', [])} sources={STALE_SOURCES} />, columns);
      await settle();
      const lines = m.lines();
      const text = lines.join('\n');
      expect(text).toContain('Refresh');
      expect(text).toMatch(/Older than \d+ days:/);
      expect(row(lines, 'T Cloud Public')).toContain('2025-01-01');
      expect(row(lines, 'AWS ISO-E Europe')).toContain('2025-02-01');
      expect(text).not.toContain('Google Cloud Platform');
      expect(text).toContain('Update them after setup');
      expect(text).toContain('Ctrl+G');
      expectWithin(lines, columns);
      m.unmount();
    });

    it('no stale catalogue: one ok line; Enter continues', async () => {
      const results: Array<SetupStepResult | undefined> = [];
      const m = mount(<LzCatalogRefreshStep {...props('/ws', results)} sources={SOURCES} />, columns);
      await settle();
      expect(m.lines().join('\n')).toContain('Every catalogue was updated within the last');
      expectWithin(m.lines(), columns);
      await m.write('\r');
      expect(results[0]?.status).toBe('kept');
      m.unmount();
    });
  });
}
