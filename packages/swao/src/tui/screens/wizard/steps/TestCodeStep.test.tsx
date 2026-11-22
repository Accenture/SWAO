// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI tests: Setup Wizard test-code step (#3403)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3403: TUI parity for assessment.test_code. The step offers the three
// modes, the wizard writes the choice to the workspace .swao.yml through
// writeTestCodeModeToYaml, and what it writes parses with the CLI schema and
// resolves to the same mode `swao assess` uses.

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { tmpdir } from 'os';
import { load } from 'js-yaml';
import { SwaoYmlSchema, resolveTestCodeSetting } from '@swao/core';
import { TestCodeStep, TEST_CODE_CHOICES, testCodeGuidance, testCodeOptions } from './TestCodeStep.js';
import { CURSOR_MARKER, headerRuleWidth } from '@swao/tui-kit';
import { readTestCodeModeFromYaml, writeTestCodeModeToYaml, type WizardTestCodeMode } from '../yaml-helpers.js';
import { defaultSetupRegistry } from '../../../../setup/index.js';

const tick = () => new Promise((r) => setTimeout(r, 20));

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

function ws(yml: string): string {
  dir = mkdtempSync(join(tmpdir(), 'swao-3403-wizard-'));
  writeFileSync(join(dir, '.swao.yml'), yml, 'utf-8');
  return dir;
}

function effectiveMode(workDir: string): string {
  const parsed = SwaoYmlSchema.safeParse(load(readFileSync(join(workDir, '.swao.yml'), 'utf-8')) ?? {});
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'invalid');
  return resolveTestCodeSetting(undefined, parsed.data.assessment).mode;
}

describe('TestCodeStep (#3403)', () => {
  it('number keys choose a mode', async () => {
    const got: Array<WizardTestCodeMode | undefined> = [];
    const r = render(<TestCodeStep onNext={(m) => got.push(m)} />);
    await tick();
    expect(r.lastFrame()).toContain('Analyse all code (default)');
    r.stdin.write('3');
    await tick();
    expect(got).toEqual(['exclude']);
    r.unmount();
  });

  it('starts on the keep entry when a mode is stored (#4494); Up + Enter moves on; the keep entry keeps it, Esc does not (#4341)', async () => {
    const got: Array<WizardTestCodeMode | undefined> = [];
    const r = render(<TestCodeStep initial="tag" onNext={(m) => got.push(m)} />);
    await tick();
    expect((r.lastFrame() ?? '').split('\n').find((l) => l.includes('Keep the current setting (tag)'))).toContain(CURSOR_MARKER.trim());
    expect(r.lastFrame()).toContain('Keep the current setting (tag)');
    r.stdin.write(String.fromCharCode(27) + '[A'); // Up to exclude
    await tick();
    r.stdin.write('\r');
    await tick();
    r.stdin.write('\u001B');
    await tick();
    expect(got).toEqual(['exclude']);
    r.stdin.write('4');
    await tick();
    expect(got).toEqual(['exclude', undefined]);
    r.unmount();
  });

  it('every option carries its own guidance entry and the box follows the cursor (#4230)', async () => {
    const options = testCodeOptions(undefined);
    expect(options).toHaveLength(TEST_CODE_CHOICES.length + 1);
    for (const o of options) expect(o.guidance?.what.length ?? 0).toBeGreaterThan(0);
    const r = render(<TestCodeStep onNext={() => undefined} />);
    await tick();
    r.stdin.write('\x07');
    await tick();
    expect((r.lastFrame() ?? '').replace(/[│\s]+/g, ' ')).toContain('Test code is analysed like production code');
    r.stdin.write('\u001B[B');
    await tick();
    expect((r.lastFrame() ?? '').replace(/[│\s]+/g, ' ')).toContain('lowered one severity step');
    r.unmount();
  });

  it('is a step of the Application branch, after Playwright, and its adapter persists the choice (#4190)', () => {
    // Design 125 section 5.2: the wizard engine runs the branch health check and Ready after it.
    const steps = defaultSetupRegistry().steps('application').map((s) => s.id);
    expect(steps.indexOf('application.test-code')).toBeGreaterThan(steps.indexOf('application.playwright'));
    const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', 'setup', 'branches', 'application.tsx'), 'utf-8');
    expect(src).toContain('writeTestCodeModeToYaml(ctx.workspaceRoot, testCodeMode);');
  });
});

