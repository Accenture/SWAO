// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, one left margin in LZ Connections and the type list (#4254)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4254 (TUI-10, Design 126 section 3 margin, audit A-03): one left margin for
// all blocks; list rows indent two columns under their label, as SelectInput
// rows do; a long row wraps under its own text, never back to column 0.
//
// LM-01 registered landing zones: label at the margin, landing zone rows at +2,
//       scope rows at +4 with the scope id in its own column
// LM-02 a long scope line wraps under its text (hanging indent) at 80 columns
// LM-03 the type list rows sit at +2 under their label in the numbered
//       SelectInput geometry ("1  Application Assessment"), the state word kept

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from '@swao/core';

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return { ...original, LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'community', valid: true, assessmentCount: 0, firstRun: '' } })) } };
});

import { providerLabel } from '@swao/core';
import { LzConnectionsScreen, lzListDetail, scopeIdWidth, LZ_LIST_INDENT, type ConnectionDriverInfo, type ConnectionsCliRunner } from '../LzConnectionsScreen.js';
import { SCOPE_KIND_DEFINITIONS } from '../lz-connections-flow.js';
import { TypeSelectionStep, typeRowNumber } from '../../../setup/TypeSelectionStep.js';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';
import { headerRuleWidth } from '@swao/tui-kit';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function dir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}

const NL = String.fromCharCode(10);
const LONG_REGIONS = ['eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'eu-south-1', 'eu-south-2', 'eu-central-2'];
const REGISTERED = [
  'name: demo', 'landing_zones:', '  - id: aws-demo', '    provider: aws', '    scopes:',
  '      - id: platform', '        kind: platform', '        auth: session-keys', `        regions: [${LONG_REGIONS.join(', ')}]`,
  '      - id: app-1', '        kind: application', '        auth: session-keys', '',
].join(NL);

const DRIVERS: ConnectionDriverInfo[] = [
  { provider: 'aws', authMethods: [{ id: 'session-keys', required: ['access-key-id', 'secret-access-key'], optional: [], unattended: true }] },
];
const run: ConnectionsCliRunner = async () => 0;
const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

function workspace(): string {
  const d = dir('swao-lzm-');
  writeFileSync(join(d, '.swao.yml'), REGISTERED);
  return d;
}

const indentOf = (l: string): number => l.length - l.trimStart().length;

describe('LZ Connections, one left margin (#4254)', () => {
  it('LM-01 label at the margin, landing zone rows at +2, scope rows at +4', async () => {
    const r = renderAt(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace()} run={run} store={new CredentialStore(dir('swao-lzm-vault-'))} drivers={DRIVERS} />, 100, 60);
    await settle();
    const lines = r.lines();
    r.unmount();
    const label = lines.findIndex((l) => l.startsWith('Registered landing zones:'));
    expect(label).toBeGreaterThanOrEqual(0);
    const lz = lines[label + 1]!;
    expect(lz.trimStart().startsWith('aws-demo')).toBe(true);
    expect(indentOf(lz)).toBe(LZ_LIST_INDENT);
    const scope = lines.find((l) => l.trimStart().startsWith('app-1'))!;
    expect(indentOf(scope)).toBe(2 * LZ_LIST_INDENT);
    // The text column of both scopes starts at the same column (scope id column).
    const platform = lines.find((l) => l.trimStart().startsWith('platform'))!;
    expect(platform.indexOf('Platform landing zone')).toBe(scope.indexOf('Application landing zone'));
  });

  it('LM-02 a long scope line wraps under its own text at 80 columns', async () => {
    const r = renderAt(<LzConnectionsScreen onBack={vi.fn()} workspace={workspace()} run={run} store={new CredentialStore(dir('swao-lzm-vault-'))} drivers={DRIVERS} />, 80, 60);
    await settle();
    const lines = r.lines().map((l) => l.trimEnd());
    r.unmount();
    expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(80));
    const first = lines.findIndex((l) => l.trimStart().startsWith('platform'));
    const textCol = lines[first]!.indexOf('Platform landing zone');
    const next = lines[first + 1]!;
    expect(next.trimStart().startsWith('app-1')).toBe(false);
    expect(indentOf(next)).toBe(textCol);
  });

  it('helpers: the landing zone detail and the scope id column', () => {
    expect(lzListDetail({ provider: 'aws', display: 'Prod', driverAvailable: false })).toContain('; Prod, no live driver in this build');
    expect(scopeIdWidth([{ id: 'platform' }, { id: 'app-1' }])).toBe(8);
    // #4496: the default display name (the full provider name) is not repeated after the label.
    for (const p of ['aws', 'stackit', 'otc']) {
      const d = lzListDetail({ provider: p, display: providerLabel(p, 'full'), driverAvailable: true });
      expect(d).toBe(providerLabel(p));
      expect(d).not.toContain(';');
    }
    expect(scopeIdWidth([])).toBe(0);
  });
});

