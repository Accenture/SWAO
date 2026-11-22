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

// #4230 / #4254 (Design 126 sections 4.5, 8 and 9): every option of the
// migrated setup pickers carries its own guidance entry (the check fails when
// an option has none), and the migrated generic steps render on
// SetupStepFrame without hand-written hints or CLI syntax on the screen.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import type { SelectOption } from '@swao/tui-kit';
import { secondaryOptions } from './LlmSecondaryStep.js';
import { providerOptions, legacyModelOptions } from './LlmStep.js';
import { PlaywrightStep, playwrightOptions, visionScreens } from './IntegrationsStep.js';
import { testCodeOptions } from './TestCodeStep.js';
import { McpUpgradeNotice } from '../../../../setup/branches/generic.js';
import { appListChoices, appListGuidance, appSourceGuidance, APP_SOURCE_CHOICES } from '../../../../setup/steps/ApplicationAppStep.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** #4230 criterion 3: an option without a guidance entry fails. */
function expectGuidancePerOption(options: readonly SelectOption[]): void {
  expect(options.length).toBeGreaterThan(0);
  for (const o of options) {
    expect(o.guidance, `option ${o.value} has no guidance entry`).toBeDefined();
    expect(o.guidance!.title.length, o.value).toBeGreaterThan(0);
    expect(o.guidance!.what.length, o.value).toBeGreaterThan(0);
  }
}

describe('guidance per option at the setup call sites (#4230)', () => {
  it('Secondary LLM, LLM providers (with and without connectors), legacy models, Test Code, Playwright, App', () => {
    expectGuidancePerOption(secondaryOptions(null));
    expectGuidancePerOption(secondaryOptions('openrouter'));
    expect(secondaryOptions('openrouter')[0]!.guidance!.sections?.[0]?.text).toContain('openrouter');
    expectGuidancePerOption(providerOptions([]));
    expectGuidancePerOption(legacyModelOptions('anthropic'));
    expectGuidancePerOption(legacyModelOptions('openai'));
    expectGuidancePerOption(testCodeOptions(undefined));
    expectGuidancePerOption(testCodeOptions('exclude'));
    expectGuidancePerOption(playwrightOptions('win32'));
    expectGuidancePerOption(playwrightOptions('linux'));
    const appOptions = (has: boolean): SelectOption[] => appListChoices(has).map((l) => ({ label: l, value: l, guidance: appListGuidance(l, ['shop']) }));
    expectGuidancePerOption(appOptions(true));
    expectGuidancePerOption(appOptions(false));
    expectGuidancePerOption(APP_SOURCE_CHOICES.map((c) => ({ label: c.label, value: c.kind, guidance: appSourceGuidance(c) })));
  });

  it('the check fails for an option without guidance', () => {
    expect(() => expectGuidancePerOption([{ label: 'x', value: 'x' }])).toThrow();
  });
});

describe('Playwright step (#4254, #4341)', () => {
  it('the shell entry exists on Windows only', () => {
    expect(playwrightOptions('win32').map((o) => o.value)).toEqual(['continue', 'recheck', 'shell']);
    expect(playwrightOptions('linux').map((o) => o.value)).toEqual(['continue', 'recheck']);
  });

  it('visionScreens keeps the default for empty or invalid input and clamps the range', () => {
    expect(visionScreens('')).toBe(2);
    expect(visionScreens('abc')).toBe(2);
    expect(visionScreens('0')).toBe(1);
    expect(visionScreens('25')).toBe(10);
    expect(visionScreens(' 4 ')).toBe(4);
  });

  it('without Chromium: menu entries, Check again looks again, Continue goes on; no CLI on the screen; Esc does nothing', async () => {
    let looks = 0;
    const got: Array<number | undefined> = [];
    const r = render(<PlaywrightStep onNext={(n) => got.push(n)} find={() => { looks++; return null; }} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('Continue without the browser');
    expect(frame).toContain('Check again');
    expect(frame).not.toMatch(/\bswao install/);
    expect(frame).not.toMatch(/Press Enter|Enter:/);
    r.stdin.write('\u001B');
    await tick(80);
    expect(got).toEqual([]);
    const before = looks;
    r.stdin.write('2');
    await tick();
    expect(looks).toBeGreaterThan(before);
    r.stdin.write('1');
    await tick();
    expect(got).toEqual([undefined]);
    r.unmount();
  });

  it('with Chromium: the screen count is a text input; an empty entry keeps the default', async () => {
    const got: Array<number | undefined> = [];
    const r = render(<PlaywrightStep onNext={(n) => got.push(n)} find={() => '/opt/chromium'} />);
    await tick();
    expect(r.lastFrame()).toContain('Chromium is installed');
    expect(r.lastFrame()).toContain('Screens (1 to 10, default 2)');
    // Under the loaded workspace suite an Enter written before the input reads
    // keys is lost: press Enter until the step reports (bounded).
    for (let i = 0; i < 5 && got.length === 0; i++) {
      r.stdin.write('\r');
      for (let w = 0; w < 30 && got.length === 0; w++) await tick(20);
    }
    expect(got).toEqual([2]);
    r.unmount();
  });
});

describe('MCP upgrade notice (#4254)', () => {
  it('renders on the frame without CLI syntax on the screen; Enter continues, Esc does not', async () => {
    const got: string[] = [];
    const r = render(<McpUpgradeNotice onNext={() => got.push('next')} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('MCP Client');
    expect(frame).toContain('Enterprise licence');
    expect(frame).toContain('Enter confirm');
    expect(frame).not.toMatch(/swao license|--tier|Press Enter/);
    r.stdin.write('\u001B');
    await tick(80);
    expect(got).toEqual([]);
    r.stdin.write('\r');
    await tick();
    expect(got).toEqual(['next']);
    r.unmount();
  });
});
