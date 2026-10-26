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
import { TestCodeStep } from './TestCodeStep.js';
import { readTestCodeModeFromYaml, writeTestCodeModeToYaml, type WizardTestCodeMode } from '../yaml-helpers.js';

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
    expect(r.lastFrame()).toContain('assessment.test_code.mode');
    r.stdin.write('3');
    await tick();
    expect(got).toEqual(['exclude']);
    r.unmount();
  });

  it('starts on the current value; Down + Enter moves on; Esc keeps the current value', async () => {
    const got: Array<WizardTestCodeMode | undefined> = [];
    const r = render(<TestCodeStep initial="tag" onNext={(m) => got.push(m)} />);
    await tick();
    expect(r.lastFrame()).toContain('> 2. Analyse all code, mark test-code findings');
    r.stdin.write('\u001B[B'); // Down
    await tick();
    r.stdin.write('\r');
    await tick();
    r.stdin.write('\u001B');
    await tick();
    expect(got).toEqual(['exclude', undefined]);
    r.unmount();
  });

  it('is wired into the Setup Wizard before the ready step and persists the choice', () => {
    const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'SetupWizard.tsx'), 'utf-8');
    expect(src).toContain("'playwright', 'test-code', 'ready'");
    expect(src).toContain('writeTestCodeModeToYaml(state.workDir, testCodeMode);');
    expect(src).toContain("setStep('test-code');");
  });
});

describe('writeTestCodeModeToYaml (#3403)', () => {
  it('appends an assessment block when none exists', () => {
    const d = ws('engagement:\n  name: Demo\n# assessment:\n#   vision_max_screens: 2\n');
    writeTestCodeModeToYaml(d, 'exclude');
    const text = readFileSync(join(d, '.swao.yml'), 'utf-8');
    expect(text).toContain('# assessment:\n#   vision_max_screens: 2');
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
    expect(text).toContain('extra_patterns: ["systemtest/**"]');
    expect(effectiveMode(f)).toBe('tag');
  });
});
