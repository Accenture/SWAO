// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, TUI-13 remaining screens at 100 and 80 columns (#4257)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4257 (TUI-13, Design 126 sections 3, 7 and 10), run 4: Generate Report,
// Lenses, Support Bundle, Update LLM Gateway, Upgrade prompt and Regime
// Selector on ScreenLayout, and the licence gate inside a host screen.
//
// RW-01 every line within headerRuleWidth(columns), guidance collapsed and expanded
// RW-02 the key hint line sits directly above the guidance box border
// RW-03 per-screen behaviour: keys per phase, numbered menus instead of letter
//       keys, no CLI text, no dash punctuation and no bracketed status literal
//       outside StatusRow on screen
//
// Generate TF (swao-premium) has its width case in the private
// header-width-wizard-enterprise.test.tsx (public sync excludes it).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';

const COMMUNITY = {
  state: {
    tier: 'community' as const, valid: true, remaining_assessments: 48, expiry: '2027-01-01',
    fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com',
    firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined,
  },
};

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    // No workspace: the screens show their no-workspace rows.
    findWorkspace: vi.fn(() => null),
    LicenseGuard: { load: vi.fn(() => COMMUNITY) },
  };
});

vi.mock('../../../license/license-guard.js', () => ({
  LicenseGuard: { load: vi.fn(() => COMMUNITY) },
}));

// A fake child for the spawning screens: it prints one line and exits 0.
const fakeSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawn: fakeSpawn };
});
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return { ...original, spawn: fakeSpawn };
});

vi.mock('../../../commands/lenses.js', () => ({
  listLenses: vi.fn(() => [
    { id: 'cloud-migration', passes: ['INV', 'STATE'], auto_frameworks: [] },
    { id: 'security-review', passes: ['CRYPTO', 'SBOM'], auto_frameworks: ['ISO_27001'] },
  ]),
  readWorkspaceLenses: vi.fn(() => []),
  writeWorkspaceLenses: vi.fn(),
}));

vi.mock('../../../compliance/regime-picker.js', () => ({
  loadAvailableRegimes: vi.fn(() => [
    { entry: { id: 'GDPR', name: 'General Data Protection Regulation' }, catalogPath: null },
    { entry: { id: 'DORA', name: 'Digital Operational Resilience Act' }, catalogPath: null },
  ]),
  readRegimesActive: vi.fn(() => []),
  writeRegimesActive: vi.fn(),
  regimePickerRow: vi.fn((r: { entry: { id: string; name: string } }) => ({ label: r.entry.name, value: r.entry.id, hinted: r.entry.id === 'GDPR' })),
}));

import { headerRuleWidth, formatKeyHints, KEY_HINTS, LICENSE_GATE_KEYS, LicenseGate, ScreenLayout, licenseGateGuidance, type KeyHint } from '@swao/tui-kit';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';
import { ReportScreen, reportKeys, reportFormatOptions } from '../ReportScreen.js';
import { LensesScreen, lensOptions, passUnion } from '../LensesScreen.js';
import { SupportBundleScreen, supportBundleKeys } from '../SupportBundleScreen.js';
import { LlmGatewayUpdateScreen, llmGatewayUpdateKeys } from '../LlmGatewayUpdateScreen.js';
import { UpgradePromptScreen } from '../UpgradePromptScreen.js';
import { RegimeSelectorScreen, regimeSelectorKeys } from '../RegimeSelectorScreen.js';

const noop = (): void => {};

async function settle(ms = 120): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

/** A fake child process: prints the lines and exits with `code`. */
function makeChild(lines: string[], code = 0): EventEmitter {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from(lines.join(String.fromCharCode(10)) + String.fromCharCode(10)));
    child.emit('close', code);
  }, 20);
  return child;
}

beforeEach(() => {
  fakeSpawn.mockReset();
  fakeSpawn.mockImplementation(() => makeChild(['[ok]  done']));
});
function GateHost(): JSX.Element {
  return (
    <ScreenLayout
      header={{ subtitle: 'Gate host', version: '0.0.0', licenseState: COMMUNITY.state }}
      title={{ title: 'Gate host' }}
      keys={LICENSE_GATE_KEYS}
      guidance={{ entry: licenseGateGuidance('consultant', 'Sample feature'), initiallyCollapsed: true }}
    >
      <LicenseGate required="consultant" state={COMMUNITY.state} feature="Sample feature" onOpenLicenseScreen={noop} onBack={noop}>
        <></>
      </LicenseGate>
    </ScreenLayout>
  );
}

