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

// #4196 SET-07 (Design 125 sections 5.6, 5.7 and Q-05): candidates and
// subject of the LLM branch. Writes keep the rest of .swao.yml, parse with
// the CLI schema, and are read back by readLlmDefaults (the section 5.7
// preselection reader); the subject needs a completed Application run.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { SwaoYmlSchema, credentialEnvVarName } from '@swao/core';
import { readLlmDefaults } from './defaults.js';
import {
  candidatesProblem,
  checkLlmCandidates,
  checkLlmSubject,
  listCandidateConnectors,
  listSubjectApps,
  preselectedSubject,
  subjectReasonText,
  writeAssessmentLlm,
} from './llm-values.js';

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

const WS_YML = [
  '# workspace settings, comment kept',
  'wsp_version: "0.9"',
  'engagement:',
  '  name: "Demo"',
  '',
  'assessment:',
  '  test_code:',
  '    mode: tag',
  '  # trailing comment in the assessment block',
  '',
  'providers:',
  '  llm:',
  '    provider: ollama',
  '',
].join('\n');

function ws(yml = WS_YML): string {
  dir = mkdtempSync(join(tmpdir(), 'swao-4196-llm-'));
  writeFileSync(join(dir, '.swao.yml'), yml, 'utf-8');
  return dir;
}

function writeConnector(root: string, id: string, opts: { key?: string; catalogue?: string[] } = {}): void {
  const gw = join(root, 'wsp', 'inputs', 'llm-gateway');
  mkdirSync(gw, { recursive: true });
  writeFileSync(join(gw, `${id}.yaml`), [
    'schema_version: "1.0"',
    'connector:',
    `  id: ${id}`,
    `  name: ${id.toUpperCase()} Gateway`,
    '  protocol: openai-chat',
    '  base_url: https://llm.example.internal',
    ...(opts.key ? ['  auth:', `    credential_key: ${opts.key}`] : []),
    '  models:',
    `    default: ${id}-default`,
    ...(opts.catalogue ? ['    catalogue:', ...opts.catalogue.map((m) => `      - id: ${m}`)] : []),
    '',
  ].join('\n'), 'utf-8');
}

function writeRun(root: string, app: string, ts: string, completed: boolean): void {
  const runDir = join(root, 'apps', app, 'wsp', 'runs', ts);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(root, 'apps', app, '.swao.yml'), `app_id: ${app}\n`, 'utf-8');
  writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify(completed ? { finished_at: '2026-11-08T10:00:00Z', passes_executed: ['01'] } : { passes_executed: [] }), 'utf-8');
}

function doc(root: string): Record<string, unknown> {
  return load(readFileSync(join(root, '.swao.yml'), 'utf-8')) as Record<string, unknown>;
}

describe('candidatesProblem (#4196)', () => {
  it('needs 2 to 5 distinct connector and model pairs; the same connector with two models is fine', () => {
    expect(candidatesProblem([{ connector: 'a', model: 'm' }])).toMatch(/at least 2/);
    expect(candidatesProblem(Array.from({ length: 6 }, (_, i) => ({ connector: `c${i}`, model: 'm' })))).toMatch(/at most 5/);
    expect(candidatesProblem([{ connector: 'a', model: 'm' }, { connector: 'a', model: 'm' }])).toMatch(/twice/);
    expect(candidatesProblem([{ connector: 'a', model: 'm1' }, { connector: 'a', model: 'm2' }])).toBeNull();
  });
});