describe('Type list rows in the SelectInput geometry (#4254)', () => {
  it('LM-03 rows at +2 under the label, marker and number as a numbered SelectInput', async () => {
    expect(typeRowNumber(0)).toBe('1  ');
    expect(typeRowNumber(4)).toBe('5  ');
    const r = renderAt(<TypeSelectionStep tier="community" initial={['application']} states={{ application: 'ready' }} onNext={() => {}} />, 80, 40);
    await settle(60);
    const lines = r.lines().map((l) => l.trimEnd());
    r.unmount();
    const label = lines.findIndex((l) => l.startsWith('Assessment types:'));
    expect(label).toBeGreaterThanOrEqual(0);
    const row = lines[label + 1]!;
    expect(row).toContain('1  [x] Application Assessment  (ready)');
    // marker column at +2, as SelectInput rows (PICKER_ROW_INDENT)
    expect(lines[label + 2]!.startsWith('    2  [ ] Service Portfolio Assessment')).toBe(true);
    expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(80));
  });
});

// #4257 (Design 126 section 4.2, gate G-02): the sub-step lists of LZ
// Connections are the central SelectInput: label with one colon at the
// margin, rows at +2 with the one central marker, the detail as the second
// column, every line within the header rule at 100 and 80 columns.
describe('LZ Connections sub-step pickers on SelectInput (#4257)', () => {
  for (const columns of [100, 80]) {
    it(`LM-04 provider, landing zone, kind and auth pickers at ${columns} columns`, async () => {
      const r = renderAt(<LzConnectionsScreen onBack={() => {}} workspace={workspace()} run={run} store={new CredentialStore(dir('swao-lzm-vault-'))} drivers={DRIVERS} />, columns, 40);
      await settle(250);
      const marker = String.fromCodePoint(0x276f);
      const check = (label: string, row: string): void => {
        const lines = r.lines().map((l) => l.trimEnd());
        const at = lines.findIndex((l) => l.startsWith(`${label}:`));
        expect(at, label).toBeGreaterThanOrEqual(0);
        expect(lines[at + 1]!.startsWith(`  ${marker} ${row}`), lines[at + 1]).toBe(true);
        expect(lines.filter((l) => l.includes(marker))).toHaveLength(1);
        expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(columns));
      };
      r.stdin.write('1'); await settle(); // Add landing zone
      check('Provider of the landing zone', 'AWS');
      r.stdin.write('\u001B'); await settle(); // Esc cancels the form
      r.stdin.write('2'); await settle(); // Add scope
      check('Landing zone', 'aws-demo');
      r.stdin.write('\r'); await settle();
      const kinds = r.lines().join(NL);
      expect(kinds).toContain('Scope kind:');
      expect(kinds).toContain('Application landing zone (ALZ)');
      // The definition of the highlighted kind is shown in full under the list, never cut.
      const flat = r.lines().join(' ').replace(/\s+/g, ' ');
      expect(flat).toContain(SCOPE_KIND_DEFINITIONS.application);
      r.stdin.write('\r'); await settle();
      check('Auth method', 'session-keys');
      r.unmount();
    });
  }
});
