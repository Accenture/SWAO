// #4284 (Design 125 section 5.7): run-time choices of the Application
// Assessment reach the run as flags; the save-as-default answer edits only the
// changed key of apps/<id>/.swao.yml through the minimal-patch writer.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_SAVE_NO, appDefaultEdits, appRunChoiceArgs, appSaveOptions, runAppLlmConfig, saveAppDefault, selectionDiffers } from './app-run-defaults.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const YML = [
  '# app config',
  'source:',
  '  path: ./src # where the code is',
  'assessment:',
  '  regimes_active: [GDPR_DEMO, AI_10_PILLARS_DEMO]',
  'providers:',
  '  llm:',
  '    primary:',
  '      type: anthropic',
  '',
].join('\n');

function ws(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-app-defaults-'));
  tmp.push(d);
  mkdirSync(join(d, 'apps', 'demo'), { recursive: true });
  writeFileSync(join(d, 'apps', 'demo', '.swao.yml'), YML);
  return d;
}

describe('app run-time choices (#4284)', () => {
  it('the save question starts on No', () => {
    for (const k of ['regimes', 'passes', 'llm'] as const) expect(appSaveOptions(k)[0]!.value).toBe(APP_SAVE_NO);
  });

  it('selectionDiffers compares as sets', () => {
    expect(selectionDiffers(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(selectionDiffers(['a'], ['a', 'b'])).toBe(true);
    expect(selectionDiffers([], [])).toBe(false);
  });

  it('run flags: --regimes (none for an empty choice, nothing for the all placeholder or before the step), --llm-provider', () => {
    expect(appRunChoiceArgs({ regimes: ['GDPR_DEMO'], llmProvider: null })).toEqual(['--regimes', 'GDPR_DEMO']);
    expect(appRunChoiceArgs({ regimes: [], llmProvider: 'ollama' })).toEqual(['--regimes', 'none', '--llm-provider', 'ollama']);
    expect(appRunChoiceArgs({ regimes: ['all'], llmProvider: null })).toEqual([]);
    expect(appRunChoiceArgs({ regimes: null, llmProvider: 'workspace-default' })).toEqual(['--llm-provider', 'workspace-default']);
  });

  it('saving the frameworks edits only regimes_active; comments and the other keys stay', () => {
    const d = ws();
    expect(saveAppDefault(d, 'demo', appDefaultEdits({ kind: 'regimes', regimes: ['GDPR_DEMO'] }))).toBeNull();
    const after = readFileSync(join(d, 'apps', 'demo', '.swao.yml'), 'utf-8');
    expect(after).toBe(YML.replace('regimes_active: [GDPR_DEMO, AI_10_PILLARS_DEMO]', 'regimes_active: [GDPR_DEMO]'));
  });

  it('saving the passes adds pass_profile and the malware block only when missing', () => {
    expect(appDefaultEdits({ kind: 'passes', passes: ['inv'], hasMalwareBlock: false })).toHaveLength(1);
    expect(appDefaultEdits({ kind: 'passes', passes: ['inv', 'malware'], hasMalwareBlock: true })).toHaveLength(1);
    const edits = appDefaultEdits({ kind: 'passes', passes: ['inv', 'malware'], hasMalwareBlock: false });
    expect(edits.map((e) => e.path.join('.'))).toEqual(['assessment.pass_profile', 'passes.malware']);
  });

  it('saving workspace-default removes the app LLM override; a provider sets it', () => {
    const d = ws();
    expect(saveAppDefault(d, 'demo', appDefaultEdits({ kind: 'llm', provider: 'workspace-default' }))).toBeNull();
    const removed = readFileSync(join(d, 'apps', 'demo', '.swao.yml'), 'utf-8');
    expect(removed).toContain('# app config');
    expect(removed).not.toContain('type: anthropic');
    expect(saveAppDefault(d, 'demo', appDefaultEdits({ kind: 'llm', provider: 'ollama' }))).toBeNull();
    expect(readFileSync(join(d, 'apps', 'demo', '.swao.yml'), 'utf-8')).toContain('ollama');
  });

  it('a missing app file is reported, not created', () => {
    const d = ws();
    expect(saveAppDefault(d, 'nope', appDefaultEdits({ kind: 'regimes', regimes: [] }))).toContain('Not saved');
  });
});

describe('runAppLlmConfig (#4284)', () => {
  it('the stored override without a run choice; none for workspace-default; only the type for a provider', () => {
    const stored = { type: 'anthropic', model: 'm', connector: 'c' };
    expect(runAppLlmConfig(stored, null)).toBe(stored);
    expect(runAppLlmConfig(stored, 'workspace-default')).toEqual({});
    expect(runAppLlmConfig(stored, 'ollama')).toEqual({ type: 'ollama' });
  });
});