describe('writeAssessmentLlm (#4196, Design 125 section 5.7)', () => {
  it('adds assessment.llm next to test_code, keeps comments and other keys, parses with the CLI schema, and reads back', () => {
    const root = ws();
    writeAssessmentLlm(root, { candidates: [{ connector: 'openrouter', model: 'a/b' }, { connector: 'ollama', model: 'qwen' }] });
    const text = readFileSync(join(root, '.swao.yml'), 'utf-8');
    expect(text).toContain('# workspace settings, comment kept');
    expect(text).toContain('# trailing comment in the assessment block');
    const d = doc(root);
    expect(SwaoYmlSchema.safeParse(d).success).toBe(true);
    expect((d['assessment'] as Record<string, unknown>)['test_code']).toEqual({ mode: 'tag' });
    expect((d['providers'] as Record<string, unknown>)['llm']).toEqual({ provider: 'ollama' });
    expect(readLlmDefaults(root)).toEqual({
      candidates: [{ connector: 'openrouter', model: 'a/b' }, { connector: 'ollama', model: 'qwen' }],
      source: 'assessment.llm',
      // #4198 (lane 1) added the per-field origin; the written candidates must read back from assessment.llm.
      candidatesFrom: 'assessment.llm',
    });
  });

  it('#4403: saving candidates removes saved llm_assessment.legs (one default) and keeps the other llm_assessment keys; a subject-only write keeps them', () => {
    const root = ws(`${WS_YML}llm_assessment:\n  execution: serial\n  legs:\n    - connector: x\n      model: old\n      primary: true\n    - connector: y\n`);
    writeAssessmentLlm(root, { subjectApp: 'shop' });
    expect(readLlmDefaults(root).candidates).toEqual([{ connector: 'x', model: 'old' }, { connector: 'y' }]);
    writeAssessmentLlm(root, { candidates: [{ connector: 'a', model: '1' }, { connector: 'b', model: '2' }] });
    const d = doc(root);
    expect(d['llm_assessment']).toEqual({ execution: 'serial' });
    expect(readLlmDefaults(root)).toMatchObject({ candidates: [{ connector: 'a', model: '1' }, { connector: 'b', model: '2' }], candidatesFrom: 'assessment.llm' });
    expect(readFileSync(join(root, '.swao.yml'), 'utf-8')).toContain('# workspace settings, comment kept');
  });

  it('replaces an existing llm block, keeps its other keys, and adds the subject', () => {
    const root = ws();
    writeAssessmentLlm(root, { candidates: [{ connector: 'a', model: '1' }, { connector: 'b', model: '2' }] });
    writeAssessmentLlm(root, { subjectApp: 'shop' });
    writeAssessmentLlm(root, { candidates: [{ connector: 'c', model: '3' }, { connector: 'd' }, { connector: 'e', model: '5' }] });
    const llm = (doc(root)['assessment'] as Record<string, Record<string, unknown>>)['llm'];
    expect(llm).toEqual({ candidates: [{ connector: 'c', model: '3' }, { connector: 'd' }, { connector: 'e', model: '5' }], subject_app: 'shop' });
    expect(readLlmDefaults(root).subjectApp).toBe('shop');
    // One assessment.llm block plus the untouched providers.llm block.
    expect(readFileSync(join(root, '.swao.yml'), 'utf-8').match(/^ {2}llm:/gm)).toHaveLength(2);
    expect(readFileSync(join(root, '.swao.yml'), 'utf-8').match(/^ {4}candidates:/gm)).toHaveLength(1);
  });

  it('appends an assessment block when the workspace has none', () => {
    const root = ws('wsp_version: "0.9"\n# end\n');
    writeAssessmentLlm(root, { subjectApp: 'shop' });
    expect(readFileSync(join(root, '.swao.yml'), 'utf-8')).toContain('# end');
    expect(readLlmDefaults(root)).toEqual({ candidates: [], subjectApp: 'shop', source: 'assessment.llm', candidatesFrom: 'none' });
  });

  // #4283: the central minimal-patch writer follows the indentation of the
  // block and skips comment lines, so these files are now patched in place.
  it('patches a hand-indented block and a block with a column-0 comment in place (#4283)', () => {
    const indented = 'wsp_version: "0.9"\nassessment:\n    test_code:\n        mode: tag\n';
    const root = ws(indented);
    writeAssessmentLlm(root, { subjectApp: 'shop' });
    expect(readFileSync(join(root, '.swao.yml'), 'utf-8')).toBe(`${indented}    llm:\n        subject_app: shop\n`);
    rmSync(root, { recursive: true, force: true });
    const commented = 'assessment:\n  test_code:\n    mode: tag\n# column-0 comment inside the block\n  llm:\n    subject_app: old\n';
    const root2 = ws(commented);
    writeAssessmentLlm(root2, { subjectApp: 'shop' });
    expect(readFileSync(join(root2, '.swao.yml'), 'utf-8')).toBe(commented.replace('subject_app: old', 'subject_app: shop'));
    rmSync(root2, { recursive: true, force: true });
  });

  it('leaves a duplicate-key file byte-identical and throws', () => {
    const dup = 'assessment:\n  test_code:\n    mode: tag\nassessment:\n  llm:\n    subject_app: old\n';
    const root = ws(dup);
    expect(() => writeAssessmentLlm(root, { subjectApp: 'shop' })).toThrow();
    expect(readFileSync(join(root, '.swao.yml'), 'utf-8')).toBe(dup);
  });

  it('refuses 1 or 6 candidates and leaves the file unchanged', () => {
    const root = ws();
    expect(() => writeAssessmentLlm(root, { candidates: [{ connector: 'a' }] })).toThrow(/at least 2/);
    expect(() => writeAssessmentLlm(root, { candidates: Array.from({ length: 6 }, (_, i) => ({ connector: `c${i}` })) })).toThrow(/at most 5/);
    expect(readFileSync(join(root, '.swao.yml'), 'utf-8')).toBe(WS_YML);
  });
});

