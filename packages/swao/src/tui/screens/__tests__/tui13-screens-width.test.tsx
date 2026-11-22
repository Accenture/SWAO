// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, TUI-13 screens at 100 and 80 columns (#4257)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4257 (TUI-13, Design 126 sections 3 and 10): every screen migrated by this
// row renders within the header rule at 100 and 80 columns, collapsed and
// with the guidance box expanded, and keeps its key hint line directly above
// the guidance box border.
//
// W-01 every line within headerRuleWidth(columns), guidance collapsed and expanded
// W-02 the key hint line sits directly above the guidance box border
//
// The Enterprise ChatScreen cases live in tui13-chat-width.test.tsx, which the
// public sync excludes (#3348: a synced file must not import the chat code).

import { describe, it, expect, vi } from 'vitest';
import React from 'react';

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    // No workspace: Ingest shows its no-workspace result and starts no process.
    findWorkspace: vi.fn(() => null),
    LicenseGuard: {
      load: vi.fn(() => ({
        state: {
          tier: 'community' as const, valid: true, remaining_assessments: 48, expiry: '2027-01-01',
          fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com',
          firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined,
        },
      })),
    },
  };
});

// The Health Check screen spawns `swao health-check`: a fake child reports two
// probes (one warn with its reason) and exits, so no real process starts.
vi.mock('child_process', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from([
          '  [1/2] License..........  ok  community tier',
          '  [2/2] Prerequisites....  WARN  checkov not found; the IaC security scan uses kics instead',
          '',
        ].join(String.fromCharCode(10))));
        child.emit('close', 1);
      }, 20);
      return child;
    }),
  };
});

import { DetailRow, headerRuleWidth, KEY_HINTS, formatKeyHints, type KeyHint } from '@swao/tui-kit';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';
import { MainMenu } from '../MainMenu.js';
import { ToolsMenu } from '../ToolsMenu.js';
import { HealthCheckScreen } from '@swao/module-health-check';
import { IngestScreen } from '../IngestScreen.js';
import { HelpScreen } from '../HelpScreen.js';
import { ChatScreen as ChatStub } from '../../../tiers/premium-stubs/ChatScreen.js';
import { LzCatalogueUpdateScreen } from '../LzCatalogueUpdateScreen.js';
import { CredentialScreen, credentialKeys, credentialPickOptions } from '../CredentialScreen.js';
import { LicenseScreen, licenseKeys } from '../LicenseScreen.js';
import { ExportBiScreen } from '@swao/module-powerbi';
import { PublishScreen, ServeScreen } from '@swao/module-html-report';

const noop = (): void => {};

async function settle(ms = 120): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

/** The migrated screens: name, element, the hint line it shows first. */
export const TUI13_SCREENS: Array<[string, () => JSX.Element, readonly KeyHint[]]> = [
  ['Main menu', () => <MainMenu onSelect={noop} />, KEY_HINTS.menu],
  ['Tools menu', () => <ToolsMenu onSelect={noop} onBack={noop} />, KEY_HINTS.menu],
  ['Health Check', () => <HealthCheckScreen onBack={noop} version="0.0.0" />, KEY_HINTS.lastStep],
  ['Ingest', () => <IngestScreen onBack={noop} />, KEY_HINTS.lastStep.filter((h) => h.key !== '↑↓')],
  ['Chat stub (Community bundle)', () => <ChatStub onBack={noop} />, [{ key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'back' }]],
  // Day 3 (lane screens): the Community licence gate of the Consultant screen.
  ['Update LZ Catalogue (Community gate)', () => <LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />, [{ key: 'Esc', verb: 'back' }]],
  ['Credentials', () => <CredentialScreen onBack={noop} />, [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'back' }]],
  ['Licence', () => <LicenseScreen onBack={noop} />, [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'back' }]],
  ['Export BI (no workspace)', () => <ExportBiScreen onBack={noop} version="0.0.0" />, [{ key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }]],
  ['Publish HTML', () => <PublishScreen onBack={noop} version="0.0.0" />, [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'back' }]],
  ['Serve publication', () => <ServeScreen onBack={noop} version="0.0.0" />, [{ key: 'Esc', verb: 'close', object: 'server' }]],
];

describe('TUI-13 Help at 100 and 80 columns (#4257, no guidance box, #2347)', () => {
  for (const columns of [100, 80]) {
    it(`W-01 Help at ${columns} columns`, async () => {
      const r = renderAt(<HelpScreen onBack={noop} />, columns, 60);
      await settle();
      const lines = r.lines().map((l) => l.trimEnd());
      r.unmount();
      expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(columns));
      const text = lines.join(String.fromCharCode(10));
      expect(text).toContain('Enter back   Esc back');
      expect(text).not.toContain('Ctrl+G');
    });
  }
});

describe('TUI-13 screens at 100 and 80 columns (#4257, Design 126 section 10)', () => {
  for (const columns of [100, 80]) {
    for (const [name, screen, hints] of TUI13_SCREENS) {
      it(`W-01 and W-02 ${name} at ${columns} columns`, async () => {
        const r = renderAt(screen(), columns, 60);
        await settle();
        const collapsed = r.lines().map((l) => l.trimEnd());
        expect(widest(collapsed)).toBeLessThanOrEqual(headerRuleWidth(columns));
        const hintIdx = collapsed.findIndex((l) => l.includes(formatKeyHints(hints)));
        expect(hintIdx).toBeGreaterThanOrEqual(0);
        expect(collapsed[hintIdx + 1]?.trimStart().startsWith('┌')).toBe(true);
        r.stdin.write('\x07');
        await settle();
        const expanded = r.lines().map((l) => l.trimEnd());
        expect(widest(expanded)).toBeLessThanOrEqual(headerRuleWidth(columns));
        expect(expanded.join('\n')).toContain('Ctrl+G close guidance');
        r.unmount();
      });
    }
  }
});