// #4117: the step shows the option labels only; the explanation of each mode
// (findings, scores, publication), the Application Assessment scope and the
// app override live in the central GuidanceBox.
describe('TestCodeStep guidance (#4117)', () => {
  const flat = (f: string | undefined): string => (f ?? '').replace(/[\u2502\s]+/g, ' ');

  it('the collapsed screen shows the option labels, no explanation lines, within the header width', async () => {
    const r = render(<TestCodeStep onNext={() => undefined} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    for (const c of TEST_CODE_CHOICES) expect(frame).toContain(c.label);
    expect(frame).toContain('(Ctrl+G for guidance)');
    expect(frame).not.toContain('Findings that rest only on test code');
    for (const line of frame.split('\n')) expect(line.trimEnd().length).toBeLessThanOrEqual(headerRuleWidth(100));
    r.unmount();
  });

  it('Ctrl+G shows every guidance section: Application Assessments only, app override, test-code detection', async () => {
    const r = render(<TestCodeStep onNext={() => undefined} />);
    await tick();
    r.stdin.write('\x07');
    await tick();
    const seen = new Set<string>();
    const sections = testCodeGuidance();
    const collect = (): void => { for (const d of sections) if (flat(r.lastFrame()).includes(d.text.slice(0, 40))) seen.add(d.label); };
    collect();
    for (let i = 0; i < sections.length + 2; i++) { r.stdin.write('\u001B[6~'); await tick(); collect(); }
    expect([...seen].sort()).toEqual(sections.map((d) => d.label).sort());
    const all = [...sections.map((d) => d.text), ...TEST_CODE_CHOICES.flatMap((c) => [c.help, c.details ?? ''])].join(' ');
    expect(all).toMatch(/Application Assessments only/);
    expect(all).toMatch(/app \.swao\.yml that sets its own value overrides it/);
    expect(all).toMatch(/scores/);
    expect(all).toMatch(/publication/);
    expect(all).toContain('assessment.test_code.mode');
    r.unmount();
  });

  it('Esc closes an open guidance box and never chooses or keeps (#4341)', async () => {
    const got: Array<WizardTestCodeMode | undefined> = [];
    const r = render(<TestCodeStep onNext={(m) => got.push(m)} />);
    await tick();
    r.stdin.write('\x07');
    await tick();
    r.stdin.write('\u001B');
    await tick();
    expect(got).toEqual([]);
    r.stdin.write('\u001B');
    await tick();
    expect(got).toEqual([]);
    r.unmount();
  });
});

describe('writeTestCodeModeToYaml (#3403)', () => {
  it('adopts the commented assessment template in place when there is no live block (#4280, #4281)', () => {
    const d = ws('engagement:\n  name: Demo\n# assessment:\n#   vision_max_screens: 2\n');
    writeTestCodeModeToYaml(d, 'exclude');
    const text = readFileSync(join(d, '.swao.yml'), 'utf-8');
    expect(text).toBe('engagement:\n  name: Demo\nassessment:\n  test_code:\n    mode: exclude\n#   vision_max_screens: 2\n');
    const e = ws('engagement:\n  name: Demo\n');
    writeTestCodeModeToYaml(e, 'tag');
    expect(readFileSync(join(e, '.swao.yml'), 'utf-8')).toBe('engagement:\n  name: Demo\n\nassessment:\n  test_code:\n    mode: tag\n');
    expect(effectiveMode(d)).toBe('exclude');
    expect(readTestCodeModeFromYaml(d)).toBe('exclude');
  });

  it('inserts into an existing block and keeps siblings and comments', () => {
    const d = ws('assessment:\n  vision_max_screens: 3  # screens\n  pass_profile: [core]\nregimes: [GDPR]\n');
    writeTestCodeModeToYaml(d, 'tag');
    const text = readFileSync(join(d, '.swao.yml'), 'utf-8');
    expect(text).toContain('  vision_max_screens: 3  # screens');
    expect(text).toContain('regimes: [GDPR]');
    expect(effectiveMode(d)).toBe('tag');
  });

  it('replaces an existing mode, keeps the patterns, drops a contradicting exclude_test_code', () => {
    const d = ws('assessment:\n  exclude_test_code: true\n  test_code:\n    extra_patterns: ["qa/**"]\n    mode: exclude\n');
    writeTestCodeModeToYaml(d, 'include');
    const text = readFileSync(join(d, '.swao.yml'), 'utf-8');
    expect(text).not.toContain('exclude_test_code');
    expect(text).toContain('extra_patterns: ["qa/**"]');
    expect(effectiveMode(d)).toBe('include');
    writeTestCodeModeToYaml(d, 'tag');
    expect(readFileSync(join(d, '.swao.yml'), 'utf-8').match(/mode:/g)).toHaveLength(1);
  });

  it('adds mode to a test_code block without one and rewrites the flow style', () => {
    const d = ws('assessment:\n  test_code:\n    keep_patterns: ["src/mock/api/**"]\n');
    writeTestCodeModeToYaml(d, 'exclude');
    expect(effectiveMode(d)).toBe('exclude');
    const f = ws('assessment:\n  test_code: { mode: include, extra_patterns: ["systemtest/**"] }\n');
    writeTestCodeModeToYaml(f, 'tag');
    const text = readFileSync(join(f, '.swao.yml'), 'utf-8');
    expect((load(text) as { assessment: { test_code: Record<string, unknown> } }).assessment.test_code).toEqual({ mode: 'tag', extra_patterns: ['systemtest/**'] });
    expect(effectiveMode(f)).toBe('tag');
  });
});