describe('listCandidateConnectors and checkLlmCandidates (#4196)', () => {
  it('lists workspace connectors with models and credential status from vault or environment', () => {
    const root = ws();
    writeConnector(root, 'alpha', { key: 'alpha-key', catalogue: ['alpha-default', 'alpha-big'] });
    writeConnector(root, 'beta', { key: 'beta-key' });
    writeConnector(root, 'local');
    const list = listCandidateConnectors(root, { vault: { 'alpha-key': 'x' }, env: {} });
    expect(list.map((c) => [c.id, c.hasCredential])).toEqual([['alpha', true], ['beta', false], ['local', true]]);
    expect(list[0]!.models).toEqual(['alpha-default', 'alpha-big']);
    expect(list[2]!.credentialKey).toBeUndefined();
    const env = { [credentialEnvVarName('beta-key')]: 'y' };
    expect(listCandidateConnectors(root, { vault: {}, env })[1]!.hasCredential).toBe(true);
  });

  it('check: missing without candidates; per candidate credential state otherwise', () => {
    const root = ws();
    writeConnector(root, 'alpha', { key: 'alpha-key' });
    writeConnector(root, 'local');
    expect(checkLlmCandidates(root, { vault: {}, env: {} })).toEqual([expect.objectContaining({ state: 'missing' })]);
    writeAssessmentLlm(root, { candidates: [{ connector: 'alpha', model: 'm' }, { connector: 'local', model: 'n' }, { connector: 'gone', model: 'x' }] });
    expect(checkLlmCandidates(root, { vault: {}, env: {} }).map((i) => [i.label, i.state, i.detail])).toEqual([
      ['Candidate alpha', 'missing', 'm, credential missing'],
      ['Candidate local', 'ok', 'n, no credential needed'],
      ['Candidate gone', 'missing', 'x, connector not in the workspace'],
    ]);
  });
});

describe('subject apps (#4196, Q-05: a completed Application run is required)', () => {
  it('only apps with a completed run are eligible; a single eligible app is preselected', () => {
    const root = ws();
    writeRun(root, 'done-app', '2026-11-08T10-00-00Z', true);
    writeRun(root, 'broken-app', '2026-11-08T10-00-00Z', false);
    mkdirSync(join(root, 'apps', 'new-app'), { recursive: true });
    writeFileSync(join(root, 'apps', 'new-app', '.swao.yml'), 'app_id: new-app\n', 'utf-8');
    const apps = listSubjectApps(root);
    expect(apps).toEqual([
      { appId: 'broken-app', eligible: false, reason: 'no-completed-run' },
      { appId: 'done-app', eligible: true, latestRun: '2026-11-08T10-00-00Z' },
      { appId: 'new-app', eligible: false, reason: 'no-runs' },
    ]);
    expect(preselectedSubject(apps, undefined)).toBe('done-app');
    expect(preselectedSubject(apps, 'broken-app')).toBe('done-app');
    for (const a of apps) expect(subjectReasonText(a.reason)).not.toMatch(/--|\bswao\s|`/);
  });

  it('check: points to the Application Assessment without an eligible app; ok for an eligible subject; warn otherwise', () => {
    const root = ws();
    // #4223: the assessed app is the expected next step, so it is waiting (yellow), not missing.
    expect(checkLlmSubject(root)[0]).toMatchObject({ state: 'waiting', short: 'run the Application Assessment first' });
    expect(checkLlmSubject(root)[0]!.detail).toMatch(/Application Assessment first/);
    writeRun(root, 'shop', '2026-11-08T10-00-00Z', true);
    writeRun(root, 'other', '2026-11-08T10-00-00Z', false);
    writeAssessmentLlm(root, { subjectApp: 'shop' });
    expect(checkLlmSubject(root)).toEqual([{ label: 'Assessed app', state: 'ok', detail: 'shop: ready' }]);
    writeAssessmentLlm(root, { subjectApp: 'other' });
    expect(checkLlmSubject(root)[0]).toMatchObject({ state: 'warn', detail: 'other: no completed Application Assessment run' });
  });
});