/** The screens of this run: name, element, the hint line it shows first. */
const SCREENS: Array<[string, () => JSX.Element, readonly KeyHint[]]> = [
  ['Generate Report', () => <ReportScreen onBack={noop} onOpenLicense={noop} />, [{ key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }]],
  ['Lenses', () => <LensesScreen onBack={noop} onRunAssessment={noop} />, lensesPickKeys()],
  ['Support Bundle', () => <SupportBundleScreen onBack={noop} />, supportBundleKeys('confirm')],
  ['Update LLM Gateway (done)', () => <LlmGatewayUpdateScreen onBack={noop} />, llmGatewayUpdateKeys('done')],
  ['Upgrade prompt', () => <UpgradePromptScreen feature="Publish HTML" requiredTier="consultant" description="HTML publications of assessment runs" onBack={noop} onOpenLicenseScreen={noop} />, [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'back' }]],
  ['Regime Selector', () => <RegimeSelectorScreen workspacePath="/tmp/swao-rw-ws" onDone={noop} />, regimeSelectorKeys('pick')],
  ['Licence gate in a host screen', () => <GateHost />, LICENSE_GATE_KEYS],
];

function lensesPickKeys(): readonly KeyHint[] {
  return [{ key: '↑↓', verb: 'select' }, { key: 'Space', verb: 'toggle' }, { key: 'Enter', verb: 'save' }, { key: 'Esc', verb: 'back' }];
}