describe('TUI-13 Esc closes the guidance box first (#4257, Design 126 section 7.5)', () => {
  for (const [name, el] of [['Chat stub', ChatStub], ['Credentials', CredentialScreen], ['Licence', LicenseScreen]] as const) {
    it(`${name}: Ctrl+G then Esc keeps the screen; a second Esc leaves`, async () => {
      const onBack = vi.fn();
      const Screen = el;
      const r = renderAt(<Screen onBack={onBack} />, 100, 60);
      await settle();
      r.stdin.write('\x07');
      await settle();
      r.stdin.write('\u001B');
      await settle();
      expect(onBack).not.toHaveBeenCalled();
      r.stdin.write('\u001B');
      await settle();
      expect(onBack).toHaveBeenCalledTimes(1);
      r.unmount();
    });
  }
});

describe('Credentials sub-screens (#4257, day 3)', () => {
  it('the pick list shows the key and its description in two columns, one guidance entry each, "other" last', () => {
    const opts = credentialPickOptions([], true);
    expect(opts[0]).toMatchObject({ label: 'anthropic-api-key', value: 'anthropic-api-key' });
    expect(opts[0]?.detail).toContain('Anthropic');
    expect(opts.every((o) => o.guidance !== undefined)).toBe(true);
    expect(opts.every((o) => !/\s--\s/.test(`${o.label} ${o.detail ?? ''}`))).toBe(true);
    expect(opts.at(-1)?.value).toBe('other');
    expect(credentialPickOptions([], false).some((o) => o.value === 'playwright')).toBe(false);
  });

  it('key hints per sub-screen; a running command shows none until it finishes', () => {
    expect(formatKeyHints(credentialKeys('delete-confirm', false))).toBe('Enter confirm   Esc cancel');
    expect(credentialKeys('set-running', false)).toEqual([]);
    expect(formatKeyHints(credentialKeys('set-running', true))).toBe('Enter back   Esc back');
    expect(formatKeyHints(credentialKeys('set-value', false))).toBe('Enter save   Esc back');
  });

  it('Enter on the menu opens the set picker; Esc there returns to the menu', async () => {
    const onBack = vi.fn();
    const r = renderAt(<CredentialScreen onBack={onBack} />, 100, 60);
    await settle();
    r.stdin.write('\u001B[B');
    await settle();
    r.stdin.write('\r');
    await settle();
    expect(r.lines().join('\n')).toContain('Credential to set');
    expect(r.lines().join('\n')).toContain('provider:azure-devops:token');
    r.stdin.write('\u001B');
    await settle();
    expect(r.lines().join('\n')).toContain('List stored credentials');
    expect(onBack).not.toHaveBeenCalled();
    r.unmount();
  });
});

describe('Licence sub-screens (#4257, day 3)', () => {
  it('key hints per sub-screen: a running command offers cancel, a finished one back', () => {
    expect(formatKeyHints(licenseKeys('status', false))).toBe('Esc cancel');
    expect(formatKeyHints(licenseKeys('status', true))).toBe('Enter back   Esc back');
    expect(formatKeyHints(licenseKeys('activate-input', false))).toBe('Enter confirm   Esc back');
  });

  it('the menu shows the status panel without a spaced double hyphen or a vertical bar', async () => {
    const r = renderAt(<LicenseScreen onBack={noop} />, 100, 60);
    await settle();
    const text = r.lines().join('\n');
    r.unmount();
    expect(text).toContain('Tier');
    expect(text).toContain('Fingerprint');
    expect(text).not.toMatch(/\s--\s/);
    expect(text).not.toContain('Press Enter');
  });

  it('Request: the tier picker, then step 1 of 4; Esc steps back to the picker', async () => {
    const r = renderAt(<LicenseScreen onBack={noop} />, 100, 60);
    await settle();
    r.stdin.write('\u001B[B');
    await settle();
    r.stdin.write('\r');
    await settle();
    expect(r.lines().join('\n')).toContain('Licence tier to request');
    r.stdin.write('\r');
    await settle();
    expect(r.lines().join('\n')).toContain('Step 1 of 4: Your name');
    r.stdin.write('\u001B');
    await settle();
    expect(r.lines().join('\n')).toContain('Licence tier to request');
    r.unmount();
  });
});

describe('paths on the migrated screens keep the drive and the file name (#4257, Design 126 section 8)', () => {
  it('a DetailRow path wider than the row is shortened in the middle, never cut at the start or the end', async () => {
    const long = 'C:\\swao-dev\\ws\\apps\\some-long-app-id-for-the-width-test\\wsp\\exports\\2026-11-11T08-00-00\\xlsx\\swao-export.xlsx';
    const r = renderAt(<DetailRow label="XLSX rollup" value={long} path />, 80, 10);
    await settle(30);
    const text = r.lines().join('').replace(/\s+/g, '');
    r.unmount();
    expect(text).toContain('C:\\swao-dev');
    expect(text).toContain('swao-export.xlsx');
    const short = 'C:\\ws\\apps\\a\\wsp\\exports\\star';
    const r2 = renderAt(<DetailRow label="Star schema" value={short} path />, 80, 10);
    await settle(30);
    expect(r2.lines().join('')).toContain(short);
    r2.unmount();
  });
});