const NL = String.fromCharCode(10);
const DASHES = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]|\\s--\\s`);

describe('TUI-13 remaining screens at 100 and 80 columns (#4257, run 4)', () => {
  for (const columns of [100, 80]) {
    for (const [name, screen, hints] of SCREENS) {
      it(`RW-01 and RW-02 ${name} at ${columns} columns`, async () => {
        const r = renderAt(screen(), columns, 60);
        await settle();
        const collapsed = r.lines().map((l) => l.trimEnd());
        expect(widest(collapsed)).toBeLessThanOrEqual(headerRuleWidth(columns));
        const hintIdx = collapsed.findIndex((l) => l.includes(formatKeyHints(hints)));
        expect(hintIdx).toBeGreaterThanOrEqual(0);
        expect(collapsed[hintIdx + 1]?.trimStart().startsWith('┌')).toBe(true);
        expect(collapsed.join(NL)).not.toMatch(DASHES);
        r.stdin.write('\x07');
        await settle();
        const expanded = r.lines().map((l) => l.trimEnd());
        expect(widest(expanded)).toBeLessThanOrEqual(headerRuleWidth(columns));
        expect(expanded.join(NL)).toContain('Ctrl+G close guidance');
        r.unmount();
      });
    }
  }
});

describe('RW-03 Generate Report (#4257)', () => {
  it('keys per phase: pickers, the licence gate, run and done', () => {
    expect(formatKeyHints(reportKeys('input-app', true))).toBe('↑↓ select   Enter next   Esc back');
    expect(reportKeys('pdf-locked', true)).toBe(LICENSE_GATE_KEYS);
    expect(reportKeys('running', true)).toBe(KEY_HINTS.run);
    expect(formatKeyHints(reportKeys('done', true))).toBe('Enter back   Esc back');
  });

  it('format rows carry the description in the second column, without dash punctuation', () => {
    for (const allowed of [true, false]) {
      const rows = reportFormatOptions(allowed, 'application');
      expect(rows.map((o) => o.value)).toEqual(['all', 'text', 'yaml', 'json', 'pdf']);
      for (const o of rows) {
        expect(o.label).not.toContain('--');
        expect(o.detail).toBeTruthy();
        expect(o.guidance).toBeDefined();
      }
    }
    expect(reportFormatOptions(false, 'application').find((o) => o.value === 'pdf')?.detail).toContain('Consultant');
  });

  it('Application ID input, no workspace as a warn row, Esc goes back once', async () => {
    const onBack = vi.fn();
    const r = renderAt(<ReportScreen onBack={onBack} />, 100, 60);
    await settle();
    const text = r.lastFrame();
    expect(text).toContain('Application ID');
    expect(text).toContain('[warn]');
    expect(text).toContain('Workspace');
    expect(text).not.toContain('Generate Report --');
    r.stdin.write('\x1B');
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('format picker and the PDF gate: L opens the licence, Esc returns to the formats', async () => {
    const onOpenLicense = vi.fn();
    const onBack = vi.fn();
    const r = renderAt(<ReportScreen onBack={onBack} onOpenLicense={onOpenLicense} />, 100, 60);
    await settle();
    r.stdin.write('brickos');
    await settle(40);
    r.stdin.write('\r');
    await settle();
    expect(r.lastFrame()).toContain('Output format');
    // pdf is the fifth row
    for (let i = 0; i < 4; i++) { r.stdin.write('\x1B[B'); await settle(30); }
    r.stdin.write('\r');
    await settle();
    const gate = r.lastFrame();
    expect(gate).toContain('Consultant licence required');
    expect(gate).toContain(formatKeyHints(LICENSE_GATE_KEYS));
    expect(gate).not.toContain('swao license request');
    r.stdin.write('l');
    await settle();
    expect(onOpenLicense).toHaveBeenCalledTimes(1);
    r.stdin.write('\x1B');
    await settle();
    expect(r.lastFrame()).toContain('Output format');
    expect(onBack).not.toHaveBeenCalled();
    r.unmount();
  });

  it('a text report run lists the written file as a path row, not the CLI line', async () => {
    fakeSpawn.mockImplementation(() => makeChild(['[ok]  Report written to C:\\ws\\apps\\brickos\\wsp\\reports-app\\exec.txt', 'note line']));
    const r = renderAt(<ReportScreen onBack={noop} />, 100, 60);
    await settle();
    r.stdin.write('brickos'); await settle(40);
    r.stdin.write('\r'); await settle();
    r.stdin.write('\x1B[B'); await settle(30); // text
    r.stdin.write('\r'); await settle();
    r.stdin.write('\x1B[B'); await settle(30); // Business Owner
    r.stdin.write('\r'); await settle(250);
    const text = r.lastFrame();
    expect(text).toContain('1 file written');
    expect(text).toContain('exec.txt');
    expect(text).toContain('C:\\ws');
    expect(text).not.toContain('Report written to');
    expect(text).toContain('note line');
    expect(text).toContain('Enter back   Esc back');
    r.unmount();
  });
});

describe('RW-03 Lenses (#4257)', () => {
  it('lens rows: the passes and auto frameworks in the second column; the pass union', () => {
    const defs = [
      { id: 'a', passes: ['INV', 'STATE'], auto_frameworks: [] },
      { id: 'b', passes: ['STATE', 'SBOM'], auto_frameworks: ['ISO_27001'] },
    ] as unknown as Parameters<typeof lensOptions>[0];
    expect(lensOptions(defs).map((o) => o.detail)).toEqual(['passes: INV, STATE', 'passes: STATE, SBOM; auto: ISO_27001']);
    expect(passUnion(defs, ['a', 'b'])).toEqual(['INV', 'STATE', 'SBOM']);
  });

  it('Enter without a workspace shows the save error as a fail row', async () => {
    const r = renderAt(<LensesScreen onBack={noop} />, 100, 60);
    await settle();
    r.stdin.write('\r');
    await settle();
    const text = r.lastFrame();
    expect(text).toContain('[fail]');
    expect(text).toContain('No workspace found');
    r.unmount();
  });
});

describe('RW-03 Support Bundle, LLM Gateway and Regime Selector (#4257)', () => {
  it('Support Bundle: confirm shows the facts as rows; Enter runs; the result is a StatusRow', async () => {
    const onBack = vi.fn();
    const r = renderAt(<SupportBundleScreen onBack={onBack} />, 100, 60);
    await settle();
    const confirm = r.lastFrame();
    expect(confirm).toContain('Included');
    expect(confirm).toContain('Excluded');
    expect(confirm).not.toContain('Press Enter');
    r.stdin.write('\r');
    await settle(250);
    const done = r.lastFrame();
    expect(done).toContain('[ok]');
    expect(done).toContain('created');
    expect(done).toContain('Enter back   Esc back');
    r.stdin.write('\r');
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('LLM Gateway: running keys cancel, done keys go back; the spawn is the fake', async () => {
    expect(llmGatewayUpdateKeys('running')).toBe(KEY_HINTS.run);
    const r = renderAt(<LlmGatewayUpdateScreen onBack={noop} />, 100, 60);
    await settle(250);
    expect(fakeSpawn).toHaveBeenCalled();
    expect(r.lastFrame()).toContain('done');
    r.unmount();
  });

  it('Regime Selector: Tab opens the id input, Esc returns; likely applicable in the second column', async () => {
    const r = renderAt(<RegimeSelectorScreen workspacePath="/tmp/swao-rw-ws" onDone={noop} />, 100, 60);
    await settle();
    expect(r.lastFrame()).toContain('likely applicable');
    r.stdin.write('\t');
    await settle();
    expect(r.lastFrame()).toContain('Comma-separated regime ids');
    expect(r.lastFrame()).toContain(formatKeyHints(regimeSelectorKeys('text-pick')));
    r.stdin.write('\x1B');
    await settle();
    expect(r.lastFrame()).toContain('General Data Protection Regulation');
    r.unmount();
  });
});

describe('RW-03 Upgrade prompt (#4257)', () => {
  it('a numbered menu opens the Licence screen; no CLI text on screen', async () => {
    const onOpen = vi.fn();
    const r = renderAt(<UpgradePromptScreen feature="Publish HTML" requiredTier="consultant" onBack={noop} onOpenLicenseScreen={onOpen} />, 100, 60);
    await settle();
    const text = r.lastFrame();
    expect(text).toContain('1  Open the Licence screen');
    expect(text).not.toContain('swao license request');
    expect(text).not.toContain('Press');
    r.stdin.write('\r');
    await settle();
    expect(onOpen).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});

